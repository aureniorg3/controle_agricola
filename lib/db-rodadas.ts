import type { PoolClient } from "pg";
import { getPool, prepararBanco } from "./db";
import { gerarSemanas, segundaDaSemana, semanaDaData, type LinhaResumoRodada, type RodadaCad, type SemanaRodada } from "./rodadas";
import type { LinhaRodadaImportada } from "./rodadas-import";

const NUMERICO = /^\d+$/;

/** Condição SQL: código igual ao digitado (para códigos numéricos, 1 = 01). `p` é o número do parâmetro. */
function condCodigo(coluna: string, p: number, valor: string): string {
  return NUMERICO.test(valor)
    ? `(${coluna} = $${p} OR (${coluna} ~ '^[0-9]+$' AND ltrim(${coluna}, '0') = ltrim($${p}, '0')))`
    : `${coluna} = $${p}`;
}

// ---------------------------------------------------------------------------
// Cadastros (Cód + Descrição) — consulta de um código
// ---------------------------------------------------------------------------

export interface CodigoCadastro {
  /** o cadastro tem pelo menos um item */
  cadastroComItens: boolean;
  item: { cod: string; nm: string } | null;
}

/** Recupera o item de um cadastro pelo código. Fazendas também aceitam o código sem a sequência ("9001" acha "9001-1"). */
export async function buscarCodigo(cad: string, cod: string): Promise<CodigoCadastro> {
  const pool = getPool();
  await prepararBanco(pool);
  const valor = cod.trim();
  const { rows: cont } = await pool.query<{ n: number }>("SELECT COUNT(*)::int AS n FROM cad_itm WHERE cad = $1", [cad]);
  if (!valor) return { cadastroComItens: cont[0].n > 0, item: null };
  const extra = cad === "fazendas" ? " OR cod LIKE $2 || '-%'" : "";
  const { rows } = await pool.query<{ cod: string; nm: string }>(
    `SELECT cod, nm FROM cad_itm WHERE cad = $1 AND (${condCodigo("cod", 2, valor)}${extra})
      ORDER BY cod LIMIT 1`,
    [cad, valor]
  );
  return { cadastroComItens: cont[0].n > 0, item: rows[0] ?? null };
}

// ---------------------------------------------------------------------------
// Cadastro de Rodadas (calendário de 8 semanas)
// ---------------------------------------------------------------------------

export async function listarRodadasCad(): Promise<RodadaCad[]> {
  const pool = getPool();
  await prepararBanco(pool);
  const { rows: rods } = await pool.query<{ rod: number; ini: string; bol: number }>(
    `SELECT c.rod, c.ini, (SELECT COUNT(*)::int FROM rod_bol b WHERE b.rod = c.rod) AS bol
       FROM rod_cad c ORDER BY c.rod DESC`
  );
  const { rows: sems } = await pool.query<{ rod: number; sem: number; ini: string; fim: string }>(
    "SELECT rod, sem, ini, fim FROM rod_sem ORDER BY rod, sem"
  );
  return rods.map((r) => ({
    rod: r.rod,
    ini: r.ini,
    boletins: r.bol,
    semanas: sems.filter((s) => s.rod === r.rod).map((s) => ({ sem: s.sem, ini: s.ini, fim: s.fim })),
  }));
}

export async function semanasDaRodada(rod: number): Promise<SemanaRodada[]> {
  const pool = getPool();
  await prepararBanco(pool);
  const { rows } = await pool.query<SemanaRodada>("SELECT sem, ini, fim FROM rod_sem WHERE rod = $1 ORDER BY sem", [rod]);
  return rows;
}

