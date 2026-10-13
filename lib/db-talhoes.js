import fs from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { auditar } from "./auditar";
import { getPool, listSafrasCadastro, prepararBanco, sincronizarDescricaoFazendas } from "./db";
import { ocupacoesDoCadastro } from "./db-ocupacao";
import { ehProducao, normFaz, normTlh, ocupacaoDoTalhao } from "./ocupacao";
import { safraDaData } from "./safra-cadastro";

/**
 * Base Fazenda e Talhões (Planejamento Agrícola): o "Relatório de Talhões I" de cada safra, uma linha por fazenda ×
 * talhão × parte (tlh_saf), e um registro por safra com a última importação (tlh_saf_imp). É a base de áreas dos
 * apontamentos: a área do talhão é a coluna Área Talhão (que se repete em cada parte), contada uma vez por talhão.
 */

const MODULO = "Planejamento Agrícola";
const ENTIDADE = "Fazenda e Talhões";

/** campo do leitor (lib/import-talhoes) → coluna da tabela */
const COLUNAS = [
  ["propCod", "prop_cod", "text"],
  ["propNm", "prop_nm", "text"],
  ["bloco", "bloco", "text"],
  ["tlh", "tlh", "text"],
  ["letra", "letra", "text"],
  ["parte", "parte", "int"],
  ["variedade", "variedade", "text"],
  ["estagio", "estagio", "int"],
  ["ambiente", "ambiente", "text"],
  ["plantio", "plantio", "date"],
  ["ultCorte", "ult_corte", "date"],
  ["areaTlh", "area_tlh", "numeric"],
  ["areaParte", "area_parte", "numeric"],
  ["finalidade", "finalidade", "text"],
  ["produtividade", "produtividade", "numeric"],
  ["prodTotal", "prod_total", "numeric"],
  ["dist", "dist", "numeric"],
  ["esp", "esp", "numeric"],
  ["tipoCorte", "tipo_corte", "text"],
];

/** carga inicial da safra 2026 (o relatório que veio junto do pedido, em seed/talhoes-2026.json.gz), uma vez só */
const MARCA_SEMENTE = "Carga inicial · RSC0054E-7465.xlsx (safra 2026)";

const r3 = (n) => Math.round(n * 1000) / 1000;
const hojeSP = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
const ORDEM_TLH = "CASE WHEN tlh ~ '^[0-9]+$' THEN lpad(tlh, 8, '0') ELSE tlh END";
const ORDEM_FAZ = "CASE WHEN prop_cod ~ '^[0-9]+$' THEN lpad(prop_cod, 10, '0') ELSE prop_cod END";

/** Área do talhão: a Área Talhão do relatório; se ela vier 0 (há casos no sistema de origem), a soma das partes. */
export const areaDoTalhao = (talhao, somaPartes) => (talhao > 0 ? r3(talhao) : somaPartes > 0 ? r3(somaPartes) : (talhao ?? null));

let preparado = null;

export async function prepararTalhoes(pool = getPool()) {
  await prepararBanco(pool);
  if (!preparado) {
    preparado = (async () => {
      await pool.query(
        `CREATE TABLE IF NOT EXISTS tlh_saf (
           saf integer NOT NULL, emp text NOT NULL DEFAULT '', prop_cod text NOT NULL, prop_nm text NOT NULL DEFAULT '',
           bloco text NOT NULL DEFAULT '', tlh text NOT NULL, letra text NOT NULL DEFAULT '', parte integer NOT NULL,
           variedade text NOT NULL DEFAULT '', estagio integer, ambiente text NOT NULL DEFAULT '', plantio date, ult_corte date,
           area_tlh numeric, area_parte numeric, finalidade text NOT NULL DEFAULT '', produtividade numeric, prod_total numeric,
           dist numeric, esp numeric, tipo_corte text NOT NULL DEFAULT '',
           PRIMARY KEY (saf, prop_cod, tlh, letra, parte)
         )`,
      );
      await pool.query("CREATE INDEX IF NOT EXISTS idx_tlh_saf_faz ON tlh_saf (prop_cod, tlh)");
      await pool.query(
        `CREATE TABLE IF NOT EXISTS tlh_saf_imp (
           saf integer PRIMARY KEY, emp text NOT NULL DEFAULT '', arquivo text NOT NULL DEFAULT '',
           fazendas integer NOT NULL DEFAULT 0, talhoes integer NOT NULL DEFAULT 0, partes integer NOT NULL DEFAULT 0,
           area_tlh numeric, area_parte numeric, atu_em timestamptz NOT NULL DEFAULT now(), atu_usr text NOT NULL DEFAULT ''
         )`,
      );
      await carregarSafraInicial(pool);
    })().catch((err) => {
      preparado = null;
      throw err;
    });
  }
  await preparado;
}

