import { auditar, dataBR } from "./auditar";
import { chaveTalhao, ratearArea, round2 } from "./atividades";
import { getPool } from "./db";
import {
  apontamentosAConferir,
  BOT_WHATSAPP,
  chaveLog,
  consultarOS,
  obterApontamento,
  operacoesDaOS,
  prepararAtividades,
  regrasApontamento,
  versaoApontamentoSQL,
} from "./db-atividades";
import { nomeOperacao, operacoesDoCadastro } from "./db-operacoes";
import { prepararOSAgr } from "./db-os-agr";
import { areasDaBase, safraDaArea } from "./db-talhoes";
import { normFaz, normTlh } from "./ocupacao";
import { POSICOES } from "./os-agr";

/**
 * Conferência dos apontamentos lançados pelo bot do WhatsApp: a O.S., a operação, as fazendas, os talhões e as áreas
 * são comparados com as O.S. em aberto na data do apontamento. Quando não bate (ou não há O.S.), procura as O.S. em
 * aberto que têm as fazendas e os talhões apontados, para quem confere escolher.
 */

const ha = (n) => `${(n ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ha`;
const semZeros = (c) =>
  String(c ?? "")
    .trim()
    .replace(/^0+(?=\d)/, "");
/** fazenda sem a sequência e sem zeros à esquerda, no SQL (o mesmo que normFaz) */
const FAZ_SQL = (col) => `regexp_replace(btrim(split_part(btrim(${col}), '-', 1)), '^0+(?=[0-9])', '')`;
/** área acima do saldo ou do talhão só conta acima desta folga (arredondamento) */
const FOLGA = 0.001;
const ORDEM_NIVEL = { erro: 0, alerta: 1, info: 2 };
/** divergências que fazem procurar outra O.S. em aberto (O.S., operação, fazenda ou talhão) */
const PROCURAR_OS = new Set([
  "sem-os",
  "varias-os",
  "os-fora-base",
  "os-codigo",
  "os-antes-emissao",
  "os-encerrada",
  "sem-operacao",
  "operacao-fora",
  "operacao-codigo",
  "fazenda-fora",
  "talhao-fora",
  "talhao-codigo",
  "sem-talhao",
]);
const PROBLEMA = {
  "fazenda-fora": "Fazenda fora da O.S.",
  "sem-talhao": "Sem talhão",
  "talhao-fora": "Talhão fora da O.S.",
  "talhao-codigo": "Código diferente do da O.S.",
  "acima-saldo": "Acima do saldo",
  "acima-talhao": "Acima da área do talhão",
};
const nomeTalhao = (t) => (String(t.tlh ?? "").trim() ? `${t.propCod}-${t.tlh}` : `${t.propCod} (sem talhão)`);
const unicos = (lista) => [...new Set(lista)];

// ---------------------------------------------------------------------------
// O que o bot anotou na observação
// ---------------------------------------------------------------------------

/** O.S. citadas na mensagem: a do apontamento e as que o bot anotou ("O.S. a, b"; "Mais de uma O.S. na mensagem (…)"). */
function osCitadas(a) {
  const s = new Set();
  if (a.os) s.add(semZeros(a.os));
  for (const parte of String(a.obs ?? "").split(" · ")) {
    const m = parte.trim().match(/^O\.S\. ([\d,\s]+)$/) ?? parte.match(/Mais de uma O\.S\. na mensagem \(([\d,\s]+)\)/);
    if (m) for (const n of m[1].split(",")) if (n.trim()) s.add(semZeros(n));
  }
  return [...s];
}

/** Fazendas citadas na mensagem sem área própria (o bot lançou o total numa só): entram na procura de O.S. */
function fazendasCitadas(obs) {
  const s = new Set();
  for (const re of [/Área total de \d+ fazendas \(([\d,\s-]+)\)/g, /Fazendas sem área \(([\d,\s-]+)\)/g, /Fazenda\(s\) citada\(s\) sem área: ([\d,\s-]+)/g]) {
    for (const m of String(obs ?? "").matchAll(re)) for (const f of m[1].split(",")) if (normFaz(f)) s.add(normFaz(f));
  }
  return [...s];
}

/** Avisos da leitura da mensagem (os de O.S. e talhão a conferência refaz com os dados de agora). */
const AVISO_BOT = /^(Fazendas sem área|Fazenda\(s\) citada\(s\) sem área|Sem data no texto|Talhão .+ repetido|Área total de|Total escrito|Operação .+ da mensagem não está|Mensagem com a marca do boletim)/;
const avisosDoBot = (obs) =>
  String(obs ?? "")
    .split(" · ")
    .map((p) => p.trim())
    .filter((p) => AVISO_BOT.test(p));

// ---------------------------------------------------------------------------
// Situação da O.S. na data do serviço
// ---------------------------------------------------------------------------

/**
 * Situação da O.S. (ou de uma operação dela) para um serviço da data `dt`: aberta se alguma linha não está encerrada;
 * serviço antes da emissão; encerrada antes do serviço; ou encerrada depois dele (ainda valia na data).
 */
function situacaoOS(rows, dt) {
  const datas = (k) =>
    rows
      .map((r) => r[k])
      .filter(Boolean)
      .sort();
  const dtOs = datas("dt_os")[0] ?? null;
  const dtEnc = datas("dt_enc").pop() ?? null;
  const prevFim = datas("prev_fim").pop() ?? null;
  const abertas = rows.filter((r) => r.aberta);
  const nomes = abertas.map((r) => (r.base === "agr" ? (POSICOES[r.pos] ?? "Em aberto") : r.pos || "Em aberto"));
  const posicao = nomes.includes("Aberta") ? "Aberta" : (nomes[0] ?? "Em aberto");
  let cod;
  if (dtOs && dt < dtOs) cod = "antes";
  else if (abertas.length > 0 || rows.length === 0) cod = "aberta";
  else if (dtEnc && dtEnc >= dt) cod = "encerrada-depois";
  else cod = "encerrada";
  const rotulo = {
    antes: `Emitida em ${dataBR(dtOs)}, depois do serviço`,
    aberta: posicao,
    "encerrada-depois": `Encerrada em ${dataBR(dtEnc)}, depois do serviço`,
    encerrada: dtEnc ? `Encerrada em ${dataBR(dtEnc)}` : "Encerrada",
  }[cod];
  return { cod, rotulo, dtOs, dtEnc, prevFim };
}

