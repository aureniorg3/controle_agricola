import { getPool, historicoTchPorOrdem, listSafrasCadastro, prepararBanco } from "./db";
import { carregarCadastrosExportados } from "./db-cadastros-carga";
import { normFaz } from "./ocupacao";
import { aplicarCorteERateio } from "./rateio";
import { escolherSafraVigente } from "./safra-cadastro";

/**
 * Moagem › Dashboard: as bases do painel separadas pelo Tipo de Propriedade da fazenda (Cadastro de Fazenda, coluna
 * "Tipo"), para o filtro da tela, e as ordens de corte da safra atual (caixas Área com ordem de corte, Ordens abertas,
 * Ordens encerradas e Produção). O filtro é aplicado no navegador: cada linha já sai daqui com o tipo da fazenda.
 */

/** tipo das linhas cuja fazenda não tem tipo no Cadastro de Fazenda (ou nem está nele) */
export const SEM_TIPO = "Sem tipo no cadastro";

/** fazenda sem a sequência e sem zeros à esquerda, no SQL (o mesmo que normFaz de lib/ocupacao) */
const FAZ_SQL = (col) => `regexp_replace(btrim(split_part(btrim(${col}), '-', 1)), '^0+(?=[0-9])', '')`;
const chaveFaz = (cod) => normFaz(cod).trim();
const semZeros = (c) =>
  String(c ?? "")
    .trim()
    .replace(/^0+(?=\d)/, "");
/** sem acento, maiúsculas e espaços simples ("Próprio" = "PROPRIO") */
const comparavel = (s) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
const porCodigo = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });

/**
 * Tipo de Propriedade de cada fazenda (código sem a sequência → tipo). Vem da coluna "Classificação Proprietário" do
 * Cadastro de Fazenda (P, R, F…), com a descrição do cadastro Tipo Propriedade quando ele tem o item (senão, o próprio
 * código). Grafias que só mudam acento ou caixa ("PRÓPRIO" e "Próprio") viram um
 * tipo só. Fazenda com mais de uma sequência: a que tem tipo, depois a principal (sem "-"), depois o menor código.
 */
async function tiposDasFazendas(pool) {
  // carga inicial do Tipo Propriedade (P, R, F), para os códigos já virem com a descrição
  await carregarCadastrosExportados(pool);
  const [{ rows: fazendas }, { rows: tipos }] = await Promise.all([
    pool.query(
      `SELECT cod, nm, dds->>'classificacao_proprietario' AS tp, '' AS tp_nm
         FROM cad_itm WHERE cad = 'fazendas'`,
    ),
    pool.query("SELECT cod, nm FROM cad_itm WHERE cad = 'tipo-propriedade' AND btrim(nm) <> ''"),
  ]);
  const doCadastro = new Map();
  const rotulos = new Map();
  for (const t of [...tipos].sort((a, b) => porCodigo(a.cod, b.cod))) {
    const nm = t.nm.trim();
    doCadastro.set(`c:${semZeros(t.cod)}`, nm);
    doCadastro.set(`n:${comparavel(nm)}`, nm);
    if (!rotulos.has(comparavel(nm))) rotulos.set(comparavel(nm), nm);
  }
  const rotulo = (bruto) => {
    const v = String(bruto ?? "").trim();
    if (!v) return "";
    const nm = doCadastro.get(`c:${semZeros(v)}`) ?? doCadastro.get(`n:${comparavel(v)}`) ?? v;
    if (!rotulos.has(comparavel(nm))) rotulos.set(comparavel(nm), nm);
    return rotulos.get(comparavel(nm));
  };

  const lista = [...fazendas]
    .sort((a, b) => porCodigo(a.cod, b.cod))
    .map((f) => ({
      k: chaveFaz(f.cod),
      cod: String(f.cod),
      nome: String(f.nm ?? "").trim(),
      tipo: rotulo(f.tp_nm) || rotulo(f.tp),
      principal: !String(f.cod).includes("-"),
    }))
    .filter((f) => f.k)
    .sort((a, b) => Number(!a.tipo) - Number(!b.tipo) || Number(b.principal) - Number(a.principal) || porCodigo(a.cod, b.cod));
  const porFazenda = new Map();
  for (const f of lista) if (!porFazenda.has(f.k)) porFazenda.set(f.k, f);
  const chaves = [...porFazenda.keys()];
  return {
    porFazenda,
    chaves,
    tipos: chaves.map((k) => porFazenda.get(k).tipo || SEM_TIPO),
    tipoDe: (cod) => porFazenda.get(chaveFaz(cod))?.tipo || SEM_TIPO,
  };
}

