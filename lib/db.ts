import fs from "fs";
import path from "path";
import { Database, OrdemCorte, Usuario } from "./types";
import { buildSeedOrdens } from "./seed-data";
import { hashSenha } from "./auth";

// Em produção (Render/qualquer Node host) isso grava no disco do serviço.
// Se o disco não for persistente entre deploys, trocar este arquivo por um
// adaptador de banco real (Postgres/Supabase) mantendo a mesma interface
// (getDb/saveDb) é a única mudança necessária — nenhuma tela precisa mudar.
const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "db.json");

/**
 * Usuário administrador padrão, criado automaticamente na primeira execução
 * (ou na primeira execução após esta atualização, para bancos já existentes).
 * Login: e-mail abaixo. Senha inicial: "crv@2026" — troque assim que possível
 * (ainda não há tela de troca de senha; por ora, apague o usuário em
 * data/db.json e reinicie o servidor para gerar um novo, ou peça para eu
 * adicionar uma tela de gerenciamento de usuários).
 */
function buildAdminPadrao(): Usuario {
  return {
    id: "usr-admin-1",
    nome: "Administrador",
    email: "aureniorg3@gmail.com",
    senhaHash: hashSenha("crv@2026"),
    perfil: "admin",
    criadoEm: new Date().toISOString(),
  };
}

function buildSeedDb(): Database {
  return {
    ordens: buildSeedOrdens(),
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
  return getDb().ordens.sort((a, b) => (a.criadoEm < b.criadoEm ? 1 : -1));
}

export function getOrdem(id: string): OrdemCorte | undefined {
  return getDb().ordens.find((o) => o.id === id);
}

export function insertOrdem(ordem: OrdemCorte): OrdemCorte {
  const db = getDb();
  db.ordens.push(ordem);
  saveDb(db);
  return ordem;
}

export function updateOrdem(id: string, updater: (o: OrdemCorte) => OrdemCorte): OrdemCorte | undefined {
  const db = getDb();
  const idx = db.ordens.findIndex((o) => o.id === id);
  if (idx === -1) return undefined;
  const updated = updater(db.ordens[idx]);
  updated.atualizadoEm = new Date().toISOString();
  db.ordens[idx] = updated;
  saveDb(db);
  return updated;
}

export function deleteOrdem(id: string): boolean {
  const db = getDb();
  const before = db.ordens.length;
  db.ordens = db.ordens.filter((o) => o.id !== id);
  saveDb(db);
  return db.ordens.length < before;
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
