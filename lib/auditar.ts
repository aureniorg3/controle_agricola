/**
 * Gravação do log de auditoria (sem dependência do banco, para poder ser usada
 * por qualquer módulo, inclusive dentro de transações). A consulta do log está
 * em lib/auditoria.ts.
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

export interface ExecutorSql {
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

export const dataBR = (iso: string): string => (iso ? iso.split("-").reverse().join("/") : "");
