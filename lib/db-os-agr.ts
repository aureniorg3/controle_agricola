import { createHash } from "crypto";
import type { Pool } from "pg";
import { nomeOperacao, operacoesDoCadastro } from "./db-operacoes";
import { auditar } from "./auditar";
import { specPorSlug } from "./cadastros-spec";
import { getPool, prepararBanco, sincronizarDescricaoFazendas } from "./db";
import { chaveLinhaOS } from "./import-os-agr";
import {
  agruparPorOS,
  FAIXAS_PADRAO,
  montarPainelOS,
  nomePosicao,
  round2,
  type FaixaDias,
  type LinhaOSAgr,
  type OrdemServicoAgr,
  type OSOperacao,
  type PainelOS,
  type PreviaImportacaoOS,
} from "./os-agr";
import semente from "./os-agr-seed.json";

let preparado: Promise<void> | null = null;

/** Tabelas da base de O.S. (os_agr: linhas; os_agr_os: uma por O.S., com a assinatura do conteúdo) e cargas iniciais. */
export async function prepararOSAgr(pool: Pool = getPool()): Promise<void> {
  await prepararBanco(pool);
  if (!preparado) {
    preparado = (async () => {
      await pool.query(
        `CREATE TABLE IF NOT EXISTS os_agr (
           emp text NOT NULL DEFAULT '', os text NOT NULL, dt_os date, dt_enc date, prev_ini date, prev_fim date,
           prop_cod text NOT NULL, setor text NOT NULL DEFAULT '', prop_nm text NOT NULL DEFAULT '',
           tlh text NOT NULL, letra text NOT NULL DEFAULT '', area_plant numeric, area_rec numeric,
           op_cod text NOT NULL DEFAULT '', op_ds text NOT NULL DEFAULT '', etapa_cod text NOT NULL DEFAULT '', etapa_ds text NOT NULL DEFAULT '',
           cc_cod text NOT NULL DEFAULT '', cc_ds text NOT NULL DEFAULT '', safra text NOT NULL DEFAULT '', ciclo text NOT NULL DEFAULT '',
           posicao text NOT NULL DEFAULT '', mes_exec integer, ano_exec integer, resp_cod text NOT NULL DEFAULT '', resp_nm text NOT NULL DEFAULT '',
           raio text NOT NULL DEFAULT '', usr_os text NOT NULL DEFAULT '', obs text NOT NULL DEFAULT '',
           PRIMARY KEY (emp, os, prop_cod, setor, tlh, letra, op_cod)
         )`
      );
      await pool.query("CREATE INDEX IF NOT EXISTS idx_os_agr_os ON os_agr (os)");
      await pool.query("CREATE INDEX IF NOT EXISTS idx_os_agr_dt ON os_agr (dt_os)");
      await pool.query(
        `CREATE TABLE IF NOT EXISTS os_agr_os (
           emp text NOT NULL, os text NOT NULL, hsh text NOT NULL, linhas integer NOT NULL DEFAULT 0,
           cri_em timestamptz NOT NULL DEFAULT now(), atu_em timestamptz NOT NULL DEFAULT now(), atu_usr text NOT NULL DEFAULT '',
           PRIMARY KEY (emp, os)
         )`
      );
      await carregarCadastrosIniciais(pool);
    })().catch((err) => {
      preparado = null;
      throw err;
    });
  }
  await preparado;
}

const MARCA_CARGA = "Carga inicial · Pasta1.xlsx";

/**
 * Carga única dos cadastros de apoio vindos da planilha modelo (Etapa, Tipo Aplicação, Responsáveis) e das faixas de dias
 * padrão. Roda uma vez por cadastro (o log guarda a marca) e nunca sobrescreve o que já existe.
 */
