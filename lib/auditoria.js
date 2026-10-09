import { getPool, prepararBanco } from "./db";

/**
 * Auditoria geral do sistema: cada lançamento, alteração, exclusão ou
 * importação grava quem fez, quando e o conteúdo antes e depois. Vale para
 * todos os módulos; o log dos boletins das Rodadas de Campo (rod_log) entra na
 * mesma consulta.
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
       SELECT 'a' || id AS id, em, usr, modulo, entidade, chave, acao, antes, depois FROM aud_log
       UNION ALL
       SELECT 'b' || id, em, usr, 'Rodadas de Campo', 'Boletim', bol::text, acao, antes, depois FROM rod_log
     ) t ${where} ORDER BY em DESC, id DESC LIMIT ${Math.max(1, Math.min(limite, 1000))}`,
    params,
  );
  return rows.map((r) => ({
    id: r.id,
    em: r.em_txt,
    usuario: r.usr,
    modulo: r.modulo,
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
  if ((a && "itens" in a) || (d && "itens" in d)) {
    const desc = (b) =>
      b ? `Rodada ${b.rod}, semana ${b.sem}, região ${b.reg}, fazenda ${b.faz}, talhões ${(b.itens ?? []).map((i) => i.tlh).join(", ")}` : "";
    if (acao === "alteracao") return `Antes: ${desc(a)} | Depois: ${desc(d)}`;
    return desc(acao === "exclusao" ? a : d);
  }
  return resumir(acao, antes, depois);
}

/** Módulos e usuários que aparecem no log (para os filtros da tela). */
export async function opcoesAuditoria() {
  const pool = getPool();
  await prepararBanco(pool);
  const { rows } = await pool.query(
    `SELECT DISTINCT modulo, usr FROM (
       SELECT modulo, usr FROM aud_log UNION ALL SELECT 'Rodadas de Campo', usr FROM rod_log
     ) t`,
  );
  return {
    modulos: [...new Set(rows.map((r) => r.modulo))].sort(),
    usuarios: [...new Set(rows.map((r) => r.usr).filter(Boolean))].sort(),
  };
}
