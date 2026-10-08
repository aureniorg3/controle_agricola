import type { Pool } from "pg";
import { auditar } from "./auditar";
import {
  codigoOperacao,
  GRUPO_OUTRAS,
  GRUPOS_OPERACOES_PADRAO,
  somarValores,
  vazio,
  type DashboardAtividades,
  type GrupoOperacoes,
  type LinhaMoagem,
  type LinhaOperacao,
  type OperacaoGrupo,
  type ValoresPeriodo,
} from "./dashboard-atividades";
import { getPool, listOrdens, listSafrasCadastro, prepararBanco } from "./db";
import { prepararAtividades } from "./db-atividades";
import { addDays, startOfMonth, startOfWeekMonday } from "./period";
import { escolherSafraVigente } from "./safra-cadastro";
import type { SafraCadastro } from "./types";

let preparado: Promise<void> | null = null;

const MARCA = "Carga inicial · grupos da planilha CALL (Rendimento Operacional)";

/** Grupo de cada operação no dashboard (código sem zeros à esquerda → grupo) e a carga inicial da planilha CALL. */
async function prepararGrupos(pool: Pool): Promise<void> {
  await prepararBanco(pool);
  if (!preparado) {
    preparado = (async () => {
      await pool.query(
        `CREATE TABLE IF NOT EXISTS atv_grp (
           op_cod text PRIMARY KEY, grp text NOT NULL, ord integer NOT NULL DEFAULT 0, ds text NOT NULL DEFAULT '',
           atu_usr text NOT NULL DEFAULT '', atu_em timestamptz NOT NULL DEFAULT now()
         )`
      );
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(hashtext('atv_grp_carga_inicial'))");
        const feita = ((await client.query("SELECT 1 FROM aud_log WHERE modulo = 'Atividades' AND entidade = 'Grupos do Dashboard' AND chave = $1 LIMIT 1", [MARCA])).rowCount ?? 0) > 0;
        if (!feita) {
          const ordem = new Map<string, number>();
          for (const [, g] of GRUPOS_OPERACOES_PADRAO) if (!ordem.has(g)) ordem.set(g, (ordem.size + 1) * 10);
          await client.query(
            `INSERT INTO atv_grp (op_cod, grp, ord, atu_usr, ds)
             SELECT * FROM unnest($1::text[], $2::text[], $3::int[], $4::text[], $5::text[]) ON CONFLICT (op_cod) DO NOTHING`,
            [
              GRUPOS_OPERACOES_PADRAO.map(([c]) => c),
              GRUPOS_OPERACOES_PADRAO.map(([, g]) => g),
              GRUPOS_OPERACOES_PADRAO.map(([, g]) => ordem.get(g)!),
              GRUPOS_OPERACOES_PADRAO.map(() => "Carga inicial"),
              GRUPOS_OPERACOES_PADRAO.map(([, , d]) => d),
            ]
          );
          await auditar(client, {
            usuario: "Carga inicial",
            modulo: "Atividades",
            entidade: "Grupos do Dashboard",
            chave: MARCA,
            acao: "importacao",
            depois: { operacoes: GRUPOS_OPERACOES_PADRAO.length, grupos: ordem.size },
          });
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

/**
 * Dashboard das atividades numa data: entrada de cana (total e por frente) e área realizada das operações
 * lançadas (por grupo), em cada dia da semana de referência (segunda a domingo) e acumulada na semana,
 * no mês e na safra — sempre até a data de referência.
 */
export async function dashboardAtividades(dtPedida?: string): Promise<DashboardAtividades> {
  const pool = getPool();
  await prepararAtividades(pool);
  await prepararGrupos(pool);
  const hoje = hojeSP();
  const ult = (
    await pool.query<{ d: string | null }>(
      `SELECT GREATEST((SELECT MAX(dt) FROM ap_dia WHERE dt <= $1::date), (SELECT MAX(dt) FROM pes_viag WHERE dt <= $1::date))::text AS d`,
      [hoje]
    )
  ).rows[0].d;
  const dt = dtPedida ?? ult ?? hoje;
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

  // ---------------- moagem: as mesmas entradas das Ordens de Corte (viagens com ordem), dia civil inteiro
  const fimMoagem = vigente && vigente.producaoFim < dt ? vigente.producaoFim : dt;
  const desdeMoagem = [inicioMoagem, seg, mesInicio].sort()[0];
  const porFrente = new Map<string, ValoresPeriodo>();
  for (const o of await listOrdens()) {
    for (const e of o.entradas) {
      if (e.data < desdeMoagem || e.data > fimMoagem || !(e.toneladas > 0)) continue;
      const frente = o.frente || "Sem frente";
      if (!porFrente.has(frente)) porFrente.set(frente, vazio());
      acumular(porFrente.get(frente)!, e.data, e.toneladas, inicioMoagem);
    }
  }
  const frentes: LinhaMoagem[] = [...porFrente.entries()]
    .map(([frente, v]) => ({ frente, ...fechar(v) }))
    .filter((l) => l.safra > 0 || l.mes > 0 || l.semana > 0)
    .sort((a, b) => a.frente.localeCompare(b.frente));
  const totalMoagem = fechar(somarValores(frentes, diasValidos));

  // ---------------- operações: área dos talhões (ou da fazenda) de cada apontamento
  const desdeOps = [inicioOps, seg, mesInicio].sort()[0];
  const { rows } = await pool.query<{ d: string; cod: string; ds: string; ha: number }>(
    `SELECT a.dt::text AS d, a.op_cod AS cod, MAX(a.op_ds) AS ds, SUM(t.area)::float AS ha
       FROM ap_dia a JOIN ap_dia_tlh t ON t.ap_id = a.id
      WHERE a.dt BETWEEN $1::date AND $2::date
      GROUP BY a.dt, a.op_cod`,
    [desdeOps, dt]
  );
  const grupoDe = new Map(
    (await pool.query<{ op_cod: string; grp: string; ord: number }>("SELECT op_cod, grp, ord FROM atv_grp")).rows.map((r) => [r.op_cod, r])
  );
  const porOperacao = new Map<string, { cod: string; ds: string; v: ValoresPeriodo }>();
  for (const r of rows) {
    const chave = codigoOperacao(r.cod) || r.ds;
    if (!porOperacao.has(chave)) porOperacao.set(chave, { cod: codigoOperacao(r.cod), ds: r.ds, v: vazio() });
    const op = porOperacao.get(chave)!;
    if (r.ds && r.ds.length > op.ds.length) op.ds = r.ds;
    acumular(op.v, r.d, r.ha, inicioOps);
  }
  const grupos = new Map<string, { ord: number; linhas: LinhaOperacao[] }>();
  for (const op of porOperacao.values()) {
    const linha: LinhaOperacao = { cod: op.cod, ds: op.ds || op.cod, ...fechar(op.v) };
    if (!(linha.safra > 0 || linha.mes > 0 || linha.semana > 0)) continue;
    const g = grupoDe.get(op.cod);
    const nome = g?.grp ?? GRUPO_OUTRAS;
    if (!grupos.has(nome)) grupos.set(nome, { ord: g?.ord ?? 99999, linhas: [] });
    const atual = grupos.get(nome)!;
    atual.ord = Math.min(atual.ord, g?.ord ?? 99999);
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
    ultimoLancamento: ult,
  };
}

/** Operações para a tela de grupos: as que têm grupo e as que já foram lançadas. */
export async function listarGruposOperacoes(): Promise<{ operacoes: OperacaoGrupo[]; grupos: string[] }> {
  const pool = getPool();
  await prepararAtividades(pool);
  await prepararGrupos(pool);
  const lancadas = (
    await pool.query<{ cod: string; ds: string }>(
      "SELECT op_cod AS cod, MAX(op_ds) AS ds FROM ap_dia WHERE op_cod <> '' GROUP BY op_cod"
    )
  ).rows;
  const grp = (await pool.query<{ op_cod: string; grp: string; ord: number; ds: string }>("SELECT op_cod, grp, ord, ds FROM atv_grp ORDER BY ord, op_cod")).rows;
  const ops = new Map<string, OperacaoGrupo>();
  for (const g of grp) ops.set(g.op_cod, { cod: g.op_cod, ds: g.ds, grupo: g.grp, lancada: false });
  for (const l of lancadas) {
    const cod = codigoOperacao(l.cod);
    const atual = ops.get(cod) ?? { cod, ds: "", grupo: GRUPO_OUTRAS, lancada: false };
    atual.ds = l.ds || atual.ds;
    atual.lancada = true;
    ops.set(cod, atual);
  }
  const ordem = new Map<string, number>();
  for (const g of grp) if (!ordem.has(g.grp)) ordem.set(g.grp, g.ord);
  const grupos = [...ordem.keys()];
  return {
    operacoes: [...ops.values()].sort(
      (a, b) => Number(b.lancada) - Number(a.lancada) || a.cod.localeCompare(b.cod, undefined, { numeric: true })
    ),
    grupos,
  };
}

/** Define o grupo de uma operação no dashboard (grupo vazio ou "Outras operações" tira do agrupamento). */
export async function salvarGrupoOperacao(cod: string, grupo: string, usuario: string): Promise<void> {
  const pool = getPool();
  await prepararGrupos(pool);
  const op = codigoOperacao(cod);
  const g = grupo.trim().toUpperCase();
  const antes = (await pool.query<{ grp: string }>("SELECT grp FROM atv_grp WHERE op_cod = $1", [op])).rows[0]?.grp ?? GRUPO_OUTRAS;
  if (!g || g === GRUPO_OUTRAS) {
    await pool.query("DELETE FROM atv_grp WHERE op_cod = $1", [op]);
  } else {
    // grupo que já existe mantém a sua posição; grupo novo vai para o fim
    const ord =
      (await pool.query<{ o: number | null }>("SELECT MIN(ord) AS o FROM atv_grp WHERE grp = $1", [g])).rows[0].o ??
      ((await pool.query<{ o: number | null }>("SELECT MAX(ord) AS o FROM atv_grp")).rows[0].o ?? 0) + 10;
    await pool.query(
      `INSERT INTO atv_grp (op_cod, grp, ord, atu_usr, atu_em) VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (op_cod) DO UPDATE SET grp = EXCLUDED.grp, ord = EXCLUDED.ord, atu_usr = EXCLUDED.atu_usr, atu_em = now()`,
      [op, g, ord, usuario]
    );
  }
  if (antes !== (g || GRUPO_OUTRAS))
    await auditar(pool, {
      usuario,
      modulo: "Atividades",
      entidade: "Grupos do Dashboard",
      chave: `Operação ${op}`,
      acao: "alteracao",
      antes: { grupo: antes },
      depois: { grupo: g || GRUPO_OUTRAS },
    });
}