/** Grava a safra inteira (substitui a que havia) numa transação, com o registro da importação e o log. */
async function gravarSafra(pool, lido, arquivo, usuario, chaveLog, resumo) {
  const saf = Number(lido.safra);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('tlh_saf_importacao'))");
    const antes = (
      await client.query("SELECT fazendas, talhoes, partes, area_tlh::float AS area_tlh, arquivo FROM tlh_saf_imp WHERE saf = $1", [saf])
    ).rows[0];
    await client.query("DELETE FROM tlh_saf WHERE saf = $1", [saf]);
    for (let i = 0; i < lido.linhas.length; i += 2000) {
      const lote = lido.linhas.slice(i, i + 2000).map((l) => {
        const o = { saf, emp: lido.emp ?? "" };
        for (const [k, col] of COLUNAS) o[col] = l[k] ?? null;
        for (const [k, col, tipo] of COLUNAS) if (tipo === "text") o[col] = String(l[k] ?? "");
        return o;
      });
      await client.query(
        `INSERT INTO tlh_saf (saf, emp, ${COLUNAS.map((c) => c[1]).join(", ")})
         SELECT saf, emp, ${COLUNAS.map((c) => c[1]).join(", ")}
           FROM jsonb_to_recordset($1::jsonb) AS x(saf integer, emp text, ${COLUNAS.map((c) => `${c[1]} ${c[2]}`).join(", ")})
         ON CONFLICT (saf, prop_cod, tlh, letra, parte) DO NOTHING`,
        [JSON.stringify(lote)],
      );
    }
    await client.query(
      `INSERT INTO tlh_saf_imp (saf, emp, arquivo, fazendas, talhoes, partes, area_tlh, area_parte, atu_em, atu_usr)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now(), $9)
       ON CONFLICT (saf) DO UPDATE SET emp = EXCLUDED.emp, arquivo = EXCLUDED.arquivo, fazendas = EXCLUDED.fazendas, talhoes = EXCLUDED.talhoes,
         partes = EXCLUDED.partes, area_tlh = EXCLUDED.area_tlh, area_parte = EXCLUDED.area_parte, atu_em = now(), atu_usr = EXCLUDED.atu_usr`,
      [saf, lido.emp ?? "", arquivo, resumo.fazendas, resumo.talhoes, resumo.partes, resumo.areaTalhoes, resumo.areaPartes, usuario],
    );
    await auditar(client, {
      usuario,
      modulo: MODULO,
      entidade: ENTIDADE,
      chave: chaveLog,
      acao: "importacao",
      antes: antes ?? undefined,
      depois: { safra: saf, arquivo, ...resumo },
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
}

/** Totais de um conjunto de linhas (área do talhão uma vez por talhão). */
function resumoDasLinhas(linhas) {
  const talhoes = new Map();
  for (const l of linhas) {
    const k = `${l.propCod}|${l.tlh}|${l.letra}`;
    const t = talhoes.get(k) ?? { a: l.areaTlh ?? 0, p: 0 };
    t.p += l.areaParte ?? 0;
    talhoes.set(k, t);
  }
  return {
    fazendas: new Set(linhas.map((l) => l.propCod)).size,
    talhoes: talhoes.size,
    partes: linhas.length,
    areaTalhoes: r3([...talhoes.values()].reduce((s, t) => s + t.a, 0)),
    areaPartes: r3(linhas.reduce((s, l) => s + (l.areaParte ?? 0), 0)),
  };
}

async function carregarSafraInicial(pool) {
  try {
    const arquivo = path.join(process.cwd(), "seed", "talhoes-2026.json.gz");
    if (!fs.existsSync(arquivo)) return;
    const marcada = async (exec) =>
      ((await exec.query("SELECT 1 FROM aud_log WHERE modulo = $1 AND entidade = $2 AND chave = $3 LIMIT 1", [MODULO, ENTIDADE, MARCA_SEMENTE])).rowCount ??
        0) > 0;
    if (await marcada(pool)) return;
    const s = JSON.parse(gunzipSync(fs.readFileSync(arquivo)).toString("utf8"));
    // a safra já importada pela tela não é sobrescrita pela carga inicial
    if ((await pool.query("SELECT 1 FROM tlh_saf_imp WHERE saf = $1", [Number(s.safra)])).rowCount) return;
    const linhas = s.linhas.map((v) => Object.fromEntries(s.campos.map((c, i) => [c, v[i]])));
    const lido = { safra: s.safra, emp: s.emp, linhas };
    await gravarSafra(pool, lido, s.arquivo, "Carga inicial", MARCA_SEMENTE, resumoDasLinhas(linhas));
  } catch (err) {
    console.error("Carga inicial da base Fazenda e Talhões não concluída:", err);
  }
}

/** Fazenda × talhão (com a letra) → { área do talhão, soma das partes, assinatura das partes }. */
function agruparTalhoes(linhas) {
  const m = new Map();
  for (const l of linhas) {
    const k = `${l.propCod}|${l.tlh}${l.letra}`;
    let t = m.get(k);
    if (!t) {
      t = { propCod: l.propCod, propNm: l.propNm, tlh: l.tlh, letra: l.letra, areaTlh: l.areaTlh ?? 0, somaPartes: 0, partes: [] };
      m.set(k, t);
    }
    t.somaPartes += l.areaParte ?? 0;
    t.partes.push(l);
  }
  for (const t of m.values()) {
    t.partes.sort((a, b) => a.parte - b.parte);
    // todas as colunas da parte: o que mudar no arquivo aparece na prévia (e libera a gravação)
    const nn = (v) => (v === null || v === undefined ? "" : r3(v));
    t.assinatura = t.partes
      .map((p) =>
        [p.parte, p.variedade, p.estagio, p.plantio, p.ultCorte, r3(p.areaParte ?? 0), p.finalidade, p.tipoCorte, p.bloco, p.ambiente]
          .concat([p.produtividade, p.prodTotal, p.dist, p.esp].map(nn))
          .join("~"),
      )
      .join("|");
  }
  return m;
}

const ha = (n) => `${(n ?? 0).toLocaleString("pt-BR", { maximumFractionDigits: 3 })} ha`;

/** Linhas da safra gravadas na base, no formato do leitor. */
async function linhasDaSafra(pool, saf) {
  const { rows } = await pool.query(
    `SELECT prop_cod, prop_nm, bloco, tlh, letra, parte, variedade, estagio, ambiente, plantio::text AS plantio, ult_corte::text AS ult_corte,
            area_tlh::float AS area_tlh, area_parte::float AS area_parte, finalidade, produtividade::float AS produtividade,
            prod_total::float AS prod_total, dist::float AS dist, esp::float AS esp, tipo_corte
       FROM tlh_saf WHERE saf = $1
      ORDER BY ${ORDEM_FAZ}, ${ORDEM_TLH}, letra, parte`,
    [saf],
  );
  return rows.map((r) => Object.fromEntries(COLUNAS.map(([k, col]) => [k, r[col]])));
}

/**
 * Importação do Relatório de Talhões I: a safra do arquivo substitui a safra inteira da base. Sem `aplicar`, só a prévia
 * (o que entra, o que sai e o que muda, a área por ocupação e os avisos); com `aplicar`, grava.
 */
export async function importarTalhoes(lido, arquivo, usuario, aplicar) {
  const pool = getPool();
  await prepararTalhoes(pool);
  const saf = Number(lido.safra);
  const ocupacoes = await ocupacoesDoCadastro(pool);
  const novo = agruparTalhoes(lido.linhas);
  const resumo = resumoDasLinhas(lido.linhas);

  const imp = (
    await pool.query(
      `SELECT emp, arquivo, talhoes, partes, area_tlh::float AS area_tlh, atu_usr,
              to_char(atu_em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') AS atu FROM tlh_saf_imp WHERE saf = $1`,
      [saf],
    )
  ).rows[0];
  const atual = agruparTalhoes(await linhasDaSafra(pool, saf));

  let novos = 0;
  let alterados = 0;
  let iguais = 0;
  const exemplos = [];
  const exemplo = (t, texto) => exemplos.length < 40 && exemplos.push({ chave: `${t.propCod} · ${t.tlh}${t.letra}`, texto });
  for (const [k, t] of novo) {
    const a = atual.get(k);
    if (!a) {
      novos++;
      exemplo(t, `talhão novo (${ha(t.areaTlh)}, ${t.partes.length} parte(s))`);
    } else if (Math.abs((a.areaTlh ?? 0) - (t.areaTlh ?? 0)) > 0.0005 || a.assinatura !== t.assinatura) {
      alterados++;
      const o = [];
      if (Math.abs((a.areaTlh ?? 0) - (t.areaTlh ?? 0)) > 0.0005) o.push(`área ${ha(a.areaTlh)} → ${ha(t.areaTlh)}`);
      if (a.partes.length !== t.partes.length) o.push(`partes ${a.partes.length} → ${t.partes.length}`);
      else if (a.assinatura !== t.assinatura) o.push("partes alteradas (variedade, estágio, datas, área, bloco, ambiente ou estimativas)");
      exemplo(t, o.join("; "));
    } else iguais++;
  }
  let retirados = 0;
  for (const [k, a] of atual) {
    if (!novo.has(k)) {
      retirados++;
      exemplo(a, "sai da base (não está no arquivo)");
    }
  }

  // avisos de conferência
  const avisos = [...(lido.avisos ?? [])];
  const lista = (xs) => `${xs.slice(0, 6).join(", ")}${xs.length > 6 ? "…" : ""}`;
  const divergentes = [...novo.values()].filter((t) => t.partes.length > 1 && t.areaTlh > 0 && Math.abs(t.areaTlh - t.somaPartes) > 0.005);
  if (divergentes.length) {
    avisos.push(
      `${divergentes.length} talhão(ões) com a soma das partes diferente da área do talhão — o apontamento usa a área do talhão: ${lista(
        divergentes.map((t) => `${t.propCod}-${t.tlh}${t.letra} (${ha(t.areaTlh)} × partes ${ha(r3(t.somaPartes))})`),
      )}.`,
    );
  }
  const zerados = [...novo.values()].filter((t) => !(t.areaTlh > 0));
  if (zerados.length) {
    avisos.push(
      `${zerados.length} talhão(ões) com Área Talhão 0 — vale a soma das partes: ${lista(zerados.map((t) => `${t.propCod}-${t.tlh}${t.letra} (${ha(r3(t.somaPartes))})`))}.`,
    );
  }
  const porOcupacao = new Map();
  const semOcupacao = [];
  for (const t of novo.values()) {
    const oc = ocupacaoDoTalhao(ocupacoes, t.tlh, t.partes[0]?.parte ?? 1);
    if (!oc) semOcupacao.push(`${t.propCod}-${t.tlh}${t.letra}`);
    const k = oc?.cod ?? "";
    const g = porOcupacao.get(k) ?? { cod: k, descricao: oc?.descricao ?? "Sem ocupação no cadastro", tipo: oc?.tipo ?? "", talhoes: 0, area: 0 };
    g.talhoes++;
    g.area = r3(g.area + areaDoTalhao(t.areaTlh, t.somaPartes));
    porOcupacao.set(k, g);
  }
  if (semOcupacao.length) {
    avisos.push(`${semOcupacao.length} talhão(ões) fora das faixas do cadastro Ocupação: ${lista(semOcupacao)}.`);
  }
  const cadFaz = new Set(
    (await pool.query("SELECT DISTINCT ltrim(split_part(cod, '-', 1), '0') AS k FROM cad_itm WHERE cad = 'fazendas'")).rows.map((r) => r.k),
  );
  if (cadFaz.size > 0) {
    const fora = [...new Set(lido.linhas.map((l) => l.propCod))].filter((c) => !cadFaz.has(normFaz(c)));
    if (fora.length) avisos.push(`${fora.length} fazenda(s) fora do Cadastro de Fazenda (ficam com o nome do relatório): ${lista(fora)}.`);
  }

  const previa = {
    arquivo: { nome: arquivo, safra: saf, emp: lido.emp ?? "", ...resumo },
    base: imp
      ? {
          existe: true,
          arquivo: imp.arquivo,
          talhoes: imp.talhoes,
          partes: imp.partes,
          areaTalhoes: imp.area_tlh,
          atualizadaEm: imp.atu,
          por: imp.atu_usr,
          // a empresa do relatório mudou: há o que gravar mesmo com os talhões iguais
          empAlterada: (imp.emp ?? "") !== (lido.emp ?? ""),
        }
      : { existe: false },
    novos,
    alterados,
    retirados,
    iguais,
    exemplos,
    avisos,
    porOcupacao: [...porOcupacao.values()].sort((a, b) => b.area - a.area),
  };
  if (!aplicar) return previa;
  await gravarSafra(pool, lido, arquivo, usuario, `Safra ${saf} · ${arquivo}`, resumo);
  return { ...previa, aplicado: true };
}

/** Safras importadas (com a última importação) e as ocupações, para os filtros da tela. */
export async function opcoesTalhoes() {
  const pool = getPool();
  await prepararTalhoes(pool);
  const [safras, ocupacoes] = await Promise.all([
    pool.query(
      `SELECT saf, emp, arquivo, fazendas, talhoes, partes, area_tlh::float AS area_tlh, area_parte::float AS area_parte, atu_usr,
              to_char(atu_em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') AS atu
         FROM tlh_saf_imp ORDER BY saf DESC`,
    ),
    ocupacoesDoCadastro(pool),
  ]);
  return {
    safras: safras.rows.map((r) => ({
      safra: r.saf,
      emp: r.emp,
      arquivo: r.arquivo,
      fazendas: r.fazendas,
      talhoes: r.talhoes,
      partes: r.partes,
      areaTalhoes: r.area_tlh,
      areaPartes: r.area_parte,
      atualizadaEm: r.atu,
      por: r.atu_usr,
    })),
    ocupacoes,
  };
}

/** Todas as partes de uma safra, em formato compacto (campos + linhas), com a ocupação de cada uma. */
export async function listarTalhoes(saf) {
  const pool = getPool();
  await prepararTalhoes(pool);
  const [linhas, ocupacoes] = await Promise.all([linhasDaSafra(pool, saf), ocupacoesDoCadastro(pool)]);
  const campos = [...COLUNAS.map((c) => c[0]), "ocupacao"];
  return {
    safra: saf,
    campos,
    linhas: linhas.map((l) => [...COLUNAS.map(([k]) => l[k]), ocupacaoDoTalhao(ocupacoes, l.tlh, l.parte)?.cod ?? ""]),
  };
}

/**
 * Safra da base cuja área vale para a data: a safra do cadastro de Safras cujo ano-safra contém a data (agrícola antes
 * de industrial), se ela foi importada; senão a safra mais recente da base. Sem nenhuma safra importada, null.
 */
export async function safraDaArea(dt, pool = getPool()) {
  await prepararTalhoes(pool);
  const importadas = (await pool.query("SELECT saf FROM tlh_saf_imp ORDER BY saf DESC")).rows.map((r) => r.saf);
  if (importadas.length === 0) return null;
  const data = typeof dt === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dt) ? dt : hojeSP();
  const s = safraDaData(await listSafrasCadastro(), data);
  return s && importadas.includes(s.ano) ? s.ano : importadas[0];
}