/** Posição de cada O.S. × operação nas duas bases (a antiga só para a O.S. que não está na de Ordem de Serviço Agr.). */
const SQL_SITUACAO = `
  SELECT os, op_cod, bool_or(posicao <> 'E') AS aberta, MIN(posicao) FILTER (WHERE posicao <> 'E') AS pos,
         MIN(dt_os)::text AS dt_os, MAX(dt_enc)::text AS dt_enc, MAX(prev_fim)::text AS prev_fim, 'agr' AS base
    FROM os_agr WHERE os = ANY($1::text[]) GROUP BY os, op_cod
  UNION ALL
  SELECT os, op_cod, bool_or(sts !~* 'encerr'), MAX(sts) FILTER (WHERE sts !~* 'encerr'), MIN(dt_lanc)::text, NULL, NULL, 'antiga'
    FROM os_tlh o WHERE os = ANY($1::text[]) AND NOT EXISTS (SELECT 1 FROM os_agr x WHERE x.os = o.os)
   GROUP BY os, op_cod`;

// ---------------------------------------------------------------------------
// Análise de um apontamento
// ---------------------------------------------------------------------------

/** Linhas das O.S. (as colunas que consultarOS lê): as da base de Ordem de Serviço Agr. e, da O.S. que não está nela, as da antiga. */
const SQL_LINHAS_OS = `
  SELECT * FROM (
    SELECT os, prop_cod, prop_nm, tlh || letra AS tlh, area_plant::float AS area_tlh, area_rec::float AS area_rec, op_cod, op_ds,
           etapa_cod, etapa_ds, '' AS tipo_cod, '' AS tipo_ds, safra
      FROM os_agr WHERE os = ANY($1::text[])
    UNION ALL
    SELECT os, prop_cod, prop_nm, tlh, area_tlh::float, area_rec::float, op_cod, op_ds, etapa_cod, etapa_ds, tipo_cod, tipo_ds, safra
      FROM os_tlh o WHERE os = ANY($1::text[]) AND NOT EXISTS (SELECT 1 FROM os_agr x WHERE x.os = o.os)
  ) x
  ORDER BY os, op_cod, prop_cod, CASE WHEN tlh ~ '^[0-9]+$' THEN lpad(tlh, 8, '0') ELSE tlh END`;

/**
 * O que as análises usam, carregado uma vez. Um apontamento só (`unico`): a O.S. dele pelo consultarOS, já sem a área
 * dele no "já apontado". Vários (selo da lista): as O.S. de todos em consultas agregadas, não uma consulta por O.S. e
 * data; o "já apontado" soma todos, e a análise tira a área de cada apontamento.
 */
async function contexto(pool, aps, unico = false) {
  // safra da base Fazenda e Talhões de cada data (a área do talhão é a dela)
  const datas = unicos(aps.map((a) => a.dt));
  const safraDe = new Map();
  for (const dt of datas) safraDe.set(dt, await safraDaArea(dt, pool));
  const oss = unicos(aps.filter((a) => a.os).map((a) => semZeros(a.os)));
  const linhasOS = new Map();
  const feitos = new Map();
  if (!unico && oss.length) {
    for (const r of (await pool.query(SQL_LINHAS_OS, [oss])).rows) {
      if (!linhasOS.has(r.os)) linhasOS.set(r.os, []);
      linhasOS.get(r.os).push(r);
    }
    for (const r of (await pool.query(SQL_FEITOS, [oss, null])).rows) {
      if (!feitos.has(r.os)) feitos.set(r.os, {});
      (feitos.get(r.os)[r.op_cod] ??= {})[chaveTalhao(r.prop_cod, r.tlh)] = round2(r.area);
    }
  }
  // área dos talhões (os apontados e os das O.S.) na base da safra de cada data: uma consulta por safra
  const bases = new Map();
  for (const saf of unicos([...safraDe.values()])) {
    const dts = datas.filter((d) => safraDe.get(d) === saf);
    const daSafra = aps.filter((a) => dts.includes(a.dt));
    const fazendas = daSafra.flatMap((a) => [...a.talhoes.map((t) => t.propCod), ...(linhasOS.get(semZeros(a.os)) ?? []).map((r) => r.prop_cod)]);
    const b = await areasDaBase(fazendas, dts[0], pool);
    for (const d of dts) bases.set(d, b);
  }
  // a O.S. de cada apontamento (operações, talhões, áreas e já apontado), pelo id do apontamento
  const infos = new Map();
  if (unico) {
    for (const a of aps) if (a.os) infos.set(a.id, await consultarOS(a.os, a.id, a.dt));
  } else if (linhasOS.size) {
    const cadOps = await operacoesDoCadastro(pool);
    const porSafra = new Map();
    for (const a of aps) {
      const cod = semZeros(a.os);
      const rows = linhasOS.get(cod);
      if (!a.os || !rows) continue;
      const base = bases.get(a.dt);
      const k = `${cod}|${base.safra}`;
      if (!porSafra.has(k)) {
        porSafra.set(k, {
          os: rows[0].os,
          resp: "",
          safra: rows[0].safra,
          operacoes: operacoesDaOS(rows, base, cadOps),
          realizado: feitos.get(cod) ?? {},
          safraArea: base.safra,
          // o "já apontado" inclui a área dos próprios apontamentos
          comProprios: true,
        });
      }
      infos.set(a.id, porSafra.get(k));
    }
  }
  const sit = new Map();
  const comInfo = unicos([...infos.values()].filter(Boolean).map((i) => i.os));
  if (comInfo.length) {
    for (const r of (await pool.query(SQL_SITUACAO, [comInfo])).rows) {
      if (!sit.has(r.os)) sit.set(r.os, []);
      sit.get(r.os).push(r);
    }
  }
  // apontamentos das mesmas datas (possível duplicidade)
  const doDia = (
    await pool.query(
      `SELECT a.id, a.bol, a.dt::text AS dt, a.os, a.op_cod, t.prop_cod, t.tlh
         FROM ap_dia a JOIN ap_dia_tlh t ON t.ap_id = a.id WHERE a.dt = ANY($1::date[])`,
      [datas],
    )
  ).rows;
  return { infos, sit, bases, doDia, regras: await regrasApontamento() };
}