/** Cria a rodada e as 8 semanas (segunda a domingo) a partir da data informada. Refaz o calendário se a rodada já existir sem boletins. */
export async function criarRodada(rod: number, inicio: string): Promise<true | { erro: string }> {
  const pool = getPool();
  await prepararBanco(pool);
  const { rows: usos } = await pool.query<{ n: number }>("SELECT COUNT(*)::int AS n FROM rod_bol WHERE rod = $1", [rod]);
  if (usos[0].n > 0) return { erro: `A rodada ${rod} já tem boletins lançados — o calendário não pode ser refeito.` };
  const semanas = gerarSemanas(inicio);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM rod_sem WHERE rod = $1", [rod]);
    await client.query(
      `INSERT INTO rod_cad (rod, ini) VALUES ($1, $2)
       ON CONFLICT (rod) DO UPDATE SET ini = EXCLUDED.ini`,
      [rod, semanas[0].ini]
    );
    for (const s of semanas) {
      await client.query("INSERT INTO rod_sem (rod, sem, ini, fim) VALUES ($1,$2,$3,$4)", [rod, s.sem, s.ini, s.fim]);
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  return true;
}

export async function excluirRodada(rod: number): Promise<true | { erro: string }> {
  const pool = getPool();
  await prepararBanco(pool);
  const { rows } = await pool.query<{ n: number }>("SELECT COUNT(*)::int AS n FROM rod_bol WHERE rod = $1", [rod]);
  if (rows[0].n > 0) return { erro: `A rodada ${rod} tem ${rows[0].n} boletim(ns) lançado(s) e não pode ser excluída.` };
  await pool.query("DELETE FROM rod_sem WHERE rod = $1", [rod]);
  await pool.query("DELETE FROM rod_cad WHERE rod = $1", [rod]);
  return true;
}

// ---------------------------------------------------------------------------
// Apontamento (boletim)
// ---------------------------------------------------------------------------

export async function proximoBoletim(): Promise<number> {
  const pool = getPool();
  await prepararBanco(pool);
  const { rows } = await pool.query<{ n: number }>("SELECT COALESCE(MAX(bol), 0)::int + 1 AS n FROM rod_bol");
  return rows[0].n;
}

export interface ItemApontamento {
  oco: string;
  pre: string;
  niv: string;
  pri: string;
  tlh: string;
  rec: string;
}

export interface BoletimApontamento {
  rod: number;
  dt: string;
  reg: string;
  resp: string;
  faz: string;
  itens: ItemApontamento[];
}

async function validarCodigo(
  cad: string,
  rotulo: string,
  cod: string,
  obrigatorio: boolean
): Promise<{ cod: string } | { erro: string }> {
  const valor = cod.trim();
  if (!valor) return obrigatorio ? { erro: `Informe o código de ${rotulo}.` } : { cod: "" };
  const r = await buscarCodigo(cad, valor);
  if (!r.item) {
    // cadastro ainda vazio (ainda não importado): aceita o código digitado
    return r.cadastroComItens ? { erro: `${rotulo}: código ${valor} não cadastrado.` } : { cod: valor };
  }
  return { cod: r.item.cod };
}

/**
 * Grava um boletim novo. O número do boletim é sempre o último + 1 e o
 * recomeço de numeração não existe: a gravação é serializada para não repetir.
 * Rodada, data (dentro das semanas da rodada), região, fazenda e os códigos de
 * cada linha são conferidos nos cadastros.
 */
export async function gravarBoletim(b: BoletimApontamento, usuario: string): Promise<{ bol: number; sem: number } | { erro: string }> {
  const pool = getPool();
  await prepararBanco(pool);

  const semanas = await semanasDaRodada(b.rod);
  if (semanas.length === 0) return { erro: `A rodada ${b.rod} não está cadastrada.` };
  const sem = semanaDaData(semanas, b.dt);
  if (sem === null) return { erro: "A data está fora das semanas da rodada." };

  const reg = await validarCodigo("regiao", "Região", b.reg, true);
  if ("erro" in reg) return reg;
  const faz = await validarCodigo("fazendas", "Fazenda", b.faz, true);
  if ("erro" in faz) return faz;

  const itens = b.itens.filter((i) => i.oco.trim() || i.tlh.trim() || i.rec.trim());
  if (itens.length === 0) return { erro: "Lance pelo menos uma ocorrência." };
  const validados: { oco: string; pre: string; niv: string; pri: string; tlh: string; rec: string }[] = [];
  for (let n = 0; n < itens.length; n++) {
    const i = itens[n];
    const oco = await validarCodigo("ocorrencias", `Ocorrência (linha ${n + 1})`, i.oco, true);
    if ("erro" in oco) return oco;
    const pre = await validarCodigo("presenca-infestacao", `Presença de infestação (linha ${n + 1})`, i.pre, false);
    if ("erro" in pre) return pre;
    const niv = await validarCodigo("nivel-infestacao", `Nível de infestação (linha ${n + 1})`, i.niv, false);
    if ("erro" in niv) return niv;
    const pri = await validarCodigo("prioridade", `Prioridade (linha ${n + 1})`, i.pri, false);
    if ("erro" in pri) return pri;
    validados.push({ oco: oco.cod, pre: pre.cod, niv: niv.cod, pri: pri.cod, tlh: i.tlh.trim(), rec: i.rec.replace(/\s+/g, " ").trim() });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("LOCK TABLE rod_bol IN SHARE ROW EXCLUSIVE MODE");
    const { rows } = await client.query<{ n: number }>("SELECT COALESCE(MAX(bol), 0)::int + 1 AS n FROM rod_bol");
    const bol = rows[0].n;
    await client.query(
      `INSERT INTO rod_bol (bol, rod, dt, sem, reg, resp, faz, ori, usr) VALUES ($1,$2,$3,$4,$5,$6,$7,'apontamento',$8)`,
      [bol, b.rod, b.dt, sem, reg.cod, b.resp.trim(), faz.cod, usuario]
    );
    for (let n = 0; n < validados.length; n++) {
      const v = validados[n];
      await client.query(
        `INSERT INTO rod_itm (bol, seq, oco, pre, niv, pri, tlh, rec) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [bol, n + 1, v.oco, v.pre, v.niv, v.pri, v.tlh, v.rec]
      );
    }
    await client.query("COMMIT");
    return { bol, sem };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Importação da planilha de levantamento
// ---------------------------------------------------------------------------

function periodoDaSemana(txt: string): { ini: string; fim: string } | null {
  const m = txt.match(/(\d{2})\/(\d{2})\/(\d{4}).*?(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? { ini: `${m[3]}-${m[2]}-${m[1]}`, fim: `${m[6]}-${m[5]}-${m[4]}` } : null;
}

const numerico = (v: string) => (NUMERICO.test(v) ? Number(v) : Number.MAX_SAFE_INTEGER);

export interface ResultadoImportacaoRodadas {
  boletins: number;
  itens: number;
  jaImportados: number;
  rodadasCriadas: number[];
  primeiroBoletim: number | null;
  ultimoBoletim: number | null;
}

/**
 * Importa as linhas da planilha. Ordem: Rodada, Data, Região, Semana, Fazenda.
 * Cada combinação vira um boletim, numerado sempre a partir do último + 1.
 * Combinações já importadas (mesma rodada, data, região, semana e fazenda) são
 * puladas, então reimportar o mesmo arquivo não duplica nada. Rodadas que ainda
 * não existem no cadastro são criadas com as semanas informadas na planilha.
 */
export async function importarRodadasCampo(linhas: LinhaRodadaImportada[]): Promise<ResultadoImportacaoRodadas> {
  const pool = getPool();
  await prepararBanco(pool);

  const ordenadas = [...linhas].sort(
    (a, b) =>
      a.rod - b.rod ||
      a.dt.localeCompare(b.dt) ||
      numerico(a.reg) - numerico(b.reg) ||
      a.reg.localeCompare(b.reg) ||
      a.sem - b.sem ||
      numerico(a.faz) - numerico(b.faz) ||
      a.faz.localeCompare(b.faz) ||
      numerico(a.tlh) - numerico(b.tlh) ||
      a.tlh.localeCompare(b.tlh)
  );
  const grupos = new Map<string, LinhaRodadaImportada[]>();
  for (const l of ordenadas) {
    const k = `${l.rod}|${l.dt}|${l.reg}|${l.sem}|${l.faz}`;
    const g = grupos.get(k);
    if (g) g.push(l);
    else grupos.set(k, [l]);
  }

  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("LOCK TABLE rod_bol IN SHARE ROW EXCLUSIVE MODE");

    const { rows: exist } = await client.query<{ k: string }>(
      "SELECT rod || '|' || to_char(dt, 'YYYY-MM-DD') || '|' || reg || '|' || sem || '|' || faz AS k FROM rod_bol"
    );
    const jaTem = new Set(exist.map((r) => r.k));
    const { rows: mx } = await client.query<{ n: number }>("SELECT COALESCE(MAX(bol), 0)::int AS n FROM rod_bol");
    let proximo = mx[0].n + 1;

    const bols: { bol: number; l: LinhaRodadaImportada }[] = [];
    const itens: { bol: number; seq: number; l: LinhaRodadaImportada }[] = [];
    let jaImportados = 0;
    for (const [k, g] of grupos) {
      if (jaTem.has(k)) {
        jaImportados++;
        continue;
      }
      const bol = proximo++;
      bols.push({ bol, l: g[0] });
      g.forEach((l, i) => itens.push({ bol, seq: i + 1, l }));
    }

    for (let i = 0; i < bols.length; i += 2000) {
      const lote = bols.slice(i, i + 2000);
      await client.query(
        `INSERT INTO rod_bol (bol, rod, dt, sem, reg, resp, faz, ori, usr)
         SELECT * FROM unnest($1::int[], $2::int[], $3::date[], $4::int[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[])`,
        [
          lote.map((x) => x.bol),
          lote.map((x) => x.l.rod),
          lote.map((x) => x.l.dt),
          lote.map((x) => x.l.sem),
          lote.map((x) => x.l.reg),
          lote.map((x) => x.l.resp),
          lote.map((x) => x.l.faz),
          lote.map(() => "importacao"),
          lote.map(() => ""),
        ]
      );
    }
    for (let i = 0; i < itens.length; i += 2000) {
      const lote = itens.slice(i, i + 2000);
      await client.query(
        `INSERT INTO rod_itm (bol, seq, oco_txt, tlh, area, rec, ext)
         SELECT x.bol, x.seq, x.oco_txt, x.tlh, x.area, x.rec, x.ext
           FROM jsonb_to_recordset($1::jsonb) AS x(bol int, seq int, oco_txt text, tlh text, area numeric, rec text, ext jsonb)`,
        [
          JSON.stringify(
            lote.map((x) => ({ bol: x.bol, seq: x.seq, oco_txt: x.l.oco, tlh: x.l.tlh, area: x.l.area, rec: x.l.rec, ext: x.l.ext }))
          ),
        ]
      );
    }

    // rodadas que ainda não estão no cadastro: criadas com as semanas da planilha
    const { rows: cadRods } = await client.query<{ rod: number }>("SELECT rod FROM rod_cad");
    const existentes = new Set(cadRods.map((r) => r.rod));
    const rodadasCriadas: number[] = [];
    const porRodada = new Map<number, LinhaRodadaImportada[]>();
    for (const l of linhas) {
      const arr = porRodada.get(l.rod);
      if (arr) arr.push(l);
      else porRodada.set(l.rod, [l]);
    }
    for (const [rod, ls] of [...porRodada].sort((a, b) => a[0] - b[0])) {
      if (existentes.has(rod)) continue;
      // período mais frequente de cada semana
      const freq = new Map<number, Map<string, number>>();
      for (const l of ls) {
        const p = periodoDaSemana(l.periodo);
        if (!p || !l.sem) continue;
        const chave = `${p.ini}|${p.fim}`;
        const m = freq.get(l.sem) ?? new Map<string, number>();
        m.set(chave, (m.get(chave) ?? 0) + 1);
        freq.set(l.sem, m);
      }
      let semanas: SemanaRodada[] = [...freq]
        .map(([sem, m]) => {
          const [ini, fim] = [...m].sort((a, b) => b[1] - a[1])[0][0].split("|");
          return { sem, ini, fim };
        })
        .sort((a, b) => a.sem - b.sem);
      if (semanas.length === 0) {
        const menor = ls.map((l) => l.dt).sort()[0];
        semanas = gerarSemanas(segundaDaSemana(menor));
      }
      await client.query("INSERT INTO rod_cad (rod, ini) VALUES ($1, $2) ON CONFLICT (rod) DO NOTHING", [rod, semanas[0].ini]);
      for (const s of semanas) {
        await client.query("INSERT INTO rod_sem (rod, sem, ini, fim) VALUES ($1,$2,$3,$4) ON CONFLICT (rod, sem) DO NOTHING", [
          rod,
          s.sem,
          s.ini,
          s.fim,
        ]);
      }
      rodadasCriadas.push(rod);
    }

    await client.query("COMMIT");
    return {
      boletins: bols.length,
      itens: itens.length,
      jaImportados,
      rodadasCriadas,
      primeiroBoletim: bols[0]?.bol ?? null,
      ultimoBoletim: bols.length ? bols[bols.length - 1].bol : null,
    };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Resumo
// ---------------------------------------------------------------------------

export interface FiltroResumoRodadas {
  rod?: number;
  reg?: string;
  sem?: number;
  faz?: string;
  q?: string;
}

export interface ResumoRodadas {
  total: number;
  boletins: number;
  areaHa: number;
  linhas: LinhaResumoRodada[];
}

const JOINS = `
  FROM rod_itm i
  JOIN rod_bol b ON b.bol = i.bol
  LEFT JOIN cad_itm rg ON rg.cad = 'regiao' AND rg.cod = b.reg
  LEFT JOIN LATERAL (
    SELECT nm FROM cad_itm WHERE cad = 'fazendas' AND (cod = b.faz OR cod LIKE b.faz || '-%') ORDER BY cod LIMIT 1
  ) fz ON true
  LEFT JOIN cad_itm co ON co.cad = 'ocorrencias' AND co.cod = i.oco
  LEFT JOIN cad_itm pr ON pr.cad = 'presenca-infestacao' AND pr.cod = i.pre
  LEFT JOIN cad_itm nv ON nv.cad = 'nivel-infestacao' AND nv.cod = i.niv
  LEFT JOIN cad_itm pi ON pi.cad = 'prioridade' AND pi.cod = i.pri`;

export async function resumoRodadas(f: FiltroResumoRodadas, pagina: number, tamanho: number): Promise<ResumoRodadas> {
  const pool = getPool();
  await prepararBanco(pool);
  const cond: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, v: unknown) => {
    params.push(v);
    cond.push(sql.replace("?", `$${params.length}`));
  };
  if (f.rod) add("b.rod = ?", f.rod);
  if (f.reg) add("b.reg = ?", f.reg);
  if (f.sem) add("b.sem = ?", f.sem);
  if (f.faz) add("b.faz = ?", f.faz);
  if (f.q && f.q.trim()) {
    params.push(`%${f.q.trim().replace(/[%_\\]/g, (c) => `\\${c}`)}%`);
    const pl = params.length;
    params.push(f.q.trim());
    const pe = params.length;
    cond.push(
      `(COALESCE(co.nm, i.oco_txt) ILIKE $${pl} OR i.rec ILIKE $${pl} OR fz.nm ILIKE $${pl} OR b.faz ILIKE $${pl} OR i.tlh ILIKE $${pl} OR b.resp ILIKE $${pl} OR b.bol::text = $${pe})`
    );
  }
  const where = cond.length ? `WHERE ${cond.join(" AND ")}` : "";

  const { rows: tot } = await pool.query<{ n: number; b: number; a: number | null }>(
    `SELECT COUNT(*)::int AS n, COUNT(DISTINCT b.bol)::int AS b, SUM(i.area)::float AS a ${JOINS} ${where}`,
    params
  );
  const { rows } = await pool.query<{
    bol: number; rod: number; dt: string; sem: number; reg: string; reg_nm: string | null; resp: string; faz: string;
    faz_nm: string | null; tlh: string; area: number | null; oco: string; pre: string | null; niv: string | null;
    pri: string | null; rec: string;
  }>(
    `SELECT b.bol, b.rod, b.dt, b.sem, b.reg, rg.nm AS reg_nm, b.resp, b.faz, fz.nm AS faz_nm, i.tlh, i.area::float AS area,
            COALESCE(NULLIF(co.nm, ''), i.oco_txt) AS oco, pr.nm AS pre, nv.nm AS niv, pi.nm AS pri, i.rec
       ${JOINS} ${where}
      ORDER BY b.rod, b.dt, NULLIF(regexp_replace(b.reg, '\\D', '', 'g'), '')::int NULLS LAST, b.reg, b.sem,
               NULLIF(regexp_replace(b.faz, '\\D', '', 'g'), '')::bigint NULLS LAST, b.faz, b.bol, i.seq
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, tamanho, Math.max(0, (pagina - 1) * tamanho)]
  );
  return {
    total: tot[0].n,
    boletins: tot[0].b,
    areaHa: tot[0].a ?? 0,
    linhas: rows.map((r) => ({
      bol: r.bol,
      rod: r.rod,
      dt: r.dt,
      sem: r.sem,
      reg: r.reg,
      regNm: r.reg_nm ?? "",
      resp: r.resp,
      faz: r.faz,
      fazNm: r.faz_nm ?? "",
      tlh: r.tlh,
      area: r.area,
      ocorrencia: r.oco,
      presenca: r.pre ?? "",
      nivel: r.niv ?? "",
      prioridade: r.pri ?? "",
      rec: r.rec,
    })),
  };
}

export async function opcoesResumoRodadas(): Promise<{ rodadas: number[]; regioes: string[]; semanas: number[] }> {
  const pool = getPool();
  await prepararBanco(pool);
  const r1 = await pool.query<{ v: number }>("SELECT DISTINCT rod AS v FROM rod_bol ORDER BY 1");
  const r2 = await pool.query<{ v: string }>(
    "SELECT reg AS v FROM (SELECT DISTINCT reg FROM rod_bol WHERE reg <> '') x ORDER BY NULLIF(regexp_replace(reg, '\\D', '', 'g'), '')::int NULLS LAST, reg"
  );
  const r3 = await pool.query<{ v: number }>("SELECT DISTINCT sem AS v FROM rod_bol WHERE sem > 0 ORDER BY 1");
  return { rodadas: r1.rows.map((r) => r.v), regioes: r2.rows.map((r) => r.v), semanas: r3.rows.map((r) => r.v) };
}
