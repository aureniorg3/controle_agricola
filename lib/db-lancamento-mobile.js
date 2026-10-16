import { randomUUID } from "node:crypto";
import { chaveTalhao, round2 } from "./atividades";
import { dataBR } from "./auditar";
import { codigoOperacao } from "./dashboard-atividades";
import { getPool } from "./db";
import {
  BOT_WHATSAPP,
  consultarOS,
  excluirApontamento,
  listarApontamentos,
  obterApontamento,
  opcoesApontamento,
  operacoesDaOS,
  prepararAtividades,
  regrasApontamento,
  salvarApontamento,
} from "./db-atividades";
import { carregarCadastrosExportados } from "./db-cadastros-carga";
import { nomeOperacao, operacoesDoCadastro } from "./db-operacoes";
import { prepararOSAgr } from "./db-os-agr";
import { buscarCodigo, talhoesDaFazenda } from "./db-rodadas";
import { areasDaBase } from "./db-talhoes";
import {
  chaveBusca,
  fmtArea,
  lerNumero,
  listaDeBoletins,
  matriculaValida,
  modeloDaClassificacao,
  montarTextoWhatsapp,
  STATUS_OS,
  tipoDoCadastro,
} from "./lancamento-mobile";
import { normFaz, normTlh } from "./ocupacao";

/*
 * Lançamento Mobile (Atividades): o apontamento diário lançado no campo pelo celular. Quem lança informa a matrícula (ou
 * o código) e vê só as O.S. em aberto dele; o saldo e o "Já apontado" são os mesmos da tela Apontamento (consultarOS /
 * operacoesDaOS). Grava pelo mesmo salvarApontamento (origem 'mobile'), aceitando fazendas e talhões fora da O.S., e
 * devolve o texto padrão para o grupo do WhatsApp (lib/lancamento-mobile.js).
 *
 * Lançamento com várias O.S.: cada linha de ap_dia continua com UMA O.S. e UMA operação e o seu nº de boletim (é disso
 * que o saldo, a Conferência, os dashboards e o Verificar O.S. dependem). O lançamento grava um apontamento por
 * O.S./operação, com boletins seguidos, todos com o mesmo cabeçalho e ligados pela coluna lanc_grp (uuid do lançamento;
 * NULL no lançamento de uma O.S. só). Gravar é uma transação só: entram todos ou nenhum. O que é do lançamento e não de
 * cada O.S.:
 *   - a calda/insumo gasto é rateada entre os apontamentos pela área (a última O.S. leva o resto, para a soma bater); a
 *     dose recomendada vale para todos;
 *   - o nº de pessoas e de equipamentos vai igual em todos: nenhum dashboard nem relatório soma n_pes/n_eqp (só a lista
 *     e o detalhe da tela Apontamento mostram, por apontamento), e o parâmetro de campos obrigatórios cobra os dois em
 *     cada apontamento;
 *   - solicitante, etapa e tipo de aplicação: o do cabeçalho mudado à mão vale para todas; sem mudança, cada O.S. leva o
 *     dela (a tela manda o de cada O.S.). O status da O.S. é de cada uma.
 * O tipo de aplicação é só o do cadastro Tipo Aplicação (os ativos; grava a descrição, como a tela Apontamento e o bot);
 * o que um lançamento aberto para editar já tinha gravado fora do cadastro continua valendo.
 *
 * Lançar sem O.S. (serviço que ainda não tem O.S.): o bloco com a O.S. em branco grava pelo mesmo salvarApontamento sem
 * O.S. — a operação escolhida no cadastro Operações, as fazendas do Cadastro de Fazenda e os talhões com a área da base
 * Fazenda e Talhões da safra da data, a etapa escolhida (obrigatória conforme os Parâmetros) e sem status de O.S. Um
 * bloco sem O.S. por lançamento, que pode ir junto com O.S. (é mais um apontamento do grupo); com a O.S. obrigatória nos
 * Parâmetros › Apontamento Diário, não aceita.
 *
 * Consultas para quem lança: os responsáveis pela matrícula ou pelo nome (sugestões), os lançamentos da matrícula (Meus
 * lançamentos, por página) e os de uma O.S. (de qualquer origem: Lançamento Mobile, tela Apontamento, bot do WhatsApp),
 * cada um aberto só para consulta.
 */

const NAO_E_DO_MOBILE = "Este boletim não foi lançado pelo Lançamento Mobile; edite na tela Apontamento.";
const OS_FORA_DA_BASE = (os) =>
  `A O.S. ${os} não está na base de O.S. Importe o Relatório de Ordens de Serviço atualizado em Ordem de Serviço Agr. › Ordens de Serviço.`;

/** Condição SQL: `col` igual ao parâmetro $p; sendo os dois números, sem os zeros à esquerda (601448 = 0601448). */
const igualSemZeros = (col, p) => `(${col} = $${p} OR (${col} ~ '^[0-9]+$' AND $${p} ~ '^[0-9]+$' AND ltrim(${col}, '0') = ltrim($${p}, '0')))`;

/**
 * Quem lança, pela matrícula (código): só o Cadastro de Responsáveis do menu Ordem de Serviço Agr. — o código e o nome
 * vêm dele (não do cadastro de Funcionários nem do nome que vem nas O.S.). null quando não está no cadastro;
 * `{ inativo: true }` quando está, mas inativo.
 */
async function responsavelPorMatricula(pool, mat) {
  const r = (
    await pool.query(
      `SELECT cod, nm, COALESCE(dds->>'area', '') AS area, COALESCE(atv, true) AS atv FROM cad_itm
        WHERE cad = 'responsaveis-os' AND ${igualSemZeros("cod", 1)} ORDER BY COALESCE(atv, true) DESC, cod LIMIT 1`,
      [mat],
    )
  ).rows[0];
  if (!r) return null;
  if (!r.atv) return { inativo: true, matricula: r.cod, nome: r.nm };
  return { matricula: r.cod, nome: r.nm, area: r.area };
}

/**
 * Classificação de cada operação do cadastro Operações (pelo código sem zeros à esquerda): o nome do cadastro
 * Classificação de Operações pelo código gravado; sem ele, o nome guardado na importação.
 */
async function classificacoes(pool) {
  await operacoesDoCadastro(pool); // carga inicial dos cadastros exportados
  const { rows } = await pool.query(
    `SELECT o.cod, COALESCE(MAX(NULLIF(c.nm, '')), MAX(o.dds->>'codigo_2_nm'), '') AS cls
       FROM cad_itm o
       LEFT JOIN cad_itm c ON c.cad = 'classificacao-operacoes' AND COALESCE(o.dds->>'codigo_2', '') <> ''
            AND (c.cod = o.dds->>'codigo_2'
                 OR (c.cod ~ '^[0-9]+$' AND (o.dds->>'codigo_2') ~ '^[0-9]+$' AND ltrim(c.cod, '0') = ltrim(o.dds->>'codigo_2', '0')))
      WHERE o.cad = 'operacoes'
      GROUP BY o.cod`,
  );
  return new Map(rows.map((r) => [codigoOperacao(r.cod), r.cls ?? ""]));
}

/** Operação da O.S. pelo código (o da O.S. primeiro; "010" = "10"). */
const operacaoDaOS = (info, cod) =>
  info.operacoes.find((x) => x.cod === cod) ?? info.operacoes.find((x) => codigoOperacao(x.cod) === codigoOperacao(cod));

/** Talhão da O.S. para o informado: o mesmo código, senão a mesma fazenda e talhão com outra grafia ("09442|05" = "9442|5"). */
const talhaoDaOS = (o, propCod, tlh) =>
  o.talhoes.find((x) => x.propCod === propCod && x.tlh === tlh) ??
  o.talhoes.find((x) => normFaz(x.propCod) === normFaz(propCod) && normTlh(x.tlh) === normTlh(tlh));

const nomeTalhao = (propCod, tlh) => (tlh ? `${propCod}-${tlh}` : `${propCod} (sem talhão)`);

/**
 * Tipos de aplicação do cadastro Tipo Aplicação que estão ativos: [{ cod, ds }] pelo código (o cadastro guarda
 * "cód|descrição" como chave: o mesmo código pode ter mais de uma descrição).
 */
