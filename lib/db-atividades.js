import { auditar, dataBR } from "./auditar";
import { camposFaltando, chaveTalhao, normalizarRegras, ratearArea, round2, validarApontamento } from "./atividades";
import { codigoOperacao } from "./dashboard-atividades";
import { getPool, prepararBanco } from "./db";
import { nomeOperacao, operacoesDoCadastro } from "./db-operacoes";
import { prepararOSAgr } from "./db-os-agr";
import { buscarCodigo, talhoesDaFazenda } from "./db-rodadas";
import { areasDaBase } from "./db-talhoes";
import { normFaz, normTlh } from "./ocupacao";
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
      // apontador / informante: quem passou a informação (no bot do WhatsApp, quem mandou a mensagem)
      await pool.query("ALTER TABLE ap_dia ADD COLUMN IF NOT EXISTS apont text NOT NULL DEFAULT ''");
      // Lançamento Mobile: prestador / equipe, atividade, status da O.S. informado no campo, unidade da calda ('' = L,
      // 'L' ou 'kg'), matrícula de quem lançou e o modelo do texto do WhatsApp ('mecanizada' | 'manual')
      for (const c of ["equipe", "ativ", "sts_os", "un_calda", "apont_mat", "tp_op"]) {
        await pool.query(`ALTER TABLE ap_dia ADD COLUMN IF NOT EXISTS ${c} text NOT NULL DEFAULT ''`);
      }
      // Lançamento Mobile com várias O.S.: um apontamento por O.S./operação (cada um com o seu boletim), ligados pelo
      // mesmo lanc_grp (uuid do lançamento); NULL no lançamento de uma O.S. só e nos lançados pela tela e pelo bot
      await pool.query("ALTER TABLE ap_dia ADD COLUMN IF NOT EXISTS lanc_grp text");
      await pool.query("CREATE INDEX IF NOT EXISTS idx_ap_dia_lanc_grp ON ap_dia (lanc_grp) WHERE lanc_grp IS NOT NULL");
      // mensagem do grupo com o texto gerado pelo Lançamento Mobile (marca do boletim): ligada ao boletim já lançado, o
      // bot não grava nada dela, nem editada nem apagada no grupo (sem FK: boletim excluído não faz a mensagem voltar)
      await pool.query(
        "CREATE TABLE IF NOT EXISTS ap_dia_msg (orig_chave text PRIMARY KEY, ap_id integer, bol integer, msg text, em timestamptz NOT NULL DEFAULT now())",
      );
      // apontamentos do WhatsApp gravados antes do campo ganham o remetente (uma vez); os do bot que ninguém conferiu, sem
      // solicitante, o responsável da O.S. (falha aqui não impede o resto: tenta de novo no próximo início)
      await preencherApontadorUmaVez(pool).catch((err) => console.error("Apontador dos apontamentos do WhatsApp não preenchido:", err));
      await preencherSolicitanteDoBot(pool).catch((err) => console.error("Solicitante dos apontamentos do bot não preenchido:", err));
      // conferência dos apontamentos do bot: quem conferiu e quando (editar ou ligar a O.S. não confere)
      await pool.query("ALTER TABLE ap_dia ADD COLUMN IF NOT EXISTS conf_usr text");
      await pool.query("ALTER TABLE ap_dia ADD COLUMN IF NOT EXISTS conf_em timestamptz");
      // apontamento do bot excluído por uma pessoa: o bot não recria quando a mensagem é editada no grupo
      await pool.query(
        "CREATE TABLE IF NOT EXISTS ap_dia_exc (orig_chave text PRIMARY KEY, usr text NOT NULL DEFAULT '', em timestamptz NOT NULL DEFAULT now())",
      );
      await marcarConferidosUmaVez(pool).catch((err) => console.error("Conferência dos apontamentos do bot já alterados não marcada:", err));
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

/** Resumo da base de O.S. de Ordem de Serviço Agr. (a que o apontamento consulta). */
export async function resumoBaseOS() {
  const pool = getPool();
  await prepararOSAgr(pool);
  const r = (
    await pool.query("SELECT COUNT(*)::int AS n, to_char(MAX(atu_em) AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') AS ult FROM os_agr_os")
  ).rows[0];
  return { ordens: r.n, ultimaImportacao: r.ult };
}

/**
 * Nome do responsável (solicitante) da O.S.: o do Cadastro de Responsáveis (Ordem de Serviço Agr.) pela matrícula da
 * O.S.; sem a matrícula no cadastro, o "Nome" de qualquer linha do relatório.
 */
async function responsavelDaOS(pool, rows) {
  // primeiro o Cadastro de Responsáveis (Ordem de Serviço Agr.) pela matrícula da O.S.; sem ele, o nome do relatório
  const mat = rows.map((r) => String(r.resp_cod ?? "").trim()).find((c) => c && c !== "0");
  if (mat) {
    const { rows: cad } = await pool.query(
      "SELECT nm FROM cad_itm WHERE cad = 'responsaveis-os' AND btrim(nm) <> '' AND (cod = $1 OR (cod ~ '^[0-9]+$' AND $1 ~ '^[0-9]+$' AND ltrim(cod, '0') = ltrim($1, '0'))) ORDER BY COALESCE(atv, true) DESC LIMIT 1",
      [mat],
    );
    if (cad[0]?.nm) return cad[0].nm.trim();
  }
  return rows.map((r) => String(r.resp ?? "").trim()).find(Boolean) ?? "";
}

/** Responsável da O.S. (código sem zeros à esquerda) pela regra de consultarOS: a base de Ordem de Serviço Agr. e, sem ela, a antiga. */
async function responsavelPorOS(pool, cod, temOsAgr) {
  const ordem = "ORDER BY op_cod, prop_cod, CASE WHEN tlh ~ '^[0-9]+$' THEN lpad(tlh, 8, '0') ELSE tlh END";
  let rows = temOsAgr ? (await pool.query(`SELECT resp_nm AS resp, resp_cod FROM os_agr WHERE os = $1 ${ordem}`, [cod])).rows : [];
  if (rows.length === 0) rows = (await pool.query(`SELECT resp FROM os_tlh WHERE os = $1 ${ordem}`, [cod])).rows;
  return responsavelDaOS(pool, rows);
}

const MARCA_APONTADOR = "Apontador dos apontamentos do WhatsApp pela mensagem (v1)";

/**
 * Uma vez só: os apontamentos do WhatsApp gravados antes do campo Apontador / Informante ganham o remetente, que está na
 * observação ("WhatsApp grupo · Fulano · mensagem de …"). Depois disso o campo é de quem confere (apagado, fica apagado).
 */
