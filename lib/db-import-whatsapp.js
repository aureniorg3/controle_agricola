import { ratearArea } from "./atividades";
import { auditar } from "./auditar";
import { getPool } from "./db";
import { BOT_WHATSAPP, consultarOS, prepararAtividades } from "./db-atividades";
import { nomeOperacao, operacoesDoCadastro } from "./db-operacoes";
import { talhoesDaFazenda } from "./db-rodadas";
import { fmtArea, listaDeBoletins, marcaDoSistema } from "./lancamento-mobile";
import { normFaz, normTlh } from "./ocupacao";

import semente from "./apontamentos-whatsapp-seed.json";

/** De-para "categoria da mensagem → operação" gravado pelas importações da conversa feitas antes (só leitura). */
const CHAVE_DEPARA = "imp_whatsapp_ops";
async function lerDePara(exec) {
  return (await exec.query("SELECT valor FROM app_param WHERE chave = $1", [CHAVE_DEPARA])).rows[0]?.valor ?? {};
}

/** Operação de cada apontamento lido: a escrita na mensagem, senão a da O.S. (se tiver uma só), senão a do de-para. */
async function resolverOperacoes(pool, itens, dePara) {
  const cadOps = await operacoesDoCadastro(pool);
  const daOS = new Map();
  const res = [];
  for (const a of itens) {
    if (a.opCod) {
      res.push({ cod: a.opCod, ds: nomeOperacao(cadOps, a.opCod, a.atividade), origem: "mensagem" });
      continue;
    }
    if (a.os.length === 1) {
      if (!daOS.has(a.os[0])) {
        const c = await consultarOS(a.os[0]).catch(() => null);
        daOS.set(a.os[0], c && c.operacoes.length === 1 ? { cod: c.operacoes[0].cod, ds: c.operacoes[0].ds } : null);
      }
      const o = daOS.get(a.os[0]);
      if (o) {
        res.push({ ...o, origem: "os" });
        continue;
      }
    }
    const d = dePara[a.categoria];
    if (d?.cod) res.push({ cod: d.cod, ds: nomeOperacao(cadOps, d.cod, d.ds), origem: "depara" });
    else res.push({ cod: "", ds: a.categoria, origem: "" });
  }
  return res;
}

/** Fazendas do Cadastro de Fazenda pelo código base (9442 e 9442-1 → 9442). */
async function fazendasCadastro(exec) {
  const { rows } = await exec.query("SELECT cod, nm FROM cad_itm WHERE cad = 'fazendas' ORDER BY cod");
  const m = new Map();
  for (const r of rows) {
    const base = r.cod.split("-")[0].trim();
    if (!m.has(base)) m.set(base, r.nm);
  }
  return m;
}

const r2 = (n) => Math.round(n * 100) / 100;

/** Usuário dos apontamentos da carga inicial da conversa (importarWhatsapp): o bot regrava e apaga só estes e os dele. */
const USUARIO_CARGA = "Carga inicial";

/**
 * Grava um apontamento lido (sem boletim; a origem e o texto da mensagem ficam guardados).
 * Com `idExistente` (mensagem editada no grupo, vinda do bot) regrava o mesmo apontamento, só se ninguém o conferiu nem
 * alterou; senão devolve null e ele fica como a pessoa deixou (talhões também).
 */