async function tiposAplicacao(pool) {
  await carregarCadastrosExportados(pool); // carga inicial do cadastro exportado
  const { rows } = await pool.query(
    `SELECT DISTINCT COALESCE(NULLIF(btrim(dds->>'codigo'), ''), split_part(cod, '|', 1)) AS cod, btrim(nm) AS ds
       FROM cad_itm
      WHERE cad = 'tipo-aplicacao' AND COALESCE(atv, true) AND btrim(COALESCE(nm, '')) <> ''`,
  );
  return rows
    .map((r) => ({ cod: String(r.cod ?? "").trim(), ds: r.ds }))
    .sort((a, b) => a.cod.localeCompare(b.cod, undefined, { numeric: true }) || a.ds.localeCompare(b.ds, "pt-BR"));
}

/** Matrícula como chave: a numérica sem os zeros à esquerda ("0601448" = "601448"); a outra em maiúsculas. */
const chaveMatricula = (c) => {
  const s = String(c ?? "").trim();
  return /^\d+$/.test(s) ? s.replace(/^0+(?=\d)/, "") : s.toUpperCase();
};

/** Responsáveis para as sugestões, guardados por um minuto (cada letra digitada consulta). */
let responsaveisGuardados = { em: 0, lista: null };

/** Quem pode lançar, para as sugestões: só o Cadastro de Responsáveis (Ordem de Serviço Agr.), os ativos. */
async function listaDeResponsaveis(pool) {
  if (responsaveisGuardados.lista && Date.now() - responsaveisGuardados.em < 60_000) return responsaveisGuardados.lista;
  const cad = (
    await pool.query(
      `SELECT btrim(cod) AS cod, btrim(COALESCE(nm, '')) AS nm, COALESCE(dds->>'area', '') AS area
         FROM cad_itm WHERE cad = 'responsaveis-os' AND btrim(cod) <> '' AND COALESCE(atv, true)`,
    )
  ).rows;
  const porChave = new Map();
  for (const r of cad) {
    const k = chaveMatricula(r.cod);
    if (!porChave.has(k)) porChave.set(k, { matricula: r.cod, nome: r.nm, area: r.area });
  }
  const lista = [...porChave.values()].map((x) => ({ ...x, chaveNome: chaveBusca(x.nome), chaveCod: chaveMatricula(x.matricula).toLowerCase() }));
  responsaveisGuardados = { em: Date.now(), lista };
  return lista;
}

/**
 * Responsáveis pelo trecho do código (matrícula) ou do nome, sem acento nem caixa ("joao silva" acha "JOÃO DA SILVA"):
 * o código igual ou começando pelo digitado primeiro, depois o nome; até 20.
 */
export async function buscarResponsaveis(termo) {
  const q = chaveBusca(termo);
  if (q.length < 2) return [];
  const pool = getPool();
  await prepararAtividades(pool);
  await prepararOSAgr(pool);
  const lista = await listaDeResponsaveis(pool);
  const qCod = chaveMatricula(q).toLowerCase();
  const palavras = q.split(" ");
  const nota = (x) => {
    if (x.chaveCod === qCod) return 0;
    if (x.chaveCod.startsWith(qCod)) return 1;
    if (x.chaveNome.startsWith(q)) return 2;
    const nomes = x.chaveNome.split(" ");
    if (palavras.every((p) => nomes.some((n) => n.startsWith(p)))) return 3;
    if (x.chaveCod.includes(qCod) || palavras.every((p) => x.chaveNome.includes(p))) return 4;
    return null;
  };
  return lista
    .map((x) => ({ x, n: nota(x) }))
    .filter((y) => y.n !== null)
    .sort((a, b) => a.n - b.n || a.x.nome.localeCompare(b.x.nome, "pt-BR") || a.x.matricula.localeCompare(b.x.matricula, undefined, { numeric: true }))
    .slice(0, 20)
    .map(({ x }) => ({ matricula: x.matricula, nome: x.nome, area: x.area }));
}

// ---------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------

/**
 * Listas da tela: as do Apontamento, com a classificação de cada operação (e o modelo do texto que ela dá), e as
 * equipes, os equipamentos e os status. Os tipos de aplicação são só os do cadastro Tipo Aplicação que estão ativos
 * ([{ cod, ds }]). `regras`: os campos obrigatórios dos Parâmetros › Apontamento Diário (a O.S. obrigatória desliga o
 * Lançar sem O.S.; a etapa obrigatória vale para o lançamento sem O.S.).
 */
export async function opcoesLancamentoMobile() {
  const pool = getPool();
  const base = await opcoesApontamento();
  const cls = await classificacoes(pool);
  // equipes já usadas primeiro, depois o cadastro Fornecedores e Prestadores
  const usadas = (await pool.query("SELECT DISTINCT equipe AS e FROM ap_dia WHERE equipe <> '' ORDER BY 1 LIMIT 500")).rows.map((r) => r.e);
  const prestadores = (await pool.query("SELECT DISTINCT nm AS e FROM cad_itm WHERE cad = 'fornecedores-prestadores' AND nm <> '' AND COALESCE(atv, true) ORDER BY 1 LIMIT 2000")).rows.map(
    (r) => r.e,
  );
  // não há cadastro de frota: os equipamentos já lançados e os do Equipto Frente (só sugestão)
  const equipamentos = (
    await pool.query(
      `SELECT e FROM (SELECT eqp AS e FROM ap_dia WHERE eqp <> '' UNION SELECT eqp FROM eqp_frt WHERE eqp <> '') x
        ORDER BY CASE WHEN e ~ '^[0-9]+$' THEN lpad(e, 12, '0') ELSE e END LIMIT 2000`,
    )
  ).rows.map((r) => r.e);
  return {
    operacoes: base.operacoes.map((o) => {
      const classificacao = cls.get(codigoOperacao(o.cod)) ?? "";
      return { cod: o.cod, ds: o.ds, etapaCod: o.etapaCod, classificacao, modelo: modeloDaClassificacao(classificacao) };
    }),
    etapas: base.etapas,
    tipos: await tiposAplicacao(pool),
    solicitantes: base.solicitantes,
    equipes: [...new Set([...usadas, ...prestadores])].slice(0, 2000),
    equipamentos,
    statusOS: STATUS_OS,
    regras: base.regras,
  };
}

/** Área já apontada por O.S., operação e talhão (todas as datas). */
const SQL_FEITOS = `
  SELECT a.os, a.op_cod, t.prop_cod, t.tlh, SUM(t.area)::float AS area
    FROM ap_dia a JOIN ap_dia_tlh t ON t.ap_id = a.id
   WHERE a.os = ANY($1::text[])
   GROUP BY 1, 2, 3, 4`;

/** Último apontamento (o mais recente, de qualquer origem) de cada O.S. e operação, com a área dele. */
const SQL_ULTIMO_DA_OPERACAO = `
  SELECT DISTINCT ON (a.os, a.op_cod) a.os, a.op_cod, a.id, a.bol, a.dt::text AS dt,
         (SELECT COALESCE(SUM(t.area), 0) FROM ap_dia_tlh t WHERE t.ap_id = a.id)::float AS area
    FROM ap_dia a
   WHERE a.os = ANY($1::text[])
   ORDER BY a.os, a.op_cod, a.dt DESC, a.id DESC`;

/** Totais da operação como a tela Apontamento soma: recomendada, já apontado e saldo (max(0, recomendada ou área − já)) por talhão. */
function resumoDaOperacao(o, feitosOp, cls, ultimo) {
  let areaRec = 0;
  let ja = 0;
  let saldo = 0;
  for (const t of o.talhoes) {
    const j = feitosOp[chaveTalhao(t.propCod, t.tlh)] ?? 0;
    areaRec += t.areaRec ?? 0;
    ja += j;
    saldo += Math.max(0, round2((t.areaRec ?? t.areaTlh ?? 0) - j));
  }
  const classificacao = cls.get(codigoOperacao(o.cod)) ?? "";
  return {
    cod: o.cod,
    ds: o.ds,
    etapaCod: o.etapaCod,
    etapaDs: o.etapaDs,
    classificacao,
    modelo: modeloDaClassificacao(classificacao),
    nTalhoes: o.talhoes.length,
    areaRec: round2(areaRec),
    ja: round2(ja),
    saldo: round2(saldo),
    ultimo,
  };
}

/**
 * O.S. em aberto (alguma linha não encerrada) do responsável pela matrícula, emitidas até a data, com as operações em
 * aberto de cada uma: área recomendada, já apontado, saldo e o último apontamento. null quando a matrícula não está em
 * nenhum cadastro nem em nenhuma O.S.
 */
