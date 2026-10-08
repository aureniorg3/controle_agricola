import type { Pool } from "pg";
import { auditar } from "./auditar";
import {
  codigoOperacao,
  GRUPO_OUTRAS,
  somarValores,
  vazio,
  type DashboardAtividades,
  type GrupoOperacoes,
  type LinhaMoagem,
  type LinhaOperacao,
  type OperacaoGrupo,
  type ValoresPeriodo,
} from "./dashboard-atividades";
import { getPool, listSafrasCadastro, prepararBanco } from "./db";
import { prepararAtividades } from "./db-atividades";
import { carregarCadastrosExportados } from "./db-cadastros-carga";
import { carregarApontamentosWhatsappIniciais } from "./db-import-whatsapp";
import { nomeOperacao, operacoesDoCadastro } from "./db-operacoes";
import { addDays, startOfMonth, startOfWeekMonday } from "./period";
import { escolherSafraVigente } from "./safra-cadastro";
import type { SafraCadastro } from "./types";

/** Cadastro (Configurações › Cadastros) com o grupo de cada operação no dashboard. */
const CAD_GRUPOS = "grupos-operacoes";
const ENTIDADE_LOG = "Cadastro de Grupos de Operações";

let preparado: Promise<void> | null = null;

/**
 * Os grupos das operações ficam no cadastro Grupos de Operações. A tabela antiga (atv_grp) é desfeita uma vez: os grupos
 * da carga inicial da planilha CALL saem e só os ajustes feitos por usuários passam para o cadastro.
 */
async function prepararGrupos(pool: Pool): Promise<void> {
  await prepararBanco(pool);
  if (!preparado) {
    preparado = (async () => {
      const existe = (await pool.query<{ t: string | null }>("SELECT to_regclass('atv_grp')::text AS t")).rows[0].t;
      if (!existe) return;
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(hashtext('atv_grp_para_cadastro'))");
        if ((await client.query<{ t: string | null }>("SELECT to_regclass('atv_grp')::text AS t")).rows[0].t) {
          const cadOps = await operacoesDoCadastro(pool);
          const ajustes = (
            await client.query<{ op_cod: string; grp: string; ord: number; atu_usr: string }>(
              "SELECT op_cod, grp, ord, atu_usr FROM atv_grp WHERE atu_usr <> 'Carga inicial'"
            )
          ).rows;
          for (const a of ajustes) {
            const op = cadOps.get(codigoOperacao(a.op_cod));
            const dds = { operacao: op?.cod ?? a.op_cod, operacao_nm: op?.nm ?? "", classificacao: op?.classificacao ?? "", grupo: a.grp, ordem: a.ord };
            await client.query(
              "INSERT INTO cad_itm (cad, cod, nm, dds, usr, atu_usr) VALUES ($1, $2, $3, $4::jsonb, $5, $5) ON CONFLICT (cad, cod) DO NOTHING",
              [CAD_GRUPOS, dds.operacao, a.grp, JSON.stringify(dds), a.atu_usr]
            );
          }
          await auditar(client, {
            usuario: "Sistema",
            modulo: "Cadastros",
            entidade: ENTIDADE_LOG,
            chave: "Grupos do Dashboard de Atividades passam para o cadastro",
            acao: "importacao",
            depois: { ajustesDeUsuarios: ajustes.length, cargaInicialCALL: "removida" },
          });
          await client.query("DROP TABLE atv_grp");
        }
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    })().catch((err) => {
      preparado = null;
      throw err;
    });
  }
  await preparado;
}

const hojeSP = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Safra cujo ano-safra contém a data (agrícola antes de industrial; a mais recente no empate). */
function safraDoAno(safras: SafraCadastro[], dt: string): SafraCadastro | null {
  return (
    safras
      .filter((s) => s.anoInicio <= dt && dt <= s.anoFim)
      .sort((a, b) => (a.tipo === b.tipo ? 0 : a.tipo === "AGR" ? -1 : 1) || b.ano - a.ano)[0] ?? null
  );
}

/** Prepara o cadastro Grupos de Operações (inclusive a passagem da tabela antiga) — para a tela do cadastro. */
export async function prepararGruposOperacoes(): Promise<void> {
  const pool = getPool();
  await prepararAtividades(pool);
  await carregarCadastrosExportados(pool);
  await prepararGrupos(pool);
}