async function preencherApontadorUmaVez(pool) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('ap_dia_apontador_v1'))");
    const feita = ((await client.query("SELECT 1 FROM aud_log WHERE modulo = 'Atividades' AND chave = $1 LIMIT 1", [MARCA_APONTADOR])).rowCount ?? 0) > 0;
    if (!feita) {
      const r = await client.query(
        `UPDATE ap_dia SET apont = left(btrim(substring(obs from '^WhatsApp [^·]*· ([^·]+) · mensagem de')), 80)
          WHERE apont = '' AND orig = 'whatsapp' AND obs ~ '^WhatsApp [^·]*· [^·]+ · mensagem de'`,
      );
      await auditar(client, {
        usuario: "Sistema",
        modulo: "Atividades",
        entidade: "Apontamento diário",
        chave: MARCA_APONTADOR,
        acao: "alteracao",
        depois: { apontamentosPreenchidos: r.rowCount ?? 0 },
      });
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Apontamentos do bot que ninguém conferiu, sem solicitante: o responsável da O.S. pela mesma regra do lançamento (a
 * O.S. pode ter entrado na base depois da mensagem). O que uma pessoa gravou fica como está.
 */
async function preencherSolicitanteDoBot(pool) {
  const { rows } = await pool.query(
    "SELECT DISTINCT os FROM ap_dia WHERE orig = 'whatsapp' AND solic = '' AND os ~ '^[0-9]+$' AND (atu_usr IS NULL OR atu_usr = $1)",
    [BOT_WHATSAPP],
  );
  if (rows.length === 0) return;
  const temOsAgr = (await pool.query("SELECT to_regclass('os_agr') IS NOT NULL AS ok")).rows[0].ok;
  const porOS = {};
  for (const { os } of rows) {
    const nome = (await responsavelPorOS(pool, os.replace(/^0+(?=\d)/, ""), temOsAgr)).slice(0, 120);
    if (!nome) continue;
    const r = await pool.query(
      "UPDATE ap_dia SET solic = $1 WHERE orig = 'whatsapp' AND solic = '' AND os = $2 AND (atu_usr IS NULL OR atu_usr = $3)",
      [nome, os, BOT_WHATSAPP],
    );
    if (r.rowCount) porOS[`O.S. ${os}`] = `${nome} (${r.rowCount})`;
  }
  if (Object.keys(porOS).length > 0) {
    await auditar(pool, {
      usuario: "Sistema",
      modulo: "Atividades",
      entidade: "Apontamento diário",
      chave: "Solicitante do bot pelo responsável da O.S.",
      acao: "alteracao",
      depois: porOS,
    });
  }
}

const MARCA_CONFERIDOS = "Conferência dos apontamentos do bot pela última alteração (v1)";

/**
 * Uma vez só: conferir passou a ser um ato à parte (conf_usr / conf_em). Os apontamentos do bot que já contavam como
 * conferidos (alterados por uma pessoa) ficam conferidos por ela, na data da alteração.
 */
async function marcarConferidosUmaVez(pool) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('ap_dia_conferidos_v1'))");
    const feita = ((await client.query("SELECT 1 FROM aud_log WHERE modulo = 'Atividades' AND chave = $1 LIMIT 1", [MARCA_CONFERIDOS])).rowCount ?? 0) > 0;
    if (!feita) {
      const r = await client.query(
        `UPDATE ap_dia SET conf_usr = atu_usr, conf_em = COALESCE(atu_em, now())
          WHERE usr = $1 AND conf_em IS NULL AND atu_usr IS NOT NULL AND atu_usr <> '' AND atu_usr <> $1`,
        [BOT_WHATSAPP],
      );
      await auditar(client, {
        usuario: "Sistema",
        modulo: "Atividades",
        entidade: "Apontamento diário",
        chave: MARCA_CONFERIDOS,
        acao: "alteracao",
        depois: { apontamentosConferidos: r.rowCount ?? 0 },
      });
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Operações da O.S. com os talhões de cada uma, das linhas de os_agr ou os_tlh (como consultarOS lê). A área do talhão
 * vem da base Fazenda e Talhões (`base`, de areasDaBase); talhão fora dela fica com a área plantada da O.S.
 */
export function operacoesDaOS(rows, base, cadOps) {
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
      const daBase = base.areas.get(`${normFaz(r.prop_cod)}|${normTlh(r.tlh)}`);
      o.talhoes.push({
        propCod: r.prop_cod,
        propNm: r.prop_nm,
        tlh: r.tlh,
        areaTlh: daBase ?? r.area_tlh,
        areaRec: r.area_rec,
        naBase: daBase !== undefined,
      });
    }
  }
  return Array.from(ops.values());
}

/**
 * A O.S. com as operações e os talhões de cada uma, e a área já apontada (sem contar o apontamento `excluirId`). A área
 * do talhão vem da base Fazenda e Talhões da safra da data `dt` (sem data, a de hoje); talhão que não está na base fica
 * com a área plantada da O.S. (`naBase` = false).
 */
export async function consultarOS(os, excluirId, dt) {
  const pool = getPool();
  await prepararAtividades(pool);
  const cod = os.trim().replace(/^0+(?=\d)/, "");
  // a base é a de Ordem de Serviço Agr. (Relatório de Ordens de Serviço, importado em Ordem de Serviço Agr. › Ordens de Serviço)
  await prepararOSAgr(pool);
  let rows = (
    await pool.query(
      `SELECT emp, os, prop_cod, prop_nm, tlh || letra AS tlh, area_plant::float AS area_tlh, area_rec::float AS area_rec, op_cod, op_ds, etapa_cod, etapa_ds,
              '' AS tipo_cod, '' AS tipo_ds, resp_nm AS resp, resp_cod, posicao AS sts, safra, dt_os::text AS dt_lanc, obs
         FROM os_agr WHERE os = $1
        ORDER BY op_cod, prop_cod, CASE WHEN tlh ~ '^[0-9]+$' THEN lpad(tlh, 8, '0') ELSE tlh END`,
      [cod],
    )
  ).rows;
  // a antiga base de Acompanhamento de O.S. (que era importada no Apontamento) traz o tipo de aplicação da operação
  // e vale sozinha só para a O.S. que não está na base de Ordem de Serviço Agr.
  const antiga = (
    await pool.query(
      `SELECT emp, os, prop_cod, prop_nm, tlh, area_tlh::float AS area_tlh, area_rec::float AS area_rec, op_cod, op_ds, etapa_cod, etapa_ds,
              tipo_cod, tipo_ds, resp, sts, safra, dt_lanc::text AS dt_lanc, obs
         FROM os_tlh WHERE os = $1
        ORDER BY op_cod, prop_cod, CASE WHEN tlh ~ '^[0-9]+$' THEN lpad(tlh, 8, '0') ELSE tlh END`,
      [cod],
    )
  ).rows;
  if (rows.length === 0) rows = antiga;
  else {
    const tipoDaOp = new Map(antiga.filter((r) => r.op_cod && (r.tipo_ds || r.tipo_cod)).map((r) => [r.op_cod, r]));
    rows = rows.map((r) => (tipoDaOp.has(r.op_cod) ? { ...r, tipo_cod: tipoDaOp.get(r.op_cod).tipo_cod, tipo_ds: tipoDaOp.get(r.op_cod).tipo_ds } : r));
  }
  rows = rows.map((r) => ({ ...r, sts: nomePosicao(r.sts) }));
  if (rows.length === 0) return null;
  const p = rows[0];
  const resp = await responsavelDaOS(pool, rows);
  const base = await areasDaBase(
    rows.map((r) => r.prop_cod),
    dt,
    pool,
  );
  const cadOps = await operacoesDoCadastro(pool);
  const realizado = {};
  const feitos = await pool.query(
    `SELECT a.op_cod, t.prop_cod, t.tlh, SUM(t.area)::float AS area
       FROM ap_dia a JOIN ap_dia_tlh t ON t.ap_id = a.id
      WHERE a.os = $1 AND ($2::int IS NULL OR a.id <> $2::int)
      GROUP BY a.op_cod, t.prop_cod, t.tlh`,
    [cod, excluirId ?? null],
  );
  for (const f of feitos.rows) (realizado[f.op_cod] ??= {})[chaveTalhao(f.prop_cod, f.tlh)] = round2(f.area);
  // sugestões do tipo de aplicação: sem os de item inativo do cadastro Tipo Aplicação
  const tipos = (
    await pool.query(
      `SELECT DISTINCT t FROM (SELECT NULLIF(tipo_ds, '') AS t FROM os_tlh UNION SELECT NULLIF(tipo_apl, '') FROM ap_dia
                                UNION SELECT NULLIF(nm, '') FROM cad_itm WHERE cad = 'tipo-aplicacao' AND atv) x
        WHERE t IS NOT NULL AND ${naoSoDeInativo("tipo-aplicacao", "x.t")} ORDER BY 1 LIMIT 200`,
    )
  ).rows.map((r) => r.t);
  return {
    os: p.os,
    emp: p.emp,
    status: p.sts,
    safra: p.safra,
    resp,
    obs: p.obs,
    dtLanc: p.dt_lanc,
    operacoes: operacoesDaOS(rows, base, cadOps),
    realizado,
    tiposConhecidos: tipos,
    // safra da base Fazenda e Talhões de onde veio a área dos talhões (null = base vazia)
    safraArea: base.safra,
  };
}