/** Confere um apontamento com a O.S. dele (ou a falta dela): divergências e a situação de cada talhão. */
function analisar(a, ctx) {
  const divergencias = [];
  const add = (cod, nivel, texto) => divergencias.push({ cod, nivel, texto });
  const obs = a.obs ?? "";
  const citadas = osCitadas(a);
  const statusMsg = (obs.match(/Status da O\.S\.: ([^·]+)/)?.[1] ?? "").trim();
  const base = ctx.bases.get(a.dt) ?? { safra: null, areas: new Map() };
  const info = a.os ? (ctx.infos.get(a.id) ?? null) : null;
  const opAp = String(a.opCod ?? "").trim();

  if (a.talhoes.length === 0) add("sem-area", "erro", "Apontamento sem talhão nem área.");
  if (!opAp) add("sem-operacao", "erro", "Apontamento sem operação (a atividade da mensagem não foi reconhecida): informe a operação.");

  // O.S.: existe na base, aberta na data e com a operação apontada
  let os = null;
  let opDaOS;
  if (!a.os) {
    if (citadas.length > 1)
      add(
        "varias-os",
        "erro",
        `A mensagem cita ${citadas.length} O.S. (${citadas.join(", ")}) e o apontamento ficou sem O.S.: escolha a O.S. certa (ou divida o apontamento por O.S.).`,
      );
    else
      add(
        "sem-os",
        ctx.regras.os ? "erro" : "alerta",
        `Apontamento sem O.S.: não há O.S. para conferir a operação, os talhões e as áreas${ctx.regras.os ? " (a O.S. é obrigatória nos Parâmetros)" : ""}.`,
      );
  } else if (!info) {
    os = { os: a.os, existe: false };
    add("os-fora-base", "erro", `A O.S. ${a.os} não está na base de O.S. (Ordem de Serviço Agr.): confira o número ou importe o relatório OS - Ordem de Serviço (PDF) atualizado.`);
  } else {
    opDaOS = opAp ? (info.operacoes.find((o) => o.cod === opAp) ?? info.operacoes.find((o) => semZeros(o.cod) === semZeros(opAp))) : undefined;
    const linhasSit = ctx.sit.get(info.os) ?? [];
    const s = situacaoOS(opDaOS ? linhasSit.filter((r) => r.op_cod === opDaOS.cod) : linhasSit, a.dt);
    os = {
      os: info.os,
      existe: true,
      situacao: s.rotulo,
      situacaoCod: s.cod,
      dtOs: s.dtOs,
      dtEnc: s.dtEnc,
      prevFim: s.prevFim,
      resp: info.resp ?? "",
      safra: info.safra ?? "",
      opNaOS: !!opDaOS,
      operacoes: info.operacoes.map((o) => ({ cod: o.cod, ds: o.ds })),
    };
    const qual = opDaOS ? `A O.S. ${info.os} (operação ${opDaOS.cod})` : `A O.S. ${info.os}`;
    // gravada com zeros à esquerda ("06052" para a 6052 da base): o "já apontado" da O.S. não soma este apontamento
    if (a.os !== info.os)
      add(
        "os-codigo",
        "erro",
        `O.S. gravada como ${a.os}, e na base ela é ${info.os}: a área deste apontamento não conta no Já apontado da O.S. Use Editar e grave (a O.S. passa para o código da base).`,
      );
    // o mesmo com a operação ("0101" para a 101 da O.S.)
    if (opDaOS && opDaOS.cod !== a.opCod)
      add(
        "operacao-codigo",
        "erro",
        `Operação gravada como ${opAp}, e na O.S. ${info.os} ela é ${opDaOS.cod}: a área deste apontamento não conta no Já apontado da O.S. Use Editar e grave (a operação passa para o código da O.S.).`,
      );
    if (s.cod === "antes") add("os-antes-emissao", "erro", `Apontamento de ${dataBR(a.dt)}, antes da emissão da O.S. ${info.os} (${dataBR(s.dtOs)}).`);
    else if (s.cod === "encerrada")
      add(
        "os-encerrada",
        "erro",
        s.dtEnc ? `${qual} foi encerrada em ${dataBR(s.dtEnc)}, antes do serviço (${dataBR(a.dt)}).` : `${qual} está encerrada (a base não tem a data de encerramento).`,
      );
    else if (s.cod === "encerrada-depois")
      add("os-encerrada-depois", "alerta", `${qual} já foi encerrada, em ${dataBR(s.dtEnc)} (depois do serviço de ${dataBR(a.dt)}): confira se o apontamento ainda vale para ela.`);
    if (s.cod !== "antes" && s.prevFim && s.prevFim < a.dt) add("fora-previsao", "info", `Serviço depois do prazo da O.S. (${dataBR(s.prevFim)}, data da O.S. + 7 dias).`);
    if (opAp && !opDaOS)
      add(
        "operacao-fora",
        "erro",
        `A operação ${opAp}${a.opDs ? ` · ${a.opDs}` : ""} não está na O.S. ${info.os} (operações dela: ${info.operacoes.map((o) => `${o.cod} · ${o.ds || "sem descrição"}`).join("; ")}).`,
      );
  }

  // talhões da O.S. para conferir: os da operação; com a operação fora da O.S., os de todas as operações dela
  const daOS = info
    ? opDaOS
      ? opDaOS.talhoes
      : info.operacoes.flatMap((o) => o.talhoes).filter((t, i, l) => l.findIndex((x) => x.propCod === t.propCod && x.tlh === t.tlh) === i)
    : null;
  const feitos = opDaOS ? (info.realizado[opDaOS.cod] ?? {}) : {};
  // na lista, o "já apontado" soma todos os apontamentos da O.S.: a área deste sai dele. Ela só está na conta com a O.S.
  // e a operação gravadas com o código da base, e só nos talhões gravados com a chave da O.S.
  const proprios = {};
  if (info?.comProprios && opDaOS && a.os === info.os && opDaOS.cod === a.opCod) {
    for (const t of a.talhoes) proprios[chaveTalhao(t.propCod, t.tlh)] = (proprios[chaveTalhao(t.propCod, t.tlh)] ?? 0) + t.area;
  }
  const jaDe = (k) => Math.max(0, round2((feitos[k] ?? 0) - (proprios[k] ?? 0)));
  const safraArea = info ? info.safraArea : base.safra;

  const itens = a.talhoes.map((t) => {
    const nf = normFaz(t.propCod);
    const nt = normTlh(t.tlh);
    const naFaz = daOS ? daOS.filter((x) => normFaz(x.propCod) === nf) : [];
    // o talhão da O.S. com a mesma chave; senão, o que casa pelo número ("05" = "5")
    const x = nt ? (naFaz.find((y) => y.propCod === t.propCod && y.tlh === t.tlh) ?? naFaz.find((y) => normTlh(y.tlh) === nt)) : undefined;
    const k = x ? chaveTalhao(x.propCod, x.tlh) : null;
    // área do talhão: a da O.S. (base Fazenda e Talhões da safra, senão a plantada); fora dela, a da base da safra
    const areaTlh = x ? (x.areaTlh ?? null) : nt ? (base.areas.get(`${nf}|${nt}`) ?? t.areaTlh ?? null) : null;
    const areaRec = x?.areaRec ?? null;
    const ja = x && opDaOS ? jaDe(k) : null;
    const saldo = ja !== null ? Math.max(0, round2((areaRec ?? areaTlh ?? 0) - ja)) : null;
    const cods = [];
    if (daOS) {
      if (naFaz.length === 0) cods.push("fazenda-fora");
      else if (!nt) cods.push("sem-talhao");
      else if (!x) cods.push("talhao-fora");
    } else if (!nt && ctx.regras.talhao) cods.push("sem-talhao");
    // o talhão é o da O.S., mas gravado com outro código ("9442-05" para o "09442-1-5"): a área não conta no já apontado dela
    const outroCodigo = !!x && chaveTalhao(t.propCod, t.tlh) !== k;
    if (outroCodigo) cods.push("talhao-codigo");
    if (saldo !== null && t.area > saldo + FOLGA) cods.push("acima-saldo");
    if (nt && areaTlh !== null && t.area > areaTlh + FOLGA) cods.push("acima-talhao");
    const grave = cods.includes("fazenda-fora") || cods.includes("talhao-fora") || outroCodigo || (daOS && cods.includes("sem-talhao"));
    return {
      propCod: t.propCod,
      propNm: t.propNm,
      tlh: t.tlh,
      area: t.area,
      naOS: daOS ? !!x : null,
      // como o talhão está na O.S., quando foi gravado com outro código
      naOSComo: outroCodigo ? nomeTalhao(x) : null,
      talhoesNaFazenda: naFaz.length,
      areaTlh,
      areaRec,
      ja,
      saldo,
      cods,
      problema: cods.map((c) => (c === "talhao-codigo" ? `${PROBLEMA[c]} (${nomeTalhao(x)})` : PROBLEMA[c])).join("; "),
      nivel: grave ? "erro" : cods.length ? "alerta" : null,
    };
  });

  // divergências dos talhões, agrupadas
  const com = (c) => itens.filter((i) => i.cods.includes(c));
  const naOS = info ? `na O.S. ${info.os}${opDaOS ? `, operação ${opDaOS.cod}` : ""}` : "";
  const fazFora = unicos(com("fazenda-fora").map((i) => (i.propNm ? `${i.propCod} · ${i.propNm}` : i.propCod)));
  if (fazFora.length) add("fazenda-fora", "erro", `${fazFora.length > 1 ? `As fazendas ${fazFora.join(", ")} não estão` : `A fazenda ${fazFora[0]} não está`} ${naOS}.`);
  const tlhFora = com("talhao-fora").map((i) => `${nomeTalhao(i)} (${ha(i.area)})`);
  if (tlhFora.length) add("talhao-fora", "erro", `${tlhFora.length > 1 ? `Os talhões ${tlhFora.join(", ")} não estão` : `O talhão ${tlhFora[0]} não está`} ${naOS}.`);
  const outroCod = com("talhao-codigo").map((i) => `${nomeTalhao(i)} (na O.S. é ${i.naOSComo})`);
  if (outroCod.length)
    add(
      "talhao-codigo",
      "erro",
      `${outroCod.length > 1 ? "Talhões gravados" : "Talhão gravado"} com código diferente do da O.S. ${info.os}: ${outroCod.join(", ")}. A área não conta no Já apontado da O.S.: use Editar e grave (a área passa para o talhão da O.S.).`,
    );
  for (const i of com("sem-talhao")) {
    if (daOS)
      add(
        "sem-talhao",
        "erro",
        `Área sem talhão na fazenda ${i.propCod} (${ha(i.area)}), mas a O.S. tem ${i.talhoesNaFazenda} talhão(ões) nela: distribua a área nos talhões da O.S.`,
      );
    else add("sem-talhao", "alerta", `Área sem talhão na fazenda ${i.propCod} (${ha(i.area)}); o talhão é obrigatório nos Parâmetros.`);
  }
  const acimaSaldo = com("acima-saldo").map((i) => `${nomeTalhao(i)} (${ha(i.area)}; saldo ${ha(i.saldo)})`);
  if (acimaSaldo.length) add("acima-saldo", "alerta", `Área acima do saldo ${naOS.replace(/^na/, "da")}: ${acimaSaldo.join(", ")}.`);
  const acimaTalhao = com("acima-talhao").map((i) => `${nomeTalhao(i)} (${ha(i.area)}; talhão ${ha(i.areaTlh)})`);
  if (acimaTalhao.length)
    add(
      "acima-talhao",
      "alerta",
      `Área acima da área do talhão na base Fazenda e Talhões${safraArea ? ` (safra ${safraArea})` : ""}: ${acimaTalhao.join(", ")}.`,
    );

  // possível duplicidade: outro apontamento da mesma O.S., operação e data com o mesmo talhão
  const meus = new Set(a.talhoes.map((t) => `${normFaz(t.propCod)}|${normTlh(t.tlh)}`));
  const dup = new Map();
  for (const r of ctx.doDia) {
    if (r.id === a.id || r.dt !== a.dt || semZeros(r.os) !== semZeros(a.os) || semZeros(r.op_cod) !== semZeros(opAp)) continue;
    if (!meus.has(`${normFaz(r.prop_cod)}|${normTlh(r.tlh)}`)) continue;
    const nome = r.bol ? `boletim nº ${r.bol}` : `apontamento #${r.id}`;
    if (!dup.has(nome)) dup.set(nome, []);
    dup.get(nome).push(nomeTalhao({ propCod: r.prop_cod, tlh: r.tlh }));
  }
  if (dup.size)
    add(
      "duplicidade",
      "alerta",
      `Possível duplicidade com ${[...dup].map(([n, ts]) => `o ${n} (${ts.join(", ")})`).join("; ")}: ${a.os ? "mesma O.S., operação, talhão e data" : "também sem O.S., com a mesma operação, talhão e data"}.`,
    );

  // o que a mensagem diz da O.S. e os avisos da leitura
  if (statusMsg) {
    const concluida = /CONCLU|FINALIZ/i.test(statusMsg) && !/N[ÃA]O\s+CONCLU/i.test(statusMsg);
    let resta = 0;
    if (concluida && opDaOS) {
      for (const y of opDaOS.talhoes) {
        const k = chaveTalhao(y.propCod, y.tlh);
        const este = itens.filter((i) => i.naOS && normFaz(i.propCod) === normFaz(y.propCod) && normTlh(i.tlh) === normTlh(y.tlh)).reduce((s, i) => s + i.area, 0);
        resta += Math.max(0, (y.areaRec ?? y.areaTlh ?? 0) - jaDe(k) - este);
      }
    }
    if (concluida && resta > 0.01)
      add("status-msg", "info", `A mensagem informa a O.S. como ${statusMsg}, mas ainda há ${ha(round2(resta))} de saldo ${naOS} depois deste apontamento.`);
    else add("status-msg", "info", `Status da O.S. na mensagem: ${statusMsg}.`);
  }
  for (const t of avisosDoBot(obs)) add("aviso-bot", "info", `Aviso do bot: ${t}`);

  divergencias.sort((x, y) => ORDEM_NIVEL[x.nivel] - ORDEM_NIVEL[y.nivel]);
  const erros = divergencias.filter((d) => d.nivel === "erro").length;
  const alertas = divergencias.filter((d) => d.nivel === "alerta").length;
  return {
    apontamento: a,
    // erro = divergente; alerta = confere com ressalvas; ok = confere com a O.S. em aberto
    nivel: erros ? "erro" : alertas ? "alerta" : "ok",
    n: erros || alertas,
    erros,
    alertas,
    citadas,
    statusMsg,
    fazendasCitadas: fazendasCitadas(obs),
    os,
    itens,
    divergencias,
    safraArea: safraArea ?? null,
  };
}

