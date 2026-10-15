import { chaveTalhao, round2 } from "./atividades";
import { dataBR } from "./auditar";
import { codigoOperacao } from "./dashboard-atividades";
import { getPool } from "./db";
import {
  consultarOS,
  listarApontamentos,
  obterApontamento,
  opcoesApontamento,
  operacoesDaOS,
  prepararAtividades,
  proximoBoletimAtividade,
  salvarApontamento,
} from "./db-atividades";
import { nomeOperacao, operacoesDoCadastro } from "./db-operacoes";
import { prepararOSAgr } from "./db-os-agr";
import { buscarCodigo, talhoesDaFazenda } from "./db-rodadas";
import { areasDaBase } from "./db-talhoes";
import { fmtArea, lerNumero, matriculaValida, modeloDaClassificacao, montarTextoWhatsapp, STATUS_OS } from "./lancamento-mobile";
import { normFaz, normTlh } from "./ocupacao";

/*
 * Lançamento Mobile (Atividades): o apontamento diário lançado no campo pelo celular. Quem lança informa a matrícula (ou
 * o código) e vê só as O.S. em aberto dele; o saldo e o "Já apontado" são os mesmos da tela Apontamento (consultarOS /
 * operacoesDaOS). Grava pelo mesmo salvarApontamento (origem 'mobile'), aceitando fazendas e talhões fora da O.S., e
 * devolve o texto padrão para o grupo do WhatsApp (lib/lancamento-mobile.js).
 */

const NAO_E_DO_MOBILE = "Este boletim não foi lançado pelo Lançamento Mobile; edite na tela Apontamento.";
const OS_FORA_DA_BASE = (os) =>
  `A O.S. ${os} não está na base de O.S. Importe o Relatório de Ordens de Serviço atualizado em Ordem de Serviço Agr. › Ordens de Serviço.`;

/** Condição SQL: `col` igual ao parâmetro $p; sendo os dois números, sem os zeros à esquerda (601448 = 0601448). */
const igualSemZeros = (col, p) => `(${col} = $${p} OR (${col} ~ '^[0-9]+$' AND $${p} ~ '^[0-9]+$' AND ltrim(${col}, '0') = ltrim($${p}, '0')))`;

/**
 * Quem lança, pela matrícula ou pelo código: o cadastro Responsáveis (Ordem de Serviço Agr.), depois o de Funcionários
 * (matrícula ou código da pessoa) e, por último, o responsável das próprias O.S. null quando não acha em nenhum.
 */