// ---------------------------------------------------------------------------
// Apontamentos
// ---------------------------------------------------------------------------

const FMT = `'DD/MM/YYYY HH24:MI'`;

/**
 * Versão do apontamento (SQL, `a` = alias de ap_dia): a hora exata (UTC, com microssegundos) da última gravação — do
 * bot, de uma pessoa ou da conferência (todas gravam atu_em); nunca alterado, a da inclusão. Marcar como conferido só
 * vale para a versão que foi analisada na tela.
 */
export const versaoApontamentoSQL = (a) => `to_char(COALESCE(${a}.atu_em, ${a}.cri_em) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

async function lerApontamentos(exec, filtro, params) {
  const { rows } = await exec.query(
    `SELECT a.id, a.bol, a.dt::text AS dt, a.os, a.area_modo, a.area_vol::float AS area_vol, a.op_cod, a.op_ds, a.solic, a.apont, a.etapa_cod, a.etapa_ds, a.tipo_apl, a.n_eqp, a.n_pes, a.obs,
            a.eqp, a.vazao_rec::float AS vazao_rec, a.vazao_uti::float AS vazao_uti, a.vazao_auto, a.vol_calda::float AS vol_calda, a.usr,
            to_char(a.cri_em AT TIME ZONE 'America/Sao_Paulo', ${FMT}) AS cri_em, a.atu_usr,
            to_char(a.atu_em AT TIME ZONE 'America/Sao_Paulo', ${FMT}) AS atu_em, a.orig, a.orig_msg, a.conf_usr,
            to_char(a.conf_em AT TIME ZONE 'America/Sao_Paulo', ${FMT}) AS conf_em, ${versaoApontamentoSQL("a")} AS versao,
            a.equipe, a.ativ, a.sts_os, a.un_calda, a.apont_mat, a.tp_op, a.lanc_grp,
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
      apontador: r.apont ?? "",
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
      // origem: "whatsapp" (bot ou carga inicial), "mobile" (Lançamento Mobile) ou "" (lançado na tela); texto da mensagem guardado
      orig: r.orig ?? "",
      origMsg: r.orig_msg ?? "",
      // campos do Lançamento Mobile (em branco nos lançados pela tela e pelo bot)
      equipe: r.equipe ?? "",
      atividade: r.ativ ?? "",
      statusOS: r.sts_os ?? "",
      unCalda: r.un_calda ?? "",
      apontadorMat: r.apont_mat ?? "",
      modelo: r.tp_op ?? "",
      // lançamento do Lançamento Mobile com várias O.S. a que o apontamento pertence (null: uma O.S. só, tela ou bot)
      lancGrp: r.lanc_grp ?? null,
      // conferência (apontamento do bot): quem conferiu e quando
      confUsr: r.conf_usr ?? null,
      confEm: r.conf_em ?? null,
      // versão (muda a cada gravação): a conferência só marca a versão analisada
      versao: r.versao,
      // lançado pelo bot e ainda não conferido por uma pessoa (editar não confere; o bot só regrava o que ninguém alterou)
      aConferir: r.usr === BOT_WHATSAPP && !r.conf_em,
    };
  });
}

export async function listarApontamentos(f) {
  const pool = getPool();
  await prepararAtividades(pool);
  // buscando um boletim, ele aparece em qualquer data
  const lista = f.boletim
    ? await lerApontamentos(pool, "a.bol = $1", [f.boletim])
    : await lerApontamentos(pool, "a.dt BETWEEN $1::date AND $2::date AND ($3 = '' OR a.os = $3)", [f.de, f.ate, f.os.trim()]);
  return marcarOSForaDaBase(pool, lista);
}

/**
 * `osForaDaBase` em cada apontamento: lançado com uma O.S. que não está mais na base de O.S. (Ordem de Serviço Agr. nem
 * a antiga) — ex.: saiu numa importação do Relatório de Ordens de Serviço. A tela Apontamento destaca a linha inteira.
 */