// ---------------------------------------------------------------------------
// O.S. em aberto compatíveis com o apontado
// ---------------------------------------------------------------------------

/**
 * O.S. × operação (das duas bases) com linha numa das fazendas ($1), filtradas pela data com `filtro` (regra de
 * situacaoOS: emitida até a data e em aberto, ou encerrada depois dela).
 */
const sqlPares = (filtro) => `
  WITH f AS (SELECT unnest($1::text[]) AS nf),
  alvo AS (SELECT DISTINCT os, op_cod FROM os_agr WHERE ${FAZ_SQL("prop_cod")} IN (SELECT nf FROM f)),
  agr AS (
    SELECT o.os, o.op_cod, MAX(o.op_ds) AS op_ds, bool_or(o.posicao <> 'E') AS aberta, MIN(o.posicao) FILTER (WHERE o.posicao <> 'E') AS pos,
           MIN(o.dt_os) AS dt_os, MAX(o.dt_enc) AS dt_enc, MAX(NULLIF(btrim(o.resp_nm), '')) AS resp, MAX(NULLIF(btrim(o.resp_cod), '')) AS resp_cod,
           'agr'::text AS base
      FROM os_agr o JOIN alvo x ON x.os = o.os AND x.op_cod = o.op_cod
     GROUP BY o.os, o.op_cod
  ),
  alvo_antiga AS (
    SELECT DISTINCT os, op_cod FROM os_tlh o
     WHERE ${FAZ_SQL("o.prop_cod")} IN (SELECT nf FROM f) AND NOT EXISTS (SELECT 1 FROM os_agr y WHERE y.os = o.os)
  ),
  antiga AS (
    SELECT o.os, o.op_cod, MAX(o.op_ds), bool_or(o.sts !~* 'encerr'), MAX(o.sts) FILTER (WHERE o.sts !~* 'encerr'),
           MIN(o.dt_lanc), NULL::date, MAX(NULLIF(btrim(o.resp), '')), NULL::text, 'antiga'::text
      FROM os_tlh o JOIN alvo_antiga x ON x.os = o.os AND x.op_cod = o.op_cod
     GROUP BY o.os, o.op_cod
  )
  SELECT os, op_cod, op_ds, aberta, pos, dt_os::text AS dt_os, dt_enc::text AS dt_enc, resp, resp_cod, base
    FROM (SELECT * FROM agr UNION ALL SELECT * FROM antiga) x
   WHERE ${filtro}`;

