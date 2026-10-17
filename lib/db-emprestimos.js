import { auditar, dataBR } from "./auditar";
import { getPool, prepararBanco } from "./db";
import { ASSINANTES_PADRAO, MAX_POR_MES, mesDaSolicitacao, numeroDaSolicitacao, round2, totalItem, validarEmprestimo } from "./emprestimos";
import seed from "./emprestimos-seed.json";

let preparado = null;

/** Cria a tabela dos empréstimos e, só na primeira criação, carrega a base do arquivo "Comunicado de saída de insumo". */
async function preparar(pool) {
  await prepararBanco(pool);
  if (!preparado) {
    preparado = (async () => {
      const existia = (await pool.query("SELECT to_regclass('emp_cab')::text AS t")).rows[0].t !== null;
      await pool.query(
        `CREATE TABLE IF NOT EXISTS emp_cab (
           id serial PRIMARY KEY,
           forn_cod text NOT NULL, forn_nm text NOT NULL, doc text NOT NULL DEFAULT '',
           dt date, dt_sol date,
           faz jsonb NOT NULL DEFAULT '[]', vol text NOT NULL DEFAULT '', vol_tp text NOT NULL DEFAULT 'Calda',
           assin jsonb NOT NULL DEFAULT '[]', itens jsonb NOT NULL DEFAULT '[]',
           obs text NOT NULL DEFAULT '', st text NOT NULL DEFAULT 'Aberto',
           dt_bx date, bx_obs text NOT NULL DEFAULT '', ref text NOT NULL DEFAULT '',
           usr text NOT NULL DEFAULT '', cri_em timestamptz NOT NULL DEFAULT now(),
           atu_usr text, atu_em timestamptz
         )`,
      );
      // nº do boletim digitado antes da Solicitação automática (fica guardado como referência)
      await pool.query("ALTER TABLE emp_cab ADD COLUMN IF NOT EXISTS bol integer");
      await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS idx_emp_cab_bol ON emp_cab (bol) WHERE bol IS NOT NULL");
      // nº da Solicitação: ANO + MÊS + sequência de 3 dígitos no mês (202608001), gerado pelo sistema (único)
      await pool.query("ALTER TABLE emp_cab ADD COLUMN IF NOT EXISTS sol bigint");
      await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS idx_emp_cab_sol ON emp_cab (sol) WHERE sol IS NOT NULL");
      // anexos da Solicitação (ex.: o comunicado assinado, escaneado ou fotografado): saem junto com ela
      await pool.query(
        `CREATE TABLE IF NOT EXISTS emp_anx (
           id serial PRIMARY KEY,
           emp_id integer NOT NULL REFERENCES emp_cab (id) ON DELETE CASCADE,
           nome text NOT NULL, tipo text NOT NULL, tam integer NOT NULL, dados bytea NOT NULL,
           usr text NOT NULL DEFAULT '', cri_em timestamptz NOT NULL DEFAULT now()
         )`,
      );
      await pool.query("CREATE INDEX IF NOT EXISTS idx_emp_anx_emp ON emp_anx (emp_id)");
      if (!existia) {
        for (const e of seed) {
          const itens = e.itens.map((i) => ({
            cod: i.cod,
            nm: i.nm,
            um: i.um,
            dose: i.dose ?? null,
            qtd: i.qtd ?? 0,
            vu: i.vu ?? 0,
            vt: i.vt ?? totalItem(i.qtd ?? 0, i.vu ?? 0),
          }));
          await pool.query(
            `INSERT INTO emp_cab (forn_cod, forn_nm, doc, dt, dt_sol, faz, vol, vol_tp, assin, itens, obs, ref, usr)
             VALUES ($1,$2,$3,$4,NULL,$5::jsonb,$6,$7,$8::jsonb,$9::jsonb,$10,$11,'Carga inicial')`,
            [
              e.forn_cod,
              e.forn_nm,
              e.doc,
              e.dt,
              JSON.stringify(e.faz),
              e.vol,
              /ton|kg|sc/i.test(e.vol) ? "Insumo" : "Calda",
              JSON.stringify(e.assin?.length ? e.assin : ASSINANTES_PADRAO),
              JSON.stringify(itens),
              e.obs ?? "",
              e.aba,
            ],
          );
        }
      }
      // carga: os empréstimos sem nº da Solicitação (os lançados antes dela) ganham o seu
      await numerarSemSolicitacao(pool);
      // os da carga inicial ficam como lançados no sistema: sem as notas de onde vieram na planilha
      await limparNotasDaCarga(pool);
      // quem assina o termo: o cadastro Assinaturas começa com os nomes que o termo já usava
      await carregarAssinaturas(pool);
    })().catch((err) => {
      preparado = null;
      throw err;
    });
  }
  await preparado;
}

