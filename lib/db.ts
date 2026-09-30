import fs from "fs";
import path from "path";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { Database, OrdemCorte, Usuario } from "./types";
import { hashSenha, SESSION_COOKIE_NAME, verificarTokenSessao } from "./auth";

// Em produção (Render/qualquer Node host) isso grava no disco do serviço.
// Se o disco não for persistente entre deploys, trocar este arquivo por um
// adaptador de banco real (Postgres/Supabase) mantendo a mesma interface
// (getDb/saveDb) é a única mudança necessária — nenhuma tela precisa mudar.
//
// DATA_DIR pode ser sobrescrito pela variável de ambiente `DATA_DIR` — use
// isso para apontar para o Persistent Disk do Render (ver README, seção
// "Deploy no Render") sem depender de adivinhar o caminho de build do
// serviço.
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "db.json");

/**
 * Usuário administrador padrão, criado automaticamente na primeira execução.
 * Login: e-mail abaixo. Senha inicial: "crv@2026" — troque em Configurações
 * → Cadastros assim que possível.
 */
function buildAdminPadrao(): Usuario {
  return {
    id: "usr-admin-1",
    nome: "Administrador",
    email: "aureniorg3@gmail.com",
    senhaHash: hashSenha("crv@2026"),
    perfil: "admin",
    ativo: true,
    criadoEm: new Date().toISOString(),
  };
}

function buildSeedDb(): Database {
  return {
    ordens: [],
    ordensVisiveis: [],
    usuarios: [buildAdminPadrao()],
    ultimaAtualizacao: new Date().toISOString(),
  };
}

function ensureDb(): Database {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DB_PATH)) {
    const seeded = buildSeedDb();
    fs.writeFileSync(DB_PATH, JSON.stringify(seeded, null, 2), "utf-8");
    return seeded;
  }
  const raw = fs.readFileSync(DB_PATH, "utf-8");
  let db: Database;
  try {
    db = JSON.parse(raw) as Database;
  } catch {
    db = buildSeedDb();
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf-8");
    return db;
  }
  // Migração leve: bancos gravados antes da tela de login não têm `usuarios`.
  if (!db.usuarios || db.usuarios.length === 0) {
    db.usuarios = [buildAdminPadrao()];
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf-8");
    return db;
  }
  // Migração leve: bancos gravados antes dos níveis leitura/gravação/admin
  // tinham só "admin" | "operacional", e nenhum usuário tinha `ativo`.
  let migrou = false;
  for (const u of db.usuarios) {
    if ((u.perfil as string) === "operacional") {
      u.perfil = "gravacao";
      migrou = true;
    }
    if (u.ativo === undefined) {
      u.ativo = true;
      migrou = true;
    }
  }
  // Migração leve: bancos gravados antes da reformulação com os 3 relatórios
  // do CHBWEB tinham `ordens` no formato antigo (com `criadoEm`/`lancamentos`
  // etc.) — como a base agora é 100% derivada da importação, o mais seguro é
  // zerar e pedir uma reimportação, em vez de tentar converter o formato.
  if (db.ordens.some((o) => !("entradas" in o))) {
    db.ordens = [];
    migrou = true;
  }
  // Migração leve: bancos gravados antes da seleção manual de ordens não têm
  // `ordensVisiveis`.
  if (!db.ordensVisiveis) {
    db.ordensVisiveis = [];
    migrou = true;
  }
  if (migrou) {
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf-8");
  }
  return db;
}

export function getDb(): Database {
  return ensureDb();
}

export function saveDb(db: Database) {
  db.ultimaAtualizacao = new Date().toISOString();
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf-8");
}

export function listOrdens(): OrdemCorte[] {
  return getDb().ordens.sort((a, b) => a.numero.localeCompare(b.numero, undefined, { numeric: true }));
}

export function getOrdem(id: string): OrdemCorte | undefined {
  return getDb().ordens.find((o) => o.id === id);
}

/**
 * Substitui TODAS as ordens pelo resultado de uma importação — os três
 * relatórios de origem (Ordem de Colheita, Pesagem de Cana por Hora,
 * Conferência de Pesagens) são sempre a safra inteira até a data de
 * geração, não um incremento do dia, então não há o que mesclar: cada
 * importação é o retrato mais atual e substitui o anterior por completo.
 */
export function substituirOrdens(ordens: OrdemCorte[]) {
  const db = getDb();
  db.ordens = ordens;
  db.ultimaImportacao = new Date().toISOString();
  saveDb(db);
}

/** Números de ordem marcados para exibição, restrito ao que existe hoje na
 * base (uma ordem que sumiu numa reimportação não fica presa na lista). */
