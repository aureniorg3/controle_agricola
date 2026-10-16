import { createHash } from "crypto";

import { nomeOperacao, operacoesDoCadastro } from "./db-operacoes";
import { auditar } from "./auditar";
import { specPorSlug } from "./cadastros-spec";
import { getPool, prepararBanco, sincronizarDescricaoFazendas } from "./db";
import { chaveLinhaOS } from "./import-os-agr";
import { agruparPorOS, FAIXAS_PADRAO, montarPainelOS, nomePosicao, round2 } from "./os-agr";
import semente from "./os-agr-seed.json";

let preparado = null;

/** Tabelas da base de O.S. (os_agr: linhas; os_agr_os: uma por O.S., com a assinatura do conteúdo) e cargas iniciais. */
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
      await pool.query(
        `CREATE TABLE IF NOT EXISTS os_agr_os (
           emp text NOT NULL, os text NOT NULL, hsh text NOT NULL, linhas integer NOT NULL DEFAULT 0,
           cri_em timestamptz NOT NULL DEFAULT now(), atu_em timestamptz NOT NULL DEFAULT now(), atu_usr text NOT NULL DEFAULT '',
           PRIMARY KEY (emp, os)
         )`,
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

// ---------------------------------------------------------------------------
// Importação com validação: só substitui as O.S. que mudaram
// ---------------------------------------------------------------------------

const assinatura = (linhas) =>
  createHash("md5")
    .update(JSON.stringify([...linhas].sort((a, b) => chaveLinhaOS(a).localeCompare(chaveLinhaOS(b))).map((l) => Object.values(l))))
    .digest("hex");

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
});
const COLS_BANCO = `emp, os, dt_os::text AS dt_os, dt_enc::text AS dt_enc, prev_ini::text AS prev_ini, prev_fim::text AS prev_fim, prop_cod, setor, prop_nm,
  tlh, letra, area_plant::float AS area_plant, area_rec::float AS area_rec, op_cod, op_ds, etapa_cod, etapa_ds, cc_cod, cc_ds, safra, ciclo, posicao,
  mes_exec, ano_exec, resp_cod, resp_nm, raio, usr_os, obs`;