export async function ordensDoResponsavel(matricula, dt) {
  const pool = getPool();
  await prepararAtividades(pool);
  await prepararOSAgr(pool);
  const responsavel = await responsavelPorMatricula(pool, matricula);
  // só lança quem está (ativo) no Cadastro de Responsáveis; a rota explica o motivo
  if (!responsavel || responsavel.inativo) return responsavel ? { inativo: true, responsavel } : null;
  const mat = responsavel.matricula;
  // linhas das O.S. como consultarOS lê (mesma ordem: o 1º talhão repetido é o que vale)
  const { rows } = await pool.query(
    `SELECT os, prop_cod, prop_nm, tlh || letra AS tlh, area_plant::float AS area_tlh, area_rec::float AS area_rec, op_cod, op_ds, etapa_cod, etapa_ds,
            '' AS tipo_cod, '' AS tipo_ds, posicao, dt_os::text AS dt_os, prev_fim::text AS prev_fim, resp_nm
       FROM os_agr
      WHERE os IN (SELECT os FROM os_agr WHERE ${igualSemZeros("resp_cod", 1)} GROUP BY os
                    HAVING bool_or(posicao <> 'E') AND (MIN(dt_os) IS NULL OR MIN(dt_os) <= $2::date))
      ORDER BY os, op_cod, prop_cod, CASE WHEN tlh ~ '^[0-9]+$' THEN lpad(tlh, 8, '0') ELSE tlh END`,
    [mat, dt],
  );
  const oss = [...new Set(rows.map((r) => r.os))];
  const base = await areasDaBase(
    rows.map((r) => r.prop_cod),
    dt,
    pool,
  );
  const cadOps = await operacoesDoCadastro(pool);
  const cls = await classificacoes(pool);
  const feitos = new Map(); // "os|operação" → { "fazenda|talhão": área }
  const ultimos = new Map(); // "os|operação" → último apontamento
  if (oss.length) {
    for (const f of (await pool.query(SQL_FEITOS, [oss])).rows) {
      const k = `${f.os}|${f.op_cod}`;
      if (!feitos.has(k)) feitos.set(k, {});
      feitos.get(k)[chaveTalhao(f.prop_cod, f.tlh)] = round2(f.area);
    }
    for (const u of (await pool.query(SQL_ULTIMO_DA_OPERACAO, [oss])).rows) {
      ultimos.set(`${u.os}|${u.op_cod}`, { dt: u.dt, boletim: u.bol, area: round2(u.area) });
    }
  }
  const porOS = new Map();
  for (const r of rows) {
    if (!porOS.has(r.os)) porOS.set(r.os, []);
    porOS.get(r.os).push(r);
  }
  const ordens = [];
  for (const [os, linhas] of porOS) {
    const abertas = linhas.filter((r) => r.posicao !== "E");
    const opsAbertas = new Set(abertas.map((r) => r.op_cod));
    const operacoes = operacoesDaOS(linhas, base, cadOps)
      .filter((o) => opsAbertas.has(o.cod))
      .map((o) => resumoDaOperacao(o, feitos.get(`${os}|${o.cod}`) ?? {}, cls, ultimos.get(`${os}|${o.cod}`) ?? null));
    const fazendas = [];
    for (const r of linhas) if (!fazendas.some((f) => f.cod === r.prop_cod)) fazendas.push({ cod: r.prop_cod, nm: r.prop_nm });
    const emissoes = linhas.map((r) => r.dt_os).filter(Boolean).sort();
    const fins = linhas.map((r) => r.prev_fim).filter(Boolean).sort();
    ordens.push({
      os,
      situacao: abertas.length > 0 && abertas.every((r) => r.posicao === "L") ? "Liberada" : "Aberta",
      dtOs: emissoes[0] ?? null,
      prevFim: fins.length ? fins[fins.length - 1] : null,
      // o nome do Cadastro de Responsáveis (o da O.S. só se o cadastro estiver sem nome)
      resp: responsavel.nome || linhas.map((r) => String(r.resp_nm ?? "").trim()).find(Boolean) || "",
      fazendas,
      areaRec: round2(operacoes.reduce((a, o) => a + o.areaRec, 0)),
      ja: round2(operacoes.reduce((a, o) => a + o.ja, 0)),
      saldo: round2(operacoes.reduce((a, o) => a + o.saldo, 0)),
      operacoes,
    });
  }
  // as mais novas primeiro
  ordens.sort((a, b) => (b.dtOs ?? "").localeCompare(a.dtOs ?? "") || b.os.localeCompare(a.os, undefined, { numeric: true }));
  return { responsavel, ordens };
}

/**
 * Tira do "Já apontado" da O.S. (`info.realizado`, de consultarOS) os apontamentos `ids` — os do lançamento aberto para
 * editar, que a gravação reescreve ou exclui. Mesmo filtro e mesmas chaves (operação, fazenda|talhão) de consultarOS.
 */
async function descontarApontamentos(pool, info, ids) {
  if (!ids.length) return;
  const { rows } = await pool.query(
    `SELECT a.op_cod, t.prop_cod, t.tlh, SUM(t.area)::float AS area
       FROM ap_dia a JOIN ap_dia_tlh t ON t.ap_id = a.id
      WHERE a.os = $1 AND a.id = ANY($2::int[])
      GROUP BY 1, 2, 3`,
    [info.os, ids],
  );
  for (const r of rows) {
    const feitos = info.realizado[r.op_cod];
    const k = chaveTalhao(r.prop_cod, r.tlh);
    if (feitos?.[k] !== undefined) feitos[k] = Math.max(0, round2(feitos[k] - r.area));
  }
}

/**
 * Uma operação da O.S. para lançar: os talhões com a área (base Fazenda e Talhões da safra da data), a recomendada, o já
 * apontado e o saldo (sem contar os apontamentos `excluir` — um id ou a lista: os do lançamento que está sendo
 * editado), o último apontamento de cada talhão e o da operação.
 */
export async function detalheDaOperacao(os, opCod, dt, excluir) {
  const pool = getPool();
  const ids = (Array.isArray(excluir) ? excluir : [excluir]).filter((x) => Number.isInteger(x) && x > 0);
  const info = await consultarOS(os, ids[0], dt);
  if (!info) return { erro: OS_FORA_DA_BASE(os), status: 404 };
  const o = operacaoDaOS(info, opCod);
  if (!o) return { erro: `A operação ${opCod} não faz parte da O.S. ${info.os}.`, status: 404 };
  await descontarApontamentos(pool, info, ids.slice(1));
  const classificacao = (await classificacoes(pool)).get(codigoOperacao(o.cod)) ?? "";
  // tipo de aplicação da operação (da antiga base de O.S.): só o que está no cadastro Tipo Aplicação, com a descrição dele
  const tipo = tipoDoCadastro(await tiposAplicacao(pool), o.tipoDs || o.tipoCod || "");
  const feitosOp = info.realizado[o.cod] ?? {};
  const params = [info.os, o.cod, ids];
  const ultimosTalhao = new Map(
    (
      await pool.query(
        `SELECT DISTINCT ON (t.prop_cod, t.tlh) t.prop_cod, t.tlh, a.dt::text AS dt, a.bol, t.area::float AS area
           FROM ap_dia a JOIN ap_dia_tlh t ON t.ap_id = a.id
          WHERE a.os = $1 AND a.op_cod = $2 AND NOT (a.id = ANY($3::int[]))
          ORDER BY t.prop_cod, t.tlh, a.dt DESC, a.id DESC`,
        params,
      )
    ).rows.map((r) => [chaveTalhao(r.prop_cod, r.tlh), r]),
  );
  const ult = (
    await pool.query(
      `SELECT a.id, a.bol, a.dt::text AS dt, (SELECT COALESCE(SUM(t.area), 0) FROM ap_dia_tlh t WHERE t.ap_id = a.id)::float AS area
         FROM ap_dia a
        WHERE a.os = $1 AND a.op_cod = $2 AND NOT (a.id = ANY($3::int[]))
        ORDER BY a.dt DESC, a.id DESC LIMIT 1`,
      params,
    )
  ).rows[0];
  return {
    os: info.os,
    resp: info.resp,
    situacao: info.status,
    safraArea: info.safraArea,
    operacao: {
      cod: o.cod,
      ds: o.ds,
      etapaCod: o.etapaCod,
      etapaDs: o.etapaDs,
      tipoDs: tipo?.ds ?? "",
      classificacao,
      modelo: modeloDaClassificacao(classificacao),
    },
    talhoes: o.talhoes.map((t) => {
      const k = chaveTalhao(t.propCod, t.tlh);
      const ja = feitosOp[k] ?? 0;
      const u = ultimosTalhao.get(k);
      return {
        propCod: t.propCod,
        propNm: t.propNm,
        tlh: t.tlh,
        areaTlh: t.areaTlh ?? null,
        areaRec: t.areaRec ?? null,
        naBase: t.naBase,
        ja: round2(ja),
        saldo: Math.max(0, round2((t.areaRec ?? t.areaTlh ?? 0) - ja)),
        ultimo: u ? { dt: u.dt, boletim: u.bol, area: round2(u.area) } : null,
      };
    }),
    ultimoApontamento: ult ? { id: ult.id, dt: ult.dt, boletim: ult.bol, area: round2(ult.area) } : null,
  };
}