async function carregarCadastrosIniciais(pool: Pool): Promise<void> {
  const cargas = semente as Record<string, { cod: string; nm: string; dds: Record<string, string | number> }[]>;
  for (const [cad, itens] of Object.entries(cargas)) {
    const entidade = `Cadastro de ${specPorSlug(cad)?.titulo ?? cad}`;
    try {
      const marcada = async (exec: Pick<Pool, "query">) =>
        ((await exec.query("SELECT 1 FROM aud_log WHERE modulo = 'Cadastros' AND entidade = $1 AND chave = $2 LIMIT 1", [entidade, MARCA_CARGA])).rowCount ?? 0) > 0;
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
          chave: MARCA_CARGA,
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
}

// ---------------------------------------------------------------------------
// Importação com validação: só substitui as O.S. que mudaram
// ---------------------------------------------------------------------------

const assinatura = (linhas: LinhaOSAgr[]) =>
  createHash("md5")
    .update(JSON.stringify([...linhas].sort((a, b) => chaveLinhaOS(a).localeCompare(chaveLinhaOS(b))).map((l) => Object.values(l))))
    .digest("hex");

interface LinhaBanco {
  emp: string; os: string; dt_os: string | null; dt_enc: string | null; prev_ini: string | null; prev_fim: string | null; prop_cod: string; setor: string;
  prop_nm: string; tlh: string; letra: string; area_plant: number | null; area_rec: number | null; op_cod: string; op_ds: string; etapa_cod: string;
  etapa_ds: string; cc_cod: string; cc_ds: string; safra: string; ciclo: string; posicao: string; mes_exec: number | null; ano_exec: number | null;
  resp_cod: string; resp_nm: string; raio: string; usr_os: string; obs: string;
}
const doBanco = (r: LinhaBanco): LinhaOSAgr => ({
  emp: r.emp, os: r.os, dtOs: r.dt_os, dtEnc: r.dt_enc, prevIni: r.prev_ini, prevFim: r.prev_fim, propCod: r.prop_cod, setor: r.setor, propNm: r.prop_nm,
  tlh: r.tlh, letra: r.letra, areaPlant: r.area_plant, areaRec: r.area_rec, opCod: r.op_cod, opDs: r.op_ds, etapaCod: r.etapa_cod, etapaDs: r.etapa_ds,
  ccCod: r.cc_cod, ccDs: r.cc_ds, safra: r.safra, ciclo: r.ciclo, posicao: r.posicao, mesExec: r.mes_exec, anoExec: r.ano_exec, respCod: r.resp_cod,
  respNm: r.resp_nm, raio: r.raio, usrOs: r.usr_os, obs: r.obs,
});
const COLS_BANCO = `emp, os, dt_os::text AS dt_os, dt_enc::text AS dt_enc, prev_ini::text AS prev_ini, prev_fim::text AS prev_fim, prop_cod, setor, prop_nm,
  tlh, letra, area_plant::float AS area_plant, area_rec::float AS area_rec, op_cod, op_ds, etapa_cod, etapa_ds, cc_cod, cc_ds, safra, ciclo, posicao,
  mes_exec, ano_exec, resp_cod, resp_nm, raio, usr_os, obs`;

const fmtHa = (n: number) => n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Descreve o que mudou numa O.S. (para a prévia) e marca as categorias. */
function compararOS(antigas: LinhaOSAgr[], novas: LinhaOSAgr[]) {
  const cat = { posicao: false, encerrada: false, talhoes: false, areas: false, outros: false };
  const partes: string[] = [];
  const pa = antigas[0]?.posicao ?? "";
  const pn = novas[0]?.posicao ?? "";
  if (pa !== pn) {
    cat.posicao = true;
    if (pn === "E") cat.encerrada = true;
    partes.push(`posição ${nomePosicao(pa)} → ${nomePosicao(pn)}`);
  }
  const mA = new Map(antigas.map((l) => [chaveLinhaOS(l), l]));
  const mN = new Map(novas.map((l) => [chaveLinhaOS(l), l]));
  const incluidos = [...mN.keys()].filter((k) => !mA.has(k)).length;
  const removidos = [...mA.keys()].filter((k) => !mN.has(k)).length;
  if (incluidos || removidos) {
    cat.talhoes = true;
    if (incluidos) partes.push(`${incluidos} talhão(ões) incluído(s)`);
    if (removidos) partes.push(`${removidos} talhão(ões) retirado(s)`);
  }
  const soma = (ls: LinhaOSAgr[]) => round2(ls.reduce((a, l) => a + (l.areaRec ?? 0), 0));
  let difArea = false;
  for (const [k, n] of mN) {
    const a = mA.get(k);
    if (a && (Math.abs((a.areaRec ?? 0) - (n.areaRec ?? 0)) > 0.004 || Math.abs((a.areaPlant ?? 0) - (n.areaPlant ?? 0)) > 0.004)) difArea = true;
  }
  if (difArea) {
    cat.areas = true;
    partes.push(`área recomendada ${fmtHa(soma(antigas))} → ${fmtHa(soma(novas))} ha`);
  }
  const a0 = antigas[0];
  const n0 = novas[0];
  if (a0 && n0 && a0.dtEnc !== n0.dtEnc && n0.dtEnc) partes.push(`encerramento ${n0.dtEnc.split("-").reverse().join("/")}`);
  if (!cat.posicao && !cat.talhoes && !cat.areas) {
    cat.outros = true;
    if (partes.length === 0) partes.push("outras informações (datas, responsável, observação…)");
  }
  return { cat, texto: partes.join("; ") };
}

/**
 * Confere o arquivo contra a base. Cada O.S. do arquivo é comparada pela assinatura do conteúdo: as novas entram, as que
 * mudaram são substituídas por inteiro e as iguais ficam como estão; O.S. da base que não vieram no arquivo também ficam.
 * Com `aplicar = false` só devolve a prévia.
 */
export async function importarOSAgr(
  linhas: LinhaOSAgr[],
  info: { repetidas: number; periodo: string; arquivo: string },
  usuario: string,
  aplicar: boolean
): Promise<PreviaImportacaoOS> {
  const pool = getPool();
  await prepararOSAgr(pool);
  const porOS = new Map<string, LinhaOSAgr[]>();
  for (const l of linhas) {
    const k = `${l.emp}|${l.os}`;
    if (!porOS.has(k)) porOS.set(k, []);
    porOS.get(k)!.push(l);
  }
  const chaves = [...porOS.keys()];
  const hashes = new Map([...porOS].map(([k, ls]) => [k, assinatura(ls)]));
  const existentes = new Map(
    (await pool.query<{ k: string; hsh: string }>("SELECT emp || '|' || os AS k, hsh FROM os_agr_os WHERE (emp || '|' || os) = ANY($1::text[])", [chaves])).rows.map(
      (r) => [r.k, r.hsh]
    )
  );
  const novas = chaves.filter((k) => !existentes.has(k));
  const alteradas = chaves.filter((k) => existentes.has(k) && existentes.get(k) !== hashes.get(k));
  const iguais = chaves.length - novas.length - alteradas.length;
  const fora = (await pool.query<{ n: number }>("SELECT COUNT(*)::int AS n FROM os_agr_os WHERE NOT ((emp || '|' || os) = ANY($1::text[]))", [chaves])).rows[0].n;

  const mudancas = { posicao: 0, encerradas: 0, talhoes: 0, areas: 0, outros: 0 };
  const exemplos: { os: string; texto: string }[] = [];
  if (alteradas.length > 0) {
    const antigas = new Map<string, LinhaOSAgr[]>();
    for (const r of (await pool.query<LinhaBanco>(`SELECT ${COLS_BANCO} FROM os_agr WHERE (emp || '|' || os) = ANY($1::text[])`, [alteradas])).rows) {
      const k = `${r.emp}|${r.os}`;
      if (!antigas.has(k)) antigas.set(k, []);
      antigas.get(k)!.push(doBanco(r));
    }
    for (const k of alteradas.sort((a, b) => Number(b.split("|")[1]) - Number(a.split("|")[1]))) {
      const { cat, texto } = compararOS(antigas.get(k) ?? [], porOS.get(k)!);
      if (cat.posicao) mudancas.posicao++;
      if (cat.encerrada) mudancas.encerradas++;
      if (cat.talhoes) mudancas.talhoes++;
      if (cat.areas) mudancas.areas++;
      if (cat.outros) mudancas.outros++;
      if (exemplos.length < 40) exemplos.push({ os: k.split("|")[1], texto });
    }
  }
  const previa: PreviaImportacaoOS = {
    arquivo: { linhas: linhas.length, ordens: chaves.length, repetidas: info.repetidas, periodo: info.periodo },
    novas: novas.length,
    alteradas: alteradas.length,
    iguais,
    foraDoArquivo: fora,
    mudancas,
    exemplos,
  };
  if (!aplicar) return previa;

  const gravar = [...novas, ...alteradas];
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('os_agr_importacao'))");
    if (gravar.length > 0) {
      await client.query("DELETE FROM os_agr WHERE (emp || '|' || os) = ANY($1::text[])", [gravar]);
      const lin = gravar.flatMap((k) => porOS.get(k)!);
      for (let i = 0; i < lin.length; i += 2000) {
        await client.query(
          `INSERT INTO os_agr (emp, os, dt_os, dt_enc, prev_ini, prev_fim, prop_cod, setor, prop_nm, tlh, letra, area_plant, area_rec, op_cod, op_ds,
                               etapa_cod, etapa_ds, cc_cod, cc_ds, safra, ciclo, posicao, mes_exec, ano_exec, resp_cod, resp_nm, raio, usr_os, obs)
           SELECT emp, os, "dtOs", "dtEnc", "prevIni", "prevFim", "propCod", setor, "propNm", tlh, letra, "areaPlant", "areaRec", "opCod", "opDs",
                  "etapaCod", "etapaDs", "ccCod", "ccDs", safra, ciclo, posicao, "mesExec", "anoExec", "respCod", "respNm", raio, "usrOs", obs
             FROM jsonb_to_recordset($1::jsonb) AS x(emp text, os text, "dtOs" date, "dtEnc" date, "prevIni" date, "prevFim" date, "propCod" text, setor text,
                  "propNm" text, tlh text, letra text, "areaPlant" numeric, "areaRec" numeric, "opCod" text, "opDs" text, "etapaCod" text, "etapaDs" text,
                  "ccCod" text, "ccDs" text, safra text, ciclo text, posicao text, "mesExec" integer, "anoExec" integer, "respCod" text, "respNm" text,
                  raio text, "usrOs" text, obs text)
           ON CONFLICT DO NOTHING`,
          [JSON.stringify(lin.slice(i, i + 2000))]
        );
      }
      await client.query(
        `INSERT INTO os_agr_os (emp, os, hsh, linhas, atu_usr)
         SELECT split_part(k, '|', 1), split_part(k, '|', 2), h, n, $4 FROM unnest($1::text[], $2::text[], $3::int[]) AS u(k, h, n)
         ON CONFLICT (emp, os) DO UPDATE SET hsh = EXCLUDED.hsh, linhas = EXCLUDED.linhas, atu_em = now(), atu_usr = EXCLUDED.atu_usr`,
        [gravar, gravar.map((k) => hashes.get(k)!), gravar.map((k) => porOS.get(k)!.length), usuario]
      );
    }
    await auditar(client, {
      usuario,
      modulo: "Ordem de Serviço Agr.",
      entidade: "Base de O.S.",
      chave: `Importação de ${info.arquivo}`,
      acao: "importacao",
      depois: {
        periodo: info.periodo || undefined,
        linhas: linhas.length,
        ordensNoArquivo: chaves.length,
        novas: novas.length,
        substituidas: alteradas.length,
        semAlteracao: iguais,
        mantidasForaDoArquivo: fora,
        mudancas,
      },
    });
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  // a descrição da fazenda vem do Cadastro de Fazenda
  await sincronizarDescricaoFazendas();
  return previa;
}

// ---------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------

export interface FiltroOS {
  de?: string;
  ate?: string;
  safra?: string;
  resp?: string;
  etapa?: string;
  op?: string;
  /** A | L | E | aberto (A + L) */
  posicao?: string;
  q?: string;
}

const hojeSql = "(now() AT TIME ZONE 'America/Sao_Paulo')::date";

async function hoje(pool: Pool): Promise<string> {
  return (await pool.query<{ d: string }>(`SELECT ${hojeSql}::text AS d`)).rows[0].d;
}

export async function faixasDias(pool: Pool = getPool()): Promise<FaixaDias[]> {
  const { rows } = await pool.query<{ cod: string; nm: string; dds: Record<string, unknown> }>("SELECT cod, nm, dds FROM cad_itm WHERE cad = 'faixas-dias-os'");
  const n = (v: unknown) => (v === "" || v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));
  const faixas = rows
    .map((r) => ({ faixa: n(r.dds.faixa) ?? (Number(r.cod) || 0), descricao: r.nm || String(r.dds.descricao ?? r.cod), de: n(r.dds.de_dias) ?? 0, ate: n(r.dds.ate_dias) }))
    .sort((a, b) => a.de - b.de || a.faixa - b.faixa);
  return faixas.length ? faixas : FAIXAS_PADRAO;
}

