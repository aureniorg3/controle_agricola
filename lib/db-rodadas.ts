import type { PoolClient } from "pg";
import { getPool, prepararBanco } from "./db";
import { gerarSemanas, segundaDaSemana, SEMANAS_POR_RODADA, somarDias, type LinhaResumoRodada, type RodadaCad, type SemanaRodada } from "./rodadas";
import type { LinhaRodadaImportada } from "./rodadas-import";
import { interpretar, montarIndice, type Interpretacao } from "./rodadas-ocorrencias";

const NUMERICO = /^\d+$/;

/** Condição SQL: código igual ao digitado (para códigos numéricos, 1 = 01). `p` é o número do parâmetro. */
function condCodigo(coluna: string, p: number, valor: string): string {
  return NUMERICO.test(valor)
    ? `(${coluna} = $${p} OR (${coluna} ~ '^[0-9]+$' AND ltrim(${coluna}, '0') = ltrim($${p}, '0')))`
    : `${coluna} = $${p}`;
}

// ---------------------------------------------------------------------------
// Cadastros (Cód + Descrição) — consulta de um código
// ---------------------------------------------------------------------------

export interface CodigoCadastro {
  /** o cadastro tem pelo menos um item */
  cadastroComItens: boolean;
  item: { cod: string; nm: string } | null;
}

/** Recupera o item de um cadastro pelo código. Fazendas também aceitam o código sem a sequência ("9001" acha "9001-1"). */
export async function buscarCodigo(cad: string, cod: string): Promise<CodigoCadastro> {
  const pool = getPool();
  await prepararBanco(pool);
  const valor = cod.trim();
  const { rows: cont } = await pool.query<{ n: number }>("SELECT COUNT(*)::int AS n FROM cad_itm WHERE cad = $1", [cad]);
  if (!valor) return { cadastroComItens: cont[0].n > 0, item: null };
  const extra = cad === "fazendas" ? " OR cod LIKE $2 || '-%'" : "";
  const { rows } = await pool.query<{ cod: string; nm: string }>(
    `SELECT cod, nm FROM cad_itm WHERE cad = $1 AND (${condCodigo("cod", 2, valor)}${extra})
      ORDER BY cod LIMIT 1`,
    [cad, valor]
  );
  return { cadastroComItens: cont[0].n > 0, item: rows[0] ?? null };
}

/** Responsável cadastrado para a região (Rodadas de Campo > Responsável Região); o código da região aceita 1 = 01. */
export async function responsavelDaRegiao(reg: string): Promise<{ cod: string; nm: string } | null> {
  const pool = getPool();
  await prepararBanco(pool);
  const norm = (v: string) => (NUMERICO.test(v.trim()) ? v.trim().replace(/^0+/, "") || "0" : v.trim().toLowerCase());
  const alvo = norm(reg);
  if (!alvo) return null;
  const { rows } = await pool.query<{ cod: string; nm: string; reg: string | null }>(
    "SELECT cod, nm, dds->>'regiao' AS reg FROM cad_itm WHERE cad = 'responsavel-regiao' ORDER BY cod"
  );
  const r = rows.find((x) => x.reg !== null && norm(String(x.reg)) === alvo);
  return r ? { cod: r.cod, nm: r.nm } : null;
}

// ---------------------------------------------------------------------------
// Cadastro de Rodadas (calendário de 8 semanas)
// ---------------------------------------------------------------------------

export async function listarRodadasCad(): Promise<RodadaCad[]> {
  const pool = getPool();
  await prepararBanco(pool);
  const { rows: rods } = await pool.query<{ rod: number; ini: string; bol: number }>(
    `SELECT c.rod, c.ini, (SELECT COUNT(*)::int FROM rod_bol b WHERE b.rod = c.rod) AS bol
       FROM rod_cad c ORDER BY c.rod DESC`
  );
  const { rows: sems } = await pool.query<{ rod: number; sem: number; ini: string; fim: string }>(
    "SELECT rod, sem, ini, fim FROM rod_sem ORDER BY rod, sem"
  );
  return rods.map((r) => ({
    rod: r.rod,
    ini: r.ini,
    boletins: r.bol,
    semanas: sems.filter((s) => s.rod === r.rod).map((s) => ({ sem: s.sem, ini: s.ini, fim: s.fim })),
  }));
}

export async function semanasDaRodada(rod: number): Promise<SemanaRodada[]> {
  const pool = getPool();
  await prepararBanco(pool);
  const { rows } = await pool.query<SemanaRodada>("SELECT sem, ini, fim FROM rod_sem WHERE rod = $1 ORDER BY sem", [rod]);
  return rows;
}

