import { round2 } from "./atividades";
import { codigoOperacao } from "./dashboard-atividades";
import { getPool } from "./db";
import { BOT_WHATSAPP, prepararAtividades } from "./db-atividades";
import { nomeOperacao, operacoesDoCadastro } from "./db-operacoes";
import { prepararOSAgr } from "./db-os-agr";
import { normFaz, normTlh } from "./ocupacao";
import { diasEntre } from "./os-agr";

/*
 * Análise dos Apontamentos Diários (Atividades › Apontamentos Diários › Análise): o painel dos analistas para cobrar as
 * áreas responsáveis — as O.S. em aberto (base de Ordem de Serviço Agr.) com os apontamentos lançados nelas (tela,
 * Lançamento Mobile e bot do WhatsApp) e os alertas de cada uma.
 */

/** Folga (ha) nas comparações de área. */
const FOLGA = 0.01;
/** Dias em aberto sem nenhum apontamento para o alerta "Sem apontamento". */
export const DIAS_SEM_APONTAMENTO = 7;

const semZeros = (c) =>
  String(c ?? "")
    .trim()
    .replace(/^0+(?=\d)/, "");
const chaveTalhao = (faz, tlh) => `${normFaz(faz)}|${normTlh(tlh)}`;
/** Origem do apontamento como as telas mostram. */
const origemDe = (orig, usr) => (orig === "mobile" ? "Lançamento Mobile" : orig === "whatsapp" ? (usr === BOT_WHATSAPP ? "Bot do WhatsApp" : "Carga inicial") : "Tela");

/**
 * As O.S. em aberto (posição Aberta ou Liberada) com, para cada uma: as operações (área recomendada — sem ela, a
 * plantada —, apontada nos talhões da O.S., saldo, apontada acima da área de cada talhão e apontada fora dos talhões da
 * O.S.), os apontamentos lançados nela, o último status informado no campo, o responsável e a área dele (Cadastro de
 * Responsáveis) e os alertas:
 *   concluida   o último status informado é CONCLUÍDA e a O.S. continua em aberto (fechar no ERP)
 *   areaTotal   a área total da O.S. já foi apontada (saldo zero) e ela segue em andamento
 *   acima       algum talhão com mais área apontada que a da O.S. (o excesso em ha)
 *   semApont    em aberto há DIAS_SEM_APONTAMENTO dias ou mais sem nenhum apontamento
 *   vencida     o prazo (data da O.S. + 7 dias) passou e ainda há saldo
 */
