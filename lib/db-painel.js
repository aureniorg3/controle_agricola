import { getPool, listMetas, listSafrasCadastro, prepararBanco } from "./db";
import { prepararDosagens } from "./db-dosagens";
import { prepararInsumos } from "./db-insumos";
import { hectaresDoSaldo, round2 } from "./insumos-saldo";
import { addDays, endOfMonth, metaDoDia, metaNoIntervalo, startOfMonth } from "./period";
import { escolherSafraVigente } from "./safra-cadastro";

/** Uma frente na moagem (entrada de cana) até a última data importada. */
const DEPOSITOS_AGRICOLAS = [207, 401];
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const rotuloMes = (mes) => `${MESES[Number(mes.slice(5, 7)) - 1]}/${mes.slice(2, 4)}`;
const FRENTE_ORD = "COALESCE(NULLIF(o.frt, ''), 'Sem frente')";

function canaVazia(ultima) {
  return {
    ultimaData: ultima,
    diaT: 0,
    diaAnteriorT: 0,
    mesT: 0,
    safraT: 0,
    diasEfetivos: 0,
    mediaDiaEfetivoT: 0,
    metaDiaT: 0,
    metaMesT: 0,
    metaSafraT: 0,
    porFrente: [],
    diario: [],
    mensal: [],
    detalhe: null,
  };
}

/**
 * Detalhe das janelas das caixas de moagem e dos cartões das frentes: a entrada de cada dia por frente (desde o início
 * da safra ou do mês, o que vier antes, até a última data; sem arredondar, para as somas baterem com as caixas), as
 * metas e a primeira entrada de cada frente (a janela refaz a meta de qualquer período com as mesmas regras de
 * carregarCana), as ordens de corte do último dia, por fazenda, e o dia anterior com entrega por frente (o mesmo da
 * caixa "Moagem do dia", que pode ser de antes do período carregado, como na virada da safra).
 */
async function carregarDetalheMoagem(pool, { ultima, ini, inicioMes, metas, primeira }) {
  const desde = ini < inicioMes ? ini : inicioMes;
  const porDia = new Map();
  const dias = (
    await pool.query(
      `SELECT e.dt::text AS dt, ${FRENTE_ORD} AS frente, SUM(e.ton)::float AS ton
         FROM ent_dia e LEFT JOIN ord o ON o.num = e.ord_num
        WHERE e.dt >= $1::date AND e.dt <= $2::date GROUP BY 1, 2 ORDER BY 1`,
      [desde, ultima],
    )
  ).rows;
  for (const r of dias) {
    const d = porDia.get(r.dt) ?? { dt: r.dt, porFrente: {} };
    d.porFrente[r.frente] = r.ton;
    porDia.set(r.dt, d);
  }

  const ordensDia = (
    await pool.query(
      `SELECT e.ord_num AS ord, ${FRENTE_ORD} AS frente, e.faz_cod AS faz,
              COALESCE(MAX(t.faz_nm), MAX(o.faz_nm) FILTER (WHERE o.faz_cod = e.faz_cod), '') AS faz_nm,
              string_agg(DISTINCT e.tlh, ', ' ORDER BY e.tlh) FILTER (WHERE e.tlh <> '') AS tlhs,
              SUM(e.vgn)::int AS vgn, SUM(e.ton)::float AS ton
         FROM ent_dia e LEFT JOIN ord o ON o.num = e.ord_num
              LEFT JOIN tlh t ON t.ord_num = e.ord_num AND t.faz_cod = e.faz_cod AND t.tlh = e.tlh
        WHERE e.dt = $1::date
        GROUP BY e.ord_num, 2, e.faz_cod
        ORDER BY SUM(e.ton) DESC`,
      [ultima],
    )
  ).rows.map((r) => ({ ord: r.ord, frente: r.frente, faz: r.faz, fazNm: r.faz_nm, talhoes: r.tlhs ?? "", viagens: r.vgn, ton: r.ton }));

  // dia anterior: a mesma subconsulta do "ant" de carregarCana, sem limite de data
  const ant = (
    await pool.query(
      `SELECT e.dt::text AS dt, ${FRENTE_ORD} AS frente, SUM(e.ton)::float AS ton
         FROM ent_dia e LEFT JOIN ord o ON o.num = e.ord_num
        WHERE e.dt = (SELECT MAX(dt) FROM ent_dia WHERE ton > 0 AND dt < $1::date) GROUP BY 1, 2`,
      [ultima],
    )
  ).rows;
  const anterior = ant.length > 0 ? { dt: ant[0].dt, porFrente: Object.fromEntries(ant.map((r) => [r.frente, r.ton])) } : null;

  return {
    inicio: ini,
    inicioMes,
    dias: Array.from(porDia.values()),
    metas: metas.map((m) => ({ frente: m.frente, metaDiaT: m.metaDiaT, vigencia: m.vigencia, atvIni: m.atvIni, atvFim: m.atvFim })),
    primeira: Object.fromEntries(primeira),
    ordensDia,
    anterior,
  };
}