async function gravarItem(client, a, op, faz, usuario, idExistente) {
  // sem zeros à esquerda, como a base de O.S. (a O.S. que ainda não está na base casa com ela quando for importada)
  const os = a.os.length === 1 ? String(a.os[0]).trim().replace(/^0+(?=\d)/, "") : "";
  const obs = [
    `WhatsApp ${a.grupo || "C.A.P.F.O"} · ${a.remetente} · mensagem de ${a.msgEm.slice(8, 10)}/${a.msgEm.slice(5, 7)} ${a.msgEm.slice(11)}`,
    a.equipe,
    a.atividade && a.atividade !== op.ds ? a.atividade : "",
    a.os.length > 1 ? `O.S. ${a.os.join(", ")}` : "",
    a.statusOs ? `Status da O.S.: ${a.statusOs}` : "",
    a.observacao ?? "",
    ...a.avisos,
  ]
    .filter(Boolean)
    .join(" · ")
    .slice(0, 1500);
  // solicitante, etapa (só a descrição: o código fica para quem conferir), tipo de aplicação e vazão
  // recomendada vêm só do bot; a carga inicial não tem
  // apontador / informante: quem mandou a mensagem no grupo
  const valores = [a.dt, os, op.cod, op.ds, (a.solicitante ?? "").slice(0, 120), (a.etapa ?? "").slice(0, 120), (a.tipoAplicacao ?? "").slice(0, 120),
    a.nEqp, a.nPes, obs, a.frota, a.vazaoRec ?? null, a.vazao, a.calda, usuario, a.chave, a.texto.slice(0, 8000), (a.remetente ?? "").slice(0, 80)];
  let id = idExistente;
  if (id) {
    // conferido ou alterado por uma pessoa depois de lido (a mesma regra de sincronizarDoBot): não regrava; e só o que o
    // bot (ou a carga inicial) lançou — nunca um apontamento lançado por uma pessoa
    const r = await client.query(
      `UPDATE ap_dia SET dt=$1, os=$2, op_cod=$3, op_ds=$4, solic=$5, etapa_ds=$6, tipo_apl=$7, n_eqp=$8, n_pes=$9, obs=$10, eqp=$11,
              vazao_rec=$12, vazao_uti=$13, vol_calda=$14, atu_usr=$15, atu_em=now(), orig_chave=$16, orig_msg=$17, apont=$18
        WHERE id=$19 AND conf_em IS NULL AND COALESCE(atu_usr, '') IN ('', $20) AND usr IN ($20, $21)`,
      [...valores, id, BOT_WHATSAPP, USUARIO_CARGA],
    );
    if (!r.rowCount) return null;
    await client.query("DELETE FROM ap_dia_tlh WHERE ap_id = $1", [id]);
  } else {
    const { rows } = await client.query(
      `INSERT INTO ap_dia (bol, dt, os, op_cod, op_ds, solic, etapa_cod, etapa_ds, tipo_apl, n_eqp, n_pes, obs, area_modo, eqp, vazao_rec, vazao_uti, vol_calda, usr,
                           orig, orig_chave, orig_msg, apont)
       VALUES (NULL, $1, $2, $3, $4, $5, '', $6, $7, $8, $9, $10, 'talhao', $11, $12, $13, $14, $15, 'whatsapp', $16, $17, $18)
       RETURNING id`,
      valores,
    );
    id = rows[0].id;
  }
  // talhões já encaixados na O.S. (bot: encaixarNaOS) entram como estão
  if (a.linhas) {
    for (const t of a.linhas)
      await client.query("INSERT INTO ap_dia_tlh (ap_id, prop_cod, prop_nm, tlh, area_tlh, area) VALUES ($1, $2, $3, $4, $5, $6)", [
        id,
        t.propCod,
        t.propNm || faz.get(normFaz(t.propCod)) || "",
        t.tlh,
        t.areaTlh ?? null,
        r2(t.area),
      ]);
    return id;
  }
  // talhão como está no cadastro da fazenda ("1" = "01"); repetido na mensagem entra uma vez
  const vistos = new Set();
  for (const f of [...new Set(a.talhoes.map((t) => t.faz))]) {
    const cadastro = await talhoesDaFazenda(f);
    for (const t of a.talhoes.filter((x) => x.faz === f)) {
      const doCad = t.tlh ? cadastro.find((c) => c.tlh.replace(/^0+(?=\d)/, "") === t.tlh.replace(/^0+(?=\d)/, "")) : undefined;
      const tlh = doCad?.tlh ?? t.tlh;
      const k = `${f}|${tlh}`;
      if (vistos.has(k)) {
        // área sem talhão (carreador + total) soma; talhão repetido já foi tratado na leitura
        if (!tlh) await client.query("UPDATE ap_dia_tlh SET area = area + $3 WHERE ap_id = $1 AND prop_cod = $2 AND tlh = ''", [id, f, r2(t.area)]);
        continue;
      }
      vistos.add(k);
      await client.query("INSERT INTO ap_dia_tlh (ap_id, prop_cod, prop_nm, tlh, area_tlh, area) VALUES ($1, $2, $3, $4, $5, $6)", [
        id,
        f,
        faz.get(f) ?? "",
        tlh,
        doCad?.area ?? null,
        r2(t.area),
      ]);
    }
  }
  return id;
}

