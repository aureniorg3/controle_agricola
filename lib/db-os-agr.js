import { createHash } from "crypto";

import { nomeOperacao, operacoesDoCadastro } from "./db-operacoes";
import { auditar, dataBR } from "./auditar";
import { specPorSlug } from "./cadastros-spec";
import { codigoOperacao } from "./dashboard-atividades";
import { getPool, prepararBanco, sincronizarDescricaoFazendas } from "./db";
import { normFaz, normTlh } from "./ocupacao";
import { agruparPorOS, chaveLinhaOS, ehServico, FAIXAS_PADRAO, montarPainelOS, nomePosicao, PRAZO_DIAS, prazoDaOS, round2 } from "./os-agr";
import semente from "./os-agr-seed.json";

let preparado = null;

/**
 * Tabelas da base de O.S. e cargas iniciais:
 *   os_agr       uma linha por O.S. × talhão × operação
 *   os_agr_os    uma por O.S.: assinatura do conteúdo, origem, produtor, observação, vazão, volume de calda e o
 *                encerramento (data e como foi identificado)
 *   os_agr_ins   a requisição de produtos de cada O.S. (insumos com a dose por ha e a quantidade requisitada)
 *   os_agr_hist  o conteúdo anterior de cada O.S. substituída ou tirada da base (nada da base se perde)
 */
