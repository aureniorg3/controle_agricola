import type { Pool } from "pg";
import { auditar } from "./auditar";
import { getPool, prepararBanco } from "./db";
import { prepararDosagens } from "./db-dosagens";
import { prepararInsumos } from "./db-insumos";
import { round, type ItemEstoque, type LinhaEstoque, type RelatorioEstoque } from "./estoque-insumos";
import semente from "./estoque-insumos-seed.json";

let preparado: Promise<void> | null = null;

/** Estoque físico por empresa e data do relatório (um retrato por empresa + data) e a carga do histórico. */
export async function prepararEstoque(pool: Pool = getPool()): Promise<void> {
  await prepararBanco(pool);
  if (!preparado) {
    preparado = (async () => {
      await pool.query(
        `CREATE TABLE IF NOT EXISTS est_ins (
           emp integer NOT NULL, dt date NOT NULL, cod text NOT NULL,
           grp text NOT NULL DEFAULT '', ds text NOT NULL DEFAULT '', un text NOT NULL DEFAULT '',
           est numeric NOT NULL DEFAULT 0, vr numeric NOT NULL DEFAULT 0, disp numeric NOT NULL DEFAULT 0, vr_disp numeric NOT NULL DEFAULT 0,
           -- dosagem que estava na planilha do histórico (vale quando o insumo não tem Dosagem cadastrada)
           dose_hist numeric,
           origem text NOT NULL DEFAULT 'importacao', imp_em timestamptz NOT NULL DEFAULT now(), usr text NOT NULL DEFAULT '',
           PRIMARY KEY (emp, dt, cod)
         )`
      );
      await pool.query("CREATE INDEX IF NOT EXISTS idx_est_ins_dt ON est_ins (dt)");
      await carregarHistorico(pool);
    })().catch((err) => {
      preparado = null;
      throw err;
    });
  }
  await preparado;
}

const MARCA = "Carga inicial · 3. Estoque - Empresa 5 e 6 (Base_Estoque)";

/**
 * Carga única do histórico da planilha (aba Base_Estoque, 28/07 a 08/10/2026), lançado como empresa 5.
 * Roda uma vez (o log guarda a marca) e não sobrescreve retratos já importados do sistema.
 */
async function carregarHistorico(pool: Pool): Promise<void> {
  try {
    const marcada = async (exec: Pick<Pool, "query">) =>
      ((await exec.query("SELECT 1 FROM aud_log WHERE modulo = 'Insumos' AND entidade = 'Estoque Insumos' AND chave = $1 LIMIT 1", [MARCA])).rowCount ?? 0) > 0;
    if (await marcada(pool)) return;
    const itens = semente as { dt: string; grp: string; cod: string; ds: string; un: string; est: number; vr: number; disp: number; vrDisp: number; dose: number | null }[];
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext('est_ins_carga_inicial'))");
      if (await marcada(client)) {
        await client.query("ROLLBACK");
        return;
      }
      const r = await client.query(
        `INSERT INTO est_ins (emp, dt, cod, grp, ds, un, est, vr, disp, vr_disp, dose_hist, origem, usr)
         SELECT 5, x.dt, x.cod, x.grp, x.ds, x.un, x.est, x.vr, x.disp, x."vrDisp", x.dose, 'historico', 'Carga inicial'
           FROM jsonb_to_recordset($1::jsonb) AS x(dt date, cod text, grp text, ds text, un text, est numeric, vr numeric, disp numeric, "vrDisp" numeric, dose numeric)
         ON CONFLICT (emp, dt, cod) DO NOTHING`,
        [JSON.stringify(itens)]
      );
      await auditar(client, {
        usuario: "Carga inicial",
        modulo: "Insumos",
        entidade: "Estoque Insumos",
        chave: MARCA,
        acao: "importacao",
        depois: { empresa: 5, linhas: itens.length, carregadas: r.rowCount ?? 0, datas: new Set(itens.map((i) => i.dt)).size },
      });
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("Carga inicial do estoque de insumos não concluída:", err);
  }
}

