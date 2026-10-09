import { auditar, dataBR } from "./auditar";
import { camposFaltando, chaveTalhao, normalizarRegras, ratearArea, round2, validarApontamento } from "./atividades";
import { codigoOperacao } from "./dashboard-atividades";
import { getPool, prepararBanco, sincronizarDescricaoFazendas } from "./db";
import { nomeOperacao, operacoesDoCadastro } from "./db-operacoes";
import { prepararOSAgr } from "./db-os-agr";
import { buscarCodigo, talhoesDaFazenda } from "./db-rodadas";
import { nomePosicao } from "./os-agr";

let preparado = null;

/** Tabelas da base de O.S. (os_tlh) e dos apontamentos diários (ap_dia e ap_dia_tlh). */
export async function prepararAtividades(pool) {
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
         )`,
      );
      await pool.query("CREATE INDEX IF NOT EXISTS idx_os_tlh_os ON os_tlh (os)");
      await pool.query(
        `CREATE TABLE IF NOT EXISTS ap_dia (
           id serial PRIMARY KEY, dt date NOT NULL, os text NOT NULL,
           op_cod text NOT NULL DEFAULT '', op_ds text NOT NULL DEFAULT '', solic text NOT NULL DEFAULT '',
           etapa_cod text NOT NULL DEFAULT '', etapa_ds text NOT NULL DEFAULT '', tipo_apl text NOT NULL DEFAULT '',
           n_eqp integer NOT NULL DEFAULT 0, n_pes integer NOT NULL DEFAULT 0, obs text NOT NULL DEFAULT '',
           usr text NOT NULL DEFAULT '', cri_em timestamptz NOT NULL DEFAULT now(), atu_usr text, atu_em timestamptz
         )`,
      );
      await pool.query("CREATE INDEX IF NOT EXISTS idx_ap_dia_dt ON ap_dia (dt)");
      // nº do boletim de campo: único entre os apontamentos
      await pool.query("ALTER TABLE ap_dia ADD COLUMN IF NOT EXISTS bol integer");
      await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS idx_ap_dia_bol ON ap_dia (bol) WHERE bol IS NOT NULL");
      await pool.query("CREATE INDEX IF NOT EXISTS idx_ap_dia_os ON ap_dia (os, op_cod)");
      // parâmetros do sistema (ex.: campos obrigatórios do apontamento)
      await pool.query(
        `CREATE TABLE IF NOT EXISTS app_param (
           chave text PRIMARY KEY, valor jsonb NOT NULL DEFAULT '{}'::jsonb, atu_usr text NOT NULL DEFAULT '', atu_em timestamptz NOT NULL DEFAULT now()
         )`,
      );
      // área informada por talhão ou volume rateado (e o volume, para editar depois)
      await pool.query("ALTER TABLE ap_dia ADD COLUMN IF NOT EXISTS area_modo text NOT NULL DEFAULT 'talhao'");
      await pool.query("ALTER TABLE ap_dia ADD COLUMN IF NOT EXISTS area_vol numeric");
      // equipamento, vazões (L/ha) e volume de calda (L)
      await pool.query("ALTER TABLE ap_dia ADD COLUMN IF NOT EXISTS eqp text NOT NULL DEFAULT ''");
      await pool.query("ALTER TABLE ap_dia ADD COLUMN IF NOT EXISTS vazao_rec numeric");
      await pool.query("ALTER TABLE ap_dia ADD COLUMN IF NOT EXISTS vazao_uti numeric");
      await pool.query("ALTER TABLE ap_dia ADD COLUMN IF NOT EXISTS vazao_auto boolean NOT NULL DEFAULT false");
      await pool.query("ALTER TABLE ap_dia ADD COLUMN IF NOT EXISTS vol_calda numeric");
      // apontamento importado (ex.: conversa do WhatsApp): origem, a mensagem (não importa duas vezes) e o texto dela
      await pool.query("ALTER TABLE ap_dia ADD COLUMN IF NOT EXISTS orig text NOT NULL DEFAULT ''");
      await pool.query("ALTER TABLE ap_dia ADD COLUMN IF NOT EXISTS orig_chave text");
      await pool.query("ALTER TABLE ap_dia ADD COLUMN IF NOT EXISTS orig_msg text");
      await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS idx_ap_dia_orig ON ap_dia (orig_chave) WHERE orig_chave IS NOT NULL");
      // insumos aplicados no apontamento
      await pool.query(
        `CREATE TABLE IF NOT EXISTS ap_dia_ins (
           ap_id integer NOT NULL REFERENCES ap_dia(id) ON DELETE CASCADE, seq integer NOT NULL,
           cod text NOT NULL, ds text NOT NULL DEFAULT '', um text NOT NULL DEFAULT '', dose numeric, qtd numeric, dep text NOT NULL DEFAULT '',
           PRIMARY KEY (ap_id, seq)
         )`,
      );
      await pool.query(
        `CREATE TABLE IF NOT EXISTS ap_dia_tlh (
           ap_id integer NOT NULL REFERENCES ap_dia(id) ON DELETE CASCADE,
           prop_cod text NOT NULL, prop_nm text NOT NULL DEFAULT '', tlh text NOT NULL,
           area_tlh numeric, area numeric NOT NULL DEFAULT 0,
           PRIMARY KEY (ap_id, prop_cod, tlh)
         )`,
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
export async function importarBaseOS(linhas, usuario) {
  const pool = getPool();
  await prepararAtividades(pool);
  const ordens = Array.from(new Set(linhas.map((l) => `${l.emp}|${l.os}`)));
  let existentes = 0;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    existentes = (await client.query("SELECT COUNT(DISTINCT (emp, os))::int AS n FROM os_tlh WHERE (emp || '|' || os) = ANY($1::text[])", [ordens])).rows[0].n;
    await client.query("DELETE FROM os_tlh WHERE (emp || '|' || os) = ANY($1::text[])", [ordens]);
    for (let i = 0; i < linhas.length; i += 3000) {
      const lote = linhas.slice(i, i + 3000);
      const col = (k) => lote.map((l) => l[k]);
      await client.query(
        `INSERT INTO os_tlh (emp, os, prop_cod, prop_nm, tlh, area_tlh, area_rec, op_cod, op_ds, etapa_cod, etapa_ds, tipo_cod, tipo_ds, resp, sts, safra, dt_lanc, obs)
         SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::numeric[], $7::numeric[], $8::text[], $9::text[],
                              $10::text[], $11::text[], $12::text[], $13::text[], $14::text[], $15::text[], $16::text[], $17::date[], $18::text[])
         ON CONFLICT (emp, os, prop_cod, tlh, op_cod) DO NOTHING`,
        [
          col("emp"),
          col("os"),
          col("propCod"),
          col("propNm"),
          col("tlh"),
          col("areaTlh"),
          col("areaRec"),
          col("opCod"),
          col("opDs"),
          col("etapaCod"),
          col("etapaDs"),
          col("tipoCod"),
          col("tipoDs"),
          col("resp"),
          col("status"),
          col("safra"),
          col("dtLanc"),
          col("obs"),
        ],
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

export async function resumoBaseOS() {
  const pool = getPool();
  await prepararAtividades(pool);
  const r = (
    await pool.query(
      "SELECT COUNT(DISTINCT (emp, os))::int AS n, to_char(MAX(imp_em) AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') AS ult FROM os_tlh",
    )
  ).rows[0];
  return { ordens: r.n, ultimaImportacao: r.ult };
}

/** A O.S. com as operações e os talhões de cada uma, e a área já apontada (sem contar o apontamento `excluirId`). */
export async function consultarOS(os, excluirId) {
  const pool = getPool();
  await prepararAtividades(pool);
  const cod = os.trim().replace(/^0+(?=\d)/, "");
  let { rows } = await pool.query(
    `SELECT emp, os, prop_cod, prop_nm, tlh, area_tlh::float AS area_tlh, area_rec::float AS area_rec, op_cod, op_ds, etapa_cod, etapa_ds,
            tipo_cod, tipo_ds, resp, sts, safra, dt_lanc::text AS dt_lanc, obs
       FROM os_tlh WHERE os = $1
      ORDER BY op_cod, prop_cod, CASE WHEN tlh ~ '^[0-9]+$' THEN lpad(tlh, 8, '0') ELSE tlh END`,
    [cod],
  );
  if (rows.length === 0) {
    // sem a O.S. na base de Acompanhamento: usa a base de Ordem de Serviço Agr. (Relatório de Ordens de Serviço)
    await prepararOSAgr(pool);
    rows = (
      await pool.query(
        `SELECT emp, os, prop_cod, prop_nm, tlh || letra AS tlh, area_plant::float AS area_tlh, area_rec::float AS area_rec, op_cod, op_ds, etapa_cod, etapa_ds,
                '' AS tipo_cod, '' AS tipo_ds, resp_nm AS resp, posicao AS sts, safra, dt_os::text AS dt_lanc, obs
           FROM os_agr WHERE os = $1
          ORDER BY op_cod, prop_cod, CASE WHEN tlh ~ '^[0-9]+$' THEN lpad(tlh, 8, '0') ELSE tlh END`,
        [cod],
      )
    ).rows.map((r) => ({ ...r, sts: nomePosicao(r.sts) }));
  }
  if (rows.length === 0) return null;
  const p = rows[0];
  const cadOps = await operacoesDoCadastro(pool);
  const ops = new Map();
  for (const r of rows) {
    let o = ops.get(r.op_cod);
    if (!o) {
      o = {
        cod: r.op_cod,
        ds: nomeOperacao(cadOps, r.op_cod, r.op_ds),
        etapaCod: r.etapa_cod,
        etapaDs: r.etapa_ds,
        tipoCod: r.tipo_cod,
        tipoDs: r.tipo_ds,
        talhoes: [],
      };
      ops.set(r.op_cod, o);
    }
    if (!o.talhoes.some((t) => t.propCod === r.prop_cod && t.tlh === r.tlh)) {
      o.talhoes.push({ propCod: r.prop_cod, propNm: r.prop_nm, tlh: r.tlh, areaTlh: r.area_tlh, areaRec: r.area_rec });
    }
  }
  const realizado = {};
  const feitos = await pool.query(
    `SELECT a.op_cod, t.prop_cod, t.tlh, SUM(t.area)::float AS area
       FROM ap_dia a JOIN ap_dia_tlh t ON t.ap_id = a.id
      WHERE a.os = $1 AND ($2::int IS NULL OR a.id <> $2::int)
      GROUP BY a.op_cod, t.prop_cod, t.tlh`,
    [cod, excluirId ?? null],
  );
  for (const f of feitos.rows) (realizado[f.op_cod] ??= {})[chaveTalhao(f.prop_cod, f.tlh)] = round2(f.area);
  const tipos = (
    await pool.query(
      `SELECT DISTINCT t FROM (SELECT NULLIF(tipo_ds, '') AS t FROM os_tlh UNION SELECT NULLIF(tipo_apl, '') FROM ap_dia
                                UNION SELECT NULLIF(nm, '') FROM cad_itm WHERE cad = 'tipo-aplicacao') x WHERE t IS NOT NULL ORDER BY 1 LIMIT 200`,
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

async function lerApontamentos(exec, filtro, params) {
  const { rows } = await exec.query(
    `SELECT a.id, a.bol, a.dt::text AS dt, a.os, a.area_modo, a.area_vol::float AS area_vol, a.op_cod, a.op_ds, a.solic, a.etapa_cod, a.etapa_ds, a.tipo_apl, a.n_eqp, a.n_pes, a.obs,
            a.eqp, a.vazao_rec::float AS vazao_rec, a.vazao_uti::float AS vazao_uti, a.vazao_auto, a.vol_calda::float AS vol_calda, a.usr,
            to_char(a.cri_em AT TIME ZONE 'America/Sao_Paulo', ${FMT}) AS cri_em, a.atu_usr,
            to_char(a.atu_em AT TIME ZONE 'America/Sao_Paulo', ${FMT}) AS atu_em,
            (SELECT json_agg(json_build_object('propCod', t.prop_cod, 'propNm', t.prop_nm, 'tlh', t.tlh, 'areaTlh', t.area_tlh::float, 'area', t.area::float)
                              ORDER BY t.prop_cod, CASE WHEN t.tlh ~ '^[0-9]+$' THEN lpad(t.tlh, 8, '0') ELSE t.tlh END)
               FROM ap_dia_tlh t WHERE t.ap_id = a.id) AS talhoes,
            (SELECT json_agg(json_build_object('cod', i.cod, 'ds', i.ds, 'um', i.um, 'dose', i.dose::float, 'qtd', i.qtd::float, 'dep', i.dep) ORDER BY i.seq)
               FROM ap_dia_ins i WHERE i.ap_id = a.id) AS insumos
       FROM ap_dia a WHERE ${filtro}
      ORDER BY a.dt DESC, a.id DESC`,
    params,
  );
  const cadOps = await operacoesDoCadastro(getPool());
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
      opDs: nomeOperacao(cadOps, r.op_cod, r.op_ds),
      solicitante: r.solic,
      etapaCod: r.etapa_cod,
      etapaDs: r.etapa_ds,
      tipoAplicacao: r.tipo_apl,
      numEquipamentos: r.n_eqp,
      numPessoas: r.n_pes,
      eqp: r.eqp,
      vazaoRec: r.vazao_rec,
      vazaoUti: r.vazao_uti,
      vazaoAuto: r.vazao_auto,
      volCalda: r.vol_calda,
      insumos: r.insumos ?? [],
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

export async function listarApontamentos(f) {
  const pool = getPool();
  await prepararAtividades(pool);
  // buscando um boletim, ele aparece em qualquer data
  if (f.boletim) return lerApontamentos(pool, "a.bol = $1", [f.boletim]);
  return lerApontamentos(pool, "a.dt BETWEEN $1::date AND $2::date AND ($3 = '' OR a.os = $3)", [f.de, f.ate, f.os.trim()]);
}

/** Próximo nº de boletim (o maior lançado + 1), sugerido no formulário. */
export async function proximoBoletimAtividade() {
  const pool = getPool();
  await prepararAtividades(pool);
  return (await pool.query("SELECT (COALESCE(MAX(bol), 0) + 1)::int AS n FROM ap_dia")).rows[0].n;
}

export async function obterApontamento(id, exec) {
  const pool = getPool();
  await prepararAtividades(pool);
  return (await lerApontamentos(exec ?? pool, "a.id = $1", [id]))[0] ?? null;
}

const chaveLog = (a) => `Boletim ${a.boletim ?? `#${a.id}`} · ${a.os ? `O.S. ${a.os}` : `sem O.S. · Fazenda ${a.talhoes[0]?.propCod ?? ""}`} · ${dataBR(a.dt)}`;
const resumoLog = (a) => ({
  boletim: a.boletim,
  data: dataBR(a.dt),
  os: a.os || "sem O.S.",
  area: a.modoArea === "rateio" ? `volume ${a.volume} ha rateado` : "por talhão",
  operacao: `${a.opCod} ${a.opDs}`.trim(),
  solicitante: a.solicitante,
  etapa: `${a.etapaCod} ${a.etapaDs}`.trim(),
  tipoAplicacao: a.tipoAplicacao,
  equipamento: a.eqp || undefined,
  equipamentos: a.numEquipamentos,
  pessoas: a.numPessoas,
  vazaoRecomendada: a.vazaoRec ?? undefined,
  vazaoUtilizada: a.vazaoUti === null ? undefined : `${a.vazaoUti}${a.vazaoAuto ? " (calculada)" : ""}`,
  volumeCalda: a.volCalda ?? undefined,
  insumos: a.insumos.map((i) => `${i.cod}${i.qtd !== null ? `: ${i.qtd} ${i.um}` : ""}`).join("; ") || undefined,
  areaRealizada: a.areaTotal,
  talhoes: a.talhoes.map((t) => `${t.propCod}-${t.tlh}: ${t.area}`).join("; "),
});

/** Talhão já resolvido para gravar (com a área do dia). */
/**
 * Inclui (sem id) ou altera o apontamento. Com O.S., a operação e os talhões têm de existir na O.S.; sem O.S., a fazenda
 * tem de estar no Cadastro de Fazenda e os talhões vêm do que foi informado. A área pode vir talhão a talhão ou como um
 * volume rateado entre os talhões marcados (o rateio é refeito aqui).
 */
export async function salvarApontamento(e, usuario, id) {
  const pool = getPool();
  await prepararAtividades(pool);
  const regras = await regrasApontamento();
  const erro = validarApontamento(e, regras);
  if (erro) return { erro };

  let osNum = "";
  let op;
  let candidatos;
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
        const x = o.talhoes.find((y) => y.propCod === t.propCod && y.tlh === t.tlh);
        return x.areaRec ?? x.areaTlh;
      });
      ratearArea(e.volume, pesos).forEach((a, i) => (candidatos[i].area = a));
    }
  } else {
    // sem O.S.: cada linha traz a fazenda (do Cadastro de Fazenda) e o talhão
    const fazendas = new Map();
    const vistos = new Set();
    candidatos = [];
    for (const t of e.talhoes) {
      const codDigitado = t.propCod.trim();
      if (!fazendas.has(codDigitado)) {
        const faz = await buscarCodigo("fazendas", codDigitado);
        if (!faz.item) return { erro: `A fazenda ${codDigitado} não está no Cadastro de Fazenda. Cadastre ou importe a fazenda antes.` };
        fazendas.set(codDigitado, { cod: faz.item.cod.split("-")[0], nm: faz.item.nm, talhoes: await talhoesDaFazenda(faz.item.cod) });
      }
      const f = fazendas.get(codDigitado);
      const tlh = t.tlh.trim();
      if (vistos.has(`${f.cod}|${tlh}`)) {
        return {
          erro: tlh
            ? `O talhão ${tlh} da fazenda ${f.cod} foi informado duas vezes.`
            : `A fazenda ${f.cod} sem talhão foi informada duas vezes; some as áreas numa linha só.`,
        };
      }
      vistos.add(`${f.cod}|${tlh}`);
      candidatos.push({ propCod: f.cod, propNm: f.nm, tlh, areaTlh: f.talhoes.find((x) => x.tlh === tlh)?.area ?? null, area: t.area });
    }
    if (e.modoArea === "rateio")
      ratearArea(
        e.volume,
        candidatos.map((c) => c.areaTlh),
      ).forEach((a, i) => (candidatos[i].area = a));
    const opDs = e.opDs.trim() || (await descricaoOperacao(pool, e.opCod.trim()));
    op = { cod: e.opCod.trim(), ds: opDs, etapaCod: "", etapaDs: "" };
  }
  // insumos: o código tem de estar no cadastro Material e Insumos (descrição e unidade vêm de lá)
  const temCadastro = (await pool.query("SELECT EXISTS (SELECT 1 FROM cad_itm WHERE cad = 'materiais-insumos') AS tem")).rows[0].tem;
  const insumos = [];
  for (const i of e.insumos) {
    const cod = i.cod.trim();
    const c = (await pool.query("SELECT nm, dds->>'unidade_medida_consumo' AS un FROM cad_itm WHERE cad = 'materiais-insumos' AND cod = $1", [cod])).rows[0];
    if (!c && temCadastro) return { erro: `O insumo ${cod} não está no cadastro Material e Insumos.` };
    insumos.push({ cod, ds: c?.nm ?? "", um: (c?.un ?? "").trim(), dose: i.dose, qtd: i.qtd, dep: i.dep.trim().slice(0, 30) });
  }
  const talhoes = candidatos.filter((t) => t.area > 0);
  if (talhoes.length === 0) return { erro: "Informe a área realizada em pelo menos um talhão." };
  for (const t of talhoes) {
    if (t.areaTlh !== null && t.area > t.areaTlh + 0.001) {
      return {
        erro: `Talhão ${t.propCod}-${t.tlh}: a área realizada (${t.area.toLocaleString("pt-BR")} ha) passa da área do talhão (${t.areaTlh.toLocaleString("pt-BR")} ha).`,
      };
    }
  }
  const etapa =
    !e.semOS && (op.etapaCod === e.etapaCod || !e.etapaCod)
      ? { cod: op.etapaCod, ds: op.etapaDs }
      : { cod: e.etapaCod.trim(), ds: e.etapaCod.trim() ? await descricaoEtapa(pool, e.etapaCod.trim()) : "" };
  const repetido = (await pool.query("SELECT id FROM ap_dia WHERE bol = $1 AND ($2::int IS NULL OR id <> $2::int) LIMIT 1", [e.boletim, id ?? null])).rows[0];
  if (repetido) return { erro: `O boletim nº ${e.boletim} já foi lançado (apontamento #${repetido.id}). Confira o número.` };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let novoId = id;
    let antes = null;
    // vazão utilizada em branco: calculada pelo volume de calda ÷ área do dia
    const areaDia = round2(talhoes.reduce((a, t) => a + t.area, 0));
    const vazaoAuto = e.vazaoUti === null && !!e.volCalda && areaDia > 0;
    // com O.S. a etapa pode ter vindo da operação: confere de novo os obrigatórios com o que vai ser gravado
    const falta = camposFaltando({ ...e, etapaCod: etapa.cod }, regras, vazaoAuto);
    if (falta.length) {
      await client.query("ROLLBACK");
      return { erro: `Preencha: ${falta.join(", ")}.` };
    }
    const vazaoUti = vazaoAuto ? round2(e.volCalda / areaDia) : e.vazaoUti;
    const valores = [
      e.boletim,
      e.dt,
      osNum,
      op.cod,
      op.ds,
      e.solicitante.trim(),
      etapa.cod,
      etapa.ds,
      e.tipoAplicacao.trim(),
      e.numEquipamentos,
      e.numPessoas,
      e.obs.trim().slice(0, 300),
      e.modoArea,
      e.modoArea === "rateio" ? round2(e.volume) : null,
      e.eqp.trim().slice(0, 40),
      e.vazaoRec,
      vazaoUti,
      vazaoAuto,
      e.volCalda,
    ];
    if (id === undefined) {
      novoId = (
        await client.query(
          `INSERT INTO ap_dia (bol, dt, os, op_cod, op_ds, solic, etapa_cod, etapa_ds, tipo_apl, n_eqp, n_pes, obs, area_modo, area_vol,
                               eqp, vazao_rec, vazao_uti, vazao_auto, vol_calda, usr)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING id`,
          [...valores, usuario],
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
                area_modo=$13, area_vol=$14, eqp=$15, vazao_rec=$16, vazao_uti=$17, vazao_auto=$18, vol_calda=$19,
                atu_usr=$20, atu_em=now() WHERE id=$21`,
        [...valores, usuario, id],
      );
      await client.query("DELETE FROM ap_dia_tlh WHERE ap_id = $1", [id]);
    }
    for (const t of talhoes) {
      await client.query("INSERT INTO ap_dia_tlh (ap_id, prop_cod, prop_nm, tlh, area_tlh, area) VALUES ($1,$2,$3,$4,$5,$6)", [
        novoId,
        t.propCod,
        t.propNm,
        t.tlh,
        t.areaTlh,
        round2(t.area),
      ]);
    }
    await client.query("DELETE FROM ap_dia_ins WHERE ap_id = $1", [novoId]);
    for (const [seq, i] of insumos.entries()) {
      await client.query("INSERT INTO ap_dia_ins (ap_id, seq, cod, ds, um, dose, qtd, dep) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)", [
        novoId,
        seq + 1,
        i.cod,
        i.ds,
        i.um,
        i.dose,
        i.qtd,
        i.dep,
      ]);
    }
    const depois = await obterApontamento(novoId, client);
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
    return { id: novoId };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function excluirApontamento(id, usuario) {
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

async function existe(pool, tabela) {
  return !!(await pool.query("SELECT to_regclass($1)::text AS r", [tabela])).rows[0].r;
}

async function descricaoOperacao(pool, cod) {
  const doCadastro = nomeOperacao(await operacoesDoCadastro(pool), cod, "");
  if (doCadastro) return doCadastro;
  const fontes = [
    "SELECT op_ds AS d FROM ap_dia WHERE op_cod = $1 AND op_ds <> '' LIMIT 1",
    "SELECT op_ds AS d FROM os_tlh WHERE op_cod = $1 AND op_ds <> '' LIMIT 1",
  ];
  if (await existe(pool, "os_agr")) fontes.unshift("SELECT op_ds AS d FROM os_agr WHERE op_cod = $1 AND op_ds <> '' LIMIT 1");
  for (const sql of fontes) {
    const d = (await pool.query(sql, [cod])).rows[0]?.d;
    if (d) return d;
  }
  return "";
}

async function descricaoEtapa(pool, cod) {
  await prepararOSAgr(pool); // carga inicial do cadastro de Etapa
  return (await pool.query("SELECT nm FROM cad_itm WHERE cad = 'etapa' AND cod = $1", [cod])).rows[0]?.nm ?? "";
}

export async function opcoesApontamento() {
  const pool = getPool();
  await prepararAtividades(pool);
  await prepararOSAgr(pool);
  const ops = await pool.query(
    `SELECT op_cod AS cod, MAX(op_ds) AS ds, MAX(etapa_cod) AS etapa FROM (
       SELECT op_cod, op_ds, etapa_cod FROM os_agr UNION ALL SELECT op_cod, op_ds, etapa_cod FROM os_tlh
       UNION ALL SELECT op_cod, op_ds, etapa_cod FROM ap_dia) x
      WHERE op_cod <> '' GROUP BY op_cod ORDER BY 2, 1`,
  );
  const etapas = await pool.query(
    "SELECT cod, nm AS ds FROM cad_itm WHERE cad = 'etapa' ORDER BY CASE WHEN cod ~ '^[0-9]+$' THEN lpad(cod, 8, '0') ELSE cod END",
  );
  const tipos = await pool.query(
    `SELECT DISTINCT t FROM (SELECT NULLIF(nm, '') AS t FROM cad_itm WHERE cad = 'tipo-aplicacao' UNION SELECT NULLIF(tipo_apl, '') FROM ap_dia) x
      WHERE t IS NOT NULL ORDER BY 1`,
  );
  const solic = await pool.query(
    `SELECT DISTINCT s FROM (SELECT NULLIF(nm, '') AS s FROM cad_itm WHERE cad = 'responsaveis-os' UNION SELECT NULLIF(solic, '') FROM ap_dia) x
      WHERE s IS NOT NULL ORDER BY 1`,
  );
  // as operações vêm do cadastro Operações; as das O.S./apontamentos que ainda não estão nele continuam disponíveis
  const cadOps = await operacoesDoCadastro(pool);
  const daOrigem = new Map(ops.rows.map((r) => [codigoOperacao(r.cod), r]));
  const operacoes = [
    ...[...cadOps.values()].map((o) => ({ cod: o.cod, ds: o.nm, etapaCod: daOrigem.get(codigoOperacao(o.cod))?.etapa ?? "" })),
    ...ops.rows.filter((r) => !cadOps.has(codigoOperacao(r.cod))).map((r) => ({ cod: r.cod, ds: r.ds, etapaCod: r.etapa })),
  ].sort((a, b) => a.cod.localeCompare(b.cod, undefined, { numeric: true }) || a.ds.localeCompare(b.ds));
  return {
    operacoes,
    etapas: etapas.rows,
    tipos: tipos.rows.map((r) => r.t),
    solicitantes: solic.rows.map((r) => r.s),
    regras: await regrasApontamento(),
  };
}

// ---------------------------------------------------------------------------
// Verificação: apontamentos sem O.S. x O.S. abertas da mesma operação e talhões
// ---------------------------------------------------------------------------

/**
 * Para cada apontamento sem O.S. do período, procura O.S. abertas (não encerradas) com a mesma operação e algum dos
 * talhões apontados, nas duas bases de O.S.; as que cobrem mais talhões vêm primeiro.
 */
export async function verificarSemOS(de, ate) {
  const pool = getPool();
  await prepararAtividades(pool);
  await prepararOSAgr(pool);
  const semOS = await lerApontamentos(pool, "a.os = '' AND a.dt BETWEEN $1::date AND $2::date", [de, ate]);
  if (semOS.length === 0) return [];
  const { rows } = await pool.query(
    `WITH alvo AS (
       SELECT a.id, a.op_cod, t.prop_cod, t.tlh FROM ap_dia a JOIN ap_dia_tlh t ON t.ap_id = a.id
        WHERE a.id = ANY($1::int[])
     ), cand AS (
       SELECT x.id, o.os, x.prop_cod || '|' || x.tlh AS k, o.dt_os::text AS dt_os,
              CASE o.posicao WHEN 'A' THEN 'Aberta' WHEN 'L' THEN 'Liberada' ELSE o.posicao END AS sit
         FROM alvo x JOIN os_agr o ON o.op_cod = x.op_cod AND o.prop_cod = x.prop_cod AND (o.tlh || o.letra) = x.tlh AND o.posicao <> 'E'
       UNION ALL
       SELECT x.id, o.os, x.prop_cod || '|' || x.tlh, o.dt_lanc::text, o.sts
         FROM alvo x JOIN os_tlh o ON o.op_cod = x.op_cod AND o.prop_cod = x.prop_cod AND o.tlh = x.tlh AND o.sts !~* 'encerr'
     )
     SELECT id, os, COUNT(DISTINCT k)::int AS n, MAX(dt_os) AS dt_os, MAX(sit) AS sit
       FROM cand GROUP BY id, os ORDER BY id, n DESC, MAX(dt_os) DESC NULLS LAST`,
    [semOS.map((a) => a.id)],
  );
  return semOS.map((a) => ({
    id: a.id,
    boletim: a.boletim,
    dt: a.dt,
    opCod: a.opCod,
    opDs: a.opDs,
    fazendas: Array.from(new Set(a.talhoes.map((t) => `${t.propCod} · ${t.propNm}`))),
    nTalhoes: a.talhoes.length,
    area: a.areaTotal,
    candidatos: rows
      .filter((r) => r.id === a.id)
      .slice(0, 5)
      .map((r) => ({ os: r.os, talhoes: r.n, dtOs: r.dt_os, situacao: r.sit })),
  }));
}

/** Corrige um apontamento lançado sem O.S., ligando-o à O.S. informada (a operação tem de existir nela). */
export async function vincularOS(id, os, usuario) {
  const pool = getPool();
  await prepararAtividades(pool);
  const antes = await obterApontamento(id);
  if (!antes) return { erro: "Apontamento não encontrado." };
  if (antes.os) return { erro: `O apontamento já está na O.S. ${antes.os}.` };
  const info = await consultarOS(os.trim());
  if (!info) return { erro: `A O.S. ${os.trim()} não está na base de O.S.` };
  const op = info.operacoes.find((o) => o.cod === antes.opCod);
  if (!op) return { erro: `A operação ${antes.opCod} não faz parte da O.S. ${info.os}.` };
  const foraDaOS = antes.talhoes.filter((t) => !op.talhoes.some((x) => x.propCod === t.propCod && x.tlh === t.tlh)).map((t) => `${t.propCod}-${t.tlh}`);
  await pool.query(
    `UPDATE ap_dia SET os = $1, op_ds = CASE WHEN op_ds = '' THEN $2 ELSE op_ds END,
            etapa_cod = CASE WHEN etapa_cod = '' THEN $3 ELSE etapa_cod END, etapa_ds = CASE WHEN etapa_cod = '' THEN $4 ELSE etapa_ds END,
            atu_usr = $5, atu_em = now() WHERE id = $6`,
    [info.os, op.ds, op.etapaCod, op.etapaDs, usuario, id],
  );
  const depois = await obterApontamento(id);
  await auditar(pool, {
    usuario,
    modulo: "Atividades",
    entidade: "Apontamento diário",
    chave: chaveLog(depois),
    acao: "alteracao",
    antes: { os: "sem O.S." },
    depois: { os: info.os, verificacao: "O.S. encontrada na verificação de apontamentos sem O.S.", talhoesForaDaOS: foraDaOS.join(", ") || undefined },
  });
  return { ok: true, foraDaOS };
}

// ---------------------------------------------------------------------------
// Parâmetros › Apontamento Diário: campos obrigatórios
// ---------------------------------------------------------------------------

const CHAVE_REGRAS = "apontamento.obrigatorios";

export async function regrasApontamento() {
  const pool = getPool();
  await prepararAtividades(pool);
  const v = (await pool.query("SELECT valor FROM app_param WHERE chave = $1", [CHAVE_REGRAS])).rows[0]?.valor;
  return normalizarRegras(v);
}

export async function salvarRegrasApontamento(regras, usuario) {
  const pool = getPool();
  await prepararAtividades(pool);
  const antes = await regrasApontamento();
  const novas = normalizarRegras(regras);
  await pool.query(
    `INSERT INTO app_param (chave, valor, atu_usr) VALUES ($1, $2::jsonb, $3)
     ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor, atu_usr = EXCLUDED.atu_usr, atu_em = now()`,
    [CHAVE_REGRAS, JSON.stringify(novas), usuario],
  );
  await auditar(pool, {
    usuario,
    modulo: "Parâmetros",
    entidade: "Apontamento Diário",
    chave: "Campos obrigatórios",
    acao: "alteracao",
    antes,
    depois: novas,
  });
  return novas;
}