export async function prepararOSAgr(pool = getPool()) {
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
         )`,
      );
      await pool.query("CREATE INDEX IF NOT EXISTS idx_os_agr_os ON os_agr (os)");
      await pool.query("CREATE INDEX IF NOT EXISTS idx_os_agr_dt ON os_agr (dt_os)");
      // variedade do talhão (relatório em PDF) e a previsão que vinha do ERP na planilha, guardada quando o prazo passou
      // a ser a data da O.S. + 7 dias
      await pool.query("ALTER TABLE os_agr ADD COLUMN IF NOT EXISTS varied text NOT NULL DEFAULT ''");
      await pool.query("ALTER TABLE os_agr ADD COLUMN IF NOT EXISTS prev_ini_erp date");
      await pool.query("ALTER TABLE os_agr ADD COLUMN IF NOT EXISTS prev_fim_erp date");
      await pool.query(
        `CREATE TABLE IF NOT EXISTS os_agr_os (
           emp text NOT NULL, os text NOT NULL, hsh text NOT NULL, linhas integer NOT NULL DEFAULT 0,
           cri_em timestamptz NOT NULL DEFAULT now(), atu_em timestamptz NOT NULL DEFAULT now(), atu_usr text NOT NULL DEFAULT '',
           PRIMARY KEY (emp, os)
         )`,
      );
      // origem ('planilha' = o antigo Relatório de O.S. em planilha; 'pdf' = o relatório OS - Ordem de Serviço), produtor,
      // observação inteira, vazão e volume de calda (da observação), data do relatório lido e o encerramento: a data e
      // como foi identificado ('erp' = veio da planilha; 'leitura' = a importação viu a situação mudar para Encerrada)
      for (const [c, tipo] of [
        ["orig", "text NOT NULL DEFAULT 'planilha'"],
        ["prdr_cod", "text NOT NULL DEFAULT ''"],
        ["prdr_nm", "text NOT NULL DEFAULT ''"],
        ["obs", "text NOT NULL DEFAULT ''"],
        ["vazao", "numeric"],
        ["vol_calda", "numeric"],
        ["rel_em", "date"],
        ["dt_enc", "date"],
        ["enc_orig", "text NOT NULL DEFAULT ''"],
      ]) {
        await pool.query(`ALTER TABLE os_agr_os ADD COLUMN IF NOT EXISTS ${c} ${tipo}`);
      }
      await pool.query(
        `CREATE TABLE IF NOT EXISTS os_agr_ins (
           emp text NOT NULL, os text NOT NULL, op_cod text NOT NULL, prod_cod text NOT NULL, almx text NOT NULL DEFAULT '',
           prod_ds text NOT NULL DEFAULT '', almx_nm text NOT NULL DEFAULT '', un text NOT NULL DEFAULT '', dose numeric, qtd numeric,
           seq integer NOT NULL DEFAULT 0,
           PRIMARY KEY (emp, os, op_cod, prod_cod, almx)
         )`,
      );
      await pool.query("CREATE INDEX IF NOT EXISTS idx_os_agr_ins_os ON os_agr_ins (os)");
      await pool.query(
        `CREATE TABLE IF NOT EXISTS os_agr_hist (
           id serial PRIMARY KEY, emp text NOT NULL, os text NOT NULL, acao text NOT NULL, em timestamptz NOT NULL DEFAULT now(),
           usr text NOT NULL DEFAULT '', cab jsonb, linhas jsonb, insumos jsonb
         )`,
      );
      await pool.query("CREATE INDEX IF NOT EXISTS idx_os_agr_hist_os ON os_agr_hist (os)");
      await carregarCadastrosIniciais(pool);
      await migrarPrazoEEncerramento(pool);
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
async function carregarCadastrosIniciais(pool) {
  const cargas = semente;
  for (const [cad, itens] of Object.entries(cargas)) {
    const entidade = `Cadastro de ${specPorSlug(cad)?.titulo ?? cad}`;
    try {
      const marcada = async (exec) =>
        ((await exec.query("SELECT 1 FROM aud_log WHERE modulo = 'Cadastros' AND entidade = $1 AND chave = $2 LIMIT 1", [entidade, MARCA_CARGA])).rowCount ??
          0) > 0;
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
          [cad, JSON.stringify(itens)],
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

const MARCA_PRAZO = "Prazo da O.S. = data da O.S. + 7 dias; encerramento guardado na O.S. (v1)";

/**
 * Uma vez só, quando o relatório em PDF passou a ser o importador (ele não traz previsão nem encerramento):
 *   - a previsão inicial e final que veio do ERP (planilha) fica guardada em prev_ini_erp / prev_fim_erp e o prazo passa
 *     a ser a regra: início = data da O.S., fim = data da O.S. + 7 dias;
 *   - a data de encerramento que já está na base (da planilha) fica gravada na O.S. (os_agr_os), de onde a importação
 *     do PDF a mantém.
 */
async function migrarPrazoEEncerramento(pool) {
  const feita = async (exec) =>
    ((await exec.query("SELECT 1 FROM aud_log WHERE modulo = 'Ordem de Serviço Agr.' AND chave = $1 LIMIT 1", [MARCA_PRAZO])).rowCount ?? 0) > 0;
  if (await feita(pool)) return;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('os_agr_prazo_v1'))");
    if (await feita(client)) {
      await client.query("ROLLBACK");
      return;
    }
    const guardadas = await client.query(
      `UPDATE os_agr SET prev_ini_erp = prev_ini, prev_fim_erp = prev_fim
        WHERE prev_ini_erp IS NULL AND prev_fim_erp IS NULL AND (prev_ini IS NOT NULL OR prev_fim IS NOT NULL)`,
    );
    const prazos = await client.query(`UPDATE os_agr SET prev_ini = dt_os, prev_fim = dt_os + ${PRAZO_DIAS} WHERE dt_os IS NOT NULL`);
    const enc = await client.query(
      `UPDATE os_agr_os o SET dt_enc = x.d, enc_orig = 'erp'
         FROM (SELECT emp, os, MAX(dt_enc) AS d FROM os_agr GROUP BY emp, os) x
        WHERE x.emp = o.emp AND x.os = o.os AND o.dt_enc IS NULL AND x.d IS NOT NULL`,
    );
    await auditar(client, {
      usuario: "Sistema",
      modulo: "Ordem de Serviço Agr.",
      entidade: "Base de O.S.",
      chave: MARCA_PRAZO,
      acao: "alteracao",
      depois: {
        previsaoDoErpGuardada: guardadas.rowCount ?? 0,
        linhasComPrazoDataMais7: prazos.rowCount ?? 0,
        encerramentoGravadoNaOS: enc.rowCount ?? 0,
      },
    });
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Importação do relatório "OS - Ordem de Serviço" em PDF (lido no navegador por lib/ler-os-pdf.js)
// ---------------------------------------------------------------------------

const doBanco = (r) => ({
  emp: r.emp,
  os: r.os,
  dtOs: r.dt_os,
  dtEnc: r.dt_enc,
  prevIni: r.prev_ini,
  prevFim: r.prev_fim,
  propCod: r.prop_cod,
  setor: r.setor,
  propNm: r.prop_nm,
  tlh: r.tlh,
  letra: r.letra,
  areaPlant: r.area_plant,
  areaRec: r.area_rec,
  opCod: r.op_cod,
  opDs: r.op_ds,
  etapaCod: r.etapa_cod,
  etapaDs: r.etapa_ds,
  ccCod: r.cc_cod,
  ccDs: r.cc_ds,
  safra: r.safra,
  ciclo: r.ciclo,
  posicao: r.posicao,
  mesExec: r.mes_exec,
  anoExec: r.ano_exec,
  respCod: r.resp_cod,
  respNm: r.resp_nm,
  raio: r.raio,
  usrOs: r.usr_os,
  obs: r.obs,
  varied: r.varied,
  prevIniErp: r.prev_ini_erp,
  prevFimErp: r.prev_fim_erp,
});
const COLS_BANCO = `emp, os, dt_os::text AS dt_os, dt_enc::text AS dt_enc, prev_ini::text AS prev_ini, prev_fim::text AS prev_fim, prop_cod, setor, prop_nm,
  tlh, letra, area_plant::float AS area_plant, area_rec::float AS area_rec, op_cod, op_ds, etapa_cod, etapa_ds, cc_cod, cc_ds, safra, ciclo, posicao,
  mes_exec, ano_exec, resp_cod, resp_nm, raio, usr_os, obs, varied, prev_ini_erp::text AS prev_ini_erp, prev_fim_erp::text AS prev_fim_erp`;

const fmtHa = (n) => n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Limites do que vem do navegador (o relatório inteiro tem ~2,5 mil O.S.). */
const MAX_ORDENS = 30000;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const txt = (v, max) =>
  String(v ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
const numOuNull = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const lista = (v, max) => (Array.isArray(v) ? v.slice(0, max) : []);

/** Confere e limpa uma O.S. lida do PDF; null quando falta o essencial (nº, empresa, data, talhões ou operação). */
function ordemValida(o) {
  if (!o || typeof o !== "object") return null;
  const emp = txt(o.emp, 6);
  const os = txt(o.os, 12).replace(/^0+(?=\d)/, "");
  if (!/^\d+$/.test(emp) || !/^\d+$/.test(os) || !ISO.test(o.dt ?? "")) return null;
  const posicao = ["A", "L", "E"].includes(o.posicao) ? o.posicao : txt(o.posicao, 1).toUpperCase();
  const talhoes = lista(o.talhoes, 3000)
    .map((t) => ({
      prop: txt(t?.prop, 20),
      fundo: txt(t?.fundo, 120),
      tlh: txt(t?.tlh, 20).toUpperCase(),
      vari: txt(t?.vari, 40),
      area: numOuNull(t?.area),
      rateio: numOuNull(t?.rateio),
    }))
    .filter((t) => t.prop && t.tlh);
  const ops = lista(o.ops, 60)
    .map((x) => ({ cod: txt(x?.cod, 20), ds: txt(x?.ds, 200), qtd: numOuNull(x?.qtd) }))
    .filter((x) => /^\d+$/.test(x.cod));
  const req = lista(o.req, 500)
    .map((r) => ({
      op: txt(r?.op, 20),
      prod: txt(r?.prod, 30),
      ds: txt(r?.ds, 200),
      almoxCod: txt(r?.almoxCod, 10),
      almoxNm: txt(r?.almoxNm, 120),
      un: txt(r?.un, 10),
      dose: numOuNull(r?.dose),
      qtd: numOuNull(r?.qtd),
    }))
    .filter((r) => r.op && r.prod);
  if (!talhoes.length || !ops.length || !posicao) return null;
  return {
    emp,
    os,
    dt: o.dt,
    etapaCod: txt(o.etapaCod, 10),
    etapaDs: txt(o.etapaDs, 120),
    safra: txt(o.safra, 10),
    ciclo: txt(o.ciclo, 10),
    respCod: txt(o.respCod, 20),
    respNm: txt(o.respNm, 120),
    usr: txt(o.usr, 80),
    posicao,
    prdrCod: txt(o.prdrCod, 20),
    prdrNm: txt(o.prdrNm, 160),
    // a observação mantém as quebras de linha
    obs: String(o.obs ?? "")
      .replace(/\r/g, "")
      .split("\n")
      .map((l) => txt(l, 300))
      .filter(Boolean)
      .join("\n")
      .slice(0, 4000),
    vazao: numOuNull(o.vazao),
    volCalda: numOuNull(o.volCalda),
    talhoes,
    ops,
    req,
  };
}

/** Assinatura do conteúdo da O.S. no relatório: igual = nada a gravar. */
const assinatura = (o) =>
  `pdf:${createHash("md5")
    .update(
      JSON.stringify([
        o.emp,
        o.os,
        o.dt,
        o.etapaCod,
        o.etapaDs,
        o.safra,
        o.ciclo,
        o.respCod,
        o.respNm,
        o.usr,
        o.posicao,
        o.prdrCod,
        o.prdrNm,
        o.obs,
        o.talhoes.map((t) => [t.prop, t.fundo, t.tlh, t.vari, t.area, t.rateio]),
        o.ops.map((x) => [x.cod, x.ds, x.qtd]),
        o.req.map((r) => [r.op, r.prod, r.ds, r.almoxCod, r.almoxNm, r.un, r.dose, r.qtd]),
      ]),
    )
    .digest("hex")}`;

/**
 * Encerramento da O.S. (o relatório não traz a data): fica a data em que a importação identifica a mudança da situação
 * para Encerrada — a data de emissão do relatório lido (`dataRel`). Já encerrada antes, mantém a data que tinha (a da
 * planilha do ERP ou a de uma leitura anterior). Reaberta, fica sem. Nova na base e já encerrada: se foi emitida depois
 * da última importação, encerrou entre as duas (fica a data do relatório); se é mais antiga, a data não é conhecida.
 */
function encerramento(o, antes, dataRel, ultimaImportacao) {
  if (o.posicao !== "E") return { dt: null, orig: "" };
  if (antes) {
    if (antes.encerrada) return { dt: antes.dtEnc, orig: antes.dtEnc ? antes.encOrig || "erp" : "" };
    return { dt: dataRel, orig: "leitura" };
  }
  if (ultimaImportacao && o.dt >= ultimaImportacao) return { dt: dataRel, orig: "leitura" };
  return { dt: null, orig: "" };
}

/**
 * Linhas da O.S. para a base (O.S. × talhão × operação). O que o PDF não traz fica como estava na base (a O.S. antiga):
 * centro de custo, mês e ano de execução, raio, setor do talhão e a previsão do ERP. O prazo é a data da O.S. + 7 dias.
 */
function linhasDaOrdem(o, antigas, dtEnc) {
  const porOp = new Map();
  for (const a of antigas) if (!porOp.has(a.opCod)) porOp.set(a.opCod, a);
  const setorDe = new Map(antigas.map((a) => [`${a.propCod}|${a.tlh}${a.letra}`, a.setor]));
  const prazo = prazoDaOS(o.dt);
  const out = [];
  for (const op of o.ops) {
    const v = porOp.get(op.cod) ?? antigas[0] ?? null;
    for (const t of o.talhoes) {
      out.push({
        emp: o.emp,
        os: o.os,
        dtOs: o.dt,
        dtEnc,
        prevIni: o.dt,
        prevFim: prazo,
        propCod: t.prop,
        setor: setorDe.get(`${t.prop}|${t.tlh}`) ?? "0",
        propNm: t.fundo,
        tlh: t.tlh,
        letra: "",
        areaPlant: t.area,
        areaRec: t.rateio,
        opCod: op.cod,
        opDs: op.ds,
        etapaCod: o.etapaCod,
        etapaDs: o.etapaDs,
        ccCod: v?.ccCod ?? "",
        ccDs: v?.ccDs ?? "",
        safra: o.safra,
        ciclo: o.ciclo,
        posicao: o.posicao,
        mesExec: v?.mesExec ?? null,
        anoExec: v?.anoExec ?? null,
        respCod: o.respCod,
        respNm: o.respNm,
        raio: v?.raio ?? "0",
        usrOs: o.usr,
        obs: o.obs.replace(/\n/g, " ").slice(0, 1000),
        varied: t.vari,
        prevIniErp: v?.prevIniErp ?? null,
        prevFimErp: v?.prevFimErp ?? null,
      });
    }
  }
  return out;
}

/** Descreve o que mudou numa O.S. (para a prévia) e marca as categorias. */
function compararOS(antigas, novas, insAntes, insNovos, conversao) {
  const cat = { posicao: false, encerrada: false, reaberta: false, talhoes: false, areas: false, insumos: false, conversao, outros: false };
  const partes = [];
  const pa = antigas[0]?.posicao ?? "";
  const pn = novas[0]?.posicao ?? "";
  if (pa !== pn) {
    cat.posicao = true;
    if (pn === "E") cat.encerrada = true;
    if (pa === "E") cat.reaberta = true;
    partes.push(`situação ${nomePosicao(pa)} → ${nomePosicao(pn)}`);
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
  const soma = (ls) => round2(ls.reduce((a, l) => a + (l.areaRec ?? 0), 0));
  let difArea = false;
  for (const [k, n] of mN) {
    const a = mA.get(k);
    if (a && (Math.abs((a.areaRec ?? 0) - (n.areaRec ?? 0)) > 0.004 || Math.abs((a.areaPlant ?? 0) - (n.areaPlant ?? 0)) > 0.004)) difArea = true;
  }
  if (difArea) {
    cat.areas = true;
    partes.push(`área da O.S. ${fmtHa(soma(antigas))} → ${fmtHa(soma(novas))} ha`);
  }
  const chaveIns = (i) => [i.op, i.prod, i.dose, i.qtd].join("|");
  const iA = new Set(insAntes.map(chaveIns));
  const iN = new Set(insNovos.map(chaveIns));
  if (iA.size !== iN.size || [...iN].some((k) => !iA.has(k))) {
    cat.insumos = true;
    partes.push(insAntes.length ? `insumos (${insAntes.length} → ${insNovos.length} linhas)` : `${insNovos.length} insumo(s) da requisição`);
  }
  if (conversao) partes.push("passa a vir do relatório em PDF (insumos, observação, variedade e prazo de 7 dias)");
  if (!cat.posicao && !cat.talhoes && !cat.areas && !cat.insumos && !conversao) {
    cat.outros = true;
    partes.push("outras informações (responsável, observação, produtor…)");
  }
  return { cat, texto: partes.join("; ") };
}

/** O.S. mostradas na prévia (as outras só contam). */
const MAX_LISTA_PREVIA = 60;

const hojeSql = "(now() AT TIME ZONE 'America/Sao_Paulo')::date";

/**
 * Importa o relatório "OS - Ordem de Serviço" (PDF), já lido no navegador: `rel` = { arquivo, geradoEm, paginas, avisos,
 * ordens }. Cada O.S. é comparada pela assinatura do conteúdo: as novas entram, as que mudaram são substituídas e as
 * iguais ficam como estão. Nada se perde:
 *   - o que o PDF não traz fica como estava na O.S. (centro de custo, mês/ano de execução, previsão do ERP, encerramento);
 *   - o conteúdo anterior de toda O.S. substituída ou tirada fica em os_agr_hist;
 *   - as O.S. da base com a data dentro do período do arquivo que não vieram nele só saem com `removerAusentes` (a
 *     pessoa confirma na prévia; os apontamentos ligados a elas ficam, destacados na tela Apontamento).
 * Com `aplicar = false` só devolve a prévia.
 */
export async function importarOSPdf(rel, usuario, aplicar, removerAusentes = false) {
  const pool = getPool();
  await prepararOSAgr(pool);
  // os apontamentos (ap_dia) e a antiga base de O.S. (os_tlh): import na hora (db-atividades importa este arquivo)
  const { prepararAtividades } = await import("./db-atividades");
  await prepararAtividades(pool);

  const brutas = lista(rel?.ordens, MAX_ORDENS);
  const ordens = [];
  const descartadas = [];
  const vistas = new Set();
  for (const b of brutas) {
    const o = ordemValida(b);
    if (!o) {
      descartadas.push(txt(b?.os, 12) || "?");
      continue;
    }
    const k = `${o.emp}|${o.os}`;
    if (vistas.has(k)) continue;
    vistas.add(k);
    ordens.push(o);
  }
  if (ordens.length === 0) return { erro: "Nenhuma O.S. lida no arquivo. Confira se é o relatório OS - Ordem de Serviço (PDF)." };
  const hoje = (await pool.query(`SELECT ${hojeSql}::text AS d`)).rows[0].d;
  const dataRel = ISO.test(rel?.geradoEm ?? "") && rel.geradoEm <= hoje ? rel.geradoEm : hoje;
  const porK = new Map(ordens.map((o) => [`${o.emp}|${o.os}`, o]));
  const chaves = [...porK.keys()];
  const hashes = new Map(ordens.map((o) => [`${o.emp}|${o.os}`, assinatura(o)]));
  const datas = ordens.map((o) => o.dt).sort();
  const periodoIni = datas[0];
  const periodoFim = datas[datas.length - 1];
  const empresas = [...new Set(ordens.map((o) => o.emp))];

  // a base antes desta importação
  const existentes = new Map(
    (
      await pool.query(
        `SELECT o.emp || '|' || o.os AS k, o.hsh, o.orig, o.dt_enc::text AS dt_enc, o.enc_orig,
                (SELECT bool_and(l.posicao = 'E') FROM os_agr l WHERE l.emp = o.emp AND l.os = o.os) AS encerrada,
                (SELECT MAX(l.dt_enc)::text FROM os_agr l WHERE l.emp = o.emp AND l.os = o.os) AS dt_enc_linhas
           FROM os_agr_os o WHERE (o.emp || '|' || o.os) = ANY($1::text[])`,
        [chaves],
      )
    ).rows.map((r) => [r.k, { hsh: r.hsh, orig: r.orig, encerrada: !!r.encerrada, dtEnc: r.dt_enc ?? r.dt_enc_linhas ?? null, encOrig: r.enc_orig }]),
  );
  const ultimaImportacao = (await pool.query("SELECT (MAX(atu_em) AT TIME ZONE 'America/Sao_Paulo')::date::text AS d FROM os_agr_os")).rows[0].d;
  const novas = chaves.filter((k) => !existentes.has(k));
  const alteradas = chaves.filter((k) => existentes.has(k) && existentes.get(k).hsh !== hashes.get(k));
  const iguais = chaves.length - novas.length - alteradas.length;
  const gravar = [...novas, ...alteradas];

  // O.S. da base no período do arquivo (mesma empresa) que não vieram nele
  const ausentes = (
    await pool.query(
      `SELECT o.emp, o.os, MIN(o.dt_os)::text AS dt, COUNT(DISTINCT o.op_cod)::int AS ops,
              string_agg(DISTINCT o.prop_cod, ', ') AS fazendas, MAX(o.posicao) AS posicao,
              (SELECT COUNT(*)::int FROM ap_dia a WHERE ltrim(a.os, '0') = o.os) AS boletins
         FROM os_agr o
        WHERE o.emp = ANY($1::text[]) AND o.dt_os BETWEEN $2::date AND $3::date AND NOT ((o.emp || '|' || o.os) = ANY($4::text[]))
        GROUP BY o.emp, o.os
        ORDER BY MIN(o.dt_os), o.os`,
      [empresas, periodoIni, periodoFim, chaves],
    )
  ).rows;
  const removidas = removerAusentes ? ausentes : [];
  const foraTotal = (await pool.query("SELECT COUNT(*)::int AS n FROM os_agr_os WHERE NOT ((emp || '|' || os) = ANY($1::text[]))", [chaves])).rows[0].n;

  // linhas antigas e insumos antigos das que serão gravadas (para manter o que o PDF não traz e para a prévia)
  const antigas = new Map();
  const insAntes = new Map();
  if (alteradas.length > 0) {
    for (const r of (await pool.query(`SELECT ${COLS_BANCO} FROM os_agr WHERE (emp || '|' || os) = ANY($1::text[])`, [alteradas])).rows) {
      const k = `${r.emp}|${r.os}`;
      if (!antigas.has(k)) antigas.set(k, []);
      antigas.get(k).push(doBanco(r));
    }
    for (const r of (
      await pool.query(
        "SELECT emp, os, op_cod, prod_cod, dose::float AS dose, qtd::float AS qtd FROM os_agr_ins WHERE (emp || '|' || os) = ANY($1::text[])",
        [alteradas],
      )
    ).rows) {
      const k = `${r.emp}|${r.os}`;
      if (!insAntes.has(k)) insAntes.set(k, []);
      insAntes.get(k).push({ op: r.op_cod, prod: r.prod_cod, dose: r.dose, qtd: r.qtd });
    }
  }

  const linhas = new Map();
  const encs = new Map();
  const enc = { identificadas: 0, mantidas: 0, semData: 0, reabertas: 0 };
  for (const k of gravar) {
    const o = porK.get(k);
    const antes = existentes.get(k) ?? null;
    const e = encerramento(o, antes, dataRel, ultimaImportacao);
    encs.set(k, e);
    if (o.posicao === "E") {
      if (e.orig === "leitura" && !(antes?.encerrada && antes.dtEnc)) enc.identificadas++;
      else if (e.dt) enc.mantidas++;
      else enc.semData++;
    } else if (antes?.encerrada) enc.reabertas++;
    linhas.set(k, linhasDaOrdem(o, antigas.get(k) ?? [], e.dt));
  }

  const mudancas = { posicao: 0, encerradas: 0, reabertas: 0, talhoes: 0, areas: 0, insumos: 0, conversao: 0, outros: 0 };
  const exemplos = [];
  for (const k of [...alteradas].sort((a, b) => Number(b.split("|")[1]) - Number(a.split("|")[1]))) {
    const o = porK.get(k);
    const { cat, texto } = compararOS(antigas.get(k) ?? [], linhas.get(k), insAntes.get(k) ?? [], o.req, existentes.get(k).orig !== "pdf");
    for (const [c, sim] of Object.entries({ ...cat, encerradas: cat.encerrada, reabertas: cat.reaberta })) if (sim && c in mudancas) mudancas[c]++;
    if (exemplos.length < 40) exemplos.push({ os: o.os, texto });
  }
  const totalReq = ordens.reduce((s, o) => s + o.req.length, 0);
  const previa = {
    arquivo: {
      nome: txt(rel?.arquivo, 200),
      paginas: Number.isInteger(rel?.paginas) ? rel.paginas : null,
      ordens: ordens.length,
      descartadas: descartadas.length,
      talhoes: ordens.reduce((s, o) => s + o.talhoes.length, 0),
      insumos: totalReq,
      produtos: new Set(ordens.flatMap((o) => o.req.map((r) => r.prod))).size,
      periodo: `${dataBR(periodoIni)} a ${dataBR(periodoFim)}`,
      geradoEm: dataRel,
      avisos: lista(rel?.avisos, 50).map((a) => txt(a, 300)),
    },
    novas: novas.length,
    alteradas: alteradas.length,
    iguais,
    encerramento: enc,
    // O.S. da base no período que não vieram no arquivo: saem só se a pessoa marcar
    ausentes: ausentes.length,
    boletinsAusentes: ausentes.reduce((a, r) => a + r.boletins, 0),
    listaAusentes: ausentes.slice(0, MAX_LISTA_PREVIA).map((r) => ({
      os: r.os,
      dt: r.dt,
      fazendas: r.fazendas ?? "",
      operacoes: r.ops,
      posicao: nomePosicao(r.posicao ?? ""),
      boletins: r.boletins,
    })),
    removidas: removidas.length,
    foraDoArquivo: Math.max(0, foraTotal - ausentes.length),
    mudancas,
    exemplos,
  };
  if (!aplicar) return previa;

  const chavesRemovidas = removidas.map((r) => `${r.emp}|${r.os}`);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('os_agr_importacao'))");
    // o conteúdo anterior fica no histórico
    const guardar = (ks, acao) =>
      client.query(
        `INSERT INTO os_agr_hist (emp, os, acao, usr, cab, linhas, insumos)
         SELECT k.emp, k.os, $2, $3,
                (SELECT to_jsonb(x) FROM os_agr_os x WHERE x.emp = k.emp AND x.os = k.os),
                (SELECT jsonb_agg(to_jsonb(l)) FROM os_agr l WHERE l.emp = k.emp AND l.os = k.os),
                (SELECT jsonb_agg(to_jsonb(i)) FROM os_agr_ins i WHERE i.emp = k.emp AND i.os = k.os)
           FROM (SELECT split_part(c, '|', 1) AS emp, split_part(c, '|', 2) AS os FROM unnest($1::text[]) AS c) k
          WHERE EXISTS (SELECT 1 FROM os_agr_os x WHERE x.emp = k.emp AND x.os = k.os)`,
        [ks, acao, usuario],
      );
    if (chavesRemovidas.length > 0) {
      await guardar(chavesRemovidas, "removida");
      await client.query("DELETE FROM os_agr WHERE (emp || '|' || os) = ANY($1::text[])", [chavesRemovidas]);
      await client.query("DELETE FROM os_agr_ins WHERE (emp || '|' || os) = ANY($1::text[])", [chavesRemovidas]);
      await client.query("DELETE FROM os_agr_os WHERE (emp || '|' || os) = ANY($1::text[])", [chavesRemovidas]);
      await client.query("DELETE FROM os_tlh t WHERE t.os = ANY($1::text[]) AND NOT EXISTS (SELECT 1 FROM os_agr x WHERE x.os = t.os)", [
        removidas.map((r) => r.os),
      ]);
    }
    if (gravar.length > 0) {
      if (alteradas.length > 0) await guardar(alteradas, "substituida");
      await client.query("DELETE FROM os_agr WHERE (emp || '|' || os) = ANY($1::text[])", [gravar]);
      await client.query("DELETE FROM os_agr_ins WHERE (emp || '|' || os) = ANY($1::text[])", [gravar]);
      const lin = gravar.flatMap((k) => linhas.get(k));
      for (let i = 0; i < lin.length; i += 2000) {
        await client.query(
          `INSERT INTO os_agr (emp, os, dt_os, dt_enc, prev_ini, prev_fim, prop_cod, setor, prop_nm, tlh, letra, area_plant, area_rec, op_cod, op_ds,
                               etapa_cod, etapa_ds, cc_cod, cc_ds, safra, ciclo, posicao, mes_exec, ano_exec, resp_cod, resp_nm, raio, usr_os, obs,
                               varied, prev_ini_erp, prev_fim_erp)
           SELECT emp, os, "dtOs", "dtEnc", "prevIni", "prevFim", "propCod", setor, "propNm", tlh, letra, "areaPlant", "areaRec", "opCod", "opDs",
                  "etapaCod", "etapaDs", "ccCod", "ccDs", safra, ciclo, posicao, "mesExec", "anoExec", "respCod", "respNm", raio, "usrOs", obs,
                  varied, "prevIniErp", "prevFimErp"
             FROM jsonb_to_recordset($1::jsonb) AS x(emp text, os text, "dtOs" date, "dtEnc" date, "prevIni" date, "prevFim" date, "propCod" text, setor text,
                  "propNm" text, tlh text, letra text, "areaPlant" numeric, "areaRec" numeric, "opCod" text, "opDs" text, "etapaCod" text, "etapaDs" text,
                  "ccCod" text, "ccDs" text, safra text, ciclo text, posicao text, "mesExec" integer, "anoExec" integer, "respCod" text, "respNm" text,
                  raio text, "usrOs" text, obs text, varied text, "prevIniErp" date, "prevFimErp" date)
           ON CONFLICT DO NOTHING`,
          [JSON.stringify(lin.slice(i, i + 2000))],
        );
      }
      const ins = gravar.flatMap((k) => {
        const o = porK.get(k);
        return o.req.map((r, seq) => ({ emp: o.emp, os: o.os, op: r.op, prod: r.prod, almx: r.almoxCod, ds: r.ds, almxNm: r.almoxNm, un: r.un, dose: r.dose, qtd: r.qtd, seq }));
      });
      for (let i = 0; i < ins.length; i += 3000) {
        await client.query(
          `INSERT INTO os_agr_ins (emp, os, op_cod, prod_cod, almx, prod_ds, almx_nm, un, dose, qtd, seq)
           SELECT emp, os, op, prod, almx, ds, "almxNm", un, dose, qtd, seq
             FROM jsonb_to_recordset($1::jsonb) AS x(emp text, os text, op text, prod text, almx text, ds text, "almxNm" text, un text,
                  dose numeric, qtd numeric, seq integer)
           ON CONFLICT DO NOTHING`,
          [JSON.stringify(ins.slice(i, i + 3000))],
        );
      }
      const cab = gravar.map((k) => {
        const o = porK.get(k);
        const e = encs.get(k);
        return {
          emp: o.emp,
          os: o.os,
          hsh: hashes.get(k),
          linhas: linhas.get(k).length,
          prdrCod: o.prdrCod,
          prdrNm: o.prdrNm,
          obs: o.obs,
          vazao: o.vazao,
          volCalda: o.volCalda,
          dtEnc: e.dt,
          encOrig: e.orig,
        };
      });
      await client.query(
        `INSERT INTO os_agr_os (emp, os, hsh, linhas, atu_usr, orig, prdr_cod, prdr_nm, obs, vazao, vol_calda, rel_em, dt_enc, enc_orig)
         SELECT emp, os, hsh, linhas, $2, 'pdf', "prdrCod", "prdrNm", obs, vazao, "volCalda", $3::date, "dtEnc", "encOrig"
           FROM jsonb_to_recordset($1::jsonb) AS x(emp text, os text, hsh text, linhas integer, "prdrCod" text, "prdrNm" text, obs text,
                vazao numeric, "volCalda" numeric, "dtEnc" date, "encOrig" text)
         ON CONFLICT (emp, os) DO UPDATE SET hsh = EXCLUDED.hsh, linhas = EXCLUDED.linhas, atu_em = now(), atu_usr = EXCLUDED.atu_usr,
                orig = 'pdf', prdr_cod = EXCLUDED.prdr_cod, prdr_nm = EXCLUDED.prdr_nm, obs = EXCLUDED.obs, vazao = EXCLUDED.vazao,
                vol_calda = EXCLUDED.vol_calda, rel_em = EXCLUDED.rel_em, dt_enc = EXCLUDED.dt_enc, enc_orig = EXCLUDED.enc_orig`,
        [JSON.stringify(cab), usuario, dataRel],
      );
    }
    // as iguais: só a data do último relatório lido
    const iguaisK = chaves.filter((k) => !gravar.includes(k));
    if (iguaisK.length) await client.query("UPDATE os_agr_os SET rel_em = $2::date WHERE (emp || '|' || os) = ANY($1::text[])", [iguaisK, dataRel]);
    await auditar(client, {
      usuario,
      modulo: "Ordem de Serviço Agr.",
      entidade: "Base de O.S.",
      chave: `Importação de ${previa.arquivo.nome || "relatório em PDF"}`,
      acao: "importacao",
      depois: {
        relatorio: "OS - Ordem de Serviço (PDF)",
        emitidoEm: dataBR(dataRel),
        periodo: previa.arquivo.periodo,
        ordensNoArquivo: ordens.length,
        descartadasNaLeitura: descartadas.length || undefined,
        novas: novas.length,
        substituidas: alteradas.length,
        semAlteracao: iguais,
        insumos: totalReq,
        encerradasIdentificadas: enc.identificadas || undefined,
        encerradasSemData: enc.semData || undefined,
        reabertas: enc.reabertas || undefined,
        foraDoArquivoNoPeriodo: ausentes.length || undefined,
        removidasDaBase: removidas.length || undefined,
        osRemovidas: removidas.length ? removidas.map((r) => r.os).join(", ").slice(0, 2000) : undefined,
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
  return { ...previa, removidas: removidas.length };
}

// ---------------------------------------------------------------------------
// Insumos, preços e área apontada
// ---------------------------------------------------------------------------

/**
 * Insumos (requisição de produtos) das O.S. `oss`, por O.S.: [{ opCod, prodCod, ds, un, dose, qtd, almox, almoxNm,
 * servico }] na ordem do relatório.
 */
export async function insumosDasOS(pool, oss) {
  const out = new Map();
  if (!oss.length) return out;
  const { rows } = await pool.query(
    `SELECT os, op_cod, prod_cod, prod_ds, un, dose::float AS dose, qtd::float AS qtd, almx, almx_nm
       FROM os_agr_ins WHERE os = ANY($1::text[]) ORDER BY os, seq`,
    [[...new Set(oss.map((o) => String(o).replace(/^0+(?=\d)/, "")))]],
  );
  for (const r of rows) {
    if (!out.has(r.os)) out.set(r.os, []);
    out.get(r.os).push({
      opCod: r.op_cod,
      prodCod: r.prod_cod,
      ds: r.prod_ds,
      un: r.un,
      dose: r.dose,
      qtd: r.qtd,
      almox: r.almx,
      almoxNm: r.almx_nm,
      servico: ehServico(r.almx_nm),
    });
  }
  return out;
}

/**
 * Custo médio dos insumos pelo Saldo Insumos (a mesma regra do Empréstimo): o do último saldo com quantidade, de
 * preferência da empresa 5; sem saldo, o último custo. Map código → { preco, dt }. Sem a base de saldos, vazio.
 */
export async function precosDosInsumos(pool, cods) {
  const out = new Map();
  const lista = [...new Set(cods.filter(Boolean))];
  if (!lista.length) return out;
  if (!(await pool.query("SELECT to_regclass('ins_sld') IS NOT NULL AS ok")).rows[0].ok) return out;
  const { rows } = await pool.query(
    `WITH g AS (
       SELECT cod, dt, emp, SUM(saldo * custo) / NULLIF(SUM(saldo), 0) AS preco
         FROM ins_sld WHERE cod = ANY($1::text[]) AND saldo > 0 GROUP BY cod, dt, emp
     )
     SELECT DISTINCT ON (cod) cod, dt::text AS dt, preco::float AS preco FROM g WHERE preco IS NOT NULL
      ORDER BY cod, (emp = 5) DESC, dt DESC`,
    [lista],
  );
  for (const r of rows) out.set(r.cod, { preco: r.preco, dt: r.dt });
  const faltam = lista.filter((c) => !out.has(c));
  if (faltam.length) {
    const u = await pool.query(
      "SELECT DISTINCT ON (cod) cod, dt::text AS dt, custo::float AS preco FROM ins_sld WHERE cod = ANY($1::text[]) ORDER BY cod, dt DESC",
      [faltam],
    );
    for (const r of u.rows) if (r.preco > 0) out.set(r.cod, { preco: r.preco, dt: r.dt });
  }
  return out;
}

const semZeros = (c) =>
  String(c ?? "")
    .trim()
    .replace(/^0+(?=\d)/, "");
const chaveApontada = (os, op, faz, tlh) => `${semZeros(os)}|${codigoOperacao(String(op ?? ""))}|${normFaz(faz)}|${normTlh(tlh)}`;

/** Área apontada por O.S. × operação × talhão (todas as origens): Map chaveApontada → ha. */
async function areasApontadas(pool, oss) {
  const out = new Map();
  if (!oss.length) return out;
  if (!(await pool.query("SELECT to_regclass('ap_dia_tlh') IS NOT NULL AS ok")).rows[0].ok) return out;
  const { rows } = await pool.query(
    `SELECT ltrim(a.os, '0') AS os, a.op_cod, t.prop_cod, t.tlh, SUM(t.area)::float AS area
       FROM ap_dia a JOIN ap_dia_tlh t ON t.ap_id = a.id
      WHERE ltrim(a.os, '0') = ANY($1::text[])
      GROUP BY 1, 2, 3, 4`,
    [[...new Set(oss.map(semZeros))]],
  );
  for (const r of rows) {
    const k = chaveApontada(r.os, r.op_cod, r.prop_cod, r.tlh);
    out.set(k, (out.get(k) ?? 0) + (r.area ?? 0));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------

async function hoje(pool) {
  return (await pool.query(`SELECT ${hojeSql}::text AS d`)).rows[0].d;
}

export async function faixasDias(pool = getPool()) {
  const { rows } = await pool.query("SELECT cod, nm, dds FROM cad_itm WHERE cad = 'faixas-dias-os'");
  const n = (v) => (v === "" || v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));
  const faixas = rows
    .map((r) => ({
      faixa: n(r.dds.faixa) ?? (Number(r.cod) || 0),
      descricao: r.nm || String(r.dds.descricao ?? r.cod),
      de: n(r.dds.de_dias) ?? 0,
      ate: n(r.dds.ate_dias),
    }))
    .sort((a, b) => a.de - b.de || a.faixa - b.faixa);
  return faixas.length ? faixas : FAIXAS_PADRAO;
}

async function responsaveisCadastro(pool) {
  const { rows } = await pool.query("SELECT cod, nm, dds->>'area' AS area FROM cad_itm WHERE cad = 'responsaveis-os'");
  return new Map(rows.map((r) => [r.cod, { nome: r.nm, area: r.area ?? "" }]));
}

/** Filtro de uma ou mais opções (operações, fazendas): lista de códigos; um código só, em texto, também vale. */
const codigosDoFiltro = (v) => (Array.isArray(v) ? v : v ? [v] : []).map((x) => String(x).trim()).filter(Boolean);

/** Condições dos filtros da tela sobre as linhas de os_agr. */
function condicoes(f) {
  const cond = [];
  const params = [];
  const add = (sql, v) => {
    params.push(v);
    cond.push(sql.replaceAll("?", `$${params.length}`));
  };
  if (f.de) add("dt_os >= ?::date", f.de);
  if (f.ate) add("dt_os <= ?::date", f.ate);
  if (f.safra) add("safra = ?", f.safra);
  if (f.resp) add("resp_cod = ?", f.resp);
  if (f.etapa) add("etapa_cod = ?", f.etapa);
  const ops = codigosDoFiltro(f.op);
  if (ops.length) add("op_cod = ANY(?::text[])", ops);
  // fazenda pelo código da propriedade, como vem na base (o mesmo das opções do filtro)
  const fazs = codigosDoFiltro(f.faz);
  if (fazs.length) add("prop_cod = ANY(?::text[])", fazs);
  if (f.posicao === "aberto") cond.push("posicao <> 'E'");
  else if (f.posicao) add("posicao = ?", f.posicao);
  if (f.q && f.q.trim()) {
    const q = f.q.trim();
    add("(os = ? OR prop_cod = ? OR prop_nm ILIKE '%' || ? || '%' OR op_ds ILIKE '%' || ? || '%' OR resp_nm ILIKE '%' || ? || '%')", q);
  }
  return { where: cond.length ? `WHERE ${cond.join(" AND ")}` : "", params };
}

/**
 * Linhas da base somadas por O.S. × operação, com os filtros e a área apontada nos talhões da operação. Operação e
 * fazenda (uma ou mais) filtram as linhas: a O.S. entra com as operações e os talhões das fazendas escolhidas (a área,
 * os talhões e o apontado contam só esses).
 */
async function operacoesFiltradas(pool, f) {
  const { where, params } = condicoes(f);
  const [{ rows }, { rows: tl }] = await Promise.all([
    pool.query(
      `SELECT emp, os, op_cod, MAX(op_ds) AS op_ds, MAX(etapa_cod) AS etapa_cod, MAX(etapa_ds) AS etapa_ds, MAX(resp_cod) AS resp_cod, MAX(resp_nm) AS resp_nm,
              MIN(posicao) AS posicao, MIN(dt_os)::text AS dt_os, MAX(dt_enc)::text AS dt_enc, MAX(prev_fim)::text AS prev_fim, MAX(usr_os) AS usr_os,
              MAX(safra) AS safra, COUNT(*)::int AS n_tlh, SUM(area_rec)::float AS area_rec, SUM(area_plant)::float AS area_plant,
              array_agg(DISTINCT prop_cod || ' · ' || prop_nm) AS fazendas
         FROM os_agr ${where}
        GROUP BY emp, os, op_cod`,
      params,
    ),
    pool.query(`SELECT emp, os, op_cod, prop_cod, tlh || letra AS tlh FROM os_agr ${where}`, params),
  ]);
  const feito = await areasApontadas(pool, [...new Set(rows.map((r) => r.os))]);
  const apontado = new Map();
  for (const l of tl) {
    const a = feito.get(chaveApontada(l.os, l.op_cod, l.prop_cod, l.tlh)) ?? 0;
    const k = `${l.emp}|${l.os}|${l.op_cod}`;
    apontado.set(k, (apontado.get(k) ?? 0) + a);
  }
  // nome da operação pelo cadastro Operações
  const cadOps = await operacoesDoCadastro(pool);
  return rows.map((r) => ({
    emp: r.emp,
    os: r.os,
    opCod: r.op_cod,
    opDs: nomeOperacao(cadOps, r.op_cod, r.op_ds),
    etapaCod: r.etapa_cod,
    etapaDs: r.etapa_ds,
    respCod: r.resp_cod,
    respNm: r.resp_nm,
    posicao: r.posicao,
    dtOs: r.dt_os,
    dtEnc: r.dt_enc,
    prevFim: r.prev_fim,
    usrOs: r.usr_os,
    safra: r.safra,
    nTlh: r.n_tlh,
    areaRec: round2(r.area_rec ?? 0),
    areaPlant: round2(r.area_plant ?? 0),
    apontado: round2(apontado.get(`${r.emp}|${r.os}|${r.op_cod}`) ?? 0),
    fazendas: r.fazendas ?? [],
  }));
}

export async function opcoesOS() {
  const pool = getPool();
  await prepararOSAgr(pool);
  const [s, r, e, o, fz, u, faixas] = await Promise.all([
    pool.query("SELECT DISTINCT safra AS v FROM os_agr WHERE safra <> '' ORDER BY 1 DESC"),
    pool.query("SELECT resp_cod AS cod, MAX(resp_nm) AS nome FROM os_agr WHERE resp_cod NOT IN ('', '0') GROUP BY resp_cod ORDER BY 2"),
    pool.query("SELECT etapa_cod AS cod, MAX(etapa_ds) AS nome FROM os_agr WHERE etapa_cod <> '' GROUP BY etapa_cod ORDER BY 1"),
    pool.query("SELECT op_cod AS cod, MAX(op_ds) AS nome FROM os_agr WHERE op_cod <> '' GROUP BY op_cod ORDER BY 2"),
    pool.query(
      `SELECT prop_cod AS cod, MAX(prop_nm) AS nome FROM os_agr WHERE prop_cod <> '' GROUP BY prop_cod
        ORDER BY CASE WHEN prop_cod ~ '^[0-9]+$' THEN lpad(prop_cod, 12, '0') ELSE prop_cod END`,
    ),
    pool.query(
      `SELECT to_char(MAX(atu_em) AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') AS ult, COUNT(*)::int AS n,
              to_char(MAX(rel_em), 'DD/MM/YYYY') AS rel
         FROM os_agr_os`,
    ),
    faixasDias(pool),
  ]);
  const cadOps = await operacoesDoCadastro(pool);
  return {
    safras: s.rows.map((x) => x.v),
    responsaveis: r.rows,
    etapas: e.rows,
    operacoes: o.rows.map((x) => ({ cod: x.cod, nome: nomeOperacao(cadOps, x.cod, x.nome) })).sort((a, b) => a.nome.localeCompare(b.nome)),
    fazendas: fz.rows,
    faixas,
    ultimaImportacao: u.rows[0].ult,
    // emissão do último relatório em PDF lido
    ultimoRelatorio: u.rows[0].rel,
    ordens: u.rows[0].n,
  };
}

/**
 * Lista de O.S. (uma linha por O.S.), com os filtros de faixa de dias e atraso aplicados depois de agrupar, a área
 * apontada e os insumos (quantos e o valor estimado pelo custo médio do Saldo Insumos).
 */
export async function listarOrdensOS(f) {
  const pool = getPool();
  await prepararOSAgr(pool);
  const [ops, faixas, dia] = await Promise.all([operacoesFiltradas(pool, f), faixasDias(pool), hoje(pool)]);
  let lista = agruparPorOS(ops, faixas, dia);
  if (f.faixa) lista = lista.filter((o) => o.faixa === f.faixa);
  if (f.atrasadas) lista = lista.filter((o) => o.atrasada);
  const ins = await insumosDasOS(
    pool,
    lista.map((o) => o.os),
  );
  const precos = await precosDosInsumos(
    pool,
    [...ins.values()].flat().map((i) => i.prodCod),
  );
  const extras = new Map(
    (
      await pool.query("SELECT emp || '|' || os AS k, obs, enc_orig FROM os_agr_os WHERE os = ANY($1::text[])", [lista.map((o) => o.os)])
    ).rows.map((r) => [r.k, r]),
  );
  for (const o of lista) {
    const li = ins.get(o.os) ?? [];
    o.nInsumos = li.filter((i) => !i.servico).length;
    let valor = 0;
    let comPreco = false;
    for (const i of li) {
      const p = precos.get(i.prodCod);
      if (!i.servico && p && i.qtd !== null) {
        valor += i.qtd * p.preco;
        comPreco = true;
      }
    }
    o.valorInsumos = comPreco ? round2(valor) : null;
    const x = extras.get(`${o.emp}|${o.os}`);
    o.obs = x?.obs || "";
    o.encOrig = x?.enc_orig || "";
  }
  return lista;
}

export async function painelOS(f) {
  const pool = getPool();
  await prepararOSAgr(pool);
  const [ops, faixas, resp, dia] = await Promise.all([operacoesFiltradas(pool, f), faixasDias(pool), responsaveisCadastro(pool), hoje(pool)]);
  return { ...montarPainelOS(agruparPorOS(ops, faixas, dia), faixas, resp), hoje: dia };
}

/**
 * Uma O.S. aberta na lista: os talhões (com a área apontada em cada um), os insumos com o valor estimado, a observação,
 * o produtor, a vazão, o volume de calda e o encerramento (data e como foi identificado).
 */
export async function detalheDaOS(emp, os) {
  const pool = getPool();
  await prepararOSAgr(pool);
  const [{ rows }, cab] = await Promise.all([
    pool.query(
      `SELECT ${COLS_BANCO} FROM os_agr WHERE emp = $1 AND os = $2
        ORDER BY op_cod, prop_cod, CASE WHEN tlh ~ '^[0-9]+$' THEN lpad(tlh, 8, '0') ELSE tlh END, letra`,
      [emp, os],
    ),
    pool.query(
      `SELECT orig, prdr_cod, prdr_nm, obs, vazao::float AS vazao, vol_calda::float AS vol_calda, to_char(rel_em, 'YYYY-MM-DD') AS rel_em,
              to_char(dt_enc, 'YYYY-MM-DD') AS dt_enc, enc_orig
         FROM os_agr_os WHERE emp = $1 AND os = $2`,
      [emp, os],
    ),
  ]);
  const feito = await areasApontadas(pool, [os]);
  const talhoes = rows.map((r) => ({ ...doBanco(r), apontado: round2(feito.get(chaveApontada(r.os, r.op_cod, r.prop_cod, `${r.tlh}${r.letra}`)) ?? 0) }));
  const ins = (await insumosDasOS(pool, [os])).get(String(os)) ?? [];
  const precos = await precosDosInsumos(
    pool,
    ins.map((i) => i.prodCod),
  );
  const cadOps = await operacoesDoCadastro(pool);
  const areaOp = new Map();
  for (const t of talhoes) areaOp.set(codigoOperacao(t.opCod), (areaOp.get(codigoOperacao(t.opCod)) ?? 0) + (t.areaRec ?? t.areaPlant ?? 0));
  const c = cab.rows[0] ?? null;
  return {
    talhoes,
    insumos: ins.map((i) => {
      const p = i.servico ? null : precos.get(i.prodCod);
      const area = round2(areaOp.get(codigoOperacao(i.opCod)) ?? 0);
      return {
        ...i,
        opDs: nomeOperacao(cadOps, i.opCod, talhoes.find((t) => t.opCod === i.opCod)?.opDs ?? ""),
        area,
        prevista: i.dose !== null && area ? Math.round(i.dose * area * 1000) / 1000 : null,
        preco: p?.preco ?? null,
        precoData: p?.dt ?? null,
        valor: p && i.qtd !== null ? round2(i.qtd * p.preco) : null,
      };
    }),
    cab: c
      ? {
          orig: c.orig,
          prdrCod: c.prdr_cod,
          prdrNm: c.prdr_nm,
          obs: c.obs || rows[0]?.obs || "",
          vazao: c.vazao,
          volCalda: c.vol_calda,
          relEm: c.rel_em,
          dtEnc: c.dt_enc ?? rows[0]?.dt_enc ?? null,
          encOrig: c.enc_orig,
        }
      : null,
  };
}
