import { auditar } from "./auditar";
import { nomeComparavel } from "./cadastros-ref";
import { codigoOperacao, GRUPO_OUTRAS, somarValores, vazio } from "./dashboard-atividades";
import { getPool, listSafrasCadastro, prepararBanco } from "./db";
import { prepararAtividades } from "./db-atividades";
import { carregarCadastrosExportados } from "./db-cadastros-carga";
import { carregarApontamentosWhatsappIniciais } from "./db-import-whatsapp";
import { nomeOperacao, operacoesDoCadastro } from "./db-operacoes";
import { addDays, startOfMonth, startOfWeekMonday } from "./period";
import { escolherSafraVigente } from "./safra-cadastro";

/** Cadastro (Configurações › Cadastros) com o grupo de cada operação no dashboard. */
const CAD_GRUPOS = "grupos-operacoes";
const ENTIDADE_LOG = "Cadastro de Grupos de Operações";
/** Cadastro dos grupos (código, nome e ordem no dashboard): o grupo de cada operação aponta para ele pelo código. */
const CAD_GRUPOS_DASH = "grupos-dashboard";
const ENTIDADE_LOG_DASH = "Cadastro de Grupo Op. Dashboard";
const MARCA_GRUPOS_DASH = "Grupos das operações passam para o cadastro Grupo Op. Dashboard";

let preparado = null;

/**
 * Os grupos das operações ficam no cadastro Grupos de Operações, e cada grupo no cadastro Grupo Op. Dashboard.
 * Uma vez só: a tabela antiga (atv_grp) é desfeita e os grupos digitados como texto viram itens do Grupo Op. Dashboard.
 */
async function prepararGrupos(pool) {
  await prepararBanco(pool);
  if (!preparado) {
    preparado = (async () => {
      await desfazerTabelaAntiga(pool);
      await passarGruposParaCadastro(pool);
    })().catch((err) => {
      preparado = null;
      throw err;
    });
  }
  await preparado;
}