export async function analiseApontamentos() {
  const pool = getPool();
  await prepararAtividades(pool);
  await prepararOSAgr(pool);
  const hoje = (await pool.query("SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date::text AS d")).rows[0].d;
  const { rows: linhas } = await pool.query(
    `SELECT emp, os, op_cod, op_ds, etapa_ds, prop_cod, prop_nm, tlh || letra AS tlh, area_rec::float AS area_rec, area_plant::float AS area_plant,
            resp_cod, resp_nm, posicao, dt_os::text AS dt_os, prev_fim::text AS prev_fim, safra
       FROM os_agr WHERE posicao <> 'E'`,
  );
  if (linhas.length === 0) return { hoje, diasSemApontamento: DIAS_SEM_APONTAMENTO, ordens: [] };
  // o apontamento guarda a O.S. como veio da base (e, por garantia, sem os zeros à esquerda)
  const oss = [...new Set(linhas.flatMap((l) => [l.os, semZeros(l.os)]))];
  const [feitos, aps, resp, cadOps] = await Promise.all([
    pool.query(
      `SELECT a.os, a.op_cod, t.prop_cod, t.tlh, SUM(t.area)::float AS area
         FROM ap_dia a JOIN ap_dia_tlh t ON t.ap_id = a.id
        WHERE a.os = ANY($1::text[]) GROUP BY 1, 2, 3, 4`,
      [oss],
    ),
    pool.query(
      `SELECT a.id, a.bol, a.dt::text AS dt, a.os, a.op_cod, a.op_ds, a.sts_os, a.usr, a.apont, a.apont_mat, a.orig, a.conf_em IS NOT NULL AS conferido,
              (SELECT COALESCE(SUM(t.area), 0) FROM ap_dia_tlh t WHERE t.ap_id = a.id)::float AS area
         FROM ap_dia a WHERE a.os = ANY($1::text[]) ORDER BY a.dt DESC, a.id DESC`,
      [oss],
    ),
    pool.query("SELECT cod, nm, dds->>'area' AS area FROM cad_itm WHERE cad = 'responsaveis-os'"),
    operacoesDoCadastro(pool),
  ]);
  const responsaveis = new Map(resp.rows.map((r) => [semZeros(r.cod), { nome: r.nm, area: (r.area ?? "").trim() }]));

  // área apontada por O.S. → operação → talhão
  const apontado = new Map();
  for (const f of feitos.rows) {
    const k = `${semZeros(f.os)}|${codigoOperacao(f.op_cod)}`;
    if (!apontado.has(k)) apontado.set(k, new Map());
    const m = apontado.get(k);
    const kt = chaveTalhao(f.prop_cod, f.tlh);
    m.set(kt, (m.get(kt) ?? 0) + (f.area ?? 0));
  }
  // apontamentos por O.S.
  const porOS = new Map();
  for (const a of aps.rows) {
    const k = semZeros(a.os);
    if (!porOS.has(k)) porOS.set(k, []);
    porOS.get(k).push(a);
  }

  // as O.S. com as operações e os talhões de cada uma
  const ordens = new Map();
  for (const l of linhas) {
    const k = `${l.emp}|${l.os}`;
    let o = ordens.get(k);
    if (!o) {
      o = {
        emp: l.emp,
        os: l.os,
        // A (Aberta) ou L (Liberada): com alguma linha liberada, a O.S. está liberada
        posicao: l.posicao,
        dtOs: l.dt_os,
        prevFim: l.prev_fim,
        safra: l.safra,
        etapa: l.etapa_ds ?? "",
        respCod: semZeros(l.resp_cod) === "0" ? "" : semZeros(l.resp_cod),
        respNm: l.resp_nm ?? "",
        fazendas: new Map(),
        ops: new Map(),
      };
      ordens.set(k, o);
    }
    if (l.posicao === "L") o.posicao = "L";
    if (l.prev_fim && (!o.prevFim || l.prev_fim > o.prevFim)) o.prevFim = l.prev_fim;
    if (l.dt_os && (!o.dtOs || l.dt_os < o.dtOs)) o.dtOs = l.dt_os;
    if (!o.fazendas.has(l.prop_cod)) o.fazendas.set(l.prop_cod, l.prop_nm ?? "");
    const kop = codigoOperacao(l.op_cod);
    if (!o.ops.has(kop)) o.ops.set(kop, { cod: l.op_cod, ds: nomeOperacao(cadOps, l.op_cod, l.op_ds), talhoes: new Map() });
    const t = o.ops.get(kop).talhoes;
    const kt = chaveTalhao(l.prop_cod, l.tlh);
    t.set(kt, (t.get(kt) ?? 0) + (l.area_rec ?? l.area_plant ?? 0));
  }

  const lista = [];
  for (const o of ordens.values()) {
    const kos = semZeros(o.os);
    const ops = [];
    const opsDaOS = new Set();
    for (const [kop, op] of o.ops) {
      opsDaOS.add(kop);
      const feito = apontado.get(`${kos}|${kop}`) ?? new Map();
      let rec = 0;
      let naOS = 0;
      let saldo = 0;
      let acima = 0;
      for (const [kt, r] of op.talhoes) {
        const a = feito.get(kt) ?? 0;
        rec += r;
        naOS += a;
        saldo += Math.max(0, r - a);
        if (r > 0 && a > r + FOLGA) acima += a - r;
      }
      let fora = 0;
      for (const [kt, a] of feito) if (!op.talhoes.has(kt)) fora += a;
      ops.push({ cod: op.cod, ds: op.ds, rec: round2(rec), apontado: round2(naOS), saldo: round2(saldo), acima: round2(acima), fora: round2(fora) });
    }
    // apontado em operações que não são da O.S.
    let outraOperacao = 0;
    for (const [k, m] of apontado) {
      const [os, op] = k.split("|");
      if (os === kos && !opsDaOS.has(op)) for (const a of m.values()) outraOperacao += a;
    }
    const soma = (c) => round2(ops.reduce((s, x) => s + x[c], 0));
    const rec = soma("rec");
    const apontadoNaOS = soma("apontado");
    const saldo = soma("saldo");
    const acima = soma("acima");
    const fora = round2(soma("fora") + outraOperacao);
    const apontamentos = (porOS.get(kos) ?? []).map((a) => ({
      id: a.id,
      boletim: a.bol,
      dt: a.dt,
      opCod: a.op_cod,
      opDs: nomeOperacao(cadOps, a.op_cod, a.op_ds),
      area: round2(a.area ?? 0),
      status: a.sts_os ?? "",
      origem: origemDe(a.orig, a.usr),
      quem: a.apont || a.usr || "",
      conferido: a.usr === BOT_WHATSAPP ? a.conferido : null,
    }));
    const comStatus = apontamentos.find((a) => a.status);
    const ultimo = apontamentos[0] ?? null;
    const dias = o.dtOs ? Math.max(0, diasEntre(o.dtOs, hoje)) : null;
    const cad = responsaveis.get(o.respCod);
    const alertas = [];
    if (comStatus?.status === "CONCLUÍDA") alertas.push("concluida");
    else if (rec > 0 && saldo <= FOLGA) alertas.push("areaTotal");
    if (acima > FOLGA) alertas.push("acima");
    if (apontamentos.length === 0 && dias !== null && dias >= DIAS_SEM_APONTAMENTO) alertas.push("semApont");
    if (o.prevFim && o.prevFim < hoje && saldo > FOLGA) alertas.push("vencida");
    lista.push({
      emp: o.emp,
      os: o.os,
      posicao: o.posicao,
      dtOs: o.dtOs,
      prevFim: o.prevFim,
      dias,
      safra: o.safra,
      etapa: o.etapa,
      respCod: o.respCod,
      respNm: o.respNm || cad?.nome || "",
      area: cad?.area || "",
      fazendas: [...o.fazendas].map(([cod, nm]) => ({ cod, nm })),
      ops,
      rec,
      apontado: apontadoNaOS,
      saldo,
      pct: rec > 0 ? Math.round((apontadoNaOS / rec) * 1000) / 10 : null,
      acima,
      fora,
      apontamentos,
      ultimo: ultimo ? { dt: ultimo.dt, boletim: ultimo.boletim, origem: ultimo.origem, quem: ultimo.quem } : null,
      status: comStatus ? { status: comStatus.status, dt: comStatus.dt, boletim: comStatus.boletim, quem: comStatus.quem } : null,
      alertas,
    });
  }
  lista.sort((a, b) => (a.dtOs ?? "").localeCompare(b.dtOs ?? "") || Number(a.os) - Number(b.os));
  return { hoje, diasSemApontamento: DIAS_SEM_APONTAMENTO, ordens: lista };
}