/** Data que dá o mês da Solicitação (SQL): a da solicitação; sem ela, a da saída; sem as duas, a do lançamento. */
const DATA_BASE = "COALESCE(dt_sol, dt, (cri_em AT TIME ZONE 'America/Sao_Paulo')::date)";
const TRAVA_SOLICITACAO = "emp_cab_sol";

/**
 * Carga do nº da Solicitação nos empréstimos que não têm (os lançados antes da numeração automática): mês a mês, na
 * ordem da data (a da solicitação, da saída ou do lançamento), do boletim antigo e do lançamento, depois do maior nº que
 * o mês já tem. Uma vez só por empréstimo (os novos já são gravados com o nº); registra no Log de Alterações.
 */
async function numerarSemSolicitacao(pool) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [TRAVA_SOLICITACAO]);
    const { rows } = await client.query(
      `SELECT id, to_char(${DATA_BASE}, 'YYYYMM')::int AS mes FROM emp_cab WHERE sol IS NULL ORDER BY ${DATA_BASE}, bol NULLS LAST, id`,
    );
    if (rows.length === 0) {
      await client.query("ROLLBACK");
      return;
    }
    const ultimo = new Map(
      (await client.query("SELECT (sol / 1000)::int AS mes, MAX(sol % 1000)::int AS seq FROM emp_cab WHERE sol IS NOT NULL GROUP BY 1")).rows.map((r) => [
        r.mes,
        r.seq,
      ]),
    );
    const ids = [];
    const numeros = [];
    for (const r of rows) {
      const seq = (ultimo.get(r.mes) ?? 0) + 1;
      if (seq > MAX_POR_MES) throw new Error(`Mais de ${MAX_POR_MES} empréstimos em ${String(r.mes).slice(4)}/${String(r.mes).slice(0, 4)}: o nº da Solicitação não comporta.`);
      ultimo.set(r.mes, seq);
      ids.push(r.id);
      numeros.push(numeroDaSolicitacao(r.mes, seq));
    }
    await client.query("UPDATE emp_cab e SET sol = u.n FROM unnest($1::int[], $2::bigint[]) AS u(id, n) WHERE e.id = u.id", [ids, numeros]);
    await auditar(client, {
      usuario: "Sistema",
      modulo: "Insumos",
      entidade: "Empréstimo",
      chave: "Carga do nº da Solicitação",
      acao: "alteracao",
      depois: { numerados: ids.length, de: Math.min(...numeros), ate: Math.max(...numeros) },
    });
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Notas da carga inicial sobre de onde veio cada empréstimo na planilha (a aba, "Não consta na aba RESUMO"…) que ficaram
 * na observação e na origem: saem, para os empréstimos da carga ficarem como os lançados no sistema (na tela, no
 * comunicado e no relatório). Só a observação igual à nota da carga (a digitada depois fica); o que saiu vai para o Log
 * de Alterações. Uma vez (depois não há mais o que limpar).
 */
