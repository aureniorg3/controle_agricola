import { auditar } from "./auditar";
import { getPool, prepararBanco } from "./db";
import { gravarAreaColhidaDia } from "./db-area";
import { addDays } from "./period";
import { lerPlanejamentoCorte, mesmaFrente } from "./planejamento-corte";
import { ratearArea } from "./rateio";

/**
 * Lançamento da área colhida pela mensagem "Planejamento Ordem de Cortes" do WhatsApp: cada ordem da mensagem traz o
 * Realizado (área colhida acumulada); a área do dia é o Realizado menos o que já está lançado até o dia anterior à data
 * do lançamento, rateada entre os talhões da ordem (pelo saldo de cada um ou pela área) — o mesmo do lançamento pela
 * ordem na tela de apontamento. Primeiro a conferência (nada é gravado); depois, o lançamento das ordens escolhidas,
 * um boletim por ordem.
 */

const r2 = (n) => Math.round(n * 100) / 100;
const ha = (n) => `${(n ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ha`;
const br = (iso) => iso.split("-").reverse().join("/");
const semZeros = (s) => String(s ?? "").trim().replace(/^0+(?=\d)/, "");
const DATA = /^\d{4}-\d{2}-\d{2}$/;

/** Data do lançamento: a escolhida na tela; sem ela, o dia anterior ao da mensagem (o Realizado da manhã vale até a véspera). */
export function dataDoLancamento(lido, dt) {
  if (typeof dt === "string" && DATA.test(dt)) return dt;
  return lido.data ? addDays(lido.data, -1) : null;
}