/** Em aberto na data $2 (conferência de um apontamento). */
const SQL_PARES = sqlPares("(dt_os IS NULL OR dt_os <= $2::date) AND (aberta OR dt_enc >= $2::date)");

/** Que podem estar em aberto em alguma data de $2 a $3 (vários apontamentos: cada um confere a sua data com emAbertoNaData). */
const SQL_PARES_PERIODO = sqlPares("(dt_os IS NULL OR dt_os <= $3::date) AND (aberta OR dt_enc >= $2::date)");

/** O par O.S. × operação (linha de sqlPares) em aberto na data `dt` do serviço: o mesmo filtro do SQL_PARES. */
const emAbertoNaData = (p, dt) => (p.dt_os === null || p.dt_os <= dt) && (p.aberta || (p.dt_enc !== null && p.dt_enc >= dt));

/** Talhões das O.S. candidatas (todas as operações; separadas depois). */
const SQL_TALHOES = `
  SELECT * FROM (
    SELECT os, op_cod, prop_cod, prop_nm, tlh || letra AS tlh, area_plant::float AS area_tlh, area_rec::float AS area_rec
      FROM os_agr WHERE os = ANY($1::text[])
    UNION ALL
    SELECT os, op_cod, prop_cod, prop_nm, tlh, area_tlh::float, area_rec::float FROM os_tlh WHERE os = ANY($2::text[])
  ) x
  ORDER BY os, op_cod, prop_cod, CASE WHEN tlh ~ '^[0-9]+$' THEN lpad(tlh, 8, '0') ELSE tlh END`;

/** Área já apontada nas O.S. (sem o apontamento $2; sem ele, de todos). */
const SQL_FEITOS = `
  SELECT a.os, a.op_cod, t.prop_cod, t.tlh, SUM(t.area)::float AS area
    FROM ap_dia a JOIN ap_dia_tlh t ON t.ap_id = a.id
   WHERE a.os = ANY($1::text[]) AND ($2::int IS NULL OR a.id <> $2::int)
   GROUP BY 1, 2, 3, 4`;

/**
 * Encaixa os talhões apontados nos de uma operação da O.S. (como o bot faz): o talhão casa pelo número ("01" = "1");
 * a área de fazenda sem talhão é rateada entre os talhões da O.S. naquela fazenda que não foram citados, pela área
 * recomendada (senão a do talhão). Devolve a área por talhão da O.S. (chaves do formulário) e o que ficou de fora.
 * Também usado ao ligar a O.S. na Verificar O.S. do Apontamento (vincularOS).
 */
