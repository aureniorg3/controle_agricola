import { filtrosDaEscolha, GRUPOS_PROGRAMA, programaDoRegistro, PROGRAMAS_LOG } from "./auditoria-programas";
import { getPool, prepararBanco } from "./db";

/**
 * Auditoria geral do sistema: cada lançamento, alteração, exclusão ou
 * importação grava quem fez, quando e o conteúdo antes e depois. Vale para
 * todos os módulos; o log dos boletins das Rodadas de Campo (rod_log) entra na
 * mesma consulta. A consulta fica só na tela Configurações › Log de Alterações,
 * com a escolha do programa (tela) em que foi feito (ver auditoria-programas).
 */

export { auditar } from "./auditar";

const ROTULO_ACAO = {
  inclusao: "Inclusão",
  alteracao: "Alteração",
  exclusao: "Exclusão",
  importacao: "Importação",
  limpeza: "Limpeza",
};

function texto(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    return Object.entries(v)
      .filter(([, x]) => x !== null && x !== undefined && x !== "" && typeof x !== "object")
      .map(([k, x]) => `${k}: ${x}`)
      .join(", ");
  }
  return String(v);
}

function resumir(acao, antes, depois) {
  if (acao === "alteracao") return `Antes: ${texto(antes)} | Depois: ${texto(depois)}`;
  return texto(acao === "exclusao" ? antes : depois);
}

/**
 * Lista o log (mais recente primeiro): aud_log + os boletins das Rodadas de Campo (rod_log).
 */
export async function listarAuditoria(f, limite = 300) {
  const pool = getPool();
  await prepararBanco(pool);
  return montarConsulta(pool, f, limite);
}

async function montarConsulta(pool, f, limite) {
  const cond = [];
  const params = [];
  const p = (v) => {
    params.push(v);
    return `$${params.length}`;
  };
  if (f.modulo) cond.push(`modulo = ${p(f.modulo)}`);
  // programa (ou grupo de programas): os pares módulo/entidade que ele grava
  const pares = filtrosDaEscolha(f.programa);
  if (pares) cond.push(`(${pares.map(([m, e]) => (e === null ? `modulo = ${p(m)}` : `(modulo = ${p(m)} AND entidade = ${p(e)})`)).join(" OR ")})`);
  if (f.acao) cond.push(`acao = ${p(f.acao)}`);
  if (f.usuario) cond.push(`usr = ${p(f.usuario)}`);
  if (f.entidade) cond.push(`entidade = ${p(f.entidade)}`);
  if (f.chave) cond.push(`chave = ${p(f.chave)}`);
  if (f.de) cond.push(`(em AT TIME ZONE 'America/Sao_Paulo')::date >= ${p(f.de)}::date`);
  if (f.ate) cond.push(`(em AT TIME ZONE 'America/Sao_Paulo')::date <= ${p(f.ate)}::date`);
  if (f.q && f.q.trim()) {
    const t = p(`%${f.q.trim()}%`);
    cond.push(`(chave ILIKE ${t} OR entidade ILIKE ${t} OR usr ILIKE ${t} OR COALESCE(antes::text,'') ILIKE ${t} OR COALESCE(depois::text,'') ILIKE ${t})`);
  }
  const where = cond.length ? `WHERE ${cond.join(" AND ")}` : "";
  // boletins (rod_log) entram como módulo "Rodadas de Campo"
  const { rows } = await pool.query(
    `SELECT id, to_char(em AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI:SS') AS em_txt, usr, modulo, entidade, chave, acao, antes, depois FROM (
       SELECT 'a' || id AS id, id::bigint AS seq, em, usr, modulo, entidade, chave, acao, antes, depois FROM aud_log
       UNION ALL
       SELECT 'b' || id, id::bigint, em, usr, 'Rodadas de Campo', 'Boletim', bol::text, acao, antes, depois FROM rod_log
     ) t ${where} ORDER BY em DESC, seq DESC, id DESC LIMIT ${Math.max(1, Math.min(limite, 1000))}`,
    params,
  );
  return rows.map((r) => ({
    id: r.id,
    em: r.em_txt,
    usuario: r.usr,
    modulo: r.modulo,
    programa: programaDoRegistro(r.modulo, r.entidade) ?? r.modulo,
    entidade: r.entidade,
    chave: r.chave,
    acao: ROTULO_ACAO[r.acao] ?? r.acao,
    resumo: resumirAuditoria(r.acao, r.antes, r.depois),
  }));
}

function resumirAuditoria(acao, antes, depois) {
  const a = antes;
  const d = depois;
  // boletim: o resumo do próprio boletim (rod_log guarda o boletim inteiro)
  // (só quando "itens" é a lista de talhões: a importação do estoque grava "itens" como número)
  if (Array.isArray(a?.itens) || Array.isArray(d?.itens)) {
    const desc = (b) => {
      if (!b) return "";
      const itens = Array.isArray(b.itens) ? b.itens : [];
      const tlhs = itens.map((i) => i.tlh).join(", ");
      const oco = [itens[0]?.oco, itens[0]?.ocoTxt ? `Outros: ${itens[0].ocoTxt}` : ""].filter(Boolean).join(" + ");
      return `Rodada ${b.rod}, semana ${b.sem}, região ${b.reg}, fazenda ${b.faz}, talhões ${tlhs || "—"}, ocorrência(s) ${oco || "—"}, prioridade ${itens[0]?.pri || "—"}, nível ${itens[0]?.niv || "—"}, presença ${itens[0]?.pre || "—"}`;
    };
    if (acao === "alteracao") return `Antes: ${desc(a)} | Depois: ${desc(d)}`;
    return desc(acao === "exclusao" ? a : d);
  }
  return resumir(acao, antes, depois);
}

/** Programas (por grupo), módulos e usuários do log, para os filtros da tela. */
export async function opcoesAuditoria() {
  const pool = getPool();
  await prepararBanco(pool);
  const { rows } = await pool.query(
    `SELECT DISTINCT modulo, usr FROM (
       SELECT modulo, usr FROM aud_log UNION ALL SELECT 'Rodadas de Campo', usr FROM rod_log
     ) t`,
  );
  return {
    grupos: GRUPOS_PROGRAMA,
    programas: PROGRAMAS_LOG.map(({ id, grupo, rotulo }) => ({ id, grupo, rotulo })),
    modulos: [...new Set(rows.map((r) => r.modulo))].sort(),
    usuarios: [...new Set(rows.map((r) => r.usr).filter(Boolean))].sort(),
  };
}