/**
 * Fazenda do Cadastro de Fazenda ("9001" acha "9001-1") com os talhões e as áreas da base Fazenda e Talhões da safra da
 * data — como o apontamento sem O.S. resolve. Sem a fazenda no cadastro, fazenda null.
 */
export async function fazendaDoLancamento(cod, dt) {
  const faz = await buscarCodigo("fazendas", cod);
  if (!faz.item) return { fazenda: null, talhoes: [] };
  const talhoes = await talhoesDaFazenda(faz.item.cod, dt);
  return {
    fazenda: { cod: faz.item.cod.split("-")[0], nm: faz.item.nm },
    talhoes: talhoes.map((t) => ({ tlh: t.tlh, area: t.area ?? null })),
  };
}

const SQL_MEUS = `
  SELECT a.id, a.bol, a.dt::text AS dt, a.os, a.op_cod, a.op_ds, a.sts_os, a.lanc_grp,
         (SELECT COALESCE(SUM(t.area), 0) FROM ap_dia_tlh t WHERE t.ap_id = a.id)::float AS area
    FROM ap_dia a`;

/** Lançamentos por página em Meus lançamentos (o de várias O.S. conta um). */
export const LANCAMENTOS_POR_PAGINA = 30;

/**
 * Lançamentos feitos pelo Lançamento Mobile com a matrícula (a digitada ou a do cadastro) no período (`de` e `ate` em
 * branco: todos), mais recentes primeiro, uma página por vez (`offset`: quantos lançamentos já vieram). O lançamento com
 * várias O.S. é um item só, com os boletins e as O.S. dele (na ordem dos boletins); os campos soltos (boletim, O.S.,
 * operação, status) são os do primeiro. `mais`: há lançamentos depois desta página.
 */
export async function meusLancamentos(matricula, de, ate, { offset = 0, limite = LANCAMENTOS_POR_PAGINA } = {}) {
  const pool = getPool();
  await prepararAtividades(pool);
  await prepararOSAgr(pool);
  const resp = await responsavelPorMatricula(pool, matricula);
  // os lançamentos da página: o de várias O.S. (mesmo lanc_grp) é um, na posição do apontamento mais recente dele
  const { rows: pagina } = await pool.query(
    `SELECT MAX(a.lanc_grp) AS grp, MAX(a.id) AS id
       FROM ap_dia a
      WHERE a.orig = 'mobile' AND (${igualSemZeros("a.apont_mat", 1)} OR ${igualSemZeros("a.apont_mat", 2)})
        AND ($3::date IS NULL OR a.dt >= $3::date) AND ($4::date IS NULL OR a.dt <= $4::date)
      GROUP BY COALESCE(a.lanc_grp, a.id::text)
      ORDER BY MAX(a.dt) DESC, MAX(a.id) DESC
      LIMIT $5 OFFSET $6`,
    [matricula, resp?.matricula || matricula, de || null, ate || null, limite + 1, offset],
  );
  const mais = pagina.length > limite;
  const lancamentos = pagina.slice(0, limite);
  if (lancamentos.length === 0) return { itens: [], mais: false };
  // todos os apontamentos de cada lançamento (os do lançamento com várias O.S. pelo lanc_grp)
  const { rows } = await pool.query(`${SQL_MEUS} WHERE a.orig = 'mobile' AND (a.id = ANY($1::int[]) OR a.lanc_grp = ANY($2::text[]))`, [
    lancamentos.filter((l) => !l.grp).map((l) => l.id),
    lancamentos.map((l) => l.grp).filter(Boolean),
  ]);
  const cadOps = await operacoesDoCadastro(pool);
  const porLancamento = new Map(lancamentos.map((l) => [l.grp ?? `#${l.id}`, []]));
  for (const r of rows) porLancamento.get(r.lanc_grp ?? `#${r.id}`)?.push(r);
  const itens = [...porLancamento.values()]
    .filter((l) => l.length > 0)
    .map((l) => {
      const membros = l.sort((a, b) => (a.bol ?? Infinity) - (b.bol ?? Infinity) || a.id - b.id);
      const ordens = membros.map((r) => ({
        id: r.id,
        boletim: r.bol,
        os: r.os,
        opCod: r.op_cod,
        opDs: nomeOperacao(cadOps, r.op_cod, r.op_ds),
        area: round2(r.area),
        statusOS: r.sts_os ?? "",
      }));
      const p = ordens[0];
      return {
        id: p.id,
        boletim: p.boletim,
        boletins: ordens.map((o) => o.boletim),
        dt: membros[0].dt,
        os: p.os,
        opCod: p.opCod,
        opDs: p.opDs,
        areaTotal: round2(ordens.reduce((a, o) => a + o.area, 0)),
        statusOS: p.statusOS,
        ordens,
      };
    });
  return { itens, mais };
}

/** Origem do apontamento para quem consulta: o Lançamento Mobile, o bot do WhatsApp (ou a carga da conversa) ou a tela Apontamento. */
const origemDe = (orig, usr) => (orig === "mobile" ? "mobile" : orig === "whatsapp" ? (usr === BOT_WHATSAPP ? "bot" : "whatsapp") : "tela");

/** Lançamentos de uma O.S. mostrados de cada vez (os mais recentes). */
const LANCAMENTOS_DA_OS = 50;

/**
 * Lançamentos (apontamentos) da O.S., de qualquer origem — Lançamento Mobile, tela Apontamento, bot do WhatsApp —, os
 * mais recentes primeiro (até 50; `total`: quantos a O.S. tem): data, boletim, operação, área, quem lançou (o usuário e o
 * apontador / informante com a matrícula) e a origem.
 */
export async function lancamentosDaOS(os) {
  const pool = getPool();
  await prepararAtividades(pool);
  // como a base de O.S. e os apontamentos guardam: sem os zeros à esquerda
  const cod = String(os ?? "")
    .trim()
    .replace(/^0+(?=\d)/, "");
  const total = (await pool.query("SELECT COUNT(*)::int AS n FROM ap_dia WHERE os = $1", [cod])).rows[0].n;
  const { rows } = await pool.query(
    `SELECT a.id, a.bol, a.dt::text AS dt, a.op_cod, a.op_ds, a.usr, a.apont, a.apont_mat, a.orig, a.sts_os, a.lanc_grp,
            a.conf_em IS NOT NULL AS conferido, to_char(a.cri_em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') AS cri_em,
            (SELECT COALESCE(SUM(t.area), 0) FROM ap_dia_tlh t WHERE t.ap_id = a.id)::float AS area,
            (SELECT COUNT(*) FROM ap_dia_tlh t WHERE t.ap_id = a.id)::int AS n_tlh
       FROM ap_dia a
      WHERE a.os = $1
      ORDER BY a.dt DESC, a.id DESC
      LIMIT $2`,
    [cod, LANCAMENTOS_DA_OS],
  );
  const cadOps = await operacoesDoCadastro(pool);
  return {
    os: cod,
    total,
    lancamentos: rows.map((r) => ({
      id: r.id,
      boletim: r.bol,
      dt: r.dt,
      os: cod,
      opCod: r.op_cod,
      opDs: nomeOperacao(cadOps, r.op_cod, r.op_ds),
      area: round2(r.area),
      nTalhoes: r.n_tlh,
      usr: r.usr ?? "",
      apontador: r.apont ?? "",
      apontadorMat: r.apont_mat ?? "",
      origem: origemDe(r.orig, r.usr),
      statusOS: r.sts_os ?? "",
      varias: !!r.lanc_grp,
      criEm: r.cri_em,
      // do bot e ainda não conferido por uma pessoa
      aConferir: r.usr === BOT_WHATSAPP && !r.conferido,
    })),
  };
}

/**
 * Um lançamento para consultar (sem alterar): o apontamento como está gravado (cabeçalho, talhões, insumos, quem lançou
 * e quando) com a origem; o do Lançamento Mobile vem com os apontamentos do lançamento dele (várias O.S.) e o texto do
 * WhatsApp.
 */