/** Grupo de cada operação (código sem zeros à esquerda → grupo e ordem do grupo). */
async function gruposDoCadastro(pool: Pool): Promise<Map<string, { grupo: string; ordem: number | null }>> {
  const { rows } = await pool.query<{ cod: string; grp: string | null; ord: string | null }>(
    "SELECT cod, dds->>'grupo' AS grp, dds->>'ordem' AS ord FROM cad_itm WHERE cad = $1",
    [CAD_GRUPOS]
  );
  return new Map(
    rows
      .filter((r) => (r.grp ?? "").trim())
      .map((r) => [codigoOperacao(r.cod), { grupo: r.grp!.trim().toUpperCase(), ordem: r.ord !== null && r.ord !== "" && Number.isFinite(Number(r.ord)) ? Number(r.ord) : null }])
  );
}

/**
 * Dashboard das atividades numa data (no máximo ontem: só dias fechados): entrada de cana (total e por frente, de todas
 * as viagens da pesagem) e área realizada das operações lançadas (por grupo), em cada dia da semana de referência
 * (segunda a domingo) e acumulada na semana, no mês e na safra — sempre até a data de referência.
 */
export async function dashboardAtividades(dtPedida?: string): Promise<DashboardAtividades> {
  const pool = getPool();
  await prepararAtividades(pool);
  await prepararGrupos(pool);
  await carregarApontamentosWhatsappIniciais();
  const ontem = addDays(hojeSP(), -1);
  const dt = dtPedida && dtPedida < ontem ? dtPedida : ontem;
  const seg = startOfWeekMonday(dt);
  const semana = Array.from({ length: 7 }, (_, i) => addDays(seg, i));
  const diasValidos = semana.map((d) => d <= dt);
  const mesInicio = startOfMonth(dt);

  const safras = await listSafrasCadastro();
  const doAno = safraDoAno(safras, dt);
  const vigente = escolherSafraVigente(safras, dt);
  const safraOperacoes = doAno ? { inicio: doAno.anoInicio, rotulo: `Safra ${doAno.ano}` } : null;
  const safraMoagem = vigente ? { inicio: vigente.producaoInicio, rotulo: `Safra ${vigente.ano}` } : null;
  const inicioOps = safraOperacoes?.inicio ?? `${dt.slice(0, 4)}-01-01`;
  const inicioMoagem = safraMoagem?.inicio ?? `${dt.slice(0, 4)}-01-01`;

  /** Acumula `valor` do dia `d` em `v` (o dia entra na semana, no mês e na safra conforme o caso). */
  const acumular = (v: ValoresPeriodo, d: string, valor: number, inicioSafra: string) => {
    if (d > dt) return;
    const i = semana.indexOf(d);
    if (i >= 0) {
      v.dias[i] = (v.dias[i] ?? 0) + valor;
      v.semana += valor;
    }
    if (d >= mesInicio) v.mes += valor;
    if (d >= inicioSafra) v.safra += valor;
  };
  const fechar = (v: ValoresPeriodo): ValoresPeriodo => ({
    dias: v.dias.map((x, i) => (diasValidos[i] ? r2(x ?? 0) : null)),
    semana: r2(v.semana),
    mes: r2(v.mes),
    safra: r2(v.safra),
  });

  // ---------------- moagem: todas as viagens da pesagem (com ou sem ordem de corte, ex.: CMAA), dias inteiros;
  // a frente é a da ordem e, sem ordem, a do relatório de pesagem. Viagem com tara zerada não conta.
  const fimMoagem = vigente && vigente.producaoFim < dt ? vigente.producaoFim : dt;
  const desdeMoagem = [inicioMoagem, seg, mesInicio].sort()[0];
  const { rows: viagens } = await pool.query<{ d: string; f: string; t: number }>(
    `SELECT v.dt::text AS d, COALESCE(NULLIF(o.frt, ''), NULLIF(v.frt, ''), 'SEM FRENTE') AS f, SUM(v.ton)::float AS t
       FROM pes_viag v LEFT JOIN ord o ON o.num = v.ord_num
      WHERE v.dt BETWEEN $1::date AND $2::date AND (v.tara IS NULL OR v.tara > 0)
      GROUP BY 1, 2`,
    [desdeMoagem, fimMoagem]
  );
  const porFrente = new Map<string, ValoresPeriodo>();
  for (const v of viagens) {
    if (!porFrente.has(v.f)) porFrente.set(v.f, vazio());
    acumular(porFrente.get(v.f)!, v.d, v.t, inicioMoagem);
  }
  const frentes: LinhaMoagem[] = [...porFrente.entries()]
    .map(([frente, v]) => ({ frente, ...fechar(v) }))
    .filter((l) => l.safra > 0 || l.mes > 0 || l.semana > 0)
    .sort((a, b) => a.frente.localeCompare(b.frente));
  const totalMoagem = fechar(somarValores(frentes, diasValidos));

  // ---------------- operações: área dos talhões (ou da fazenda) de cada apontamento; nome pelo cadastro Operações
  const desdeOps = [inicioOps, seg, mesInicio].sort()[0];
  const { rows } = await pool.query<{ d: string; cod: string; ds: string; ha: number }>(
    `SELECT a.dt::text AS d, a.op_cod AS cod, MAX(a.op_ds) AS ds, SUM(t.area)::float AS ha
       FROM ap_dia a JOIN ap_dia_tlh t ON t.ap_id = a.id
      WHERE a.dt BETWEEN $1::date AND $2::date
      GROUP BY a.dt, a.op_cod`,
    [desdeOps, dt]
  );
  const cadOps = await operacoesDoCadastro(pool);
  const grupoDe = await gruposDoCadastro(pool);
  const porOperacao = new Map<string, { cod: string; ds: string; v: ValoresPeriodo }>();
  for (const r of rows) {
    const cod = codigoOperacao(r.cod);
    const chave = cod || r.ds;
    if (!porOperacao.has(chave)) porOperacao.set(chave, { cod, ds: nomeOperacao(cadOps, cod, r.ds), v: vazio() });
    acumular(porOperacao.get(chave)!.v, r.d, r.ha, inicioOps);
  }
  const grupos = new Map<string, { ord: number; linhas: LinhaOperacao[] }>();
  for (const op of porOperacao.values()) {
    const linha: LinhaOperacao = { cod: op.cod, ds: op.ds || op.cod, ...fechar(op.v) };
    if (!(linha.safra > 0 || linha.mes > 0 || linha.semana > 0)) continue;
    const g = grupoDe.get(op.cod);
    const nome = g?.grupo ?? GRUPO_OUTRAS;
    const ordem = g ? (g.ordem ?? 9999) : 99999;
    if (!grupos.has(nome)) grupos.set(nome, { ord: ordem, linhas: [] });
    const atual = grupos.get(nome)!;
    atual.ord = Math.min(atual.ord, ordem);
    atual.linhas.push(linha);
  }
  const listaGrupos: GrupoOperacoes[] = [...grupos.entries()]
    .sort((a, b) => a[1].ord - b[1].ord || a[0].localeCompare(b[0]))
    .map(([grupo, g]) => {
      const linhas = g.linhas.sort((a, b) => a.ds.localeCompare(b.ds) || a.cod.localeCompare(b.cod, undefined, { numeric: true }));
      return { grupo, linhas, subtotal: fechar(somarValores(linhas, diasValidos)) };
    });
  const totalOps = fechar(somarValores(listaGrupos.map((g) => g.subtotal), diasValidos));

  return {
    dt,
    semana,
    mesInicio,
    safraOperacoes,
    safraMoagem,
    moagem: { total: totalMoagem, frentes },
    operacoes: { grupos: listaGrupos, total: totalOps },
    ultimoLancamento: ontem,
  };
}

