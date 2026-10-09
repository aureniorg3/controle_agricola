import { auditar } from "./auditar";
import { getPool, prepararBanco } from "./db";

/** Espaços a tirar das pontas: espaço, tab, quebras de linha e o espaço "duro" (nbsp) que vem do Excel. */
const BRANCOS = `E' \\t\\r\\n' || chr(160)`;

/** Colunas que guardam texto livre de propósito (log, mensagem original) e senha: ficam como estão. */
const IGNORAR = new Set(["aud_log", "usr.sen_hsh", "ap_dia.orig_msg", "ap_dia.orig_chave", "ap_dia.obs"]);

const MARCA = "Limpeza de espaços nas pontas dos códigos e textos (v1)";
let execucao = null;

/**
 * Limpeza única do banco: tira os espaços do começo e do fim de todos os códigos e textos (colunas de texto de todas as
 * tabelas e os campos dos cadastros). Coluna em que a limpeza juntaria dois registros (chave repetida) fica como está e
 * vai para o log. O resultado (quantos registros por coluna) também fica no log.
 */
export async function limparEspacosUmaVez() {
  if (!execucao) {
    execucao = (async () => {
      const pool = getPool();
      await prepararBanco(pool);
      const feita = ((await pool.query("SELECT 1 FROM aud_log WHERE modulo = 'Sistema' AND chave = $1 LIMIT 1", [MARCA])).rowCount ?? 0) > 0;
      if (feita) return;
      const client = await pool.connect();
      const corrigidos = {};
      const conflitos = [];
      try {
        await client.query("SELECT pg_advisory_lock(hashtext('limpeza_espacos'))");
        if (((await client.query("SELECT 1 FROM aud_log WHERE modulo = 'Sistema' AND chave = $1 LIMIT 1", [MARCA])).rowCount ?? 0) > 0) return;
        // cadastros: item com espaço no código cujo código limpo já existe é cópia antiga — sai (e fica no log)
        const removidos = [];
        await client.query("BEGIN");
        try {
          const r = await client.query(
            `DELETE FROM cad_itm t WHERE t.cod <> btrim(t.cod, ${BRANCOS})
                AND EXISTS (SELECT 1 FROM cad_itm x WHERE x.cad = t.cad AND x.cod = btrim(t.cod, ${BRANCOS}))
             RETURNING t.cad, t.cod, t.nm`,
          );
          removidos.push(...r.rows);
          await client.query("COMMIT");
        } catch {
          await client.query("ROLLBACK");
        }
        const { rows: colunas } = await client.query(
          `SELECT table_name AS t, column_name AS c FROM information_schema.columns
            WHERE table_schema = 'public' AND data_type IN ('text', 'character varying') ORDER BY table_name, ordinal_position`,
        );
        for (const { t, c } of colunas) {
          if (IGNORAR.has(t) || IGNORAR.has(`${t}.${c}`)) continue;
          const tq = `"${t.replace(/"/g, '""')}"`;
          const cq = `"${c.replace(/"/g, '""')}"`;
          await client.query("BEGIN");
          try {
            const r = await client.query(`UPDATE ${tq} SET ${cq} = btrim(${cq}, ${BRANCOS}) WHERE ${cq} <> btrim(${cq}, ${BRANCOS})`);
            await client.query("COMMIT");
            if (r.rowCount) corrigidos[`${t}.${c}`] = r.rowCount;
          } catch {
            await client.query("ROLLBACK");
            // a coluna toda não deu (algum registro repetiria a chave): limpa registro a registro e pula só os que conflitam
            const linhas = (await client.query(`SELECT ctid::text AS id FROM ${tq} WHERE ${cq} <> btrim(${cq}, ${BRANCOS}) LIMIT 20000`)).rows;
            let ok = 0;
            let falhas = 0;
            await client.query("BEGIN");
            for (const { id } of linhas) {
              await client.query("SAVEPOINT linha");
              try {
                await client.query(`UPDATE ${tq} SET ${cq} = btrim(${cq}, ${BRANCOS}) WHERE ctid = $1::tid`, [id]);
                await client.query("RELEASE SAVEPOINT linha");
                ok++;
              } catch {
                await client.query("ROLLBACK TO SAVEPOINT linha");
                falhas++;
              }
            }
            await client.query("COMMIT");
            if (ok) corrigidos[`${t}.${c}`] = ok;
            if (falhas) conflitos.push(`${t}.${c} (${falhas} registro(s) repetiriam a chave)`);
          }
        }
        // campos dos cadastros (cad_itm.dds): textos de cada item
        await client.query("BEGIN");
        try {
          const r = await client.query(
            `UPDATE cad_itm SET dds = (
               SELECT jsonb_object_agg(e.key, CASE WHEN jsonb_typeof(e.value) = 'string' THEN to_jsonb(btrim(e.value #>> '{}', ${BRANCOS})) ELSE e.value END)
                 FROM jsonb_each(dds) e)
              WHERE jsonb_typeof(dds) = 'object' AND EXISTS (
               SELECT 1 FROM jsonb_each(dds) e WHERE jsonb_typeof(e.value) = 'string' AND (e.value #>> '{}') <> btrim(e.value #>> '{}', ${BRANCOS}))`,
          );
          await client.query("COMMIT");
          if (r.rowCount) corrigidos["cad_itm.dds (campos dos cadastros)"] = r.rowCount;
        } catch {
          await client.query("ROLLBACK");
          conflitos.push("cad_itm.dds");
        }
        await auditar(client, {
          usuario: "Sistema",
          modulo: "Sistema",
          entidade: "Limpeza de dados",
          chave: MARCA,
          acao: "alteracao",
          depois: {
            registrosCorrigidos: Object.values(corrigidos).reduce((s, n) => s + n, 0),
            porColuna: corrigidos,
            naoLimpas: conflitos.length ? conflitos : undefined,
            copiasComEspacoRemovidas: removidos.length ? removidos.slice(0, 200).map((r) => `${r.cad} · [${r.cod}] ${r.nm}`) : undefined,
          },
        });
      } finally {
        await client.query("SELECT pg_advisory_unlock(hashtext('limpeza_espacos'))").catch(() => {});
        client.release();
      }
    })().catch((err) => {
      execucao = null;
      console.error("Limpeza de espaços não concluída:", err);
    });
  }
  await execucao;
}
