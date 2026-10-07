import type { Pool, PoolClient } from "pg";
import { auditar, dataBR } from "./auditar";
import {
  chaveTalhao,
  ratearArea,
  round2,
  validarApontamento,
  type ApontamentoDiario,
  type ConsultaOS,
  type EntradaApontamento,
  type LinhaBaseOS,
  type OperacaoOS,
} from "./atividades";
import { getPool, prepararBanco, sincronizarDescricaoFazendas } from "./db";
import { prepararOSAgr } from "./db-os-agr";
import { buscarCodigo, talhoesDaFazenda } from "./db-rodadas";
import { nomePosicao } from "./os-agr";

let preparado: Promise<void> | null = null;

/** Tabelas da base de O.S. (os_tlh) e dos apontamentos diários (ap_dia e ap_dia_tlh). */
export async function prepararAtividades(pool: Pool): Promise<void> {
  await prepararBanco(pool);
  if (!preparado) {
    preparado = (async () => {
      await pool.query(
        `CREATE TABLE IF NOT EXISTS os_tlh (
           emp text NOT NULL DEFAULT '', os text NOT NULL, prop_cod text NOT NULL, prop_nm text NOT NULL DEFAULT '',
           tlh text NOT NULL, area_tlh numeric, area_rec numeric,
           op_cod text NOT NULL DEFAULT '', op_ds text NOT NULL DEFAULT '',
           etapa_cod text NOT NULL DEFAULT '', etapa_ds text NOT NULL DEFAULT '',
           tipo_cod text NOT NULL DEFAULT '', tipo_ds text NOT NULL DEFAULT '',
           resp text NOT NULL DEFAULT '', sts text NOT NULL DEFAULT '', safra text NOT NULL DEFAULT '',
           dt_lanc date, obs text NOT NULL DEFAULT '', imp_em timestamptz NOT NULL DEFAULT now(),
           PRIMARY KEY (emp, os, prop_cod, tlh, op_cod)
         )`
      );
      await pool.query("CREATE INDEX IF NOT EXISTS idx_os_tlh_os ON os_tlh (os)");
      await pool.query(
        `CREATE TABLE IF NOT EXISTS ap_dia (
           id serial PRIMARY KEY, dt date NOT NULL, os text NOT NULL,
           op_cod text NOT NULL DEFAULT '', op_ds text NOT NULL DEFAULT '', solic text NOT NULL DEFAULT '',
           etapa_cod text NOT NULL DEFAULT '', etapa_ds text NOT NULL DEFAULT '', tipo_apl text NOT NULL DEFAULT '',
           n_eqp integer NOT NULL DEFAULT 0, n_pes integer NOT NULL DEFAULT 0, obs text NOT NULL DEFAULT '',
           usr text NOT NULL DEFAULT '', cri_em timestamptz NOT NULL DEFAULT now(), atu_usr text, atu_em timestamptz
         )`
      );
      await pool.query("CREATE INDEX IF NOT EXISTS idx_ap_dia_dt ON ap_dia (dt)");
      // nº do boletim de campo: único entre os apontamentos
      await pool.query("ALTER TABLE ap_dia ADD COLUMN IF NOT EXISTS bol integer");
      await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS idx_ap_dia_bol ON ap_dia (bol) WHERE bol IS NOT NULL");
      await pool.query("CREATE INDEX IF NOT EXISTS idx_ap_dia_os ON ap_dia (os, op_cod)");
      // área informada por talhão ou volume rateado (e o volume, para editar depois)
      await pool.query("ALTER TABLE ap_dia ADD COLUMN IF NOT EXISTS area_modo text NOT NULL DEFAULT 'talhao'");
      await pool.query("ALTER TABLE ap_dia ADD COLUMN IF NOT EXISTS area_vol numeric");
      await pool.query(
        `CREATE TABLE IF NOT EXISTS ap_dia_tlh (
           ap_id integer NOT NULL REFERENCES ap_dia(id) ON DELETE CASCADE,
           prop_cod text NOT NULL, prop_nm text NOT NULL DEFAULT '', tlh text NOT NULL,
           area_tlh numeric, area numeric NOT NULL DEFAULT 0,
           PRIMARY KEY (ap_id, prop_cod, tlh)
         )`
      );
    })().catch((err) => {
      preparado = null;
      throw err;
    });
  }
  await preparado;
}

