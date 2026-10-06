import type { Pool } from "pg";
import { getPool, listMetas, listSafrasCadastro, prepararBanco } from "./db";
import { prepararDosagens } from "./db-dosagens";
import { prepararInsumos } from "./db-insumos";
import { hectaresDoSaldo, round2 } from "./insumos-saldo";
import { addDays, endOfMonth, metaDoDia, metaNoIntervalo, startOfMonth } from "./period";
import { escolherSafraVigente } from "./safra-cadastro";
import type { MetaFrente } from "./types";

/** Uma frente na moagem (entrada de cana) até a última data importada. */
export interface FrenteCana {
  frente: string;
  diaT: number;
  mesT: number;
  safraT: number;
  diasEfetivos: number;
  /** safra ÷ dias com entrega */
  mediaDiaEfetivoT: number;
  /** fatia da frente na safra (0 a 1) */
  participacao: number;
  /** metas acumuladas até a última data; 0 quando a frente não tem meta */
  metaDiaT: number;
  metaMesT: number;
  metaSafraT: number;
  /** últimos 14 dias, do mais antigo ao mais novo (0 nos dias sem entrega) */
  serie: number[];
  melhorDia: { dt: string; ton: number } | null;
}

export interface DiaCana {
  dt: string;
  total: number;
  porFrente: Record<string, number>;
  /** soma das metas diárias das frentes nesse dia (0 sem meta) */
  metaT: number;
}

export interface MesCana {
  mes: string;
  rotulo: string;
  ton: number;
  dias: number;
  mediaDiaT: number;
  /** meta do mês até a última data (ou o mês todo, se já terminou); null sem metas */
  metaT: number | null;
  /** o mês da última data ainda não terminou */
  parcial: boolean;
}

export interface DadosPainel {
  safra: { ano: number; rotulo: string; inicio: string | null };
  cana: {
    ultimaData: string | null;
    diaT: number;
    diaAnteriorT: number;
    mesT: number;
    safraT: number;
    diasEfetivos: number;
    mediaDiaEfetivoT: number;
    metaDiaT: number;
    metaMesT: number;
    metaSafraT: number;
    porFrente: FrenteCana[];
    /** últimos 30 dias corridos (inclui os dias sem entrega) */
    diario: DiaCana[];
    mensal: MesCana[];
  };
  insumos: {
    dtBase: string | null;
    /** saldo contábil: valor do estoque (saldo × custo médio) nos depósitos agrícolas */
    valor: number;
    variacao: number | null;
    dtAnterior: string | null;
    porEmpresa: { emp: number; valor: number }[];
    emprestimosAbertos: { n: number; valor: number };
    /** maiores grupos por valor, com o maior insumo de cada um */
    grupos: { grp: string; ds: string; valor: number; itens: number; maior: string | null; maiorValor: number }[];
    /** capacidade de aplicação: hectares que o saldo cobre (saldo ÷ dosagem), dos insumos de maior valor com dosagem */
    capacidade: { cod: string; ds: string; un: string; qtd: number; min: number | null; max: number | null; hDe: number; hAte: number | null }[];
    cobertura: { comSaldo: number; comDosagem: number };
  };
  rodadas: {
    porRodada: { rod: number; boletins: number; areaHa: number; ultimaData: string | null }[];
  };
  safraComparativo: {
    safra: number;
    estimadoT: number;
    realizadoT: number;
    tchEstimado: number | null;
    tchRealizado: number | null;
    areaTotalHa: number;
    areaColhidaHa: number;
  }[];
  /** entrada de cana acumulada da safra atual (t) — o "realizado" até hoje, para comparar com o estimado */
  realizadoAteHojeT: number;
}

const DEPOSITOS_AGRICOLAS = [207, 401];
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const rotuloMes = (mes: string) => `${MESES[Number(mes.slice(5, 7)) - 1]}/${mes.slice(2, 4)}`;
const FRENTE_ORD = "COALESCE(NULLIF(o.frt, ''), 'Sem frente')";

function canaVazia(ultima: string | null): DadosPainel["cana"] {
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
  };
}