/** Conferência da mensagem contra as ordens, os talhões e a área colhida já lançada. Não grava nada. */
export async function conferirPlanejamento(texto, dtEscolhida, base = "saldo") {
  const pool = getPool();
  await prepararBanco(pool);
  const lido = lerPlanejamentoCorte(texto);
  const dt = dataDoLancamento(lido, dtEscolhida);
  const resposta = { data: lido.data, dt, base, avisos: [...lido.avisos], linhas: [], foraDaMensagem: [] };
  if (lido.ordens.length === 0) {
    resposta.erro = 'Não achei nenhuma ordem na mensagem (blocos "Ordem. 2496" com Faz., Área, Realizado e Resta).';
    return resposta;
  }
  if (!dt) {
    resposta.erro = 'Informe a data do lançamento no campo "Data do lançamento" (a mensagem não traz a linha "Data: dd/mm/aaaa").';
    return resposta;
  }

  const numeros = lido.ordens.map((o) => semZeros(o.numero));
  const ords = new Map(
    (await pool.query("SELECT num, frt, sts FROM ord WHERE ltrim(num, '0') = ANY($1::text[])", [numeros])).rows.map((r) => [semZeros(r.num), r]),
  );
  const nums = [...ords.values()].map((r) => r.num);
  const { rows: tlhs } = await pool.query(
    `SELECT t.ord_num, t.faz_cod, t.faz_nm, t.tlh, t.area_ha::float AS area_ha, t.area_col_ha::float AS area_col_ha,
            COALESCE(SUM(c.area) FILTER (WHERE c.dt < $2::date), 0)::float AS antes,
            COALESCE(SUM(c.area) FILTER (WHERE c.dt = $2::date), 0)::float AS dia,
            COALESCE(SUM(c.area) FILTER (WHERE c.dt > $2::date), 0)::float AS depois
       FROM tlh t LEFT JOIN col_dia c ON c.ord_num = t.ord_num AND c.faz_cod = t.faz_cod AND c.tlh = t.tlh
      WHERE t.ord_num = ANY($1::text[])
      GROUP BY t.ord_num, t.faz_cod, t.faz_nm, t.tlh, t.area_ha, t.area_col_ha
      ORDER BY t.ord_num, t.faz_cod, NULLIF(regexp_replace(t.tlh, '\\D', '', 'g'), '')::bigint NULLS LAST, t.tlh`,
    [nums, dt],
  );
  const bolDoDia = new Map(
    (await pool.query("SELECT ord_num, MAX(bol) AS bol FROM col_dia WHERE ord_num = ANY($1::text[]) AND dt = $2::date GROUP BY ord_num", [nums, dt])).rows.map(
      (r) => [r.ord_num, r.bol],
    ),
  );
  let proximoBoletim = (await pool.query("SELECT (COALESCE(MAX(bol), 0) + 1)::int AS n FROM col_dia")).rows[0].n;

  for (const o of lido.ordens) {
    const ord = ords.get(semZeros(o.numero));
    const msgs = [];
    const linha = {
      numero: ord?.num ?? o.numero,
      frenteMensagem: o.frente,
      frenteSistema: ord?.frt ?? "",
      status: ord?.sts ?? "",
      fazendaTexto: o.fazendaTexto,
      fazendasMensagem: o.fazendas,
      fazendasSistema: [],
      areaMensagem: o.area,
      areaSistema: null,
      realizado: o.realizado,
      resta: o.resta,
      colhidoAnterior: null,
      jaNoDia: 0,
      posterior: 0,
      areaDia: null,
      cabe: null,
      boletim: null,
      boletimNovo: false,
      talhoes: [],
      situacao: "bloqueada",
      mensagens: msgs,
    };
    resposta.linhas.push(linha);
    if (!ord) {
      msgs.push({ nivel: "erro", texto: `A ordem ${o.numero} não está cadastrada nas Ordens de Corte (importe a Ordem de Colheita antes).` });
      continue;
    }
    const doOrd = tlhs.filter((t) => t.ord_num === ord.num);
    if (doOrd.length === 0) {
      msgs.push({ nivel: "erro", texto: `A ordem ${ord.num} não tem talhões cadastrados.` });
      continue;
    }
    if (o.realizado === null) {
      msgs.push({ nivel: "erro", texto: "A mensagem não traz o Realizado desta ordem." });
      continue;
    }

    const fazendas = new Map();
    for (const t of doOrd) fazendas.set(t.faz_cod, t.faz_nm);
    linha.fazendasSistema = [...fazendas].map(([cod, nm]) => ({ cod, nm }));
    linha.areaSistema = r2(doOrd.reduce((s, t) => s + t.area_ha, 0));
    linha.colhidoAnterior = r2(doOrd.reduce((s, t) => s + t.area_col_ha + t.antes, 0));
    linha.jaNoDia = r2(doOrd.reduce((s, t) => s + t.dia, 0));
    linha.posterior = r2(doOrd.reduce((s, t) => s + t.depois, 0));
    // o que ainda cabe em cada talhão, sem contar o que já está lançado no próprio dia (ele é substituído)
    const itens = doOrd.map((t) => {
      const disp = Math.max(0, r2(t.area_ha - t.area_col_ha - t.antes - t.depois));
      return { chave: `${t.faz_cod}|${t.tlh}`, peso: base === "area" ? t.area_ha : disp, teto: disp, t };
    });
    linha.cabe = r2(itens.reduce((s, i) => s + i.teto, 0));
    const areaDia = r2(o.realizado - linha.colhidoAnterior);
    linha.areaDia = areaDia;

    // avisos (não impedem o lançamento)
    if (ord.sts !== "Aberta") msgs.push({ nivel: "aviso", texto: `A ordem está ${String(ord.sts).toLowerCase()} no sistema.` });
    if (o.frente && ord.frt && !mesmaFrente(o.frente, ord.frt)) msgs.push({ nivel: "aviso", texto: `Frente na mensagem: ${o.frente}; no sistema: ${ord.frt}.` });
    const codsSistema = new Set([...fazendas.keys()].map(semZeros));
    const codsMsg = o.fazendas.map(semZeros);
    if (codsMsg.length === 0) msgs.push({ nivel: "aviso", texto: "A mensagem não traz o código da fazenda." });
    else {
      const foraDaOrdem = codsMsg.filter((c) => !codsSistema.has(c));
      const faltando = [...codsSistema].filter((c) => !codsMsg.includes(c));
      if (foraDaOrdem.length) msgs.push({ nivel: "aviso", texto: `Fazenda da mensagem que não está na ordem: ${foraDaOrdem.join(", ")}.` });
      if (faltando.length) msgs.push({ nivel: "aviso", texto: `Fazenda da ordem que não está na mensagem: ${faltando.join(", ")}.` });
    }
    if (o.area !== null && Math.abs(o.area - linha.areaSistema) > 0.01) {
      msgs.push({ nivel: "aviso", texto: `Área na mensagem: ${ha(o.area)}; área da ordem no sistema: ${ha(linha.areaSistema)}.` });
    }
    if (o.area !== null && o.resta !== null && Math.abs(r2(o.area - o.realizado) - o.resta) > 0.01) {
      msgs.push({ nivel: "aviso", texto: `Na mensagem, Área − Realizado = ${ha(r2(o.area - o.realizado))}, mas o Resta é ${ha(o.resta)}.` });
    }

    // bloqueios
    if (areaDia < -0.004) {
      msgs.push({
        nivel: "erro",
        texto: `O Realizado (${ha(o.realizado)}) é menor que o já lançado até ${br(addDays(dt, -1))} (${ha(linha.colhidoAnterior)}). Para diminuir, corrija os lançamentos no histórico.`,
      });
      continue;
    }
    // em centésimos e sem folga, como no lançamento manual (o que passa não teria talhão onde entrar)
    const cent = (n) => Math.round(n * 100);
    if (cent(o.realizado) > cent(linha.areaSistema)) {
      msgs.push({ nivel: "erro", texto: `O Realizado (${ha(o.realizado)}) passa da área da ordem no sistema (${ha(linha.areaSistema)}).` });
      continue;
    }
    if (cent(areaDia) > cent(linha.cabe)) {
      msgs.push({ nivel: "erro", texto: `A área do dia (${ha(areaDia)}) passa do que ainda falta colher nos talhões (${ha(linha.cabe)}).` });
      continue;
    }
    // o Realizado é acumulado: com lançamento depois da data, lançar área nova nela contaria a mesma área duas vezes
    if (linha.posterior > 0) {
      if (Math.abs(areaDia - linha.jaNoDia) >= 0.005) {
        msgs.push({
          nivel: "erro",
          texto: `Já há ${ha(linha.posterior)} lançados depois de ${br(dt)}: como o Realizado é acumulado, lançar nesta data somaria a área em dobro. Lance as mensagens na ordem das datas ou acerte pelo lançamento manual e pelo histórico.`,
        });
        continue;
      }
      msgs.push({ nivel: "info", texto: `Já há ${ha(linha.posterior)} lançados depois de ${br(dt)}.` });
    }

    const bolExistente = bolDoDia.get(ord.num) ?? null;
    if (Math.abs(areaDia - linha.jaNoDia) < 0.005) {
      linha.situacao = "igual";
      linha.boletim = bolExistente;
      msgs.push({
        nivel: "info",
        texto: linha.jaNoDia > 0 ? `Já lançado em ${br(dt)} com o mesmo total${bolExistente ? ` (boletim nº ${bolExistente})` : ""}.` : "Sem área nova desde o último lançamento.",
      });
    } else {
      linha.situacao = "lancar";
      if (linha.jaNoDia > 0) {
        msgs.push({
          nivel: "aviso",
          texto: `Já havia ${ha(linha.jaNoDia)} lançados em ${br(dt)}${bolExistente ? ` (boletim nº ${bolExistente})` : ""}: passam a ser ${ha(areaDia)}.`,
        });
      }
      if (bolExistente) linha.boletim = bolExistente;
      else if (areaDia > 0) {
        linha.boletim = proximoBoletim++;
        linha.boletimNovo = true;
      }
    }
    const rateio = areaDia > 0 ? ratearArea(areaDia, itens) : {};
    linha.talhoes = itens.map((i) => ({
      faz: i.t.faz_cod,
      tlh: i.t.tlh,
      areaHa: i.t.area_ha,
      anterior: r2(i.t.area_col_ha + i.t.antes),
      diaAtual: r2(i.t.dia),
      dia: rateio[i.chave] ?? 0,
    }));
  }

  // ordens abertas do sistema que não vieram na mensagem
  const abertas = (await pool.query("SELECT num, frt FROM ord WHERE sts = 'Aberta' ORDER BY frt, num")).rows;
  const naMensagem = new Set(numeros);
  resposta.foraDaMensagem = abertas.filter((r) => !naMensagem.has(semZeros(r.num))).map((r) => ({ numero: r.num, frente: r.frt }));
  return resposta;
}