export async function consultarLancamento(id) {
  const a = await obterApontamento(id);
  if (!a) return { erro: "Apontamento não encontrado (pode ter sido excluído).", status: 404 };
  const origem = origemDe(a.orig, a.usr);
  if (a.orig !== "mobile") return { apontamento: { ...a, origem }, apontamentos: [{ ...a, origem }], texto: "" };
  const lista = await apontamentosDoLancamento(a);
  const modelo = await modeloDoApontamento(getPool(), lista[0]);
  const apontamentos = lista.map((x) => ({ ...x, modelo, origem }));
  return {
    apontamento: apontamentos.find((x) => x.id === a.id) ?? { ...a, origem },
    apontamentos,
    texto: montarTextoWhatsapp(apontamentos, { modelo }),
  };
}

/** Modelo do texto de um apontamento: o gravado; sem ele, pela classificação da operação. */
async function modeloDoApontamento(pool, a) {
  if (a.modelo === "manual" || a.modelo === "mecanizada") return a.modelo;
  return modeloDaClassificacao((await classificacoes(pool)).get(codigoOperacao(a.opCod)) ?? "");
}

/**
 * Apontamentos do lançamento a que `a` pertence, na ordem dos boletins: os do mesmo lanc_grp (várias O.S.) ou só ele.
 * `exec`: a conexão (ou a transação) que lê.
 */
async function apontamentosDoLancamento(a, exec) {
  if (!a?.lancGrp) return a ? [a] : [];
  const db = exec ?? getPool();
  const ids = (await db.query("SELECT id FROM ap_dia WHERE lanc_grp = $1 AND orig = 'mobile' ORDER BY bol NULLS LAST, id", [a.lancGrp])).rows.map(
    (r) => r.id,
  );
  const lista = [];
  for (const id of ids) {
    const x = id === a.id ? a : await obterApontamento(id, exec);
    if (x) lista.push(x);
  }
  return lista.length ? lista : [a];
}

/**
 * O lançamento do boletim feito pelo Lançamento Mobile (para conferir, editar ou copiar o texto de novo): com várias
 * O.S., todos os apontamentos dele (`apontamentos`, na ordem dos boletins; `apontamento` é o primeiro) e o texto único.
 */
export async function lancamentoPorBoletim(n) {
  const [a] = await listarApontamentos({ boletim: n });
  if (!a) return { erro: `O boletim nº ${n} não está lançado.`, status: 404 };
  if (a.orig !== "mobile") return { erro: NAO_E_DO_MOBILE, status: 409 };
  const lista = await apontamentosDoLancamento(a);
  const modelo = await modeloDoApontamento(getPool(), lista[0]);
  const apontamentos = lista.map((x) => ({ ...x, modelo }));
  return { apontamento: apontamentos[0], apontamentos, texto: montarTextoWhatsapp(apontamentos, { modelo }) };
}

// ---------------------------------------------------------------------------
// Gravação
// ---------------------------------------------------------------------------

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const texto = (v) => (typeof v === "string" ? v : typeof v === "number" && Number.isFinite(v) ? String(v) : "");
/** Inteiro digitado; em branco = 0 (o resto a validação do apontamento recusa). */
const inteiroOuZero = (v) => {
  const s = texto(v).trim();
  return s === "" ? 0 : Number(s);
};
const falha = (status, error) => ({ status, corpo: { error } });
/** O nº do boletim foi tomado por outro lançamento entre a conferência e o INSERT (índice único de ap_dia.bol). */
const boletimTomado = (err) => err?.code === "23505" && err?.constraint === "idx_ap_dia_bol";

/**
 * Gravações do Lançamento Mobile neste processo, uma de cada vez. A transação do lançamento segura uma conexão do pool
 * do começo ao fim, e o salvarApontamento (e a exclusão) ainda leem pelo pool lá dentro (regras, O.S., cadastros):
 * várias transações abertas ao mesmo tempo podiam prender todas as conexões e deixar essas leituras esperando para
 * sempre. Na fila, a gravação espera sem segurar conexão; a que falha não trava as seguintes.
 */
let filaDeGravacao = Promise.resolve();
function naFila(fn) {
  const vez = filaDeGravacao.then(fn);
  filaDeGravacao = vez.catch(() => {});
  return vez;
}

/**
 * Avisos do lançamento antes de gravar: área acima do saldo do talhão da O.S., outro apontamento na mesma data, O.S.,
 * operação e talhão, talhão fora da O.S. e área acima da do talhão. Devolve também os talhões com o código que vai ser
 * gravado (o da O.S. quando casa) ou o erro (fazenda fora do cadastro). `excluir`: os apontamentos do lançamento aberto
 * para editar (a gravação reescreve ou exclui todos), que não contam como outro lançamento.
 */
async function avisosDoLancamento(pool, info, o, talhoes, dt, excluir) {
  const avisos = [];
  const feitosOp = info.realizado[o.cod] ?? {};
  const fazendas = new Map();
  const gravados = [];
  for (const t of talhoes) {
    if (!(t.area > 0)) continue;
    const doOS = talhaoDaOS(o, t.propCod, t.tlh);
    if (doOS) {
      const nome = nomeTalhao(doOS.propCod, doOS.tlh);
      const ja = feitosOp[chaveTalhao(doOS.propCod, doOS.tlh)] ?? 0;
      const ref = doOS.areaRec ?? doOS.areaTlh ?? 0;
      const saldo = Math.max(0, round2(ref - ja));
      if (t.area > saldo + 0.001) {
        avisos.push({
          tipo: "saldo",
          texto: `Talhão ${nome}: ${fmtArea(t.area)} ha passa do saldo de ${fmtArea(saldo)} ha (já apontado ${fmtArea(ja)} ha de ${fmtArea(ref)} ha).`,
        });
      }
      if (doOS.areaTlh !== null && doOS.areaTlh !== undefined && t.area > doOS.areaTlh + 0.001) {
        avisos.push({ tipo: "area-talhao", texto: `Talhão ${nome}: ${fmtArea(t.area)} ha passa da área do talhão (${fmtArea(doOS.areaTlh)} ha).` });
      }
      gravados.push({ propCod: doOS.propCod, tlh: doOS.tlh });
      continue;
    }
    if (!t.propCod) return { erro: "Informe a fazenda do talhão que não está na O.S." };
    if (!fazendas.has(t.propCod)) fazendas.set(t.propCod, await fazendaDoLancamento(t.propCod, dt));
    const f = fazendas.get(t.propCod);
    if (!f.fazenda) return { erro: `A fazenda ${t.propCod} não está no Cadastro de Fazenda. Cadastre ou importe a fazenda antes.` };
    const daBase = f.talhoes.find((x) => normTlh(x.tlh) === normTlh(t.tlh));
    const tlh = daBase?.tlh ?? t.tlh;
    const nome = nomeTalhao(f.fazenda.cod, tlh);
    avisos.push({ tipo: "fora-da-os", texto: `${tlh ? "Talhão" : "Fazenda"} ${nome} não está na O.S. ${info.os} para a operação ${o.cod}.` });
    if (daBase?.area !== null && daBase?.area !== undefined && t.area > daBase.area + 0.001) {
      avisos.push({ tipo: "area-talhao", texto: `Talhão ${nome}: ${fmtArea(t.area)} ha passa da área do talhão (${fmtArea(daBase.area)} ha).` });
    }
    gravados.push({ propCod: f.fazenda.cod, tlh });
  }
  // outro apontamento (de qualquer origem, inclusive o bot) na mesma data, O.S., operação e talhão
  const { rows } = await pool.query(
    `SELECT a.id, a.bol, t.prop_cod, t.tlh, t.area::float AS area
       FROM ap_dia a JOIN ap_dia_tlh t ON t.ap_id = a.id
      WHERE a.dt = $1::date AND a.os = $2 AND a.op_cod = $3 AND NOT (a.id = ANY($4::int[]))
      ORDER BY a.bol NULLS LAST, a.id, t.prop_cod, t.tlh`,
    [dt, info.os, o.cod, excluir],
  );
  const porApontamento = new Map();
  for (const r of rows) {
    if (!gravados.some((g) => normFaz(g.propCod) === normFaz(r.prop_cod) && normTlh(g.tlh) === normTlh(r.tlh))) continue;
    if (!porApontamento.has(r.id)) porApontamento.set(r.id, { bol: r.bol, id: r.id, talhoes: [] });
    porApontamento.get(r.id).talhoes.push(`${nomeTalhao(r.prop_cod, r.tlh)} (${fmtArea(r.area)} ha)`);
  }
  for (const d of porApontamento.values()) {
    avisos.push({
      tipo: "duplicidade",
      texto: `Já há lançamento em ${dataBR(dt)} na O.S. ${info.os}, operação ${o.cod}: ${d.bol ? `boletim nº ${d.bol}` : `apontamento #${d.id}`} com ${d.talhoes.join(", ")}.`,
    });
  }
  return { avisos };
}