export function encaixar(apontados, talhoesOS) {
  const areas = {};
  const somar = (x, area) => {
    const k = chaveTalhao(x.propCod, x.tlh);
    areas[k] = round2((areas[k] ?? 0) + area);
  };
  const fora = [];
  let cobertos = 0;
  let coberta = 0;
  for (const f of unicos(apontados.map((t) => normFaz(t.propCod)))) {
    const daFaz = talhoesOS.filter((y) => normFaz(y.propCod) === f);
    const citados = new Set();
    const semTalhao = [];
    for (const t of apontados.filter((x) => normFaz(x.propCod) === f)) {
      if (!normTlh(t.tlh)) {
        semTalhao.push(t);
        continue;
      }
      const x = daFaz.find((y) => normTlh(y.tlh) === normTlh(t.tlh));
      if (x) {
        somar(x, t.area);
        citados.add(chaveTalhao(x.propCod, x.tlh));
        cobertos++;
        coberta += t.area;
      } else fora.push(t);
    }
    const resto = daFaz.filter((y) => !citados.has(chaveTalhao(y.propCod, y.tlh)));
    const area = semTalhao.reduce((s, t) => s + t.area, 0);
    if (area > 0 && resto.length) {
      ratearArea(
        area,
        resto.map((y) => y.areaRec ?? y.areaTlh),
      ).forEach((ar, i) => ar > 0 && somar(resto[i], ar));
      cobertos += semTalhao.length;
      coberta += area;
    } else fora.push(...semTalhao);
  }
  return { areas, fora, cobertos, coberta: round2(coberta) };
}

/** Já apontado por O.S. × operação (`${os}|${op}` → área por chave do talhão), das linhas do SQL_FEITOS. */
function feitosPorPar(rows) {
  const feitos = new Map();
  for (const r of rows) {
    const k = `${r.os}|${r.op_cod}`;
    if (!feitos.has(k)) feitos.set(k, {});
    feitos.get(k)[chaveTalhao(r.prop_cod, r.tlh)] = round2(r.area);
  }
  return feitos;
}

/**
 * Talhões de cada O.S. × operação (`${os}|${op}`) das linhas do SQL_TALHOES, com a área da base Fazenda e Talhões da
 * safra (`base`, de areasDaBase); talhão fora dela fica com a área plantada da O.S., como no formulário.
 */
function talhoesPorPar(linhas, base) {
  const talhoes = new Map();
  for (const r of linhas) {
    const k = `${r.os}|${r.op_cod}`;
    if (!talhoes.has(k)) talhoes.set(k, []);
    const lista = talhoes.get(k);
    if (lista.some((t) => t.propCod === r.prop_cod && t.tlh === r.tlh)) continue;
    const area = base.areas.get(`${normFaz(r.prop_cod)}|${normTlh(r.tlh)}`);
    lista.push({ propCod: r.prop_cod, propNm: r.prop_nm, tlh: r.tlh, areaTlh: area ?? r.area_tlh, areaRec: r.area_rec });
  }
  return talhoes;
}

/** Sem o nome do responsável no relatório: o do cadastro Responsáveis (Ordem de Serviço Agr.) pela matrícula (uma consulta). */
async function nomesDosResponsaveis(pool, lista) {
  const mats = unicos(lista.filter((c) => !c.resp && c.respCod && c.respCod !== "0").map((c) => semZeros(c.respCod)));
  if (mats.length) {
    const { rows } = await pool.query("SELECT cod, nm FROM cad_itm WHERE cad = 'responsaveis-os' AND ltrim(cod, '0') = ANY($1::text[])", [mats]);
    for (const c of lista) if (!c.resp && c.respCod) c.resp = rows.find((r) => semZeros(r.cod) === semZeros(c.respCod))?.nm ?? "";
  }
  for (const c of lista) delete c.respCod;
}

/**
 * O.S. em aberto na data do apontamento que têm as fazendas apontadas (e as citadas na mensagem sem área), da mais
 * provável para a menos: mesma operação, mais talhões cobertos, citada na mensagem, saldo que cabe a área, emissão mais
 * recente. Cada uma já traz a área de cada talhão casado nas chaves do formulário.
 */
async function osCandidatas(pool, a, citadas, fazExtras) {
  const apontados = a.talhoes.filter((t) => t.area > 0);
  const fazendas = unicos([...apontados.map((t) => normFaz(t.propCod)), ...fazExtras]).filter(Boolean);
  if (fazendas.length === 0) return [];
  const pares = (await pool.query(SQL_PARES, [fazendas, a.dt])).rows;
  if (pares.length === 0) return [];
  const daBase = (b) => unicos(pares.filter((p) => p.base === b).map((p) => p.os));
  const linhas = (await pool.query(SQL_TALHOES, [daBase("agr"), daBase("antiga")])).rows;
  const feitos = feitosPorPar((await pool.query(SQL_FEITOS, [unicos(pares.map((p) => p.os)), a.id])).rows);
  // área do talhão: a da base Fazenda e Talhões da safra da data (senão a plantada da O.S.), como no formulário
  const base = await areasDaBase(
    linhas.map((r) => r.prop_cod),
    a.dt,
    pool,
  );
  const talhoes = talhoesPorPar(linhas, base);
  const cands = montarCandidatas(a, pares, {
    fazendas,
    citadas,
    talhoesDe: (k) => talhoes.get(k) ?? [],
    feitosDe: (k) => feitos.get(k) ?? {},
    cadOps: await operacoesDoCadastro(pool),
  });
  const top = cands.slice(0, 8);
  await nomesDosResponsaveis(pool, top);
  return top;
}

/**
 * As O.S. candidatas de um apontamento, da mais provável para a menos (todas; quem chama escolhe quantas): `pares` são
 * as O.S. × operação em aberto na data com as fazendas (`fazendas`, normalizadas); `talhoesDe` e `feitosDe` dão, pelo
 * par `${os}|${op}`, os talhões da O.S. e o já apontado sem o próprio apontamento. `respCod` sai em nomesDosResponsaveis.
 */
