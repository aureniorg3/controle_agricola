import { auditar } from "./auditar";
import { getPool, prepararBanco } from "./db";

/** Apontamento diário da área colhida (por ordem, talhão e data), com usuário e log. */

export interface ApontamentoArea {
  /** nº do boletim (null nos lançamentos antigos) */
  boletim: number | null;
  ord: string;
  faz: string;
  fazNm: string;
  tlh: string;
  dt: string;
  area: number;
  usuario: string;
  /** "YYYY-MM-DDTHH:MM:SS" (Brasília) */
  criadoEm: string;
  alteradoPor: string;
  alteradoEm: string;
}

export interface FiltroArea {
  ord?: string;
  de?: string;
  ate?: string;
}

const HORA = `to_char(%C AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI:SS')`;

export async function listarAreaColhidaDia(f: FiltroArea, limite = 1000): Promise<ApontamentoArea[]> {
  const pool = getPool();
  await prepararBanco(pool);
  const cond: string[] = [];
  const params: unknown[] = [];
  const p = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };
  if (f.ord) cond.push(`c.ord_num = ${p(f.ord)}`);
  if (f.de) cond.push(`c.dt >= ${p(f.de)}::date`);
  if (f.ate) cond.push(`c.dt <= ${p(f.ate)}::date`);
  const { rows } = await pool.query<{
    bol: number | null; ord_num: string; faz_cod: string; faz_nm: string | null; tlh: string; dt: string; area: number; usr: string; cri: string; atu_usr: string; atu: string;
  }>(
    `SELECT c.bol, c.ord_num, c.faz_cod, t.faz_nm, c.tlh, c.dt, c.area::float AS area, c.usr, ${HORA.replace("%C", "c.cri_em")} AS cri,
            c.atu_usr, ${HORA.replace("%C", "c.atu_em")} AS atu
       FROM col_dia c
       LEFT JOIN tlh t ON t.ord_num = c.ord_num AND t.faz_cod = c.faz_cod AND t.tlh = c.tlh
      ${cond.length ? `WHERE ${cond.join(" AND ")}` : ""}
      ORDER BY c.dt DESC, c.ord_num, c.faz_cod, NULLIF(regexp_replace(c.tlh, '\\D', '', 'g'), '')::bigint NULLS LAST, c.tlh
      LIMIT ${Math.max(1, Math.min(limite, 5000))}`,
    params
  );
  return rows.map((r) => ({
    boletim: r.bol,
    ord: r.ord_num,
    faz: r.faz_cod,
    fazNm: r.faz_nm ?? "",
    tlh: r.tlh,
    dt: r.dt,
    area: r.area,
    usuario: r.usr,
    criadoEm: r.cri,
    alteradoPor: r.atu_usr,
    alteradoEm: r.atu,
  }));
}

export interface ItemArea {
  faz: string;
  tlh: string;
  /** hectares colhidos NESTE dia; 0 ou vazio apaga o lançamento do dia */
  ha: number;
}

const chaveLog = (ord: string, faz: string, tlh: string, dt: string) => `Ordem ${ord} · fazenda ${faz} · talhão ${tlh} · ${dt.split("-").reverse().join("/")}`;

/**
 * Lança (ou corrige) a área colhida de um dia para os talhões da ordem. O total
 * acumulado do talhão (saldo anterior + todos os dias) não pode passar da área
 * do talhão. Cada inclusão, alteração e exclusão vai para o log com o usuário.
 */