/**
 * Operação do lançamento sem O.S. pelo código ("010" = "10"): a do cadastro Operações ativa (a inativa só no lançamento
 * aberto para editar que já a tinha, `atual`) ou, fora do cadastro, a que já aparece nas O.S. e nos apontamentos — as
 * mesmas da lista da tela. { cod, ds } ou { erro }.
 */
async function operacaoSemOS(pool, cod, atual) {
  const c = (await operacoesDoCadastro(pool)).get(codigoOperacao(cod));
  if (c) {
    if (c.ativo || (atual && codigoOperacao(atual.opCod) === codigoOperacao(c.cod))) return { cod: c.cod, ds: c.nm ?? "" };
    return { erro: `A operação ${c.cod} está inativa no cadastro Operações. Escolha outra operação.` };
  }
  const r = (
    await pool.query(
      `SELECT op_cod AS cod, MAX(op_ds) AS ds FROM (
         SELECT op_cod, op_ds FROM os_agr UNION ALL SELECT op_cod, op_ds FROM os_tlh UNION ALL SELECT op_cod, op_ds FROM ap_dia) x
        WHERE op_cod <> '' AND ${igualSemZeros("op_cod", 1)}
        GROUP BY op_cod ORDER BY (op_cod = $1) DESC LIMIT 1`,
      [cod],
    )
  ).rows[0];
  if (!r) return { erro: `A operação ${cod} não está no cadastro Operações.` };
  return { cod: r.cod, ds: r.ds ?? "" };
}

/**
 * Avisos do lançamento sem O.S. antes de gravar: área acima da do talhão (base Fazenda e Talhões da safra da data) e
 * outro apontamento sem O.S. (de qualquer origem, inclusive o bot) na mesma data, operação, fazenda e talhão — sem
 * contar os do lançamento aberto para editar (`excluir`). Sem "saldo": sem O.S. não há o que falta. Com a fazenda fora
 * do Cadastro de Fazenda, o erro.
 */
async function avisosSemOS(pool, op, talhoes, dt, excluir) {
  const avisos = [];
  const fazendas = new Map();
  const gravados = [];
  for (const t of talhoes) {
    if (!(t.area > 0)) continue;
    if (!t.propCod) return { erro: "Informe a fazenda de todos os talhões." };
    if (!fazendas.has(t.propCod)) fazendas.set(t.propCod, await fazendaDoLancamento(t.propCod, dt));
    const f = fazendas.get(t.propCod);
    if (!f.fazenda) return { erro: `A fazenda ${t.propCod} não está no Cadastro de Fazenda. Cadastre ou importe a fazenda antes.` };
    const daBase = f.talhoes.find((x) => normTlh(x.tlh) === normTlh(t.tlh));
    const tlh = daBase?.tlh ?? t.tlh;
    const nome = nomeTalhao(f.fazenda.cod, tlh);
    if (daBase?.area !== null && daBase?.area !== undefined && t.area > daBase.area + 0.001) {
      avisos.push({ tipo: "area-talhao", texto: `Talhão ${nome}: ${fmtArea(t.area)} ha passa da área do talhão (${fmtArea(daBase.area)} ha).` });
    }
    gravados.push({ propCod: f.fazenda.cod, tlh });
  }
  const { rows } = await pool.query(
    `SELECT a.id, a.bol, t.prop_cod, t.tlh, t.area::float AS area
       FROM ap_dia a JOIN ap_dia_tlh t ON t.ap_id = a.id
      WHERE a.dt = $1::date AND a.os = '' AND ${igualSemZeros("a.op_cod", 2)} AND NOT (a.id = ANY($3::int[]))
      ORDER BY a.bol NULLS LAST, a.id, t.prop_cod, t.tlh`,
    [dt, op.cod, excluir],
  );
  const porApontamento = new Map();
  for (const r of rows) {
    if (!gravados.some((g) => normFaz(g.propCod) === normFaz(r.prop_cod) && normTlh(g.tlh) === normTlh(r.tlh))) continue;
    if (!porApontamento.has(r.id)) porApontamento.set(r.id, { bol: r.bol, id: r.id, talhoes: [] });
    porApontamento.get(r.id).talhoes.push(`${nomeTalhao(r.prop_cod, r.tlh)} (${fmtArea(r.area)} ha)`);
  }
  for (const d of porApontamento.values()) {
    avisos.push({
      tipo: "duplicidade",
      texto: `Já há lançamento sem O.S. em ${dataBR(dt)} com a operação ${op.cod}: ${d.bol ? `boletim nº ${d.bol}` : `apontamento #${d.id}`} com ${d.talhoes.join(", ")}.`,
    });
  }
  return { avisos };
}

/** Máximo de O.S./operações num lançamento. */
const MAX_ORDENS = 20;
/** Id de apontamento enviado: undefined em branco, NaN inválido. */
const idEnviado = (v) => {
  const s = texto(v).trim();
  if (s === "") return undefined;
  const n = Number(s);
  return Number.isInteger(n) && n > 0 ? n : NaN;
};
/** Campo de texto opcional de uma O.S. do lançamento: undefined quando não veio (vale o do cabeçalho). */
const opcional = (v) => (v === undefined || v === null ? undefined : texto(v).trim());
const mesmaOS = (a, b) => String(a ?? "").trim().replace(/^0+(?=\d)/, "") === String(b ?? "").trim().replace(/^0+(?=\d)/, "");

/**
 * O.S./operações do lançamento como a tela mandou: `ordens` (uma ou várias) ou, no formato da primeira versão da tela,
 * os campos soltos de uma O.S. só (`id`, `os`, `opCod`, `statusOS`, `talhoes`). A O.S. em branco é o lançamento sem
 * O.S. (Lançar sem O.S.). Talhão desmarcado (área zero ou em branco) não vai; área inválida a validação do apontamento
 * recusa.
 */
function ordensDoCorpo(b) {
  const brutas = Array.isArray(b.ordens) ? b.ordens : [{ id: b.id, os: b.os, opCod: b.opCod, statusOS: b.statusOS, talhoes: b.talhoes }];
  return brutas.slice(0, MAX_ORDENS + 1).map((x) => {
    const o = x && typeof x === "object" && !Array.isArray(x) ? x : {};
    return {
      id: idEnviado(o.id),
      os: texto(o.os).trim().replace(/^0+(?=\d)/, ""),
      opCod: texto(o.opCod).trim(),
      statusOS: texto(o.statusOS).trim().toUpperCase(),
      solicitante: opcional(o.solicitante),
      etapaCod: opcional(o.etapaCod),
      tipoAplicacao: opcional(o.tipoAplicacao),
      talhoes: (Array.isArray(o.talhoes) ? o.talhoes : [])
        .slice(0, 300)
        .map((t) => ({
          propCod: texto(t?.propCod).trim(),
          tlh: texto(t?.tlh).trim(),
          area: lerNumero(typeof t?.area === "number" ? t.area : texto(t?.area)) ?? 0,
        }))
        .filter((t) => t.area !== 0),
    };
  });
}

/**
 * Calda/insumo gasto do lançamento rateado entre as O.S. pela área de cada uma (três casas; a última leva o resto, para
 * a soma bater). Uma O.S. só, sem calda ou com número inválido: o valor como veio (a validação recusa o inválido).
 */
function ratearCalda(vol, areas) {
  if (areas.length < 2 || !(vol > 0)) return areas.map(() => vol);
  const soma = areas.reduce((a, b) => a + b, 0);
  if (!(soma > 0)) return areas.map((_, i) => (i === areas.length - 1 ? vol : 0));
  let resto = vol;
  return areas.map((a, i) => {
    if (i === areas.length - 1) return Math.max(0, Math.round(resto * 1e6) / 1e6);
    const v = Math.round(((vol * a) / soma) * 1000) / 1000;
    resto -= v;
    return v;
  });
}