async function responsaveisCadastro(pool: Pool): Promise<Map<string, { nome: string; area: string }>> {
  const { rows } = await pool.query<{ cod: string; nm: string; area: string | null }>("SELECT cod, nm, dds->>'area' AS area FROM cad_itm WHERE cad = 'responsaveis-os'");
  return new Map(rows.map((r) => [r.cod, { nome: r.nm, area: r.area ?? "" }]));
}

async function operacoesFiltradas(pool: Pool, f: FiltroOS): Promise<OSOperacao[]> {
  const cond: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, v: unknown) => {
    params.push(v);
    cond.push(sql.replaceAll("?", `$${params.length}`));
  };
  if (f.de) add("dt_os >= ?::date", f.de);
  if (f.ate) add("dt_os <= ?::date", f.ate);
  if (f.safra) add("safra = ?", f.safra);
  if (f.resp) add("resp_cod = ?", f.resp);
  if (f.etapa) add("etapa_cod = ?", f.etapa);
  if (f.op) add("op_cod = ?", f.op);
  if (f.posicao === "aberto") cond.push("posicao <> 'E'");
  else if (f.posicao) add("posicao = ?", f.posicao);
  if (f.q && f.q.trim()) {
    const q = f.q.trim();
    add("(os = ? OR prop_cod = ? OR prop_nm ILIKE '%' || ? || '%' OR op_ds ILIKE '%' || ? || '%' OR resp_nm ILIKE '%' || ? || '%')", q);
  }
  const { rows } = await pool.query<{
    emp: string; os: string; op_cod: string; op_ds: string; etapa_cod: string; etapa_ds: string; resp_cod: string; resp_nm: string; posicao: string;
    dt_os: string | null; dt_enc: string | null; prev_fim: string | null; usr_os: string; safra: string; n_tlh: number; area_rec: number | null;
    area_plant: number | null; fazendas: string[];
  }>(
    `SELECT emp, os, op_cod, MAX(op_ds) AS op_ds, MAX(etapa_cod) AS etapa_cod, MAX(etapa_ds) AS etapa_ds, MAX(resp_cod) AS resp_cod, MAX(resp_nm) AS resp_nm,
            MIN(posicao) AS posicao, MIN(dt_os)::text AS dt_os, MAX(dt_enc)::text AS dt_enc, MAX(prev_fim)::text AS prev_fim, MAX(usr_os) AS usr_os,
            MAX(safra) AS safra, COUNT(*)::int AS n_tlh, SUM(area_rec)::float AS area_rec, SUM(area_plant)::float AS area_plant,
            array_agg(DISTINCT prop_cod || ' · ' || prop_nm) AS fazendas
       FROM os_agr ${cond.length ? `WHERE ${cond.join(" AND ")}` : ""}
      GROUP BY emp, os, op_cod`,
    params
  );
  // nome da operação pelo cadastro Operações
  const cadOps = await operacoesDoCadastro(pool);
  return rows.map((r) => ({
    emp: r.emp, os: r.os, opCod: r.op_cod, opDs: nomeOperacao(cadOps, r.op_cod, r.op_ds), etapaCod: r.etapa_cod, etapaDs: r.etapa_ds, respCod: r.resp_cod, respNm: r.resp_nm,
    posicao: r.posicao, dtOs: r.dt_os, dtEnc: r.dt_enc, prevFim: r.prev_fim, usrOs: r.usr_os, safra: r.safra, nTlh: r.n_tlh,
    areaRec: round2(r.area_rec ?? 0), areaPlant: round2(r.area_plant ?? 0), fazendas: r.fazendas ?? [],
  }));
}