async function carregarCana(pool, ultima, inicioSafra) {
  const cana = canaVazia(ultima);
  const ini = inicioSafra ?? addDays(ultima, -365);
  const inicioMes = startOfMonth(ultima);
  const metas = await listMetas();
  const frentesComMeta = Array.from(new Set(metas.map((m) => m.frente)));

  // totais e por frente (a "primeira entrada" é de todo o histórico: a meta da frente só conta a partir dela)
  const porFrente = (
    await pool.query(
      `SELECT ${FRENTE_ORD} AS frente,
              COALESCE(SUM(e.ton) FILTER (WHERE e.dt = $1::date), 0)::float AS dia,
              COALESCE(SUM(e.ton) FILTER (WHERE e.dt >= $3::date AND e.dt <= $1::date), 0)::float AS mes,
              COALESCE(SUM(e.ton) FILTER (WHERE e.dt >= $2::date AND e.dt <= $1::date), 0)::float AS saf,
              COUNT(DISTINCT e.dt) FILTER (WHERE e.dt >= $2::date AND e.dt <= $1::date AND e.ton > 0)::int AS dias,
              (MIN(e.dt) FILTER (WHERE e.ton > 0))::text AS primeira
         FROM ent_dia e LEFT JOIN ord o ON o.num = e.ord_num
        WHERE e.dt <= $1::date GROUP BY 1`,
      [ultima, ini, inicioMes],
    )
  ).rows;
  const primeira = new Map(porFrente.filter((r) => r.primeira).map((r) => [r.frente, r.primeira]));
  const metaNoPeriodo = (frente, inicio, fim) => {
    const p = primeira.get(frente);
    if (!p) return 0;
    const i = inicio > p ? inicio : p;
    return i > fim ? 0 : metaNoIntervalo(metas, frente, { inicio: i, fim });
  };
  const metaNoDia = (frente, dia) => {
    const p = primeira.get(frente);
    return p && dia >= p ? metaDoDia(metas, frente, dia) : 0;
  };

  const totais = (
    await pool.query(
      `SELECT COALESCE(SUM(ton) FILTER (WHERE dt = $1::date), 0)::float AS dia,
              COALESCE(SUM(ton) FILTER (WHERE dt = (SELECT MAX(dt) FROM ent_dia WHERE ton > 0 AND dt < $1::date)), 0)::float AS ant,
              COALESCE(SUM(ton) FILTER (WHERE dt >= $3::date AND dt <= $1::date), 0)::float AS mes,
              COALESCE(SUM(ton) FILTER (WHERE dt >= $2::date AND dt <= $1::date), 0)::float AS saf,
              COUNT(DISTINCT dt) FILTER (WHERE dt >= $2::date AND dt <= $1::date AND ton > 0)::int AS dias
         FROM ent_dia`,
      [ultima, ini, inicioMes],
    )
  ).rows[0];
  cana.diaT = round2(totais.dia);
  cana.diaAnteriorT = round2(totais.ant);
  cana.mesT = round2(totais.mes);
  cana.safraT = round2(totais.saf);
  cana.diasEfetivos = totais.dias;
  cana.mediaDiaEfetivoT = totais.dias > 0 ? round2(totais.saf / totais.dias) : 0;
  cana.metaDiaT = round2(frentesComMeta.reduce((a, f) => a + metaNoDia(f, ultima), 0));
  cana.metaMesT = round2(frentesComMeta.reduce((a, f) => a + metaNoPeriodo(f, inicioMes, ultima), 0));
  cana.metaSafraT = round2(frentesComMeta.reduce((a, f) => a + metaNoPeriodo(f, ini, ultima), 0));

  // últimos 30 dias corridos, por frente (os dias sem entrega entram com zero)
  const dias30 = Array.from({ length: 30 }, (_, k) => addDays(ultima, k - 29));
  const diarioRows = (
    await pool.query(
      `SELECT e.dt::text AS dt, ${FRENTE_ORD} AS frente, SUM(e.ton)::float AS ton
         FROM ent_dia e LEFT JOIN ord o ON o.num = e.ord_num
        WHERE e.dt >= $1::date AND e.dt <= $2::date GROUP BY 1, 2`,
      [dias30[0], ultima],
    )
  ).rows;
  const porDia = new Map();
  for (const r of diarioRows) {
    const d = porDia.get(r.dt) ?? {};
    d[r.frente] = round2((d[r.frente] ?? 0) + r.ton);
    porDia.set(r.dt, d);
  }
  cana.diario = dias30.map((dt) => {
    const f = porDia.get(dt) ?? {};
    return {
      dt,
      total: round2(Object.values(f).reduce((a, b) => a + b, 0)),
      porFrente: f,
      metaT: round2(frentesComMeta.reduce((a, fr) => a + metaNoDia(fr, dt), 0)),
    };
  });

  // melhor dia de cada frente na safra
  const melhores = new Map();
  (
    await pool.query(
      `SELECT DISTINCT ON (frente) frente, dt::text AS dt, ton FROM (
         SELECT ${FRENTE_ORD} AS frente, e.dt, SUM(e.ton)::float AS ton
           FROM ent_dia e LEFT JOIN ord o ON o.num = e.ord_num
          WHERE e.dt >= $1::date AND e.dt <= $2::date GROUP BY 1, 2) x
        ORDER BY frente, ton DESC`,
      [ini, ultima],
    )
  ).rows.forEach((r) => melhores.set(r.frente, { dt: r.dt, ton: round2(r.ton) }));

  cana.porFrente = porFrente
    .filter((r) => r.saf > 0 || r.dia > 0)
    .map((r) => ({
      frente: r.frente,
      diaT: round2(r.dia),
      mesT: round2(r.mes),
      safraT: round2(r.saf),
      diasEfetivos: r.dias,
      mediaDiaEfetivoT: r.dias > 0 ? round2(r.saf / r.dias) : 0,
      participacao: totais.saf > 0 ? r.saf / totais.saf : 0,
      metaDiaT: round2(metaNoDia(r.frente, ultima)),
      metaMesT: round2(metaNoPeriodo(r.frente, inicioMes, ultima)),
      metaSafraT: round2(metaNoPeriodo(r.frente, ini, ultima)),
      serie: cana.diario.slice(-14).map((d) => d.porFrente[r.frente] ?? 0),
      melhorDia: melhores.get(r.frente) ?? null,
    }))
    .sort((a, b) => b.safraT - a.safraT);

  // moagem mensal: do primeiro mês com entrada na safra até o mês da última data (meses sem entrega ficam com zero)
  const iniMensal = ini > addDays(ultima, -400) ? ini : addDays(ultima, -400);
  const mesRows = (
    await pool.query(
      `SELECT to_char(dt, 'YYYY-MM') AS mes, SUM(ton)::float AS ton, COUNT(DISTINCT dt) FILTER (WHERE ton > 0)::int AS dias
         FROM ent_dia WHERE dt >= $1::date AND dt <= $2::date GROUP BY 1 ORDER BY 1`,
      [iniMensal, ultima],
    )
  ).rows.filter((r) => r.ton > 0);
  if (mesRows.length > 0) {
    const porMes = new Map(mesRows.map((r) => [r.mes, r]));
    let mes = mesRows[0].mes;
    const ultimoMes = ultima.slice(0, 7);
    while (mes <= ultimoMes) {
      const r = porMes.get(mes);
      const inicioM = `${mes}-01`;
      const fimM = endOfMonth(inicioM) < ultima ? endOfMonth(inicioM) : ultima;
      const meta = round2(frentesComMeta.reduce((a, f) => a + metaNoPeriodo(f, inicioM, fimM), 0));
      cana.mensal.push({
        mes,
        rotulo: rotuloMes(mes),
        ton: round2(r?.ton ?? 0),
        dias: r?.dias ?? 0,
        mediaDiaT: r && r.dias > 0 ? round2(r.ton / r.dias) : 0,
        metaT: meta > 0 ? meta : null,
        parcial: mes === ultimoMes && ultima < endOfMonth(inicioM),
      });
      mes = addDays(endOfMonth(inicioM), 1).slice(0, 7);
    }
  }

  cana.detalhe = await carregarDetalheMoagem(pool, { ultima, ini, inicioMes, metas, primeira });
  return cana;
}

