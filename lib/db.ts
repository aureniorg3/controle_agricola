import { Pool, types } from "pg";
import { randomUUID } from "crypto";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import {
  ConferenciaLinha,
  Database,
  EntradaDiaria,
  EquiptoFrente,
  MetaFrente,
  OrdemConferencia,
  HistoricoTchOrdem,
  OrdemCorte,
  SafraAgregado,
  SafraCadastro,
  SafraTalhao,
  SafraVariedadeCorte,
  TalhaoOrdem,
  Usuario,
} from "./types";
import { gerarSenhaProvisoria, hashSenha, SESSION_COOKIE_NAME, verificarTokenSessao } from "./auth";

// `numeric` volta como string por padrão no driver `pg` (pra não perder
// precisão) — como este app só lida com área/tonelada em ponto flutuante
// normal, converte pra number direto. `date` também merece tratamento
// especial: sem isso, o driver monta um `Date` na meia-noite UTC, que pode
// "voltar um dia" dependendo do fuso de quem lê — mantemos como string
// "YYYY-MM-DD" crua, igual ao que `EntradaDiaria.data` já espera.
types.setTypeParser(1700, (val) => parseFloat(val)); // numeric
types.setTypeParser(1082, (val) => val); // date

// A base inteira (ordens, talhões, entradas diárias, usuários, seleção de
// visibilidade) mora em tabelas normais no Postgres do Supabase — ver
// supabase/schema.sql pro DDL completo (rode esse arquivo no SQL Editor do
// Supabase antes do primeiro uso). Esse arquivo só faz as consultas; a
// criação das tabelas é responsabilidade do schema.sql, não deste código.
const DATABASE_URL = process.env.DATABASE_URL;

/**
 * Sem `DATABASE_URL`, não tem pra onde gravar — melhor travar alto (e óbvio)
 * do que servir uma base vazia em memória sem avisar ninguém, como acontecia
 * antes com o arquivo local em disco não-persistente. Avisa alto no log
 * assim que o módulo carrega, pra aparecer nos logs do Render mesmo que
 * ninguém olhe a tela.
 */
if (process.env.NODE_ENV === "production" && !DATABASE_URL) {
  console.error(
    "\n" +
      "!".repeat(70) +
      "\n[db] ATENÇÃO: variável DATABASE_URL não configurada em produção.\n" +
      "O sistema não tem como gravar nem ler usuários/ordens sem ela —\n" +
      "configure a connection string do Postgres do Supabase na variável\n" +
      'de ambiente DATABASE_URL. Ver README.md, seção "Deploy no Render".\n' +
      "!".repeat(70) +
      "\n"
  );
}

export interface DiagnosticoArmazenamento {
  /** `false` quando `DATABASE_URL` não está configurada — nesse caso toda
   * leitura/gravação falha (propositalmente, em vez de perder dados em
   * silêncio num arquivo local não-persistente). */
  persistente: boolean;
  caminho: string;
}

export function diagnosticoArmazenamento(): DiagnosticoArmazenamento {
  return { persistente: Boolean(DATABASE_URL), caminho: DATABASE_URL ? "Postgres (Supabase)" : "(DATABASE_URL não configurada)" };
}

// Reaproveita o pool de conexões entre requisições do mesmo processo (e, em
// desenvolvimento, entre reloads do Next.js via `globalThis` — sem isso, o
// Fast Refresh recriaria um pool novo a cada edição de arquivo).
declare global {
  // eslint-disable-next-line no-var
  var _pgPool: Pool | undefined;
}

function getPool(): Pool {
  if (!DATABASE_URL) {
    throw new Error(
      'DATABASE_URL não configurada — não é possível conectar ao banco de dados. Ver README.md, seção "Deploy no Render".'
    );
  }
  if (process.env.NODE_ENV === "development") {
    if (!global._pgPool) {
      global._pgPool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
    }
    return global._pgPool;
  }
  if (!cachedPool) {
    cachedPool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  }
  return cachedPool;
}
let cachedPool: Pool | undefined;

/**
 * Usuário administrador padrão, criado automaticamente na primeira execução.
 * Login: e-mail abaixo. Senha inicial: "crv@2026" — troque em Configurações
 * → Cadastros assim que possível.
 */
function buildAdminPadrao(): Usuario {
  return {
    id: "usr-admin-1",
    nome: "Administrador",
    sobrenome: "",
    email: "aureniorg3@gmail.com",
    usuario: "admin",
    senhaHash: hashSenha("crv@2026"),
    perfil: "admin",
    ativo: true,
    precisaTrocarSenha: false,
    criadoEm: new Date().toISOString(),
  };
}

/**
 * Confere que as tabelas existem (devem ter sido criadas rodando
 * supabase/schema.sql no SQL Editor do Supabase) e semeia o usuário admin
 * padrão na primeiríssima execução (tabela `usuarios` vazia). Roda uma vez
 * só por processo — chamadas seguintes reaproveitam a mesma promise.
 */
// Nomes do banco são abreviados (ver supabase/schema.sql). As listas de
// colunas abaixo devolvem cada coluna já com o nome por extenso que o resto
// do código usa (`SELECT nm AS nome`), então só este arquivo conhece as
// abreviações.
const COLS_ORD =
  "num AS numero, frt AS frente, faz_cod AS fazenda_codigo, faz_nm AS fazenda_nome, prp_cod AS proprietario_codigo, " +
  "prp_nm AS proprietario_nome, sts AS status, tip_can AS tipo_cana, dt_qma AS data_queima, obs AS observacao, " +
  "saf_lbl AS safra_label, atu_em AS atualizado_em";
const COLS_TLH =
  "ord_num AS ordem_numero, faz_cod AS fazenda_codigo, faz_nm AS fazenda_nome, tlh AS talhao, area_ha, " +
  "area_col_ha AS area_colhida_ha";
const COLS_ENT =
  "ord_num AS ordem_numero, dt AS data, faz_cod AS fazenda_codigo, tlh AS talhao, ton AS toneladas, " +
  "ton_ate_6h AS toneladas_ate_6h, ton_ate_12h AS toneladas_ate_12h, ton_ate_18h AS toneladas_ate_18h, vgn AS viagens";
const COLS_USR =
  "id, nm AS nome, snm AS sobrenome, eml AS email, usr AS usuario, sen_hsh AS senha_hash, prf AS perfil, " +
  "atv AS ativo, prc_trc_sen AS precisa_trocar_senha, cri_em AS criado_em";

/** Renomes de tabelas/colunas da versão por extenso para a abreviada. */
const RENOMEACOES: { antiga: string; nova: string; colunas: Record<string, string> }[] = [
  {
    antiga: "usuarios",
    nova: "usr",
    colunas: {
      nome: "nm",
      sobrenome: "snm",
      email: "eml",
      usuario: "usr",
      senha_hash: "sen_hsh",
      perfil: "prf",
      ativo: "atv",
      precisa_trocar_senha: "prc_trc_sen",
      criado_em: "cri_em",
    },
  },
  {
    antiga: "ordens",
    nova: "ord",
    colunas: {
      numero: "num",
      frente: "frt",
      fazenda_codigo: "faz_cod",
      fazenda_nome: "faz_nm",
      proprietario_codigo: "prp_cod",
      proprietario_nome: "prp_nm",
      status: "sts",
      tipo_cana: "tip_can",
      data_queima: "dt_qma",
      observacao: "obs",
      safra_label: "saf_lbl",
      atualizado_em: "atu_em",
    },
  },
  {
    antiga: "talhoes",
    nova: "tlh",
    colunas: {
      ordem_numero: "ord_num",
      fazenda_codigo: "faz_cod",
      fazenda_nome: "faz_nm",
      talhao: "tlh",
      area_colhida_ha: "area_col_ha",
    },
  },
  {
    antiga: "entradas_diarias",
    nova: "ent_dia",
    colunas: {
      ordem_numero: "ord_num",
      data: "dt",
      fazenda_codigo: "faz_cod",
      talhao: "tlh",
      toneladas: "ton",
      toneladas_ate_6h: "ton_ate_6h",
      viagens: "vgn",
    },
  },
  { antiga: "ordens_visiveis", nova: "ord_vis", colunas: { ordem_numero: "ord_num" } },
  {
    antiga: "app_meta",
    nova: "app_met",
    colunas: { ultima_importacao: "ult_imp", ultima_atualizacao: "ult_atu" },
  },
  {
    antiga: "metas_frente",
    nova: "met_frt",
    colunas: { frente: "frt", meta_dia_t: "met_dia_t", vigencia: "vig", criado_em: "cri_em" },
  },
];

/** Idempotente: só renomeia o que ainda estiver com o nome antigo — bancos
 * criados direto com o schema abreviado não sofrem nenhuma alteração. */