/**
 * Lança a área colhida das ordens escolhidas (só as que a conferência deixa lançar), refazendo a conferência no servidor:
 * um boletim por ordem, o rateio da conferência e o mesmo controle do lançamento manual (o acumulado não passa da área
 * do talhão). Cada ordem é gravada à parte: a que der erro não impede as outras.
 */
export async function lancarPlanejamento(texto, dtEscolhida, base, escolhidas, usuario) {
  const conf = await conferirPlanejamento(texto, dtEscolhida, base);
  if (conf.erro) return conf;
  const querem = new Set((escolhidas ?? []).map(semZeros));
  const resultados = [];
  for (const l of conf.linhas) {
    if (!querem.has(semZeros(l.numero))) continue;
    if (l.situacao !== "lancar") {
      resultados.push({ numero: l.numero, ok: false, texto: l.situacao === "igual" ? "Nada a lançar (já está igual)." : "Bloqueada na conferência." });
      continue;
    }
    try {
      const r = await gravarAreaColhidaDia(
        l.numero,
        conf.dt,
        l.talhoes.map((t) => ({ faz: t.faz, tlh: t.tlh, ha: t.dia })),
        usuario,
        l.boletim ?? undefined,
      );
      if ("erro" in r) resultados.push({ numero: l.numero, ok: false, texto: r.erro });
      else resultados.push({ numero: l.numero, ok: true, boletim: l.boletim, areaDia: l.areaDia, texto: `${ha(l.areaDia)} em ${l.talhoes.filter((t) => t.dia > 0).length} talhão(ões)` });
    } catch (e) {
      resultados.push({ numero: l.numero, ok: false, texto: e instanceof Error ? e.message : String(e) });
    }
  }
  const lancadas = resultados.filter((r) => r.ok);
  if (lancadas.length > 0) {
    await auditar(getPool(), {
      usuario,
      modulo: "Colheita",
      entidade: "Área colhida",
      chave: `Mensagem do WhatsApp${conf.data ? ` de ${br(conf.data)}` : ""} · lançada em ${br(conf.dt)}`,
      acao: "importacao",
      depois: {
        dataMensagem: conf.data,
        dataLancamento: conf.dt,
        rateio: base === "area" ? "pela área do talhão" : "pelo saldo do talhão",
        ordens: lancadas.map((r) => ({ ordem: r.numero, boletim: r.boletim, ha: r.areaDia })),
      },
    });
  }
  return { ...conf, resultados };
}