/**
 * Talhões de uma fazenda na base da safra da data: [{ tlh, area, ocupacao, producao }] — `tlh` sem zeros à esquerda e
 * com a letra; `producao` diz se a ocupação é área do local de produção. null quando a base está vazia.
 */
export async function talhoesDaBase(faz, dt, pool = getPool()) {
  const saf = await safraDaArea(dt, pool);
  if (saf === null) return null;
  const { rows } = await pool.query(
    `SELECT tlh, letra, MAX(area_tlh)::float AS a, SUM(area_parte)::float AS p, MIN(parte) AS parte
       FROM tlh_saf WHERE saf = $1 AND ltrim(split_part(prop_cod, '-', 1), '0') = $2
      GROUP BY tlh, letra ORDER BY ${ORDEM_TLH}, letra`,
    [saf, normFaz(faz)],
  );
  if (rows.length === 0) return { safra: saf, talhoes: [] };
  const ocupacoes = await ocupacoesDoCadastro(pool);
  return {
    safra: saf,
    talhoes: rows.map((r) => {
      const oc = ocupacaoDoTalhao(ocupacoes, r.tlh, r.parte);
      return { tlh: normTlh(`${r.tlh}${r.letra}`), area: areaDoTalhao(r.a, r.p), ocupacao: oc?.descricao ?? "Sem ocupação no cadastro", producao: ehProducao(oc) };
    }),
  };
}

/** Área da base (safra da data) para os talhões das fazendas dadas: Map "fazenda|talhão" (normalizados) → área. */
export async function areasDaBase(fazendas, dt, pool = getPool()) {
  const saf = await safraDaArea(dt, pool);
  const areas = new Map();
  const ks = [...new Set(fazendas.map(normFaz).filter(Boolean))];
  if (saf === null || ks.length === 0) return { safra: saf, areas };
  const { rows } = await pool.query(
    `SELECT ltrim(split_part(prop_cod, '-', 1), '0') AS k, tlh, letra, MAX(area_tlh)::float AS a, SUM(area_parte)::float AS p
       FROM tlh_saf WHERE saf = $1 AND ltrim(split_part(prop_cod, '-', 1), '0') = ANY($2::text[])
      GROUP BY 1, 2, 3`,
    [saf, ks],
  );
  for (const r of rows) areas.set(`${r.k}|${normTlh(`${r.tlh}${r.letra}`)}`, areaDoTalhao(r.a, r.p));
  return { safra: saf, areas };
}