function montarCandidatas(a, pares, { fazendas, citadas, talhoesDe, feitosDe, cadOps }) {
  const apontados = a.talhoes.filter((t) => t.area > 0);
  const opAp = semZeros(a.opCod);
  const citadasSet = new Set(citadas.map(semZeros));
  const areaApontada = round2(apontados.reduce((s, t) => s + t.area, 0));
  const gravadas = new Set(a.talhoes.map((t) => chaveTalhao(t.propCod, t.tlh)));
  const cands = pares.map((p) => {
    const k = `${p.os}|${p.op_cod}`;
    const tl = talhoesDe(k);
    const enc = encaixar(apontados, tl);
    const jaOp = feitosDe(k);
    let saldo = 0;
    let cabe = Object.keys(enc.areas).length > 0;
    for (const [ch, area] of Object.entries(enc.areas)) {
      const y = tl.find((t) => chaveTalhao(t.propCod, t.tlh) === ch);
      const s = Math.max(0, round2((y?.areaRec ?? y?.areaTlh ?? 0) - (jaOp[ch] ?? 0)));
      saldo += s;
      if (area > s + FOLGA) cabe = false;
    }
    const s = situacaoOS([p], a.dt);
    const atual = !!a.os && semZeros(p.os) === semZeros(a.os) && semZeros(p.op_cod) === opAp;
    return {
      os: p.os,
      opCod: p.op_cod,
      opDs: nomeOperacao(cadOps, p.op_cod, p.op_ds ?? ""),
      situacao: s.rotulo,
      situacaoCod: s.cod,
      dtOs: p.dt_os,
      dtEnc: p.dt_enc,
      resp: p.resp ?? "",
      respCod: p.resp_cod ?? "",
      fazendas: unicos(tl.map((t) => (t.propNm ? `${t.propCod} · ${t.propNm}` : t.propCod))),
      fazendasCobertas: fazendas.filter((f) => tl.some((t) => normFaz(t.propCod) === f)).length,
      talhoesCobertos: enc.cobertos,
      talhoesApontados: apontados.length,
      talhoesDaOS: tl.length,
      areaApontada,
      areaCoberta: enc.coberta,
      // saldo dos talhões da O.S. que recebem a área apontada, e se a área cabe nele talhão a talhão
      saldo: round2(saldo),
      saldoOk: cabe,
      citada: citadasSet.has(semZeros(p.os)),
      mesmaOperacao: !!opAp && semZeros(p.op_cod) === opAp,
      atual,
      // a O.S. do apontamento, mas com a O.S., a operação ou os talhões gravados com outro código (ou área sem talhão a
      // ratear): usá-la passa o apontamento para os códigos da O.S.
      acerta: atual && (a.os !== p.os || a.opCod !== p.op_cod || Object.keys(enc.areas).some((k) => !gravadas.has(k))),
      areas: enc.areas,
      sobras: enc.fora.map((t) => `${nomeTalhao(t)}: ${ha(t.area)}`),
      base: p.base,
    };
  });
  const n = (b) => (b ? 1 : 0);
  cands.sort(
    (x, y) =>
      n(y.mesmaOperacao) - n(x.mesmaOperacao) ||
      y.talhoesCobertos - x.talhoesCobertos ||
      n(y.citada) - n(x.citada) ||
      n(y.saldoOk) - n(x.saldoOk) ||
      y.fazendasCobertas - x.fazendasCobertas ||
      String(y.dtOs ?? "").localeCompare(String(x.dtOs ?? "")) ||
      x.os.localeCompare(y.os, undefined, { numeric: true }),
  );
  return cands;
}

/**
 * Já apontado do par O.S. × operação `k` sem a área do apontamento `a` (o SQL_FEITOS sem $2 soma todos): ela só está
 * na conta com a O.S., a operação e o talhão gravados com o código da base, como no SQL que tira o apontamento.
 */
function semOProprio(ja, a, k) {
  if (`${a.os}|${a.opCod}` !== k) return ja;
  const r = { ...ja };
  for (const t of a.talhoes) {
    const ch = chaveTalhao(t.propCod, t.tlh);
    if (r[ch] !== undefined) r[ch] = round2(r[ch] - (t.area ?? 0));
  }
  return r;
}

/**
 * As O.S. candidatas de vários apontamentos de uma vez (Verificar O.S. da tela Apontamento), pela mesma regra da
 * conferência (montarCandidatas), mas com consultas agregadas: os pares O.S. × operação das fazendas de todos no
 * período, os talhões, o já apontado e a área da base por safra — não uma consulta por apontamento. Aqui as O.S. que
 * cobrem algum talhão apontado vêm antes das que só têm a fazenda (dentro de cada grupo, a ordem da conferência: a
 * mesma operação primeiro). Até `limite` por apontamento; devolve um Map id → candidatas.
 */
export async function candidatasDoPeriodo(pool, aps, limite = 5) {
  const porId = new Map(aps.map((a) => [a.id, []]));
  const pedidos = aps
    .map((a) => ({
      a,
      fazendas: unicos([...a.talhoes.filter((t) => t.area > 0).map((t) => normFaz(t.propCod)), ...fazendasCitadas(a.obs)]).filter(Boolean),
    }))
    .filter((p) => p.fazendas.length > 0);
  if (pedidos.length === 0) return porId;
  const datas = unicos(pedidos.map((p) => p.a.dt)).sort();
  const pares = (await pool.query(SQL_PARES_PERIODO, [unicos(pedidos.flatMap((p) => p.fazendas)), datas[0], datas[datas.length - 1]])).rows;
  if (pares.length === 0) return porId;
  const parDe = new Map(pares.map((p) => [`${p.os}|${p.op_cod}`, p]));
  const daBase = (b) => unicos(pares.filter((p) => p.base === b).map((p) => p.os));
  const linhas = (await pool.query(SQL_TALHOES, [daBase("agr"), daBase("antiga")])).rows;
  // pares de cada fazenda (normalizada como o FAZ_SQL do SQL_PARES: sem a sequência, sem zeros e sem espaços)
  const porFaz = new Map();
  for (const r of linhas) {
    const k = `${r.os}|${r.op_cod}`;
    if (!parDe.has(k)) continue;
    const f = normFaz(r.prop_cod).trim();
    if (!porFaz.has(f)) porFaz.set(f, new Set());
    porFaz.get(f).add(k);
  }
  const feitos = feitosPorPar((await pool.query(SQL_FEITOS, [unicos(pares.map((p) => p.os)), null])).rows);
  // área dos talhões na base Fazenda e Talhões da safra de cada data: uma consulta por safra
  const safraDe = new Map();
  for (const dt of datas) safraDe.set(dt, await safraDaArea(dt, pool));
  const talhoesDaSafra = new Map();
  for (const saf of unicos([...safraDe.values()])) {
    const base = await areasDaBase(
      linhas.map((r) => r.prop_cod),
      datas.find((d) => safraDe.get(d) === saf),
      pool,
    );
    talhoesDaSafra.set(saf, talhoesPorPar(linhas, base));
  }
  const cadOps = await operacoesDoCadastro(pool);
  const n = (b) => (b ? 1 : 0);
  const escolhidas = [];
  for (const { a, fazendas } of pedidos) {
    const ks = unicos(fazendas.flatMap((f) => [...(porFaz.get(f) ?? [])]));
    const dosPares = ks.map((k) => parDe.get(k)).filter((p) => emAbertoNaData(p, a.dt));
    if (dosPares.length === 0) continue;
    const talhoes = talhoesDaSafra.get(safraDe.get(a.dt));
    const cands = montarCandidatas(a, dosPares, {
      fazendas,
      citadas: osCitadas(a),
      talhoesDe: (k) => talhoes.get(k) ?? [],
      feitosDe: (k) => semOProprio(feitos.get(k) ?? {}, a, k),
      cadOps,
    });
    // sort estável: dentro de cada grupo fica a ordem da conferência
    const top = cands.sort((x, y) => n(y.talhoesCobertos > 0) - n(x.talhoesCobertos > 0)).slice(0, limite);
    porId.set(a.id, top);
    escolhidas.push(...top);
  }
  await nomesDosResponsaveis(pool, escolhidas);
  return porId;
}