const fmtHa = (n) => n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Descreve o que mudou numa O.S. (para a prévia) e marca as categorias. */
function compararOS(antigas, novas) {
  const cat = { posicao: false, encerrada: false, talhoes: false, areas: false, outros: false };
  const partes = [];
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
  const soma = (ls) => round2(ls.reduce((a, l) => a + (l.areaRec ?? 0), 0));
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

/** O.S. que saem da base mostradas na prévia (as outras só contam). */
const MAX_REMOVIDAS_PREVIA = 60;

/**
 * Confere o arquivo contra a base. Cada O.S. do arquivo é comparada pela assinatura do conteúdo: as novas entram, as que
 * mudaram são substituídas por inteiro e as iguais ficam como estão. Como na Pesagem de Cana, com o relatório completo
 * (`info.completo`: o período "Data da OS" e a posição "Todas" no cabeçalho) as O.S. da base com a Data da OS dentro do
 * período (da mesma empresa) que não vieram no arquivo deixaram de existir na origem: saem da base (os_agr, os_agr_os e
 * a antiga os_tlh da mesma O.S.). Os apontamentos ligados a elas ficam como estão — a tela Apontamento destaca a linha
 * (O.S. fora da base) para ligar a outra O.S. Fora do período, ou com filtro de posição, as que não vieram ficam.
 * Com `aplicar = false` só devolve a prévia.
 */
export async function importarOSAgr(linhas, info, usuario, aplicar) {
  const pool = getPool();
  await prepararOSAgr(pool);
  // os apontamentos (ap_dia) e a antiga base de O.S. (os_tlh): import na hora (db-atividades importa este arquivo)
  const { prepararAtividades } = await import("./db-atividades");
  await prepararAtividades(pool);
  const porOS = new Map();
  for (const l of linhas) {
    const k = `${l.emp}|${l.os}`;
    if (!porOS.has(k)) porOS.set(k, []);
    porOS.get(k).push(l);
  }
  const chaves = [...porOS.keys()];
  const hashes = new Map([...porOS].map(([k, ls]) => [k, assinatura(ls)]));
  const existentes = new Map(
    (await pool.query("SELECT emp || '|' || os AS k, hsh FROM os_agr_os WHERE (emp || '|' || os) = ANY($1::text[])", [chaves])).rows.map((r) => [r.k, r.hsh]),
  );
  const novas = chaves.filter((k) => !existentes.has(k));
  const alteradas = chaves.filter((k) => existentes.has(k) && existentes.get(k) !== hashes.get(k));
  const iguais = chaves.length - novas.length - alteradas.length;
  const foraTotal = (await pool.query("SELECT COUNT(*)::int AS n FROM os_agr_os WHERE NOT ((emp || '|' || os) = ANY($1::text[]))", [chaves])).rows[0].n;
  // relatório completo: as O.S. da base com a Data da OS no período (da empresa do arquivo) que não vieram nele saem, com
  // os boletins lançados nelas (que ficam, destacados na tela Apontamento)
  const empresas = [...new Set(linhas.map((l) => l.emp))];
  const removidas = info.completo
    ? (
        await pool.query(
          `SELECT o.emp, o.os, MIN(o.dt_os)::text AS dt, COUNT(*)::int AS linhas, COUNT(DISTINCT o.op_cod)::int AS ops,
                  string_agg(DISTINCT o.prop_cod, ', ') AS fazendas, MAX(o.posicao) AS posicao,
                  (SELECT COUNT(*)::int FROM ap_dia a WHERE a.os = o.os) AS boletins
             FROM os_agr o
            WHERE o.emp = ANY($1::text[]) AND o.dt_os BETWEEN $2::date AND $3::date AND NOT ((o.emp || '|' || o.os) = ANY($4::text[]))
            GROUP BY o.emp, o.os
            ORDER BY MIN(o.dt_os), o.os`,
          [empresas, info.periodoIni, info.periodoFim, chaves],
        )
      ).rows
    : [];
  const chavesRemovidas = removidas.map((r) => `${r.emp}|${r.os}`);
  const boletinsRemovidas = removidas.reduce((a, r) => a + r.boletins, 0);
  const fora = Math.max(0, foraTotal - removidas.length);

  const mudancas = { posicao: 0, encerradas: 0, talhoes: 0, areas: 0, outros: 0 };
  const exemplos = [];
  if (alteradas.length > 0) {
    const antigas = new Map();
    for (const r of (await pool.query(`SELECT ${COLS_BANCO} FROM os_agr WHERE (emp || '|' || os) = ANY($1::text[])`, [alteradas])).rows) {
      const k = `${r.emp}|${r.os}`;
      if (!antigas.has(k)) antigas.set(k, []);
      antigas.get(k).push(doBanco(r));
    }
    for (const k of alteradas.sort((a, b) => Number(b.split("|")[1]) - Number(a.split("|")[1]))) {
      const { cat, texto } = compararOS(antigas.get(k) ?? [], porOS.get(k));
      if (cat.posicao) mudancas.posicao++;
      if (cat.encerrada) mudancas.encerradas++;
      if (cat.talhoes) mudancas.talhoes++;
      if (cat.areas) mudancas.areas++;
      if (cat.outros) mudancas.outros++;
      if (exemplos.length < 40) exemplos.push({ os: k.split("|")[1], texto });
    }
  }
  const previa = {
    arquivo: {
      linhas: linhas.length,
      ordens: chaves.length,
      repetidas: info.repetidas,
      periodo: info.periodo,
      posicao: info.posicaoFiltro ?? null,
      completo: !!info.completo,
    },
    novas: novas.length,
    alteradas: alteradas.length,
    iguais,
    // O.S. que saem da base (do período, não vieram no arquivo) e os boletins lançados nelas
    removidas: removidas.length,
    boletinsRemovidas,
    listaRemovidas: removidas.slice(0, MAX_REMOVIDAS_PREVIA).map((r) => ({
      os: r.os,
      dt: r.dt,
      fazendas: r.fazendas ?? "",
      operacoes: r.ops,
      linhas: r.linhas,
      posicao: nomePosicao(r.posicao ?? ""),
      boletins: r.boletins,
    })),
    // as que não vieram e ficam (fora do período ou relatório com filtro)
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
    if (chavesRemovidas.length > 0) {
      // a O.S. sai inteira (e a cópia dela na antiga base de O.S., que valeria no lugar dela)
      await client.query("DELETE FROM os_agr WHERE (emp || '|' || os) = ANY($1::text[])", [chavesRemovidas]);
      await client.query("DELETE FROM os_agr_os WHERE (emp || '|' || os) = ANY($1::text[])", [chavesRemovidas]);
      await client.query("DELETE FROM os_tlh t WHERE t.os = ANY($1::text[]) AND NOT EXISTS (SELECT 1 FROM os_agr x WHERE x.os = t.os)", [
        removidas.map((r) => r.os),
      ]);
    }
    if (gravar.length > 0) {
      await client.query("DELETE FROM os_agr WHERE (emp || '|' || os) = ANY($1::text[])", [gravar]);
      const lin = gravar.flatMap((k) => porOS.get(k));
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
          [JSON.stringify(lin.slice(i, i + 2000))],
        );
      }
      await client.query(
        `INSERT INTO os_agr_os (emp, os, hsh, linhas, atu_usr)
         SELECT split_part(k, '|', 1), split_part(k, '|', 2), h, n, $4 FROM unnest($1::text[], $2::text[], $3::int[]) AS u(k, h, n)
         ON CONFLICT (emp, os) DO UPDATE SET hsh = EXCLUDED.hsh, linhas = EXCLUDED.linhas, atu_em = now(), atu_usr = EXCLUDED.atu_usr`,
        [gravar, gravar.map((k) => hashes.get(k)), gravar.map((k) => porOS.get(k).length), usuario],
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
        // relatório com filtro de posição (ou sem período): as que não vieram ficam
        posicaoDaOS: info.posicaoFiltro || undefined,
        removidasDaBase: removidas.length,
        osRemovidas: removidas.length ? removidas.map((r) => r.os).join(", ").slice(0, 2000) : undefined,
        boletinsDasRemovidas: boletinsRemovidas || undefined,
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

const hojeSql = "(now() AT TIME ZONE 'America/Sao_Paulo')::date";

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

/**
 * Linhas da base somadas por O.S. × operação, com os filtros. Operação e fazenda (uma ou mais) filtram as linhas: a O.S.
 * entra com as operações e os talhões das fazendas escolhidas (a área e os talhões contam só esses).
 */
async function operacoesFiltradas(pool, f) {
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
  const { rows } = await pool.query(
    `SELECT emp, os, op_cod, MAX(op_ds) AS op_ds, MAX(etapa_cod) AS etapa_cod, MAX(etapa_ds) AS etapa_ds, MAX(resp_cod) AS resp_cod, MAX(resp_nm) AS resp_nm,
            MIN(posicao) AS posicao, MIN(dt_os)::text AS dt_os, MAX(dt_enc)::text AS dt_enc, MAX(prev_fim)::text AS prev_fim, MAX(usr_os) AS usr_os,
            MAX(safra) AS safra, COUNT(*)::int AS n_tlh, SUM(area_rec)::float AS area_rec, SUM(area_plant)::float AS area_plant,
            array_agg(DISTINCT prop_cod || ' · ' || prop_nm) AS fazendas
       FROM os_agr ${cond.length ? `WHERE ${cond.join(" AND ")}` : ""}
      GROUP BY emp, os, op_cod`,
    params,
  );
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
    pool.query("SELECT to_char(MAX(atu_em) AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') AS ult, COUNT(*)::int AS n FROM os_agr_os"),
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
    ordens: u.rows[0].n,
  };
}

/** Lista de O.S. (uma linha por O.S.), com os filtros de faixa de dias e atraso aplicados depois de agrupar. */
export async function listarOrdensOS(f) {
  const pool = getPool();
  await prepararOSAgr(pool);
  const [ops, faixas, dia] = await Promise.all([operacoesFiltradas(pool, f), faixasDias(pool), hoje(pool)]);
  let lista = agruparPorOS(ops, faixas, dia);
  if (f.faixa) lista = lista.filter((o) => o.faixa === f.faixa);
  if (f.atrasadas) lista = lista.filter((o) => o.atrasada);
  return lista;
}

export async function painelOS(f) {
  const pool = getPool();
  await prepararOSAgr(pool);
  const [ops, faixas, resp, dia] = await Promise.all([operacoesFiltradas(pool, f), faixasDias(pool), responsaveisCadastro(pool), hoje(pool)]);
  return { ...montarPainelOS(agruparPorOS(ops, faixas, dia), faixas, resp), hoje: dia };
}

/** Talhões de uma O.S. (para abrir a linha na lista). */
export async function talhoesDaOS(emp, os) {
  const pool = getPool();
  await prepararOSAgr(pool);
  const { rows } = await pool.query(
    `SELECT ${COLS_BANCO} FROM os_agr WHERE emp = $1 AND os = $2
      ORDER BY op_cod, prop_cod, CASE WHEN tlh ~ '^[0-9]+$' THEN lpad(tlh, 8, '0') ELSE tlh END, letra`,
    [emp, os],
  );
  return rows.map(doBanco);
}