async function limparNotasDaCarga(pool) {
  const notas = [...new Set(seed.map((e) => e.obs ?? "").filter(Boolean))];
  const { rows } = await pool.query(
    `WITH alvo AS (
       SELECT id, sol, obs, ref FROM emp_cab WHERE usr = 'Carga inicial' AND (obs = ANY($1::text[]) OR ref <> '') FOR UPDATE
     )
     UPDATE emp_cab e SET obs = CASE WHEN alvo.obs = ANY($1::text[]) THEN '' ELSE e.obs END, ref = ''
       FROM alvo WHERE e.id = alvo.id
     RETURNING alvo.id, alvo.sol, alvo.obs, alvo.ref`,
    [notas],
  );
  if (rows.length === 0) return;
  await auditar(pool, {
    usuario: "Sistema",
    modulo: "Insumos",
    entidade: "Empréstimo",
    chave: "Carga inicial · notas de origem retiradas",
    acao: "alteracao",
    antes: Object.fromEntries(
      rows.map((r) => [`Solicitação ${r.sol ?? `#${r.id}`}`, [r.ref && `origem: ${r.ref}`, notas.includes(r.obs) && `obs.: ${r.obs}`].filter(Boolean).join(" · ")]),
    ),
  });
}

const CAD_ASSINATURAS = "assinaturas-emprestimo";
const MARCA_ASSINATURAS = "Carga inicial · assinaturas do termo de empréstimo";

/**
 * Carga única do cadastro Assinaturas (Insumos › Empréstimos › Assinaturas) com os nomes que o termo usava até então
 * (ASSINANTES_PADRAO), na ordem 1, 2, 3 e sem função (preenchida no cadastro). Uma vez (o log guarda a marca).
 */
async function carregarAssinaturas(pool) {
  const entidade = "Cadastro de Assinaturas";
  const marcada = async (exec) =>
    ((await exec.query("SELECT 1 FROM aud_log WHERE modulo = 'Cadastros' AND entidade = $1 AND chave = $2 LIMIT 1", [entidade, MARCA_ASSINATURAS])).rowCount ?? 0) > 0;
  if (await marcada(pool)) return;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`carga_${CAD_ASSINATURAS}`]);
    if (await marcada(client)) {
      await client.query("ROLLBACK");
      return;
    }
    const itens = ASSINANTES_PADRAO.map((nm, i) => ({ cod: nm.toUpperCase(), nm, dds: { responsavel: nm, funcao: "", ordem: i + 1 } }));
    const r = await client.query(
      `INSERT INTO cad_itm (cad, cod, nm, dds, usr, atu_usr)
       SELECT $1, x.cod, x.nm, x.dds, 'Carga inicial', 'Carga inicial' FROM jsonb_to_recordset($2::jsonb) AS x(cod text, nm text, dds jsonb)
       ON CONFLICT (cad, cod) DO NOTHING`,
      [CAD_ASSINATURAS, JSON.stringify(itens)],
    );
    await auditar(client, {
      usuario: "Carga inicial",
      modulo: "Cadastros",
      entidade,
      chave: MARCA_ASSINATURAS,
      acao: "importacao",
      depois: { naLista: itens.length, carregados: r.rowCount ?? 0 },
    });
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Quem assina o termo, do cadastro Assinaturas: os ativos, na ordem do nível hierárquico (1 primeiro; na mesma ordem,
 * pelo nome) — [{ nome, funcao, ordem }].
 */
export async function listarAssinaturas() {
  const pool = getPool();
  await preparar(pool);
  const { rows } = await pool.query(
    `SELECT nm, dds->>'funcao' AS funcao, dds->>'ordem' AS ordem FROM cad_itm
      WHERE cad = $1 AND COALESCE(atv, true)
      ORDER BY CASE WHEN dds->>'ordem' ~ '^[0-9]+$' THEN (dds->>'ordem')::int ELSE 999 END, nm`,
    [CAD_ASSINATURAS],
  );
  return rows.map((r) => ({ nome: r.nm, funcao: r.funcao ?? "", ordem: Number(r.ordem) || null }));
}

/** Prepara a tabela dos empréstimos e a carga das assinaturas (a tela Assinaturas abre antes da de Empréstimos). */
export async function prepararAssinaturas() {
  await preparar(getPool());
}

/** Próximo nº da Solicitação do mês `mes` (AAAAMM), na conexão `exec`; null quando o mês já tem o máximo. */
async function proximoNoMes(exec, mes) {
  const seq = (await exec.query("SELECT COALESCE(MAX(sol % 1000), 0)::int + 1 AS s FROM emp_cab WHERE sol / 1000 = $1", [mes])).rows[0].s;
  return seq > MAX_POR_MES ? null : numeroDaSolicitacao(mes, seq);
}

const hojeSP = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });

/**
 * Prepara a tabela dos empréstimos para quem só lê (a caixa de Empréstimos do Início): a coluna do nº da Solicitação e a
 * carga dele nos antigos — sem isso, o Início aberto antes da tela de Empréstimos (logo depois de publicar) não acharia
 * a coluna.
 */
export async function prepararEmprestimos(pool = getPool()) {
  await preparar(pool);
}

