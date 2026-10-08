import type { Pool } from "pg";
import { auditar } from "./auditar";
import { specPorSlug } from "./cadastros-spec";
import { getPool, prepararBanco } from "./db";
import semente from "./cadastros-export-seed.json";

/** Cadastros com carga inicial dos relatórios exportados do sistema (ExportWWT…). */
export const CADASTROS_COM_CARGA_EXPORTADA = ["classificacao-operacoes", "tipos-despesa", "operacoes", "tipo-aplicacao"];

let preparado: Promise<void> | null = null;

/**
 * Carga única de Classificação de Operações, Tipos de Despesa, Operações e Tipo Aplicação a partir dos relatórios
 * exportados do sistema. Roda uma vez por cadastro (o log guarda a marca) e nunca sobrescreve o que já existe.
 * Antes, o Tipo Aplicação passa a ter código + descrição como chave (o relatório repete códigos com descrições diferentes).
 */
export async function carregarCadastrosExportados(pool: Pool = getPool()): Promise<void> {
  await prepararBanco(pool);
  if (!preparado) {
    preparado = (async () => {
      await pool.query(
        `UPDATE cad_itm t SET cod = t.cod || '|' || t.nm
          WHERE t.cad = 'tipo-aplicacao' AND position('|' in t.cod) = 0
            AND NOT EXISTS (SELECT 1 FROM cad_itm x WHERE x.cad = 'tipo-aplicacao' AND x.cod = t.cod || '|' || t.nm)`
      );
      const cargas = semente as Record<string, { arquivo: string; itens: { cod: string; nm: string; dds: Record<string, unknown> }[] }>;
      for (const [cad, { arquivo, itens }] of Object.entries(cargas)) {
        const entidade = `Cadastro de ${specPorSlug(cad)?.titulo ?? cad}`;
        const marca = `Carga inicial · ${arquivo}`;
        try {
          const marcada = async (exec: Pick<Pool, "query">) =>
            ((await exec.query("SELECT 1 FROM aud_log WHERE modulo = 'Cadastros' AND entidade = $1 AND chave = $2 LIMIT 1", [entidade, marca])).rowCount ?? 0) > 0;
          if (await marcada(pool)) continue;
          const client = await pool.connect();
          try {
            await client.query("BEGIN");
            await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`carga_${cad}`]);
            if (await marcada(client)) {
              await client.query("ROLLBACK");
              continue;
            }
            const r = await client.query(
              `INSERT INTO cad_itm (cad, cod, nm, dds, usr, atu_usr)
               SELECT $1, x.cod, x.nm, x.dds, 'Carga inicial', 'Carga inicial' FROM jsonb_to_recordset($2::jsonb) AS x(cod text, nm text, dds jsonb)
               ON CONFLICT (cad, cod) DO NOTHING`,
              [cad, JSON.stringify(itens)]
            );
            await auditar(client, {
              usuario: "Carga inicial",
              modulo: "Cadastros",
              entidade,
              chave: marca,
              acao: "importacao",
              depois: { naPlanilha: itens.length, carregados: r.rowCount ?? 0 },
            });
            await client.query("COMMIT");
          } catch (err) {
            await client.query("ROLLBACK");
            throw err;
          } finally {
            client.release();
          }
        } catch (err) {
          console.error(`Carga inicial de ${cad} não concluída:`, err);
        }
      }
    })().catch((err) => {
      preparado = null;
      throw err;
    });
  }
  await preparado;
}
