import type { Pool } from "pg";
import { auditar, dataBR } from "./auditar";
import { getPool, prepararBanco } from "./db";
import {
  ASSINANTES_PADRAO,
  round2,
  totalItem,
  validarEmprestimo,
  type EntradaEmprestimo,
  type Emprestimo,
  type FazendaEmprestimo,
  type ItemEmprestimo,
  type StatusEmprestimo,
} from "./emprestimos";
import seed from "./emprestimos-seed.json";

let preparado: Promise<void> | null = null;

/** Cria a tabela dos empréstimos e, só na primeira criação, carrega a base do arquivo "Comunicado de saída de insumo". */
async function preparar(pool: Pool): Promise<void> {
  await prepararBanco(pool);
  if (!preparado) {
    preparado = (async () => {
      const existia = (await pool.query<{ t: string | null }>("SELECT to_regclass('emp_cab')::text AS t")).rows[0].t !== null;
      await pool.query(
        `CREATE TABLE IF NOT EXISTS emp_cab (
           id serial PRIMARY KEY,
           forn_cod text NOT NULL, forn_nm text NOT NULL, doc text NOT NULL DEFAULT '',
           dt date, dt_sol date,
           faz jsonb NOT NULL DEFAULT '[]', vol text NOT NULL DEFAULT '', vol_tp text NOT NULL DEFAULT 'Calda',
           assin jsonb NOT NULL DEFAULT '[]', itens jsonb NOT NULL DEFAULT '[]',
           obs text NOT NULL DEFAULT '', st text NOT NULL DEFAULT 'Aberto',
           dt_bx date, bx_obs text NOT NULL DEFAULT '', ref text NOT NULL DEFAULT '',
           usr text NOT NULL DEFAULT '', cri_em timestamptz NOT NULL DEFAULT now(),
           atu_usr text, atu_em timestamptz
         )`
      );
      if (!existia) {
        for (const e of seed as unknown as SementeEmprestimo[]) {
          const itens = e.itens.map((i) => ({
            cod: i.cod,
            nm: i.nm,
            um: i.um,
            dose: i.dose ?? null,
            qtd: i.qtd ?? 0,
            vu: i.vu ?? 0,
            vt: i.vt ?? totalItem(i.qtd ?? 0, i.vu ?? 0),
          }));
          await pool.query(
            `INSERT INTO emp_cab (forn_cod, forn_nm, doc, dt, dt_sol, faz, vol, vol_tp, assin, itens, obs, ref, usr)
             VALUES ($1,$2,$3,$4,NULL,$5::jsonb,$6,$7,$8::jsonb,$9::jsonb,$10,$11,'Carga inicial')`,
            [
              e.forn_cod,
              e.forn_nm,
              e.doc,
              e.dt,
              JSON.stringify(e.faz),
              e.vol,
              /ton|kg|sc/i.test(e.vol) ? "Insumo" : "Calda",
              JSON.stringify(e.assin?.length ? e.assin : ASSINANTES_PADRAO),
              JSON.stringify(itens),
              e.obs ?? "",
              e.aba,
            ]
          );
        }
      }
    })().catch((err) => {
      preparado = null;
      throw err;
    });
  }
  await preparado;
}

interface SementeEmprestimo {
  aba: string;
  forn_cod: string;
  forn_nm: string;
  doc: string;
  dt: string | null;
  faz: FazendaEmprestimo[];
  vol: string;
  assin: string[];
  obs?: string;
  itens: { cod: string; nm: string; um: string; dose: number | null; qtd: number | null; vu: number | null; vt: number | null }[];
}

interface Linha {
  id: number;
  forn_cod: string;
  forn_nm: string;
  doc: string;
  dt: string | null;
  dt_sol: string | null;
  faz: FazendaEmprestimo[];
  vol: string;
  vol_tp: string;
  assin: string[];
  itens: ItemEmprestimo[];
  obs: string;
  st: string;
  dt_bx: string | null;
  bx_obs: string;
  ref: string;
  usr: string;
  cri_em: string;
  atu_usr: string | null;
  atu_em: string | null;
}