/* ---------- Histórico de Safras (saf_tlh) por tipo de propriedade ---------- */

/** as mesmas dimensões de agregarSafras (lib/db.js); a safra inteira agrupa só por safra e tipo */
const EXPR_DIMENSAO = {
  safra: null,
  fazenda: "faz_cod || ' - ' || faz_nm",
  proprietario: "prp_nm",
  municipio: "mun",
  variedade: "var_nm",
  corte: "cor::text",
};
const SOMAS_SAFRA = `SUM(area_tot) AS area_tot,
            COALESCE(SUM(area_col) FILTER (WHERE prod_atu > 0), 0) AS area_col,
            COALESCE(SUM(prod_atu) FILTER (WHERE prod_atu > 0), 0) AS prod`;

/**
 * As agregações de agregarSafras e agregarVariedadeCorte (mesmas regras: área colhida e produção só das linhas com
 * produção), separadas também pelo tipo de propriedade da fazenda do talhão. Sem os TCH: a tela soma os tipos do filtro
 * e calcula o TCH do total, como agregarSafras.
 */
async function agregarSafrasPorTipo(pool, mapa) {
  const params = [mapa.chaves, mapa.tipos, SEM_TIPO];
  const base = `WITH tp AS (SELECT * FROM unnest($1::text[], $2::text[]) AS m(k, tipo)),
       s AS (SELECT x.*, COALESCE(tp.tipo, $3::text) AS tipo FROM saf_tlh x LEFT JOIN tp ON tp.k = ${FAZ_SQL("x.faz_cod")})`;
  const dimensoes = Object.entries(EXPR_DIMENSAO).map(async ([dim, expr]) => {
    const { rows } = await pool.query(
      `${base}
       SELECT saf, tipo, ${expr ?? "'Total'"} AS chave, ${SOMAS_SAFRA}, SUM(prod_est) AS prod_est
         FROM s GROUP BY saf, tipo${expr ? `, ${expr}` : ""}`,
      params,
    );
    return [
      dim,
      rows.map((r) => ({
        safra: r.saf,
        tipo: r.tipo,
        chave: r.chave,
        areaTot: r.area_tot,
        areaColhida: r.area_col,
        producaoT: r.prod,
        producaoEstT: r.prod_est ?? 0,
      })),
    ];
  });
  const variedadeCorte = pool
    .query(`${base} SELECT saf, tipo, var_nm, cor, ${SOMAS_SAFRA} FROM s GROUP BY saf, tipo, var_nm, cor`, params)
    .then(({ rows }) =>
      rows.map((r) => ({
        safra: r.saf,
        tipo: r.tipo,
        variedade: r.var_nm,
        corte: r.cor,
        areaTot: r.area_tot,
        areaColhida: r.area_col,
        producaoT: r.prod,
      })),
    );
  const [lista, vc] = await Promise.all([Promise.all(dimensoes), variedadeCorte]);
  return { ...Object.fromEntries(lista), variedadeCorte: vc };
}

/* ---------- Ordens de corte da safra atual ---------- */

/**
 * Ordens de corte da safra atual, uma linha por ordem × fazenda (a ordem pode ter talhões de mais de uma fazenda), com o
 * tipo de propriedade da fazenda. As mesmas regras da tela Ordens de Corte:
 *  - safra: a base de ordens é sempre o retrato da safra importada (o rótulo mais recente, se houver mais de um); a
 *    produção conta só as pesagens dentro do período de produção da safra vigente (Cadastros › Safras);
 *  - área da ordem = soma da área dos talhões; área colhida = saldo lançado no talhão + o apontado dia a dia até hoje;
 *    a colher = área − colhida, só nas ordens abertas;
 *  - a entrada sem talhão (ordem em aberto) é rateada entre os talhões da ordem por TCH estimado × área
 *    (aplicarCorteERateio), e assim cai na fazenda do talhão; ordem sem talhão fica com a fazenda da pesagem (ou a da
 *    ordem, quando a pesagem não traz fazenda);
 *  - TCH = produção dos talhões com área colhida apontada ÷ essa área (calcProducaoAreaColhida).
 */