/** Grava os apontamentos da carga inicial: os já importados (mesma mensagem) ficam de fora. */
async function importarWhatsapp(itens, usuario, marca) {
  const pool = getPool();
  await prepararAtividades(pool);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('ap_dia_import_whatsapp'))");
    const ops = await resolverOperacoes(pool, itens, await lerDePara(client));
    const faz = await fazendasCadastro(client);
    // já importados, ou excluídos por uma pessoa depois de importados
    const existentes = new Set(
      (
        await client.query(
          "SELECT orig_chave AS c FROM ap_dia WHERE orig_chave = ANY($1::text[]) UNION SELECT orig_chave FROM ap_dia_exc WHERE orig_chave = ANY($1::text[])",
          [itens.map((i) => i.chave)],
        )
      ).rows.map((r) => r.c),
    );
    let novos = 0;
    let area = 0;
    for (const [k, a] of itens.entries()) {
      if (existentes.has(a.chave)) continue;
      await gravarItem(client, a, ops[k], faz, usuario);
      novos++;
      area += a.area;
    }
    await auditar(client, {
      usuario,
      modulo: "Atividades",
      entidade: "Apontamento diário",
      chave: marca,
      acao: "importacao",
      depois: {
        novos,
        jaImportados: itens.length - novos,
        area: r2(area),
        periodo: itens.length
          ? `${[...itens].map((i) => i.dt).sort()[0]} a ${[...itens]
              .map((i) => i.dt)
              .sort()
              .pop()}`
          : undefined,
      },
    });
    await client.query("COMMIT");
    return { novos, jaImportados: itens.length - novos, area: r2(area) };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Mensagens de produção lidas pelo bot do WhatsApp (o app de disponibilidade da frota manda; ver
 * app/api/integracao/whatsapp). Tudo entra, como no app de lá: nova → apontamento com o próximo nº de
 * boletim; editada no grupo → regrava o mesmo (mesmo boletim); apagada no grupo (ou que deixou de ser
 * relatório) → sai. Apontamento que alguém alterou ou conferiu aqui (atu_usr de uma pessoa, conf_em) não é mais
 * mexido pelo bot; o que alguém excluiu (ap_dia_exc) não volta.
 */
const BOT = BOT_WHATSAPP;

/**
 * Relatório com uma O.S. que está na base: a operação e os talhões passam a ser os da O.S. (mesmas chaves que o
 * formulário usa, então a área aparece em cada talhão e conta no "Já apontado"). Talhão da mensagem casa pelo
 * número ("01" = "1"); a área de uma fazenda sem talhões na mensagem (só o total) é rateada entre os talhões da
 * O.S. naquela fazenda que a mensagem não citou, pela área recomendada (senão a do talhão), como o rateio do
 * lançamento. Talhão fora da O.S. fica como veio, com aviso. null: sem O.S. na base (segue como antes); sem `op`: a
 * O.S. está na base, mas a operação da mensagem não encaixa (valem só o código e o responsável da O.S.).
 */
async function encaixarNaOS(a, op) {
  if (a.os.length !== 1) return null;
  const info = await consultarOS(a.os[0], undefined, a.dt).catch(() => null);
  if (!info) return null;
  const n = (c) => String(c ?? "").trim().replace(/^0+(?=\d)/, "");
  const avisos = [];
  let o = op.cod ? info.operacoes.find((x) => n(x.cod) === n(op.cod)) : undefined;
  if (!o && info.operacoes.length === 1) {
    o = info.operacoes[0];
    if (op.cod) avisos.push(`Operação ${op.cod} da mensagem não está na O.S. ${info.os}; usada a ${o.cod} da O.S.`);
  }
  if (!o) return { os: info.os, resp: info.resp ?? "" };
  const linhas = [];
  const somar = (x, area) => {
    const l = linhas.find((y) => y.propCod === x.propCod && y.tlh === x.tlh);
    if (l) l.area += area;
    else linhas.push({ propCod: x.propCod, propNm: x.propNm, tlh: x.tlh, areaTlh: x.areaTlh ?? null, area });
  };
  for (const f of [...new Set(a.talhoes.map((t) => t.faz))]) {
    const daOS = o.talhoes.filter((t) => normFaz(t.propCod) === normFaz(f));
    const citados = new Set();
    let semTalhao = 0;
    for (const t of a.talhoes.filter((x) => x.faz === f)) {
      if (!t.tlh) {
        semTalhao += t.area;
        continue;
      }
      const x = daOS.find((y) => normTlh(y.tlh) === normTlh(t.tlh));
      if (x) {
        somar(x, t.area);
        citados.add(x.tlh);
      } else {
        somar({ propCod: f, propNm: daOS[0]?.propNm ?? "", tlh: normTlh(t.tlh) }, t.area);
        if (daOS.length) avisos.push(`Talhão ${f}-${t.tlh} não está na O.S. ${info.os}.`);
      }
    }
    if (semTalhao > 0) {
      const resto = daOS.filter((y) => !citados.has(y.tlh));
      if (resto.length) ratearArea(semTalhao, resto.map((y) => y.areaRec ?? y.areaTlh)).forEach((ar, i) => ar > 0 && somar(resto[i], ar));
      else somar({ propCod: f, propNm: "", tlh: "" }, semTalhao);
    }
  }
  return { os: info.os, op: { cod: o.cod, ds: o.ds }, linhas, avisos, resp: info.resp ?? "" };
}