/** Grava o retrato de uma empresa numa data: o que havia dessa empresa + data é substituído pelo arquivo. */
export async function importarEstoque(emp: number, dt: string, itens: ItemEstoque[], usuario: string, arquivo: string): Promise<{ itens: number; substituiu: number }> {
  const pool = getPool();
  await prepararEstoque(pool);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // a dosagem do histórico continua valendo para os mesmos produtos
    const doses = new Map(
      (await client.query<{ cod: string; d: number }>("SELECT DISTINCT ON (cod) cod, dose_hist::float AS d FROM est_ins WHERE dose_hist IS NOT NULL ORDER BY cod, dt DESC")).rows.map(
        (r) => [r.cod, r.d]
      )
    );
    const del = await client.query("DELETE FROM est_ins WHERE emp = $1 AND dt = $2", [emp, dt]);
    await client.query(
      `INSERT INTO est_ins (emp, dt, cod, grp, ds, un, est, vr, disp, vr_disp, dose_hist, origem, usr)
       SELECT $1, $2::date, x.cod, x.grp, x.ds, x.un, x.est, x.vr, x.disp, x."vrDisp", x.dose, 'importacao', $4
         FROM jsonb_to_recordset($3::jsonb) AS x(cod text, grp text, ds text, un text, est numeric, vr numeric, disp numeric, "vrDisp" numeric, dose numeric)`,
      [emp, dt, JSON.stringify(itens.map((i) => ({ ...i, dose: doses.get(i.cod) ?? null }))), usuario]
    );
    await auditar(client, {
      usuario,
      modulo: "Insumos",
      entidade: "Estoque Insumos",
      chave: `Empresa ${emp} · ${dt.split("-").reverse().join("/")} · ${arquivo}`,
      acao: "importacao",
      depois: { empresa: emp, data: dt, itens: itens.length, substituidos: del.rowCount ?? 0 },
    });
    await client.query("COMMIT");
    return { itens: itens.length, substituiu: del.rowCount ?? 0 };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export interface FiltroEstoque {
  dt?: string;
  /** vazio = todas */
  empresas?: number[];
  /** vazio = todos */
  grupos?: string[];
  q?: string;
}

/** Relatório do estoque numa data (a mais recente se não informada), somando as empresas escolhidas. */
export async function relatorioEstoque(f: FiltroEstoque): Promise<RelatorioEstoque> {
  const pool = getPool();
  await prepararEstoque(pool);
  await prepararDosagens(pool);
  await prepararInsumos(pool); // nome dos grupos (ins_itm)
  const datas = (await pool.query<{ d: string }>("SELECT DISTINCT dt::text AS d FROM est_ins ORDER BY 1 DESC")).rows.map((r) => r.d);
  const empresas = (await pool.query<{ e: number }>("SELECT DISTINCT emp AS e FROM est_ins ORDER BY 1")).rows.map((r) => r.e);
  const ult = (await pool.query<{ u: string | null }>("SELECT to_char(MAX(imp_em) AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') AS u FROM est_ins")).rows[0].u;
  const grupoDs = new Map(
    (await pool.query<{ grp: string; ds: string }>("SELECT DISTINCT ON (grp) grp, grp_ds AS ds FROM ins_itm WHERE grp <> '' AND grp_ds <> '' ORDER BY grp")).rows.map((r) => [r.grp.trim(), r.ds.trim()])
  );
  const grupos = (await pool.query<{ grp: string }>("SELECT DISTINCT grp FROM est_ins WHERE grp <> '' ORDER BY 1")).rows.map((r) => ({ grp: r.grp, ds: grupoDs.get(r.grp) ?? "" }));
  const dt = f.dt && datas.includes(f.dt) ? f.dt : datas[0] ?? null;
  if (!dt) return { dt: null, dtAnterior: null, datas, empresas, grupos, linhas: [], ultimaImportacao: ult };
  const dtAnterior = datas.find((d) => d < dt) ?? null;

  const cond = ["e.dt = $1"];
  const params: unknown[] = [dt];
  if (f.empresas?.length) {
    params.push(f.empresas);
    cond.push(`e.emp = ANY($${params.length}::int[])`);
  }
  if (f.grupos?.length) {
    params.push(f.grupos);
    cond.push(`e.grp = ANY($${params.length}::text[])`);
  }
  if (f.q?.trim()) {
    params.push(`%${f.q.trim()}%`);
    cond.push(`(e.ds ILIKE $${params.length} OR e.cod ILIKE $${params.length})`);
  }
  const { rows } = await pool.query<{
    grp: string; cod: string; ds: string; un: string; est: number; vr: number; disp: number; dose_hist: number | null; dmax: number | null; ant: number | null;
  }>(
    `SELECT e.grp, e.cod, MAX(e.ds) AS ds, MAX(e.un) AS un, SUM(e.est)::float AS est, SUM(e.vr)::float AS vr, SUM(e.disp)::float AS disp,
            MAX(e.dose_hist)::float AS dose_hist, MAX(d.dmax)::float AS dmax,
            (SELECT SUM(a.disp)::float FROM est_ins a WHERE a.cod = e.cod AND a.dt = $${params.length + 1}::date
                ${f.empresas?.length ? `AND a.emp = ANY($2::int[])` : ""}) AS ant
       FROM est_ins e LEFT JOIN ins_dos d ON d.cod = e.cod
      WHERE ${cond.join(" AND ")}
      GROUP BY e.grp, e.cod
      ORDER BY e.grp, MAX(e.ds)`,
    [...params, dtAnterior]
  );
  const linhas: LinhaEstoque[] = rows.map((r) => {
    // dose do relatório de estoque (a da planilha, como no Resumo_Estoque); produto sem ela usa Insumos › Dosagens (máxima)
    const hist = r.dose_hist !== null && r.dose_hist > 0 ? r.dose_hist : null;
    const dose = hist ?? (r.dmax !== null && r.dmax > 0 ? r.dmax : null);
    return {
      grp: r.grp,
      grpDs: grupoDs.get(r.grp) ?? "",
      cod: r.cod,
      ds: r.ds,
      un: r.un,
      est: round(r.est, 3),
      disp: round(r.disp, 3),
      dif: round(r.disp - r.est, 3),
      vr: round(r.vr),
      vlrUnit: r.est > 0 ? round(r.vr / r.est, 4) : null,
      dose,
      doseOrigem: hist !== null ? "historico" : dose !== null ? "dosagens" : null,
      // como na planilha: hectares que o estoque real cobre (estoque real ÷ dose)
      ha: dose ? round(r.est / dose) : null,
      dispAnterior: dtAnterior ? (r.ant !== null ? round(r.ant, 3) : 0) : null,
    };
  });
  return { dt, dtAnterior, datas, empresas, grupos, linhas, ultimaImportacao: ult };
}