/**
 * Inclui ou altera um lançamento do Lançamento Mobile, de uma ou de várias O.S. (`ordens`: um apontamento por
 * O.S./operação, a mesma O.S. com a mesma operação não entra duas vezes). Na edição, `id` é um apontamento do
 * lançamento aberto, `boletins` os que ele tinha ao abrir (e cada O.S. que já estava nele manda o `id` dela): os que
 * vieram são alterados, os novos incluídos e os que saíram do lançamento excluídos (com o registro no Log de
 * Alterações). Com avisos (saldo, duplicidade, fora da O.S., área do talhão) de qualquer O.S. e sem `confirmar`, não
 * grava: 409 com todos os avisos. Os novos levam os próximos nºs de boletim livres, seguidos (outro lançamento que
 * pegar os mesmos nºs ao mesmo tempo faz tentar os seguintes); tudo numa transação (uma gravação por vez neste
 * processo: naFila). Os avisos não contam os apontamentos do lançamento aberto, que a gravação reescreve ou exclui.
 * A O.S. em branco é o lançamento sem O.S. (um por lançamento; a operação é obrigatória): grava sem O.S. pelo
 * salvarApontamento, com os avisos de área acima da do talhão e de outro lançamento sem O.S. na mesma data, operação e
 * talhão; com a O.S. obrigatória nos Parâmetros, recusa.
 * Devolve { status, corpo } — corpo com os boletins e o texto para o WhatsApp.
 */