/** Boletim do Lançamento Mobile pelo nº da marca, com a área total e as fazendas (para conferir com a mensagem). */
const SQL_BOLETIM_DA_MARCA = `
  SELECT a.id, a.bol, a.dt::text AS dt, a.os, a.op_cod,
         (SELECT COALESCE(SUM(t.area), 0) FROM ap_dia_tlh t WHERE t.ap_id = a.id)::float AS area,
         (SELECT array_agg(DISTINCT t.prop_cod) FROM ap_dia_tlh t WHERE t.ap_id = a.id) AS fazendas
    FROM ap_dia a WHERE a.bol = $1 AND a.orig = 'mobile'`;

/**
 * O que não confere entre a mensagem com a marca e o boletim do Lançamento Mobile (vazio = é o texto dele): a data e,
 * quando a mensagem traz, a O.S. (alguma delas), a operação, as fazendas e a área total (até 0,05 ha de diferença).
 * Mensagem copiada como modelo para outro serviço, mantendo a marca, não confere e vira apontamento, com aviso.
 */
function divergenciasDaMarca(a, lanc) {
  const n = (c) => String(c ?? "").trim().replace(/^0+(?=\d)/, "");
  const dif = [];
  if (lanc.dt !== a.dt) dif.push(`data ${lanc.dt.split("-").reverse().join("/")}`);
  if (a.os.length && !a.os.some((o) => n(o) === n(lanc.os))) dif.push(`O.S. ${lanc.os || "sem O.S."}`);
  if (a.opCod && n(a.opCod) !== n(lanc.op_cod)) dif.push(`operação ${lanc.op_cod}`);
  if (a.talhoes.length) {
    const fazendas = lanc.fazendas ?? [];
    if (a.talhoes.some((t) => !fazendas.some((f) => normFaz(f) === normFaz(t.faz)))) dif.push(`fazendas ${fazendas.join(", ")}`);
    if (Math.abs(a.talhoes.reduce((s, t) => s + t.area, 0) - lanc.area) > 0.05) dif.push(`${fmtArea(r2(lanc.area))} ha`);
  }
  return dif;
}

/**
 * Apontamentos do Lançamento Mobile com os nºs da marca de vários boletins e os outros do mesmo lançamento (lanc_grp),
 * na ordem dos boletins, com a área total, as fazendas e os talhões de cada um.
 */
const SQL_BOLETINS_DA_MARCA = `
  SELECT a.id, a.bol, a.dt::text AS dt, a.os, a.op_cod, a.lanc_grp,
         (SELECT COALESCE(SUM(t.area), 0) FROM ap_dia_tlh t WHERE t.ap_id = a.id)::float AS area,
         (SELECT array_agg(DISTINCT t.prop_cod) FROM ap_dia_tlh t WHERE t.ap_id = a.id) AS fazendas,
         (SELECT json_agg(json_build_object('faz', t.prop_cod, 'tlh', t.tlh, 'area', t.area::float)) FROM ap_dia_tlh t WHERE t.ap_id = a.id) AS talhoes
    FROM ap_dia a
   WHERE a.orig = 'mobile'
     AND (a.bol = ANY($1::int[])
          OR a.lanc_grp IN (SELECT g.lanc_grp FROM ap_dia g WHERE g.bol = ANY($1::int[]) AND g.orig = 'mobile' AND g.lanc_grp IS NOT NULL))
   ORDER BY a.bol NULLS LAST, a.id`;