async function marcarOSForaDaBase(pool, lista) {
  const oss = [...new Set(lista.filter((a) => String(a.os ?? "").trim()).map((a) => semZeros(a.os)))];
  if (oss.length === 0) return lista.map((a) => ({ ...a, osForaDaBase: false }));
  await prepararOSAgr(pool);
  const naBase = new Set(
    (await pool.query("SELECT DISTINCT os FROM os_agr WHERE os = ANY($1::text[]) UNION SELECT DISTINCT os FROM os_tlh WHERE os = ANY($1::text[])", [oss])).rows.map(
      (r) => semZeros(r.os),
    ),
  );
  return lista.map((a) => ({ ...a, osForaDaBase: !!String(a.os ?? "").trim() && !naBase.has(semZeros(a.os)) }));
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

export const chaveLog = (a) => `Boletim ${a.boletim ?? `#${a.id}`} · ${a.os ? `O.S. ${a.os}` : `sem O.S. · Fazenda ${a.talhoes[0]?.propCod ?? ""}`} · ${dataBR(a.dt)}`;
const resumoLog = (a) => ({
  boletim: a.boletim,
  data: dataBR(a.dt),
  os: a.os || "sem O.S.",
  area: a.modoArea === "rateio" ? `volume ${a.volume} ha rateado` : "por talhão",
  operacao: `${a.opCod} ${a.opDs}`.trim(),
  solicitante: a.solicitante,
  apontador: a.apontador || undefined,
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
  // Lançamento Mobile (vazios não entram no log)
  equipe: a.equipe || undefined,
  atividade: a.atividade || undefined,
  statusOS: a.statusOS || undefined,
  unidadeCalda: a.unCalda || undefined,
  matriculaApontador: a.apontadorMat || undefined,
  modeloTexto: a.modelo || undefined,
  origem: a.orig === "mobile" ? "Lançamento Mobile" : undefined,
});

/**
 * Talhão do Cadastro de Fazenda com a área da base Fazenda e Talhões da safra da data, como no apontamento sem O.S.
 * (`fazendas` guarda as fazendas já consultadas; "01" = "1").
 */
async function talhaoDoCadastro(fazendas, t, dt) {
  const codDigitado = t.propCod.trim();
  if (!fazendas.has(codDigitado)) {
    const faz = await buscarCodigo("fazendas", codDigitado);
    if (!faz.item) return { erro: `A fazenda ${codDigitado} não está no Cadastro de Fazenda. Cadastre ou importe a fazenda antes.` };
    fazendas.set(codDigitado, { cod: faz.item.cod.split("-")[0], nm: faz.item.nm, talhoes: await talhoesDaFazenda(faz.item.cod, dt) });
  }
  const f = fazendas.get(codDigitado);
  const daBase = f.talhoes.find((x) => normTlh(x.tlh) === normTlh(t.tlh));
  return { propCod: f.cod, propNm: f.nm, tlh: daBase?.tlh ?? t.tlh.trim(), areaTlh: daBase?.area ?? null };
}

/**
 * Talhões do apontamento com O.S. aceitando fazendas e talhões que não estão nela (Lançamento Mobile). O talhão da O.S.
 * com outra grafia ("09442|05" = "9442|5") fica com o código da O.S. (conta no "Já apontado"); o de fora vem do Cadastro
 * de Fazenda e da base Fazenda e Talhões da data. Repetido é erro; no rateio, o peso de cada um é a área recomendada da
 * O.S. (ou a do talhão).
 */
async function candidatosComForaDaOS(o, e) {
  const fazendas = new Map();
  const vistos = new Set();
  const candidatos = [];
  const foraDaOS = [];
  for (const t of e.talhoes) {
    // sem área (fora do rateio) não é gravado: não precisa estar no cadastro
    if (e.modoArea !== "rateio" && !(t.area > 0)) continue;
    const doOS =
      o.talhoes.find((x) => x.propCod === t.propCod && x.tlh === t.tlh) ??
      o.talhoes.find((x) => normFaz(x.propCod) === normFaz(t.propCod) && normTlh(x.tlh) === normTlh(t.tlh));
    let c;
    if (doOS) c = { propCod: doOS.propCod, propNm: doOS.propNm, tlh: doOS.tlh, areaTlh: doOS.areaTlh, peso: doOS.areaRec ?? doOS.areaTlh };
    else {
      if (!t.propCod.trim()) return { erro: "Informe a fazenda do talhão que não está na O.S." };
      const r = await talhaoDoCadastro(fazendas, t, e.dt);
      if (r.erro) return r;
      c = { ...r, peso: r.areaTlh };
      foraDaOS.push(r.tlh ? `${r.propCod}-${r.tlh}` : `${r.propCod} (sem talhão)`);
    }
    const k = `${normFaz(c.propCod)}|${normTlh(c.tlh)}`;
    if (vistos.has(k)) {
      return {
        erro: c.tlh
          ? `O talhão ${c.tlh} da fazenda ${c.propCod} foi informado duas vezes.`
          : `A fazenda ${c.propCod} sem talhão foi informada duas vezes; some as áreas numa linha só.`,
      };
    }
    vistos.add(k);
    candidatos.push({ ...c, area: t.area });
  }
  if (e.modoArea === "rateio")
    ratearArea(
      e.volume,
      candidatos.map((c) => c.peso),
    ).forEach((a, i) => (candidatos[i].area = a));
  return { candidatos, foraDaOS };
}

/** Campo do Lançamento Mobile para gravar: sem ele (tela Apontamento, bot) null — a edição mantém o gravado e o novo fica em branco. */
const campoMobile = (v, n) => (v === undefined || v === null ? null : String(v).trim().slice(0, n));

/**
 * Boletim do Lançamento Mobile (`id`) editado sem aceitar talhões fora da O.S. (tela Apontamento): os talhões gravados
 * que estão fora da O.S. e da operação gravadas ("09442|05" = "9442|5") e não vieram na edição (`e.talhoes`). A tela não
 * os mostra nem manda, então regravar os apagaria sem ninguém pedir. Vazio para o que não é do Lançamento Mobile.
 */
async function foraDaOSDoMobile(pool, id, e) {
  const g = (await pool.query("SELECT os, op_cod FROM ap_dia WHERE id = $1 AND orig = 'mobile'", [id])).rows[0];
  if (!g) return [];
  const gravados = (await pool.query("SELECT prop_cod, tlh FROM ap_dia_tlh WHERE ap_id = $1 ORDER BY prop_cod, tlh", [id])).rows;
  // só os talhões importam (a área não): sem a data da edição, que ainda não foi validada
  const info = g.os ? await consultarOS(g.os, id) : null;
  const daOS = info?.operacoes.find((x) => x.cod === g.op_cod)?.talhoes ?? [];
  // no rateio vão os talhões marcados; por talhão, os com área
  const enviados = e.modoArea === "rateio" ? e.talhoes : e.talhoes.filter((t) => t.area > 0);
  const casa = (lista, t) => lista.some((x) => normFaz(x.propCod) === normFaz(t.prop_cod) && normTlh(x.tlh) === normTlh(t.tlh));
  return gravados.filter((t) => !casa(daOS, t) && !casa(enviados, t)).map((t) => (t.tlh ? `${t.prop_cod}-${t.tlh}` : `${t.prop_cod} (sem talhão)`));
}

/** Talhão já resolvido para gravar (com a área do dia). */
/**
 * Inclui (sem id) ou altera o apontamento. Com O.S., a operação e os talhões têm de existir na O.S.; sem O.S., a fazenda
 * tem de estar no Cadastro de Fazenda e os talhões vêm do que foi informado. A área pode vir talhão a talhão ou como um
 * volume rateado entre os talhões marcados (o rateio é refeito aqui).
 * `opcoes` (Lançamento Mobile): `permitirForaDaOS` aceita, com O.S., fazendas e talhões que não estão nela (pelo Cadastro
 * de Fazenda e pela base Fazenda e Talhões da data; voltam em `foraDaOS`); `orig` ('mobile') marca a origem no novo;
 * `client` grava na transação de quem chamou (o lançamento com várias O.S. grava todas ou nenhuma: o BEGIN, o COMMIT,
 * o ROLLBACK e a conexão são dele); `log` entra a mais no registro do Log de Alterações.
 */
export async function salvarApontamento(e, usuario, id, opcoes = {}) {
  const pool = getPool();
  await prepararAtividades(pool);
  // tela aberta antes do campo Apontador / Informante (não manda o campo): na edição, fica o que estava gravado
  if (e.apontador === undefined) {
    const atual = id === undefined ? null : (await pool.query("SELECT apont FROM ap_dia WHERE id = $1", [id])).rows[0];
    e = { ...e, apontador: atual?.apont ?? "" };
  }
  // boletim do Lançamento Mobile com talhões fora da O.S. editado na tela Apontamento: a edição fica no Lançamento Mobile
  // (antes da validação: com todos os talhões fora da O.S. a tela não manda nenhum); os outros apontamentos não mudam
  if (id !== undefined && !e.semOS && !opcoes.permitirForaDaOS) {
    const perdidos = await foraDaOSDoMobile(pool, id, e);
    if (perdidos.length) {
      return { erro: `Este boletim tem talhões fora da O.S. lançados pelo Lançamento Mobile (${perdidos.join(", ")}); edite no Lançamento Mobile.` };
    }
  }
  const regras = await regrasApontamento();
  const erro = validarApontamento(e, regras);
  if (erro) return { erro };

  let osNum = "";
  let op;
  let candidatos;
  let foraDaOS = [];
  if (!e.semOS) {
    const os = await consultarOS(e.os, id, e.dt);
    if (!os) return { erro: `A O.S. ${e.os} não está na base de O.S. Importe o Relatório de Ordens de Serviço atualizado em Ordem de Serviço Agr. › Ordens de Serviço.` };
    const o = os.operacoes.find((x) => x.cod === e.opCod);
    if (!o) return { erro: "A operação escolhida não faz parte desta O.S." };
    osNum = os.os;
    op = { cod: o.cod, ds: o.ds, etapaCod: o.etapaCod, etapaDs: o.etapaDs };
    if (opcoes.permitirForaDaOS) {
      const r = await candidatosComForaDaOS(o, e);
      if (r.erro) return { erro: r.erro };
      candidatos = r.candidatos;
      foraDaOS = r.foraDaOS;
    } else {
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
        // talhões e áreas da base Fazenda e Talhões da safra do apontamento
        fazendas.set(codDigitado, { cod: faz.item.cod.split("-")[0], nm: faz.item.nm, talhoes: await talhoesDaFazenda(faz.item.cod, e.dt) });
      }
      const f = fazendas.get(codDigitado);
      // talhão como está na base ("01" = "1")
      const daBase = f.talhoes.find((x) => normTlh(x.tlh) === normTlh(t.tlh));
      const tlh = daBase?.tlh ?? t.tlh.trim();
      if (vistos.has(`${f.cod}|${normTlh(tlh)}`)) {
        return {
          erro: tlh
            ? `O talhão ${tlh} da fazenda ${f.cod} foi informado duas vezes.`
            : `A fazenda ${f.cod} sem talhão foi informada duas vezes; some as áreas numa linha só.`,
        };
      }
      vistos.add(`${f.cod}|${normTlh(tlh)}`);
      candidatos.push({ propCod: f.cod, propNm: f.nm, tlh, areaTlh: daBase?.area ?? null, area: t.area });
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
  // área acima da do talhão é aceita (a base de cadastro é atualizada e importada depois); só volta como aviso
  const acimaDoTalhao = talhoes
    .filter((t) => t.areaTlh !== null && t.area > t.areaTlh + 0.001)
    .map((t) => `${t.propCod}-${t.tlh} (${t.area.toLocaleString("pt-BR")} ha, talhão ${t.areaTlh.toLocaleString("pt-BR")} ha)`);
  const etapa =
    !e.semOS && (op.etapaCod === e.etapaCod || !e.etapaCod)
      ? { cod: op.etapaCod, ds: op.etapaDs }
      : { cod: e.etapaCod.trim(), ds: e.etapaCod.trim() ? await descricaoEtapa(pool, e.etapaCod.trim()) : "" };
  const repetido = (await pool.query("SELECT id FROM ap_dia WHERE bol = $1 AND ($2::int IS NULL OR id <> $2::int) LIMIT 1", [e.boletim, id ?? null])).rows[0];
  // `codigo`: o Lançamento Mobile tenta o próximo nº quando o boletim foi tomado por outro lançamento ao mesmo tempo
  if (repetido) return { erro: `O boletim nº ${e.boletim} já foi lançado (apontamento #${repetido.id}). Confira o número.`, codigo: "boletim-repetido" };

  // transação de quem chamou (`opcoes.client`): ela é que confirma ou desfaz, e devolve a conexão
  const externo = opcoes.client ?? null;
  const client = externo ?? (await pool.connect());
  try {
    if (!externo) await client.query("BEGIN");
    let novoId = id;
    let antes = null;
    // vazão utilizada em branco: calculada pelo volume de calda ÷ área do dia
    const areaDia = round2(talhoes.reduce((a, t) => a + t.area, 0));
    const vazaoAuto = e.vazaoUti === null && !!e.volCalda && areaDia > 0;
    // com O.S. a etapa pode ter vindo da operação: confere de novo os obrigatórios com o que vai ser gravado
    const falta = camposFaltando({ ...e, etapaCod: etapa.cod }, regras, vazaoAuto);
    if (falta.length) {
      if (!externo) await client.query("ROLLBACK");
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
      // a observação do bot (cabeçalho da mensagem e avisos) vai até 1500 caracteres: editar não corta
      e.obs.trim().slice(0, 1500),
      e.modoArea,
      e.modoArea === "rateio" ? round2(e.volume) : null,
      // um ou vários equipamentos (o Lançamento Mobile manda "10001, 10002")
      e.eqp.trim().slice(0, 300),
      e.vazaoRec,
      vazaoUti,
      vazaoAuto,
      e.volCalda,
      (e.apontador ?? "").trim().slice(0, 80),
    ];
    // campos do Lançamento Mobile (equipe, atividade, status da O.S., unidade da calda, matrícula, modelo do texto): null
    // quando não vieram — o novo grava em branco e a edição mantém o que estava
    const mobile = [
      campoMobile(e.equipe, 120),
      campoMobile(e.atividade, 120),
      campoMobile(e.statusOS, 40),
      e.unCalda === undefined || e.unCalda === null ? null : ["L", "kg"].includes(e.unCalda) ? e.unCalda : "",
      campoMobile(e.apontadorMat, 30),
      e.modelo === undefined || e.modelo === null ? null : ["mecanizada", "manual"].includes(e.modelo) ? e.modelo : "",
    ];
    if (id === undefined) {
      // $22 a $27: campos do Lançamento Mobile; $28: origem ('mobile' ou '' = lançado na tela)
      novoId = (
        await client.query(
          `INSERT INTO ap_dia (bol, dt, os, op_cod, op_ds, solic, etapa_cod, etapa_ds, tipo_apl, n_eqp, n_pes, obs, area_modo, area_vol,
                               eqp, vazao_rec, vazao_uti, vazao_auto, vol_calda, apont, usr,
                               equipe, ativ, sts_os, un_calda, apont_mat, tp_op, orig)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,
                   COALESCE($22::text, ''), COALESCE($23::text, ''), COALESCE($24::text, ''), COALESCE($25::text, ''),
                   COALESCE($26::text, ''), COALESCE($27::text, ''), $28) RETURNING id`,
          [...valores, usuario, ...mobile, opcoes.orig === "mobile" ? "mobile" : ""],
        )
      ).rows[0].id;
    } else {
      antes = await obterApontamento(id, client);
      if (!antes) {
        if (!externo) await client.query("ROLLBACK");
        return { erro: "Apontamento não encontrado." };
      }
      // $23 a $28: campos do Lançamento Mobile (null mantém o gravado); a origem não muda na edição
      await client.query(
        `UPDATE ap_dia SET bol=$1, dt=$2, os=$3, op_cod=$4, op_ds=$5, solic=$6, etapa_cod=$7, etapa_ds=$8, tipo_apl=$9, n_eqp=$10, n_pes=$11, obs=$12,
                area_modo=$13, area_vol=$14, eqp=$15, vazao_rec=$16, vazao_uti=$17, vazao_auto=$18, vol_calda=$19, apont=$20,
                atu_usr=$21, atu_em=now(),
                equipe=COALESCE($23::text, equipe), ativ=COALESCE($24::text, ativ), sts_os=COALESCE($25::text, sts_os),
                un_calda=COALESCE($26::text, un_calda), apont_mat=COALESCE($27::text, apont_mat), tp_op=COALESCE($28::text, tp_op)
          WHERE id=$22`,
        [...valores, usuario, id, ...mobile],
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
      depois: { ...resumoLog(depois), talhoesForaDaOS: foraDaOS.join(", ") || undefined, ...(opcoes.log ?? {}) },
    });
    if (!externo) await client.query("COMMIT");
    return { id: novoId, acimaDoTalhao, foraDaOS };
  } catch (err) {
    if (!externo) await client.query("ROLLBACK");
    throw err;
  } finally {
    if (!externo) client.release();
  }
}

/** Exclui o apontamento (com o registro no Log de Alterações). `exec`: a transação de quem chamou (Lançamento Mobile). */
export async function excluirApontamento(id, usuario, exec) {
  const pool = getPool();
  await prepararAtividades(pool);
  const db = exec ?? pool;
  const atual = await obterApontamento(id, db);
  if (!atual) return { erro: "Apontamento não encontrado." };
  // apontamento que veio de uma mensagem (bot do WhatsApp): a mensagem fica anotada como excluída e o bot não o recria
  await db.query(
    `WITH d AS (DELETE FROM ap_dia WHERE id = $1 RETURNING orig_chave)
     INSERT INTO ap_dia_exc (orig_chave, usr) SELECT orig_chave, $2 FROM d WHERE orig_chave IS NOT NULL
     ON CONFLICT (orig_chave) DO UPDATE SET usr = EXCLUDED.usr, em = now()`,
    [id, usuario],
  );
  await auditar(db, { usuario, modulo: "Atividades", entidade: "Apontamento diário", chave: chaveLog(atual), acao: "exclusao", antes: resumoLog(atual) });
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

/**
 * Condição SQL: o texto `col` não é nome só de item inativo do cadastro `cad` (o mesmo nome pode estar em mais de um
 * código; basta um ativo para valer). Tira das sugestões o valor já lançado que hoje é de item inativado.
 */
function naoSoDeInativo(cad, col) {
  const igual = `upper(btrim(c.nm)) = upper(btrim(${col}))`;
  return `(EXISTS (SELECT 1 FROM cad_itm c WHERE c.cad = '${cad}' AND c.atv AND ${igual})
           OR NOT EXISTS (SELECT 1 FROM cad_itm c WHERE c.cad = '${cad}' AND NOT c.atv AND ${igual}))`;
}

/**
 * Listas de escolha do lançamento (também usadas no Lançamento Mobile). Item inativo dos cadastros (Operações, Etapa,
 * Tipo Aplicação, Responsáveis) fica fora delas; as operações e etapas inativas vão à parte em `inativos`, só para a tela
 * reconhecer o código digitado ou o do apontamento aberto para edição.
 */
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
    "SELECT cod, nm AS ds, atv FROM cad_itm WHERE cad = 'etapa' ORDER BY CASE WHEN cod ~ '^[0-9]+$' THEN lpad(cod, 8, '0') ELSE cod END",
  );
  const tipos = await pool.query(
    `SELECT DISTINCT t FROM (SELECT NULLIF(nm, '') AS t FROM cad_itm WHERE cad = 'tipo-aplicacao' AND atv UNION SELECT NULLIF(tipo_apl, '') FROM ap_dia) x
      WHERE t IS NOT NULL AND ${naoSoDeInativo("tipo-aplicacao", "x.t")} ORDER BY 1`,
  );
  const solic = await pool.query(
    `SELECT DISTINCT s FROM (SELECT NULLIF(nm, '') AS s FROM cad_itm WHERE cad = 'responsaveis-os' AND atv UNION SELECT NULLIF(solic, '') FROM ap_dia) x
      WHERE s IS NOT NULL AND ${naoSoDeInativo("responsaveis-os", "x.s")} ORDER BY 1`,
  );
  const apont = await pool.query("SELECT DISTINCT apont AS a FROM ap_dia WHERE apont <> '' ORDER BY 1 LIMIT 300");
  // as operações vêm do cadastro Operações; as das O.S./apontamentos que ainda não estão nele continuam disponíveis
  // (a inativa no cadastro não volta pela origem)
  const cadOps = await operacoesDoCadastro(pool);
  const daOrigem = new Map(ops.rows.map((r) => [codigoOperacao(r.cod), r]));
  const doCadastro = (o) => ({ cod: o.cod, ds: o.nm, etapaCod: daOrigem.get(codigoOperacao(o.cod))?.etapa ?? "" });
  const operacoes = [
    ...[...cadOps.values()].filter((o) => o.ativo).map(doCadastro),
    ...ops.rows.filter((r) => !cadOps.has(codigoOperacao(r.cod))).map((r) => ({ cod: r.cod, ds: r.ds, etapaCod: r.etapa })),
  ].sort((a, b) => a.cod.localeCompare(b.cod, undefined, { numeric: true }) || a.ds.localeCompare(b.ds));
  return {
    operacoes,
    etapas: etapas.rows.filter((r) => r.atv).map((r) => ({ cod: r.cod, ds: r.ds })),
    tipos: tipos.rows.map((r) => r.t),
    solicitantes: solic.rows.map((r) => r.s),
    apontadores: apont.rows.map((r) => r.a),
    regras: await regrasApontamento(),
    inativos: {
      operacoes: [...cadOps.values()].filter((o) => !o.ativo).map(doCadastro),
      etapas: etapas.rows.filter((r) => !r.atv).map((r) => ({ cod: r.cod, ds: r.ds })),
    },
  };
}

// ---------------------------------------------------------------------------
// Verificar O.S.: apontamentos do período (de qualquer origem) x O.S. em aberto com as fazendas e os talhões lançados
// ---------------------------------------------------------------------------

/** Período máximo da Verificar O.S., em dias (a varredura lê todos os apontamentos do período). */
export const DIAS_VERIFICAR_OS = 92;

/** código sem zeros à esquerda ("06052" = "6052"), como a base de O.S. guarda */
const semZeros = (c) =>
  String(c ?? "")
    .trim()
    .replace(/^0+(?=\d)/, "");
const nomeDoTalhao = (t) => (String(t.tlh ?? "").trim() ? `${t.propCod}-${t.tlh}` : `${t.propCod} (sem talhão)`);
const haBR = (n) => `${(n ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ha`;

/** Origem do apontamento: a tela Apontamento, o Lançamento Mobile, o bot do WhatsApp ou a carga inicial da conversa. */
const origemDoApontamento = (a) => (a.orig === "mobile" ? "mobile" : a.orig === "whatsapp" ? (a.usr === BOT_WHATSAPP ? "bot" : "carga") : "tela");

/**
 * Por que o apontamento entra na Verificar O.S. (null = está na O.S., com a operação e os talhões dela, nos códigos da
 * base). `daOS`: O.S. da base → operação → talhões. A comparação de fazenda e talhão é a da conferência ("09442-1|05"
 * = "9442|5"); casado só assim, o talhão está na O.S. com outro código (a área não conta no Já apontado dela).
 */
function motivoDaVerificacao(a, daOS) {
  if (!a.os.trim()) return { cod: "sem-os", texto: "Lançado sem O.S." };
  const cod = semZeros(a.os);
  const ops = daOS.get(cod);
  if (!ops) return { cod: "os-fora-base", texto: `A O.S. ${a.os} não está na base de O.S. (Ordem de Serviço Agr.).` };
  const opAp = a.opCod.trim();
  const op = !opAp ? undefined : ops.has(a.opCod) ? a.opCod : [...ops.keys()].find((c) => semZeros(c) === semZeros(opAp));
  if (op === undefined) {
    const lista = [...ops.keys()].sort((x, y) => x.localeCompare(y, undefined, { numeric: true })).join(", ");
    return {
      cod: "operacao-fora",
      texto: opAp ? `A operação ${opAp} não está na O.S. ${cod} (operações dela: ${lista}).` : `Apontamento sem operação (operações da O.S. ${cod}: ${lista}).`,
    };
  }
  const talhoes = ops.get(op);
  const chaves = new Set(talhoes.map((t) => chaveTalhao(t.propCod, t.tlh)));
  const fora = [];
  let outroCodigo = a.os !== cod || a.opCod !== op;
  for (const t of a.talhoes) {
    if (chaves.has(chaveTalhao(t.propCod, t.tlh))) continue;
    const nt = normTlh(t.tlh);
    if (nt && talhoes.some((x) => normFaz(x.propCod) === normFaz(t.propCod) && normTlh(x.tlh) === nt)) outroCodigo = true;
    else fora.push(t);
  }
  if (fora.length) {
    return {
      cod: "talhoes-fora",
      texto: `Fora da O.S. ${cod} (operação ${op}): ${fora.map((t) => `${nomeDoTalhao(t)} (${haBR(t.area)})`).join(", ")}.`,
      fora: fora.map((t) => chaveTalhao(t.propCod, t.tlh)),
    };
  }
  if (outroCodigo) {
    return {
      cod: "codigo",
      texto: `O.S., operação ou talhão gravado com outro código que o da O.S. ${cod} (operação ${op}): a área não conta no Já apontado dela. Ligar passa para os códigos da O.S.`,
    };
  }
  return null;
}

/**
 * Verificar O.S. (tela Apontamento): todos os apontamentos do período — da tela, do Lançamento Mobile, do bot do
 * WhatsApp e da carga inicial — sem O.S., com a O.S. fora da base, com a operação fora da O.S. (ou sem operação), com
 * fazenda ou talhão fora da operação da O.S. (ex.: incluídos fora da O.S. no Lançamento Mobile) ou gravados com outro
 * código que o da O.S. Para cada um, até 5 O.S. em aberto na data com as fazendas e os talhões lançados, pela regra da
 * conferência do bot (comparação normalizada; a operação lançada primeiro, as de outra operação marcadas), com as áreas
 * já nos talhões de cada O.S. Consultas agregadas (o período inteiro de uma vez), nunca uma por linha de O.S.
 */
export async function verificarOSDoPeriodo(de, ate) {
  const pool = getPool();
  await prepararAtividades(pool);
  await prepararOSAgr(pool);
  // os apontamentos do período como a lista os lê (a tela abre a edição com eles)
  const todos = await lerApontamentos(pool, "a.dt BETWEEN $1::date AND $2::date", [de, ate]);
  // operações e talhões das O.S. gravadas: a base de Ordem de Serviço Agr. e, da O.S. que não está nela, a antiga
  const daOS = new Map();
  const oss = [...new Set(todos.filter((a) => a.os.trim()).map((a) => semZeros(a.os)))];
  if (oss.length) {
    const { rows } = await pool.query(
      `SELECT DISTINCT os, op_cod, prop_cod, tlh || letra AS tlh FROM os_agr WHERE os = ANY($1::text[])
       UNION
       SELECT DISTINCT os, op_cod, prop_cod, tlh FROM os_tlh o WHERE os = ANY($1::text[]) AND NOT EXISTS (SELECT 1 FROM os_agr x WHERE x.os = o.os)`,
      [oss],
    );
    for (const r of rows) {
      if (!daOS.has(r.os)) daOS.set(r.os, new Map());
      const ops = daOS.get(r.os);
      if (!ops.has(r.op_cod)) ops.set(r.op_cod, []);
      ops.get(r.op_cod).push({ propCod: r.prop_cod, tlh: r.tlh });
    }
  }
  const achados = [];
  for (const a of todos) {
    const motivo = motivoDaVerificacao(a, daOS);
    if (motivo) achados.push({ a, motivo });
  }
  if (achados.length === 0) return { analisados: todos.length, itens: [] };
  // responsável da O.S. gravada (que está na base): "Usar esta O.S." troca o Solicitante que veio dela pelo da nova
  const respOS = new Map();
  for (const cod of new Set(achados.filter((x) => daOS.has(semZeros(x.a.os))).map((x) => semZeros(x.a.os)))) {
    respOS.set(cod, await responsavelPorOS(pool, cod, true));
  }
  // as O.S. candidatas, pela regra da conferência do bot (import na hora: db-conferencia-bot importa este arquivo)
  const { candidatasDoPeriodo } = await import("./db-conferencia-bot");
  const candidatas = await candidatasDoPeriodo(
    pool,
    achados.map((x) => x.a),
    5,
  );
  return {
    analisados: todos.length,
    itens: achados.map(({ a, motivo }) => ({
      id: a.id,
      boletim: a.boletim,
      dt: a.dt,
      os: a.os,
      opCod: a.opCod,
      opDs: a.opDs,
      area: a.areaTotal,
      origem: origemDoApontamento(a),
      aConferir: a.aConferir,
      motivo: motivo.cod,
      motivoTexto: motivo.texto,
      // chaves dos talhões fora da operação da O.S. gravada
      fora: motivo.fora ?? [],
      respOS: respOS.get(semZeros(a.os)) ?? "",
      candidatas: candidatas.get(a.id) ?? [],
      // o apontamento inteiro: "Usar esta O.S." abre a edição com ele
      apontamento: a,
    })),
  };
}

/** Usuário dos apontamentos lançados pelo bot do WhatsApp (lib/db-import-whatsapp.js). */
export const BOT_WHATSAPP = "Bot WhatsApp";

/** Apontamentos do bot ainda a conferir no período (a conferência e o "Conferido" ficam em lib/db-conferencia-bot.js). */
export async function apontamentosAConferir(de, ate) {
  const pool = getPool();
  await prepararAtividades(pool);
  return lerApontamentos(pool, "a.usr = $1 AND a.conf_em IS NULL AND a.dt BETWEEN $2::date AND $3::date", [BOT_WHATSAPP, de, ate]);
}

/**
 * Liga o apontamento à O.S. escolhida na Verificar O.S. (ou digitada): sem O.S., com O.S. fora da base, com operação ou
 * talhões fora da O.S. A operação (`opCod`, a da O.S. escolhida; sem ela, a do apontamento) tem de estar na O.S. Os
 * talhões são reencaixados nas chaves da O.S. pela regra da conferência ("9442|05" vai para o "09442-1|5" dela; área
 * de fazenda sem talhão rateada nos talhões da O.S. não citados); os que não casam ficam como estão (`foraDaOS`). O
 * Solicitante em branco, ou o responsável da O.S. anterior, passa a ser o responsável da nova; o Apontador fica.
 * Ligar não confere o apontamento do bot. `versao`: a do apontamento verificado na tela (mudou depois: `mudou`).
 */
export async function vincularOS(id, os, usuario, { opCod, versao } = {}) {
  const pool = getPool();
  await prepararAtividades(pool);
  const { encaixar } = await import("./db-conferencia-bot");
  const nao = { erro: "Apontamento não encontrado.", status: 404 };
  const mudou = { erro: "O apontamento mudou desde a verificação (foi editado ou regravado pelo bot). Verifique de novo.", mudou: true, status: 409 };
  // as consultas (O.S., responsável da O.S. anterior) vêm antes da transação: a trava do apontamento fica só na gravação
  const lido = await obterApontamento(id);
  if (!lido) return nao;
  if (versao && versao !== lido.versao) return mudou;
  const info = await consultarOS(os, id, lido.dt);
  if (!info) return { erro: `A O.S. ${os} não está na base de O.S.` };
  const pedida = String(opCod ?? "").trim() || lido.opCod.trim();
  const lista = info.operacoes.map((o) => `${o.cod} · ${o.ds || "sem descrição"}`).join("; ");
  if (!pedida) return { erro: `O apontamento está sem operação: use "Usar esta O.S." e escolha a operação da O.S. ${info.os} (${lista}).` };
  const op = info.operacoes.find((o) => o.cod === pedida) ?? info.operacoes.find((o) => semZeros(o.cod) === semZeros(pedida));
  if (!op) return { erro: `A operação ${pedida} não faz parte da O.S. ${info.os} (operações dela: ${lista}).` };
  const respAntes = lido.os && semZeros(lido.os) !== info.os ? (await responsavelPorOS(pool, semZeros(lido.os), true)).trim() : "";
  const client = await pool.connect();
  const desfazer = async (r) => {
    await client.query("ROLLBACK");
    return r;
  };
  try {
    await client.query("BEGIN");
    // trava o apontamento até gravar: o bot (mensagem editada no grupo) não o regrava no meio da troca
    if (!(await client.query("SELECT 1 FROM ap_dia WHERE id = $1 FOR UPDATE", [id])).rowCount) return desfazer(nao);
    const antes = await obterApontamento(id, client);
    // regravado entre a consulta e a trava: a O.S. e a operação foram conferidas com o apontamento de antes
    if (antes.versao !== lido.versao) return desfazer(mudou);
    // talhões sem área não são gravados (como no formulário)
    const apontados = antes.talhoes.filter((t) => t.area > 0);
    const enc = encaixar(apontados, op.talhoes);
    if (enc.cobertos === 0) {
      return desfazer({
        erro: `Nenhum talhão do apontamento está na O.S. ${info.os}, operação ${op.cod}: confira a O.S. ou use "Usar esta O.S." para lançar as áreas nos talhões dela.`,
      });
    }
    const novos = Object.entries(enc.areas).map(([k, area]) => {
      const x = op.talhoes.find((t) => chaveTalhao(t.propCod, t.tlh) === k);
      return { propCod: x.propCod, propNm: x.propNm, tlh: x.tlh, areaTlh: x.areaTlh ?? null, area };
    });
    // fora da O.S.: ficam como estavam (a área não se perde; a verificação continua mostrando)
    for (const t of enc.fora) novos.push({ propCod: t.propCod, propNm: t.propNm ?? "", tlh: t.tlh, areaTlh: t.areaTlh ?? null, area: t.area });
    const assinatura = (ts) =>
      ts
        .map((t) => `${chaveTalhao(t.propCod, t.tlh)}=${round2(t.area)}`)
        .sort()
        .join(";");
    if (antes.os === info.os && antes.opCod === op.cod && assinatura(apontados) === assinatura(novos)) {
      return desfazer({ erro: `O apontamento já está na O.S. ${info.os}, operação ${op.cod}, com os códigos dela.` });
    }
    // Solicitante em branco, ou o responsável da O.S. anterior (que veio dela), passa a ser o responsável desta
    let solic = antes.solicitante;
    if (!solic.trim()) solic = info.resp || solic;
    else if (respAntes && info.resp && solic.trim() === respAntes) solic = info.resp;
    // etapa em branco vem da operação da O.S. (a do bot só tem a descrição); a informada fica, e a operação sem etapa não apaga
    const etapa = antes.etapaCod || !op.etapaCod ? { cod: antes.etapaCod, ds: antes.etapaDs } : { cod: op.etapaCod, ds: op.etapaDs };
    await client.query(
      `UPDATE ap_dia SET os = $1, op_cod = $2, op_ds = $3, etapa_cod = $4, etapa_ds = $5, solic = $6, atu_usr = $7, atu_em = now()
        WHERE id = $8`,
      [info.os, op.cod, op.ds, etapa.cod, etapa.ds, solic, usuario, id],
    );
    await client.query("DELETE FROM ap_dia_tlh WHERE ap_id = $1", [id]);
    for (const t of novos) {
      // a mesma chave duas vezes (não deveria): as áreas somam
      await client.query(
        `INSERT INTO ap_dia_tlh (ap_id, prop_cod, prop_nm, tlh, area_tlh, area) VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (ap_id, prop_cod, tlh) DO UPDATE SET area = ap_dia_tlh.area + EXCLUDED.area`,
        [id, t.propCod, t.propNm, t.tlh, t.areaTlh, round2(t.area)],
      );
    }
    const foraDaOS = enc.fora.map((t) => nomeDoTalhao(t));
    // talhões que passaram para o código da O.S. (ou área sem talhão rateada nos talhões dela)
    const chavesNovas = new Set(novos.map((t) => chaveTalhao(t.propCod, t.tlh)));
    const acertados = apontados.filter((t) => !chavesNovas.has(chaveTalhao(t.propCod, t.tlh))).length;
    const depois = await obterApontamento(id, client);
    await auditar(client, {
      usuario,
      modulo: "Atividades",
      entidade: "Apontamento diário",
      chave: chaveLog(depois),
      acao: "alteracao",
      antes: resumoLog(antes),
      depois: {
        ...resumoLog(depois),
        verificacao: "O.S. ligada na Verificar O.S. (talhões nos códigos da O.S.)",
        talhoesForaDaOS: foraDaOS.join(", ") || undefined,
      },
    });
    await client.query("COMMIT");
    return { ok: true, os: info.os, opCod: op.cod, opDs: op.ds, foraDaOS, acertados };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
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