export function listOrdensVisiveis(): string[] {
  const db = getDb();
  const existentes = new Set(db.ordens.map((o) => o.numero));
  return db.ordensVisiveis.filter((n) => existentes.has(n));
}

export function adicionarOrdemVisivel(numero: string): true | { erro: string } {
  const db = getDb();
  if (!db.ordens.some((o) => o.numero === numero)) {
    return { erro: `Ordem ${numero} não encontrada na última importação.` };
  }
  if (!db.ordensVisiveis.includes(numero)) {
    db.ordensVisiveis.push(numero);
    saveDb(db);
  }
  return true;
}

export function removerOrdemVisivel(numero: string) {
  const db = getDb();
  db.ordensVisiveis = db.ordensVisiveis.filter((n) => n !== numero);
  saveDb(db);
}

export function listUsuarios(): Usuario[] {
  return getDb().usuarios;
}

export function getUsuarioPorId(id: string): Usuario | undefined {
  return listUsuarios().find((u) => u.id === id);
}

export function getUsuarioPorEmail(email: string): Usuario | undefined {
  const alvo = email.trim().toLowerCase();
  return listUsuarios().find((u) => u.email.toLowerCase() === alvo);
}

/** Usuário da sessão atual, para Server Components (usa `cookies()` de `next/headers`). */
export async function usuarioAtual(): Promise<Usuario | undefined> {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const uid = verificarTokenSessao(token);
  return uid ? getUsuarioPorId(uid) : undefined;
}

/** Mesma coisa, para Route Handlers — lê o cookie direto do `NextRequest`. */
export function usuarioDaRequisicao(req: NextRequest): Usuario | undefined {
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  const uid = verificarTokenSessao(token);
  return uid ? getUsuarioPorId(uid) : undefined;
}

function contarAdminsAtivos(db: Database, ignorarId?: string): number {
  return db.usuarios.filter((u) => u.perfil === "admin" && u.ativo && u.id !== ignorarId).length;
}

export interface NovoUsuarioInput {
  nome: string;
  email: string;
  senha: string;
  perfil: Usuario["perfil"];
}

export function insertUsuario(input: NovoUsuarioInput): Usuario | { erro: string } {
  const db = getDb();
  if (getUsuarioPorEmail(input.email)) {
    return { erro: "Já existe um usuário com esse e-mail." };
  }
  const usuario: Usuario = {
    id: `usr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    nome: input.nome.trim(),
    email: input.email.trim().toLowerCase(),
    senhaHash: hashSenha(input.senha),
    perfil: input.perfil,
    ativo: true,
    criadoEm: new Date().toISOString(),
  };
  db.usuarios.push(usuario);
  saveDb(db);
  return usuario;
}

export interface EditarUsuarioInput {
  nome?: string;
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
export function updateUsuario(
  id: string,
  input: EditarUsuarioInput,
  solicitanteId: string
): Usuario | { erro: string } {
  const db = getDb();
  const usuario = db.usuarios.find((u) => u.id === id);
  if (!usuario) return { erro: "Usuário não encontrado." };

  const vaiDesativar = input.ativo === false && usuario.ativo;
  const vaiRebaixar = input.perfil !== undefined && input.perfil !== "admin" && usuario.perfil === "admin";

  if (id === solicitanteId && (vaiDesativar || vaiRebaixar)) {
    return { erro: "Você não pode desativar nem rebaixar o próprio usuário." };
  }
  if ((vaiDesativar || vaiRebaixar) && usuario.perfil === "admin" && contarAdminsAtivos(db, id) === 0) {
    return { erro: "Este é o último administrador ativo — promova outro usuário antes de mudar isso." };
  }

  if (input.nome !== undefined) usuario.nome = input.nome.trim();
  if (input.perfil !== undefined) usuario.perfil = input.perfil;
  if (input.ativo !== undefined) usuario.ativo = input.ativo;
  if (input.senha) usuario.senhaHash = hashSenha(input.senha);

  saveDb(db);
  return usuario;
}

export function deleteUsuario(id: string, solicitanteId: string): true | { erro: string } {
  const db = getDb();
  const usuario = db.usuarios.find((u) => u.id === id);
  if (!usuario) return { erro: "Usuário não encontrado." };
  if (id === solicitanteId) return { erro: "Você não pode excluir o próprio usuário." };
  if (usuario.perfil === "admin" && usuario.ativo && contarAdminsAtivos(db, id) === 0) {
    return { erro: "Este é o último administrador ativo — promova outro usuário antes de excluir." };
  }
  db.usuarios = db.usuarios.filter((u) => u.id !== id);
  saveDb(db);
  return true;
}