// ---------------------------------------------------------------------------
// Funções usadas pela API
// ---------------------------------------------------------------------------

/**
 * Conferência de um apontamento: a O.S. dele na data, a situação de cada talhão, as divergências (erro, alerta, info)
 * e, quando a O.S., a operação, a fazenda ou o talhão não batem (ou não há O.S.), as O.S. em aberto compatíveis.
 */
export async function analisarConferencia(id, { candidatas = true } = {}) {
  const pool = getPool();
  await prepararAtividades(pool);
  await prepararOSAgr(pool);
  const a = await obterApontamento(id);
  if (!a) return null;
  const r = analisar(a, await contexto(pool, [a], true));
  const procurar = r.divergencias.some((d) => PROCURAR_OS.has(d.cod));
  r.procurouCandidatas = candidatas && procurar;
  r.candidatas = r.procurouCandidatas ? await osCandidatas(pool, a, r.citadas, r.fazendasCitadas) : [];
  return r;
}

/** Resultado da conferência dos apontamentos a conferir do período (para o selo da lista), sem as O.S. candidatas. */
export async function niveisConferencia(de, ate) {
  const pool = getPool();
  await prepararAtividades(pool);
  await prepararOSAgr(pool);
  const aps = await apontamentosAConferir(de, ate);
  if (aps.length === 0) return [];
  const ctx = await contexto(pool, aps);
  return aps.map((a) => {
    try {
      const r = analisar(a, ctx);
      return { id: a.id, nivel: r.nivel, n: r.n };
    } catch (err) {
      console.error(`Conferência do apontamento ${a.id}:`, err);
      return { id: a.id, nivel: null, n: 0 };
    }
  });
}

const MUDOU = "O apontamento mudou desde a análise; confira de novo.";

/**
 * Marca um apontamento do bot como conferido (quem e quando): refaz a análise e, com divergência (erro), só confere com
 * `aceitar` — as divergências aceitas ficam no Log de Alterações. Depois disso o bot não mexe mais nele. `versao` é a do
 * apontamento analisado na tela: se ele foi regravado depois (mensagem editada no grupo, ou alguém editou), não confere
 * (409 com `mudou`) e a tela refaz a análise.
 */
export async function conferirApontamento(id, usuario, aceitar = false, versao = "") {
  const pool = getPool();
  const an = await analisarConferencia(id, { candidatas: false });
  if (!an) return { erro: "Apontamento não encontrado.", status: 404 };
  const a = an.apontamento;
  if (a.usr !== BOT_WHATSAPP) return { erro: "Só os apontamentos lançados pelo bot do WhatsApp passam pela conferência.", status: 400 };
  if (a.confEm) return { erro: `O boletim nº ${a.boletim ?? a.id} já foi conferido por ${a.confUsr} em ${a.confEm}.`, status: 409 };
  // tela aberta antes da versão (não manda): não dá para saber o que foi analisado
  if (!versao) return { erro: "A tela está desatualizada: atualize a página e confira de novo.", status: 409 };
  if (versao !== a.versao) return { erro: MUDOU, mudou: true, status: 409 };
  const erros = an.divergencias.filter((d) => d.nivel === "erro");
  const alertas = an.divergencias.filter((d) => d.nivel === "alerta");
  if (erros.length && !aceitar) {
    return { erro: "O apontamento diverge da O.S. em aberto. Confirme para conferir assim mesmo.", divergencias: an.divergencias, status: 409 };
  }
  // só a versão analisada: o bot (ou uma pessoa) pode ter regravado o apontamento entre a análise e esta gravação
  const r = await pool.query(
    `UPDATE ap_dia a SET conf_usr = $1, conf_em = now(), atu_usr = $1, atu_em = now()
      WHERE a.id = $2 AND a.conf_em IS NULL AND ${versaoApontamentoSQL("a")} = $3`,
    [usuario, id, versao],
  );
  if (!r.rowCount) {
    const atual = (await pool.query("SELECT conf_em IS NOT NULL AS conferido FROM ap_dia WHERE id = $1", [id])).rows[0];
    if (atual && !atual.conferido) return { erro: MUDOU, mudou: true, status: 409 };
    return { erro: "O apontamento foi conferido ou excluído por outra pessoa. Atualize a lista.", status: 409 };
  }
  await auditar(pool, {
    usuario,
    modulo: "Atividades",
    entidade: "Apontamento diário",
    chave: chaveLog(a),
    acao: "alteracao",
    depois: {
      conferido: "Apontamento do WhatsApp conferido",
      resultado: erros.length ? "conferido com divergências aceitas" : alertas.length ? `confere, com ${alertas.length} alerta(s)` : "confere com a O.S. em aberto",
      divergenciasAceitas: erros.length ? erros.map((d) => d.texto).join(" | ") : undefined,
      alertas: alertas.length ? alertas.map((d) => d.texto).join(" | ") : undefined,
    },
  });
  return { ok: true, nivel: an.nivel };
}