/** Tabela antiga (atv_grp): os grupos da carga inicial da planilha CALL saem e só os ajustes de usuários passam para o cadastro. */
async function desfazerTabelaAntiga(pool) {
  const existe = (await pool.query("SELECT to_regclass('atv_grp')::text AS t")).rows[0].t;
  if (!existe) return;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('atv_grp_para_cadastro'))");
    if ((await client.query("SELECT to_regclass('atv_grp')::text AS t")).rows[0].t) {
      const cadOps = await operacoesDoCadastro(pool);
      const ajustes = (await client.query("SELECT op_cod, grp, ord, atu_usr FROM atv_grp WHERE atu_usr <> 'Carga inicial'")).rows;
      for (const a of ajustes) {
        const op = cadOps.get(codigoOperacao(a.op_cod));
        const dds = { operacao: op?.cod ?? a.op_cod, operacao_nm: op?.nm ?? "", classificacao: op?.classificacao ?? "", grupo: a.grp, ordem: a.ord };
        await client.query(
          "INSERT INTO cad_itm (cad, cod, nm, dds, usr, atu_usr) VALUES ($1, $2, $3, $4::jsonb, $5, $5) ON CONFLICT (cad, cod) DO NOTHING",
          [CAD_GRUPOS, dds.operacao, a.grp, JSON.stringify(dds), a.atu_usr],
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
}

/** Letras acentuadas de um nome (para preferir "CATAÇÃO QUÍMICA" a "CATAÇAO QUIMICA" ao juntar grafias). */
const acentos = (s) => (s.normalize("NFD").match(/[\u0300-\u036f]/g) ?? []).length;
const numeroOuNull = (v) => (v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null);

/**
 * Uma vez só: os grupos que estavam digitados como texto em Grupos de Operações viram itens do cadastro Grupo Op.
 * Dashboard (grafias que só diferem em acento, maiúsculas ou espaços viram um grupo só, com a grafia acentuada; a ordem
 * é a menor que o grupo tinha) e cada operação passa a guardar o código do grupo.
 */
async function passarGruposParaCadastro(pool) {
  const marcado = async (exec) =>
    ((await exec.query("SELECT 1 FROM aud_log WHERE modulo = 'Cadastros' AND entidade = $1 AND chave = $2 LIMIT 1", [ENTIDADE_LOG_DASH, MARCA_GRUPOS_DASH]))
      .rowCount ?? 0) > 0;
  if (await marcado(pool)) return;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('grupos_para_grupo_op_dashboard'))");
    if (await marcado(client)) {
      await client.query("COMMIT");
      return;
    }
    const ops = (await client.query("SELECT cod, nm, dds FROM cad_itm WHERE cad = $1", [CAD_GRUPOS])).rows;
    const existentes = (await client.query("SELECT cod, nm, dds FROM cad_itm WHERE cad = $1", [CAD_GRUPOS_DASH])).rows;
    const porCodigo = new Map(existentes.map((g) => [codigoOperacao(g.cod), g]));
    const porNome = new Map(existentes.map((g) => [nomeComparavel(g.nm), g]));

    // nomes digitados nas operações, juntando as grafias equivalentes
    const novos = new Map();
    for (const o of ops) {
      const g = String(o.dds?.grupo ?? "").trim();
      if (!g || porCodigo.has(codigoOperacao(g))) continue;
      const k = nomeComparavel(g);
      if (porNome.has(k)) continue;
      if (!novos.has(k)) novos.set(k, { grafias: new Map(), ordem: null });
      const n = novos.get(k);
      n.grafias.set(g, (n.grafias.get(g) ?? 0) + 1);
      const ord = numeroOuNull(o.dds?.ordem);
      if (ord !== null) n.ordem = n.ordem === null ? ord : Math.min(n.ordem, ord);
    }
    const lista = [...novos.values()]
      .map((n) => {
        const nome = [...n.grafias.entries()].sort((a, b) => acentos(b[0]) - acentos(a[0]) || b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
        return { nome: nome.replace(/\s+/g, " ").toUpperCase(), ordem: n.ordem, grafias: [...n.grafias.keys()] };
      })
      .sort((a, b) => (a.ordem ?? Infinity) - (b.ordem ?? Infinity) || a.nome.localeCompare(b.nome));
    let proximo = Math.max(0, ...existentes.map((g) => Number(g.cod)).filter(Number.isFinite)) + 1;
    let maiorOrdem = Math.max(0, ...existentes.map((g) => numeroOuNull(g.dds?.ordem) ?? 0), ...lista.map((g) => g.ordem ?? 0));
    for (const g of lista) {
      const cod = String(proximo++);
      if (g.ordem === null) g.ordem = maiorOrdem += 10;
      const dds = { codigo: cod, grupo: g.nome, ordem: String(g.ordem) };
      await client.query("INSERT INTO cad_itm (cad, cod, nm, dds, usr, atu_usr) VALUES ($1, $2, $3, $4::jsonb, 'Sistema', 'Sistema')", [
        CAD_GRUPOS_DASH,
        cod,
        g.nome,
        JSON.stringify(dds),
      ]);
      // só pelo nome: o código novo não entra em porCodigo, senão um grupo digitado como número ("1") cairia no grupo
      // que acabou de receber esse código, e não no dele
      porNome.set(nomeComparavel(g.nome), { cod, nm: g.nome, dds });
    }

    // cada operação guarda o código do grupo (e o nome e a ordem, que a lista também lê na hora): o texto vale como
    // código só se já era código de um grupo cadastrado antes (como no laço acima); senão, é o nome
    let operacoes = 0;
    for (const o of ops) {
      const g = String(o.dds?.grupo ?? "").trim();
      if (!g) continue;
      const item = porCodigo.get(codigoOperacao(g)) ?? porNome.get(nomeComparavel(g));
      if (!item) continue;
      const dds = { ...o.dds, grupo: item.cod, grupo_nm: item.nm, ordem: String(item.dds?.ordem ?? "") };
      await client.query("UPDATE cad_itm SET nm = $3, dds = $4::jsonb WHERE cad = $1 AND cod = $2", [CAD_GRUPOS, o.cod, item.nm, JSON.stringify(dds)]);
      operacoes++;
    }
    await auditar(client, {
      usuario: "Sistema",
      modulo: "Cadastros",
      entidade: ENTIDADE_LOG_DASH,
      chave: MARCA_GRUPOS_DASH,
      acao: "importacao",
      depois: {
        grupos: lista.length,
        operacoes,
        juntados: lista.filter((g) => g.grafias.length > 1).map((g) => `${g.nome} (${g.grafias.join(" / ")})`).join("; ") || "nenhum",
      },
    });
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Grupos do cadastro Grupo Op. Dashboard (código sem zeros à esquerda → código, nome e ordem). */
async function gruposDashboard(pool) {
  const { rows } = await pool.query("SELECT cod, nm, dds->>'ordem' AS ord FROM cad_itm WHERE cad = $1", [CAD_GRUPOS_DASH]);
  return new Map(
    rows.filter((r) => (r.nm ?? "").trim()).map((r) => [codigoOperacao(r.cod), { cod: r.cod, nome: r.nm.trim().toUpperCase(), ordem: numeroOuNull(r.ord) }]),
  );
}

/**
 * Depois de alterar um grupo no cadastro Grupo Op. Dashboard: o nome e a ordem guardados junto de cada operação em
 * Grupos de Operações acompanham (a lista e o dashboard já leem do cadastro na hora; isto mantém a busca e o nome em dia).
 * Operação que ainda guarda o grupo como texto (ex.: planilha de Grupos de Operações importada quando o Grupo Op.
 * Dashboard estava vazio, que aceita o texto) passa para o código do grupo de mesmo nome, sem diferença de acento,
 * maiúsculas ou espaços — o código vale primeiro, como na leitura do dashboard.
 */
export async function sincronizarGruposOperacoes() {
  const pool = getPool();
  await prepararGrupos(pool);
  const grupos = await gruposDashboard(pool);
  const porNome = new Map([...grupos.values()].map((g) => [nomeComparavel(g.nome), g]));
  const { rows } = await pool.query("SELECT cod, nm, dds FROM cad_itm WHERE cad = $1", [CAD_GRUPOS]);
  let n = 0;
  for (const o of rows) {
    const atual = String(o.dds?.grupo ?? "").trim();
    if (!atual) continue;
    const g = grupos.get(codigoOperacao(atual)) ?? porNome.get(nomeComparavel(atual));
    if (!g) continue;
    const ordem = g.ordem === null ? "" : String(g.ordem);
    if (atual === g.cod && o.nm === g.nome && o.dds?.grupo_nm === g.nome && String(o.dds?.ordem ?? "") === ordem) continue;
    await pool.query("UPDATE cad_itm SET nm = $3, dds = dds || $4::jsonb WHERE cad = $1 AND cod = $2", [
      CAD_GRUPOS,
      o.cod,
      g.nome,
      JSON.stringify({ grupo: g.cod, grupo_nm: g.nome, ordem }),
    ]);
    n++;
  }
  return n;
}

/** Operações que usam um grupo do Grupo Op. Dashboard (para não excluir um grupo em uso). */
export async function operacoesDoGrupo(cod) {
  const pool = getPool();
  await prepararGrupos(pool);
  const { rows } = await pool.query("SELECT cod, dds->>'grupo' AS grp FROM cad_itm WHERE cad = $1", [CAD_GRUPOS]);
  const alvo = codigoOperacao(String(cod));
  return rows.filter((r) => codigoOperacao(String(r.grp ?? "")) === alvo).map((r) => r.cod);
}

const hojeSP = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
const r2 = (n) => Math.round(n * 100) / 100;

/** Safra cujo ano-safra contém a data (agrícola antes de industrial; a mais recente no empate). */
function safraDoAno(safras, dt) {
  return (
    safras.filter((s) => s.anoInicio <= dt && dt <= s.anoFim).sort((a, b) => (a.tipo === b.tipo ? 0 : a.tipo === "AGR" ? -1 : 1) || b.ano - a.ano)[0] ?? null
  );
}

/** Prepara o cadastro Grupos de Operações (inclusive a passagem da tabela antiga) — para a tela do cadastro. */
export async function prepararGruposOperacoes() {
  const pool = getPool();
  await prepararAtividades(pool);
  await carregarCadastrosExportados(pool);
  await prepararGrupos(pool);
}

/**
 * Grupo de cada operação (código sem zeros à esquerda → código, nome e ordem do grupo), lido na hora do cadastro Grupo
 * Op. Dashboard. Operação com grupo que não existe mais no cadastro fica sem grupo (Outras operações).
 */
async function gruposDoCadastro(pool) {
  const grupos = await gruposDashboard(pool);
  const { rows } = await pool.query("SELECT cod, dds->>'grupo' AS grp FROM cad_itm WHERE cad = $1", [CAD_GRUPOS]);
  const mapa = new Map();
  for (const r of rows) {
    const g = grupos.get(codigoOperacao(String(r.grp ?? "")));
    if (g) mapa.set(codigoOperacao(r.cod), { cod: g.cod, grupo: g.nome, ordem: g.ordem });
  }
  return mapa;
}

/**
 * Dashboard das atividades numa data (no máximo ontem: só dias fechados): entrada de cana (total e por frente, de todas
 * as viagens da pesagem) e área realizada das operações lançadas (por grupo), em cada dia da semana de referência
 * (segunda a domingo) e acumulada na semana, no mês e na safra — sempre até a data de referência.
 */
export async function dashboardAtividades(dtPedida) {
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
  const acumular = (v, d, valor, inicioSafra) => {
    if (d > dt) return;
    const i = semana.indexOf(d);
    if (i >= 0) {
      v.dias[i] = (v.dias[i] ?? 0) + valor;
      v.semana += valor;
    }
    if (d >= mesInicio) v.mes += valor;
    if (d >= inicioSafra) v.safra += valor;
  };
  const fechar = (v) => ({
    dias: v.dias.map((x, i) => (diasValidos[i] ? r2(x ?? 0) : null)),
    semana: r2(v.semana),
    mes: r2(v.mes),
    safra: r2(v.safra),
  });

  // ---------------- moagem: todas as viagens da pesagem (com ou sem ordem de corte, ex.: CMAA), dias inteiros;
  // a frente é a da ordem e, sem ordem, a do relatório de pesagem. Viagem com tara zerada não conta.
  const fimMoagem = vigente && vigente.producaoFim < dt ? vigente.producaoFim : dt;
  const desdeMoagem = [inicioMoagem, seg, mesInicio].sort()[0];
  const { rows: viagens } = await pool.query(
    `SELECT v.dt::text AS d, COALESCE(NULLIF(o.frt, ''), NULLIF(v.frt, ''), 'SEM FRENTE') AS f, SUM(v.ton)::float AS t
       FROM pes_viag v LEFT JOIN ord o ON o.num = v.ord_num
      WHERE v.dt BETWEEN $1::date AND $2::date AND (v.tara IS NULL OR v.tara > 0)
      GROUP BY 1, 2`,
    [desdeMoagem, fimMoagem],
  );
  const porFrente = new Map();
  for (const v of viagens) {
    if (!porFrente.has(v.f)) porFrente.set(v.f, vazio());
    acumular(porFrente.get(v.f), v.d, v.t, inicioMoagem);
  }
  const frentes = [...porFrente.entries()]
    .map(([frente, v]) => ({ frente, ...fechar(v) }))
    .filter((l) => l.safra > 0 || l.mes > 0 || l.semana > 0)
    .sort((a, b) => a.frente.localeCompare(b.frente));
  const totalMoagem = fechar(somarValores(frentes, diasValidos));

  // ---------------- operações: área dos talhões (ou da fazenda) de cada apontamento; nome pelo cadastro Operações
  const desdeOps = [inicioOps, seg, mesInicio].sort()[0];
  const { rows } = await pool.query(
    `SELECT a.dt::text AS d, a.op_cod AS cod, MAX(a.op_ds) AS ds, SUM(t.area)::float AS ha
       FROM ap_dia a JOIN ap_dia_tlh t ON t.ap_id = a.id
      WHERE a.dt BETWEEN $1::date AND $2::date
      -- sem código (ex.: importado do WhatsApp com o nome da atividade), cada descrição é uma operação
      GROUP BY a.dt, a.op_cod, CASE WHEN a.op_cod = '' THEN a.op_ds ELSE '' END`,
    [desdeOps, dt],
  );
  const cadOps = await operacoesDoCadastro(pool);
  const grupoDe = await gruposDoCadastro(pool);
  const porOperacao = new Map();
  for (const r of rows) {
    const cod = codigoOperacao(r.cod);
    const chave = cod || r.ds;
    if (!porOperacao.has(chave)) porOperacao.set(chave, { cod, ds: nomeOperacao(cadOps, cod, r.ds), v: vazio() });
    acumular(porOperacao.get(chave).v, r.d, r.ha, inicioOps);
  }
  const grupos = new Map();
  for (const op of porOperacao.values()) {
    const linha = { cod: op.cod, ds: op.ds || op.cod, ...fechar(op.v) };
    if (!(linha.safra > 0 || linha.mes > 0 || linha.semana > 0)) continue;
    const g = grupoDe.get(op.cod);
    const nome = g?.grupo ?? GRUPO_OUTRAS;
    const ordem = g ? (g.ordem ?? 9999) : 99999;
    if (!grupos.has(nome)) grupos.set(nome, { ord: ordem, linhas: [] });
    const atual = grupos.get(nome);
    atual.ord = Math.min(atual.ord, ordem);
    atual.linhas.push(linha);
  }
  const listaGrupos = [...grupos.entries()]
    .sort((a, b) => a[1].ord - b[1].ord || a[0].localeCompare(b[0]))
    .map(([grupo, g]) => {
      const linhas = g.linhas.sort((a, b) => a.ds.localeCompare(b.ds) || a.cod.localeCompare(b.cod, undefined, { numeric: true }));
      return { grupo, linhas, subtotal: fechar(somarValores(linhas, diasValidos)) };
    });
  const totalOps = fechar(
    somarValores(
      listaGrupos.map((g) => g.subtotal),
      diasValidos,
    ),
  );

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
export async function listarGruposOperacoes() {
  const pool = getPool();
  await prepararAtividades(pool);
  await prepararGrupos(pool);
  const cadOps = await operacoesDoCadastro(pool);
  const grupoDe = await gruposDoCadastro(pool);
  const lancadas = (await pool.query("SELECT op_cod AS cod, MAX(op_ds) AS ds FROM ap_dia WHERE op_cod <> '' GROUP BY op_cod")).rows;
  // grupo: o código do Grupo Op. Dashboard ("" = Outras operações); grupoNome para mostrar e buscar
  const ops = new Map();
  const doGrupo = (k) => ({ grupo: grupoDe.get(k)?.cod ?? "", grupoNome: grupoDe.get(k)?.grupo ?? GRUPO_OUTRAS });
  for (const [k, o] of cadOps) ops.set(k, { cod: o.cod, ds: o.nm, classificacao: o.classificacao, ...doGrupo(k), lancada: false, noCadastro: true });
  for (const l of lancadas) {
    const k = codigoOperacao(l.cod);
    const atual = ops.get(k) ?? { cod: k, ds: l.ds, classificacao: "", ...doGrupo(k), lancada: false, noCadastro: false };
    atual.lancada = true;
    ops.set(k, atual);
  }
  // os grupos do cadastro Grupo Op. Dashboard, na ordem do dashboard
  const grupos = [...(await gruposDashboard(pool)).values()]
    .sort((a, b) => (a.ordem ?? 9999) - (b.ordem ?? 9999) || a.nome.localeCompare(b.nome))
    .map((g) => ({ cod: g.cod, nome: g.nome }));
  return {
    operacoes: [...ops.values()].sort((a, b) => Number(b.lancada) - Number(a.lancada) || a.cod.localeCompare(b.cod, undefined, { numeric: true })),
    grupos,
  };
}

/**
 * Define o grupo de uma operação do cadastro Operações: `grupoCod` é o código do grupo no cadastro Grupo Op. Dashboard
 * (vazio = Outras operações, que tira a operação do cadastro de grupos).
 */
export async function salvarGrupoOperacao(cod, grupoCod, usuario) {
  const pool = getPool();
  await prepararGrupos(pool);
  const op = (await operacoesDoCadastro(pool)).get(codigoOperacao(cod));
  if (!op) return { erro: `A operação ${cod} não está no cadastro Operações; inclua-a lá antes de definir o grupo.` };
  const grupos = await gruposDashboard(pool);
  const gc = String(grupoCod ?? "").trim();
  const g = gc ? grupos.get(codigoOperacao(gc)) : null;
  if (gc && !g) return { erro: `O grupo ${gc} não está no cadastro Grupo Op. Dashboard; cadastre-o lá antes.` };
  const atual = (await pool.query("SELECT dds FROM cad_itm WHERE cad = $1 AND cod = $2", [CAD_GRUPOS, op.cod])).rows[0];
  const grupoAntes = grupos.get(codigoOperacao(String(atual?.dds?.grupo ?? "")));
  if ((grupoAntes?.cod ?? "") === (g?.cod ?? "") && !!atual === !!g) return null;
  const antes = grupoAntes?.nome ?? ((atual ? String(atual.dds?.grupo_nm ?? atual.dds?.grupo ?? "") : "") || GRUPO_OUTRAS);
  if (!g) {
    await pool.query("DELETE FROM cad_itm WHERE cad = $1 AND cod = $2", [CAD_GRUPOS, op.cod]);
  } else {
    const dds = { operacao: op.cod, operacao_nm: op.nm, classificacao: op.classificacao, grupo: g.cod, grupo_nm: g.nome, ordem: g.ordem === null ? "" : String(g.ordem) };
    await pool.query(
      `INSERT INTO cad_itm (cad, cod, nm, dds, usr, atu_usr, atu_em) VALUES ($1, $2, $3, $4::jsonb, $5, $5, now())
       ON CONFLICT (cad, cod) DO UPDATE SET nm = EXCLUDED.nm, dds = EXCLUDED.dds, atu_usr = EXCLUDED.atu_usr, atu_em = now()`,
      [CAD_GRUPOS, op.cod, g.nome, JSON.stringify(dds), usuario],
    );
  }
  await auditar(pool, {
    usuario,
    modulo: "Cadastros",
    entidade: ENTIDADE_LOG,
    chave: `Operação ${op.cod} · ${op.nm}`,
    acao: atual ? (g ? "alteracao" : "exclusao") : "inclusao",
    antes: { grupo: antes },
    depois: { grupo: g?.nome ?? GRUPO_OUTRAS },
  });
  return null;
}