/** Operações para o ajuste de grupos: as do cadastro Operações e as já lançadas (que podem não estar no cadastro). */
export async function listarGruposOperacoes(): Promise<{ operacoes: OperacaoGrupo[]; grupos: string[] }> {
  const pool = getPool();
  await prepararAtividades(pool);
  await prepararGrupos(pool);
  const cadOps = await operacoesDoCadastro(pool);
  const grupoDe = await gruposDoCadastro(pool);
  const lancadas = (
    await pool.query<{ cod: string; ds: string }>("SELECT op_cod AS cod, MAX(op_ds) AS ds FROM ap_dia WHERE op_cod <> '' GROUP BY op_cod")
  ).rows;
  const ops = new Map<string, OperacaoGrupo>();
  for (const [k, o] of cadOps)
    ops.set(k, { cod: o.cod, ds: o.nm, classificacao: o.classificacao, grupo: grupoDe.get(k)?.grupo ?? GRUPO_OUTRAS, lancada: false, noCadastro: true });
  for (const l of lancadas) {
    const k = codigoOperacao(l.cod);
    const atual = ops.get(k) ?? { cod: k, ds: l.ds, classificacao: "", grupo: grupoDe.get(k)?.grupo ?? GRUPO_OUTRAS, lancada: false, noCadastro: false };
    atual.lancada = true;
    ops.set(k, atual);
  }
  const ordem = new Map<string, number>();
  for (const g of grupoDe.values()) ordem.set(g.grupo, Math.min(ordem.get(g.grupo) ?? Infinity, g.ordem ?? 9999));
  const grupos = [...ordem.entries()].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0])).map(([g]) => g);
  return {
    operacoes: [...ops.values()].sort(
      (a, b) => Number(b.lancada) - Number(a.lancada) || a.cod.localeCompare(b.cod, undefined, { numeric: true })
    ),
    grupos,
  };
}