async function ordensDaSafra(pool, mapa, hoje) {
  const vigente = escolherSafraVigente(await listSafrasCadastro(), hoje);
  const producao = vigente ? { inicio: vigente.producaoInicio, fim: vigente.producaoFim, rotulo: `${vigente.tipo} ${vigente.ano}` } : null;
  const { rows: rotulos } = await pool.query("SELECT DISTINCT saf_lbl FROM ord");
  const rotulo = rotulos.map((r) => r.saf_lbl).sort((a, b) => (parseInt(b, 10) || 0) - (parseInt(a, 10) || 0) || String(b).localeCompare(String(a)))[0];
  if (rotulo === undefined) return { rotulo: null, producao, ordens: 0, linhas: [] };

  const [{ rows: ords }, { rows: tlhs }, { rows: ents }, historico] = await Promise.all([
    pool.query("SELECT num, frt, faz_cod, faz_nm, sts FROM ord WHERE saf_lbl = $1", [rotulo]),
    pool.query(
      `SELECT t.ord_num, t.faz_cod, t.faz_nm, t.tlh, t.area_ha, t.area_col_ha, COALESCE(c.area, 0) AS col_dias
         FROM tlh t JOIN ord o ON o.num = t.ord_num AND o.saf_lbl = $1
         LEFT JOIN (SELECT ord_num, faz_cod, tlh, SUM(area) AS area FROM col_dia WHERE dt <= $2::date GROUP BY 1, 2, 3) c
                ON c.ord_num = t.ord_num AND c.faz_cod = t.faz_cod AND c.tlh = t.tlh`,
      [rotulo, hoje],
    ),
    pool.query(
      `SELECT e.ord_num, e.faz_cod, e.tlh, SUM(e.ton) AS ton, (MAX(e.dt) FILTER (WHERE e.ton > 0))::text AS ultima
         FROM ent_dia e JOIN ord o ON o.num = e.ord_num AND o.saf_lbl = $1
        WHERE ($2::date IS NULL OR e.dt >= $2::date) AND ($3::date IS NULL OR e.dt <= $3::date)
        GROUP BY e.ord_num, e.faz_cod, e.tlh`,
      [rotulo, producao?.inicio ?? null, producao?.fim ?? null],
    ),
    historicoTchPorOrdem(parseInt(rotulo, 10) || new Date().getFullYear()),
  ]);

  const talhoesPorOrdem = new Map();
  for (const t of tlhs) {
    const l = talhoesPorOrdem.get(t.ord_num) ?? [];
    l.push({
      fazendaCodigo: t.faz_cod,
      fazendaNome: t.faz_nm,
      talhao: t.tlh,
      areaHa: t.area_ha,
      // como aplicarAreaColhidaDia (lib/rateio): o acumulado do talhão em centésimos
      areaColhidaHa: Math.round((t.area_col_ha + t.col_dias) * 100) / 100,
    });
    talhoesPorOrdem.set(t.ord_num, l);
  }
  // entradas da ordem somadas por fazenda + talhão (o rateio é proporcional, então dá o mesmo que dia a dia)
  const entradasPorOrdem = new Map();
  const ultimaPorOrdem = new Map();
  for (const e of ents) {
    const l = entradasPorOrdem.get(e.ord_num) ?? [];
    l.push({ data: "", fazendaCodigo: e.faz_cod, talhao: e.tlh, toneladas: e.ton, toneladasAte6h: 0, toneladasAte12h: 0, toneladasAte18h: 0, viagens: 0 });
    entradasPorOrdem.set(e.ord_num, l);
    if (e.ultima && e.ultima > (ultimaPorOrdem.get(e.ord_num) ?? "")) ultimaPorOrdem.set(e.ord_num, e.ultima);
  }

  const linhas = new Map();
  for (const o of ords) {
    const nomeDe = (cod, nm) =>
      nm || (chaveFaz(cod) === chaveFaz(o.faz_cod) ? o.faz_nm : "") || mapa.porFazenda.get(chaveFaz(cod))?.nome || "";
    const linha = (cod, nm) => {
      const k = `${o.num}|${chaveFaz(cod)}`;
      if (!linhas.has(k)) {
        linhas.set(k, {
          ord: o.num,
          frente: o.frt || "Sem frente",
          sts: o.sts,
          faz: String(cod ?? "").trim(),
          fazNm: nomeDe(cod, nm),
          tipo: mapa.tipoDe(cod),
          talhoes: 0,
          areaHa: 0,
          colhidaHa: 0,
          aColherHa: 0,
          t: 0,
          tColhidos: 0,
          ultima: ultimaPorOrdem.get(o.num) ?? "",
        });
      }
      return linhas.get(k);
    };
    const talhoes = talhoesPorOrdem.get(o.num) ?? [];
    for (const t of talhoes) {
      const l = linha(t.fazendaCodigo, t.fazendaNome);
      l.talhoes += 1;
      l.areaHa += t.areaHa;
      l.colhidaHa += t.areaColhidaHa;
    }
    const colhidos = new Set(talhoes.filter((t) => t.areaColhidaHa > 0).map((t) => `${t.fazendaCodigo}|${t.talhao}`));
    const { entradas } = aplicarCorteERateio(
      { numero: o.num, talhoes, entradas: entradasPorOrdem.get(o.num) ?? [] },
      null,
      24,
      historico.estPorTalhao?.[o.num],
    );
    for (const e of entradas) {
      const semFazenda = ["", "-"].includes(String(e.fazendaCodigo ?? "").trim());
      const l = linha(semFazenda ? o.faz_cod : e.fazendaCodigo, "");
      l.t += e.toneladas;
      if (colhidos.has(`${e.fazendaCodigo}|${e.talhao}`)) l.tColhidos += e.toneladas;
    }
    // ordem sem talhão e sem pesagem: entra com a fazenda da ordem (conta nas ordens, sem área)
    if (talhoes.length === 0 && entradas.length === 0) linha(o.faz_cod, o.faz_nm);
  }
  for (const l of linhas.values()) l.aColherHa = l.sts === "Aberta" ? Math.max(0, l.areaHa - l.colhidaHa) : 0;

  return {
    rotulo,
    producao,
    ordens: ords.length,
    linhas: [...linhas.values()].sort((a, b) => porCodigo(a.ord, b.ord) || porCodigo(a.faz, b.faz)),
  };
}