export async function gravarLancamentoMobile(b, usuario) {
  const pool = getPool();
  await prepararAtividades(pool);
  await prepararOSAgr(pool);
  const dt = texto(b.dt).trim();
  const matricula = texto(b.matricula).trim();
  if (!ISO.test(dt) || Number.isNaN(Date.parse(dt))) return falha(400, "Informe a data da operação.");
  const ordens = ordensDoCorpo(b);
  if (ordens.length === 0) return falha(400, "Informe a O.S.");
  if (ordens.length > MAX_ORDENS) return falha(400, `No máximo ${MAX_ORDENS} O.S. por lançamento.`);
  const varias = ordens.length > 1;
  // erro de uma O.S. (ou do lançamento sem O.S.): com várias, diz qual
  const daOS = (ord, msg) => (varias ? `${ord.os ? `O.S. ${ord.os}` : "Sem O.S."}${ord.opCod ? ` (operação ${ord.opCod})` : ""}: ${msg}` : msg);
  const regras = await regrasApontamento();
  const semOS = ordens.filter((o) => !o.os);
  if (semOS.length && regras.os) {
    return falha(400, "A O.S. é obrigatória nos Parâmetros › Apontamento Diário: não dá para lançar sem O.S.");
  }
  if (semOS.length > 1) return falha(400, "Só um lançamento sem O.S. por vez: tire o outro bloco sem O.S. (ou grave em lançamentos separados).");
  for (const ord of ordens) {
    if (!ord.opCod) return falha(400, daOS(ord, ord.os ? "Escolha a operação." : "Escolha a operação do lançamento sem O.S."));
    // sem O.S. não há status de O.S.
    if (!ord.os) ord.statusOS = "";
    if (ord.statusOS && !STATUS_OS.includes(ord.statusOS)) return falha(400, daOS(ord, `Escolha o status da O.S.: ${STATUS_OS.join(", ")}.`));
    if (Number.isNaN(ord.id)) return falha(400, "Apontamento inválido.");
    // sem O.S. a etapa não vem da operação da O.S.: a escolhida, obrigatória conforme os Parâmetros
    if (!ord.os && regras.etapa && !(ord.etapaCod ?? texto(b.etapaCod).trim())) {
      return falha(400, daOS(ord, "Escolha a etapa do lançamento sem O.S. (obrigatória nos Parâmetros › Apontamento Diário)."));
    }
  }
  if (!matriculaValida(matricula)) return falha(400, "Informe a matrícula ou o código de quem está lançando.");

  // edição: o lançamento aberto (pelo `id`; sem ele, pelo de alguma O.S.), só do que o Lançamento Mobile lançou. No
  // formato de uma O.S. só (tela aberta antes das várias O.S.), altera só aquele apontamento: os outros do lançamento
  // ficam (e continuam ligados a ele)
  const formatoAntigo = !Array.isArray(b.ordens);
  const ancora = idEnviado(b.id) ?? ordens.find((o) => o.id !== undefined)?.id;
  if (Number.isNaN(ancora)) return falha(400, "Apontamento inválido.");
  let membros = [];
  if (ancora !== undefined) {
    const atual = await obterApontamento(ancora);
    if (!atual) return falha(404, "Apontamento não encontrado.");
    if (atual.orig !== "mobile") return falha(409, NAO_E_DO_MOBILE);
    membros = formatoAntigo ? [atual] : await apontamentosDoLancamento(atual);
    // `boletins`: os do lançamento quando a tela o abriu; boletim que entrou nele depois (outro aparelho) não é
    // excluído sem ninguém ter visto
    const abertos = Array.isArray(b.boletins) ? b.boletins.map(Number) : null;
    if (abertos && membros.some((m) => m.boletim !== null && !abertos.includes(m.boletim))) {
      return falha(409, "O lançamento mudou enquanto era editado (outro boletim entrou nele). Abra o lançamento de novo.");
    }
  }
  const usados = new Set();
  for (const ord of ordens) {
    if (ord.id === undefined) continue;
    if (!membros.some((m) => m.id === ord.id) || usados.has(ord.id)) {
      return falha(409, "O lançamento mudou enquanto era editado (alguma O.S. não faz mais parte dele). Abra o lançamento de novo.");
    }
    usados.add(ord.id);
  }
  // O.S./operação tirada e posta de novo no lançamento: altera o apontamento que já existia (não exclui e inclui)
  for (const ord of ordens) {
    if (ord.id !== undefined) continue;
    const m = membros.find((x) => !usados.has(x.id) && mesmaOS(x.os, ord.os) && codigoOperacao(x.opCod) === codigoOperacao(ord.opCod));
    if (m) {
      ord.id = m.id;
      usados.add(m.id);
    }
  }
  const removidos = membros.filter((m) => !usados.has(m.id));
  // os apontamentos do lançamento aberto: esta gravação reescreve (talhões, O.S., operação) ou exclui todos, então nenhum
  // conta no saldo nem como lançamento repetido — nem o que sai do lançamento, nem o que troca de O.S./operação
  const idsDoLancamento = membros.map((m) => m.id);

  // cada O.S.: a operação, os avisos (o saldo e o "Já apontado" sem contar o lançamento aberto) e os talhões
  const resolvidas = [];
  const avisos = [];
  const vistas = new Set();
  for (const ord of ordens) {
    if (!ord.os) {
      // sem O.S.: a operação do cadastro, as fazendas do Cadastro de Fazenda e os talhões da base da safra da data
      const atual = ord.id === undefined ? null : (membros.find((m) => m.id === ord.id) ?? null);
      const op = await operacaoSemOS(pool, ord.opCod, atual);
      if (op.erro) return falha(400, daOS(ord, op.erro));
      if (varias && !ord.talhoes.some((t) => t.area > 0)) {
        return falha(400, `Informe a área realizada em pelo menos um talhão do lançamento sem O.S. (operação ${op.cod}).`);
      }
      const av = await avisosSemOS(pool, op, ord.talhoes, dt, idsDoLancamento);
      if (av.erro) return falha(400, daOS(ord, av.erro));
      for (const a of av.avisos) {
        avisos.push(varias && a.tipo === "area-talhao" ? { ...a, texto: `Sem O.S. (operação ${op.cod}) · ${a.texto}` } : a);
      }
      resolvidas.push({ ord, info: null, o: op, semOS: true, atual });
      continue;
    }
    const info = await consultarOS(ord.os, ord.id, dt);
    if (!info) return falha(400, OS_FORA_DA_BASE(ord.os));
    await descontarApontamentos(pool, info, idsDoLancamento.filter((x) => x !== ord.id));
    const o = operacaoDaOS(info, ord.opCod);
    if (!o) return falha(400, `A operação ${ord.opCod} não faz parte da O.S. ${info.os}.`);
    const k = `${info.os}|${o.cod}`;
    if (vistas.has(k)) return falha(400, `A O.S. ${info.os} com a operação ${o.cod} está duas vezes no lançamento.`);
    vistas.add(k);
    if (varias && !ord.talhoes.some((t) => t.area > 0)) {
      return falha(400, `Informe a área realizada em pelo menos um talhão da O.S. ${info.os} (operação ${o.cod}).`);
    }
    const av = await avisosDoLancamento(pool, info, o, ord.talhoes, dt, idsDoLancamento);
    if (av.erro) return falha(400, varias ? `O.S. ${info.os} (operação ${o.cod}): ${av.erro}` : av.erro);
    // saldo e área do talhão não dizem a O.S.: com várias, vão com ela na frente
    for (const a of av.avisos) {
      avisos.push(varias && (a.tipo === "saldo" || a.tipo === "area-talhao") ? { ...a, texto: `O.S. ${info.os} (operação ${o.cod}) · ${a.texto}` } : a);
    }
    resolvidas.push({ ord, info, o, atual: ord.id === undefined ? null : (membros.find((m) => m.id === ord.id) ?? null) });
  }
  // tipo de aplicação: só o do cadastro Tipo Aplicação (ativo), gravado com a descrição dele; o que o lançamento aberto
  // já tinha gravado (fora do cadastro ou de um tipo inativado) fica. Sem nenhum tipo ativo no cadastro, não confere
  const tipos = await tiposAplicacao(pool);
  if (tipos.length) {
    const gravados = new Set(membros.map((m) => chaveBusca(m.tipoAplicacao)).filter(Boolean));
    for (const ord of ordens) {
      const v = ord.tipoAplicacao ?? texto(b.tipoAplicacao).trim();
      if (!v) continue;
      const t = tipoDoCadastro(tipos, v);
      if (t) ord.tipoAplicacao = t.ds;
      else if (gravados.has(chaveBusca(v))) ord.tipoAplicacao = v;
      else return falha(400, daOS(ord, `O tipo de aplicação “${v}” não está no cadastro Tipo Aplicação. Escolha um tipo da lista.`));
    }
  }
  if (avisos.length > 0 && b.confirmar !== true) {
    return { status: 409, corpo: { error: "Confira os avisos antes de gravar.", precisaConfirmar: true, avisos } };
  }

  const resp = await responsavelPorMatricula(pool, matricula);
  const classificacao = (await classificacoes(pool)).get(codigoOperacao(resolvidas[0].o.cod)) ?? "";
  const modelo = b.modelo === "manual" || b.modelo === "mecanizada" ? b.modelo : modeloDaClassificacao(classificacao);
  const volCalda = lerNumero(typeof b.volCalda === "number" ? b.volCalda : texto(b.volCalda));
  const caldas = ratearCalda(
    volCalda,
    resolvidas.map((r) => round2(r.ord.talhoes.reduce((a, t) => a + (t.area > 0 ? t.area : 0), 0))),
  );
  // o cabeçalho é o mesmo em todas as O.S. (solicitante, etapa e tipo: o de cada O.S., quando a tela manda)
  const entradas = resolvidas.map(({ ord, info, o, atual, semOS: sem }, i) => ({
    dt,
    semOS: !!sem,
    os: sem ? "" : info.os,
    opCod: o.cod,
    // sem O.S., a descrição do cadastro (com O.S., a da operação da O.S.)
    opDs: sem ? o.ds : "",
    modoArea: "talhao",
    volume: null,
    // solicitante em branco: o responsável da O.S. (como ao digitar a O.S. no Apontamento); sem O.S., quem lança
    solicitante: (ord.solicitante ?? texto(b.solicitante).trim()) || (sem ? resp?.nome : info.resp) || "",
    // apontador / informante: o enviado ou o nome de quem lança (pela matrícula)
    apontador: texto(b.apontador).trim() || resp?.nome || "",
    etapaCod: ord.etapaCod ?? texto(b.etapaCod).trim(),
    tipoAplicacao: ord.tipoAplicacao ?? texto(b.tipoAplicacao).trim(),
    numEquipamentos: inteiroOuZero(b.numEquipamentos),
    numPessoas: inteiroOuZero(b.numPessoas),
    obs: texto(b.obs),
    eqp: texto(b.eqp).trim().toUpperCase(),
    vazaoRec: lerNumero(typeof b.vazaoRec === "number" ? b.vazaoRec : texto(b.vazaoRec)),
    // a tela não tem vazão utilizada: calculada pela calda ÷ área (a informada na tela Apontamento fica)
    vazaoUti: atual && !atual.vazaoAuto ? atual.vazaoUti : null,
    volCalda: caldas[i],
    // os insumos (lançados na tela Apontamento) ficam como estão
    insumos: (atual?.insumos ?? []).map((x) => ({ cod: x.cod, dose: x.dose, qtd: x.qtd, dep: x.dep ?? "" })),
    talhoes: ord.talhoes,
    equipe: texto(b.equipe).trim(),
    atividade: texto(b.atividade).trim() || o.ds,
    statusOS: ord.statusOS,
    unCalda: b.unCalda === "kg" ? "kg" : "L",
    apontadorMat: resp?.matricula || matricula,
    modelo,
  }));
  // várias O.S.: o mesmo lanc_grp (o que o lançamento já tinha ou um novo); uma O.S. só fica sem (no formato antigo, o
  // apontamento continua no lançamento em que estava)
  const lancGrp = formatoAntigo ? (membros[0]?.lancGrp ?? null) : varias ? (membros.find((m) => m.lancGrp)?.lancGrp ?? randomUUID()) : null;

  // a transação, uma gravação de lançamento por vez neste processo (naFila): { ids } gravados ou { falha }
  const gravado = await naFila(async () => {
    for (let tentativa = 0; ; tentativa++) {
      const client = await pool.connect();
      let repetir = false;
      const idsGravados = [];
      try {
        await client.query("BEGIN");
        // boletins: os que já existiam ficam; os novos são os próximos livres, seguidos
        let proximo = null;
        const boletins = [];
        for (const r of resolvidas) {
          if (r.atual?.boletim) boletins.push(r.atual.boletim);
          else {
            if (proximo === null) proximo = (await client.query("SELECT (COALESCE(MAX(bol), 0) + 1)::int AS n FROM ap_dia")).rows[0].n;
            boletins.push(proximo++);
          }
        }
        // no Log de Alterações, cada apontamento do lançamento com várias O.S. diz os boletins do lançamento
        const log = varias ? { lancamentoMobile: `Boletins nº ${listaDeBoletins(boletins)} (${resolvidas.length} O.S. no mesmo lançamento)` } : undefined;
        let erro = null;
        for (const [i, r] of resolvidas.entries()) {
          // sem O.S. não há talhão "fora da O.S.": as fazendas e os talhões vêm do cadastro e da base da safra
          const s = await salvarApontamento({ ...entradas[i], boletim: boletins[i] }, usuario, r.ord.id, {
            permitirForaDaOS: !r.semOS,
            orig: "mobile",
            client,
            log,
          });
          if (s.erro) {
            if (s.codigo === "boletim-repetido" && !r.atual?.boletim && tentativa < 4) repetir = true;
            else erro = varias ? `${r.semOS ? "Sem O.S." : `O.S. ${r.info.os}`} (operação ${r.o.cod}): ${s.erro}` : s.erro;
            break;
          }
          idsGravados.push(s.id);
        }
        if (repetir || erro) {
          await client.query("ROLLBACK");
          if (erro) return { falha: falha(400, erro) };
        } else {
          await client.query("UPDATE ap_dia SET lanc_grp = $1 WHERE id = ANY($2::int[])", [lancGrp, idsGravados]);
          // as O.S. que saíram do lançamento: o apontamento delas é excluído
          for (const m of removidos) {
            const ex = await excluirApontamento(m.id, usuario, client);
            if (ex?.erro) {
              await client.query("ROLLBACK");
              return { falha: falha(409, "O lançamento mudou enquanto era editado (algum boletim já foi excluído). Abra o lançamento de novo.") };
            }
          }
          await client.query("COMMIT");
        }
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        if (tentativa < 4 && boletimTomado(err)) repetir = true;
        else throw err;
      } finally {
        client.release();
      }
      if (!repetir) return { ids: idsGravados };
    }
  });
  if (gravado.falha) return gravado.falha;
  const { ids } = gravado;

  const lista = [];
  for (const id of ids) {
    const a = await obterApontamento(id);
    if (a) lista.push(a);
  }
  const m = lista[0] ? await modeloDoApontamento(pool, lista[0]) : modelo;
  return {
    status: 200,
    corpo: {
      ok: true,
      id: lista[0]?.id ?? ids[0] ?? null,
      boletim: lista[0]?.boletim ?? null,
      ids,
      boletins: lista.map((a) => a.boletim),
      texto: montarTextoWhatsapp(lista, { modelo: m }),
      avisos,
    },
  };
}