function mapa(r) {
  return {
    id: r.id,
    // nº da Solicitação (o pg devolve bigint como texto)
    solicitacao: r.sol === null || r.sol === undefined ? null : Number(r.sol),
    // nº do boletim digitado antes da numeração automática (referência)
    boletim: r.bol,
    fornCod: r.forn_cod,
    fornNm: r.forn_nm,
    doc: r.doc,
    dt: r.dt,
    dtSol: r.dt_sol,
    faz: r.faz,
    vol: r.vol,
    volTipo: r.vol_tp === "Insumo" ? "Insumo" : "Calda",
    assin: r.assin,
    itens: r.itens,
    total: round2(r.itens.reduce((s, i) => s + (i.vt ?? 0), 0)),
    obs: r.obs,
    status: ["Aberto", "Devolvido", "Pago"].includes(r.st) ? r.st : "Aberto",
    dtBaixa: r.dt_bx,
    baixaObs: r.bx_obs,
    ref: r.ref,
    usr: r.usr,
    criEm: r.cri_em,
    atuUsr: r.atu_usr,
    atuEm: r.atu_em,
    // quantos arquivos anexados (o comunicado assinado e outros)
    anexos: r.n_anx ?? 0,
  };
}

const COLUNAS = `id, sol, bol, forn_cod, forn_nm, doc, dt::text AS dt, dt_sol::text AS dt_sol, faz, vol, vol_tp, assin, itens, obs, st,
  dt_bx::text AS dt_bx, bx_obs, ref, usr, cri_em::text AS cri_em, atu_usr, atu_em::text AS atu_em,
  (SELECT COUNT(*) FROM emp_anx x WHERE x.emp_id = emp_cab.id)::int AS n_anx`;

export async function listarEmprestimos() {
  const pool = getPool();
  await preparar(pool);
  const { rows } = await pool.query(`SELECT ${COLUNAS} FROM emp_cab ORDER BY COALESCE(dt_sol, dt) DESC NULLS LAST, id DESC`);
  return rows.map(mapa);
}

async function obter(pool, id) {
  const { rows } = await pool.query(`SELECT ${COLUNAS} FROM emp_cab WHERE id = $1`, [id]);
  return rows[0] ? mapa(rows[0]) : null;
}

const chaveLog = (e) => `Solicitação ${e.solicitacao ?? `#${e.id}`} · ${e.fornNm} · ${e.faz.map((f) => f.cod).join("/")}`;
const resumoLog = (e) => ({
  solicitacao: e.solicitacao,
  boletimAnterior: e.boletim ?? undefined,
  fornecedor: `${e.fornCod} ${e.fornNm}`,
  dataSolicitacao: e.dtSol ? dataBR(e.dtSol) : "",
  dataSaida: e.dt ? dataBR(e.dt) : "",
  fazendas: e.faz.map((f) => `${f.cod} ${f.nome}`).join("; "),
  itens: e.itens.map((i) => `${i.nm} ${i.qtd} ${i.um}`).join("; "),
  total: e.total,
  status: e.status,
  dataBaixa: e.dtBaixa ? dataBR(e.dtBaixa) : "",
});

function limpar(e) {
  const itens = e.itens.map((i) => ({
    cod: i.cod.trim(),
    nm: i.nm.trim(),
    um: i.um.trim().toUpperCase(),
    dose: i.dose === null || i.dose === undefined || Number.isNaN(i.dose) ? null : i.dose,
    qtd: i.qtd,
    vu: i.vu,
  }));
  return {
    ...e,
    fornCod: e.fornCod.trim(),
    fornNm: e.fornNm.trim(),
    doc: e.doc.trim(),
    faz: e.faz.map((f) => ({ cod: f.cod.trim(), nome: f.nome.trim(), area: f.area ?? null })),
    vol: e.vol.trim(),
    assin: e.assin.map((a) => a.trim()).filter(Boolean),
    obs: e.obs.trim(),
    itens,
    itensCalc: itens.map((i) => ({ ...i, vt: totalItem(i.qtd, i.vu) })),
  };
}

/**
 * Inclui (sem id) ou altera um empréstimo. O nº da Solicitação é do sistema: o novo ganha o próximo do mês da data da
 * solicitação (sem ela, da saída; sem as duas, de hoje); na alteração ele fica, a não ser que a data passe para outro mês
 * (aí ganha o próximo do mês novo). Devolve { id, solicitacao, anterior } (anterior: o nº que mudou) ou { erro }.
 */