/** Cria a rodada e as 8 semanas (segunda a domingo) a partir da data informada. Refaz o calendário se a rodada já existir sem boletins. */
export async function criarRodada(rod: number, inicio: string): Promise<true | { erro: string }> {
  const pool = getPool();
  await prepararBanco(pool);
  const { rows: usos } = await pool.query<{ n: number }>("SELECT COUNT(*)::int AS n FROM rod_bol WHERE rod = $1", [rod]);
  if (usos[0].n > 0) return { erro: `A rodada ${rod} já tem boletins lançados — o calendário não pode ser refeito.` };
  const semanas = gerarSemanas(inicio);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM rod_sem WHERE rod = $1", [rod]);
    await client.query(
      `INSERT INTO rod_cad (rod, ini) VALUES ($1, $2)
       ON CONFLICT (rod) DO UPDATE SET ini = EXCLUDED.ini`,
      [rod, semanas[0].ini]
    );
    for (const s of semanas) {
      await client.query("INSERT INTO rod_sem (rod, sem, ini, fim) VALUES ($1,$2,$3,$4)", [rod, s.sem, s.ini, s.fim]);
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  return true;
}

/** Reconfigura as semanas da rodada (início e fim de cada uma). Pode ser feito mesmo com boletins lançados: eles guardam o número da semana. */
export async function atualizarSemanas(rod: number, semanas: SemanaRodada[]): Promise<true | { erro: string }> {
  const pool = getPool();
  await prepararBanco(pool);
  const { rows } = await pool.query("SELECT 1 FROM rod_cad WHERE rod = $1", [rod]);
  if (rows.length === 0) return { erro: `A rodada ${rod} não está cadastrada.` };
  if (semanas.length === 0) return { erro: "Informe pelo menos uma semana." };
  const ISO = /^\d{4}-\d{2}-\d{2}$/;
  const vistas = new Set<number>();
  for (const s of semanas) {
    if (!Number.isInteger(s.sem) || s.sem <= 0 || vistas.has(s.sem)) return { erro: "Número de semana inválido ou repetido." };
    vistas.add(s.sem);
    if (!ISO.test(s.ini) || !ISO.test(s.fim) || Number.isNaN(Date.parse(s.ini)) || Number.isNaN(Date.parse(s.fim))) {
      return { erro: `Semana ${s.sem}: informe o início e o fim.` };
    }
    if (s.fim < s.ini) return { erro: `Semana ${s.sem}: o fim não pode ser anterior ao início.` };
  }
  const ordenadas = [...semanas].sort((a, b) => a.sem - b.sem);
  for (let i = 1; i < ordenadas.length; i++) {
    if (ordenadas[i].ini <= ordenadas[i - 1].fim) {
      return { erro: `Semana ${ordenadas[i].sem} começa antes do fim da semana ${ordenadas[i - 1].sem}.` };
    }
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM rod_sem WHERE rod = $1", [rod]);
    for (const s of ordenadas) {
      await client.query("INSERT INTO rod_sem (rod, sem, ini, fim) VALUES ($1,$2,$3,$4)", [rod, s.sem, s.ini, s.fim]);
    }
    await client.query("UPDATE rod_cad SET ini = $2 WHERE rod = $1", [rod, ordenadas[0].ini]);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  return true;
}

export async function excluirRodada(rod: number): Promise<true | { erro: string }> {
  const pool = getPool();
  await prepararBanco(pool);
  const { rows } = await pool.query<{ n: number }>("SELECT COUNT(*)::int AS n FROM rod_bol WHERE rod = $1", [rod]);
  if (rows[0].n > 0) return { erro: `A rodada ${rod} tem ${rows[0].n} boletim(ns) lançado(s) e não pode ser excluída.` };
  await pool.query("DELETE FROM rod_sem WHERE rod = $1", [rod]);
  await pool.query("DELETE FROM rod_cad WHERE rod = $1", [rod]);
  return true;
}

// ---------------------------------------------------------------------------
// Apontamento (boletim)
// ---------------------------------------------------------------------------

export async function proximoBoletim(): Promise<number> {
  const pool = getPool();
  await prepararBanco(pool);
  const { rows } = await pool.query<{ n: number }>("SELECT COALESCE(MAX(bol), 0)::int + 1 AS n FROM rod_bol");
  return rows[0].n;
}

export interface TalhaoApontamento {
  tlh: string;
  area: number | null;
}

/**
 * Boletim de um lançamento: uma fazenda, com presença, nível, prioridade, uma ou
 * mais ocorrências (códigos), a recomendação e os talhões marcados.
 */
export interface BoletimApontamento {
  rod: number;
  /** data do lançamento no sistema */
  dt: string;
  /** semana da rodada, informada depois da rodada */
  sem: number;
  reg: string;
  faz: string;
  pre: string;
  niv: string;
  pri: string;
  /** códigos das ocorrências (uma ou mais) */
  ocos: string[];
  /** "Outros": ocorrência descrita em texto livre (até 100 caracteres) */
  outros?: string;
  /** texto livre, até 150 caracteres */
  rec: string;
  talhoes: TalhaoApontamento[];
}

export const LIMITE_RECOMENDACAO = 150;

/** S/SIM/1 -> SIM; N/NÃO/NAO/2 -> NÃO; vazio -> ""; qualquer outra coisa -> null. */
export function normalizarSimNao(v: string): string | null {
  const t = v.trim().toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (!t) return "";
  if (["S", "SIM", "1"].includes(t)) return "SIM";
  if (["N", "NAO", "2"].includes(t)) return "NÃO";
  return null;
}

async function validarCodigo(
  cad: string,
  rotulo: string,
  cod: string,
  obrigatorio: boolean
): Promise<{ cod: string } | { erro: string }> {
  const valor = cod.trim();
  if (!valor) return obrigatorio ? { erro: `Informe o código de ${rotulo}.` } : { cod: "" };
  const r = await buscarCodigo(cad, valor);
  if (!r.item) {
    // cadastro ainda vazio (ainda não importado): aceita o código digitado
    return r.cadastroComItens ? { erro: `${rotulo}: código ${valor} não cadastrado.` } : { cod: valor };
  }
  return { cod: r.item.cod };
}

/** Todos os itens de um cadastro de apoio (Cód + Descrição), em ordem de código. */
export async function listarCodigos(cad: string): Promise<{ cod: string; nm: string }[]> {
  const pool = getPool();
  await prepararBanco(pool);
  const { rows } = await pool.query<{ cod: string; nm: string }>(
    `SELECT cod, nm FROM cad_itm WHERE cad = $1
      ORDER BY CASE WHEN cod ~ '^[0-9]+$' THEN lpad(cod, 15, '0') ELSE cod END`,
    [cad]
  );
  return rows;
}

/**
 * Talhões da fazenda para marcar no lançamento. Vem do cadastro de talhões da
 * safra (a mais recente que tem a fazenda); se não houver, dos talhões das
 * ordens de corte e, por último, dos já lançados em boletins.
 */
export async function talhoesDaFazenda(faz: string): Promise<TalhaoApontamento[]> {
  const pool = getPool();
  await prepararBanco(pool);
  const cod = faz.trim().split("-")[0];
  if (!cod) return [];
  const ordem = "ORDER BY CASE WHEN tlh ~ '^[0-9]+$' THEN lpad(tlh, 10, '0') ELSE tlh END";
  const fontes = [
    `SELECT tlh, SUM(area_tot)::float AS area FROM saf_tlh
      WHERE faz_cod = $1 AND saf = (SELECT MAX(saf) FROM saf_tlh WHERE faz_cod = $1)
      GROUP BY tlh ${ordem}`,
    `SELECT tlh, MAX(area_ha)::float AS area FROM tlh WHERE faz_cod = $1 GROUP BY tlh ${ordem}`,
    `SELECT i.tlh, MAX(i.area)::float AS area FROM rod_itm i JOIN rod_bol b ON b.bol = i.bol
      WHERE b.faz = $1 AND i.tlh <> '' AND i.tlh !~ '[^0-9]' GROUP BY i.tlh ${ordem.replace("ORDER BY", "ORDER BY").replace(/tlh/g, "i.tlh")}`,
  ];
  for (const sql of fontes) {
    const { rows } = await pool.query<{ tlh: string; area: number | null }>(sql, [cod]);
    if (rows.length > 0) return rows.map((r) => ({ tlh: r.tlh, area: r.area }));
  }
  return [];
}

interface BoletimValidado {
  sem: number;
  reg: string;
  faz: string;
  pre: string;
  niv: string;
  pri: string;
  ocos: string[];
  outros: string;
  rec: string;
  talhoes: TalhaoApontamento[];
  resp: string;
}

/**
 * Confere um boletim antes de gravar (inclusão ou alteração): rodada e semana
 * no calendário, região, fazenda e todos os códigos nos cadastros, ocorrências,
 * recomendação (até 150 caracteres) e pelo menos um talhão. O responsável é o
 * cadastrado para a região (Rodadas de Campo > Responsável Região).
 */
async function validarBoletim(b: BoletimApontamento): Promise<BoletimValidado | { erro: string }> {
  const semanas = await semanasDaRodada(b.rod);
  if (semanas.length === 0) return { erro: `A rodada ${b.rod} não está cadastrada.` };
  const sem = b.sem;
  if (!semanas.some((s) => s.sem === sem)) return { erro: `A semana ${sem || ""} não existe na rodada ${b.rod}.`.replace("  ", " ") };

  const reg = await validarCodigo("regiao", "Região", b.reg, true);
  if ("erro" in reg) return reg;
  const faz = await validarCodigo("fazendas", "Fazenda", b.faz, true);
  if ("erro" in faz) return faz;
  const pre = await validarCodigo("presenca-infestacao", "Presença de infestação", b.pre, false);
  if ("erro" in pre) return pre;
  const niv = await validarCodigo("nivel-infestacao", "Nível de infestação", b.niv, false);
  if ("erro" in niv) return niv;
  const pri = await validarCodigo("prioridade", "Prioridade", b.pri, false);
  if ("erro" in pri) return pri;

  const outros = (b.outros ?? "").replace(/\s+/g, " ").trim();
  if (b.ocos.length === 0 && !outros) return { erro: "Informe pelo menos uma ocorrência (marque na lista ou use Outros)." };
  if (outros.length > 100) return { erro: "O texto de Outros passa de 100 caracteres." };
  const ocos: string[] = [];
  for (const o of b.ocos) {
    const v = await validarCodigo("ocorrencias", "Ocorrência", o, true);
    if ("erro" in v) return v;
    if (!ocos.includes(v.cod)) ocos.push(v.cod);
  }

  const rec = b.rec.replace(/\s+/g, " ").trim();
  if (rec.length > LIMITE_RECOMENDACAO) return { erro: `A recomendação passa de ${LIMITE_RECOMENDACAO} caracteres.` };

  const talhoes = b.talhoes.filter((t) => t.tlh.trim());
  if (talhoes.length === 0) return { erro: "Marque pelo menos um talhão." };

  const resp = (await responsavelDaRegiao(reg.cod))?.nm ?? "";
  return { sem, reg: reg.cod, faz: faz.cod, pre: pre.cod, niv: niv.cod, pri: pri.cod, ocos, outros, rec, talhoes, resp };
}

// ---------------------------------------------------------------------------
// Boletim lançado: consulta, alteração, exclusão e log
// ---------------------------------------------------------------------------

export interface BoletimCompleto {
  bol: number;
  rod: number;
  dt: string;
  sem: number;
  reg: string;
  resp: string;
  faz: string;
  /** "apontamento" (lançado no sistema) ou "importacao" (planilha) */
  ori: string;
  usr: string;
  itens: { oco: string; ocoTxt: string; pre: string; niv: string; pri: string; tlh: string; area: number | null; rec: string }[];
}

export async function obterBoletim(bol: number): Promise<BoletimCompleto | null> {
  const pool = getPool();
  await prepararBanco(pool);
  const { rows } = await pool.query<{ bol: number; rod: number; dt: string; sem: number; reg: string; resp: string; faz: string; ori: string; usr: string }>(
    "SELECT bol, rod, dt, sem, reg, resp, faz, ori, usr FROM rod_bol WHERE bol = $1",
    [bol]
  );
  if (rows.length === 0) return null;
  const { rows: itens } = await pool.query<{ oco: string; oco_txt: string; pre: string; niv: string; pri: string; tlh: string; area: number | null; rec: string }>(
    "SELECT oco, oco_txt, pre, niv, pri, tlh, area::float AS area, rec FROM rod_itm WHERE bol = $1 ORDER BY seq",
    [bol]
  );
  return {
    ...rows[0],
    itens: itens.map((i) => ({ oco: i.oco, ocoTxt: i.oco_txt, pre: i.pre, niv: i.niv, pri: i.pri, tlh: i.tlh, area: i.area, rec: i.rec })),
  };
}

async function registrarLog(
  client: PoolClient,
  bol: number,
  acao: "inclusao" | "alteracao" | "exclusao",
  usuario: string,
  antes: BoletimCompleto | null,
  depois: BoletimCompleto | null
) {
  await client.query("INSERT INTO rod_log (bol, acao, usr, antes, depois) VALUES ($1,$2,$3,$4::jsonb,$5::jsonb)", [
    bol,
    acao,
    usuario,
    antes ? JSON.stringify(antes) : null,
    depois ? JSON.stringify(depois) : null,
  ]);
}

async function lerBoletim(client: PoolClient, bol: number): Promise<BoletimCompleto | null> {
  const { rows } = await client.query<{ bol: number; rod: number; dt: string; sem: number; reg: string; resp: string; faz: string; ori: string; usr: string }>(
    "SELECT bol, rod, dt, sem, reg, resp, faz, ori, usr FROM rod_bol WHERE bol = $1",
    [bol]
  );
  if (rows.length === 0) return null;
  const { rows: itens } = await client.query<{ oco: string; oco_txt: string; pre: string; niv: string; pri: string; tlh: string; area: number | null; rec: string }>(
    "SELECT oco, oco_txt, pre, niv, pri, tlh, area::float AS area, rec FROM rod_itm WHERE bol = $1 ORDER BY seq",
    [bol]
  );
  return {
    ...rows[0],
    itens: itens.map((i) => ({ oco: i.oco, ocoTxt: i.oco_txt, pre: i.pre, niv: i.niv, pri: i.pri, tlh: i.tlh, area: i.area, rec: i.rec })),
  };
}

/**
 * Grava um boletim novo. O número do boletim é sempre o último + 1 (gravação
 * serializada, sem repetir). Cada talhão marcado vira uma linha do boletim, com
 * as mesmas ocorrências, presença, nível, prioridade e recomendação.
 */
export async function gravarBoletim(b: BoletimApontamento, usuario: string): Promise<{ bol: number; sem: number } | { erro: string }> {
  const pool = getPool();
  await prepararBanco(pool);
  const v = await validarBoletim(b);
  if ("erro" in v) return v;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("LOCK TABLE rod_bol IN SHARE ROW EXCLUSIVE MODE");
    const { rows } = await client.query<{ n: number }>("SELECT COALESCE(MAX(bol), 0)::int + 1 AS n FROM rod_bol");
    const bol = rows[0].n;
    await client.query(
      `INSERT INTO rod_bol (bol, rod, dt, sem, reg, resp, faz, ori, usr) VALUES ($1,$2,$3,$4,$5,$6,$7,'apontamento',$8)`,
      [bol, b.rod, b.dt, v.sem, v.reg, v.resp, v.faz, usuario]
    );
    for (let n = 0; n < v.talhoes.length; n++) {
      const t = v.talhoes[n];
      await client.query(
        `INSERT INTO rod_itm (bol, seq, oco, oco_txt, pre, niv, pri, tlh, area, rec) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [bol, n + 1, v.ocos.join(","), v.outros, v.pre, v.niv, v.pri, t.tlh.trim(), t.area, v.rec]
      );
    }
    await registrarLog(client, bol, "inclusao", usuario, null, await lerBoletim(client, bol));
    await client.query("COMMIT");
    return { bol, sem: v.sem };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

/** Altera um boletim lançado no Apontamento (a data do lançamento não muda). Guarda no log o antes e o depois. */
export async function atualizarBoletim(bol: number, b: BoletimApontamento, usuario: string): Promise<{ bol: number; sem: number } | { erro: string }> {
  const pool = getPool();
  await prepararBanco(pool);
  const atual = await obterBoletim(bol);
  if (!atual) return { erro: `O boletim ${bol} não existe.` };
  if (atual.ori !== "apontamento") return { erro: `O boletim ${bol} veio da importação da planilha e não pode ser alterado aqui (só excluído).` };
  const v = await validarBoletim(b);
  if ("erro" in v) return v;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const antes = await lerBoletim(client, bol);
    await client.query("UPDATE rod_bol SET rod = $2, sem = $3, reg = $4, resp = $5, faz = $6 WHERE bol = $1", [bol, b.rod, v.sem, v.reg, v.resp, v.faz]);
    await client.query("DELETE FROM rod_itm WHERE bol = $1", [bol]);
    for (let n = 0; n < v.talhoes.length; n++) {
      const t = v.talhoes[n];
      await client.query(
        `INSERT INTO rod_itm (bol, seq, oco, oco_txt, pre, niv, pri, tlh, area, rec) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [bol, n + 1, v.ocos.join(","), v.outros, v.pre, v.niv, v.pri, t.tlh.trim(), t.area, v.rec]
      );
    }
    await registrarLog(client, bol, "alteracao", usuario, antes, await lerBoletim(client, bol));
    await client.query("COMMIT");
    return { bol, sem: v.sem };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

/** Exclui o boletim e todas as suas linhas. O log guarda o conteúdo que existia, com data, hora e usuário. */
export async function excluirBoletim(bol: number, usuario: string): Promise<true | { erro: string }> {
  const pool = getPool();
  await prepararBanco(pool);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const antes = await lerBoletim(client, bol);
    if (!antes) {
      await client.query("ROLLBACK");
      return { erro: `O boletim ${bol} não existe.` };
    }
    await registrarLog(client, bol, "exclusao", usuario, antes, null);
    await client.query("DELETE FROM rod_itm WHERE bol = $1", [bol]);
    await client.query("DELETE FROM rod_bol WHERE bol = $1", [bol]);
    await client.query("COMMIT");
    return true;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export interface RegistroLog {
  id: number;
  bol: number;
  acao: string;
  usuario: string;
  /** timestamp ISO */
  em: string;
  resumo: string;
}

const ROTULO_ACAO: Record<string, string> = { inclusao: "Inclusão", alteracao: "Alteração", exclusao: "Exclusão" };

function descrever(b: BoletimCompleto | null): string {
  if (!b) return "";
  const tlhs = b.itens.map((i) => i.tlh).join(", ");
  const oco = [b.itens[0]?.oco, b.itens[0]?.ocoTxt ? `Outros: ${b.itens[0].ocoTxt}` : ""].filter(Boolean).join(" + ");
  return `Rodada ${b.rod}, semana ${b.sem}, região ${b.reg}, fazenda ${b.faz}, talhões ${tlhs || "—"}, ocorrência(s) ${oco || "—"}, prioridade ${b.itens[0]?.pri || "—"}, nível ${b.itens[0]?.niv || "—"}, presença ${b.itens[0]?.pre || "—"}`;
}

/** Log de inclusões, alterações e exclusões de boletins (do boletim informado, ou os mais recentes de todos). */
export async function listarLogBoletins(bol?: number, limite = 200): Promise<RegistroLog[]> {
  const pool = getPool();
  await prepararBanco(pool);
  const { rows } = await pool.query<{ id: string; bol: number; acao: string; usr: string; em: string; antes: BoletimCompleto | null; depois: BoletimCompleto | null }>(
    `SELECT id, bol, acao, usr, to_char(em AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI:SS') AS em, antes, depois
       FROM rod_log ${bol ? "WHERE bol = $2" : ""} ORDER BY em DESC, id DESC LIMIT $1`,
    bol ? [limite, bol] : [limite]
  );
  return rows.map((r) => ({
    id: Number(r.id),
    bol: r.bol,
    acao: ROTULO_ACAO[r.acao] ?? r.acao,
    usuario: r.usr,
    em: r.em,
    resumo:
      r.acao === "alteracao"
        ? `Antes: ${descrever(r.antes)} | Depois: ${descrever(r.depois)}`
        : descrever(r.acao === "exclusao" ? r.antes : r.depois),
  }));
}

// ---------------------------------------------------------------------------
// Importação da planilha de levantamento
// ---------------------------------------------------------------------------

function periodoDaSemana(txt: string): { ini: string; fim: string } | null {
  const m = txt.match(/(\d{2})\/(\d{2})\/(\d{4}).*?(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? { ini: `${m[3]}-${m[2]}-${m[1]}`, fim: `${m[6]}-${m[5]}-${m[4]}` } : null;
}

const numerico = (v: string) => (NUMERICO.test(v) ? Number(v) : Number.MAX_SAFE_INTEGER);

export interface ResultadoImportacaoRodadas {
  boletins: number;
  itens: number;
  jaImportados: number;
  rodadasCriadas: number[];
  primeiroBoletim: number | null;
  ultimoBoletim: number | null;
}

/**
 * Importa as linhas da planilha. Ordem: Rodada, Data, Região, Semana, Fazenda.
 * Cada combinação vira um boletim, numerado sempre a partir do último + 1.
 * Combinações já importadas (mesma rodada, data, região, semana e fazenda) são
 * puladas, então reimportar o mesmo arquivo não duplica nada. Rodadas que ainda
 * não existem no cadastro são criadas com as semanas informadas na planilha.
 */
export async function importarRodadasCampo(linhas: LinhaRodadaImportada[]): Promise<ResultadoImportacaoRodadas> {
  const pool = getPool();
  await prepararBanco(pool);

  const ordenadas = [...linhas].sort(
    (a, b) =>
      a.rod - b.rod ||
      a.dt.localeCompare(b.dt) ||
      numerico(a.reg) - numerico(b.reg) ||
      a.reg.localeCompare(b.reg) ||
      a.sem - b.sem ||
      numerico(a.faz) - numerico(b.faz) ||
      a.faz.localeCompare(b.faz) ||
      numerico(a.tlh) - numerico(b.tlh) ||
      a.tlh.localeCompare(b.tlh)
  );
  const grupos = new Map<string, LinhaRodadaImportada[]>();
  for (const l of ordenadas) {
    const k = `${l.rod}|${l.dt}|${l.reg}|${l.sem}|${l.faz}`;
    const g = grupos.get(k);
    if (g) g.push(l);
    else grupos.set(k, [l]);
  }

  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("LOCK TABLE rod_bol IN SHARE ROW EXCLUSIVE MODE");

    const { rows: exist } = await client.query<{ k: string }>(
      "SELECT rod || '|' || to_char(dt, 'YYYY-MM-DD') || '|' || reg || '|' || sem || '|' || faz AS k FROM rod_bol"
    );
    const jaTem = new Set(exist.map((r) => r.k));
    const { rows: mx } = await client.query<{ n: number }>("SELECT COALESCE(MAX(bol), 0)::int AS n FROM rod_bol");
    let proximo = mx[0].n + 1;

    const bols: { bol: number; l: LinhaRodadaImportada }[] = [];
    const itens: { bol: number; seq: number; l: LinhaRodadaImportada }[] = [];
    let jaImportados = 0;
    for (const [k, g] of grupos) {
      if (jaTem.has(k)) {
        jaImportados++;
        continue;
      }
      const bol = proximo++;
      bols.push({ bol, l: g[0] });
      g.forEach((l, i) => itens.push({ bol, seq: i + 1, l }));
    }

    for (let i = 0; i < bols.length; i += 2000) {
      const lote = bols.slice(i, i + 2000);
      await client.query(
        `INSERT INTO rod_bol (bol, rod, dt, sem, reg, resp, faz, ori, usr)
         SELECT * FROM unnest($1::int[], $2::int[], $3::date[], $4::int[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[])`,
        [
          lote.map((x) => x.bol),
          lote.map((x) => x.l.rod),
          lote.map((x) => x.l.dt),
          lote.map((x) => x.l.sem),
          lote.map((x) => x.l.reg),
          lote.map((x) => x.l.resp),
          lote.map((x) => x.l.faz),
          lote.map(() => "importacao"),
          lote.map(() => ""),
        ]
      );
    }
    for (let i = 0; i < itens.length; i += 2000) {
      const lote = itens.slice(i, i + 2000);
      await client.query(
        `INSERT INTO rod_itm (bol, seq, oco_txt, tlh, area, rec, ext)
         SELECT x.bol, x.seq, x.oco_txt, x.tlh, x.area, x.rec, x.ext
           FROM jsonb_to_recordset($1::jsonb) AS x(bol int, seq int, oco_txt text, tlh text, area numeric, rec text, ext jsonb)`,
        [
          JSON.stringify(
            lote.map((x) => ({ bol: x.bol, seq: x.seq, oco_txt: x.l.oco, tlh: x.l.tlh, area: x.l.area, rec: x.l.rec, ext: x.l.ext }))
          ),
        ]
      );
    }

    // rodadas que ainda não estão no cadastro: criadas com as semanas da planilha
    const { rows: cadRods } = await client.query<{ rod: number }>("SELECT rod FROM rod_cad");
    const existentes = new Set(cadRods.map((r) => r.rod));
    const rodadasCriadas: number[] = [];
    const porRodada = new Map<number, LinhaRodadaImportada[]>();
    for (const l of linhas) {
      const arr = porRodada.get(l.rod);
      if (arr) arr.push(l);
      else porRodada.set(l.rod, [l]);
    }
    for (const [rod, ls] of [...porRodada].sort((a, b) => a[0] - b[0])) {
      if (existentes.has(rod)) continue;
      // período mais frequente de cada semana
      const freq = new Map<number, Map<string, number>>();
      for (const l of ls) {
        const p = periodoDaSemana(l.periodo);
        if (!p || !l.sem) continue;
        const chave = `${p.ini}|${p.fim}`;
        const m = freq.get(l.sem) ?? new Map<string, number>();
        m.set(chave, (m.get(chave) ?? 0) + 1);
        freq.set(l.sem, m);
      }
      let semanas: SemanaRodada[] = [...freq]
        .map(([sem, m]) => {
          const [ini, fim] = [...m].sort((a, b) => b[1] - a[1])[0][0].split("|");
          return { sem, ini, fim };
        })
        .sort((a, b) => a.sem - b.sem);
      if (semanas.length === 0) {
        const menor = ls.map((l) => l.dt).sort()[0];
        semanas = gerarSemanas(segundaDaSemana(menor));
      }
      // completa até a semana 8, seguindo de 7 em 7 dias
      while (semanas.length < SEMANAS_POR_RODADA) {
        const ult = semanas[semanas.length - 1];
        semanas.push({ sem: ult.sem + 1, ini: somarDias(ult.fim, 1), fim: somarDias(ult.fim, 7) });
      }
      await client.query("INSERT INTO rod_cad (rod, ini) VALUES ($1, $2) ON CONFLICT (rod) DO NOTHING", [rod, semanas[0].ini]);
      for (const s of semanas) {
        await client.query("INSERT INTO rod_sem (rod, sem, ini, fim) VALUES ($1,$2,$3,$4) ON CONFLICT (rod, sem) DO NOTHING", [
          rod,
          s.sem,
          s.ini,
          s.fim,
        ]);
      }
      rodadasCriadas.push(rod);
    }

    await client.query("COMMIT");
    return {
      boletins: bols.length,
      itens: itens.length,
      jaImportados,
      rodadasCriadas,
      primeiroBoletim: bols[0]?.bol ?? null,
      ultimoBoletim: bols.length ? bols[bols.length - 1].bol : null,
    };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Resumo
// ---------------------------------------------------------------------------

export interface FiltroResumoRodadas {
  rod?: number;
  reg?: string;
  sem?: number;
  faz?: string;
  /** importacao | apontamento */
  ori?: string;
  q?: string;
}

export interface ResumoRodadas {
  total: number;
  boletins: number;
  areaHa: number;
  linhas: LinhaResumoRodada[];
}

const JOINS = `
  FROM rod_itm i
  JOIN rod_bol b ON b.bol = i.bol
  LEFT JOIN cad_itm rg ON rg.cad = 'regiao'
    AND (rg.cod = b.reg OR (rg.cod ~ '^[0-9]+$' AND b.reg ~ '^[0-9]+$' AND ltrim(rg.cod, '0') = ltrim(b.reg, '0')))
  LEFT JOIN LATERAL (
    SELECT nm FROM cad_itm WHERE cad = 'fazendas' AND (cod = b.faz OR cod LIKE b.faz || '-%') ORDER BY cod LIMIT 1
  ) fz ON true
  LEFT JOIN cad_itm pr ON pr.cad = 'presenca-infestacao' AND pr.cod = i.pre
  LEFT JOIN cad_itm nv ON nv.cad = 'nivel-infestacao' AND nv.cod = i.niv
  LEFT JOIN cad_itm pi ON pi.cad = 'prioridade' AND pi.cod = i.pri`;

export async function resumoRodadas(f: FiltroResumoRodadas, pagina: number, tamanho: number): Promise<ResumoRodadas> {
  const pool = getPool();
  await prepararBanco(pool);
  const cond: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, v: unknown) => {
    params.push(v);
    cond.push(sql.replace("?", `$${params.length}`));
  };
  if (f.rod) add("b.rod = ?", f.rod);
  if (f.reg) add("b.reg = ?", f.reg);
  if (f.sem) add("b.sem = ?", f.sem);
  if (f.faz) add("b.faz = ?", f.faz);
  if (f.ori === "importacao" || f.ori === "apontamento") add("b.ori = ?", f.ori);
  if (f.q && f.q.trim()) {
    params.push(`%${f.q.trim().replace(/[%_\\]/g, (c) => `\\${c}`)}%`);
    const pl = params.length;
    params.push(f.q.trim());
    const pe = params.length;
    cond.push(
      `(concat_ws(', ', NULLIF((SELECT string_agg(c.nm, ', ' ORDER BY u.ord)                 FROM unnest(string_to_array(i.oco, ',')) WITH ORDINALITY AS u(cod, ord)                 JOIN cad_itm c ON c.cad = 'ocorrencias' AND c.cod = trim(u.cod)), ''), NULLIF(i.oco_txt, '')) ILIKE $${pl} OR i.rec ILIKE $${pl} OR fz.nm ILIKE $${pl} OR b.faz ILIKE $${pl} OR i.tlh ILIKE $${pl} OR b.resp ILIKE $${pl} OR b.bol::text = $${pe})`
    );
  }
  const where = cond.length ? `WHERE ${cond.join(" AND ")}` : "";

  const { rows: tot } = await pool.query<{ n: number; b: number; a: number | null }>(
    `SELECT COUNT(*)::int AS n, COUNT(DISTINCT b.bol)::int AS b, SUM(i.area)::float AS a ${JOINS} ${where}`,
    params
  );
  const { rows } = await pool.query<{
    bol: number; rod: number; dt: string; sem: number; reg: string; reg_nm: string | null; resp: string; ori: string; usr: string; faz: string;
    faz_nm: string | null; tlh: string; area: number | null; oco: string; pre: string | null; niv: string | null;
    pri: string | null; rec: string; ati: string | null; exe: string | null;
  }>(
    `SELECT b.bol, b.rod, b.dt, b.sem, b.reg, rg.nm AS reg_nm, b.resp, b.ori, b.usr, b.faz, fz.nm AS faz_nm, i.tlh, i.area::float AS area,
            concat_ws(', ', NULLIF((SELECT string_agg(c.nm, ', ' ORDER BY u.ord)
                FROM unnest(string_to_array(i.oco, ',')) WITH ORDINALITY AS u(cod, ord)
                JOIN cad_itm c ON c.cad = 'ocorrencias' AND c.cod = trim(u.cod)), ''), NULLIF(i.oco_txt, '')) AS oco, pr.nm AS pre, nv.nm AS niv, pi.nm AS pri, i.rec,
            i.ext->>'ATIVIDADE' AS ati, i.ext->>'FEITO - SIM/NÃO' AS exe
       ${JOINS} ${where}
      ORDER BY b.rod, b.dt, NULLIF(regexp_replace(b.reg, '\\D', '', 'g'), '')::int NULLS LAST, b.reg, b.sem,
               NULLIF(regexp_replace(b.faz, '\\D', '', 'g'), '')::bigint NULLS LAST, b.faz, b.bol, i.seq
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, tamanho, Math.max(0, (pagina - 1) * tamanho)]
  );
  return {
    total: tot[0].n,
    boletins: tot[0].b,
    areaHa: tot[0].a ?? 0,
    linhas: rows.map((r) => ({
      bol: r.bol,
      rod: r.rod,
      dt: r.dt,
      sem: r.sem,
      reg: r.reg,
      regNm: r.reg_nm ?? "",
      resp: r.resp,
      origem: r.ori === "apontamento" ? "Apontamento" : "Importação",
      lancadoPor: r.usr,
      faz: r.faz,
      fazNm: r.faz_nm ?? "",
      tlh: r.tlh,
      area: r.area,
      ocorrencia: r.oco,
      presenca: r.pre ?? "",
      nivel: r.niv ?? "",
      prioridade: r.pri ?? "",
      rec: r.rec,
      atividade: r.ati ?? "",
      executado: r.exe ?? "",
    })),
  };
}

export async function opcoesResumoRodadas(): Promise<{ rodadas: number[]; regioes: string[]; semanas: number[] }> {
  const pool = getPool();
  await prepararBanco(pool);
  const r1 = await pool.query<{ v: number }>("SELECT DISTINCT rod AS v FROM rod_bol ORDER BY 1");
  const r2 = await pool.query<{ v: string }>(
    "SELECT reg AS v FROM (SELECT DISTINCT reg FROM rod_bol WHERE reg <> '') x ORDER BY NULLIF(regexp_replace(reg, '\\D', '', 'g'), '')::int NULLS LAST, reg"
  );
  const r3 = await pool.query<{ v: number }>("SELECT DISTINCT sem AS v FROM rod_bol WHERE sem > 0 ORDER BY 1");
  return { rodadas: r1.rows.map((r) => r.v), regioes: r2.rows.map((r) => r.v), semanas: r3.rows.map((r) => r.v) };
}

// ---------------------------------------------------------------------------
// Padronização das ocorrências importadas (texto livre -> itens do cadastro)
// ---------------------------------------------------------------------------

export interface PreviaPadronizacao {
  /** linhas importadas ainda com a ocorrência só em texto */
  linhas: number;
  textos: number;
  /** tudo reconhecido (nada sobra para "Outros") */
  completas: number;
  /** reconhecidas em parte: itens do cadastro + sobra em "Outros" */
  parciais: number;
  /** nenhum item reconhecido: o texto inteiro fica em "Outros" */
  soOutros: number;
  /** o texto não descreve ocorrência (ex.: "SEM OBSERVAÇÃO"): fica em branco */
  semOcorrencia: number;
  exemplos: { texto: string; linhas: number; itens: string[]; outros: string }[];
  sobras: { texto: string; linhas: number }[];
}

async function textosPendentes(): Promise<{ t: string; n: number }[]> {
  const pool = getPool();
  await prepararBanco(pool);
  const { rows } = await pool.query<{ t: string; n: number }>(
    `SELECT i.oco_txt AS t, COUNT(*)::int AS n
       FROM rod_itm i JOIN rod_bol b ON b.bol = i.bol
      WHERE b.ori = 'importacao' AND i.oco = '' AND i.oco_txt <> '' AND NOT (i.ext ? 'OCORRENCIA_ORIGINAL')
      GROUP BY i.oco_txt`
  );
  return rows;
}

function classificar(textos: { t: string; n: number }[], cadastro: { cod: string; nm: string }[]) {
  const indice = montarIndice(cadastro);
  return textos.map((x) => ({ ...x, r: interpretar(x.t, indice) as Interpretacao }));
}

export async function previaPadronizarOcorrencias(): Promise<PreviaPadronizacao | { erro: string }> {
  const cadastro = await listarCodigos("ocorrencias");
  if (cadastro.length === 0) return { erro: "O Cadastro de Ocorrências está vazio. Cadastre ou importe as ocorrências antes de padronizar." };
  const nomes = new Map(cadastro.map((c) => [c.cod, c.nm]));
  const itens = classificar(await textosPendentes(), cadastro);
  const prev: PreviaPadronizacao = { linhas: 0, textos: itens.length, completas: 0, parciais: 0, soOutros: 0, semOcorrencia: 0, exemplos: [], sobras: [] };
  const sobras = new Map<string, number>();
  for (const x of itens) {
    prev.linhas += x.n;
    if (x.r.nenhuma) prev.semOcorrencia += x.n;
    else if (x.r.cods.length === 0) prev.soOutros += x.n;
    else if (x.r.outros) prev.parciais += x.n;
    else prev.completas += x.n;
    if (x.r.outros) sobras.set(x.r.outros, (sobras.get(x.r.outros) ?? 0) + x.n);
  }
  prev.exemplos = [...itens]
    .sort((a, b) => b.n - a.n)
    .slice(0, 40)
    .map((x) => ({ texto: x.t, linhas: x.n, itens: x.r.cods.map((c) => `${c} · ${nomes.get(c) ?? c}`), outros: x.r.outros }));
  prev.sobras = [...sobras].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([texto, linhas]) => ({ texto, linhas }));
  return prev;
}

/**
 * Converte a ocorrência em texto das linhas importadas para os itens do
 * cadastro (o que não for reconhecido fica em "Outros"). O texto original é
 * guardado em cada linha (OCORRENCIA_ORIGINAL), então nada se perde e a
 * conversão não se repete sobre linhas já convertidas.
 */
export async function aplicarPadronizarOcorrencias(): Promise<{ linhas: number; textos: number } | { erro: string }> {
  const cadastro = await listarCodigos("ocorrencias");
  if (cadastro.length === 0) return { erro: "O Cadastro de Ocorrências está vazio. Cadastre ou importe as ocorrências antes de padronizar." };
  const itens = classificar(await textosPendentes(), cadastro);
  if (itens.length === 0) return { linhas: 0, textos: 0 };
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rowCount } = await client.query(
      `UPDATE rod_itm i
          SET oco = x.cods, oco_txt = x.outros, ext = i.ext || jsonb_build_object('OCORRENCIA_ORIGINAL', i.oco_txt)
         FROM unnest($1::text[], $2::text[], $3::text[]) AS x(orig, cods, outros)
        WHERE i.oco = '' AND i.oco_txt = x.orig AND NOT (i.ext ? 'OCORRENCIA_ORIGINAL')
          AND i.bol IN (SELECT bol FROM rod_bol WHERE ori = 'importacao')`,
      [itens.map((x) => x.t), itens.map((x) => x.r.cods.join(",")), itens.map((x) => x.r.outros)]
    );
    await client.query("COMMIT");
    return { linhas: rowCount ?? 0, textos: itens.length };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