async function carregarInsumos(pool) {
  const insumos = {
    dtBase: null,
    valor: 0,
    variacao: null,
    dtAnterior: null,
    porEmpresa: [],
    porEmpresaAnterior: [],
    porGrupo: [],
    emprestimosAbertos: { n: 0, valor: 0, lista: [] },
    grupos: [],
    capacidade: [],
    cobertura: { comSaldo: 0, comDosagem: 0 },
  };
  try {
    await Promise.all([prepararInsumos(pool), prepararDosagens(pool)]);
  } catch {
    return insumos; // sem as tabelas do módulo o painel segue com o resto
  }

  const dts = (await pool.query("SELECT DISTINCT dt::text AS d FROM ins_sld ORDER BY 1 DESC LIMIT 2")).rows;
  if (dts[0]) {
    insumos.dtBase = dts[0].d;
    insumos.dtAnterior = dts[1]?.d ?? null;
    const v = await pool.query(
      `SELECT dt::text AS dt, emp, SUM(saldo * custo)::float AS valor FROM ins_sld
        WHERE dt = ANY($1::date[]) AND almx = ANY($2::int[]) GROUP BY dt, emp`,
      [dts.map((x) => x.d), DEPOSITOS_AGRICOLAS],
    );
    const atual = v.rows.filter((x) => x.dt === dts[0].d);
    insumos.porEmpresa = atual.map((x) => ({ emp: x.emp, valor: round2(x.valor) })).sort((a, b) => a.emp - b.emp);
    insumos.valor = round2(atual.reduce((a, x) => a + x.valor, 0));
    if (dts[1]) insumos.variacao = round2(insumos.valor - v.rows.filter((x) => x.dt === dts[1].d).reduce((a, x) => a + x.valor, 0));
    // janela do saldo contábil: o retrato anterior por empresa (a variação de cada uma) ...
    if (dts[1]) {
      insumos.porEmpresaAnterior = v.rows
        .filter((x) => x.dt === dts[1].d)
        .map((x) => ({ emp: x.emp, valor: round2(x.valor) }))
        .sort((a, b) => a.emp - b.emp);
    }
    // ... e todos os grupos por empresa, com os itens sem cadastro em "Sem grupo" (a soma bate com o saldo contábil)
    insumos.porGrupo = (
      await pool.query(
        `WITH it AS (
           SELECT i.grp, i.grp_ds, s.cod, s.emp, SUM(s.saldo * s.custo) AS valor
             FROM ins_sld s LEFT JOIN ins_itm i ON i.cod = s.cod
            WHERE s.dt = $1::date AND s.almx = ANY($2::int[])
            GROUP BY i.grp, i.grp_ds, s.cod, s.emp
         ), ge AS (
           SELECT grp, grp_ds, emp, SUM(valor) AS valor FROM it GROUP BY grp, grp_ds, emp
         )
         SELECT ge.grp, ge.grp_ds AS ds, jsonb_object_agg(ge.emp::text, ge.valor::float) AS por_emp, SUM(ge.valor)::float AS valor,
                (SELECT COUNT(DISTINCT it.cod) FROM it
                  WHERE it.grp IS NOT DISTINCT FROM ge.grp AND it.grp_ds IS NOT DISTINCT FROM ge.grp_ds AND it.valor > 0)::int AS itens
           FROM ge GROUP BY ge.grp, ge.grp_ds ORDER BY SUM(ge.valor) DESC`,
        [dts[0].d, DEPOSITOS_AGRICOLAS],
      )
    ).rows
      .filter((r) => Object.values(r.por_emp).some((x) => x !== 0))
      .map((r) => ({
        grp: r.grp?.trim() ?? "",
        ds: r.ds?.trim() || (r.grp?.trim() ? `Grupo ${r.grp.trim()}` : "Sem grupo"),
        porEmpresa: Object.fromEntries(Object.entries(r.por_emp).map(([emp, valor]) => [emp, round2(valor)])),
        valor: round2(r.valor),
        itens: r.itens,
      }));

    // maiores grupos por valor, com o maior insumo de cada um
    insumos.grupos = (
      await pool.query(
        `WITH it AS (
           SELECT i.grp, i.grp_ds, s.cod, i.ds, SUM(s.saldo * s.custo) AS valor
             FROM ins_sld s JOIN ins_itm i ON i.cod = s.cod
            WHERE s.dt = $1::date AND s.almx = ANY($2::int[])
            GROUP BY i.grp, i.grp_ds, s.cod, i.ds HAVING SUM(s.saldo * s.custo) > 0
         ), g AS (
           SELECT grp, grp_ds, SUM(valor) AS valor, COUNT(*)::int AS itens FROM it GROUP BY grp, grp_ds
         )
         SELECT g.grp, g.grp_ds AS ds, g.valor::float AS valor, g.itens,
                (SELECT ds FROM it WHERE it.grp = g.grp ORDER BY valor DESC LIMIT 1) AS maior,
                (SELECT valor FROM it WHERE it.grp = g.grp ORDER BY valor DESC LIMIT 1)::float AS maior_valor
           FROM g ORDER BY g.valor DESC LIMIT 6`,
        [dts[0].d, DEPOSITOS_AGRICOLAS],
      )
    ).rows.map((r) => ({ grp: r.grp.trim(), ds: r.ds.trim(), valor: round2(r.valor), itens: r.itens, maior: r.maior, maiorValor: round2(r.maior_valor ?? 0) }));

    // capacidade de aplicação: saldo ÷ dosagem por hectare, dos insumos de maior valor que têm dosagem
    const cap = await pool.query(
      `SELECT s.cod, i.ds, i.un, SUM(s.saldo)::float AS qtd, d.dmin::float AS dmin, d.dmax::float AS dmax
         FROM ins_sld s JOIN ins_itm i ON i.cod = s.cod JOIN ins_dos d ON d.cod = s.cod
        WHERE s.dt = $1::date AND s.almx = ANY($2::int[]) AND s.saldo > 0
        GROUP BY s.cod, i.ds, i.un, d.dmin, d.dmax
       HAVING SUM(s.saldo) > 0
        ORDER BY SUM(s.saldo * s.custo) DESC`,
      [dts[0].d, DEPOSITOS_AGRICOLAS],
    );
    for (const r of cap.rows) {
      if (insumos.capacidade.length >= 6) break;
      const h = hectaresDoSaldo(r.qtd, { min: r.dmin, max: r.dmax });
      if (!h) continue;
      insumos.capacidade.push({ cod: r.cod, ds: r.ds, un: r.un.trim(), qtd: round2(r.qtd), min: r.dmin, max: r.dmax, hDe: h.de, hAte: h.ate });
    }
    const cob = (
      await pool.query(
        `WITH s AS (SELECT cod FROM ins_sld WHERE dt = $1::date AND almx = ANY($2::int[]) GROUP BY cod HAVING SUM(saldo) > 0)
         SELECT COUNT(*)::int AS com_saldo, COUNT(d.cod)::int AS com_dosagem FROM s LEFT JOIN ins_dos d ON d.cod = s.cod`,
        [dts[0].d, DEPOSITOS_AGRICOLAS],
      )
    ).rows[0];
    insumos.cobertura = { comSaldo: cob.com_saldo, comDosagem: cob.com_dosagem };
  }

  const tabelaEmp = (await pool.query("SELECT to_regclass('emp_cab')::text AS t")).rows[0].t;
  if (tabelaEmp) {
    const e = (
      await pool.query(
        `SELECT COUNT(*)::int AS n,
                COALESCE(SUM((SELECT COALESCE(SUM((i->>'vt')::numeric), 0) FROM jsonb_array_elements(itens) i)), 0)::float AS valor
           FROM emp_cab WHERE st = 'Aberto'`,
      )
    ).rows[0];
    // janela da caixa: cada empréstimo em aberto com o valor dos itens (page.jsx tira tudo junto para quem não vê)
    const lista = (
      await pool.query(
        `SELECT id, bol, forn_cod, forn_nm, dt::text AS dt, dt_sol::text AS dt_sol, faz,
                (SELECT COUNT(*) FROM jsonb_array_elements(itens) i)::int AS itens,
                (SELECT COALESCE(SUM((i->>'vt')::numeric), 0) FROM jsonb_array_elements(itens) i)::float AS valor
           FROM emp_cab WHERE st = 'Aberto'
          ORDER BY COALESCE(dt_sol, dt) DESC NULLS LAST, id DESC`,
      )
    ).rows.map((r) => ({
      id: r.id,
      boletim: r.bol,
      fornecedor: r.forn_nm || r.forn_cod,
      dtSol: r.dt_sol,
      dtSaida: r.dt,
      fazendas: (Array.isArray(r.faz) ? r.faz : []).map((f) => (f.nome ? `${f.cod} · ${f.nome}` : f.cod)).join("; "),
      itens: r.itens,
      valor: r.valor,
    }));
    insumos.emprestimosAbertos = { n: e.n, valor: round2(e.valor), lista };
  }
  return insumos;
}