/**
 * Dados do Moagem › Dashboard por tipo de propriedade: as opções do filtro (os tipos do Cadastro de Fazenda, com
 * "Sem tipo no cadastro" quando há fazenda sem tipo ou fora do cadastro), o Histórico de Safras separado por tipo e as
 * ordens de corte da safra atual. `hoje` = data de hoje (AAAA-MM-DD) em America/Sao_Paulo.
 */
export async function dadosPainelColheita(hoje) {
  const pool = getPool();
  await prepararBanco(pool);
  const mapa = await tiposDasFazendas(pool);
  const [porTipo, ordensSafra] = await Promise.all([agregarSafrasPorTipo(pool, mapa), ordensDaSafra(pool, mapa, hoje)]);

  const fazendasPorTipo = new Map();
  for (const f of mapa.porFazenda.values()) {
    const t = f.tipo || SEM_TIPO;
    fazendasPorTipo.set(t, (fazendasPorTipo.get(t) ?? 0) + 1);
  }
  const semTipoNosDados = porTipo.safra.some((r) => r.tipo === SEM_TIPO) || ordensSafra.linhas.some((l) => l.tipo === SEM_TIPO);
  const qtdFaz = (n) => `${n.toLocaleString("pt-BR")} ${n === 1 ? "fazenda" : "fazendas"}`;
  const tipos = [...fazendasPorTipo.entries()]
    .filter(([t]) => t !== SEM_TIPO)
    .sort(([a], [b]) => a.localeCompare(b, "pt-BR"))
    .map(([t, n]) => ({ cod: t, nome: qtdFaz(n) }));
  if (fazendasPorTipo.has(SEM_TIPO) || semTipoNosDados) {
    tipos.push({ cod: SEM_TIPO, nome: "fazenda sem tipo ou fora do cadastro" });
  }
  return { tipos, porTipo, ordensSafra };
}