/**
 * Soma das áreas dos talhões do lançamento com o mesmo talhão e a mesma área, repetido entre as O.S./operações dele,
 * contado uma vez — como o leitor do bot deixa a mensagem ("Talhão … repetido na mensagem com a mesma área: entrou uma
 * vez"). `semTalhao`: a área da fazenda sem talhão ("Área = …") repetida também conta uma vez.
 */
function somaSemRepetidos(talhoes, semTalhao) {
  const vistos = new Set();
  let soma = 0;
  for (const t of talhoes) {
    const k = `${normFaz(t.faz)}|${normTlh(t.tlh)}|${r2(t.area)}`;
    if ((normTlh(t.tlh) || semTalhao) && vistos.has(k)) continue;
    vistos.add(k);
    soma += t.area;
  }
  return soma;
}

/**
 * O que não confere entre a mensagem com a marca de vários boletins ("Boletins nº 160 e 161") e o lançamento com
 * várias O.S. (vazio = é o texto dele): os boletins da marca todos lançados e no mesmo lançamento, a mesma data em
 * todos, a O.S. da mensagem (alguma delas, como na marca de um boletim: o leitor pode tirar um nº a mais das linhas
 * "O.S. 6052 · …") entre as do lançamento e, quando a mensagem traz talhões, as fazendas entre as dele e a área total
 * igual à soma dos apontamentos (até 0,05 ha de diferença) — ou à soma com o mesmo talhão e a mesma área de duas
 * O.S./operações contado uma vez, que é como o leitor lê o texto. O lançamento editado depois (O.S. a mais ou a menos)
 * não confere com a mensagem antiga.
 */
function divergenciasDoLancamento(a, grupo, marca) {
  const n = (c) => String(c ?? "").trim().replace(/^0+(?=\d)/, "");
  const dif = [];
  const faltam = marca.filter((b) => !grupo.some((g) => g.bol === b));
  if (faltam.length) dif.push(`boletim nº ${listaDeBoletins(faltam)} não lançado pelo Lançamento Mobile`);
  if (new Set(grupo.map((g) => g.lanc_grp ?? `#${g.id}`)).size > 1) dif.push("boletins de lançamentos diferentes");
  const datas = [...new Set(grupo.map((g) => g.dt))].sort();
  if (datas.length !== 1 || datas[0] !== a.dt) dif.push(`data ${datas.map((d) => d.split("-").reverse().join("/")).join(", ")}`);
  const oss = [...new Set(grupo.map((g) => g.os))];
  if (a.os.length && !a.os.some((o) => oss.some((x) => n(x) === n(o)))) dif.push(`O.S. ${oss.join(", ") || "sem O.S."}`);
  if (a.talhoes.length) {
    const fazendas = [...new Set(grupo.flatMap((g) => g.fazendas ?? []))];
    if (a.talhoes.some((t) => !fazendas.some((f) => normFaz(f) === normFaz(t.faz)))) dif.push(`fazendas ${fazendas.join(", ")}`);
    const area = grupo.reduce((s, g) => s + g.area, 0);
    const talhoes = grupo.flatMap((g) => g.talhoes ?? []);
    const lida = a.talhoes.reduce((s, t) => s + t.area, 0);
    if (![area, somaSemRepetidos(talhoes, false), somaSemRepetidos(talhoes, true)].some((x) => Math.abs(lida - x) <= 0.05)) dif.push(`${fmtArea(r2(area))} ha`);
  }
  return dif;
}

