import { getPool, listSafrasCadastro, prepararBanco } from "./db";
import { escolherSafraVigente } from "./safra-cadastro";
import { round2 } from "./insumos-saldo";

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
    porFrente: { frente: string; diaT: number; mesT: number; safraT: number }[];
    serie: { dt: string; ton: number }[];
  };
  insumos: {
    dtBase: string | null;
    valor: number;
    variacao: number | null;
    dtAnterior: string | null;
    porEmpresa: { emp: number; valor: number }[];
    emprestimosAbertos: { n: number; valor: number };
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

export async function dadosPainel(hoje: string): Promise<DadosPainel> {
  const pool = getPool();
  await prepararBanco(pool);
  const vigente = escolherSafraVigente(await listSafrasCadastro(), hoje);
  const maxSaf = (await pool.query<{ s: number | null }>("SELECT MAX(saf)::int AS s FROM saf_tlh")).rows[0].s;
  const anoSafra = vigente?.ano ?? maxSaf ?? new Date().getFullYear();
  const inicioSafra = vigente?.producaoInicio ?? null;

  // ---- entrada de cana ---------------------------------------------------
  const ultima = (await pool.query<{ d: string | null }>("SELECT MAX(dt)::text AS d FROM ent_dia WHERE ton > 0")).rows[0].d;
  const cana: DadosPainel["cana"] = {
    ultimaData: ultima,
    diaT: 0,
    diaAnteriorT: 0,
    mesT: 0,
    safraT: 0,
    diasEfetivos: 0,
    mediaDiaEfetivoT: 0,
    porFrente: [],
    serie: [],
  };
  if (ultima) {
    const ini = inicioSafra ?? "0000-01-01";
    const r = (
      await pool.query<{ dia: number; ant: number; mes: number; saf: number; dias: number }>(
        `SELECT COALESCE(SUM(ton) FILTER (WHERE dt = $1::date), 0)::float AS dia,
                COALESCE(SUM(ton) FILTER (WHERE dt = (SELECT MAX(dt) FROM ent_dia WHERE ton > 0 AND dt < $1::date)), 0)::float AS ant,
                COALESCE(SUM(ton) FILTER (WHERE dt >= date_trunc('month', $1::date) AND dt <= $1::date), 0)::float AS mes,
                COALESCE(SUM(ton) FILTER (WHERE dt >= $2::date AND dt <= $1::date), 0)::float AS saf,
                COUNT(DISTINCT dt) FILTER (WHERE dt >= $2::date AND dt <= $1::date AND ton > 0)::int AS dias
           FROM ent_dia`,
        [ultima, ini]
      )
    ).rows[0];
    cana.diaT = round2(r.dia);
    cana.diaAnteriorT = round2(r.ant);
    cana.mesT = round2(r.mes);
    cana.safraT = round2(r.saf);
    cana.diasEfetivos = r.dias;
    cana.mediaDiaEfetivoT = r.dias > 0 ? round2(r.saf / r.dias) : 0;
    cana.porFrente = (
      await pool.query<{ frente: string; dia: number; mes: number; saf: number }>(
        `SELECT COALESCE(NULLIF(o.frt, ''), 'Sem frente') AS frente,
                COALESCE(SUM(e.ton) FILTER (WHERE e.dt = $1::date), 0)::float AS dia,
                COALESCE(SUM(e.ton) FILTER (WHERE e.dt >= date_trunc('month', $1::date) AND e.dt <= $1::date), 0)::float AS mes,
                COALESCE(SUM(e.ton) FILTER (WHERE e.dt >= $2::date AND e.dt <= $1::date), 0)::float AS saf
           FROM ent_dia e LEFT JOIN ord o ON o.num = e.ord_num
          WHERE e.dt <= $1::date GROUP BY 1 HAVING SUM(e.ton) FILTER (WHERE e.dt >= $2::date AND e.dt <= $1::date) > 0 ORDER BY saf DESC`,
        [ultima, ini]
      )
    ).rows.map((x) => ({ frente: x.frente, diaT: round2(x.dia), mesT: round2(x.mes), safraT: round2(x.saf) }));
    cana.serie = (
      await pool.query<{ dt: string; ton: number }>(
        `SELECT dt::text AS dt, SUM(ton)::float AS ton FROM ent_dia
          WHERE dt > $1::date - 30 AND dt <= $1::date GROUP BY dt ORDER BY dt`,
        [ultima]
      )
    ).rows.map((x) => ({ dt: x.dt, ton: round2(x.ton) }));
  }

  // ---- insumos -----------------------------------------------------------
  const insumos: DadosPainel["insumos"] = { dtBase: null, valor: 0, variacao: null, dtAnterior: null, porEmpresa: [], emprestimosAbertos: { n: 0, valor: 0 } };
  const tabelaSaldo = (await pool.query<{ t: string | null }>("SELECT to_regclass('ins_sld')::text AS t")).rows[0].t;
  if (tabelaSaldo) {
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
    }
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