function mapa(r: Linha): Emprestimo {
  return {
    id: r.id,
    fornCod: r.forn_cod,
    fornNm: r.forn_nm,
    doc: r.doc,
    dt: r.dt,
    dtSol: r.dt_sol,
    faz: r.faz,
    vol: r.vol,
    volTipo: r.vol_tp === "Insumo" ? "Insumo" : "Calda",
    assin: r.assin,
    itens: r.itens,
    total: round2(r.itens.reduce((s, i) => s + (i.vt ?? 0), 0)),
    obs: r.obs,
    status: (["Aberto", "Devolvido", "Pago"].includes(r.st) ? r.st : "Aberto") as StatusEmprestimo,
    dtBaixa: r.dt_bx,
    baixaObs: r.bx_obs,
    ref: r.ref,
    usr: r.usr,
    criEm: r.cri_em,
    atuUsr: r.atu_usr,
    atuEm: r.atu_em,
  };
}

const COLUNAS = `id, forn_cod, forn_nm, doc, dt::text AS dt, dt_sol::text AS dt_sol, faz, vol, vol_tp, assin, itens, obs, st,
  dt_bx::text AS dt_bx, bx_obs, ref, usr, cri_em::text AS cri_em, atu_usr, atu_em::text AS atu_em`;

export async function listarEmprestimos(): Promise<Emprestimo[]> {
  const pool = getPool();
  await preparar(pool);
  const { rows } = await pool.query<Linha>(`SELECT ${COLUNAS} FROM emp_cab ORDER BY COALESCE(dt_sol, dt) DESC NULLS LAST, id DESC`);
  return rows.map(mapa);
}

async function obter(pool: Pool, id: number): Promise<Emprestimo | null> {
  const { rows } = await pool.query<Linha>(`SELECT ${COLUNAS} FROM emp_cab WHERE id = $1`, [id]);
  return rows[0] ? mapa(rows[0]) : null;
}

const chaveLog = (e: Emprestimo) => `#${e.id} · ${e.fornNm} · ${e.faz.map((f) => f.cod).join("/")}`;
const resumoLog = (e: Emprestimo) => ({
  fornecedor: `${e.fornCod} ${e.fornNm}`,
  dataSolicitacao: e.dtSol ? dataBR(e.dtSol) : "",
  dataSaida: e.dt ? dataBR(e.dt) : "",
  fazendas: e.faz.map((f) => `${f.cod} ${f.nome}`).join("; "),
  itens: e.itens.map((i) => `${i.nm} ${i.qtd} ${i.um}`).join("; "),
  total: e.total,
  status: e.status,
  dataBaixa: e.dtBaixa ? dataBR(e.dtBaixa) : "",
});

function limpar(e: EntradaEmprestimo): EntradaEmprestimo & { itensCalc: ItemEmprestimo[] } {
  const itens = e.itens.map((i) => ({
    cod: i.cod.trim(),
    nm: i.nm.trim(),
    um: i.um.trim().toUpperCase(),
    dose: i.dose === null || i.dose === undefined || Number.isNaN(i.dose) ? null : i.dose,
    qtd: i.qtd,
    vu: i.vu,
  }));
  return {
    ...e,
    fornCod: e.fornCod.trim(),
    fornNm: e.fornNm.trim(),
    doc: e.doc.trim(),
    faz: e.faz.map((f) => ({ cod: f.cod.trim(), nome: f.nome.trim(), area: f.area ?? null })),
    vol: e.vol.trim(),
    assin: e.assin.map((a) => a.trim()).filter(Boolean),
    obs: e.obs.trim(),
    itens,
    itensCalc: itens.map((i) => ({ ...i, vt: totalItem(i.qtd, i.vu) })),
  };
}