// ---------------------------------------------------------------------------
// Base de O.S.
// ---------------------------------------------------------------------------

/** Atualiza a base: as O.S. que vêm no arquivo são substituídas por inteiro; as demais ficam como estão. */
export async function importarBaseOS(linhas: LinhaBaseOS[], usuario: string): Promise<{ ordens: number; linhas: number; substituidas: number }> {
  const pool = getPool();
  await prepararAtividades(pool);
  const ordens = Array.from(new Set(linhas.map((l) => `${l.emp}|${l.os}`)));
  let existentes = 0;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    existentes = (
      await client.query<{ n: number }>(
        "SELECT COUNT(DISTINCT (emp, os))::int AS n FROM os_tlh WHERE (emp || '|' || os) = ANY($1::text[])",
        [ordens]
      )
    ).rows[0].n;
    await client.query("DELETE FROM os_tlh WHERE (emp || '|' || os) = ANY($1::text[])", [ordens]);
    for (let i = 0; i < linhas.length; i += 3000) {
      const lote = linhas.slice(i, i + 3000);
      const col = <K extends keyof LinhaBaseOS>(k: K) => lote.map((l) => l[k]);
      await client.query(
        `INSERT INTO os_tlh (emp, os, prop_cod, prop_nm, tlh, area_tlh, area_rec, op_cod, op_ds, etapa_cod, etapa_ds, tipo_cod, tipo_ds, resp, sts, safra, dt_lanc, obs)
         SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::numeric[], $7::numeric[], $8::text[], $9::text[],
                              $10::text[], $11::text[], $12::text[], $13::text[], $14::text[], $15::text[], $16::text[], $17::date[], $18::text[])
         ON CONFLICT (emp, os, prop_cod, tlh, op_cod) DO NOTHING`,
        [
          col("emp"), col("os"), col("propCod"), col("propNm"), col("tlh"), col("areaTlh"), col("areaRec"), col("opCod"), col("opDs"),
          col("etapaCod"), col("etapaDs"), col("tipoCod"), col("tipoDs"), col("resp"), col("status"), col("safra"), col("dtLanc"), col("obs"),
        ]
      );
    }
    await auditar(client, {
      usuario,
      modulo: "Atividades",
      entidade: "Base de O.S.",
      chave: `${ordens.length} O.S.`,
      acao: "importacao",
      depois: { ordens: ordens.length, linhas: linhas.length, substituidas: existentes },
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
  return { ordens: ordens.length, linhas: linhas.length, substituidas: existentes };
}

export async function resumoBaseOS(): Promise<{ ordens: number; ultimaImportacao: string | null }> {
  const pool = getPool();
  await prepararAtividades(pool);
  const r = (
    await pool.query<{ n: number; ult: string | null }>(
      "SELECT COUNT(DISTINCT (emp, os))::int AS n, to_char(MAX(imp_em) AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') AS ult FROM os_tlh"
    )
  ).rows[0];
  return { ordens: r.n, ultimaImportacao: r.ult };
}

/** A O.S. com as operações e os talhões de cada uma, e a área já apontada (sem contar o apontamento `excluirId`). */
export async function consultarOS(os: string, excluirId?: number): Promise<ConsultaOS | null> {
  const pool = getPool();
  await prepararAtividades(pool);
  const cod = os.trim().replace(/^0+(?=\d)/, "");
  let { rows } = await pool.query<{
    emp: string; os: string; prop_cod: string; prop_nm: string; tlh: string; area_tlh: number | null; area_rec: number | null;
    op_cod: string; op_ds: string; etapa_cod: string; etapa_ds: string; tipo_cod: string; tipo_ds: string; resp: string; sts: string; safra: string; dt_lanc: string | null; obs: string;
  }>(
    `SELECT emp, os, prop_cod, prop_nm, tlh, area_tlh::float AS area_tlh, area_rec::float AS area_rec, op_cod, op_ds, etapa_cod, etapa_ds,
            tipo_cod, tipo_ds, resp, sts, safra, dt_lanc::text AS dt_lanc, obs
       FROM os_tlh WHERE os = $1
      ORDER BY op_cod, prop_cod, CASE WHEN tlh ~ '^[0-9]+$' THEN lpad(tlh, 8, '0') ELSE tlh END`,
    [cod]
  );
  if (rows.length === 0) {
    // sem a O.S. na base de Acompanhamento: usa a base de Ordem de Serviço Agr. (Relatório de Ordens de Serviço)
    await prepararOSAgr(pool);
    rows = (
      await pool.query<(typeof rows)[number]>(
        `SELECT emp, os, prop_cod, prop_nm, tlh || letra AS tlh, area_plant::float AS area_tlh, area_rec::float AS area_rec, op_cod, op_ds, etapa_cod, etapa_ds,
                '' AS tipo_cod, '' AS tipo_ds, resp_nm AS resp, posicao AS sts, safra, dt_os::text AS dt_lanc, obs
           FROM os_agr WHERE os = $1
          ORDER BY op_cod, prop_cod, CASE WHEN tlh ~ '^[0-9]+$' THEN lpad(tlh, 8, '0') ELSE tlh END`,
        [cod]
      )
    ).rows.map((r) => ({ ...r, sts: nomePosicao(r.sts) }));
  }
  if (rows.length === 0) return null;
  const p = rows[0];
  const ops = new Map<string, OperacaoOS>();
  for (const r of rows) {
    let o = ops.get(r.op_cod);
    if (!o) {
      o = { cod: r.op_cod, ds: r.op_ds, etapaCod: r.etapa_cod, etapaDs: r.etapa_ds, tipoCod: r.tipo_cod, tipoDs: r.tipo_ds, talhoes: [] };
      ops.set(r.op_cod, o);
    }
    if (!o.talhoes.some((t) => t.propCod === r.prop_cod && t.tlh === r.tlh)) {
      o.talhoes.push({ propCod: r.prop_cod, propNm: r.prop_nm, tlh: r.tlh, areaTlh: r.area_tlh, areaRec: r.area_rec });
    }
  }
  const realizado: ConsultaOS["realizado"] = {};
  const feitos = await pool.query<{ op_cod: string; prop_cod: string; tlh: string; area: number }>(
    `SELECT a.op_cod, t.prop_cod, t.tlh, SUM(t.area)::float AS area
       FROM ap_dia a JOIN ap_dia_tlh t ON t.ap_id = a.id
      WHERE a.os = $1 AND ($2::int IS NULL OR a.id <> $2::int)
      GROUP BY a.op_cod, t.prop_cod, t.tlh`,
    [cod, excluirId ?? null]
  );
  for (const f of feitos.rows) (realizado[f.op_cod] ??= {})[chaveTalhao(f.prop_cod, f.tlh)] = round2(f.area);
  const tipos = (
    await pool.query<{ t: string }>(
      `SELECT DISTINCT t FROM (SELECT NULLIF(tipo_ds, '') AS t FROM os_tlh UNION SELECT NULLIF(tipo_apl, '') FROM ap_dia
                                UNION SELECT NULLIF(nm, '') FROM cad_itm WHERE cad = 'tipo-aplicacao') x WHERE t IS NOT NULL ORDER BY 1 LIMIT 200`
    )
  ).rows.map((r) => r.t);
  return {
    os: p.os,
    emp: p.emp,
    status: p.sts,
    safra: p.safra,
    resp: p.resp,
    obs: p.obs,
    dtLanc: p.dt_lanc,
    operacoes: Array.from(ops.values()),
    realizado,
    tiposConhecidos: tipos,
  };
}

// ---------------------------------------------------------------------------
// Apontamentos
// ---------------------------------------------------------------------------

const FMT = `'DD/MM/YYYY HH24:MI'`;

async function lerApontamentos(exec: Pick<Pool, "query">, filtro: string, params: unknown[]): Promise<ApontamentoDiario[]> {
  const { rows } = await exec.query<{
    id: number; bol: number | null; dt: string; os: string; area_modo: string; area_vol: number | null; op_cod: string; op_ds: string; solic: string; etapa_cod: string; etapa_ds: string; tipo_apl: string;
    n_eqp: number; n_pes: number; obs: string; usr: string; cri_em: string; atu_usr: string | null; atu_em: string | null;
    talhoes: { propCod: string; propNm: string; tlh: string; areaTlh: number | null; area: number }[] | null;
  }>(
    `SELECT a.id, a.bol, a.dt::text AS dt, a.os, a.area_modo, a.area_vol::float AS area_vol, a.op_cod, a.op_ds, a.solic, a.etapa_cod, a.etapa_ds, a.tipo_apl, a.n_eqp, a.n_pes, a.obs, a.usr,
            to_char(a.cri_em AT TIME ZONE 'America/Sao_Paulo', ${FMT}) AS cri_em, a.atu_usr,
            to_char(a.atu_em AT TIME ZONE 'America/Sao_Paulo', ${FMT}) AS atu_em,
            (SELECT json_agg(json_build_object('propCod', t.prop_cod, 'propNm', t.prop_nm, 'tlh', t.tlh, 'areaTlh', t.area_tlh::float, 'area', t.area::float)
                              ORDER BY t.prop_cod, CASE WHEN t.tlh ~ '^[0-9]+$' THEN lpad(t.tlh, 8, '0') ELSE t.tlh END)
               FROM ap_dia_tlh t WHERE t.ap_id = a.id) AS talhoes
       FROM ap_dia a WHERE ${filtro}
      ORDER BY a.dt DESC, a.id DESC`,
    params
  );
  return rows.map((r) => {
    const talhoes = r.talhoes ?? [];
    return {
      id: r.id,
      boletim: r.bol,
      dt: r.dt,
      os: r.os,
      modoArea: r.area_modo === "rateio" ? "rateio" : "talhao",
      volume: r.area_vol,
      opCod: r.op_cod,
      opDs: r.op_ds,
      solicitante: r.solic,
      etapaCod: r.etapa_cod,
      etapaDs: r.etapa_ds,
      tipoAplicacao: r.tipo_apl,
      numEquipamentos: r.n_eqp,
      numPessoas: r.n_pes,
      obs: r.obs,
      talhoes,
      areaTotal: round2(talhoes.reduce((a, t) => a + (t.area ?? 0), 0)),
      usr: r.usr,
      criEm: r.cri_em,
      atuUsr: r.atu_usr,
      atuEm: r.atu_em,
    };
  });
}

export async function listarApontamentos(f: { de: string; ate: string; os: string; boletim?: number }): Promise<ApontamentoDiario[]> {
  const pool = getPool();
  await prepararAtividades(pool);
  // buscando um boletim, ele aparece em qualquer data
  if (f.boletim) return lerApontamentos(pool, "a.bol = $1", [f.boletim]);
  return lerApontamentos(pool, "a.dt BETWEEN $1::date AND $2::date AND ($3 = '' OR a.os = $3)", [f.de, f.ate, f.os.trim()]);
}

/** Próximo nº de boletim (o maior lançado + 1), sugerido no formulário. */
export async function proximoBoletimAtividade(): Promise<number> {
  const pool = getPool();
  await prepararAtividades(pool);
  return (await pool.query<{ n: number }>("SELECT (COALESCE(MAX(bol), 0) + 1)::int AS n FROM ap_dia")).rows[0].n;
}

export async function obterApontamento(id: number, exec?: Pick<Pool, "query">): Promise<ApontamentoDiario | null> {
  const pool = getPool();
  await prepararAtividades(pool);
  return (await lerApontamentos(exec ?? pool, "a.id = $1", [id]))[0] ?? null;
}

const chaveLog = (a: ApontamentoDiario) =>
  `Boletim ${a.boletim ?? `#${a.id}`} · ${a.os ? `O.S. ${a.os}` : `sem O.S. · Fazenda ${a.talhoes[0]?.propCod ?? ""}`} · ${dataBR(a.dt)}`;
const resumoLog = (a: ApontamentoDiario) => ({
  boletim: a.boletim,
  data: dataBR(a.dt),
  os: a.os || "sem O.S.",
  area: a.modoArea === "rateio" ? `volume ${a.volume} ha rateado` : "por talhão",
  operacao: `${a.opCod} ${a.opDs}`.trim(),
  solicitante: a.solicitante,
  etapa: `${a.etapaCod} ${a.etapaDs}`.trim(),
  tipoAplicacao: a.tipoAplicacao,
  equipamentos: a.numEquipamentos,
  pessoas: a.numPessoas,
  areaRealizada: a.areaTotal,
  talhoes: a.talhoes.map((t) => `${t.propCod}-${t.tlh}: ${t.area}`).join("; "),
});

/** Talhão já resolvido para gravar (com a área do dia). */
interface TalhaoGravar {
  propCod: string;
  propNm: string;
  tlh: string;
  areaTlh: number | null;
  area: number;
}

/**
 * Inclui (sem id) ou altera o apontamento. Com O.S., a operação e os talhões têm de existir na O.S.; sem O.S., a fazenda
 * tem de estar no Cadastro de Fazenda e os talhões vêm do que foi informado. A área pode vir talhão a talhão ou como um
 * volume rateado entre os talhões marcados (o rateio é refeito aqui).
 */
export async function salvarApontamento(e: EntradaApontamento, usuario: string, id?: number): Promise<{ id: number } | { erro: string }> {
  const pool = getPool();
  await prepararAtividades(pool);
  const erro = validarApontamento(e);
  if (erro) return { erro };

  let osNum = "";
  let op: { cod: string; ds: string; etapaCod: string; etapaDs: string };
  let candidatos: TalhaoGravar[];
  if (!e.semOS) {
    const os = await consultarOS(e.os, id);
    if (!os) return { erro: `A O.S. ${e.os} não está na base de O.S. Importe a base atualizada (Acompanhamento de O.S.).` };
    const o = os.operacoes.find((x) => x.cod === e.opCod);
    if (!o) return { erro: "A operação escolhida não faz parte desta O.S." };
    osNum = os.os;
    op = { cod: o.cod, ds: o.ds, etapaCod: o.etapaCod, etapaDs: o.etapaDs };
    candidatos = [];
    for (const t of e.talhoes) {
      const doOS = o.talhoes.find((x) => x.propCod === t.propCod && x.tlh === t.tlh);
      if (!doOS) return { erro: `O talhão ${t.propCod}-${t.tlh} não está na O.S. para esta operação.` };
      // no rateio, o peso de cada talhão é a área recomendada na O.S. (ou a do talhão)
      candidatos.push({ propCod: doOS.propCod, propNm: doOS.propNm, tlh: doOS.tlh, areaTlh: doOS.areaTlh, area: t.area });
    }
    if (e.modoArea === "rateio") {
      const pesos = e.talhoes.map((t) => {
        const x = o.talhoes.find((y) => y.propCod === t.propCod && y.tlh === t.tlh)!;
        return x.areaRec ?? x.areaTlh;
      });
      ratearArea(e.volume!, pesos).forEach((a, i) => (candidatos[i].area = a));
    }
  } else {
    const faz = await buscarCodigo("fazendas", e.fazCod);
    if (!faz.item) return { erro: `A fazenda ${e.fazCod.trim()} não está no Cadastro de Fazenda. Cadastre ou importe a fazenda antes.` };
    const propCod = faz.item.cod.split("-")[0];
    const conhecidos = await talhoesDaFazenda(faz.item.cod);
    const vistos = new Set<string>();
    candidatos = [];
    for (const t of e.talhoes) {
      const tlh = t.tlh.trim();
      if (vistos.has(tlh)) return { erro: `O talhão ${tlh} foi informado duas vezes.` };
      vistos.add(tlh);
      const c = conhecidos.find((x) => x.tlh === tlh);
      candidatos.push({ propCod, propNm: faz.item.nm, tlh, areaTlh: c?.area ?? null, area: t.area });
    }
    if (e.modoArea === "rateio") ratearArea(e.volume!, candidatos.map((c) => c.areaTlh)).forEach((a, i) => (candidatos[i].area = a));
    const opDs = e.opDs.trim() || (await descricaoOperacao(pool, e.opCod.trim()));
    op = { cod: e.opCod.trim(), ds: opDs, etapaCod: "", etapaDs: "" };
  }
  const talhoes = candidatos.filter((t) => t.area > 0);
  if (talhoes.length === 0) return { erro: "Informe a área realizada em pelo menos um talhão." };
  for (const t of talhoes) {
    if (t.areaTlh !== null && t.area > t.areaTlh + 0.001) {
      return { erro: `Talhão ${t.propCod}-${t.tlh}: a área realizada (${t.area.toLocaleString("pt-BR")} ha) passa da área do talhão (${t.areaTlh.toLocaleString("pt-BR")} ha).` };
    }
  }
  const etapa =
    !e.semOS && (op.etapaCod === e.etapaCod || !e.etapaCod)
      ? { cod: op.etapaCod, ds: op.etapaDs }
      : { cod: e.etapaCod.trim(), ds: e.etapaCod.trim() ? await descricaoEtapa(pool, e.etapaCod.trim()) : "" };
  const repetido = (
    await pool.query<{ id: number }>("SELECT id FROM ap_dia WHERE bol = $1 AND ($2::int IS NULL OR id <> $2::int) LIMIT 1", [e.boletim, id ?? null])
  ).rows[0];
  if (repetido) return { erro: `O boletim nº ${e.boletim} já foi lançado (apontamento #${repetido.id}). Confira o número.` };

  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");
    let novoId = id;
    let antes: ApontamentoDiario | null = null;
    const valores = [
      e.boletim, e.dt, osNum, op.cod, op.ds, e.solicitante.trim(), etapa.cod, etapa.ds, e.tipoAplicacao.trim(), e.numEquipamentos, e.numPessoas,
      e.obs.trim().slice(0, 300), e.modoArea, e.modoArea === "rateio" ? round2(e.volume!) : null,
    ];
    if (id === undefined) {
      novoId = (
        await client.query<{ id: number }>(
          `INSERT INTO ap_dia (bol, dt, os, op_cod, op_ds, solic, etapa_cod, etapa_ds, tipo_apl, n_eqp, n_pes, obs, area_modo, area_vol, usr)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
          [...valores, usuario]
        )
      ).rows[0].id;
    } else {
      antes = await obterApontamento(id, client);
      if (!antes) {
        await client.query("ROLLBACK");
        return { erro: "Apontamento não encontrado." };
      }
      await client.query(
        `UPDATE ap_dia SET bol=$1, dt=$2, os=$3, op_cod=$4, op_ds=$5, solic=$6, etapa_cod=$7, etapa_ds=$8, tipo_apl=$9, n_eqp=$10, n_pes=$11, obs=$12,
                area_modo=$13, area_vol=$14, atu_usr=$15, atu_em=now() WHERE id=$16`,
        [...valores, usuario, id]
      );
      await client.query("DELETE FROM ap_dia_tlh WHERE ap_id = $1", [id]);
    }
    for (const t of talhoes) {
      await client.query("INSERT INTO ap_dia_tlh (ap_id, prop_cod, prop_nm, tlh, area_tlh, area) VALUES ($1,$2,$3,$4,$5,$6)", [
        novoId, t.propCod, t.propNm, t.tlh, t.areaTlh, round2(t.area),
      ]);
    }
    const depois = (await obterApontamento(novoId!, client))!;
    await auditar(client, {
      usuario,
      modulo: "Atividades",
      entidade: "Apontamento diário",
      chave: chaveLog(depois),
      acao: id === undefined ? "inclusao" : "alteracao",
      antes: antes ? resumoLog(antes) : undefined,
      depois: resumoLog(depois),
    });
    await client.query("COMMIT");
    return { id: novoId! };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function excluirApontamento(id: number, usuario: string): Promise<true | { erro: string }> {
  const pool = getPool();
  await prepararAtividades(pool);
  const atual = await obterApontamento(id);
  if (!atual) return { erro: "Apontamento não encontrado." };
  await pool.query("DELETE FROM ap_dia WHERE id = $1", [id]);
  await auditar(pool, { usuario, modulo: "Atividades", entidade: "Apontamento diário", chave: chaveLog(atual), acao: "exclusao", antes: resumoLog(atual) });
  return true;
}

// ---------------------------------------------------------------------------
// Apontamento sem O.S.: listas para escolher operação, etapa, tipo e solicitante
// ---------------------------------------------------------------------------

async function existe(pool: Pick<Pool, "query">, tabela: string): Promise<boolean> {
  return !!(await pool.query<{ r: string | null }>("SELECT to_regclass($1)::text AS r", [tabela])).rows[0].r;
}

async function descricaoOperacao(pool: Pool, cod: string): Promise<string> {
  const fontes = ["SELECT op_ds AS d FROM ap_dia WHERE op_cod = $1 AND op_ds <> '' LIMIT 1", "SELECT op_ds AS d FROM os_tlh WHERE op_cod = $1 AND op_ds <> '' LIMIT 1"];
  if (await existe(pool, "os_agr")) fontes.unshift("SELECT op_ds AS d FROM os_agr WHERE op_cod = $1 AND op_ds <> '' LIMIT 1");
  for (const sql of fontes) {
    const d = (await pool.query<{ d: string }>(sql, [cod])).rows[0]?.d;
    if (d) return d;
  }
  return "";
}

async function descricaoEtapa(pool: Pool, cod: string): Promise<string> {
  await prepararOSAgr(pool); // carga inicial do cadastro de Etapa
  return (await pool.query<{ nm: string }>("SELECT nm FROM cad_itm WHERE cad = 'etapa' AND cod = $1", [cod])).rows[0]?.nm ?? "";
}

export interface OpcoesApontamento {
  operacoes: { cod: string; ds: string; etapaCod: string }[];
  etapas: { cod: string; ds: string }[];
  tipos: string[];
  solicitantes: string[];
}

export async function opcoesApontamento(): Promise<OpcoesApontamento> {
  const pool = getPool();
  await prepararAtividades(pool);
  await prepararOSAgr(pool);
  const ops = await pool.query<{ cod: string; ds: string; etapa: string }>(
    `SELECT op_cod AS cod, MAX(op_ds) AS ds, MAX(etapa_cod) AS etapa FROM (
       SELECT op_cod, op_ds, etapa_cod FROM os_agr UNION ALL SELECT op_cod, op_ds, etapa_cod FROM os_tlh
       UNION ALL SELECT op_cod, op_ds, etapa_cod FROM ap_dia) x
      WHERE op_cod <> '' GROUP BY op_cod ORDER BY 2, 1`
  );
  const etapas = await pool.query<{ cod: string; ds: string }>(
    "SELECT cod, nm AS ds FROM cad_itm WHERE cad = 'etapa' ORDER BY CASE WHEN cod ~ '^[0-9]+$' THEN lpad(cod, 8, '0') ELSE cod END"
  );
  const tipos = await pool.query<{ t: string }>(
    `SELECT DISTINCT t FROM (SELECT NULLIF(nm, '') AS t FROM cad_itm WHERE cad = 'tipo-aplicacao' UNION SELECT NULLIF(tipo_apl, '') FROM ap_dia) x
      WHERE t IS NOT NULL ORDER BY 1`
  );
  const solic = await pool.query<{ s: string }>(
    `SELECT DISTINCT s FROM (SELECT NULLIF(nm, '') AS s FROM cad_itm WHERE cad = 'responsaveis-os' UNION SELECT NULLIF(solic, '') FROM ap_dia) x
      WHERE s IS NOT NULL ORDER BY 1`
  );
  return {
    operacoes: ops.rows.map((r) => ({ cod: r.cod, ds: r.ds, etapaCod: r.etapa })),
    etapas: etapas.rows,
    tipos: tipos.rows.map((r) => r.t),
    solicitantes: solic.rows.map((r) => r.s),
  };
}