export async function gravarAreaColhidaDia(
  ord: string,
  dt: string,
  itens: ItemArea[],
  usuario: string,
  boletim: number
): Promise<{ incluidos: number; alterados: number; removidos: number } | { erro: string }> {
  const pool = getPool();
  await prepararBanco(pool);
  const comBoletim = Number.isInteger(boletim) && boletim > 0;
  if (!comBoletim && itens.some((i) => i.ha > 0)) return { erro: "Informe o número do boletim." };
  const { rows: usado } = await pool.query<{ ord_num: string; dt: string }>(
    "SELECT ord_num, dt::text AS dt FROM col_dia WHERE bol = $1 AND NOT (ord_num = $2 AND dt = $3::date) LIMIT 1",
    [boletim, ord, dt]
  );
  if (comBoletim && usado[0]) {
    return { erro: `O boletim nº ${boletim} já foi usado na ordem ${usado[0].ord_num} em ${usado[0].dt.split("-").reverse().join("/")}. Confira o número.` };
  }
  const { rows: tlhs } = await pool.query<{ faz_cod: string; tlh: string; area_ha: number; area_col_ha: number }>(
    "SELECT faz_cod, tlh, area_ha::float AS area_ha, area_col_ha::float AS area_col_ha FROM tlh WHERE ord_num = $1",
    [ord]
  );
  if (tlhs.length === 0) return { erro: `A ordem ${ord} não existe ou não tem talhões.` };
  const mapa = new Map(tlhs.map((t) => [`${t.faz_cod}|${t.tlh}`, t]));

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let incluidos = 0;
    let alterados = 0;
    let removidos = 0;
    for (const it of itens) {
      const t = mapa.get(`${it.faz}|${it.tlh}`);
      if (!t) {
        await client.query("ROLLBACK");
        return { erro: `O talhão ${it.tlh} (fazenda ${it.faz}) não pertence à ordem ${ord}.` };
      }
      const ha = Number.isFinite(it.ha) && it.ha > 0 ? Math.round(it.ha * 100) / 100 : 0;
      const { rows: atual } = await client.query<{ area: number }>(
        "SELECT area::float AS area FROM col_dia WHERE ord_num = $1 AND faz_cod = $2 AND tlh = $3 AND dt = $4",
        [ord, it.faz, it.tlh, dt]
      );
      const antes = atual[0]?.area ?? 0;
      if (ha === 0 && atual.length === 0) continue;
      if (ha === antes) continue;

      if (ha > 0) {
        const { rows: outros } = await client.query<{ s: number }>(
          "SELECT COALESCE(SUM(area), 0)::float AS s FROM col_dia WHERE ord_num = $1 AND faz_cod = $2 AND tlh = $3 AND dt <> $4",
          [ord, it.faz, it.tlh, dt]
        );
        // compara em centésimos e sem folga: a área colhida não passa da área do talhão nem por 0,01
        const acumulado = Math.round((t.area_col_ha + outros[0].s + ha) * 100) / 100;
        if (acumulado > Math.round(t.area_ha * 100) / 100) {
          await client.query("ROLLBACK");
          return {
            erro: `Talhão ${it.tlh}: a área colhida acumulada (${acumulado.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} ha) passa da área do talhão (${t.area_ha.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} ha).`,
          };
        }
      }

      if (ha === 0) {
        await client.query("DELETE FROM col_dia WHERE ord_num = $1 AND faz_cod = $2 AND tlh = $3 AND dt = $4", [ord, it.faz, it.tlh, dt]);
        removidos++;
        await auditar(client, { usuario, modulo: "Colheita", entidade: "Área colhida", chave: chaveLog(ord, it.faz, it.tlh, dt), acao: "exclusao", antes: { ha: antes } });
      } else if (atual.length === 0) {
        await client.query(
          "INSERT INTO col_dia (ord_num, faz_cod, tlh, dt, area, usr, atu_usr) VALUES ($1,$2,$3,$4,$5,$6,$6)",
          [ord, it.faz, it.tlh, dt, ha, usuario]
        );
        incluidos++;
        await auditar(client, { usuario, modulo: "Colheita", entidade: "Área colhida", chave: chaveLog(ord, it.faz, it.tlh, dt), acao: "inclusao", depois: { ha, boletim } });
      } else {
        await client.query(
          "UPDATE col_dia SET area = $5, atu_usr = $6, atu_em = now() WHERE ord_num = $1 AND faz_cod = $2 AND tlh = $3 AND dt = $4",
          [ord, it.faz, it.tlh, dt, ha, usuario]
        );
        alterados++;
        await auditar(client, { usuario, modulo: "Colheita", entidade: "Área colhida", chave: chaveLog(ord, it.faz, it.tlh, dt), acao: "alteracao", antes: { ha: antes }, depois: { ha, boletim } });
      }
    }
    // o boletim vale para todos os talhões da ordem nesse dia
    if (comBoletim) await client.query("UPDATE col_dia SET bol = $3 WHERE ord_num = $1 AND dt = $2::date AND bol IS DISTINCT FROM $3", [ord, dt, boletim]);
    await client.query("COMMIT");
    return { incluidos, alterados, removidos };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

/** Próximo nº de boletim da área colhida (o maior lançado + 1). */
export async function proximoBoletimArea(): Promise<number> {
  const pool = getPool();
  await prepararBanco(pool);
  return (await pool.query<{ n: number }>("SELECT (COALESCE(MAX(bol), 0) + 1)::int AS n FROM col_dia")).rows[0].n;
}
