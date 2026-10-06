import type { Pool } from "pg";
import { auditar } from "./auditar";
import { getPool, prepararBanco } from "./db";
import { arredondarDose, normalizarCodigo, validarDosagem, type Dosagem, type ItemDosagem } from "./dosagens";

let preparado: Promise<void> | null = null;

/** Cria a tabela das dosagens (uma linha por insumo do cadastro Material e Insumos). */
export async function prepararDosagens(pool: Pool): Promise<void> {
  await prepararBanco(pool);
  if (!preparado) {
    preparado = pool
      .query(
        `CREATE TABLE IF NOT EXISTS ins_dos (
           cod text PRIMARY KEY, dmin numeric, dmax numeric,
           usr text NOT NULL DEFAULT '', cri_em timestamptz NOT NULL DEFAULT now(),
           atu_usr text, atu_em timestamptz
         )`
      )
      .then(() => undefined)
      .catch((err) => {
        preparado = null;
        throw err;
      });
  }
  await preparado;
}

const FMT_DATA = `'DD/MM/YYYY HH24:MI'`;

/** Item do cadastro Material e Insumos (descrição e unidade de medida), pelo código. */
export async function itemCadastroMaterial(codigo: string): Promise<ItemDosagem | null> {
  const pool = getPool();
  await prepararDosagens(pool);
  const cod = normalizarCodigo(codigo);
  if (!cod) return null;
  const r = (
    await pool.query<{ cod: string; nm: string; un: string | null; grp: string | null }>(
      `SELECT cod, nm, dds->>'unidade_medida_consumo' AS un, dds->>'grupo_de_produto' AS grp
         FROM cad_itm WHERE cad = 'materiais-insumos' AND cod = $1`,
      [cod]
    )
  ).rows[0];
  return r ? { cod: r.cod, ds: r.nm, un: (r.un ?? "").trim(), grp: (r.grp ?? "").trim() } : null;
}

interface Linha {
  cod: string;
  ds: string | null;
  un: string | null;
  grp: string | null;
  dmin: number | null;
  dmax: number | null;
  usr: string;
  cri_em: string;
  atu_usr: string | null;
  atu_em: string | null;
}

function mapa(r: Linha): Dosagem {
  return {
    cod: r.cod,
    ds: r.ds ?? "",
    un: (r.un ?? "").trim(),
    grp: (r.grp ?? "").trim(),
    noCadastro: r.ds !== null,
    min: r.dmin,
    max: r.dmax,
    usr: r.usr,
    criEm: r.cri_em,
    atuUsr: r.atu_usr,
    atuEm: r.atu_em,
  };
}

const SELECT = `SELECT d.cod, c.nm AS ds, c.dds->>'unidade_medida_consumo' AS un, c.dds->>'grupo_de_produto' AS grp,
       d.dmin::float AS dmin, d.dmax::float AS dmax, d.usr,
       to_char(d.cri_em AT TIME ZONE 'America/Sao_Paulo', ${FMT_DATA}) AS cri_em, d.atu_usr,
       to_char(d.atu_em AT TIME ZONE 'America/Sao_Paulo', ${FMT_DATA}) AS atu_em
  FROM ins_dos d LEFT JOIN cad_itm c ON c.cad = 'materiais-insumos' AND c.cod = d.cod`;

export async function listarDosagens(): Promise<Dosagem[]> {
  const pool = getPool();
  await prepararDosagens(pool);
  const { rows } = await pool.query<Linha>(`${SELECT} ORDER BY COALESCE(c.nm, d.cod), d.cod`);
  return rows.map(mapa);
}

export async function obterDosagem(codigo: string): Promise<Dosagem | null> {
  const pool = getPool();
  await prepararDosagens(pool);
  const { rows } = await pool.query<Linha>(`${SELECT} WHERE d.cod = $1`, [normalizarCodigo(codigo)]);
  return rows[0] ? mapa(rows[0]) : null;
}

const unidade = (un: string) => (un ? `${un}/ha` : "por ha");

/** Inclui a dosagem do insumo ou atualiza a que já existe; o insumo precisa estar no cadastro Material e Insumos. */
export async function salvarDosagem(
  codigo: string,
  min: number | null,
  max: number | null,
  usuario: string
): Promise<{ ok: true; criado: boolean; alterado: boolean } | { erro: string }> {
  const pool = getPool();
  await prepararDosagens(pool);
  const erro = validarDosagem(min, max);
  if (erro) return { erro };
  const item = await itemCadastroMaterial(codigo);
  if (!item) {
    return { erro: "Código não encontrado no cadastro Material e Insumos. Confira o código ou importe o cadastro em Configurações › Cadastros." };
  }
  const mn = min === null ? null : arredondarDose(min);
  const mx = max === null ? null : arredondarDose(max);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const ant = (await client.query<{ dmin: number | null; dmax: number | null }>("SELECT dmin::float AS dmin, dmax::float AS dmax FROM ins_dos WHERE cod = $1 FOR UPDATE", [item.cod])).rows[0];
    if (ant && ant.dmin === mn && ant.dmax === mx) {
      await client.query("ROLLBACK");
      return { ok: true, criado: false, alterado: false };
    }
    if (ant) {
      await client.query("UPDATE ins_dos SET dmin = $2, dmax = $3, atu_usr = $4, atu_em = now() WHERE cod = $1", [item.cod, mn, mx, usuario]);
    } else {
      await client.query("INSERT INTO ins_dos (cod, dmin, dmax, usr) VALUES ($1, $2, $3, $4)", [item.cod, mn, mx, usuario]);
    }
    await auditar(client, {
      usuario,
      modulo: "Insumos",
      entidade: "Dosagem",
      chave: `${item.cod} · ${item.ds}`,
      acao: ant ? "alteracao" : "inclusao",
      antes: ant ? { dosagemMinima: ant.dmin, dosagemMaxima: ant.dmax, unidade: unidade(item.un) } : undefined,
      depois: { dosagemMinima: mn, dosagemMaxima: mx, unidade: unidade(item.un) },
    });
    await client.query("COMMIT");
    return { ok: true, criado: !ant, alterado: true };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function excluirDosagem(codigo: string, usuario: string): Promise<true | { erro: string }> {
  const pool = getPool();
  await prepararDosagens(pool);
  const atual = await obterDosagem(codigo);
  if (!atual) return { erro: "Dosagem não encontrada." };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM ins_dos WHERE cod = $1", [atual.cod]);
    await auditar(client, {
      usuario,
      modulo: "Insumos",
      entidade: "Dosagem",
      chave: `${atual.cod} · ${atual.ds || "fora do cadastro"}`,
      acao: "exclusao",
      antes: { dosagemMinima: atual.min, dosagemMaxima: atual.max, unidade: unidade(atual.un) },
    });
    await client.query("COMMIT");
    return true;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