/** Inclui (sem id) ou altera um empréstimo. */
export async function salvarEmprestimo(entrada: EntradaEmprestimo, usuario: string, id?: number): Promise<{ id: number } | { erro: string }> {
  const pool = getPool();
  await preparar(pool);
  const e = limpar(entrada);
  const erro = validarEmprestimo(e, id === undefined);
  if (erro) return { erro };
  const assin = e.assin.length ? e.assin : ASSINANTES_PADRAO;
  const params = [e.fornCod, e.fornNm, e.doc, e.dt, e.dtSol, JSON.stringify(e.faz), e.vol, e.volTipo, JSON.stringify(assin), JSON.stringify(e.itensCalc), e.obs];
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let novoId: number;
    let antesLog: ReturnType<typeof resumoLog> | undefined;
    if (id === undefined) {
      const r = await client.query<{ id: number }>(
        `INSERT INTO emp_cab (forn_cod, forn_nm, doc, dt, dt_sol, faz, vol, vol_tp, assin, itens, obs, usr)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9::jsonb,$10::jsonb,$11,$12) RETURNING id`,
        [...params, usuario]
      );
      novoId = r.rows[0].id;
    } else {
      const atual = await obter(client as unknown as Pool, id);
      if (!atual) {
        await client.query("ROLLBACK");
        return { erro: "Empréstimo não encontrado." };
      }
      antesLog = resumoLog(atual);
      await client.query(
        `UPDATE emp_cab SET forn_cod=$1, forn_nm=$2, doc=$3, dt=$4, dt_sol=$5, faz=$6::jsonb, vol=$7, vol_tp=$8, assin=$9::jsonb,
                itens=$10::jsonb, obs=$11, atu_usr=$12, atu_em=now() WHERE id=$13`,
        [...params, usuario, id]
      );
      novoId = id;
    }
    const depois = await obter(client as unknown as Pool, novoId);
    await auditar(client, {
      usuario,
      modulo: "Insumos",
      entidade: "Empréstimo",
      chave: chaveLog(depois!),
      acao: id === undefined ? "inclusao" : "alteracao",
      antes: antesLog,
      depois: resumoLog(depois!),
    });
    await client.query("COMMIT");
    return { id: novoId };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Dá baixa (devolvido ou pago) ou reabre. */
export async function baixarEmprestimo(
  id: number,
  baixa: { tipo: "Devolvido" | "Pago" | "Aberto"; data?: string; obs?: string },
  usuario: string
): Promise<true | { erro: string }> {
  const pool = getPool();
  await preparar(pool);
  if (baixa.tipo !== "Aberto" && !(baixa.data && /^\d{4}-\d{2}-\d{2}$/.test(baixa.data))) {
    return { erro: "Informe a data da baixa." };
  }
  const antes = await obter(pool, id);
  if (!antes) return { erro: "Empréstimo não encontrado." };
  const aberto = baixa.tipo === "Aberto";
  await pool.query(
    `UPDATE emp_cab SET st=$1, dt_bx=$2, bx_obs=$3, atu_usr=$4, atu_em=now() WHERE id=$5`,
    [baixa.tipo, aberto ? null : baixa.data, aberto ? "" : (baixa.obs ?? "").trim(), usuario, id]
  );
  const depois = await obter(pool, id);
  await auditar(pool, {
    usuario,
    modulo: "Insumos",
    entidade: "Empréstimo",
    chave: chaveLog(antes),
    acao: "alteracao",
    antes: { status: antes.status, dataBaixa: antes.dtBaixa ? dataBR(antes.dtBaixa) : "", observacao: antes.baixaObs },
    depois: { status: depois!.status, dataBaixa: depois!.dtBaixa ? dataBR(depois!.dtBaixa) : "", observacao: depois!.baixaObs },
  });
  return true;
}

export async function excluirEmprestimo(id: number, usuario: string): Promise<true | { erro: string }> {
  const pool = getPool();
  await preparar(pool);
  const antes = await obter(pool, id);
  if (!antes) return { erro: "Empréstimo não encontrado." };
  await pool.query("DELETE FROM emp_cab WHERE id = $1", [id]);
  await auditar(pool, { usuario, modulo: "Insumos", entidade: "Empréstimo", chave: chaveLog(antes), acao: "exclusao", antes: resumoLog(antes) });
  return true;
}