export interface OpcoesOS {
  safras: string[];
  responsaveis: { cod: string; nome: string }[];
  etapas: { cod: string; nome: string }[];
  operacoes: { cod: string; nome: string }[];
  faixas: FaixaDias[];
  ultimaImportacao: string | null;
  ordens: number;
}

export async function opcoesOS(): Promise<OpcoesOS> {
  const pool = getPool();
  await prepararOSAgr(pool);
  const [s, r, e, o, u, faixas] = await Promise.all([
    pool.query<{ v: string }>("SELECT DISTINCT safra AS v FROM os_agr WHERE safra <> '' ORDER BY 1 DESC"),
    pool.query<{ cod: string; nome: string }>("SELECT resp_cod AS cod, MAX(resp_nm) AS nome FROM os_agr WHERE resp_cod NOT IN ('', '0') GROUP BY resp_cod ORDER BY 2"),
    pool.query<{ cod: string; nome: string }>("SELECT etapa_cod AS cod, MAX(etapa_ds) AS nome FROM os_agr WHERE etapa_cod <> '' GROUP BY etapa_cod ORDER BY 1"),
    pool.query<{ cod: string; nome: string }>("SELECT op_cod AS cod, MAX(op_ds) AS nome FROM os_agr WHERE op_cod <> '' GROUP BY op_cod ORDER BY 2"),
    pool.query<{ ult: string | null; n: number }>(
      "SELECT to_char(MAX(atu_em) AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') AS ult, COUNT(*)::int AS n FROM os_agr_os"
    ),
    faixasDias(pool),
  ]);
  const cadOps = await operacoesDoCadastro(pool);
  return {
    safras: s.rows.map((x) => x.v),
    responsaveis: r.rows,
    etapas: e.rows,
    operacoes: o.rows.map((x) => ({ cod: x.cod, nome: nomeOperacao(cadOps, x.cod, x.nome) })).sort((a, b) => a.nome.localeCompare(b.nome)),
    faixas,
    ultimaImportacao: u.rows[0].ult,
    ordens: u.rows[0].n,
  };
}