export async function sincronizarDoBot(itens) {
  const pool = getPool();
  await prepararAtividades(pool);
  const client = await pool.connect();
  const res = [];
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('ap_dia_import_whatsapp'))");
    const vivos = itens.filter((i) => !i.apagada);
    const ops = await resolverOperacoes(pool, vivos, await lerDePara(client));
    const faz = await fazendasCadastro(client);
    // travados até o fim: a conferência ou a edição de uma pessoa que chegar no meio espera o bot (e a conferência vê que
    // o apontamento mudou desde a análise); a que chegou antes já está no que foi lido aqui
    const existentes = new Map(
      (
        await client.query("SELECT id, bol, atu_usr, conf_em, orig_chave AS c FROM ap_dia WHERE orig_chave = ANY($1::text[]) FOR UPDATE", [
          itens.map((i) => i.chave),
        ])
      ).rows.map((r) => [r.c, r]),
    );
    // mensagens cujo apontamento uma pessoa excluiu aqui: não voltam, mesmo editadas no grupo
    const excluidos = new Set(
      (await client.query("SELECT orig_chave AS c FROM ap_dia_exc WHERE orig_chave = ANY($1::text[])", [itens.map((i) => i.chave)])).rows.map((r) => r.c),
    );
    // mensagens com o texto do Lançamento Mobile já ligadas ao boletim lançado no sistema (ap_dia_msg)
    const ligadas = new Map(
      (await client.query("SELECT orig_chave AS c, ap_id, bol FROM ap_dia_msg WHERE orig_chave = ANY($1::text[])", [itens.map((i) => i.chave)])).rows.map(
        (r) => [r.c, r],
      ),
    );
    const cont = { novos: 0, atualizados: 0, removidos: 0, conferidos: 0, excluidos: 0 };
    for (const a of itens) {
      const lig = ligadas.get(a.chave);
      if (lig) {
        // já lançada pelo Lançamento Mobile: editada ou apagada no grupo, o boletim fica como está ("conferido" o app de
        // lá já conhece: não mexer)
        res.push({ chave: a.chave, id: lig.ap_id, bol: lig.bol, acao: "conferido" });
        cont.conferidos++;
        continue;
      }
      const ex = existentes.get(a.chave);
      if (!ex && excluidos.has(a.chave)) {
        res.push({ chave: a.chave, id: null, acao: "excluido" });
        cont.excluidos++;
      } else if (ex && (ex.conf_em || (ex.atu_usr && ex.atu_usr !== BOT))) {
        // conferido ou alterado por uma pessoa: fica como ela deixou
        res.push({ chave: a.chave, id: ex.id, acao: "conferido" });
        cont.conferidos++;
      } else if (a.apagada) {
        // só o que o bot (ou a carga inicial) lançou
        const del = ex
          ? await client.query("DELETE FROM ap_dia WHERE id = $1 AND conf_em IS NULL AND COALESCE(atu_usr, '') IN ('', $2) AND usr IN ($2, $3)", [
              ex.id,
              BOT,
              USUARIO_CARGA,
            ])
          : null;
        if (ex && !del.rowCount) {
          // conferido ou alterado por uma pessoa depois de lido: fica
          res.push({ chave: a.chave, id: ex.id, acao: "conferido" });
          cont.conferidos++;
          continue;
        }
        res.push({ chave: a.chave, id: null, acao: ex ? "removido" : "nada" });
        if (ex) cont.removidos++;
      } else {
        // texto gerado pelo Lançamento Mobile (marca "Boletim nº N · lançado no sistema" na última linha) que confere com o
        // boletim (data, O.S., operação, fazendas e área): ele já está lançado, então a mensagem fica ligada a ele e não
        // vira outro apontamento. Também na mensagem editada no grupo para o texto do boletim: o apontamento que o bot
        // lançou dela (e ninguém conferiu nem alterou) sai. A marca que não confere (outro serviço copiado do texto, outra
        // data, boletim que não é do Lançamento Mobile) segue como antes, com o aviso — também ao regravar a editada.
        // Lançamento com várias O.S. ("Boletins nº 160 e 161"): confere com o lançamento inteiro (data, O.S., fazendas e
        // área total) e a mensagem fica ligada ao primeiro boletim dele (ap_dia_msg tem uma linha por mensagem)
        const marca = marcaDoSistema(a.texto);
        let m = a;
        if (marca) {
          let lanc;
          let dif;
          if (marca.length === 1) {
            lanc = (await client.query(SQL_BOLETIM_DA_MARCA, [marca[0]])).rows[0];
            dif = lanc ? divergenciasDaMarca(a, lanc) : null;
          } else {
            const grupo = (await client.query(SQL_BOLETINS_DA_MARCA, [marca])).rows;
            lanc = grupo[0];
            dif = lanc ? divergenciasDoLancamento(a, grupo, marca) : null;
          }
          if (dif && dif.length === 0) {
            if (ex) {
              // só o que o bot (ou a carga inicial) lançou e ninguém conferiu nem alterou (a mesma regra da apagada)
              const del = await client.query(
                "DELETE FROM ap_dia WHERE id = $1 AND conf_em IS NULL AND COALESCE(atu_usr, '') IN ('', $2) AND usr IN ($2, $3)",
                [ex.id, BOT, USUARIO_CARGA],
              );
              if (!del.rowCount) {
                res.push({ chave: a.chave, id: ex.id, acao: "conferido" });
                cont.conferidos++;
                continue;
              }
              cont.removidos++;
            }
            await client.query("INSERT INTO ap_dia_msg (orig_chave, ap_id, bol, msg) VALUES ($1, $2, $3, $4) ON CONFLICT (orig_chave) DO NOTHING", [
              a.chave,
              lanc.id,
              lanc.bol,
              a.texto.slice(0, 8000),
            ]);
            // nova: "conferido" com o boletim (o app de lá já conhece: não mexer); editada: o apontamento dela foi removido
            res.push(ex ? { chave: a.chave, id: null, acao: "removido" } : { chave: a.chave, id: lanc.id, bol: lanc.bol, acao: "conferido" });
            cont.jaLancados = (cont.jaLancados ?? 0) + 1;
            continue;
          }
          const motivo = lanc
            ? `no sistema: ${dif.join(", ")}`
            : `nenhum boletim com ${marca.length > 1 ? "esses nºs" : "esse nº"} lançado pelo Lançamento Mobile`;
          // "Mensagem com a marca do boletim" abre o aviso nos dois formatos (a Conferência reconhece o aviso por ele)
          const nums = `${listaDeBoletins(marca)}${marca.length > 1 ? " (lançamento com várias O.S.)" : ""}`;
          m = { ...a, avisos: [...a.avisos, `Mensagem com a marca do boletim nº ${nums}, que não confere com o lançado no sistema (${motivo})`] };
        }
        let op = ops[vivos.indexOf(a)];
        const enc = await encaixarNaOS(m, op);
        // O.S. na base: gravada como está nela (sem zeros à esquerda) e, sem solicitante na mensagem, vale o responsável
        // da O.S. (como ao digitar a O.S. no lançamento), mesmo quando a operação não encaixa
        let item = enc ? { ...m, os: [enc.os], solicitante: m.solicitante || enc.resp } : m;
        if (enc?.op) {
          op = enc.op;
          item = { ...item, linhas: enc.linhas, avisos: [...m.avisos, ...enc.avisos] };
        }
        const id = await gravarItem(client, item, op, faz, BOT, ex?.id);
        if (!id) {
          // conferido ou alterado por uma pessoa depois de lido: fica como ela deixou
          res.push({ chave: a.chave, id: ex.id, acao: "conferido" });
          cont.conferidos++;
          continue;
        }
        // boletim: o próximo nº (como o sugerido no lançamento manual); editada mantém o que já tinha
        const bol = (
          await client.query("UPDATE ap_dia SET bol = COALESCE(bol, (SELECT COALESCE(MAX(bol), 0) + 1 FROM ap_dia)) WHERE id = $1 RETURNING bol", [id])
        ).rows[0].bol;
        res.push({ chave: a.chave, id, bol, acao: ex ? "atualizado" : "novo" });
        cont[ex ? "atualizados" : "novos"]++;
      }
    }
    // jaLancados: mensagens com o texto do Lançamento Mobile ligadas ao boletim (só entra no log quando houve)
    if (cont.novos || cont.atualizados || cont.removidos || cont.jaLancados)
      await auditar(client, { usuario: BOT, modulo: "Atividades", entidade: "Apontamento diário", chave: "WhatsApp (bot)", acao: "importacao", depois: cont });
    await client.query("COMMIT");
    return res;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

const MARCA_CARGA ="Carga inicial · WhatsApp C.A.P.F.O desde 01/10/2026";
let carga = null;

/** Primeira carga (uma vez): apontamentos da conversa do grupo C.A.P.F.O com operação a partir de 01/10/2026. */
export async function carregarApontamentosWhatsappIniciais() {
  if (!carga) {
    carga = (async () => {
      const pool = getPool();
      await prepararAtividades(pool);
      const feita =
        ((await pool.query("SELECT 1 FROM aud_log WHERE modulo = 'Atividades' AND entidade = 'Apontamento diário' AND chave = $1 LIMIT 1", [MARCA_CARGA]))
          .rowCount ?? 0) > 0;
      if (feita) return;
      await importarWhatsapp(semente, USUARIO_CARGA, MARCA_CARGA);
    })().catch((err) => {
      carga = null;
      console.error("Carga inicial dos apontamentos do WhatsApp não concluída:", err);
    });
  }
  await carga;
}