async function carregarCana(pool: Pool, ultima: string, inicioSafra: string | null): Promise<DadosPainel["cana"]> {
  const cana = canaVazia(ultima);
  const ini = inicioSafra ?? addDays(ultima, -365);
  const inicioMes = startOfMonth(ultima);
  const metas: MetaFrente[] = await listMetas();
  const frentesComMeta = Array.from(new Set(metas.map((m) => m.frente)));

  // totais e por frente (a "primeira entrada" é de todo o histórico: a meta da frente só conta a partir dela)
  const porFrente = (
    await pool.query<{ frente: string; dia: number; mes: number; saf: number; dias: number; primeira: string | null }>(
      `SELECT ${FRENTE_ORD} AS frente,
              COALESCE(SUM(e.ton) FILTER (WHERE e.dt = $1::date), 0)::float AS dia,
              COALESCE(SUM(e.ton) FILTER (WHERE e.dt >= $3::date AND e.dt <= $1::date), 0)::float AS mes,
              COALESCE(SUM(e.ton) FILTER (WHERE e.dt >= $2::date AND e.dt <= $1::date), 0)::float AS saf,
              COUNT(DISTINCT e.dt) FILTER (WHERE e.dt >= $2::date AND e.dt <= $1::date AND e.ton > 0)::int AS dias,
              (MIN(e.dt) FILTER (WHERE e.ton > 0))::text AS primeira
         FROM ent_dia e LEFT JOIN ord o ON o.num = e.ord_num
        WHERE e.dt <= $1::date GROUP BY 1`,
      [ultima, ini, inicioMes]
    )
  ).rows;
  const primeira = new Map(porFrente.filter((r) => r.primeira).map((r) => [r.frente, r.primeira as string]));
  const metaNoPeriodo = (frente: string, inicio: string, fim: string) => {
    const p = primeira.get(frente);
    if (!p) return 0;
    const i = inicio > p ? inicio : p;
    return i > fim ? 0 : metaNoIntervalo(metas, frente, { inicio: i, fim });
  };
  const metaNoDia = (frente: string, dia: string) => {
    const p = primeira.get(frente);
    return p && dia >= p ? metaDoDia(metas, frente, dia) : 0;
  };

  const totais = (
    await pool.query<{ dia: number; ant: number; mes: number; saf: number; dias: number }>(
      `SELECT COALESCE(SUM(ton) FILTER (WHERE dt = $1::date), 0)::float AS dia,
              COALESCE(SUM(ton) FILTER (WHERE dt = (SELECT MAX(dt) FROM ent_dia WHERE ton > 0 AND dt < $1::date)), 0)::float AS ant,
              COALESCE(SUM(ton) FILTER (WHERE dt >= $3::date AND dt <= $1::date), 0)::float AS mes,
              COALESCE(SUM(ton) FILTER (WHERE dt >= $2::date AND dt <= $1::date), 0)::float AS saf,
              COUNT(DISTINCT dt) FILTER (WHERE dt >= $2::date AND dt <= $1::date AND ton > 0)::int AS dias
         FROM ent_dia`,
      [ultima, ini, inicioMes]
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
    await pool.query<{ dt: string; frente: string; ton: number }>(
      `SELECT e.dt::text AS dt, ${FRENTE_ORD} AS frente, SUM(e.ton)::float AS ton
         FROM ent_dia e LEFT JOIN ord o ON o.num = e.ord_num
        WHERE e.dt >= $1::date AND e.dt <= $2::date GROUP BY 1, 2`,
      [dias30[0], ultima]
    )
  ).rows;
  const porDia = new Map<string, Record<string, number>>();
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
  const melhores = new Map<string, { dt: string; ton: number }>();
  (
    await pool.query<{ frente: string; dt: string; ton: number }>(
      `SELECT DISTINCT ON (frente) frente, dt::text AS dt, ton FROM (
         SELECT ${FRENTE_ORD} AS frente, e.dt, SUM(e.ton)::float AS ton
           FROM ent_dia e LEFT JOIN ord o ON o.num = e.ord_num
          WHERE e.dt >= $1::date AND e.dt <= $2::date GROUP BY 1, 2) x
        ORDER BY frente, ton DESC`,
      [ini, ultima]
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
    await pool.query<{ mes: string; ton: number; dias: number }>(
      `SELECT to_char(dt, 'YYYY-MM') AS mes, SUM(ton)::float AS ton, COUNT(DISTINCT dt) FILTER (WHERE ton > 0)::int AS dias
         FROM ent_dia WHERE dt >= $1::date AND dt <= $2::date GROUP BY 1 ORDER BY 1`,
      [iniMensal, ultima]
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
  return cana;
}

async function carregarInsumos(pool: Pool): Promise<DadosPainel["insumos"]> {
  const insumos: DadosPainel["insumos"] = {
    dtBase: null,
    valor: 0,
    variacao: null,
    dtAnterior: null,
    porEmpresa: [],
    emprestimosAbertos: { n: 0, valor: 0 },
    grupos: [],
    capacidade: [],
    cobertura: { comSaldo: 0, comDosagem: 0 },
  };
  try {
    await Promise.all([prepararInsumos(pool), prepararDosagens(pool)]);
  } catch {
    return insumos; // sem as tabelas do módulo o painel segue com o resto
  }

  const dts = (await pool.query<{ d: string }>("SELECT DISTINCT dt::text AS d FROM ins_sld ORDER BY 1 DESC LIMIT 2")).rows;
  if (dts[0]) {
    insumos.dtBase = dts[0].d;
    insumos.dtAnterior = dts[1]?.d ?? null;
    const v = await pool.query<{ dt: string; emp: number; valor: number }>(
      `SELECT dt::text AS dt, emp, SUM(saldo * custo)::float AS valor FROM ins_sld
        WHERE dt = ANY($1::date[]) AND almx = ANY($2::int[]) GROUP BY dt, emp`,
      [dts.map((x) => x.d), DEPOSITOS_AGRICOLAS]
    );
    const atual = v.rows.filter((x) => x.dt === dts[0].d);
    insumos.porEmpresa = atual.map((x) => ({ emp: x.emp, valor: round2(x.valor) })).sort((a, b) => a.emp - b.emp);
    insumos.valor = round2(atual.reduce((a, x) => a + x.valor, 0));
    if (dts[1]) insumos.variacao = round2(insumos.valor - v.rows.filter((x) => x.dt === dts[1].d).reduce((a, x) => a + x.valor, 0));

    // maiores grupos por valor, com o maior insumo de cada um
    insumos.grupos = (
      await pool.query<{ grp: string; ds: string; valor: number; itens: number; maior: string | null; maior_valor: number | null }>(
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
        [dts[0].d, DEPOSITOS_AGRICOLAS]
      )
    ).rows.map((r) => ({ grp: r.grp.trim(), ds: r.ds.trim(), valor: round2(r.valor), itens: r.itens, maior: r.maior, maiorValor: round2(r.maior_valor ?? 0) }));

    // capacidade de aplicação: saldo ÷ dosagem por hectare, dos insumos de maior valor que têm dosagem
    const cap = await pool.query<{ cod: string; ds: string; un: string; qtd: number; dmin: number | null; dmax: number | null }>(
      `SELECT s.cod, i.ds, i.un, SUM(s.saldo)::float AS qtd, d.dmin::float AS dmin, d.dmax::float AS dmax
         FROM ins_sld s JOIN ins_itm i ON i.cod = s.cod JOIN ins_dos d ON d.cod = s.cod
        WHERE s.dt = $1::date AND s.almx = ANY($2::int[]) AND s.saldo > 0
        GROUP BY s.cod, i.ds, i.un, d.dmin, d.dmax
       HAVING SUM(s.saldo) > 0
        ORDER BY SUM(s.saldo * s.custo) DESC`,
      [dts[0].d, DEPOSITOS_AGRICOLAS]
    );
    for (const r of cap.rows) {
      if (insumos.capacidade.length >= 6) break;
      const h = hectaresDoSaldo(r.qtd, { min: r.dmin, max: r.dmax });
      if (!h) continue;
      insumos.capacidade.push({ cod: r.cod, ds: r.ds, un: r.un.trim(), qtd: round2(r.qtd), min: r.dmin, max: r.dmax, hDe: h.de, hAte: h.ate });
    }
    const cob = (
      await pool.query<{ com_saldo: number; com_dosagem: number }>(
        `WITH s AS (SELECT cod FROM ins_sld WHERE dt = $1::date AND almx = ANY($2::int[]) GROUP BY cod HAVING SUM(saldo) > 0)
         SELECT COUNT(*)::int AS com_saldo, COUNT(d.cod)::int AS com_dosagem FROM s LEFT JOIN ins_dos d ON d.cod = s.cod`,
        [dts[0].d, DEPOSITOS_AGRICOLAS]
      )
    ).rows[0];
    insumos.cobertura = { comSaldo: cob.com_saldo, comDosagem: cob.com_dosagem };
  }

  const tabelaEmp = (await pool.query<{ t: string | null }>("SELECT to_regclass('emp_cab')::text AS t")).rows[0].t;
  if (tabelaEmp) {
    const e = (
      await pool.query<{ n: number; valor: number }>(
        `SELECT COUNT(*)::int AS n,
                COALESCE(SUM((SELECT COALESCE(SUM((i->>'vt')::numeric), 0) FROM jsonb_array_elements(itens) i)), 0)::float AS valor
           FROM emp_cab WHERE st = 'Aberto'`
      )
    ).rows[0];
    insumos.emprestimosAbertos = { n: e.n, valor: round2(e.valor) };
  }
  return insumos;
}

export async function dadosPainel(hoje: string): Promise<DadosPainel> {
  const pool = getPool();
  await prepararBanco(pool);
  const vigente = escolherSafraVigente(await listSafrasCadastro(), hoje);
  const maxSaf = (await pool.query<{ s: number | null }>("SELECT MAX(saf)::int AS s FROM saf_tlh")).rows[0].s;
  const anoSafra = vigente?.ano ?? maxSaf ?? new Date().getFullYear();
  const inicioSafra = vigente?.producaoInicio ?? null;

  const ultima = (await pool.query<{ d: string | null }>("SELECT MAX(dt)::text AS d FROM ent_dia WHERE ton > 0")).rows[0].d;
  const cana = ultima ? await carregarCana(pool, ultima, inicioSafra) : canaVazia(null);
  const insumos = await carregarInsumos(pool);

  // ---- rodadas de campo --------------------------------------------------
  const rod = await pool.query<{ rod: number; boletins: number; area: number; ultima: string | null }>(
    `SELECT b.rod, COUNT(DISTINCT b.bol)::int AS boletins, COALESCE(SUM(i.area), 0)::float AS area, MAX(b.dt)::text AS ultima
       FROM rod_bol b LEFT JOIN rod_itm i ON i.bol = b.bol GROUP BY b.rod ORDER BY b.rod DESC LIMIT 6`
  );
  const rodadas = { porRodada: rod.rows.map((r) => ({ rod: r.rod, boletins: r.boletins, areaHa: round2(r.area), ultimaData: r.ultima })).reverse() };

  // ---- comparativo de safra: estimado x realizado ------------------------
  const sc = await pool.query<{ saf: number; est: number; real: number; area_t: number; ac: number; te: number | null; tr: number | null }>(
    `SELECT saf,
            COALESCE(SUM(prod_est) FILTER (WHERE prod_est > 0), 0)::float AS est,
            COALESCE(SUM(prod_atu) FILTER (WHERE prod_atu > 0), 0)::float AS real,
            COALESCE(SUM(area_tot), 0)::float AS area_t,
            COALESCE(SUM(area_col), 0)::float AS ac,
            (SUM(prod_est) FILTER (WHERE prod_est > 0) / NULLIF(SUM(area_tot) FILTER (WHERE prod_est > 0), 0))::float AS te,
            (SUM(prod_atu) FILTER (WHERE prod_atu > 0) / NULLIF(SUM(area_col) FILTER (WHERE prod_atu > 0), 0))::float AS tr
       FROM saf_tlh GROUP BY saf ORDER BY saf DESC LIMIT 3`
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

  return {
    safra: { ano: anoSafra, rotulo: vigente ? `${vigente.tipo} ${vigente.ano}` : String(anoSafra), inicio: inicioSafra },
    cana,
    insumos,
    rodadas,
    safraComparativo,
    realizadoAteHojeT: cana.safraT,
  };
}