/** Lista de O.S. (uma linha por O.S.), com os filtros de faixa de dias e atraso aplicados depois de agrupar. */
export async function listarOrdensOS(f: FiltroOS & { faixa?: string; atrasadas?: boolean }): Promise<OrdemServicoAgr[]> {
  const pool = getPool();
  await prepararOSAgr(pool);
  const [ops, faixas, dia] = await Promise.all([operacoesFiltradas(pool, f), faixasDias(pool), hoje(pool)]);
  let lista = agruparPorOS(ops, faixas, dia);
  if (f.faixa) lista = lista.filter((o) => o.faixa === f.faixa);
  if (f.atrasadas) lista = lista.filter((o) => o.atrasada);
  return lista;
}

export async function painelOS(f: FiltroOS): Promise<PainelOS & { hoje: string }> {
  const pool = getPool();
  await prepararOSAgr(pool);
  const [ops, faixas, resp, dia] = await Promise.all([operacoesFiltradas(pool, f), faixasDias(pool), responsaveisCadastro(pool), hoje(pool)]);
  return { ...montarPainelOS(agruparPorOS(ops, faixas, dia), faixas, resp), hoje: dia };
}

/** Talhões de uma O.S. (para abrir a linha na lista). */
export async function talhoesDaOS(emp: string, os: string): Promise<LinhaOSAgr[]> {
  const pool = getPool();
  await prepararOSAgr(pool);
  const { rows } = await pool.query<LinhaBanco>(
    `SELECT ${COLS_BANCO} FROM os_agr WHERE emp = $1 AND os = $2
      ORDER BY op_cod, prop_cod, CASE WHEN tlh ~ '^[0-9]+$' THEN lpad(tlh, 8, '0') ELSE tlh END, letra`,
    [emp, os]
  );
  return rows.map(doBanco);
}