export async function salvarEmprestimo(entrada, usuario, id) {
  const pool = getPool();
  await preparar(pool);
  const e = limpar(entrada);
  const erro = validarEmprestimo(e, id === undefined);
  if (erro) return { erro };
  const assin = e.assin.length ? e.assin : ASSINANTES_PADRAO;
  const mes = mesDaSolicitacao(e.dtSol ?? e.dt ?? hojeSP());
  const params = [
    e.fornCod,
    e.fornNm,
    e.doc,
    e.dt,
    e.dtSol,
    JSON.stringify(e.faz),
    e.vol,
    e.volTipo,
    JSON.stringify(assin),
    JSON.stringify(e.itensCalc),
    e.obs,
  ];
  const cheio = `O mês ${String(mes).slice(4)}/${String(mes).slice(0, 4)} já tem ${MAX_POR_MES} solicitações: o nº da Solicitação não comporta mais.`;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // uma numeração por vez: dois lançamentos ao mesmo tempo não pegam o mesmo nº
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [TRAVA_SOLICITACAO]);
    let novoId;
    let antesLog;
    let anterior = null;
    if (id === undefined) {
      const sol = await proximoNoMes(client, mes);
      if (sol === null) {
        await client.query("ROLLBACK");
        return { erro: cheio };
      }
      const r = await client.query(
        `INSERT INTO emp_cab (forn_cod, forn_nm, doc, dt, dt_sol, faz, vol, vol_tp, assin, itens, obs, sol, usr)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9::jsonb,$10::jsonb,$11,$12,$13) RETURNING id`,
        [...params, sol, usuario],
      );
      novoId = r.rows[0].id;
    } else {
      const atual = await obter(client, id);
      if (!atual) {
        await client.query("ROLLBACK");
        return { erro: "Empréstimo não encontrado." };
      }
      antesLog = resumoLog(atual);
      // a data foi para outro mês (ou ainda sem nº): o próximo do mês novo
      let sol = atual.solicitacao;
      if (sol === null || Math.floor(sol / 1000) !== mes) {
        sol = await proximoNoMes(client, mes);
        if (sol === null) {
          await client.query("ROLLBACK");
          return { erro: cheio };
        }
        anterior = atual.solicitacao;
      }
      await client.query(
        `UPDATE emp_cab SET forn_cod=$1, forn_nm=$2, doc=$3, dt=$4, dt_sol=$5, faz=$6::jsonb, vol=$7, vol_tp=$8, assin=$9::jsonb,
                itens=$10::jsonb, obs=$11, sol=$12, atu_usr=$13, atu_em=now() WHERE id=$14`,
        [...params, sol, usuario, id],
      );
      novoId = id;
    }
    const depois = await obter(client, novoId);
    await auditar(client, {
      usuario,
      modulo: "Insumos",
      entidade: "Empréstimo",
      chave: chaveLog(depois),
      acao: id === undefined ? "inclusao" : "alteracao",
      antes: antesLog,
      depois: resumoLog(depois),
    });
    await client.query("COMMIT");
    return { id: novoId, solicitacao: depois.solicitacao, anterior };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Dá baixa (devolvido ou pago) ou reabre. */
export async function baixarEmprestimo(id, baixa, usuario) {
  const pool = getPool();
  await preparar(pool);
  if (baixa.tipo !== "Aberto" && !(baixa.data && /^\d{4}-\d{2}-\d{2}$/.test(baixa.data))) {
    return { erro: "Informe a data da baixa." };
  }
  const antes = await obter(pool, id);
  if (!antes) return { erro: "Empréstimo não encontrado." };
  const aberto = baixa.tipo === "Aberto";
  await pool.query(`UPDATE emp_cab SET st=$1, dt_bx=$2, bx_obs=$3, atu_usr=$4, atu_em=now() WHERE id=$5`, [
    baixa.tipo,
    aberto ? null : baixa.data,
    aberto ? "" : (baixa.obs ?? "").trim(),
    usuario,
    id,
  ]);
  const depois = await obter(pool, id);
  await auditar(pool, {
    usuario,
    modulo: "Insumos",
    entidade: "Empréstimo",
    chave: chaveLog(antes),
    acao: "alteracao",
    antes: { status: antes.status, dataBaixa: antes.dtBaixa ? dataBR(antes.dtBaixa) : "", observacao: antes.baixaObs },
    depois: { status: depois.status, dataBaixa: depois.dtBaixa ? dataBR(depois.dtBaixa) : "", observacao: depois.baixaObs },
  });
  return true;
}

export async function excluirEmprestimo(id, usuario) {
  const pool = getPool();
  await preparar(pool);
  const antes = await obter(pool, id);
  if (!antes) return { erro: "Empréstimo não encontrado." };
  // os anexos saem junto (ON DELETE CASCADE)
  await pool.query("DELETE FROM emp_cab WHERE id = $1", [id]);
  await auditar(pool, {
    usuario,
    modulo: "Insumos",
    entidade: "Empréstimo",
    chave: chaveLog(antes),
    acao: "exclusao",
    antes: { ...resumoLog(antes), anexos: antes.anexos || undefined },
  });
  return true;
}