async function migrarNomesAbreviados(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(727001)");
    for (const r of RENOMEACOES) {
      const { rows } = await client.query<{ antiga: string | null; nova: string | null }>(
        "SELECT to_regclass($1)::text AS antiga, to_regclass($2)::text AS nova",
        [`public.${r.antiga}`, `public.${r.nova}`]
      );
      if (rows[0].antiga && !rows[0].nova) {
        await client.query(`ALTER TABLE ${r.antiga} RENAME TO ${r.nova}`);
      }
      const { rows: cols } = await client.query<{ column_name: string }>(
        "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1",
        [r.nova]
      );
      const existentes = new Set(cols.map((c) => c.column_name));
      for (const [antiga, nova] of Object.entries(r.colunas)) {
        if (existentes.has(antiga) && !existentes.has(nova)) {
          await client.query(`ALTER TABLE ${r.nova} RENAME COLUMN ${antiga} TO ${nova}`);
        }
      }
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

let prepararBancoPromise: Promise<void> | undefined;
function prepararBanco(pool: Pool): Promise<void> {
  if (!prepararBancoPromise) {
    prepararBancoPromise = (async () => {
      let count: number;
      try {
        await migrarNomesAbreviados(pool);
        const { rows } = await pool.query<{ count: number }>("SELECT COUNT(*)::int AS count FROM usr");
        count = rows[0].count;
      } catch (err) {
        throw new Error(
          "Tabelas do banco não encontradas no Postgres do Supabase. Rode supabase/schema.sql no SQL Editor do " +
            `Supabase antes de usar o sistema. Erro original: ${err instanceof Error ? err.message : String(err)}`
        );
      }
      // tabela criada depois do schema inicial — idempotente, então bancos
      // já existentes ganham ela sozinhos, sem rodar SQL à mão.
      await pool.query(
        `CREATE TABLE IF NOT EXISTS met_frt (
           id text PRIMARY KEY,
           frt text NOT NULL,
           met_dia_t numeric NOT NULL CHECK (met_dia_t >= 0),
           vig date NOT NULL,
           cri_em timestamptz NOT NULL DEFAULT now(),
           UNIQUE (frt, vig)
         )`
      );
      await pool.query(
        `CREATE TABLE IF NOT EXISTS conf_pes (
           dt date NOT NULL,
           eqp text NOT NULL,
           eqp_nm text NOT NULL DEFAULT '',
           frt text NOT NULL,
           faz_cod text NOT NULL,
           faz_nm text NOT NULL DEFAULT '',
           ton numeric NOT NULL DEFAULT 0,
           imp_em timestamptz NOT NULL DEFAULT now(),
           PRIMARY KEY (dt, eqp, frt, faz_cod)
         )`
      );
      await pool.query(
        `CREATE TABLE IF NOT EXISTS pes_viag (
           dt date NOT NULL, ord_num text NOT NULL, ctl text NOT NULL,
           faz_cod text NOT NULL DEFAULT '-', tlh text NOT NULL DEFAULT '',
           ton numeric NOT NULL DEFAULT 0, hsd text NOT NULL DEFAULT '',
           PRIMARY KEY (dt, ord_num, ctl)
         )`
      );
      // tara (kg) do Relatório de Pesagem: viagem com tara zerada não entra nas entradas
      await pool.query("ALTER TABLE pes_viag ADD COLUMN IF NOT EXISTS tara numeric");
      await pool.query(
        `CREATE TABLE IF NOT EXISTS cad_itm (
           cad text NOT NULL, cod text NOT NULL, nm text NOT NULL DEFAULT '',
           dds jsonb NOT NULL DEFAULT '{}'::jsonb, atu_em timestamptz NOT NULL DEFAULT now(),
           PRIMARY KEY (cad, cod)
         )`
      );
      await pool.query("ALTER TABLE ent_dia ADD COLUMN IF NOT EXISTS ton_ate_12h numeric NOT NULL DEFAULT 0");
      await pool.query("ALTER TABLE ent_dia ADD COLUMN IF NOT EXISTS ton_ate_18h numeric NOT NULL DEFAULT 0");
      await pool.query("ALTER TABLE conf_pes ADD COLUMN IF NOT EXISTS frt_cor text");
      await pool.query("CREATE INDEX IF NOT EXISTS idx_conf_pes_dt ON conf_pes(dt)");
      await pool.query(
        `CREATE TABLE IF NOT EXISTS eqp_frt (
           id text PRIMARY KEY,
           eqp text NOT NULL,
           frt text NOT NULL,
           vig date NOT NULL,
           cri_em timestamptz NOT NULL DEFAULT now(),
           UNIQUE (eqp, vig)
         )`
      );
      await pool.query(
        `CREATE TABLE IF NOT EXISTS saf_tlh (
           saf integer NOT NULL, seq integer NOT NULL,
           faz_cod text NOT NULL, faz_nm text NOT NULL DEFAULT '',
           prp_cod text NOT NULL DEFAULT '', prp_nm text NOT NULL DEFAULT '',
           mun text NOT NULL DEFAULT '', uf text NOT NULL DEFAULT '',
           tlh text NOT NULL, km numeric NOT NULL DEFAULT 0,
           var_cod text NOT NULL DEFAULT '', var_nm text NOT NULL DEFAULT '',
           dt_col_ant date, dt_col date, dt_plt date,
           cor integer NOT NULL DEFAULT 0,
           area_tot numeric NOT NULL DEFAULT 0, area_plt numeric NOT NULL DEFAULT 0, area_col numeric NOT NULL DEFAULT 0,
           mt_lin numeric NOT NULL DEFAULT 0, esp numeric NOT NULL DEFAULT 0,
           prod_ant numeric NOT NULL DEFAULT 0, tch_ant numeric NOT NULL DEFAULT 0,
           prod_est numeric NOT NULL DEFAULT 0, tch_est numeric NOT NULL DEFAULT 0,
           prod_atu numeric NOT NULL DEFAULT 0, tch_real numeric NOT NULL DEFAULT 0,
           res numeric NOT NULL DEFAULT 0, pct numeric NOT NULL DEFAULT 0, ce text NOT NULL DEFAULT '',
           PRIMARY KEY (saf, faz_cod, tlh, seq)
         )`
      );
      await pool.query("CREATE INDEX IF NOT EXISTS idx_saf_tlh_faz ON saf_tlh(faz_cod, tlh)");
      await pool.query(
        `CREATE TABLE IF NOT EXISTS saf_cad (
           id text PRIMARY KEY,
           tp text NOT NULL CHECK (tp IN ('AGR', 'IND')),
           ano integer NOT NULL,
           ano_ini date NOT NULL, ano_fim date NOT NULL,
           prd_ini date NOT NULL, prd_fim date NOT NULL,
           cri_em timestamptz NOT NULL DEFAULT now(),
           UNIQUE (tp, ano)
         )`
      );
      if (count === 0) {
        const admin = buildAdminPadrao();
        await pool.query(
          `INSERT INTO usr (id, nm, snm, eml, usr, sen_hsh, prf, atv, prc_trc_sen, cri_em)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (id) DO NOTHING`,
          [
            admin.id,
            admin.nome,
            admin.sobrenome,
            admin.email,
            admin.usuario,
            admin.senhaHash,
            admin.perfil,
            admin.ativo,
            admin.precisaTrocarSenha,
            admin.criadoEm,
          ]
        );
      }
    })();
  }
  return prepararBancoPromise;
}

function paraIso(valor: unknown): string {
  if (valor instanceof Date) return valor.toISOString();
  return String(valor);
}

interface OrdemRow {
  numero: string;
  frente: string;
  fazenda_codigo: string;
  fazenda_nome: string;
  proprietario_codigo: string | null;
  proprietario_nome: string | null;
  status: string;
  tipo_cana: string | null;
  data_queima: string | null;
  observacao: string | null;
  safra_label: string;
  atualizado_em: Date | string;
}
interface TalhaoRow {
  ordem_numero: string;
  fazenda_codigo: string;
  fazenda_nome: string;
  talhao: string;
  area_ha: number;
  area_colhida_ha: number;
}
interface EntradaRow {
  ordem_numero: string;
  data: string;
  fazenda_codigo: string;
  talhao: string;
  toneladas: number;
  toneladas_ate_6h: number;
  toneladas_ate_12h: number;
  toneladas_ate_18h: number;
  viagens: number;
}

/** Monta OrdemCorte[] completas (com talhões e entradas aninhados) a partir
 * das 3 tabelas relacionadas — opcionalmente restrito a uma lista de
 * números de ordem. 3 consultas no total, independente de quantas ordens. */
async function carregarOrdensCompletas(pool: Pool, numeros?: string[]): Promise<OrdemCorte[]> {
  const { rows: ordensRows } = await pool.query<OrdemRow>(
    numeros ? `SELECT ${COLS_ORD} FROM ord WHERE num = ANY($1::text[])` : `SELECT ${COLS_ORD} FROM ord`,
    numeros ? [numeros] : []
  );
  if (ordensRows.length === 0) return [];

  const todosNumeros = ordensRows.map((r) => r.numero);
  const [{ rows: talhoesRows }, { rows: entradasRows }] = await Promise.all([
    pool.query<TalhaoRow>(`SELECT ${COLS_TLH} FROM tlh WHERE ord_num = ANY($1::text[])`, [todosNumeros]),
    pool.query<EntradaRow>(`SELECT ${COLS_ENT} FROM ent_dia WHERE ord_num = ANY($1::text[])`, [todosNumeros]),
  ]);

  const talhoesPorOrdem = new Map<string, TalhaoOrdem[]>();
  for (const t of talhoesRows) {
    const lista = talhoesPorOrdem.get(t.ordem_numero) ?? [];
    lista.push({
      fazendaCodigo: t.fazenda_codigo,
      fazendaNome: t.fazenda_nome,
      talhao: t.talhao,
      areaHa: t.area_ha,
      areaColhidaHa: t.area_colhida_ha,
    });
    talhoesPorOrdem.set(t.ordem_numero, lista);
  }

  const entradasPorOrdem = new Map<string, EntradaDiaria[]>();
  for (const e of entradasRows) {
    const lista = entradasPorOrdem.get(e.ordem_numero) ?? [];
    lista.push({
      data: e.data,
      fazendaCodigo: e.fazenda_codigo,
      talhao: e.talhao,
      toneladas: e.toneladas,
      toneladasAte6h: e.toneladas_ate_6h,
      toneladasAte12h: e.toneladas_ate_12h,
      toneladasAte18h: e.toneladas_ate_18h,
      viagens: e.viagens,
    });
    entradasPorOrdem.set(e.ordem_numero, lista);
  }

  return ordensRows.map((r) => ({
    id: r.numero,
    numero: r.numero,
    frente: r.frente,
    fazendaCodigo: r.fazenda_codigo,
    fazendaNome: r.fazenda_nome,
    proprietarioCodigo: r.proprietario_codigo ?? undefined,
    proprietarioNome: r.proprietario_nome ?? undefined,
    status: r.status as OrdemCorte["status"],
    tipoCana: r.tipo_cana ?? undefined,
    dataQueima: r.data_queima ?? undefined,
    observacao: r.observacao ?? undefined,
    safraLabel: r.safra_label,
    talhoes: talhoesPorOrdem.get(r.numero) ?? [],
    entradas: entradasPorOrdem.get(r.numero) ?? [],
    atualizadoEm: paraIso(r.atualizado_em),
  }));
}

export async function listOrdens(): Promise<OrdemCorte[]> {
  const pool = getPool();
  await prepararBanco(pool);
  const ordens = await carregarOrdensCompletas(pool);
  return ordens.sort((a, b) => a.numero.localeCompare(b.numero, undefined, { numeric: true }));
}

export async function getOrdem(id: string): Promise<OrdemCorte | undefined> {
  const pool = getPool();
  await prepararBanco(pool);
  const ordens = await carregarOrdensCompletas(pool, [id]);
  return ordens[0];
}

/**
 * Substitui TODAS as ordens pelo resultado de uma importação — os relatórios
 * de origem são sempre a safra inteira até a data de geração, não um
 * incremento do dia, então não há o que mesclar: cada importação é o
 * retrato mais atual e substitui o anterior por completo.
 *
 * Ordens que saem da base (não estão mais no novo arquivo) são removidas de
 * verdade (`DELETE ... WHERE numero NOT IN`), o que também apaga sua linha
 * em `ord_vis` via `ON DELETE CASCADE`. Ordens que continuam
 * existindo são atualizadas em UPSERT (nunca apagadas+recriadas) — assim a
 * seleção de visibilidade sobrevive a uma reimportação, igual antes.
 */
export async function substituirOrdens(ordens: OrdemCorte[]): Promise<void> {
  const pool = getPool();
  await prepararBanco(pool);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const numeros = ordens.map((o) => o.numero);
    await client.query("DELETE FROM ord WHERE NOT (num = ANY($1::text[]))", [numeros]);

    // Talhões/entradas são sempre o retrato completo da importação —
    // limpa e reconstrói do zero pras ordens que sobraram, mais simples e
    // seguro do que tentar diffar linha a linha.
    // a área colhida lançada à mão (medição de campo) não se perde numa nova importação
    const { rows: medidas } = await client.query<{ ord_num: string; faz_cod: string; tlh: string; area_col_ha: number }>(
      "SELECT ord_num, faz_cod, tlh, area_col_ha FROM tlh WHERE area_col_ha > 0"
    );
    const medida = new Map(medidas.map((m) => [`${m.ord_num}|${m.faz_cod}|${m.tlh}`, m.area_col_ha]));
    for (const o of ordens) {
      for (const t of o.talhoes) {
        const anterior = medida.get(`${o.numero}|${t.fazendaCodigo}|${t.talhao}`);
        if (anterior !== undefined && t.areaColhidaHa === 0) t.areaColhidaHa = Math.min(anterior, t.areaHa);
      }
    }
    await client.query("DELETE FROM tlh");
    await client.query("DELETE FROM ent_dia");

    if (ordens.length > 0) {
      await client.query(
        `INSERT INTO ord
           (num, frt, faz_cod, faz_nm, prp_cod, prp_nm, sts, tip_can, dt_qma, obs, saf_lbl, atu_em)
         SELECT * FROM unnest(
           $1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[],
           $7::text[], $8::text[], $9::date[], $10::text[], $11::text[], $12::timestamptz[]
         )
         ON CONFLICT (num) DO UPDATE SET
           frt = EXCLUDED.frt, faz_cod = EXCLUDED.faz_cod, faz_nm = EXCLUDED.faz_nm,
           prp_cod = EXCLUDED.prp_cod, prp_nm = EXCLUDED.prp_nm,
           sts = EXCLUDED.sts, tip_can = EXCLUDED.tip_can, dt_qma = EXCLUDED.dt_qma,
           obs = EXCLUDED.obs, saf_lbl = EXCLUDED.saf_lbl, atu_em = EXCLUDED.atu_em`,
        [
          numeros,
          ordens.map((o) => o.frente),
          ordens.map((o) => o.fazendaCodigo),
          ordens.map((o) => o.fazendaNome),
          ordens.map((o) => o.proprietarioCodigo ?? null),
          ordens.map((o) => o.proprietarioNome ?? null),
          ordens.map((o) => o.status),
          ordens.map((o) => o.tipoCana ?? null),
          ordens.map((o) => o.dataQueima ?? null),
          ordens.map((o) => o.observacao ?? null),
          ordens.map((o) => o.safraLabel),
          ordens.map((o) => o.atualizadoEm),
        ]
      );
    }

    const tOrdemNumero: string[] = [];
    const tFazendaCodigo: string[] = [];
    const tFazendaNome: string[] = [];
    const tTalhao: string[] = [];
    const tAreaHa: number[] = [];
    const tAreaColhidaHa: number[] = [];
    for (const o of ordens) {
      for (const t of o.talhoes) {
        tOrdemNumero.push(o.numero);
        tFazendaCodigo.push(t.fazendaCodigo);
        tFazendaNome.push(t.fazendaNome);
        tTalhao.push(t.talhao);
        tAreaHa.push(t.areaHa);
        tAreaColhidaHa.push(t.areaColhidaHa);
      }
    }
    if (tOrdemNumero.length > 0) {
      await client.query(
        `INSERT INTO tlh (ord_num, faz_cod, faz_nm, tlh, area_ha, area_col_ha)
         SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::numeric[], $6::numeric[])`,
        [tOrdemNumero, tFazendaCodigo, tFazendaNome, tTalhao, tAreaHa, tAreaColhidaHa]
      );
    }

    const eOrdemNumero: string[] = [];
    const eData: string[] = [];
    const eFazendaCodigo: string[] = [];
    const eTalhao: string[] = [];
    const eToneladas: number[] = [];
    const eToneladasAte6h: number[] = [];
    const eToneladasAte12h: number[] = [];
    const eToneladasAte18h: number[] = [];
    const eViagens: number[] = [];
    for (const o of ordens) {
      for (const e of o.entradas) {
        eOrdemNumero.push(o.numero);
        eData.push(e.data);
        eFazendaCodigo.push(e.fazendaCodigo);
        eTalhao.push(e.talhao);
        eToneladas.push(e.toneladas);
        eToneladasAte6h.push(e.toneladasAte6h);
        eToneladasAte12h.push(e.toneladasAte12h);
        eToneladasAte18h.push(e.toneladasAte18h);
        eViagens.push(e.viagens);
      }
    }
    if (eOrdemNumero.length > 0) {
      await client.query(
        `INSERT INTO ent_dia
           (ord_num, dt, faz_cod, tlh, ton, ton_ate_6h, ton_ate_12h, ton_ate_18h, vgn)
         SELECT * FROM unnest(
           $1::text[], $2::date[], $3::text[], $4::text[], $5::numeric[], $6::numeric[], $7::numeric[], $8::numeric[], $9::int[]
         )`,
        [
          eOrdemNumero,
          eData,
          eFazendaCodigo,
          eTalhao,
          eToneladas,
          eToneladasAte6h,
          eToneladasAte12h,
          eToneladasAte18h,
          eViagens,
        ]
      );
    }

    await client.query("UPDATE app_met SET ult_imp = now(), ult_atu = now() WHERE id = true");
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Números de ordem marcados para exibição — o `JOIN` garante que uma ordem
 * que sumiu numa reimportação não fica presa na lista (a linha já teria
 * sido removida via `ON DELETE CASCADE`, mas o filtro é uma rede extra). */
/** Números de todas as ordens cadastradas (leve, sem talhões nem entradas). */
export async function listNumerosOrdens(): Promise<string[]> {
  const pool = getPool();
  await prepararBanco(pool);
  const { rows } = await pool.query<{ num: string }>("SELECT num FROM ord");
  return rows.map((r) => r.num);
}

/**
 * Grava as viagens do arquivo, substituindo as de mesma chave (data +
 * liberação + controle); as demais ficam como estão. Devolve quantas eram
 * novas e quantas substituíram uma já existente.
 */
export async function upsertViagens(
  viagens: { data: string; ordem: string; controle: string; fazendaCodigo: string; talhao: string; toneladas: number; hora: string; tara: number }[]
): Promise<{ novas: number; substituidas: number }> {
  const pool = getPool();
  await prepararBanco(pool);
  const client = await pool.connect();
  let substituidas = 0;
  try {
    await client.query("BEGIN");
    for (let i = 0; i < viagens.length; i += 5000) {
      const lote = viagens.slice(i, i + 5000);
      const dts = lote.map((v) => v.data);
      const ords = lote.map((v) => v.ordem);
      const ctls = lote.map((v) => v.controle);
      const { rows } = await client.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM pes_viag p
           JOIN unnest($1::date[], $2::text[], $3::text[]) AS u(d, o, c) ON p.dt = u.d AND p.ord_num = u.o AND p.ctl = u.c`,
        [dts, ords, ctls]
      );
      substituidas += rows[0].n;
      await client.query(
        `INSERT INTO pes_viag (dt, ord_num, ctl, faz_cod, tlh, ton, hsd, tara)
         SELECT * FROM unnest($1::date[], $2::text[], $3::text[], $4::text[], $5::text[], $6::numeric[], $7::text[], $8::numeric[])
         ON CONFLICT (dt, ord_num, ctl) DO UPDATE SET
           faz_cod = EXCLUDED.faz_cod, tlh = EXCLUDED.tlh, ton = EXCLUDED.ton, hsd = EXCLUDED.hsd, tara = EXCLUDED.tara`,
        [
          dts,
          ords,
          ctls,
          lote.map((v) => v.fazendaCodigo),
          lote.map((v) => v.talhao),
          lote.map((v) => v.toneladas),
          lote.map((v) => v.hora),
          lote.map((v) => v.tara),
        ]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  return { novas: viagens.length - substituidas, substituidas };
}

/**
 * Refaz as entradas diárias (por ordem + data + fazenda + talhão) a partir das
 * viagens gravadas. Só mexe nos pares ordem + data que têm viagens — datas
 * anteriores ao histórico de viagens (importadas na versão antiga) ficam
 * intactas.
 */
export async function reconstruirEntradas(): Promise<void> {
  const pool = getPool();
  await prepararBanco(pool);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `DELETE FROM ent_dia e USING (SELECT DISTINCT v.ord_num, v.dt FROM pes_viag v JOIN ord o ON o.num = v.ord_num) k
        WHERE e.ord_num = k.ord_num AND e.dt = k.dt`
    );
    await client.query(
      `INSERT INTO ent_dia (ord_num, dt, faz_cod, tlh, ton, ton_ate_6h, ton_ate_12h, ton_ate_18h, vgn)
       SELECT v.ord_num, v.dt, v.faz_cod, v.tlh,
              ROUND(SUM(v.ton), 2),
              ROUND(COALESCE(SUM(v.ton) FILTER (WHERE v.hsd <> '' AND v.hsd < '06:00'), 0), 2),
              ROUND(COALESCE(SUM(v.ton) FILTER (WHERE v.hsd <> '' AND v.hsd < '12:00'), 0), 2),
              ROUND(COALESCE(SUM(v.ton) FILTER (WHERE v.hsd <> '' AND v.hsd < '18:00'), 0), 2),
              COUNT(*)::int
         FROM pes_viag v JOIN ord o ON o.num = v.ord_num
        WHERE v.tara IS NULL OR v.tara > 0
        GROUP BY v.ord_num, v.dt, v.faz_cod, v.tlh`
    );
    await client.query("UPDATE app_met SET ult_imp = now(), ult_atu = now() WHERE id = true");
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function listOrdensVisiveis(): Promise<string[]> {
  const pool = getPool();
  await prepararBanco(pool);
  const { rows } = await pool.query<{ ordem_numero: string }>(
    "SELECT ov.ord_num AS ordem_numero FROM ord_vis ov JOIN ord o ON o.num = ov.ord_num"
  );
  return rows.map((r) => r.ordem_numero);
}

export async function adicionarOrdemVisivel(numero: string): Promise<true | { erro: string }> {
  const pool = getPool();
  await prepararBanco(pool);
  const { rows } = await pool.query("SELECT 1 FROM ord WHERE num = $1", [numero]);
  if (rows.length === 0) {
    return { erro: `Ordem ${numero} não encontrada na última importação.` };
  }
  await pool.query("INSERT INTO ord_vis (ord_num) VALUES ($1) ON CONFLICT (ord_num) DO NOTHING", [numero]);
  return true;
}

export async function removerOrdemVisivel(numero: string): Promise<void> {
  const pool = getPool();
  await prepararBanco(pool);
  await pool.query("DELETE FROM ord_vis WHERE ord_num = $1", [numero]);
}

export async function listMetas(): Promise<MetaFrente[]> {
  const pool = getPool();
  await prepararBanco(pool);
  const { rows } = await pool.query<{ id: string; frente: string; meta_dia_t: number; vigencia: string }>(
    "SELECT id, frt AS frente, met_dia_t AS meta_dia_t, vig AS vigencia FROM met_frt ORDER BY frt, vig"
  );
  return rows.map((r) => ({ id: r.id, frente: r.frente, metaDiaT: r.meta_dia_t, vigencia: r.vigencia }));
}

/** Uma meta por (frente, vigência): cadastrar de novo na mesma data
 * substitui o valor. */
export async function salvarMeta(frente: string, metaDiaT: number, vigencia: string): Promise<void> {
  const pool = getPool();
  await prepararBanco(pool);
  await pool.query(
    `INSERT INTO met_frt (id, frt, met_dia_t, vig) VALUES ($1,$2,$3,$4)
     ON CONFLICT (frt, vig) DO UPDATE SET met_dia_t = EXCLUDED.met_dia_t`,
    [randomUUID(), frente, metaDiaT, vigencia]
  );
}

/** Edita uma meta já lançada (frente, valor e/ou data). Recusa se a nova
 * combinação frente+data já existir em outra meta. */
export async function atualizarMeta(
  id: string,
  frente: string,
  metaDiaT: number,
  vigencia: string
): Promise<true | { erro: string }> {
  const pool = getPool();
  await prepararBanco(pool);
  const { rows: existe } = await pool.query("SELECT 1 FROM met_frt WHERE id = $1", [id]);
  if (existe.length === 0) return { erro: "Meta não encontrada." };
  const { rows: conflito } = await pool.query("SELECT 1 FROM met_frt WHERE frt = $1 AND vig = $2 AND id <> $3", [
    frente,
    vigencia,
    id,
  ]);
  if (conflito.length > 0) return { erro: "Já existe uma meta dessa frente nessa data. Edite aquela ou escolha outra data." };
  await pool.query("UPDATE met_frt SET frt = $1, met_dia_t = $2, vig = $3 WHERE id = $4", [frente, metaDiaT, vigencia, id]);
  return true;
}

export async function excluirMeta(id: string): Promise<void> {
  const pool = getPool();
  await prepararBanco(pool);
  await pool.query("DELETE FROM met_frt WHERE id = $1", [id]);
}

// ---------------------------------------------------------------------------
// Conferência de pesagem e equipamento x frente
// ---------------------------------------------------------------------------

/** Cada dia importado substitui por completo o que já havia daquele dia. */
export async function substituirConferenciaDia(data: string, linhas: ConferenciaLinha[]): Promise<void> {
  const pool = getPool();
  await prepararBanco(pool);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // reimportar o dia não pode apagar as correções já lançadas pelo usuário
    const { rows: correcoes } = await client.query<{ eqp: string; frt: string; faz_cod: string; frt_cor: string }>(
      "SELECT eqp, frt, faz_cod, frt_cor FROM conf_pes WHERE dt = $1 AND frt_cor IS NOT NULL",
      [data]
    );
    await client.query("DELETE FROM conf_pes WHERE dt = $1", [data]);
    if (linhas.length > 0) {
      await client.query(
        `INSERT INTO conf_pes (dt, eqp, eqp_nm, frt, faz_cod, faz_nm, ton)
         SELECT $1::date, * FROM unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::numeric[])`,
        [
          data,
          linhas.map((l) => l.eqp),
          linhas.map((l) => l.eqpNome),
          linhas.map((l) => l.frente),
          linhas.map((l) => l.fazendaCodigo),
          linhas.map((l) => l.fazendaNome),
          linhas.map((l) => l.toneladas),
        ]
      );
      if (correcoes.length > 0) {
        await client.query(
          `UPDATE conf_pes c SET frt_cor = x.frt_cor
             FROM unnest($2::text[], $3::text[], $4::text[], $5::text[]) AS x(eqp, frt, faz_cod, frt_cor)
            WHERE c.dt = $1 AND c.eqp = x.eqp AND c.frt = x.frt AND c.faz_cod = x.faz_cod`,
          [
            data,
            correcoes.map((c) => c.eqp),
            correcoes.map((c) => c.frt),
            correcoes.map((c) => c.faz_cod),
            correcoes.map((c) => c.frt_cor),
          ]
        );
      }
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function listConferencias(): Promise<ConferenciaLinha[]> {
  const pool = getPool();
  await prepararBanco(pool);
  const { rows } = await pool.query<{
    data: string;
    eqp: string;
    eqp_nm: string;
    frente: string;
    faz_cod: string;
    faz_nm: string;
    ton: number;
    frt_cor: string | null;
  }>(
    "SELECT dt AS data, eqp, eqp_nm, frt AS frente, faz_cod, faz_nm, ton, frt_cor FROM conf_pes ORDER BY dt, eqp, frt, faz_cod"
  );
  return rows.map((r) => ({
    data: r.data,
    eqp: r.eqp,
    eqpNome: r.eqp_nm,
    frente: r.frente,
    fazendaCodigo: r.faz_cod,
    fazendaNome: r.faz_nm,
    toneladas: r.ton,
    frenteCorrecao: r.frt_cor,
  }));
}

/** Grava (ou limpa, com `frenteCorreta` nulo) a frente correta de uma linha da
 * conferência — a lista que o usuário leva para corrigir no sistema de origem. */
export async function salvarCorrecaoConferencia(
  data: string,
  eqp: string,
  frente: string,
  fazendaCodigo: string,
  frenteCorreta: string | null
): Promise<boolean> {
  const pool = getPool();
  await prepararBanco(pool);
  const { rowCount } = await pool.query(
    "UPDATE conf_pes SET frt_cor = $1 WHERE dt = $2 AND eqp = $3 AND frt = $4 AND faz_cod = $5",
    [frenteCorreta, data, eqp, frente, fazendaCodigo]
  );
  return (rowCount ?? 0) > 0;
}

/** Versão enxuta das ordens (sem talhões/entradas) para cruzar com a
 * conferência: frente, status, última entrada e as fazendas que a ordem cobre. */
export async function listOrdensParaConferencia(): Promise<OrdemConferencia[]> {
  const pool = getPool();
  await prepararBanco(pool);
  const { rows } = await pool.query<{
    numero: string;
    frente: string;
    status: string;
    ult: string | null;
    fazs: { c: string; n: string }[];
  }>(
    `SELECT o.num AS numero, o.frt AS frente, o.sts AS status,
            (SELECT max(e.dt) FROM ent_dia e WHERE e.ord_num = o.num) AS ult,
            (SELECT COALESCE(jsonb_agg(jsonb_build_object('c', x.faz_cod, 'n', x.faz_nm)), '[]'::jsonb)
               FROM (SELECT t.faz_cod, t.faz_nm FROM tlh t WHERE t.ord_num = o.num
                     UNION SELECT o.faz_cod, o.faz_nm) x) AS fazs
       FROM ord o`
  );
  return rows.map((r) => ({
    numero: r.numero,
    frente: r.frente,
    status: r.status as OrdemConferencia["status"],
    ultimaEntrada: r.ult,
    fazendas: (r.fazs ?? []).map((f) => ({ codigo: f.c, nome: f.n })),
  }));
}

export async function listEquiptoFrente(): Promise<EquiptoFrente[]> {
  const pool = getPool();
  await prepararBanco(pool);
  const { rows } = await pool.query<{ id: string; eqp: string; frente: string; vigencia: string }>(
    "SELECT id, eqp, frt AS frente, vig AS vigencia FROM eqp_frt ORDER BY eqp, vig"
  );
  return rows.map((r) => ({ id: r.id, eqp: r.eqp, frente: r.frente, vigencia: r.vigencia }));
}

/** Um lançamento por (equipamento, vigência): lançar de novo na mesma data
 * substitui a frente. */
export async function salvarEquiptoFrente(eqp: string, frente: string, vigencia: string): Promise<void> {
  const pool = getPool();
  await prepararBanco(pool);
  await pool.query(
    `INSERT INTO eqp_frt (id, eqp, frt, vig) VALUES ($1,$2,$3,$4)
     ON CONFLICT (eqp, vig) DO UPDATE SET frt = EXCLUDED.frt`,
    [randomUUID(), eqp, frente, vigencia]
  );
}

export async function atualizarEquiptoFrente(
  id: string,
  eqp: string,
  frente: string,
  vigencia: string
): Promise<true | { erro: string }> {
  const pool = getPool();
  await prepararBanco(pool);
  const { rows: existe } = await pool.query("SELECT 1 FROM eqp_frt WHERE id = $1", [id]);
  if (existe.length === 0) return { erro: "Lançamento não encontrado." };
  const { rows: conflito } = await pool.query("SELECT 1 FROM eqp_frt WHERE eqp = $1 AND vig = $2 AND id <> $3", [
    eqp,
    vigencia,
    id,
  ]);
  if (conflito.length > 0) {
    return { erro: "Esse equipamento já tem um lançamento nessa data. Edite aquele ou escolha outra data." };
  }
  await pool.query("UPDATE eqp_frt SET eqp = $1, frt = $2, vig = $3 WHERE id = $4", [eqp, frente, vigencia, id]);
  return true;
}

export async function excluirEquiptoFrente(id: string): Promise<void> {
  const pool = getPool();
  await prepararBanco(pool);
  await pool.query("DELETE FROM eqp_frt WHERE id = $1", [id]);
}

// ---------------------------------------------------------------------------
// Cadastros de apoio importados de planilhas (tabela genérica cad_itm)
// ---------------------------------------------------------------------------

export interface ItemCadastro {
  cod: string;
  nm: string;
  dados: Record<string, string | number>;
}

export async function listarCadastro(
  cad: string,
  busca: string,
  pagina: number,
  tamanho: number
): Promise<{ total: number; itens: ItemCadastro[] }> {
  const pool = getPool();
  await prepararBanco(pool);
  const termo = `%${busca.trim().replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const filtro = "cad = $1 AND ($2 = '%%' OR cod ILIKE $2 OR nm ILIKE $2 OR dds::text ILIKE $2)";
  const { rows: cont } = await pool.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM cad_itm WHERE ${filtro}`, [cad, termo]);
  const { rows } = await pool.query<{ cod: string; nm: string; dds: Record<string, string | number> }>(
    `SELECT cod, nm, dds FROM cad_itm WHERE ${filtro}
      ORDER BY CASE WHEN cod ~ '^[0-9]+$' THEN lpad(cod, 15, '0') ELSE cod END
      LIMIT $3 OFFSET $4`,
    [cad, termo, tamanho, Math.max(0, (pagina - 1) * tamanho)]
  );
  return { total: cont[0].n, itens: rows.map((r) => ({ cod: r.cod, nm: r.nm, dados: r.dds })) };
}

/** Grava os itens (novos entram, existentes são atualizados pelo código); o resto do cadastro fica como está. */
export async function upsertCadastroLote(cad: string, itens: ItemCadastro[]): Promise<{ novos: number; atualizados: number }> {
  const pool = getPool();
  await prepararBanco(pool);
  const client = await pool.connect();
  let atualizados = 0;
  try {
    await client.query("BEGIN");
    for (let i = 0; i < itens.length; i += 2000) {
      const lote = itens.slice(i, i + 2000);
      const json = JSON.stringify(lote.map((it) => ({ cod: it.cod, nm: it.nm, dds: it.dados })));
      const { rows } = await client.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM cad_itm c
           JOIN jsonb_to_recordset($2::jsonb) AS x(cod text) ON c.cod = x.cod WHERE c.cad = $1`,
        [cad, json]
      );
      atualizados += rows[0].n;
      await client.query(
        `INSERT INTO cad_itm (cad, cod, nm, dds)
         SELECT $1, x.cod, x.nm, x.dds FROM jsonb_to_recordset($2::jsonb) AS x(cod text, nm text, dds jsonb)
         ON CONFLICT (cad, cod) DO UPDATE SET nm = EXCLUDED.nm, dds = EXCLUDED.dds, atu_em = now()`,
        [cad, json]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  return { novos: itens.length - atualizados, atualizados };
}

export async function atualizarItemCadastro(
  cad: string,
  cod: string,
  nm: string,
  dados: Record<string, string | number>
): Promise<boolean> {
  const pool = getPool();
  await prepararBanco(pool);
  const { rowCount } = await pool.query(
    "UPDATE cad_itm SET nm = $3, dds = dds || $4::jsonb, atu_em = now() WHERE cad = $1 AND cod = $2",
    [cad, cod, nm, JSON.stringify(dados)]
  );
  return (rowCount ?? 0) > 0;
}

export async function excluirItemCadastro(cad: string, cod: string): Promise<void> {
  const pool = getPool();
  await prepararBanco(pool);
  await pool.query("DELETE FROM cad_itm WHERE cad = $1 AND cod = $2", [cad, cod]);
}

// ---------------------------------------------------------------------------
// Cadastro de safras
// ---------------------------------------------------------------------------

export interface DadosSafraCadastro {
  tipo: "AGR" | "IND";
  ano: number;
  anoInicio: string;
  anoFim: string;
  producaoInicio: string;
  producaoFim: string;
}

export async function listSafrasCadastro(): Promise<SafraCadastro[]> {
  const pool = getPool();
  await prepararBanco(pool);
  const { rows } = await pool.query<{
    id: string;
    tp: "AGR" | "IND";
    ano: number;
    ano_ini: string;
    ano_fim: string;
    prd_ini: string;
    prd_fim: string;
  }>("SELECT id, tp, ano, ano_ini, ano_fim, prd_ini, prd_fim FROM saf_cad ORDER BY ano DESC, tp");
  return rows.map((r) => ({
    id: r.id,
    tipo: r.tp,
    ano: r.ano,
    anoInicio: r.ano_ini,
    anoFim: r.ano_fim,
    producaoInicio: r.prd_ini,
    producaoFim: r.prd_fim,
  }));
}

/** Uma safra por (tipo, ano): cadastrar de novo substitui as datas. */
export async function salvarSafraCadastro(d: DadosSafraCadastro): Promise<void> {
  const pool = getPool();
  await prepararBanco(pool);
  await pool.query(
    `INSERT INTO saf_cad (id, tp, ano, ano_ini, ano_fim, prd_ini, prd_fim) VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (tp, ano) DO UPDATE SET
       ano_ini = EXCLUDED.ano_ini, ano_fim = EXCLUDED.ano_fim, prd_ini = EXCLUDED.prd_ini, prd_fim = EXCLUDED.prd_fim`,
    [randomUUID(), d.tipo, d.ano, d.anoInicio, d.anoFim, d.producaoInicio, d.producaoFim]
  );
}

export async function atualizarSafraCadastro(id: string, d: DadosSafraCadastro): Promise<true | { erro: string }> {
  const pool = getPool();
  await prepararBanco(pool);
  const { rows: existe } = await pool.query("SELECT 1 FROM saf_cad WHERE id = $1", [id]);
  if (existe.length === 0) return { erro: "Safra não encontrada." };
  const { rows: conflito } = await pool.query("SELECT 1 FROM saf_cad WHERE tp = $1 AND ano = $2 AND id <> $3", [
    d.tipo,
    d.ano,
    id,
  ]);
  if (conflito.length > 0) return { erro: `Já existe a safra ${d.tipo} ${d.ano}. Edite aquela ou escolha outro ano/tipo.` };
  await pool.query(
    "UPDATE saf_cad SET tp = $1, ano = $2, ano_ini = $3, ano_fim = $4, prd_ini = $5, prd_fim = $6 WHERE id = $7",
    [d.tipo, d.ano, d.anoInicio, d.anoFim, d.producaoInicio, d.producaoFim, id]
  );
  return true;
}

export async function excluirSafraCadastro(id: string): Promise<void> {
  const pool = getPool();
  await prepararBanco(pool);
  await pool.query("DELETE FROM saf_cad WHERE id = $1", [id]);
}

// ---------------------------------------------------------------------------
// Histórico de safras
// ---------------------------------------------------------------------------

/** Substitui TODAS as linhas de uma safra pelas do arquivo importado. */
export async function substituirSafra(safra: number, linhas: SafraTalhao[]): Promise<void> {
  const pool = getPool();
  await prepararBanco(pool);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM saf_tlh WHERE saf = $1", [safra]);
    const registros = linhas.map((l) => ({
      saf: safra,
      seq: l.seq,
      faz_cod: l.fazendaCodigo,
      faz_nm: l.fazendaNome,
      prp_cod: l.proprietarioCodigo,
      prp_nm: l.proprietarioNome,
      mun: l.municipio,
      uf: l.uf,
      tlh: l.talhao,
      km: l.km,
      var_cod: l.variedadeCodigo,
      var_nm: l.variedadeNome,
      dt_col_ant: l.dtColheitaAnt,
      dt_col: l.dtColheita,
      dt_plt: l.dtPlantio,
      cor: Math.round(l.corte),
      area_tot: l.areaTot,
      area_plt: l.areaPlant,
      area_col: l.areaColh,
      mt_lin: l.mtLinear,
      esp: l.espac,
      prod_ant: l.prodAnt,
      tch_ant: l.tchAnt,
      prod_est: l.prodEst,
      tch_est: l.tchEst,
      prod_atu: l.prodAtual,
      tch_real: l.tchReal,
      res: l.resultado,
      pct: l.pct,
      ce: l.ce,
    }));
    // em lotes, para não estourar o tamanho de um único parâmetro
    for (let i = 0; i < registros.length; i += 1000) {
      await client.query(
        `INSERT INTO saf_tlh
           SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(
             saf integer, seq integer, faz_cod text, faz_nm text, prp_cod text, prp_nm text, mun text, uf text,
             tlh text, km numeric, var_cod text, var_nm text, dt_col_ant date, dt_col date, dt_plt date,
             cor integer, area_tot numeric, area_plt numeric, area_col numeric, mt_lin numeric, esp numeric,
             prod_ant numeric, tch_ant numeric, prod_est numeric, tch_est numeric, prod_atu numeric,
             tch_real numeric, res numeric, pct numeric, ce text)`,
        [JSON.stringify(registros.slice(i, i + 1000))]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function excluirSafra(safra: number): Promise<void> {
  const pool = getPool();
  await prepararBanco(pool);
  await pool.query("DELETE FROM saf_tlh WHERE saf = $1", [safra]);
}

export type DimensaoSafra = "fazenda" | "proprietario" | "municipio" | "variedade" | "corte";

const EXPR_DIMENSAO: Record<DimensaoSafra | "safra", string> = {
  safra: "'Total'",
  fazenda: "faz_cod || ' - ' || faz_nm",
  proprietario: "prp_nm",
  municipio: "mun",
  variedade: "var_nm",
  corte: "cor::text",
};

/** Agregados por safra (e opcionalmente por fazenda, proprietário, município,
 * variedade ou corte). TCH real = produção ÷ área, só das linhas já colhidas
 * (com produção); TCH estimado = produção estimada ÷ área total. */
export async function agregarSafras(dimensao: DimensaoSafra | "safra"): Promise<SafraAgregado[]> {
  const pool = getPool();
  await prepararBanco(pool);
  const expr = EXPR_DIMENSAO[dimensao];
  // GROUP BY com literal ('Total') é erro no Postgres — a safra inteira agrupa só por `saf`
  const agrupar = dimensao === "safra" ? "saf" : `saf, ${expr}`;
  const { rows } = await pool.query<{
    saf: number;
    chave: string;
    area_tot: number;
    area_col: number;
    prod: number;
    prod_est: number;
  }>(
    `SELECT saf, ${expr} AS chave,
            SUM(area_tot) AS area_tot,
            COALESCE(SUM(area_col) FILTER (WHERE prod_atu > 0), 0) AS area_col,
            COALESCE(SUM(prod_atu) FILTER (WHERE prod_atu > 0), 0) AS prod,
            SUM(prod_est) AS prod_est
       FROM saf_tlh GROUP BY ${agrupar} ORDER BY saf, chave`
  );
  return rows.map((r) => ({
    safra: r.saf,
    chave: r.chave,
    areaTot: r.area_tot,
    areaColhida: r.area_col,
    producaoT: r.prod,
    producaoEstT: r.prod_est,
    tchReal: r.area_col > 0 ? r.prod / r.area_col : null,
    tchEst: r.area_tot > 0 && r.prod_est > 0 ? r.prod_est / r.area_tot : null,
  }));
}

/** Variedade x corte por safra (para ver como cada variedade rende em cada estágio). */
export async function agregarVariedadeCorte(): Promise<SafraVariedadeCorte[]> {
  const pool = getPool();
  await prepararBanco(pool);
  const { rows } = await pool.query<{
    saf: number;
    var_nm: string;
    cor: number;
    area_tot: number;
    area_col: number;
    prod: number;
  }>(
    `SELECT saf, var_nm, cor,
            SUM(area_tot) AS area_tot,
            COALESCE(SUM(area_col) FILTER (WHERE prod_atu > 0), 0) AS area_col,
            COALESCE(SUM(prod_atu) FILTER (WHERE prod_atu > 0), 0) AS prod
       FROM saf_tlh GROUP BY saf, var_nm, cor ORDER BY saf, var_nm, cor`
  );
  return rows.map((r) => ({
    safra: r.saf,
    variedade: r.var_nm,
    corte: r.cor,
    areaTot: r.area_tot,
    areaColhida: r.area_col,
    producaoT: r.prod,
    tchReal: r.area_col > 0 ? r.prod / r.area_col : null,
  }));
}

/** Base consolidada: uma linha por safra + fazenda, com proprietário e município. */
export interface BaseSafraFazenda {
  safra: number;
  fazendaCodigo: string;
  fazendaNome: string;
  proprietario: string;
  municipio: string;
  uf: string;
  talhoes: number;
  areaTot: number;
  areaColhida: number;
  producaoT: number;
  tchReal: number | null;
  tchEst: number | null;
}

export async function baseSafraFazenda(): Promise<BaseSafraFazenda[]> {
  const pool = getPool();
  await prepararBanco(pool);
  const { rows } = await pool.query<{
    saf: number;
    faz_cod: string;
    faz_nm: string;
    prp: string;
    mun: string;
    uf: string;
    talhoes: number;
    area_tot: number;
    area_col: number;
    prod: number;
    prod_est: number;
  }>(
    `SELECT saf, faz_cod, MAX(faz_nm) AS faz_nm, MAX(prp_nm) AS prp, MAX(mun) AS mun, MAX(uf) AS uf,
            COUNT(DISTINCT tlh)::int AS talhoes,
            SUM(area_tot) AS area_tot,
            COALESCE(SUM(area_col) FILTER (WHERE prod_atu > 0), 0) AS area_col,
            COALESCE(SUM(prod_atu) FILTER (WHERE prod_atu > 0), 0) AS prod,
            SUM(prod_est) AS prod_est
       FROM saf_tlh GROUP BY saf, faz_cod ORDER BY saf DESC, faz_cod`
  );
  return rows.map((r) => ({
    safra: r.saf,
    fazendaCodigo: r.faz_cod,
    fazendaNome: r.faz_nm,
    proprietario: r.prp,
    municipio: r.mun,
    uf: r.uf,
    talhoes: r.talhoes,
    areaTot: r.area_tot,
    areaColhida: r.area_col,
    producaoT: r.prod,
    tchReal: r.area_col > 0 ? r.prod / r.area_col : null,
    tchEst: r.area_tot > 0 && r.prod_est > 0 ? r.prod_est / r.area_tot : null,
  }));
}

/**
 * Para o card de cada ordem de corte: TCH realizado das duas safras anteriores
 * mais recentes e TCH estimado da safra atual, cruzando os talhões da ordem
 * (fazenda + talhão) com o histórico importado.
 */
export async function historicoTchPorOrdem(safraAtual: number): Promise<HistoricoTchOrdem> {
  const pool = getPool();
  await prepararBanco(pool);
  const { rows: ant } = await pool.query<{ saf: number }>(
    "SELECT DISTINCT saf FROM saf_tlh WHERE saf < $1 ORDER BY saf DESC LIMIT 2",
    [safraAtual]
  );
  const safrasAnteriores = ant.map((r) => r.saf);
  const safras = [safraAtual, ...safrasAnteriores];
  // TCH de cada talhão na safra (todas as linhas parciais do talhão juntas) e,
  // por ordem, a média ponderada pela ÁREA DO TALHÃO NA ORDEM — o mesmo talhão
  // pode estar em duas ordens com áreas diferentes.
  const { rows } = await pool.query<{
    ord_num: string;
    saf: number;
    tch_real: number | null;
    tch_est: number | null;
  }>(
    `WITH t_saf AS (
       SELECT saf, faz_cod, tlh,
              SUM(prod_atu) FILTER (WHERE prod_atu > 0)
                / NULLIF(SUM(area_col) FILTER (WHERE prod_atu > 0), 0) AS tch_real,
              SUM(prod_est) FILTER (WHERE prod_est > 0)
                / NULLIF(SUM(area_tot) FILTER (WHERE prod_est > 0), 0) AS tch_est
         FROM saf_tlh WHERE saf = ANY($1::int[]) GROUP BY saf, faz_cod, tlh
     )
     SELECT t.ord_num, s.saf,
            SUM(s.tch_real * t.area_ha) / NULLIF(SUM(t.area_ha) FILTER (WHERE s.tch_real IS NOT NULL), 0) AS tch_real,
            SUM(s.tch_est * t.area_ha) / NULLIF(SUM(t.area_ha) FILTER (WHERE s.tch_est IS NOT NULL), 0) AS tch_est
       FROM tlh t JOIN t_saf s ON s.faz_cod = t.faz_cod AND s.tlh = t.tlh
      GROUP BY t.ord_num, s.saf`,
    [safras]
  );
  const porOrdem: HistoricoTchOrdem["porOrdem"] = {};
  for (const r of rows) {
    (porOrdem[r.ord_num] ??= []).push({ safra: r.saf, tchReal: r.tch_real, tchEst: r.tch_est });
  }

  // TCH estimado de cada talhão da ordem (safra atual) — usado para ratear
  // entradas que ainda não têm talhão (ordem em aberto).
  const { rows: porTalhao } = await pool.query<{ ord_num: string; faz_cod: string; tlh: string; tch_est: number }>(
    `SELECT t.ord_num, t.faz_cod, t.tlh,
            SUM(s.prod_est) FILTER (WHERE s.prod_est > 0) / NULLIF(SUM(s.area_tot) FILTER (WHERE s.prod_est > 0), 0) AS tch_est
       FROM tlh t JOIN saf_tlh s ON s.faz_cod = t.faz_cod AND s.tlh = t.tlh AND s.saf = $1
      GROUP BY t.ord_num, t.faz_cod, t.tlh
     HAVING SUM(s.prod_est) FILTER (WHERE s.prod_est > 0) > 0`,
    [safraAtual]
  );
  const estPorTalhao: HistoricoTchOrdem["estPorTalhao"] = {};
  for (const r of porTalhao) {
    (estPorTalhao[r.ord_num] ??= {})[`${r.faz_cod}|${r.tlh}`] = r.tch_est;
  }
  return { safraAtual, safrasAnteriores, porOrdem, estPorTalhao };
}

export type LancamentoAreaColhida =
  | { modo: "ordem"; totalHa: number }
  | { modo: "talhoes"; valores: { fazendaCodigo: string; talhao: string; areaColhidaHa: number }[] };

/**
 * Único dado ainda lançado manualmente neste módulo: a área já colhida de
 * cada talhão (medição de campo) — as toneladas continuam 100% vindas da
 * importação. "Por ordem" distribui o total proporcionalmente pela área de
 * cada talhão (mesmo critério do sistema antigo); "por talhão" grava os
 * valores exatos informados.
 */
export async function lancarAreaColhida(
  numero: string,
  input: LancamentoAreaColhida
): Promise<OrdemCorte | { erro: string }> {
  const pool = getPool();
  await prepararBanco(pool);
  const ordem = (await carregarOrdensCompletas(pool, [numero]))[0];
  if (!ordem) return { erro: `Ordem ${numero} não encontrada.` };

  if (input.modo === "ordem") {
    const areaTotalHa = ordem.talhoes.reduce((s, t) => s + t.areaHa, 0);
    if (areaTotalHa <= 0) {
      return { erro: "Ordem sem área cadastrada nos talhões — não é possível distribuir." };
    }
    if (input.totalHa < 0 || input.totalHa > areaTotalHa + 0.01) {
      return { erro: `Área colhida deve estar entre 0 e ${areaTotalHa.toFixed(2)} ha (área total da ordem).` };
    }
    for (const t of ordem.talhoes) {
      t.areaColhidaHa = Math.round((t.areaHa / areaTotalHa) * input.totalHa * 100) / 100;
    }
  } else {
    for (const v of input.valores) {
      const talhao = ordem.talhoes.find((t) => t.fazendaCodigo === v.fazendaCodigo && t.talhao === v.talhao);
      if (!talhao) continue;
      if (v.areaColhidaHa < 0 || v.areaColhidaHa > talhao.areaHa + 0.01) {
        return {
          erro: `Talhão ${v.talhao} (fazenda ${v.fazendaCodigo}): área colhida deve estar entre 0 e ${talhao.areaHa.toFixed(2)} ha.`,
        };
      }
    }
    // só grava depois de validar todos — não deixa a ordem meio atualizada.
    for (const v of input.valores) {
      const talhao = ordem.talhoes.find((t) => t.fazendaCodigo === v.fazendaCodigo && t.talhao === v.talhao);
      if (talhao) talhao.areaColhidaHa = Math.round(v.areaColhidaHa * 100) / 100;
    }
  }

  ordem.atualizadoEm = new Date().toISOString();

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const t of ordem.talhoes) {
      await client.query(
        "UPDATE tlh SET area_col_ha = $1 WHERE ord_num = $2 AND faz_cod = $3 AND tlh = $4",
        [t.areaColhidaHa, numero, t.fazendaCodigo, t.talhao]
      );
    }
    await client.query("UPDATE ord SET atu_em = $1 WHERE num = $2", [ordem.atualizadoEm, numero]);
    await client.query("UPDATE app_met SET ult_atu = now() WHERE id = true");
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  return ordem;
}

function mapUsuario(r: {
  id: string;
  nome: string;
  sobrenome: string;
  email: string;
  usuario: string;
  senha_hash: string;
  perfil: string;
  ativo: boolean;
  precisa_trocar_senha: boolean;
  criado_em: Date | string;
}): Usuario {
  return {
    id: r.id,
    nome: r.nome,
    sobrenome: r.sobrenome,
    email: r.email,
    usuario: r.usuario,
    senhaHash: r.senha_hash,
    perfil: r.perfil as Usuario["perfil"],
    ativo: r.ativo,
    precisaTrocarSenha: r.precisa_trocar_senha,
    criadoEm: paraIso(r.criado_em),
  };
}

export async function listUsuarios(): Promise<Usuario[]> {
  const pool = getPool();
  await prepararBanco(pool);
  const { rows } = await pool.query(`SELECT ${COLS_USR} FROM usr ORDER BY cri_em`);
  return rows.map(mapUsuario);
}

export async function getUsuarioPorId(id: string): Promise<Usuario | undefined> {
  const pool = getPool();
  await prepararBanco(pool);
  const { rows } = await pool.query(`SELECT ${COLS_USR} FROM usr WHERE id = $1`, [id]);
  return rows[0] ? mapUsuario(rows[0]) : undefined;
}

export async function getUsuarioPorEmail(email: string): Promise<Usuario | undefined> {
  const pool = getPool();
  await prepararBanco(pool);
  const { rows } = await pool.query(`SELECT ${COLS_USR} FROM usr WHERE lower(eml) = lower($1)`, [email.trim()]);
  return rows[0] ? mapUsuario(rows[0]) : undefined;
}

export async function getUsuarioPorNomeDeUsuario(usuario: string): Promise<Usuario | undefined> {
  const pool = getPool();
  await prepararBanco(pool);
  const { rows } = await pool.query(`SELECT ${COLS_USR} FROM usr WHERE lower(usr) = lower($1)`, [usuario.trim()]);
  return rows[0] ? mapUsuario(rows[0]) : undefined;
}

/** Login aceita e-mail OU nome de usuário — tenta os dois. */
export async function getUsuarioPorIdentificador(identificador: string): Promise<Usuario | undefined> {
  return (await getUsuarioPorEmail(identificador)) ?? (await getUsuarioPorNomeDeUsuario(identificador));
}

/** Usuário da sessão atual, para Server Components (usa `cookies()` de `next/headers`). */
export async function usuarioAtual(): Promise<Usuario | undefined> {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const uid = verificarTokenSessao(token);
  const usuario = uid ? await getUsuarioPorId(uid) : undefined;
  return usuario?.ativo ? usuario : undefined;
}

/** Mesma coisa, para Route Handlers — lê o cookie direto do `NextRequest`. */
export async function usuarioDaRequisicao(req: NextRequest): Promise<Usuario | undefined> {
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  const uid = verificarTokenSessao(token);
  const usuario = uid ? await getUsuarioPorId(uid) : undefined;
  return usuario?.ativo ? usuario : undefined;
}

async function contarAdminsAtivos(pool: Pool, ignorarId?: string): Promise<number> {
  const { rows } = await pool.query<{ count: number }>(
    "SELECT COUNT(*)::int AS count FROM usr WHERE prf = 'admin' AND atv = true AND id IS DISTINCT FROM $1",
    [ignorarId ?? null]
  );
  return rows[0].count;
}

export interface NovoUsuarioInput {
  nome: string;
  sobrenome: string;
  email: string;
  usuario: string;
  perfil: Usuario["perfil"];
}

/**
 * A senha não vem mais de quem cadastra — é gerada aqui (provisória,
 * legível) e volta no retorno pra quem chamou mostrar na tela (não há mais
 * envio automático por e-mail) — nunca fica só no hash. O usuário criado
 * começa com `precisaTrocarSenha: true`.
 */
export async function insertUsuario(
  input: NovoUsuarioInput
): Promise<{ usuario: Usuario; senhaProvisoria: string } | { erro: string }> {
  const pool = getPool();
  await prepararBanco(pool);
  if (await getUsuarioPorEmail(input.email)) {
    return { erro: "Já existe um usuário com esse e-mail." };
  }
  if (await getUsuarioPorNomeDeUsuario(input.usuario)) {
    return { erro: "Já existe um usuário com esse nome de usuário." };
  }
  const senhaProvisoria = gerarSenhaProvisoria();
  const usuario: Usuario = {
    id: `usr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    nome: input.nome.trim(),
    sobrenome: input.sobrenome.trim(),
    email: input.email.trim().toLowerCase(),
    usuario: input.usuario.trim().toLowerCase(),
    senhaHash: hashSenha(senhaProvisoria),
    perfil: input.perfil,
    ativo: true,
    precisaTrocarSenha: true,
    criadoEm: new Date().toISOString(),
  };
  await pool.query(
    `INSERT INTO usr (id, nm, snm, eml, usr, sen_hsh, prf, atv, prc_trc_sen, cri_em)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      usuario.id,
      usuario.nome,
      usuario.sobrenome,
      usuario.email,
      usuario.usuario,
      usuario.senhaHash,
      usuario.perfil,
      usuario.ativo,
      usuario.precisaTrocarSenha,
      usuario.criadoEm,
    ]
  );
  return { usuario, senhaProvisoria };
}

export interface EditarUsuarioInput {
  nome?: string;
  sobrenome?: string;
  usuario?: string;
  perfil?: Usuario["perfil"];
  ativo?: boolean;
  senha?: string; // se informado, troca a senha
}

/**
 * Retorna o usuário atualizado, ou `{ erro }` quando a mudança violaria uma
 * das travas de segurança: ninguém desativa/rebaixa/exclui a si mesmo, e o
 * último administrador ativo não pode ser desativado, rebaixado nem excluído
 * — senão o sistema fica sem ninguém para gerenciar usuários.
 */
export async function updateUsuario(
  id: string,
  input: EditarUsuarioInput,
  solicitanteId: string
): Promise<Usuario | { erro: string }> {
  const pool = getPool();
  await prepararBanco(pool);
  const usuario = await getUsuarioPorId(id);
  if (!usuario) return { erro: "Usuário não encontrado." };

  const vaiDesativar = input.ativo === false && usuario.ativo;
  const vaiRebaixar = input.perfil !== undefined && input.perfil !== "admin" && usuario.perfil === "admin";

  if (id === solicitanteId && (vaiDesativar || vaiRebaixar)) {
    return { erro: "Você não pode desativar nem rebaixar o próprio usuário." };
  }
  if ((vaiDesativar || vaiRebaixar) && usuario.perfil === "admin" && (await contarAdminsAtivos(pool, id)) === 0) {
    return { erro: "Este é o último administrador ativo — promova outro usuário antes de mudar isso." };
  }
  if (input.usuario !== undefined && input.usuario.trim().toLowerCase() !== usuario.usuario) {
    const existente = await getUsuarioPorNomeDeUsuario(input.usuario);
    if (existente && existente.id !== id) {
      return { erro: "Já existe um usuário com esse nome de usuário." };
    }
  }

  if (input.nome !== undefined) usuario.nome = input.nome.trim();
  if (input.sobrenome !== undefined) usuario.sobrenome = input.sobrenome.trim();
  if (input.usuario !== undefined) usuario.usuario = input.usuario.trim().toLowerCase();
  if (input.perfil !== undefined) usuario.perfil = input.perfil;
  if (input.ativo !== undefined) usuario.ativo = input.ativo;
  if (input.senha) {
    usuario.senhaHash = hashSenha(input.senha);
    // só força trocar no próximo acesso quando é OUTRO usuário resetando —
    // trocar a própria senha já é, em si, a ação de trocar.
    if (id !== solicitanteId) usuario.precisaTrocarSenha = true;
  }

  await pool.query(
    "UPDATE usr SET nm=$1, snm=$2, usr=$3, prf=$4, atv=$5, sen_hsh=$6, prc_trc_sen=$7 WHERE id=$8",
    [
      usuario.nome,
      usuario.sobrenome,
      usuario.usuario,
      usuario.perfil,
      usuario.ativo,
      usuario.senhaHash,
      usuario.precisaTrocarSenha,
      id,
    ]
  );
  return usuario;
}

/** Chamado pela tela /trocar-senha — sempre o próprio usuário logado
 * trocando a senha provisória (ou uma resetada por um admin) pela definitiva. */
export async function trocarSenhaPrimeiroAcesso(userId: string, novaSenha: string): Promise<true | { erro: string }> {
  const pool = getPool();
  await prepararBanco(pool);
  const { rowCount } = await pool.query("UPDATE usr SET sen_hsh = $1, prc_trc_sen = false WHERE id = $2", [
    hashSenha(novaSenha),
    userId,
  ]);
  if (!rowCount) return { erro: "Usuário não encontrado." };
  return true;
}

export async function deleteUsuario(id: string, solicitanteId: string): Promise<true | { erro: string }> {
  const pool = getPool();
  await prepararBanco(pool);
  const usuario = await getUsuarioPorId(id);
  if (!usuario) return { erro: "Usuário não encontrado." };
  if (id === solicitanteId) return { erro: "Você não pode excluir o próprio usuário." };
  if (usuario.perfil === "admin" && usuario.ativo && (await contarAdminsAtivos(pool, id)) === 0) {
    return { erro: "Este é o último administrador ativo — promova outro usuário antes de excluir." };
  }
  await pool.query("DELETE FROM usr WHERE id = $1", [id]);
  return true;
}

/** Lê a base inteira de uma vez (ordens completas + usuários + seleção de
 * visibilidade) — conveniência pra depuração/exportação; as rotas da API
 * usam as funções específicas acima, mais baratas para cada caso de uso. */
export async function getDb(): Promise<Database> {
  const pool = getPool();
  await prepararBanco(pool);
  const [ordens, ordensVisiveis, usuarios, metaRes] = await Promise.all([
    carregarOrdensCompletas(pool),
    listOrdensVisiveis(),
    listUsuarios(),
    pool.query<{ ultima_importacao: Date | null; ultima_atualizacao: Date }>(
      "SELECT ult_imp AS ultima_importacao, ult_atu AS ultima_atualizacao FROM app_met WHERE id = true"
    ),
  ]);
  const meta = metaRes.rows[0];
  return {
    ordens,
    ordensVisiveis,
    usuarios,
    ultimaImportacao: meta?.ultima_importacao ? paraIso(meta.ultima_importacao) : undefined,
    ultimaAtualizacao: meta?.ultima_atualizacao ? paraIso(meta.ultima_atualizacao) : new Date().toISOString(),
  };
}