/** Define o grupo de uma operação do cadastro Operações (grupo vazio ou "Outras operações" tira do cadastro de grupos). */
export async function salvarGrupoOperacao(cod: string, grupo: string, usuario: string): Promise<{ erro: string } | null> {
  const pool = getPool();
  await prepararGrupos(pool);
  const op = (await operacoesDoCadastro(pool)).get(codigoOperacao(cod));
  if (!op) return { erro: `A operação ${cod} não está no cadastro Operações; inclua-a lá antes de definir o grupo.` };
  const g = grupo.trim().toUpperCase();
  const atual = (await pool.query<{ dds: Record<string, unknown> }>("SELECT dds FROM cad_itm WHERE cad = $1 AND cod = $2", [CAD_GRUPOS, op.cod])).rows[0];
  const antes = String(atual?.dds.grupo ?? "") || GRUPO_OUTRAS;
  if (antes === (g || GRUPO_OUTRAS)) return null;
  if (!g || g === GRUPO_OUTRAS) {
    await pool.query("DELETE FROM cad_itm WHERE cad = $1 AND cod = $2", [CAD_GRUPOS, op.cod]);
  } else {
    // grupo que já existe mantém a sua ordem; grupo novo vai para o fim
    const ordens = (await pool.query<{ g: string; o: string | null }>("SELECT dds->>'grupo' AS g, dds->>'ordem' AS o FROM cad_itm WHERE cad = $1", [CAD_GRUPOS])).rows;
    const doGrupo = ordens.filter((x) => (x.g ?? "").trim().toUpperCase() === g && x.o).map((x) => Number(x.o));
    const todas = ordens.filter((x) => x.o).map((x) => Number(x.o)).filter(Number.isFinite);
    const ordem = doGrupo.length ? Math.min(...doGrupo) : (todas.length ? Math.max(...todas) : 0) + 10;
    const dds = { operacao: op.cod, operacao_nm: op.nm, classificacao: op.classificacao, grupo: g, ordem };
    await pool.query(
      `INSERT INTO cad_itm (cad, cod, nm, dds, usr, atu_usr, atu_em) VALUES ($1, $2, $3, $4::jsonb, $5, $5, now())
       ON CONFLICT (cad, cod) DO UPDATE SET nm = EXCLUDED.nm, dds = EXCLUDED.dds, atu_usr = EXCLUDED.atu_usr, atu_em = now()`,
      [CAD_GRUPOS, op.cod, g, JSON.stringify(dds), usuario]
    );
  }
  await auditar(pool, {
    usuario,
    modulo: "Cadastros",
    entidade: ENTIDADE_LOG,
    chave: `Operação ${op.cod} · ${op.nm}`,
    acao: atual ? (g && g !== GRUPO_OUTRAS ? "alteracao" : "exclusao") : "inclusao",
    antes: { grupo: antes },
    depois: { grupo: g || GRUPO_OUTRAS },
  });
  return null;
}