async function responsavelPorMatricula(pool, mat) {
  const r1 = (
    await pool.query(
      `SELECT cod, nm, COALESCE(dds->>'area', '') AS area FROM cad_itm
        WHERE cad = 'responsaveis-os' AND ${igualSemZeros("cod", 1)} ORDER BY cod LIMIT 1`,
      [mat],
    )
  ).rows[0];
  if (r1) return { matricula: r1.cod, nome: r1.nm, area: r1.area };
  const r2 = (
    await pool.query(
      `SELECT cod, nm, COALESCE(NULLIF(btrim(dds->>'matricula'), ''), cod) AS mat, COALESCE(dds->>'nome_centro_de_custo', '') AS area
         FROM cad_itm
        WHERE cad = 'funcionarios' AND (${igualSemZeros("btrim(dds->>'matricula')", 1)} OR ${igualSemZeros("cod", 1)})
        ORDER BY CASE WHEN ${igualSemZeros("btrim(dds->>'matricula')", 1)} THEN 0 ELSE 1 END, cod LIMIT 1`,
      [mat],
    )
  ).rows[0];
  if (r2) return { matricula: r2.mat, nome: r2.nm, area: r2.area };
  const r3 = (
    await pool.query(`SELECT resp_cod, MAX(resp_nm) AS nm FROM os_agr WHERE ${igualSemZeros("resp_cod", 1)} GROUP BY resp_cod ORDER BY resp_cod LIMIT 1`, [mat])
  ).rows[0];
  if (r3) return { matricula: r3.resp_cod, nome: r3.nm ?? "", area: "" };
  return null;
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

// ---------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------

/** Listas da tela: as do Apontamento, com a classificação de cada operação, e as equipes, os equipamentos e os status. */
export async function opcoesLancamentoMobile() {
  const pool = getPool();
  const base = await opcoesApontamento();
  const cls = await classificacoes(pool);
  // equipes já usadas primeiro, depois o cadastro Fornecedores e Prestadores
  const usadas = (await pool.query("SELECT DISTINCT equipe AS e FROM ap_dia WHERE equipe <> '' ORDER BY 1 LIMIT 500")).rows.map((r) => r.e);
  const prestadores = (await pool.query("SELECT DISTINCT nm AS e FROM cad_itm WHERE cad = 'fornecedores-prestadores' AND nm <> '' ORDER BY 1 LIMIT 2000")).rows.map(
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
    operacoes: base.operacoes.map((o) => ({ cod: o.cod, ds: o.ds, etapaCod: o.etapaCod, classificacao: cls.get(codigoOperacao(o.cod)) ?? "" })),
    etapas: base.etapas,
    tipos: base.tipos,
    solicitantes: base.solicitantes,
    equipes: [...new Set([...usadas, ...prestadores])].slice(0, 2000),
    equipamentos,
    statusOS: STATUS_OS,
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
  const mat = responsavel?.matricula || matricula;
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
  if (!responsavel && rows.length === 0) return null;
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
      resp: linhas.map((r) => String(r.resp_nm ?? "").trim()).find(Boolean) ?? responsavel?.nome ?? "",
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
 * Uma operação da O.S. para lançar: os talhões com a área (base Fazenda e Talhões da safra da data), a recomendada, o já
 * apontado e o saldo (sem contar o apontamento `excluirId`, o que está sendo editado), o último apontamento de cada
 * talhão e o da operação.
 */
export async function detalheDaOperacao(os, opCod, dt, excluirId) {
  const pool = getPool();
  const info = await consultarOS(os, excluirId, dt);
  if (!info) return { erro: OS_FORA_DA_BASE(os), status: 404 };
  const o = operacaoDaOS(info, opCod);
  if (!o) return { erro: `A operação ${opCod} não faz parte da O.S. ${info.os}.`, status: 404 };
  const classificacao = (await classificacoes(pool)).get(codigoOperacao(o.cod)) ?? "";
  const feitosOp = info.realizado[o.cod] ?? {};
  const params = [info.os, o.cod, excluirId ?? null];
  const ultimosTalhao = new Map(
    (
      await pool.query(
        `SELECT DISTINCT ON (t.prop_cod, t.tlh) t.prop_cod, t.tlh, a.dt::text AS dt, a.bol, t.area::float AS area
           FROM ap_dia a JOIN ap_dia_tlh t ON t.ap_id = a.id
          WHERE a.os = $1 AND a.op_cod = $2 AND ($3::int IS NULL OR a.id <> $3::int)
          ORDER BY t.prop_cod, t.tlh, a.dt DESC, a.id DESC`,
        params,
      )
    ).rows.map((r) => [chaveTalhao(r.prop_cod, r.tlh), r]),
  );
  const ult = (
    await pool.query(
      `SELECT a.id, a.bol, a.dt::text AS dt, (SELECT COALESCE(SUM(t.area), 0) FROM ap_dia_tlh t WHERE t.ap_id = a.id)::float AS area
         FROM ap_dia a
        WHERE a.os = $1 AND a.op_cod = $2 AND ($3::int IS NULL OR a.id <> $3::int)
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
      tipoDs: o.tipoDs ?? "",
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

/** Apontamentos lançados pelo Lançamento Mobile com a matrícula (a digitada ou a do cadastro), mais recentes primeiro. */
export async function meusLancamentos(matricula, de, ate) {
  const pool = getPool();
  await prepararAtividades(pool);
  await prepararOSAgr(pool);
  const resp = await responsavelPorMatricula(pool, matricula);
  const { rows } = await pool.query(
    `SELECT a.id, a.bol, a.dt::text AS dt, a.os, a.op_cod, a.op_ds, a.sts_os,
            (SELECT COALESCE(SUM(t.area), 0) FROM ap_dia_tlh t WHERE t.ap_id = a.id)::float AS area
       FROM ap_dia a
      WHERE a.orig = 'mobile' AND (${igualSemZeros("a.apont_mat", 1)} OR ${igualSemZeros("a.apont_mat", 2)})
        AND ($3::date IS NULL OR a.dt >= $3::date) AND ($4::date IS NULL OR a.dt <= $4::date)
      ORDER BY a.dt DESC, a.id DESC
      LIMIT 200`,
    [matricula, resp?.matricula || matricula, de || null, ate || null],
  );
  const cadOps = await operacoesDoCadastro(pool);
  return rows.map((r) => ({
    id: r.id,
    boletim: r.bol,
    dt: r.dt,
    os: r.os,
    opCod: r.op_cod,
    opDs: nomeOperacao(cadOps, r.op_cod, r.op_ds),
    areaTotal: round2(r.area),
    statusOS: r.sts_os ?? "",
  }));
}

/** Modelo do texto de um apontamento: o gravado; sem ele, pela classificação da operação. */
async function modeloDoApontamento(pool, a) {
  if (a.modelo === "manual" || a.modelo === "mecanizada") return a.modelo;
  return modeloDaClassificacao((await classificacoes(pool)).get(codigoOperacao(a.opCod)) ?? "");
}

/** O boletim lançado pelo Lançamento Mobile (para conferir, editar ou copiar o texto de novo). */
export async function lancamentoPorBoletim(n) {
  const [a] = await listarApontamentos({ boletim: n });
  if (!a) return { erro: `O boletim nº ${n} não está lançado.`, status: 404 };
  if (a.orig !== "mobile") return { erro: NAO_E_DO_MOBILE, status: 409 };
  const modelo = await modeloDoApontamento(getPool(), a);
  return { apontamento: { ...a, modelo }, texto: montarTextoWhatsapp(a, { modelo }) };
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
 * Avisos do lançamento antes de gravar: área acima do saldo do talhão da O.S., outro apontamento na mesma data, O.S.,
 * operação e talhão, talhão fora da O.S. e área acima da do talhão. Devolve também os talhões com o código que vai ser
 * gravado (o da O.S. quando casa) ou o erro (fazenda fora do cadastro).
 */
async function avisosDoLancamento(pool, info, o, talhoes, dt, id) {
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
      WHERE a.dt = $1::date AND a.os = $2 AND a.op_cod = $3 AND ($4::int IS NULL OR a.id <> $4::int)
      ORDER BY a.bol NULLS LAST, a.id, t.prop_cod, t.tlh`,
    [dt, info.os, o.cod, id ?? null],
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
 * Inclui (sem `id`) ou altera um lançamento do Lançamento Mobile. Com avisos (saldo, duplicidade, fora da O.S., área
 * do talhão) e sem `confirmar`, não grava: 409 com os avisos. Sem boletim, usa o próximo livre (e tenta o seguinte se
 * outro lançamento pegar o mesmo nº ao mesmo tempo). Devolve { status, corpo } — corpo com o texto para o WhatsApp.
 */
export async function gravarLancamentoMobile(b, usuario) {
  const pool = getPool();
  await prepararAtividades(pool);
  await prepararOSAgr(pool);
  const dt = texto(b.dt).trim();
  const os = texto(b.os).trim().replace(/^0+(?=\d)/, "");
  const opCod = texto(b.opCod).trim();
  const matricula = texto(b.matricula).trim();
  if (!ISO.test(dt) || Number.isNaN(Date.parse(dt))) return falha(400, "Informe a data da operação.");
  if (!os) return falha(400, "Informe a O.S.");
  if (!opCod) return falha(400, "Escolha a operação.");
  if (!matriculaValida(matricula)) return falha(400, "Informe a matrícula ou o código de quem está lançando.");
  const statusOS = texto(b.statusOS).trim().toUpperCase();
  if (statusOS && !STATUS_OS.includes(statusOS)) return falha(400, `Escolha o status da O.S.: ${STATUS_OS.join(", ")}.`);

  // edição: só do que o Lançamento Mobile lançou
  const id = b.id === undefined || b.id === null || b.id === "" ? undefined : Number(b.id);
  if (id !== undefined && (!Number.isInteger(id) || id <= 0)) return falha(400, "Apontamento inválido.");
  const atual = id === undefined ? null : await obterApontamento(id);
  if (id !== undefined && !atual) return falha(404, "Apontamento não encontrado.");
  if (atual && atual.orig !== "mobile") return falha(409, NAO_E_DO_MOBILE);
  const bolTxt = texto(b.boletim).trim();
  const bolInformado = bolTxt === "" ? null : Number(bolTxt);
  if (bolInformado !== null && (!Number.isInteger(bolInformado) || bolInformado <= 0)) return falha(400, "Número do boletim inválido.");

  const info = await consultarOS(os, id, dt);
  if (!info) return falha(400, OS_FORA_DA_BASE(os));
  const o = operacaoDaOS(info, opCod);
  if (!o) return falha(400, `A operação ${opCod} não faz parte da O.S. ${info.os}.`);
  // talhão desmarcado (área zero ou em branco) não vai; área inválida a validação do apontamento recusa
  const talhoes = (Array.isArray(b.talhoes) ? b.talhoes : [])
    .slice(0, 300)
    .map((t) => ({
      propCod: texto(t?.propCod).trim(),
      tlh: texto(t?.tlh).trim(),
      area: lerNumero(typeof t?.area === "number" ? t.area : texto(t?.area)) ?? 0,
    }))
    .filter((t) => t.area !== 0);

  const av = await avisosDoLancamento(pool, info, o, talhoes, dt, id);
  if (av.erro) return falha(400, av.erro);
  const avisos = av.avisos;
  if (avisos.length > 0 && b.confirmar !== true) {
    return { status: 409, corpo: { error: "Confira os avisos antes de gravar.", precisaConfirmar: true, avisos } };
  }

  const resp = await responsavelPorMatricula(pool, matricula);
  const classificacao = (await classificacoes(pool)).get(codigoOperacao(o.cod)) ?? "";
  const modelo = b.modelo === "manual" || b.modelo === "mecanizada" ? b.modelo : modeloDaClassificacao(classificacao);
  const entrada = {
    dt,
    semOS: false,
    os: info.os,
    opCod: o.cod,
    opDs: "",
    modoArea: "talhao",
    volume: null,
    // solicitante em branco: o responsável da O.S. (como ao digitar a O.S. no Apontamento)
    solicitante: texto(b.solicitante).trim() || info.resp || "",
    // apontador / informante: o enviado ou o nome de quem lança (pela matrícula)
    apontador: texto(b.apontador).trim() || resp?.nome || "",
    etapaCod: texto(b.etapaCod).trim(),
    tipoAplicacao: texto(b.tipoAplicacao).trim(),
    numEquipamentos: inteiroOuZero(b.numEquipamentos),
    numPessoas: inteiroOuZero(b.numPessoas),
    obs: texto(b.obs),
    eqp: texto(b.eqp).trim().toUpperCase(),
    vazaoRec: lerNumero(typeof b.vazaoRec === "number" ? b.vazaoRec : texto(b.vazaoRec)),
    // a tela não tem vazão utilizada: calculada pela calda ÷ área (a informada na tela Apontamento fica)
    vazaoUti: atual && !atual.vazaoAuto ? atual.vazaoUti : null,
    volCalda: lerNumero(typeof b.volCalda === "number" ? b.volCalda : texto(b.volCalda)),
    // os insumos (lançados na tela Apontamento) ficam como estão
    insumos: (atual?.insumos ?? []).map((i) => ({ cod: i.cod, dose: i.dose, qtd: i.qtd, dep: i.dep ?? "" })),
    talhoes,
    equipe: texto(b.equipe).trim(),
    atividade: texto(b.atividade).trim() || o.ds,
    statusOS,
    unCalda: b.unCalda === "kg" ? "kg" : "L",
    apontadorMat: resp?.matricula || matricula,
    modelo,
  };

  let r;
  for (let tentativa = 0; ; tentativa++) {
    const fixo = bolInformado ?? atual?.boletim ?? null;
    const boletim = fixo ?? (await proximoBoletimAtividade());
    try {
      r = await salvarApontamento({ ...entrada, boletim }, usuario, id, { permitirForaDaOS: true, orig: "mobile" });
    } catch (err) {
      if (fixo === null && tentativa < 4 && boletimTomado(err)) continue;
      throw err;
    }
    if (r.erro && fixo === null && tentativa < 4 && r.codigo === "boletim-repetido") continue;
    break;
  }
  if (r.erro) return falha(400, r.erro);
  const a = await obterApontamento(r.id);
  const m = a ? await modeloDoApontamento(pool, a) : modelo;
  return { status: 200, corpo: { ok: true, id: r.id, boletim: a?.boletim ?? null, texto: montarTextoWhatsapp(a, { modelo: m }), avisos } };
}
