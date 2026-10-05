import fs from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import type { Pool, PoolClient } from "pg";
import { auditar, dataBR } from "./auditar";
import { getPool, prepararBanco } from "./db";
import { nomeEmpresa, round2, type DepositoInfo, type LinhaArquivoSaldo, type LinhaSaldo, type PontoSerie, type ResultadoSaldo } from "./insumos-saldo";

let preparado: Promise<void> | null = null;

interface Historico {
  itens: Record<string, [string, string, string, string]>;
  almox: Record<string, string>;
  snaps: { e: number; d: string; r: [number, string, number, number, string][] }[];
}

/** Cria as tabelas do saldo de insumos e, só na primeira criação, carrega o histórico diário (seed/insumos-historico.json.gz). */
async function preparar(pool: Pool): Promise<void> {
  await prepararBanco(pool);
  if (!preparado) {
    preparado = (async () => {
      const existia = (await pool.query<{ t: string | null }>("SELECT to_regclass('ins_sld')::text AS t")).rows[0].t !== null;
      await pool.query(
        `CREATE TABLE IF NOT EXISTS ins_itm (
           cod text PRIMARY KEY, ds text NOT NULL DEFAULT '', grp text NOT NULL DEFAULT '', grp_ds text NOT NULL DEFAULT '', un text NOT NULL DEFAULT ''
         )`
      );
      await pool.query(
        `CREATE TABLE IF NOT EXISTS ins_alm (emp int NOT NULL, almx int NOT NULL, nm text NOT NULL DEFAULT '', PRIMARY KEY (emp, almx))`
      );
      await pool.query(
        `CREATE TABLE IF NOT EXISTS ins_sld (
           emp int NOT NULL, dt date NOT NULL, almx int NOT NULL, cod text NOT NULL,
           saldo numeric NOT NULL DEFAULT 0, custo numeric NOT NULL DEFAULT 0, loc text NOT NULL DEFAULT ''
         )`
      );
      await pool.query("CREATE INDEX IF NOT EXISTS ins_sld_dt_emp ON ins_sld (dt, emp)");
      if (!existia) await carregarHistorico(pool);
    })().catch((err) => {
      preparado = null;
      throw err;
    });
  }
  await preparado;
}

