import { Pool, types } from "pg";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { Database, EntradaDiaria, OrdemCorte, TalhaoOrdem, Usuario } from "./types";
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
let prepararBancoPromise: Promise<void> | undefined;
function prepararBanco(pool: Pool): Promise<void> {
  if (!prepararBancoPromise) {
    prepararBancoPromise = (async () => {
      let count: number;
      try {
        const { rows } = await pool.query<{ count: number }>("SELECT COUNT(*)::int AS count FROM usuarios");
        count = rows[0].count;
      } catch (err) {
        throw new Error(
          "Tabelas do banco não encontradas no Postgres do Supabase. Rode supabase/schema.sql no SQL Editor do " +
            `Supabase antes de usar o sistema. Erro original: ${err instanceof Error ? err.message : String(err)}`
        );
      }
      if (count === 0) {
        const admin = buildAdminPadrao();
        await pool.query(
          `INSERT INTO usuarios (id, nome, sobrenome, email, usuario, senha_hash, perfil, ativo, precisa_trocar_senha, criado_em)
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
  viagens: number;
}

/** Monta OrdemCorte[] completas (com talhões e entradas aninhados) a partir
 * das 3 tabelas relacionadas — opcionalmente restrito a uma lista de
 * números de ordem. 3 consultas no total, independente de quantas ordens. */
async function carregarOrdensCompletas(pool: Pool, numeros?: string[]): Promise<OrdemCorte[]> {
  const { rows: ordensRows } = await pool.query<OrdemRow>(
    numeros ? "SELECT * FROM ordens WHERE numero = ANY($1::text[])" : "SELECT * FROM ordens",
    numeros ? [numeros] : []
  );
  if (ordensRows.length === 0) return [];

  const todosNumeros = ordensRows.map((r) => r.numero);
  const [{ rows: talhoesRows }, { rows: entradasRows }] = await Promise.all([
    pool.query<TalhaoRow>("SELECT * FROM talhoes WHERE ordem_numero = ANY($1::text[])", [todosNumeros]),
    pool.query<EntradaRow>("SELECT * FROM entradas_diarias WHERE ordem_numero = ANY($1::text[])", [todosNumeros]),
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
 * em `ordens_visiveis` via `ON DELETE CASCADE`. Ordens que continuam
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
    await client.query("DELETE FROM ordens WHERE NOT (numero = ANY($1::text[]))", [numeros]);

    // Talhões/entradas são sempre o retrato completo da importação —
    // limpa e reconstrói do zero pras ordens que sobraram, mais simples e
    // seguro do que tentar diffar linha a linha.
    await client.query("DELETE FROM talhoes");
    await client.query("DELETE FROM entradas_diarias");

    if (ordens.length > 0) {
      await client.query(
        `INSERT INTO ordens
           (numero, frente, fazenda_codigo, fazenda_nome, proprietario_codigo, proprietario_nome,
            status, tipo_cana, data_queima, observacao, safra_label, atualizado_em)
         SELECT * FROM unnest(
           $1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[],
           $7::text[], $8::text[], $9::date[], $10::text[], $11::text[], $12::timestamptz[]
         )
         ON CONFLICT (numero) DO UPDATE SET
           frente = EXCLUDED.frente, fazenda_codigo = EXCLUDED.fazenda_codigo, fazenda_nome = EXCLUDED.fazenda_nome,
           proprietario_codigo = EXCLUDED.proprietario_codigo, proprietario_nome = EXCLUDED.proprietario_nome,
           status = EXCLUDED.status, tipo_cana = EXCLUDED.tipo_cana, data_queima = EXCLUDED.data_queima,
           observacao = EXCLUDED.observacao, safra_label = EXCLUDED.safra_label, atualizado_em = EXCLUDED.atualizado_em`,
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
        `INSERT INTO talhoes (ordem_numero, fazenda_codigo, fazenda_nome, talhao, area_ha, area_colhida_ha)
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
    const eViagens: number[] = [];
    for (const o of ordens) {
      for (const e of o.entradas) {
        eOrdemNumero.push(o.numero);
        eData.push(e.data);
        eFazendaCodigo.push(e.fazendaCodigo);
        eTalhao.push(e.talhao);
        eToneladas.push(e.toneladas);
        eToneladasAte6h.push(e.toneladasAte6h);
        eViagens.push(e.viagens);
      }
    }
    if (eOrdemNumero.length > 0) {
      await client.query(
        `INSERT INTO entradas_diarias
           (ordem_numero, data, fazenda_codigo, talhao, toneladas, toneladas_ate_6h, viagens)
         SELECT * FROM unnest(
           $1::text[], $2::date[], $3::text[], $4::text[], $5::numeric[], $6::numeric[], $7::int[]
         )`,
        [eOrdemNumero, eData, eFazendaCodigo, eTalhao, eToneladas, eToneladasAte6h, eViagens]
      );
    }

    await client.query("UPDATE app_meta SET ultima_importacao = now(), ultima_atualizacao = now() WHERE id = true");
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
export async function listOrdensVisiveis(): Promise<string[]> {
  const pool = getPool();
  await prepararBanco(pool);
  const { rows } = await pool.query<{ ordem_numero: string }>(
    "SELECT ov.ordem_numero FROM ordens_visiveis ov JOIN ordens o ON o.numero = ov.ordem_numero"
  );
  return rows.map((r) => r.ordem_numero);
}

export async function adicionarOrdemVisivel(numero: string): Promise<true | { erro: string }> {
  const pool = getPool();
  await prepararBanco(pool);
  const { rows } = await pool.query("SELECT 1 FROM ordens WHERE numero = $1", [numero]);
  if (rows.length === 0) {
    return { erro: `Ordem ${numero} não encontrada na última importação.` };
  }
  await pool.query("INSERT INTO ordens_visiveis (ordem_numero) VALUES ($1) ON CONFLICT (ordem_numero) DO NOTHING", [numero]);
  return true;
}

export async function removerOrdemVisivel(numero: string): Promise<void> {
  const pool = getPool();
  await prepararBanco(pool);
  await pool.query("DELETE FROM ordens_visiveis WHERE ordem_numero = $1", [numero]);
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
        "UPDATE talhoes SET area_colhida_ha = $1 WHERE ordem_numero = $2 AND fazenda_codigo = $3 AND talhao = $4",
        [t.areaColhidaHa, numero, t.fazendaCodigo, t.talhao]
      );
    }
    await client.query("UPDATE ordens SET atualizado_em = $1 WHERE numero = $2", [ordem.atualizadoEm, numero]);
    await client.query("UPDATE app_meta SET ultima_atualizacao = now() WHERE id = true");
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
  const { rows } = await pool.query("SELECT * FROM usuarios ORDER BY criado_em");
  return rows.map(mapUsuario);
}

export async function getUsuarioPorId(id: string): Promise<Usuario | undefined> {
  const pool = getPool();
  await prepararBanco(pool);
  const { rows } = await pool.query("SELECT * FROM usuarios WHERE id = $1", [id]);
  return rows[0] ? mapUsuario(rows[0]) : undefined;
}

export async function getUsuarioPorEmail(email: string): Promise<Usuario | undefined> {
  const pool = getPool();
  await prepararBanco(pool);
  const { rows } = await pool.query("SELECT * FROM usuarios WHERE lower(email) = lower($1)", [email.trim()]);
  return rows[0] ? mapUsuario(rows[0]) : undefined;
}

export async function getUsuarioPorNomeDeUsuario(usuario: string): Promise<Usuario | undefined> {
  const pool = getPool();
  await prepararBanco(pool);
  const { rows } = await pool.query("SELECT * FROM usuarios WHERE lower(usuario) = lower($1)", [usuario.trim()]);
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
  return uid ? getUsuarioPorId(uid) : undefined;
}

/** Mesma coisa, para Route Handlers — lê o cookie direto do `NextRequest`. */
export async function usuarioDaRequisicao(req: NextRequest): Promise<Usuario | undefined> {
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  const uid = verificarTokenSessao(token);
  return uid ? getUsuarioPorId(uid) : undefined;
}

async function contarAdminsAtivos(pool: Pool, ignorarId?: string): Promise<number> {
  const { rows } = await pool.query<{ count: number }>(
    "SELECT COUNT(*)::int AS count FROM usuarios WHERE perfil = 'admin' AND ativo = true AND id IS DISTINCT FROM $1",
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
    `INSERT INTO usuarios (id, nome, sobrenome, email, usuario, senha_hash, perfil, ativo, precisa_trocar_senha, criado_em)
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
    "UPDATE usuarios SET nome=$1, sobrenome=$2, usuario=$3, perfil=$4, ativo=$5, senha_hash=$6, precisa_trocar_senha=$7 WHERE id=$8",
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
  const { rowCount } = await pool.query("UPDATE usuarios SET senha_hash = $1, precisa_trocar_senha = false WHERE id = $2", [
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
  await pool.query("DELETE FROM usuarios WHERE id = $1", [id]);
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
      "SELECT ultima_importacao, ultima_atualizacao FROM app_meta WHERE id = true"
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