// ---------------------------------------------------------------------------
// Anexos da Solicitação (o comunicado assinado e outros arquivos)
// ---------------------------------------------------------------------------

/** Tipos de arquivo aceitos como anexo e o tamanho máximo de cada um. */
export const TIPOS_ANEXO = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
export const MAX_ANEXO = 10 * 1024 * 1024;

const mapaAnexo = (r) => ({ id: r.id, empId: r.emp_id, nome: r.nome, tipo: r.tipo, tamanho: r.tam, usr: r.usr, criEm: r.cri_em });

/** Anexos de uma Solicitação, os mais novos primeiro (sem o conteúdo). */
export async function listarAnexos(empId) {
  const pool = getPool();
  await preparar(pool);
  const { rows } = await pool.query(
    "SELECT id, emp_id, nome, tipo, tam, usr, cri_em::text AS cri_em FROM emp_anx WHERE emp_id = $1 ORDER BY cri_em DESC, id DESC",
    [empId],
  );
  return rows.map(mapaAnexo);
}

/** Um anexo com o conteúdo (para abrir ou baixar). null se não existe. */
export async function obterAnexo(id) {
  const pool = getPool();
  await preparar(pool);
  const r = (await pool.query("SELECT id, emp_id, nome, tipo, tam, usr, cri_em::text AS cri_em, dados FROM emp_anx WHERE id = $1", [id])).rows[0];
  return r ? { ...mapaAnexo(r), dados: r.dados } : null;
}

/** Anexa um arquivo à Solicitação (PDF ou imagem, até 10 MB), com o registro no Log de Alterações. */
export async function anexarArquivo(empId, arquivo, usuario) {
  const pool = getPool();
  await preparar(pool);
  if (!TIPOS_ANEXO.includes(arquivo.tipo)) return { erro: "Anexe um PDF ou uma imagem (JPG, PNG ou WebP)." };
  if (!(arquivo.dados?.length > 0)) return { erro: "O arquivo está vazio." };
  if (arquivo.dados.length > MAX_ANEXO) return { erro: `O arquivo passa de ${MAX_ANEXO / 1024 / 1024} MB. Diminua a resolução da imagem ou do PDF.` };
  const e = await obter(pool, empId);
  if (!e) return { erro: "Solicitação não encontrada." };
  const nome = String(arquivo.nome || "arquivo").replace(/[\\/:*?"<>|\r\n]+/g, "_").slice(0, 200);
  const r = await pool.query("INSERT INTO emp_anx (emp_id, nome, tipo, tam, dados, usr) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id", [
    empId,
    nome,
    arquivo.tipo,
    arquivo.dados.length,
    arquivo.dados,
    usuario,
  ]);
  await auditar(pool, {
    usuario,
    modulo: "Insumos",
    entidade: "Empréstimo",
    chave: chaveLog(e),
    acao: "alteracao",
    depois: { anexoIncluido: `${nome} (${Math.ceil(arquivo.dados.length / 1024)} KB)` },
  });
  return { id: r.rows[0].id };
}

/** Tira um anexo da Solicitação (com o registro no Log de Alterações). */
export async function excluirAnexo(id, usuario) {
  const pool = getPool();
  await preparar(pool);
  const a = (await pool.query("SELECT id, emp_id, nome, tam FROM emp_anx WHERE id = $1", [id])).rows[0];
  if (!a) return { erro: "Anexo não encontrado." };
  const e = await obter(pool, a.emp_id);
  await pool.query("DELETE FROM emp_anx WHERE id = $1", [id]);
  await auditar(pool, {
    usuario,
    modulo: "Insumos",
    entidade: "Empréstimo",
    chave: e ? chaveLog(e) : `#${a.emp_id}`,
    acao: "alteracao",
    antes: { anexoExcluido: `${a.nome} (${Math.ceil(a.tam / 1024)} KB)` },
  });
  return true;
}

/**
 * Próximo nº da Solicitação do mês da data `dt` (AAAA-MM-DD; sem ela, hoje) — a prévia do formulário (o nº de verdade é
 * dado ao gravar). null quando o mês já tem o máximo.
 */
export async function proximaSolicitacao(dt) {
  const pool = getPool();
  await preparar(pool);
  return proximoNoMes(pool, mesDaSolicitacao(/^\d{4}-\d{2}-\d{2}$/.test(dt ?? "") ? dt : hojeSP()));
}
