import { getPool, prepararBanco } from "./db";

/**
 * Auditoria geral do sistema: cada lançamento, alteração, exclusão ou
 * importação grava quem fez, quando e o conteúdo antes e depois. Vale para
 * todos os módulos; o log dos boletins das Rodadas de Campo (rod_log) entra na
 * mesma consulta.
 */

export type AcaoAuditoria = "inclusao" | "alteracao" | "exclusao" | "importacao" | "limpeza";

export interface EventoAuditoria {
  usuario: string;
  modulo: string;
  /** o que foi mexido: "Meta", "Cadastro de Região", "Área colhida"... */
  entidade: string;
  /** identificação do registro (ex.: "FRENTE I · 07/04/2026") */
  chave: string;
  acao: AcaoAuditoria;
  antes?: unknown;
  depois?: unknown;
}

interface ExecutorSql {
  query: (texto: string, params?: unknown[]) => Promise<unknown>;
}

/** Grava o evento. Passe o `client` da transação para o log ficar junto da alteração (ou o pool, fora de transação). */
export async function auditar(exec: ExecutorSql, e: EventoAuditoria): Promise<void> {
  await exec.query("INSERT INTO aud_log (usr, modulo, entidade, chave, acao, antes, depois) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)", [
    e.usuario,
    e.modulo,
    e.entidade,
    e.chave,
    e.acao,
    e.antes === undefined || e.antes === null ? null : JSON.stringify(e.antes),
    e.depois === undefined || e.depois === null ? null : JSON.stringify(e.depois),
  ]);
}

export interface RegistroAuditoria {
  id: string;
  /** "YYYY-MM-DDTHH:MM:SS" no horário de Brasília */
  em: string;
  usuario: string;
  modulo: string;
  entidade: string;
  chave: string;
  acao: string;
  resumo: string;
}

export interface FiltroAuditoria {
  modulo?: string;
  usuario?: string;
  q?: string;
  de?: string;
  ate?: string;
  /** só o histórico de um registro */
  entidade?: string;
  chave?: string;
}

const ROTULO_ACAO: Record<string, string> = {
  inclusao: "Inclusão",
  alteracao: "Alteração",
  exclusao: "Exclusão",
  importacao: "Importação",
  limpeza: "Limpeza",
};

function texto(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    return Object.entries(v as Record<string, unknown>)
      .filter(([, x]) => x !== null && x !== undefined && x !== "" && typeof x !== "object")
      .map(([k, x]) => `${k}: ${x}`)
      .join(", ");
  }
  return String(v);
}

function resumir(acao: string, antes: unknown, depois: unknown): string {
  if (acao === "alteracao") return `Antes: ${texto(antes)} | Depois: ${texto(depois)}`;
  return texto(acao === "exclusao" ? antes : depois);
}

/**
 * Lista o log (mais recente primeiro): aud_log + os boletins das Rodadas de Campo (rod_log).
 */
export async function listarAuditoria(f: FiltroAuditoria, limite = 300): Promise<RegistroAuditoria[]> {
  const pool = getPool();
  await prepararBanco(pool);
  return montarConsulta(pool, f, limite);
}

async function montarConsulta(pool: ReturnType<typeof getPool>, f: FiltroAuditoria, limite: number): Promise<RegistroAuditoria[]> {
  const cond: string[] = [];
  const params: unknown[] = [];
  const p = (v: unknown) => {
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
  const { rows } = await pool.query<{
    id: string; em_txt: string; usr: string; modulo: string; entidade: string; chave: string; acao: string; antes: unknown; depois: unknown;
  }>(
    `SELECT id, to_char(em AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI:SS') AS em_txt, usr, modulo, entidade, chave, acao, antes, depois FROM (
       SELECT 'a' || id AS id, em, usr, modulo, entidade, chave, acao, antes, depois FROM aud_log
       UNION ALL
       SELECT 'b' || id, em, usr, 'Rodadas de Campo', 'Boletim', bol::text, acao, antes, depois FROM rod_log
     ) t ${where} ORDER BY em DESC, id DESC LIMIT ${Math.max(1, Math.min(limite, 1000))}`,
    params
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

function resumirAuditoria(acao: string, antes: unknown, depois: unknown): string {
  const a = antes as { itens?: unknown } | null;
  const d = depois as { itens?: unknown } | null;
  // boletim: o resumo do próprio boletim (rod_log guarda o boletim inteiro)
  if ((a && "itens" in a) || (d && "itens" in d)) {
    const desc = (b: { rod?: number; sem?: number; reg?: string; faz?: string; itens?: { tlh: string; oco: string; ocoTxt: string }[] } | null) =>
      b ? `Rodada ${b.rod}, semana ${b.sem}, região ${b.reg}, fazenda ${b.faz}, talhões ${(b.itens ?? []).map((i) => i.tlh).join(", ")}` : "";
    if (acao === "alteracao") return `Antes: ${desc(a as never)} | Depois: ${desc(d as never)}`;
    return desc((acao === "exclusao" ? a : d) as never);
  }
  return resumir(acao, antes, depois);
}

/** Módulos e usuários que aparecem no log (para os filtros da tela). */
export async function opcoesAuditoria(): Promise<{ modulos: string[]; usuarios: string[] }> {
  const pool = getPool();
  await prepararBanco(pool);
  const { rows } = await pool.query<{ modulo: string; usr: string }>(
    `SELECT DISTINCT modulo, usr FROM (
       SELECT modulo, usr FROM aud_log UNION ALL SELECT 'Rodadas de Campo', usr FROM rod_log
     ) t`
  );
  return {
    modulos: [...new Set(rows.map((r) => r.modulo))].sort(),
    usuarios: [...new Set(rows.map((r) => r.usr).filter(Boolean))].sort(),
  };
}