async function carregarHistorico(pool: Pool): Promise<void> {
  const arquivo = path.join(process.cwd(), "seed", "insumos-historico.json.gz");
  if (!fs.existsSync(arquivo)) return;
  const h = JSON.parse(gunzipSync(fs.readFileSync(arquivo)).toString("utf8")) as Historico;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const cods = Object.keys(h.itens);
    await client.query(
      `INSERT INTO ins_itm (cod, ds, grp, grp_ds, un)
       SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[]) ON CONFLICT (cod) DO NOTHING`,
      [cods, cods.map((c) => h.itens[c][0]), cods.map((c) => h.itens[c][1]), cods.map((c) => h.itens[c][2]), cods.map((c) => h.itens[c][3])]
    );
    const chaves = Object.keys(h.almox);
    await client.query(
      `INSERT INTO ins_alm (emp, almx, nm) SELECT * FROM unnest($1::int[], $2::int[], $3::text[]) ON CONFLICT (emp, almx) DO NOTHING`,
      [chaves.map((k) => Number(k.split("|")[0])), chaves.map((k) => Number(k.split("|")[1])), chaves.map((k) => h.almox[k])]
    );
    let lote: { e: number; d: string; r: Historico["snaps"][number]["r"][number] }[] = [];
    const gravar = async () => {
      if (lote.length === 0) return;
      await client.query(
        `INSERT INTO ins_sld (emp, dt, almx, cod, saldo, custo, loc)
         SELECT * FROM unnest($1::int[], $2::date[], $3::int[], $4::text[], $5::numeric[], $6::numeric[], $7::text[])`,
        [lote.map((x) => x.e), lote.map((x) => x.d), lote.map((x) => x.r[0]), lote.map((x) => x.r[1]), lote.map((x) => x.r[2]), lote.map((x) => x.r[3]), lote.map((x) => x.r[4])]
      );
      lote = [];
    };
    for (const s of h.snaps) {
      for (const r of s.r) lote.push({ e: s.e, d: s.d, r });
      if (lote.length >= 5000) await gravar();
    }
    await gravar();
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export interface FiltrosSaldo {
  dtBase?: string;
  empresas: number[];
  depositos: number[];
  q: string;
  grupo: string;
  de: string;
  ate: string;
}

/** Dados da tela Resumo: posição na data base (por item, empresa e depósito) e a série diária do período. */
export async function consultarSaldo(f: FiltrosSaldo): Promise<ResultadoSaldo> {
  const pool = getPool();
  await preparar(pool);
  const datas = (await pool.query<{ d: string }>("SELECT DISTINCT dt::text AS d FROM ins_sld ORDER BY 1")).rows.map((r) => r.d);
  const dtBase = f.dtBase && datas.includes(f.dtBase) ? f.dtBase : (datas[datas.length - 1] ?? null);

  const depositos = (
    await pool.query<DepositoInfo>(
      `SELECT s.emp, s.almx, COALESCE(a.nm, '') AS nm FROM (SELECT DISTINCT emp, almx FROM ins_sld) s
         LEFT JOIN ins_alm a ON a.emp = s.emp AND a.almx = s.almx ORDER BY s.almx, s.emp`
    )
  ).rows;
  const grupos = (await pool.query<{ cod: string; ds: string }>(`SELECT DISTINCT grp AS cod, grp_ds AS ds FROM ins_itm WHERE grp <> '' ORDER BY 1`)).rows;

  const termo = f.q.trim();
  const where = `s.emp = ANY($1::int[]) AND s.almx = ANY($2::int[])
     AND ($3 = '' OR i.grp = $3)
     AND ($4 = '' OR s.cod = $4 OR i.ds ILIKE '%' || $4 || '%')`;
  const base = [f.empresas, f.depositos, f.grupo, termo];

  let linhas: LinhaSaldo[] = [];
  if (dtBase) {
    linhas = (
      await pool.query<LinhaSaldo>(
        `SELECT i.grp, i.grp_ds AS "grpDs", s.cod, i.ds, i.un, s.emp, s.almx,
                SUM(s.saldo)::float AS qtd, SUM(s.saldo * s.custo)::float AS valor
           FROM ins_sld s JOIN ins_itm i ON i.cod = s.cod
          WHERE s.dt = $5 AND ${where}
          GROUP BY i.grp, i.grp_ds, s.cod, i.ds, i.un, s.emp, s.almx
         HAVING SUM(s.saldo) <> 0
          ORDER BY i.grp, valor DESC`,
        [...base, dtBase]
      )
    ).rows;
  }

  const dtAnterior =
    f.de && /^\d{4}-\d{2}-\d{2}$/.test(f.de) ? ((await pool.query<{ d: string | null }>("SELECT MAX(dt)::text AS d FROM ins_sld WHERE dt < $1", [f.de])).rows[0].d) : null;
  let serie: PontoSerie[] = [];
  if (f.de && f.ate) {
    serie = (
      await pool.query<PontoSerie>(
        `SELECT s.dt::text AS dt, s.emp, s.almx, SUM(s.saldo * s.custo)::float AS valor
           FROM ins_sld s JOIN ins_itm i ON i.cod = s.cod
          WHERE s.dt BETWEEN COALESCE($5::date, $6::date) AND $7::date AND ${where}
          GROUP BY s.dt, s.emp, s.almx ORDER BY s.dt`,
        [...base, dtAnterior, f.de, f.ate]
      )
    ).rows;
  }
  return { datas, dtBase, depositos, grupos, linhas, serie, dtAnterior };
}

export interface ResultadoImportacaoSaldo {
  empresa: number;
  data: string;
  linhas: number;
  valor: number;
  substituiu: boolean;
}

/** Grava o retrato do dia de uma empresa; se já existir o da mesma empresa e data, é substituído. */
export async function importarSaldoDia(
  empresa: number,
  data: string,
  linhas: LinhaArquivoSaldo[],
  usuario: string
): Promise<ResultadoImportacaoSaldo> {
  const pool = getPool();
  await preparar(pool);
  const valor = round2(linhas.reduce((s, l) => s + l.saldo * l.custo, 0));
  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");
    const antes = (await client.query<{ n: number; v: number }>("SELECT COUNT(*)::int AS n, COALESCE(SUM(saldo * custo), 0)::float AS v FROM ins_sld WHERE emp = $1 AND dt = $2", [empresa, data])).rows[0];
    await client.query("DELETE FROM ins_sld WHERE emp = $1 AND dt = $2", [empresa, data]);

    // itens: o cadastro fica com a descrição/grupo mais recentes
    const porCod = new Map<string, LinhaArquivoSaldo>();
    for (const l of linhas) porCod.set(l.cod, l);
    const cods = Array.from(porCod.keys());
    await client.query(
      `INSERT INTO ins_itm (cod, ds, grp, grp_ds, un)
       SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[])
       ON CONFLICT (cod) DO UPDATE SET ds = EXCLUDED.ds, grp = EXCLUDED.grp, grp_ds = EXCLUDED.grp_ds, un = EXCLUDED.un`,
      [cods, cods.map((c) => porCod.get(c)!.ds), cods.map((c) => porCod.get(c)!.grp), cods.map((c) => porCod.get(c)!.grpDs), cods.map((c) => porCod.get(c)!.un)]
    );
    const porAlm = new Map<number, string>();
    for (const l of linhas) porAlm.set(l.almx, l.almxNm);
    const almxs = Array.from(porAlm.keys());
    await client.query(
      `INSERT INTO ins_alm (emp, almx, nm) SELECT $1::int, a, n FROM unnest($2::int[], $3::text[]) AS u(a, n)
       ON CONFLICT (emp, almx) DO UPDATE SET nm = EXCLUDED.nm`,
      [empresa, almxs, almxs.map((a) => porAlm.get(a)!)]
    );
    await client.query(
      `INSERT INTO ins_sld (emp, dt, almx, cod, saldo, custo, loc)
       SELECT $1::int, $2::date, a, c, s, k, l FROM unnest($3::int[], $4::text[], $5::numeric[], $6::numeric[], $7::text[]) AS u(a, c, s, k, l)`,
      [empresa, data, linhas.map((l) => l.almx), linhas.map((l) => l.cod), linhas.map((l) => l.saldo), linhas.map((l) => l.custo), linhas.map((l) => l.loc)]
    );
    await auditar(client, {
      usuario,
      modulo: "Insumos",
      entidade: "Saldo de insumos",
      chave: `${nomeEmpresa(empresa)} · ${dataBR(data)}`,
      acao: "importacao",
      antes: antes.n > 0 ? { linhas: antes.n, valor: round2(antes.v) } : undefined,
      depois: { linhas: linhas.length, valor },
    });
    await client.query("COMMIT");
    return { empresa, data, linhas: linhas.length, valor, substituiu: antes.n > 0 };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function snapshotsExistentes(chaves: { empresa: number; data: string }[]): Promise<Set<string>> {
  const pool = getPool();
  await preparar(pool);
  if (chaves.length === 0) return new Set();
  const { rows } = await pool.query<{ emp: number; d: string }>(
    `SELECT DISTINCT emp, dt::text AS d FROM ins_sld WHERE (emp, dt) IN (SELECT * FROM unnest($1::int[], $2::date[]))`,
    [chaves.map((c) => c.empresa), chaves.map((c) => c.data)]
  );
  return new Set(rows.map((r) => `${r.emp}|${r.d}`));
}

export interface ItemMaterial {
  cod: string;
  ds: string;
  un: string;
  grp: string;
  /** preço médio do Saldo de Insumos mais recente (CRV-MG primeiro); null se nunca houve saldo */
  preco: number | null;
  precoData: string | null;
}

/** Item do cadastro Material e Insumos + preço médio do último saldo. */
export async function itemMaterial(cod: string): Promise<ItemMaterial | null> {
  const pool = getPool();
  await preparar(pool);
  const c = (
    await pool.query<{ cod: string; nm: string; un: string | null; grp: string | null }>(
      `SELECT cod, nm, dds->>'unidade_medida_consumo' AS un, dds->>'grupo_de_produto' AS grp FROM cad_itm WHERE cad = 'materiais-insumos' AND cod = $1`,
      [cod.trim()]
    )
  ).rows[0];
  if (!c) return null;
  const consulta = (filtroEmp: string, soComSaldo: boolean) =>
    pool.query<{ dt: string; preco: number | null }>(
      `SELECT dt::text AS dt, (SUM(saldo * custo) / NULLIF(SUM(saldo), 0))::float AS preco
         FROM ins_sld WHERE cod = $1 ${filtroEmp} ${soComSaldo ? "AND saldo > 0" : ""}
        GROUP BY dt HAVING SUM(saldo) ${soComSaldo ? "> 0" : "<> 0"} ORDER BY dt DESC LIMIT 1`,
      [cod.trim()]
    );
  let p = (await consulta("AND emp = 5", true)).rows[0] ?? (await consulta("", true)).rows[0];
  if (!p) {
    const u = (await pool.query<{ dt: string; preco: number | null }>(`SELECT dt::text AS dt, custo::float AS preco FROM ins_sld WHERE cod = $1 ORDER BY dt DESC LIMIT 1`, [cod.trim()])).rows[0];
    p = u;
  }
  return { cod: c.cod, ds: c.nm, un: (c.un ?? "").trim(), grp: (c.grp ?? "").trim(), preco: p?.preco ?? null, precoData: p?.dt ?? null };
}

/** Busca no cadastro Material e Insumos por código (começo) ou descrição; insumos agrícolas (grupo 01.02) primeiro. */
export async function buscarMateriais(q: string): Promise<{ cod: string; ds: string; un: string }[]> {
  const pool = getPool();
  await preparar(pool);
  const termo = q.trim().replace(/[%_\\]/g, (ch) => `\\${ch}`);
  if (termo.length < 2) return [];
  const { rows } = await pool.query<{ cod: string; ds: string; un: string | null }>(
    `SELECT cod, nm AS ds, dds->>'unidade_medida_consumo' AS un FROM cad_itm
      WHERE cad = 'materiais-insumos' AND (cod LIKE $1 || '%' OR nm ILIKE '%' || $1 || '%')
      ORDER BY (dds->>'grupo_de_produto' LIKE '01.02%') DESC, nm LIMIT 12`,
    [termo]
  );
  return rows.map((r) => ({ cod: r.cod, ds: r.ds, un: (r.un ?? "").trim() }));
}
