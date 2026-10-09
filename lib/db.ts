import { Pool, types } from "pg";
import { randomUUID } from "crypto";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import {
  ConferenciaLinha,
  Database,
  EntradaDiaria,
  EquiptoFrente,
  AtividadeFrente,
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
import { auditar, dataBR } from "./auditar";
import type { CadastroSpec, DadosCadastro } from "./cadastros-spec";
import { hashSenha, SENHA_PADRAO_NOVO_USUARIO, SESSION_COOKIE_NAME, verificarTokenSessao } from "./auth";

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

export function getPool(): Pool {
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
    acessos: null,
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
  "atv AS ativo, prc_trc_sen AS precisa_trocar_senha, cri_em AS criado_em, ace AS acessos";

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
export function prepararBanco(pool: Pool): Promise<void> {
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
      // início e fim de atividade de cada frente (fim vazio = ativa): fora disso a meta da frente é zero
      await pool.query(
        `CREATE TABLE IF NOT EXISTS frt_atv (
           frt text PRIMARY KEY, ini date, fim date,
           usr text NOT NULL DEFAULT '', atu_usr text NOT NULL DEFAULT '', atu_em timestamptz NOT NULL DEFAULT now()
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
      await pool.query("ALTER TABLE pes_viag ADD COLUMN IF NOT EXISTS veic text NOT NULL DEFAULT ''");
      await pool.query("ALTER TABLE pes_viag ADD COLUMN IF NOT EXISTS frt text NOT NULL DEFAULT ''");
      await pool.query(
        `CREATE TABLE IF NOT EXISTS cad_itm (
           cad text NOT NULL, cod text NOT NULL, nm text NOT NULL DEFAULT '',
           dds jsonb NOT NULL DEFAULT '{}'::jsonb, atu_em timestamptz NOT NULL DEFAULT now(),
           PRIMARY KEY (cad, cod)
         )`
      );
      // Rodadas de Campo: rod_cad/rod_sem = calendário; rod_bol = boletim (cabeçalho); rod_itm = linhas do boletim
      await pool.query(
        `CREATE TABLE IF NOT EXISTS rod_cad (
           rod integer PRIMARY KEY, ini date NOT NULL, cri_em timestamptz NOT NULL DEFAULT now()
         )`
      );
      await pool.query(
        `CREATE TABLE IF NOT EXISTS rod_sem (
           rod integer NOT NULL, sem integer NOT NULL, ini date NOT NULL, fim date NOT NULL,
           PRIMARY KEY (rod, sem)
         )`
      );
      await pool.query(
        `CREATE TABLE IF NOT EXISTS rod_bol (
           bol integer PRIMARY KEY, rod integer NOT NULL, dt date NOT NULL, sem integer NOT NULL DEFAULT 0,
           reg text NOT NULL DEFAULT '', resp text NOT NULL DEFAULT '', faz text NOT NULL DEFAULT '',
           ori text NOT NULL DEFAULT 'apontamento', usr text NOT NULL DEFAULT '',
           cri_em timestamptz NOT NULL DEFAULT now()
         )`
      );
      await pool.query(
        `CREATE TABLE IF NOT EXISTS rod_itm (
           id bigserial PRIMARY KEY, bol integer NOT NULL, seq integer NOT NULL DEFAULT 1,
           oco text NOT NULL DEFAULT '', oco_txt text NOT NULL DEFAULT '',
           pre text NOT NULL DEFAULT '', niv text NOT NULL DEFAULT '', pri text NOT NULL DEFAULT '',
           tlh text NOT NULL DEFAULT '', area numeric, rec text NOT NULL DEFAULT '',
           ext jsonb NOT NULL DEFAULT '{}'::jsonb
         )`
      );
      // log de inclusões, alterações e exclusões de boletins (quem, quando e o conteúdo antes/depois)
      await pool.query(
        `CREATE TABLE IF NOT EXISTS rod_log (
           id bigserial PRIMARY KEY, bol integer NOT NULL, acao text NOT NULL, usr text NOT NULL DEFAULT '',
           em timestamptz NOT NULL DEFAULT now(), antes jsonb, depois jsonb
         )`
      );
      await pool.query("CREATE INDEX IF NOT EXISTS idx_rod_log_bol ON rod_log(bol, em)");
      await pool.query("CREATE INDEX IF NOT EXISTS idx_rod_itm_bol ON rod_itm(bol)");
      // área colhida lançada dia a dia, por talhão (histórico: o filtro de datas anteriores soma só até a data)
      await pool.query(
        `CREATE TABLE IF NOT EXISTS col_dia (
           ord_num text NOT NULL, faz_cod text NOT NULL, tlh text NOT NULL, dt date NOT NULL,
           area numeric NOT NULL DEFAULT 0,
           usr text NOT NULL DEFAULT '', cri_em timestamptz NOT NULL DEFAULT now(),
           atu_usr text NOT NULL DEFAULT '', atu_em timestamptz NOT NULL DEFAULT now(),
           PRIMARY KEY (ord_num, faz_cod, tlh, dt)
         )`
      );
      await pool.query("CREATE INDEX IF NOT EXISTS idx_col_dia_dt ON col_dia(dt)");
      // nº do boletim do apontamento (um boletim = uma ordem num dia)
      await pool.query("ALTER TABLE col_dia ADD COLUMN IF NOT EXISTS bol integer");
      // auditoria geral: quem, quando, o quê (antes e depois)
      await pool.query(
        `CREATE TABLE IF NOT EXISTS aud_log (
           id bigserial PRIMARY KEY, em timestamptz NOT NULL DEFAULT now(), usr text NOT NULL DEFAULT '',
           modulo text NOT NULL, entidade text NOT NULL, chave text NOT NULL DEFAULT '', acao text NOT NULL,
           antes jsonb, depois jsonb
         )`
      );
      await pool.query("CREATE INDEX IF NOT EXISTS idx_aud_log_em ON aud_log(em DESC)");
      await pool.query("CREATE INDEX IF NOT EXISTS idx_aud_log_chave ON aud_log(modulo, entidade, chave)");
      // o cadastro passou a se chamar "Fazenda" (singular): o histórico do log acompanha
      await pool.query("UPDATE aud_log SET entidade = 'Cadastro de Fazenda' WHERE modulo = 'Cadastros' AND entidade = 'Cadastro de Fazendas'");
      await ajustarArredondamentoAreaColhida(pool);
      // usuário que lançou / alterou por último, em todos os lançamentos
      for (const t of ["met_frt", "eqp_frt", "saf_cad", "cad_itm", "ord_vis", "rod_cad"]) {
        await pool.query(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS usr text NOT NULL DEFAULT ''`);
      }
      for (const t of ["met_frt", "eqp_frt", "saf_cad", "cad_itm", "rod_cad"]) {
        await pool.query(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS atu_usr text NOT NULL DEFAULT ''`);
      }
      await pool.query("ALTER TABLE met_frt ADD COLUMN IF NOT EXISTS atu_em timestamptz");
      await pool.query("ALTER TABLE eqp_frt ADD COLUMN IF NOT EXISTS atu_em timestamptz");
      await pool.query("ALTER TABLE saf_cad ADD COLUMN IF NOT EXISTS atu_em timestamptz");
      await pool.query("ALTER TABLE rod_cad ADD COLUMN IF NOT EXISTS atu_em timestamptz");
      // telas liberadas para o usuário (Parâmetros → Usuários); nulo = todas
      await pool.query("ALTER TABLE usr ADD COLUMN IF NOT EXISTS ace jsonb");
      // perfis Analista I e Analista II
      const { rows: chkPerfil } = await pool.query<{ def: string }>(
        "SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = 'usr'::regclass AND conname = 'usr_prf_check'"
      );
      if (!chkPerfil[0] || !chkPerfil[0].def.includes("analista1")) {
        await pool.query("ALTER TABLE usr DROP CONSTRAINT IF EXISTS usr_prf_check");
        await pool.query(
          "ALTER TABLE usr ADD CONSTRAINT usr_prf_check CHECK (prf IN ('leitura', 'analista1', 'analista2', 'gravacao', 'admin'))"
        );
      }
      await pool.query("ALTER TABLE ord_vis ADD COLUMN IF NOT EXISTS cri_em timestamptz NOT NULL DEFAULT now()");
      await pool.query("CREATE INDEX IF NOT EXISTS idx_rod_bol_chave ON rod_bol(rod, dt, reg, sem, faz)");
      // toda rodada tem 8 semanas: as que vieram da importação com menos (ex.: rodada em andamento) seguem
      // até a semana 8, de 7 em 7 dias a partir do fim da última semana
      await pool.query(
        `INSERT INTO rod_sem (rod, sem, ini, fim)
         SELECT s.rod, g.n, s.ult_fim + 1 + (g.n - s.max_sem - 1) * 7, s.ult_fim + 7 + (g.n - s.max_sem - 1) * 7
           FROM (SELECT rod, MAX(sem) AS max_sem, MAX(fim) AS ult_fim FROM rod_sem GROUP BY rod HAVING MAX(sem) < 8) s
          CROSS JOIN generate_series(1, 8) AS g(n)
          WHERE g.n > s.max_sem
         ON CONFLICT (rod, sem) DO NOTHING`
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
  const [{ rows: talhoesRows }, { rows: entradasRows }, { rows: colhidaRows }] = await Promise.all([
    pool.query<TalhaoRow>(`SELECT ${COLS_TLH} FROM tlh WHERE ord_num = ANY($1::text[])`, [todosNumeros]),
    pool.query<EntradaRow>(`SELECT ${COLS_ENT} FROM ent_dia WHERE ord_num = ANY($1::text[])`, [todosNumeros]),
    pool.query<{ ord_num: string; faz_cod: string; tlh: string; dt: string; area: number }>(
      "SELECT ord_num, faz_cod, tlh, dt, area::float AS area FROM col_dia WHERE ord_num = ANY($1::text[]) ORDER BY dt",
      [todosNumeros]
    ),
  ]);
  const colhidaPorTalhao = new Map<string, { d: string; ha: number }[]>();
  for (const c of colhidaRows) {
    const k = `${c.ord_num}|${c.faz_cod}|${c.tlh}`;
    const l = colhidaPorTalhao.get(k) ?? [];
    l.push({ d: c.dt, ha: c.area });
    colhidaPorTalhao.set(k, l);
  }

  const talhoesPorOrdem = new Map<string, TalhaoOrdem[]>();
  for (const t of talhoesRows) {
    const lista = talhoesPorOrdem.get(t.ordem_numero) ?? [];
    lista.push({
      fazendaCodigo: t.fazenda_codigo,
      fazendaNome: t.fazenda_nome,
      talhao: t.talhao,
      areaHa: t.area_ha,
      areaColhidaHa: t.area_colhida_ha,
      colhidaDias: colhidaPorTalhao.get(`${t.ordem_numero}|${t.fazenda_codigo}|${t.talhao}`) ?? [],
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
  // a descrição da fazenda vem do Cadastro de Fazenda
  await sincronizarDescricaoFazendas();
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

export interface LotePesagem {
  arquivo: string;
  viagens: { data: string; ordem: string; controle: string; fazendaCodigo: string; talhao: string; toneladas: number; hora: string; tara: number; veiculo: string; frente: string }[];
  /** período do relatório (cabeçalho; senão, as datas lidas) */
  periodo: { inicio: string; fim: string } | null;
  /** relatório sem filtro: o que não veio nele, dentro do período, deixou de existir na origem */
  completo: boolean;
}

export interface AlteracaoPesagemDia {
  data: string;
  antesT: number;
  depoisT: number;
  novas: number;
  alteradas: number;
  /** mudaram de data ou de ordem na origem (mesmo controle) */
  corrigidas: number;
  removidas: number;
}

export interface ResultadoPesagem {
  novas: number;
  alteradas: number;
  mantidas: number;
  corrigidas: number;
  removidas: number;
  porData: AlteracaoPesagemDia[];
}

/**
 * Grava os relatórios de pesagem conferindo linha a linha. O Controle identifica a viagem (é único na safra):
 *  1) viagem que mudou de data ou de ordem na origem tem a versão antiga apagada (em qualquer data);
 *  2) relatório sem filtro vale como retrato completo do seu período: viagem gravada nesse período que não veio no
 *     arquivo foi excluída/refeita na origem e sai;
 *  3) as do arquivo entram ou são atualizadas (fazenda, talhão, tonelada); iguais ficam como estão.
 * Cada arquivo é aplicado na ordem em que veio. Devolve o que mudou, por data (toneladas antes e depois).
 * Com `aplicar = false` é só a prévia: mede o efeito e desfaz.
 */
export async function gravarPesagens(lotes: LotePesagem[], aplicar = true): Promise<ResultadoPesagem> {
  const pool = getPool();
  await prepararBanco(pool);
  const client = await pool.connect();
  const res: ResultadoPesagem = { novas: 0, alteradas: 0, mantidas: 0, corrigidas: 0, removidas: 0, porData: [] };
  const dias = new Map<string, AlteracaoPesagemDia>();
  const dia = (d: string) => {
    if (!dias.has(d)) dias.set(d, { data: d, antesT: 0, depoisT: 0, novas: 0, alteradas: 0, corrigidas: 0, removidas: 0 });
    return dias.get(d)!;
  };
  // toneladas que entram nas entradas de cana (viagem com tara)
  const toneladasPorDia = async (datas: string[]) =>
    new Map(
      (
        await client.query<{ d: string; t: number }>(
          "SELECT dt::text AS d, COALESCE(SUM(ton) FILTER (WHERE tara IS NULL OR tara > 0), 0)::float AS t FROM pes_viag WHERE dt = ANY($1::date[]) GROUP BY dt",
          [datas]
        )
      ).rows.map((r) => [r.d, r.t])
    );
  const ALT = "((pes_viag.faz_cod, pes_viag.tlh, ROUND(pes_viag.ton, 3)) IS DISTINCT FROM (EXCLUDED.faz_cod, EXCLUDED.tlh, ROUND(EXCLUDED.ton, 3)))";
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('pes_viag_importacao'))");
    // datas mexidas: as do arquivo, as do período e as de onde viagens corrigidas vão sair
    const datasArquivo = new Set<string>();
    for (const l of lotes) {
      l.viagens.forEach((v) => datasArquivo.add(v.data));
      if (l.periodo) for (let d = l.periodo.inicio; d <= l.periodo.fim; d = addDias(d, 1)) datasArquivo.add(d);
    }
    const ctlsTodos = lotes.flatMap((l) => l.viagens.map((v) => v.controle));
    const deOutrasDatas = (
      await client.query<{ d: string }>("SELECT DISTINCT dt::text AS d FROM pes_viag WHERE ctl = ANY($1::text[])", [ctlsTodos])
    ).rows.map((r) => r.d);
    deOutrasDatas.forEach((d) => datasArquivo.add(d));
    const antes = await toneladasPorDia([...datasArquivo]);

    for (const lote of lotes) {
      const ctls = lote.viagens.map((v) => v.controle);
      // 1) mesmo controle em outra data/ordem: a versão antiga sai
      const movidas = await client.query<{ d: string; c: string }>(
        `DELETE FROM pes_viag p USING unnest($1::text[], $2::date[], $3::text[]) AS u(c, d, o)
          WHERE p.ctl = u.c AND (p.dt, p.ord_num) IS DISTINCT FROM (u.d, u.o)
          RETURNING p.dt::text AS d, p.ctl AS c`,
        [ctls, lote.viagens.map((v) => v.data), lote.viagens.map((v) => v.ordem)]
      );
      for (const r of movidas.rows) dia(r.d).corrigidas++;
      res.corrigidas += movidas.rowCount ?? 0;
      // a versão corrigida entra de novo no passo 3, mas não é viagem nova
      const corrigidasCtl = new Set(movidas.rows.map((r) => r.c));
      // 2) relatório completo: o que não veio no período deixou de existir na origem
      if (lote.completo && lote.periodo) {
        const fora = await client.query<{ d: string }>(
          "DELETE FROM pes_viag WHERE dt BETWEEN $1::date AND $2::date AND NOT (ctl = ANY($3::text[])) RETURNING dt::text AS d",
          [lote.periodo.inicio, lote.periodo.fim, ctls]
        );
        for (const r of fora.rows) dia(r.d).removidas++;
        res.removidas += fora.rowCount ?? 0;
      }
      // 3) grava: novas entram, alteradas são atualizadas, iguais ficam
      for (let i = 0; i < lote.viagens.length; i += 5000) {
        const v = lote.viagens.slice(i, i + 5000);
        const dts = v.map((x) => x.data);
        const ords = v.map((x) => x.ordem);
        const cts = v.map((x) => x.controle);
        const { rows: ja } = await client.query<{ d: string; o: string; c: string; alt: boolean }>(
          `SELECT u.d::text AS d, u.o, u.c, (p.faz_cod, p.tlh, ROUND(p.ton, 3)) IS DISTINCT FROM (u.f, u.t, ROUND(u.q, 3)) AS alt
             FROM pes_viag p
             JOIN unnest($1::date[], $2::text[], $3::text[], $4::text[], $5::text[], $6::numeric[]) AS u(d, o, c, f, t, q)
               ON p.dt = u.d AND p.ord_num = u.o AND p.ctl = u.c`,
          [dts, ords, cts, v.map((x) => x.fazendaCodigo), v.map((x) => x.talhao), v.map((x) => x.toneladas)]
        );
        const existe = new Set(ja.map((r) => `${r.d}|${r.o}|${r.c}`));
        for (const r of ja) {
          if (r.alt) {
            res.alteradas++;
            dia(r.d).alteradas++;
          } else res.mantidas++;
        }
        // nova = chave que não existia e controle que não tinha versão antiga (essa conta como corrigida)
        for (const x of v) {
          if (existe.has(`${x.data}|${x.ordem}|${x.controle}`) || corrigidasCtl.has(x.controle)) continue;
          res.novas++;
          dia(x.data).novas++;
        }
        await client.query(
          `INSERT INTO pes_viag (dt, ord_num, ctl, faz_cod, tlh, ton, hsd, tara, veic, frt)
           SELECT * FROM unnest($1::date[], $2::text[], $3::text[], $4::text[], $5::text[], $6::numeric[], $7::text[], $8::numeric[], $9::text[], $10::text[])
           ON CONFLICT (dt, ord_num, ctl) DO UPDATE SET
             faz_cod = CASE WHEN ${ALT} THEN EXCLUDED.faz_cod ELSE pes_viag.faz_cod END,
             tlh = CASE WHEN ${ALT} THEN EXCLUDED.tlh ELSE pes_viag.tlh END,
             ton = CASE WHEN ${ALT} THEN EXCLUDED.ton ELSE pes_viag.ton END,
             hsd = CASE WHEN ${ALT} OR pes_viag.hsd = '' THEN EXCLUDED.hsd ELSE pes_viag.hsd END,
             tara = CASE WHEN ${ALT} OR pes_viag.tara IS DISTINCT FROM EXCLUDED.tara THEN EXCLUDED.tara ELSE pes_viag.tara END,
             veic = CASE WHEN ${ALT} OR pes_viag.veic = '' THEN EXCLUDED.veic ELSE pes_viag.veic END,
             frt = CASE WHEN ${ALT} OR pes_viag.frt = '' THEN EXCLUDED.frt ELSE pes_viag.frt END`,
          [dts, ords, cts, v.map((x) => x.fazendaCodigo), v.map((x) => x.talhao), v.map((x) => x.toneladas), v.map((x) => x.hora), v.map((x) => x.tara), v.map((x) => x.veiculo), v.map((x) => x.frente)]
        );
      }
    }
    const depois = await toneladasPorDia([...datasArquivo]);
    for (const d of datasArquivo) {
      const a = Math.round((antes.get(d) ?? 0) * 100) / 100;
      const b = Math.round((depois.get(d) ?? 0) * 100) / 100;
      const x = dia(d);
      x.antesT = a;
      x.depoisT = b;
    }
    res.porData = [...dias.values()]
      .filter((x) => x.antesT !== x.depoisT || x.novas || x.alteradas || x.corrigidas || x.removidas)
      .sort((p, q) => p.data.localeCompare(q.data));
    // prévia: faz tudo dentro da transação para medir o efeito e desfaz
    await client.query(aplicar ? "COMMIT" : "ROLLBACK");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  return res;
}

const addDias = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

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

/** Quantas viagens e entradas diárias de cana existem entre as datas (inclusive). */
export async function contarPesagens(inicio: string, fim: string): Promise<{ viagens: number; entradas: number }> {
  const pool = getPool();
  await prepararBanco(pool);
  const v = await pool.query<{ n: number }>("SELECT COUNT(*)::int AS n FROM pes_viag WHERE dt BETWEEN $1 AND $2", [inicio, fim]);
  const e = await pool.query<{ n: number }>("SELECT COUNT(*)::int AS n FROM ent_dia WHERE dt BETWEEN $1 AND $2", [inicio, fim]);
  return { viagens: v.rows[0].n, entradas: e.rows[0].n };
}

/** Apaga do banco as viagens e as entradas diárias de cana das datas informadas (inclusive). */
export async function limparPesagens(inicio: string, fim: string): Promise<{ viagens: number; entradas: number }> {
  const pool = getPool();
  await prepararBanco(pool);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const v = await client.query("DELETE FROM pes_viag WHERE dt BETWEEN $1 AND $2", [inicio, fim]);
    const e = await client.query("DELETE FROM ent_dia WHERE dt BETWEEN $1 AND $2", [inicio, fim]);
    await client.query("UPDATE app_met SET ult_atu = now() WHERE id = true");
    await client.query("COMMIT");
    return { viagens: v.rowCount ?? 0, entradas: e.rowCount ?? 0 };
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

export async function adicionarOrdemVisivel(numero: string, usuario = ""): Promise<true | { erro: string }> {
  const pool = getPool();
  await prepararBanco(pool);
  const { rows } = await pool.query("SELECT 1 FROM ord WHERE num = $1", [numero]);
  if (rows.length === 0) {
    return { erro: `Ordem ${numero} não encontrada na última importação.` };
  }
  const { rowCount } = await pool.query("INSERT INTO ord_vis (ord_num, usr) VALUES ($1, $2) ON CONFLICT (ord_num) DO NOTHING", [numero, usuario]);
  if ((rowCount ?? 0) > 0) await auditar(pool, { usuario, modulo: "Colheita", entidade: "Ordem inserida na tela", chave: `Ordem ${numero}`, acao: "inclusao", depois: { ordem: numero } });
  return true;
}

export async function removerOrdemVisivel(numero: string, usuario = ""): Promise<void> {
  const pool = getPool();
  await prepararBanco(pool);
  const { rowCount } = await pool.query("DELETE FROM ord_vis WHERE ord_num = $1", [numero]);
  if ((rowCount ?? 0) > 0) await auditar(pool, { usuario, modulo: "Colheita", entidade: "Ordem inserida na tela", chave: `Ordem ${numero}`, acao: "exclusao", antes: { ordem: numero } });
}

export async function listMetas(): Promise<MetaFrente[]> {
  const pool = getPool();
  await prepararBanco(pool);
  const { rows } = await pool.query<{
    id: string; frente: string; meta_dia_t: number; vigencia: string; usr: string; atu_usr: string; atu: string | null; ini: string | null; fim: string | null;
  }>(
    `SELECT m.id, m.frt AS frente, m.met_dia_t AS meta_dia_t, m.vig AS vigencia, m.usr, m.atu_usr,
            to_char(m.atu_em AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI:SS') AS atu,
            a.ini::text AS ini, a.fim::text AS fim
       FROM met_frt m LEFT JOIN frt_atv a ON a.frt = m.frt ORDER BY m.frt, m.vig`
  );
  return rows.map((r) => ({
    id: r.id,
    frente: r.frente,
    metaDiaT: r.meta_dia_t,
    vigencia: r.vigencia,
    atvIni: r.ini,
    atvFim: r.fim,
    lancadoPor: r.usr,
    alteradoPor: r.atu_usr,
    alteradoEm: r.atu ?? undefined,
  }));
}

/** Início e fim de atividade das frentes (Metas › Atividade das frentes). */
export async function listAtividadesFrentes(): Promise<AtividadeFrente[]> {
  const pool = getPool();
  await prepararBanco(pool);
  const { rows } = await pool.query<{ frt: string; ini: string | null; fim: string | null; atu_usr: string; atu: string | null }>(
    `SELECT frt, ini::text AS ini, fim::text AS fim, atu_usr,
            to_char(atu_em AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI:SS') AS atu FROM frt_atv ORDER BY frt`
  );
  return rows.map((r) => ({ frente: r.frt, inicio: r.ini, fim: r.fim, alteradoPor: r.atu_usr, alteradoEm: r.atu ?? undefined }));
}

/** Grava o início e o fim de atividade de uma frente (os dois vazios tiram a frente da lista). */
export async function salvarAtividadeFrente(frente: string, inicio: string | null, fim: string | null, usuario = ""): Promise<true | { erro: string }> {
  if (inicio && fim && fim < inicio) return { erro: "O fim da atividade não pode ser antes do início." };
  const pool = getPool();
  await prepararBanco(pool);
  const antes = (await pool.query<{ ini: string | null; fim: string | null }>("SELECT ini::text AS ini, fim::text AS fim FROM frt_atv WHERE frt = $1", [frente])).rows[0];
  if (!inicio && !fim) await pool.query("DELETE FROM frt_atv WHERE frt = $1", [frente]);
  else
    await pool.query(
      `INSERT INTO frt_atv (frt, ini, fim, usr, atu_usr) VALUES ($1, $2::date, $3::date, $4, $4)
       ON CONFLICT (frt) DO UPDATE SET ini = EXCLUDED.ini, fim = EXCLUDED.fim, atu_usr = EXCLUDED.atu_usr, atu_em = now()`,
      [frente, inicio, fim, usuario]
    );
  const txt = (v: string | null | undefined) => (v ? dataBR(v) : "—");
  if (!antes || antes.ini !== inicio || antes.fim !== fim)
    await auditar(pool, {
      usuario,
      modulo: "Colheita",
      entidade: "Atividade da frente",
      chave: frente,
      acao: !antes ? "inclusao" : !inicio && !fim ? "exclusao" : "alteracao",
      antes: antes ? { início: txt(antes.ini), fim: txt(antes.fim) } : undefined,
      depois: inicio || fim ? { início: txt(inicio), fim: fim ? txt(fim) : "ativa" } : undefined,
    });
  return true;
}

/** Uma meta por (frente, vigência): cadastrar de novo na mesma data
 * substitui o valor. */
export async function salvarMeta(frente: string, metaDiaT: number, vigencia: string, usuario = ""): Promise<void> {
  const pool = getPool();
  await prepararBanco(pool);
  const { rows: antes } = await pool.query<{ met_dia_t: number }>("SELECT met_dia_t::float AS met_dia_t FROM met_frt WHERE frt = $1 AND vig = $2", [frente, vigencia]);
  await pool.query(
    `INSERT INTO met_frt (id, frt, met_dia_t, vig, usr, atu_usr) VALUES ($1,$2,$3,$4,$5,$5)
     ON CONFLICT (frt, vig) DO UPDATE SET met_dia_t = EXCLUDED.met_dia_t, atu_usr = EXCLUDED.atu_usr, atu_em = now()`,
    [randomUUID(), frente, metaDiaT, vigencia, usuario]
  );
  if (antes.length === 0 || antes[0].met_dia_t !== metaDiaT) {
    await auditar(pool, {
      usuario,
      modulo: "Colheita",
      entidade: "Meta",
      chave: `${frente} · ${dataBR(vigencia)}`,
      acao: antes.length === 0 ? "inclusao" : "alteracao",
      antes: antes.length ? { "meta (t/dia)": antes[0].met_dia_t } : undefined,
      depois: { "meta (t/dia)": metaDiaT },
    });
  }
}

/** Edita uma meta já lançada (frente, valor e/ou data). Recusa se a nova
 * combinação frente+data já existir em outra meta. */
export async function atualizarMeta(
  id: string,
  frente: string,
  metaDiaT: number,
  vigencia: string,
  usuario = ""
): Promise<true | { erro: string }> {
  const pool = getPool();
  await prepararBanco(pool);
  const { rows: existe } = await pool.query<{ frt: string; met_dia_t: number; vig: string }>("SELECT frt, met_dia_t::float AS met_dia_t, vig FROM met_frt WHERE id = $1", [id]);
  if (existe.length === 0) return { erro: "Meta não encontrada." };
  const { rows: conflito } = await pool.query("SELECT 1 FROM met_frt WHERE frt = $1 AND vig = $2 AND id <> $3", [
    frente,
    vigencia,
    id,
  ]);
  if (conflito.length > 0) return { erro: "Já existe uma meta dessa frente nessa data. Edite aquela ou escolha outra data." };
  await pool.query("UPDATE met_frt SET frt = $1, met_dia_t = $2, vig = $3, atu_usr = $5, atu_em = now() WHERE id = $4", [frente, metaDiaT, vigencia, id, usuario]);
  await auditar(pool, {
    usuario,
    modulo: "Colheita",
    entidade: "Meta",
    chave: `${frente} · ${dataBR(vigencia)}`,
    acao: "alteracao",
    antes: { frente: existe[0].frt, "meta (t/dia)": existe[0].met_dia_t, vigência: dataBR(existe[0].vig) },
    depois: { frente, "meta (t/dia)": metaDiaT, vigência: dataBR(vigencia) },
  });
  return true;
}

export async function excluirMeta(id: string, usuario = ""): Promise<void> {
  const pool = getPool();
  await prepararBanco(pool);
  const { rows } = await pool.query<{ frt: string; met_dia_t: number; vig: string }>("SELECT frt, met_dia_t::float AS met_dia_t, vig FROM met_frt WHERE id = $1", [id]);
  await pool.query("DELETE FROM met_frt WHERE id = $1", [id]);
  if (rows.length) {
    await auditar(pool, {
      usuario,
      modulo: "Colheita",
      entidade: "Meta",
      chave: `${rows[0].frt} · ${dataBR(rows[0].vig)}`,
      acao: "exclusao",
      antes: { "meta (t/dia)": rows[0].met_dia_t },
    });
  }
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
  // a descrição da fazenda vem do Cadastro de Fazenda
  await sincronizarDescricaoFazendas();
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
  frenteCorreta: string | null,
  usuario = ""
): Promise<boolean> {
  const pool = getPool();
  await prepararBanco(pool);
  const { rows: antes } = await pool.query<{ frt_cor: string | null }>(
    "SELECT frt_cor FROM conf_pes WHERE dt = $1 AND eqp = $2 AND frt = $3 AND faz_cod = $4",
    [data, eqp, frente, fazendaCodigo]
  );
  const { rowCount } = await pool.query(
    "UPDATE conf_pes SET frt_cor = $1 WHERE dt = $2 AND eqp = $3 AND frt = $4 AND faz_cod = $5",
    [frenteCorreta, data, eqp, frente, fazendaCodigo]
  );
  if ((rowCount ?? 0) > 0 && (antes[0]?.frt_cor ?? null) !== frenteCorreta) {
    await auditar(pool, {
      usuario,
      modulo: "Colheita",
      entidade: "Correção da conferência de pesagem",
      chave: `${dataBR(data)} · equipamento ${eqp} · fazenda ${fazendaCodigo}`,
      acao: "alteracao",
      antes: { "frente correta": antes[0]?.frt_cor ?? "" },
      depois: { "frente correta": frenteCorreta ?? "" },
    });
  }
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
  const { rows } = await pool.query<{ id: string; eqp: string; frente: string; vigencia: string; usr: string; atu_usr: string; atu: string | null }>(
    `SELECT id, eqp, frt AS frente, vig AS vigencia, usr, atu_usr,
            to_char(atu_em AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI:SS') AS atu FROM eqp_frt ORDER BY eqp, vig`
  );
  return rows.map((r) => ({
    id: r.id,
    eqp: r.eqp,
    frente: r.frente,
    vigencia: r.vigencia,
    lancadoPor: r.usr,
    alteradoPor: r.atu_usr,
    alteradoEm: r.atu ?? undefined,
  }));
}

/** Um lançamento por (equipamento, vigência): lançar de novo na mesma data
 * substitui a frente. */
export async function salvarEquiptoFrente(eqp: string, frente: string, vigencia: string, usuario = ""): Promise<void> {
  const pool = getPool();
  await prepararBanco(pool);
  const { rows: antes } = await pool.query<{ frt: string }>("SELECT frt FROM eqp_frt WHERE eqp = $1 AND vig = $2", [eqp, vigencia]);
  await pool.query(
    `INSERT INTO eqp_frt (id, eqp, frt, vig, usr, atu_usr) VALUES ($1,$2,$3,$4,$5,$5)
     ON CONFLICT (eqp, vig) DO UPDATE SET frt = EXCLUDED.frt, atu_usr = EXCLUDED.atu_usr, atu_em = now()`,
    [randomUUID(), eqp, frente, vigencia, usuario]
  );
  if (antes.length === 0 || antes[0].frt !== frente) {
    await auditar(pool, {
      usuario,
      modulo: "Colheita",
      entidade: "Equipto Frente",
      chave: `Equipamento ${eqp} · ${dataBR(vigencia)}`,
      acao: antes.length === 0 ? "inclusao" : "alteracao",
      antes: antes.length ? { frente: antes[0].frt } : undefined,
      depois: { frente },
    });
  }
}

export async function atualizarEquiptoFrente(
  id: string,
  eqp: string,
  frente: string,
  vigencia: string,
  usuario = ""
): Promise<true | { erro: string }> {
  const pool = getPool();
  await prepararBanco(pool);
  const { rows: existe } = await pool.query<{ eqp: string; frt: string; vig: string }>("SELECT eqp, frt, vig FROM eqp_frt WHERE id = $1", [id]);
  if (existe.length === 0) return { erro: "Lançamento não encontrado." };
  const { rows: conflito } = await pool.query("SELECT 1 FROM eqp_frt WHERE eqp = $1 AND vig = $2 AND id <> $3", [
    eqp,
    vigencia,
    id,
  ]);
  if (conflito.length > 0) {
    return { erro: "Esse equipamento já tem um lançamento nessa data. Edite aquele ou escolha outra data." };
  }
  await pool.query("UPDATE eqp_frt SET eqp = $1, frt = $2, vig = $3, atu_usr = $5, atu_em = now() WHERE id = $4", [eqp, frente, vigencia, id, usuario]);
  await auditar(pool, {
    usuario,
    modulo: "Colheita",
    entidade: "Equipto Frente",
    chave: `Equipamento ${eqp} · ${dataBR(vigencia)}`,
    acao: "alteracao",
    antes: { equipamento: existe[0].eqp, frente: existe[0].frt, vigência: dataBR(existe[0].vig) },
    depois: { equipamento: eqp, frente, vigência: dataBR(vigencia) },
  });
  return true;
}

export async function excluirEquiptoFrente(id: string, usuario = ""): Promise<void> {
  const pool = getPool();
  await prepararBanco(pool);
  const { rows } = await pool.query<{ eqp: string; frt: string; vig: string }>("SELECT eqp, frt, vig FROM eqp_frt WHERE id = $1", [id]);
  await pool.query("DELETE FROM eqp_frt WHERE id = $1", [id]);
  if (rows.length) {
    await auditar(pool, {
      usuario,
      modulo: "Colheita",
      entidade: "Equipto Frente",
      chave: `Equipamento ${rows[0].eqp} · ${dataBR(rows[0].vig)}`,
      acao: "exclusao",
      antes: { frente: rows[0].frt },
    });
  }
}

// ---------------------------------------------------------------------------
// Cadastros de apoio importados de planilhas (tabela genérica cad_itm)
// ---------------------------------------------------------------------------

export interface ItemCadastro {
  cod: string;
  nm: string;
  dados: Record<string, string | number>;
  lancadoPor?: string;
  alteradoPor?: string;
  alteradoEm?: string;
}

export async function listarCadastro(
  cad: string,
  busca: string,
  pagina: number,
  tamanho: number,
  /** filtro fixo da aba (SQL do servidor, lib/cadastros-abas.ts) */
  filtroAba = ""
): Promise<{ total: number; itens: ItemCadastro[] }> {
  const pool = getPool();
  await prepararBanco(pool);
  const termo = `%${busca.trim().replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const filtro = `cad = $1 AND ($2 = '%%' OR cod ILIKE $2 OR nm ILIKE $2 OR dds::text ILIKE $2)${filtroAba ? ` AND ${filtroAba}` : ""}`;
  const { rows: cont } = await pool.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM cad_itm WHERE ${filtro}`, [cad, termo]);
  const { rows } = await pool.query<{ cod: string; nm: string; dds: Record<string, string | number>; usr: string; atu_usr: string; atu: string | null }>(
    `SELECT cod, nm, dds, usr, atu_usr, to_char(atu_em AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI:SS') AS atu
       FROM cad_itm WHERE ${filtro}
      ORDER BY CASE WHEN cod ~ '^[0-9]+$' THEN lpad(cod, 15, '0') ELSE cod END
      LIMIT $3 OFFSET $4`,
    [cad, termo, tamanho, Math.max(0, (pagina - 1) * tamanho)]
  );
  return {
    total: cont[0].n,
    itens: rows.map((r) => ({ cod: r.cod, nm: r.nm, dados: r.dds, lancadoPor: r.usr, alteradoPor: r.atu_usr, alteradoEm: r.atu ?? undefined })),
  };
}

/** Grava os itens (novos entram, existentes são atualizados pelo código); o resto do cadastro fica como está. */
export async function upsertCadastroLote(cad: string, itens: ItemCadastro[], usuario = ""): Promise<{ novos: number; atualizados: number }> {
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
        `INSERT INTO cad_itm (cad, cod, nm, dds, usr, atu_usr)
         SELECT $1, x.cod, x.nm, x.dds, $3, $3 FROM jsonb_to_recordset($2::jsonb) AS x(cod text, nm text, dds jsonb)
         ON CONFLICT (cad, cod) DO UPDATE SET nm = EXCLUDED.nm, dds = cad_itm.dds || EXCLUDED.dds, atu_em = now(), atu_usr = EXCLUDED.atu_usr`,
        [cad, json, usuario]
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
  dados: Record<string, string | number>,
  usuario = ""
): Promise<boolean> {
  const pool = getPool();
  await prepararBanco(pool);
  const { rowCount } = await pool.query(
    "UPDATE cad_itm SET nm = $3, dds = dds || $4::jsonb, atu_em = now(), atu_usr = $5 WHERE cad = $1 AND cod = $2",
    [cad, cod, nm, JSON.stringify(dados), usuario]
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
    usr: string;
    atu_usr: string;
    atu: string | null;
  }>(
    `SELECT id, tp, ano, ano_ini, ano_fim, prd_ini, prd_fim, usr, atu_usr,
            to_char(atu_em AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI:SS') AS atu FROM saf_cad ORDER BY ano DESC, tp`
  );
  return rows.map((r) => ({
    id: r.id,
    tipo: r.tp,
    ano: r.ano,
    anoInicio: r.ano_ini,
    anoFim: r.ano_fim,
    producaoInicio: r.prd_ini,
    producaoFim: r.prd_fim,
    lancadoPor: r.usr,
    alteradoPor: r.atu_usr,
    alteradoEm: r.atu ?? undefined,
  }));
}

/** Uma safra por (tipo, ano): cadastrar de novo substitui as datas. */
export async function salvarSafraCadastro(d: DadosSafraCadastro, usuario = ""): Promise<void> {
  const pool = getPool();
  await prepararBanco(pool);
  const { rows: antes } = await pool.query("SELECT 1 FROM saf_cad WHERE tp = $1 AND ano = $2", [d.tipo, d.ano]);
  await pool.query(
    `INSERT INTO saf_cad (id, tp, ano, ano_ini, ano_fim, prd_ini, prd_fim, usr, atu_usr) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)
     ON CONFLICT (tp, ano) DO UPDATE SET
       ano_ini = EXCLUDED.ano_ini, ano_fim = EXCLUDED.ano_fim, prd_ini = EXCLUDED.prd_ini, prd_fim = EXCLUDED.prd_fim,
       atu_usr = EXCLUDED.atu_usr, atu_em = now()`,
    [randomUUID(), d.tipo, d.ano, d.anoInicio, d.anoFim, d.producaoInicio, d.producaoFim, usuario]
  );
  await auditar(pool, {
    usuario,
    modulo: "Configurações",
    entidade: "Cadastro de Safras",
    chave: `${d.tipo} ${d.ano}`,
    acao: antes.length ? "alteracao" : "inclusao",
    depois: { "início da safra": dataBR(d.anoInicio), "fim da safra": dataBR(d.anoFim), "início da produção": dataBR(d.producaoInicio), "fim da produção": dataBR(d.producaoFim) },
  });
}

export async function atualizarSafraCadastro(id: string, d: DadosSafraCadastro, usuario = ""): Promise<true | { erro: string }> {
  const pool = getPool();
  await prepararBanco(pool);
  const { rows: existe } = await pool.query<{ tp: string; ano: number; ano_ini: string; ano_fim: string; prd_ini: string; prd_fim: string }>(
    "SELECT tp, ano, ano_ini, ano_fim, prd_ini, prd_fim FROM saf_cad WHERE id = $1",
    [id]
  );
  if (existe.length === 0) return { erro: "Safra não encontrada." };
  const { rows: conflito } = await pool.query("SELECT 1 FROM saf_cad WHERE tp = $1 AND ano = $2 AND id <> $3", [
    d.tipo,
    d.ano,
    id,
  ]);
  if (conflito.length > 0) return { erro: `Já existe a safra ${d.tipo} ${d.ano}. Edite aquela ou escolha outro ano/tipo.` };
  await pool.query(
    "UPDATE saf_cad SET tp = $1, ano = $2, ano_ini = $3, ano_fim = $4, prd_ini = $5, prd_fim = $6, atu_usr = $8, atu_em = now() WHERE id = $7",
    [d.tipo, d.ano, d.anoInicio, d.anoFim, d.producaoInicio, d.producaoFim, id, usuario]
  );
  const a = existe[0];
  await auditar(pool, {
    usuario,
    modulo: "Configurações",
    entidade: "Cadastro de Safras",
    chave: `${d.tipo} ${d.ano}`,
    acao: "alteracao",
    antes: { safra: `${a.tp} ${a.ano}`, "início da safra": dataBR(a.ano_ini), "fim da safra": dataBR(a.ano_fim), "início da produção": dataBR(a.prd_ini), "fim da produção": dataBR(a.prd_fim) },
    depois: { safra: `${d.tipo} ${d.ano}`, "início da safra": dataBR(d.anoInicio), "fim da safra": dataBR(d.anoFim), "início da produção": dataBR(d.producaoInicio), "fim da produção": dataBR(d.producaoFim) },
  });
  return true;
}

export async function excluirSafraCadastro(id: string, usuario = ""): Promise<void> {
  const pool = getPool();
  await prepararBanco(pool);
  const { rows } = await pool.query<{ tp: string; ano: number }>("SELECT tp, ano FROM saf_cad WHERE id = $1", [id]);
  await pool.query("DELETE FROM saf_cad WHERE id = $1", [id]);
  if (rows.length) {
    await auditar(pool, { usuario, modulo: "Configurações", entidade: "Cadastro de Safras", chave: `${rows[0].tp} ${rows[0].ano}`, acao: "exclusao", antes: { safra: `${rows[0].tp} ${rows[0].ano}` } });
  }
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
  // a descrição da fazenda vem do Cadastro de Fazenda
  await sincronizarDescricaoFazendas();
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
  acessos?: unknown;
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
    acessos: Array.isArray(r.acessos) ? r.acessos.filter((x): x is string => typeof x === "string") : null,
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
  const senhaProvisoria = SENHA_PADRAO_NOVO_USUARIO;
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
    acessos: null,
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

export interface LinhaTerceiro {
  frente: string;
  data: string;
  veiculo: string;
  ton: number;
  viagens: number;
}

export interface TotalTerceiro {
  frente?: string;
  data?: string;
  ton: number;
  viagens: number;
}

export interface ResultadoTerceiros {
  linhas: LinhaTerceiro[];
  frentes: string[];
  semVeiculo: number;
  porData: TotalTerceiro[];
  porFrente: TotalTerceiro[];
  geral: { ton: number; viagens: number };
}

/** Entrada de cana por frente (da ordem), data e caminhão, para o relatório de Colheita Terceiro; viagens de tara zerada não contam. */
export async function entradaTerceiros(
  inicio: string,
  fim: string,
  frente: string
): Promise<ResultadoTerceiros> {
  const pool = getPool();
  await prepararBanco(pool);
  const base = `FROM pes_viag v LEFT JOIN ord o ON o.num = v.ord_num
      WHERE v.dt BETWEEN $1 AND $2 AND COALESCE(v.tara, 0) > 0`;
  const nomeFrente = "COALESCE(NULLIF(o.frt, ''), NULLIF(v.frt, ''), 'SEM FRENTE')";
  const fr = await pool.query<{ f: string }>(`SELECT DISTINCT ${nomeFrente} AS f ${base} ORDER BY 1`, [inicio, fim]);
  const { rows } = await pool.query<LinhaTerceiro>(
    `SELECT ${nomeFrente} AS frente, v.dt::text AS data, v.veic AS veiculo, SUM(v.ton)::float AS ton, COUNT(DISTINCT split_part(v.ctl, ' ', 1))::int AS viagens
       ${base} AND ($3 = '' OR ${nomeFrente} = $3)
      GROUP BY 1, v.dt, v.veic
      ORDER BY 1, v.dt, v.veic`,
    [inicio, fim, frente]
  );
  // viagens = controles distintos; por isso os subtotais são contados à parte, nunca somados das linhas
  const filtro = `${base} AND ($3 = '' OR ${nomeFrente} = $3)`;
  const porData = await pool.query<TotalTerceiro>(
    `SELECT ${nomeFrente} AS frente, v.dt::text AS data, SUM(v.ton)::float AS ton, COUNT(DISTINCT split_part(v.ctl, ' ', 1))::int AS viagens
       ${filtro} GROUP BY 1, v.dt`,
    [inicio, fim, frente]
  );
  const porFrente = await pool.query<TotalTerceiro>(
    `SELECT ${nomeFrente} AS frente, SUM(v.ton)::float AS ton, COUNT(DISTINCT split_part(v.ctl, ' ', 1))::int AS viagens ${filtro} GROUP BY 1`,
    [inicio, fim, frente]
  );
  const geral = await pool.query<TotalTerceiro>(
    `SELECT SUM(v.ton)::float AS ton, COUNT(DISTINCT split_part(v.ctl, ' ', 1))::int AS viagens ${filtro}`,
    [inicio, fim, frente]
  );
  const sv = await pool.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM pes_viag WHERE dt BETWEEN $1 AND $2 AND veic = ''`,
    [inicio, fim]
  );
  return {
    linhas: rows,
    frentes: fr.rows.map((r) => r.f),
    semVeiculo: sv.rows[0].n,
    porData: porData.rows,
    porFrente: porFrente.rows,
    geral: { ton: geral.rows[0].ton ?? 0, viagens: geral.rows[0].viagens },
  };
}


/** Data da pesagem mais recente importada ("" se não houver). */
export async function ultimaDataPesagem(): Promise<string> {
  const pool = getPool();
  await prepararBanco(pool);
  const { rows } = await pool.query<{ d: string | null }>("SELECT MAX(dt)::text AS d FROM pes_viag");
  return rows[0]?.d ?? "";
}


/**
 * Telas que o usuário pode ver (Parâmetros → Usuários). `null` libera todas, inclusive as que forem criadas
 * depois; uma lista restringe o menu e o acesso às telas listadas. Fica no log de alterações.
 */
export async function salvarAcessosUsuario(id: string, acessos: string[] | null, quem: string): Promise<true | { erro: string }> {
  const pool = getPool();
  await prepararBanco(pool);
  const atual = await getUsuarioPorId(id);
  if (!atual) return { erro: "Usuário não encontrado." };
  if (atual.perfil === "admin") return { erro: "O administrador vê todas as telas; não há o que restringir." };
  await pool.query("UPDATE usr SET ace = $2::jsonb WHERE id = $1", [id, acessos === null ? null : JSON.stringify(acessos)]);
  await auditar(pool, {
    usuario: quem,
    modulo: "Parâmetros",
    entidade: "Acesso de usuário",
    chave: `${atual.nome} ${atual.sobrenome}`.trim() || atual.email,
    acao: "alteracao",
    antes: { telas: atual.acessos === null ? "todas" : atual.acessos },
    depois: { telas: acessos === null ? "todas" : acessos },
  });
  return true;
}

// ---------------------------------------------------------------------------
// Descrição da fazenda: o Cadastro de Fazenda é a fonte para o sistema inteiro
// ---------------------------------------------------------------------------

/** código da fazenda (sem zeros à esquerda e sem a sequência) → descrição do cadastro; a sequência 0 tem preferência */
const CTE_FAZENDAS = `WITH fz AS (
  SELECT DISTINCT ON (k) k, nm FROM (
    SELECT ltrim(split_part(cod, '-', 1), '0') AS k, cod, btrim(nm) AS nm, position('-' in cod) = 0 AS principal
      FROM cad_itm WHERE cad = 'fazendas' AND btrim(nm) <> ''
  ) x ORDER BY k, principal DESC, cod
)`;

/** tabelas com o nome da fazenda gravado junto do código */
const TABELAS_FAZENDA: { tabela: string; cod: string; nm: string; rotulo: string }[] = [
  { tabela: "ord", cod: "faz_cod", nm: "faz_nm", rotulo: "Ordens de corte" },
  { tabela: "tlh", cod: "faz_cod", nm: "faz_nm", rotulo: "Talhões das ordens" },
  { tabela: "conf_pes", cod: "faz_cod", nm: "faz_nm", rotulo: "Conferência de pesagem" },
  { tabela: "saf_tlh", cod: "faz_cod", nm: "faz_nm", rotulo: "Histórico de safras" },
  { tabela: "os_tlh", cod: "prop_cod", nm: "prop_nm", rotulo: "Base de Acompanhamento de O.S." },
  { tabela: "ap_dia_tlh", cod: "prop_cod", nm: "prop_nm", rotulo: "Apontamentos das atividades" },
  { tabela: "os_agr", cod: "prop_cod", nm: "prop_nm", rotulo: "Base de O.S. (Ordem de Serviço Agr.)" },
];

/**
 * Grava a descrição do Cadastro de Fazenda em todas as bases que guardam o nome da fazenda (ordens, talhões, pesagens,
 * histórico de safras, O.S., apontamentos e empréstimos). Roda depois de cada importação e da correção do cadastro;
 * fazendas sem cadastro ficam com o nome que vieram. Nunca derruba a importação que a chamou.
 */
export async function sincronizarDescricaoFazendas(): Promise<{ rotulo: string; linhas: number }[]> {
  const pool = getPool();
  const feito: { rotulo: string; linhas: number }[] = [];
  try {
    await prepararBanco(pool);
    for (const t of TABELAS_FAZENDA) {
      const existe = (await pool.query<{ r: string | null }>("SELECT to_regclass($1)::text AS r", [t.tabela])).rows[0].r;
      if (!existe) continue;
      const r = await pool.query(
        `${CTE_FAZENDAS}
         UPDATE ${t.tabela} AS t SET ${t.nm} = fz.nm FROM fz
          WHERE ltrim(split_part(t.${t.cod}, '-', 1), '0') = fz.k AND t.${t.nm} IS DISTINCT FROM fz.nm`
      );
      if (r.rowCount) feito.push({ rotulo: t.rotulo, linhas: r.rowCount });
    }
    if ((await pool.query<{ r: string | null }>("SELECT to_regclass('emp_cab')::text AS r")).rows[0].r) {
      const r = await pool.query(
        `${CTE_FAZENDAS}, novo AS (
           SELECT e.id, jsonb_agg(CASE WHEN fz.nm IS NOT NULL THEN jsonb_set(el, '{nome}', to_jsonb(fz.nm)) ELSE el END ORDER BY o) AS faz
             FROM emp_cab e CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(e.faz) = 'array' THEN e.faz ELSE '[]'::jsonb END) WITH ORDINALITY AS a(el, o)
             LEFT JOIN fz ON fz.k = ltrim(el->>'cod', '0')
            GROUP BY e.id
         )
         UPDATE emp_cab AS e SET faz = novo.faz FROM novo WHERE novo.id = e.id AND e.faz IS DISTINCT FROM novo.faz`
      );
      if (r.rowCount) feito.push({ rotulo: "Empréstimos de insumos", linhas: r.rowCount });
    }
  } catch (err) {
    console.error("Descrição das fazendas não sincronizada:", err);
  }
  return feito;
}

export interface ResultadoAjusteCadastro {
  total: number;
  alterados: number;
  exemplos: { cod: string; antes: string; depois: string }[];
  /** bases do sistema que receberam a descrição nova (só Fazenda) */
  sincronizado: { rotulo: string; linhas: number }[];
}

/** Aplica a correção do cadastro (`spec.ajuste`) nos itens já gravados; com `gravar = false` só devolve a prévia. */
export async function ajustarCadastro(spec: CadastroSpec, gravar: boolean, usuario: string): Promise<ResultadoAjusteCadastro> {
  const pool = getPool();
  await prepararBanco(pool);
  if (!spec.ajuste) return { total: 0, alterados: 0, exemplos: [], sincronizado: [] };
  const { rows } = await pool.query<{ cod: string; nm: string; dds: DadosCadastro }>("SELECT cod, nm, dds FROM cad_itm WHERE cad = $1 ORDER BY cod", [spec.slug]);
  const mudam = rows
    .map((r) => {
      const dds = spec.ajuste!.aplicar(r.dds ?? {});
      return { cod: r.cod, antes: r.nm, nm: spec.nome(dds), dds, mudou: JSON.stringify(dds) !== JSON.stringify(r.dds ?? {}) };
    })
    .filter((x) => x.mudou || x.nm !== x.antes);
  let sincronizado: { rotulo: string; linhas: number }[] = [];
  if (gravar && mudam.length > 0) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE cad_itm c SET nm = x.nm, dds = x.dds, atu_em = now(), atu_usr = $3
           FROM jsonb_to_recordset($2::jsonb) AS x(cod text, nm text, dds jsonb)
          WHERE c.cad = $1 AND c.cod = x.cod`,
        [spec.slug, JSON.stringify(mudam.map((m) => ({ cod: m.cod, nm: m.nm, dds: m.dds }))), usuario]
      );
      await auditar(client, {
        usuario,
        modulo: "Cadastros",
        entidade: `Cadastro de ${spec.titulo}`,
        chave: spec.ajuste.rotulo,
        acao: "alteracao",
        antes: Object.fromEntries(mudam.slice(0, 200).map((m) => [m.cod, m.antes])),
        depois: { alterados: mudam.length, exemplos: Object.fromEntries(mudam.slice(0, 200).map((m) => [m.cod, m.nm])) },
      });
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
  if (gravar && spec.slug === "fazendas") sincronizado = await sincronizarDescricaoFazendas();
  return {
    total: rows.length,
    alterados: mudam.length,
    exemplos: mudam.slice(0, 50).map((m) => ({ cod: m.cod, antes: m.antes, depois: m.nm })),
    sincronizado,
  };
}

/**
 * Área colhida sempre em centésimos, sem passar da área do talhão: as áreas gravadas com mais casas são arredondadas
 * e, onde o acumulado do talhão ficou até 0,01 ha acima da área (folga de arredondamento que a gravação aceitava), o
 * último lançamento é reduzido nessa diferença — com registro no log. Não mexe em diferenças maiores.
 */
async function ajustarArredondamentoAreaColhida(pool: Pool): Promise<void> {
  try {
    await pool.query("UPDATE col_dia SET area = round(area, 2) WHERE area <> round(area, 2)");
    await pool.query("UPDATE tlh SET area_col_ha = round(area_col_ha, 2) WHERE area_col_ha <> round(area_col_ha, 2)");
    await pool.query("UPDATE tlh SET area_ha = round(area_ha, 2) WHERE area_ha <> round(area_ha, 2)");
    const { rows } = await pool.query<{ ord_num: string; faz_cod: string; tlh: string; dt: string; antes: number; depois: number }>(
      `WITH tot AS (
         SELECT t.ord_num, t.faz_cod, t.tlh, t.area_ha, t.area_col_ha + SUM(c.area) AS col
           FROM tlh t JOIN col_dia c ON c.ord_num = t.ord_num AND c.faz_cod = t.faz_cod AND c.tlh = t.tlh
          GROUP BY t.ord_num, t.faz_cod, t.tlh, t.area_ha, t.area_col_ha
       ), exc AS (
         SELECT ord_num, faz_cod, tlh, round(col - area_ha, 2) AS ex FROM tot WHERE col > area_ha AND col - area_ha <= 0.011
       ), ult AS (
         SELECT DISTINCT ON (c.ord_num, c.faz_cod, c.tlh) c.ord_num, c.faz_cod, c.tlh, c.dt, c.area, e.ex
           FROM col_dia c JOIN exc e ON e.ord_num = c.ord_num AND e.faz_cod = c.faz_cod AND e.tlh = c.tlh
          WHERE c.area > e.ex
          ORDER BY c.ord_num, c.faz_cod, c.tlh, c.dt DESC
       )
       UPDATE col_dia c SET area = c.area - u.ex, atu_usr = 'Ajuste de arredondamento', atu_em = now()
         FROM ult u WHERE c.ord_num = u.ord_num AND c.faz_cod = u.faz_cod AND c.tlh = u.tlh AND c.dt = u.dt
       RETURNING c.ord_num, c.faz_cod, c.tlh, c.dt::text AS dt, u.area::float AS antes, c.area::float AS depois`
    );
    for (const r of rows) {
      await auditar(pool, {
        usuario: "Sistema",
        modulo: "Colheita",
        entidade: "Área colhida",
        chave: `Ordem ${r.ord_num} · fazenda ${r.faz_cod} · talhão ${r.tlh} · ${r.dt.split("-").reverse().join("/")}`,
        acao: "alteracao",
        antes: { ha: r.antes },
        depois: { ha: r.depois, motivo: "A área colhida acumulada passava 0,01 ha da área do talhão (arredondamento)." },
      });
    }
  } catch (err) {
    console.error("Ajuste de arredondamento da área colhida não concluído:", err);
  }
}