export async function dadosPainel(hoje) {
  const pool = getPool();
  await prepararBanco(pool);
  const vigente = escolherSafraVigente(await listSafrasCadastro(), hoje);
  const maxSaf = (await pool.query("SELECT MAX(saf)::int AS s FROM saf_tlh")).rows[0].s;
  const anoSafra = vigente?.ano ?? maxSaf ?? new Date().getFullYear();
  const inicioSafra = vigente?.producaoInicio ?? null;

  const ultima = (await pool.query("SELECT MAX(dt)::text AS d FROM ent_dia WHERE ton > 0")).rows[0].d;
  const cana = ultima ? await carregarCana(pool, ultima, inicioSafra) : canaVazia(null);
  const insumos = await carregarInsumos(pool);

  // ---- rodadas de campo --------------------------------------------------
  const rod = await pool.query(
    `SELECT b.rod, COUNT(DISTINCT b.bol)::int AS boletins, COALESCE(SUM(i.area), 0)::float AS area, MAX(b.dt)::text AS ultima
       FROM rod_bol b LEFT JOIN rod_itm i ON i.bol = b.bol GROUP BY b.rod ORDER BY b.rod DESC LIMIT 6`,
  );
  const rodadas = { porRodada: rod.rows.map((r) => ({ rod: r.rod, boletins: r.boletins, areaHa: round2(r.area), ultimaData: r.ultima })).reverse() };

  // ---- comparativo de safra: estimado x realizado ------------------------
  const sc = await pool.query(
    `SELECT saf,
            COALESCE(SUM(prod_est) FILTER (WHERE prod_est > 0), 0)::float AS est,
            COALESCE(SUM(prod_atu) FILTER (WHERE prod_atu > 0), 0)::float AS real,
            COALESCE(SUM(area_tot), 0)::float AS area_t,
            COALESCE(SUM(area_col), 0)::float AS ac,
            (SUM(prod_est) FILTER (WHERE prod_est > 0) / NULLIF(SUM(area_tot) FILTER (WHERE prod_est > 0), 0))::float AS te,
            (SUM(prod_atu) FILTER (WHERE prod_atu > 0) / NULLIF(SUM(area_col) FILTER (WHERE prod_atu > 0), 0))::float AS tr
       FROM saf_tlh GROUP BY saf ORDER BY saf DESC LIMIT 3`,
  );
  const safraComparativo = sc.rows
    .map((r) => ({
      safra: r.saf,
      estimadoT: round2(r.est),
      realizadoT: round2(r.real),
      tchEstimado: r.te === null ? null : round2(r.te),
      tchRealizado: r.tr === null ? null : round2(r.tr),
      areaTotalHa: round2(r.area_t),
      areaColhidaHa: round2(r.ac),
    }))
    .reverse();

  // janela da caixa "Safra: estimado e realizado": a safra das caixas (a mesma escolha de PainelView), por fazenda,
  // sem arredondar e com as áreas de cada TCH (as somas e os TCH do total batem com os da caixa)
  const atual = safraComparativo.find((s) => s.safra === anoSafra) ?? safraComparativo[safraComparativo.length - 1];
  const safraFazendas = { safra: atual?.safra ?? null, fazendas: [] };
  if (atual) {
    safraFazendas.fazendas = (
      await pool.query(
        `SELECT faz_cod, MAX(faz_nm) AS faz_nm, COUNT(DISTINCT tlh)::int AS tlhs,
                COALESCE(SUM(area_tot), 0)::float AS area_t,
                COALESCE(SUM(area_tot) FILTER (WHERE prod_est > 0), 0)::float AS area_e,
                COALESCE(SUM(prod_est) FILTER (WHERE prod_est > 0), 0)::float AS est,
                COALESCE(SUM(area_col), 0)::float AS ac,
                COALESCE(SUM(area_col) FILTER (WHERE prod_atu > 0), 0)::float AS area_r,
                COALESCE(SUM(prod_atu) FILTER (WHERE prod_atu > 0), 0)::float AS real
           FROM saf_tlh WHERE saf = $1 GROUP BY faz_cod ORDER BY faz_cod`,
        [atual.safra],
      )
    ).rows.map((r) => ({
      faz: r.faz_cod,
      fazNm: r.faz_nm,
      talhoes: r.tlhs,
      areaTotalHa: r.area_t,
      areaEstimadoHa: r.area_e,
      estimadoT: r.est,
      areaColhidaHa: r.ac,
      areaRealizadoHa: r.area_r,
      realizadoT: r.real,
    }));
  }

  return {
    safra: { ano: anoSafra, rotulo: vigente ? `${vigente.tipo} ${vigente.ano}` : String(anoSafra), inicio: inicioSafra },
    cana,
    insumos,
    rodadas,
    safraComparativo,
    safraFazendas,
    realizadoAteHojeT: cana.safraT,
  };
}
