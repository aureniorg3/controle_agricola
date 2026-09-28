import fs from "fs";
import path from "path";
import { Database, Lancamento, OrdemCorte, Talhao, Usuario } from "./types";
import { buildSeedOrdens } from "./seed-data";
import { hashSenha } from "./auth";
import { LinhaImportada } from "./import-ordens";

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

// ---------------------------------------------------------------------------
// Importação de planilha (Ordens de Corte)
// ---------------------------------------------------------------------------
//
// Princípios seguidos aqui (pedido explícito: a planilha é uma "base de
// ideia", não a verdade absoluta):
//  - nunca sobrescreve um campo já cadastrado com um valor vazio da planilha;
//  - quando o valor da planilha diverge do já cadastrado, mantém o cadastrado
//    e registra um aviso (não decide sozinho qual está certo);
//  - reimportar o mesmo arquivo é idempotente: lançamentos importados usam um
//    id determinístico (`imp-<ordemId>-<data>`) e são atualizados no lugar em
//    vez de duplicados, e o acumulado por talhão só é incrementado para
//    lançamentos genuinamente novos (ou definido diretamente quando a própria
//    planilha já traz uma coluna de acumulado).

export interface ResultadoImportacao {
  ordensCriadas: number;
  ordensAtualizadas: number;
  talhoesCriados: number;
  lancamentosCriados: number;
  lancamentosAtualizados: number;
  avisos: string[];
}

function chaveOrdem(numero: string, fazendaCodigo: string, fazendaNome: string): string {
  const cod = fazendaCodigo && fazendaCodigo !== "-" ? fazendaCodigo : fazendaNome;
  return `${numero.trim().toLowerCase()}||${cod.trim().toLowerCase()}`;
}

export function importarLinhas(linhas: LinhaImportada[]): ResultadoImportacao {
  const db = getDb();
  const avisos: string[] = [];
  let ordensCriadas = 0;
  let ordensAtualizadas = 0;
  let talhoesCriados = 0;
  let lancamentosCriados = 0;
  let lancamentosAtualizados = 0;

  const grupos = new Map<string, LinhaImportada[]>();
  for (const l of linhas) {
    const chave = chaveOrdem(l.ordem, l.fazendaCodigo, l.fazendaNome);
    const arr = grupos.get(chave) ?? [];
    arr.push(l);
    grupos.set(chave, arr);
  }

  for (const linhasOrdem of grupos.values()) {
    const primeira = linhasOrdem[0];
    const chaveAlvo = chaveOrdem(primeira.ordem, primeira.fazendaCodigo, primeira.fazendaNome);
    let ordem = db.ordens.find((o) => chaveOrdem(o.numero, o.fazendaCodigo, o.fazendaNome) === chaveAlvo);
    const nowIso = new Date().toISOString();

    if (!ordem) {
      const dataMinima = linhasOrdem.reduce((min, l) => (l.data < min ? l.data : min), linhasOrdem[0].data);
      ordem = {
        id: `imp-${primeira.ordem.trim()}-${primeira.fazendaCodigo.trim() || Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 7)}`,
        numero: primeira.ordem.trim(),
        frente: primeira.frente,
        regiao: primeira.regiao,
        fazendaCodigo: primeira.fazendaCodigo,
        fazendaNome: primeira.fazendaNome,
        status: "Aberta",
        dataAbertura: dataMinima,
        talhoes: [],
        areaLiberadaHa: 0,
        areaColhidaHa: 0,
        tchRealizadoSafraAnterior: 0,
        tchEstimado: primeira.tchEstimado ?? 0,
        safraLabel: primeira.safraLabel || "2026/27",
        lancamentos: [],
        criadoEm: nowIso,
        atualizadoEm: nowIso,
      };
      db.ordens.push(ordem);
      ordensCriadas++;
    } else {
      if (primeira.frente && primeira.frente !== "FRENTE-IMPORT") {
        if (!ordem.frente || ordem.frente === "-") {
          ordem.frente = primeira.frente;
        } else if (ordem.frente.trim().toLowerCase() !== primeira.frente.trim().toLowerCase()) {
          avisos.push(
            `Ordem ${ordem.numero}: frente na planilha ("${primeira.frente}") difere da cadastrada ("${ordem.frente}") — mantida a cadastrada.`
          );
        }
      }
      if (primeira.regiao && primeira.regiao !== "-" && (!ordem.regiao || ordem.regiao === "-")) {
        ordem.regiao = primeira.regiao;
      }
      if (primeira.fazendaNome && primeira.fazendaNome !== "Fazenda não informada") {
        if (!ordem.fazendaNome) {
          ordem.fazendaNome = primeira.fazendaNome;
        } else if (ordem.fazendaNome.trim().toLowerCase() !== primeira.fazendaNome.trim().toLowerCase()) {
          avisos.push(
            `Ordem ${ordem.numero}: nome de fazenda na planilha ("${primeira.fazendaNome}") difere do cadastrado ("${ordem.fazendaNome}") — mantido o cadastrado.`
          );
        }
      }
      if (primeira.tchEstimado !== undefined && !ordem.tchEstimado) {
        ordem.tchEstimado = primeira.tchEstimado;
      }
      ordensAtualizadas++;
    }

    const ordemAtual = ordem;

    // --- Talhões: cria os que faltam, completa área vazia, nunca some com o que já existe.
    const talhaoNoMap = new Map<string, Talhao>(ordemAtual.talhoes.map((t) => [t.talhao.trim().toLowerCase(), t]));
    for (const l of linhasOrdem) {
      const chaveT = l.talhao.trim().toLowerCase();
      let t = talhaoNoMap.get(chaveT);
      if (!t) {
        t = { talhao: l.talhao, areaHa: l.areaHa, ultimaEntradaT: 0, acumSafraT: 0 };
        ordemAtual.talhoes.push(t);
        talhaoNoMap.set(chaveT, t);
        talhoesCriados++;
      } else if (l.areaHa > 0) {
        if (!t.areaHa) {
          t.areaHa = l.areaHa;
        } else if (Math.abs(t.areaHa - l.areaHa) > 0.05) {
          avisos.push(
            `Ordem ${ordemAtual.numero}, talhão ${t.talhao}: área na planilha (${l.areaHa} ha) difere da cadastrada (${t.areaHa} ha) — mantida a cadastrada.`
          );
        }
      }
    }
    ordemAtual.areaLiberadaHa = Math.round(ordemAtual.talhoes.reduce((s, t) => s + t.areaHa, 0) * 100) / 100;

    // --- Lançamentos: agrupa as linhas desta ordem por data, soma por talhão.
    const porData = new Map<string, LinhaImportada[]>();
    for (const l of linhasOrdem) {
      const arr = porData.get(l.data) ?? [];
      arr.push(l);
      porData.set(l.data, arr);
    }

    const acumAutoritativo = new Map<string, { data: string; valor: number }>();
    const incrementoNaoAutoritativo = new Map<string, number>();
    let maiorDataDoLote = "";

    for (const [data, linhasData] of porData) {
      if (data > maiorDataDoLote) maiorDataDoLote = data;

      const porTalhaoMap = new Map<string, number>();
      for (const l of linhasData) {
        porTalhaoMap.set(l.talhao, (porTalhaoMap.get(l.talhao) ?? 0) + l.toneladasDia);
        if (l.acumSafraT !== undefined) {
          const atual = acumAutoritativo.get(l.talhao);
          if (!atual || data >= atual.data) {
            acumAutoritativo.set(l.talhao, { data, valor: l.acumSafraT });
          }
        }
      }
      const porTalhao = Array.from(porTalhaoMap.entries()).map(([talhao, toneladas]) => ({
        talhao,
        toneladas: Math.round(toneladas * 100) / 100,
      }));
      const total = Math.round(porTalhao.reduce((s, p) => s + p.toneladas, 0) * 100) / 100;

      const id = `imp-${ordemAtual.id}-${data}`;
      const existente = ordemAtual.lancamentos.find((l) => l.id === id);

      if (!existente) {
        const novo: Lancamento = { id, data, toneladas: total, porTalhao, criadoEm: nowIso };
        ordemAtual.lancamentos.push(novo);
        lancamentosCriados++;
        for (const p of porTalhao) {
          if (!acumAutoritativo.has(p.talhao)) {
            incrementoNaoAutoritativo.set(p.talhao, (incrementoNaoAutoritativo.get(p.talhao) ?? 0) + p.toneladas);
          }
        }
      } else {
        const antigoPorTalhao = new Map((existente.porTalhao ?? []).map((p) => [p.talhao, p.toneladas]));
        for (const p of porTalhao) {
          const delta = p.toneladas - (antigoPorTalhao.get(p.talhao) ?? 0);
          if (delta !== 0 && !acumAutoritativo.has(p.talhao)) {
            incrementoNaoAutoritativo.set(p.talhao, (incrementoNaoAutoritativo.get(p.talhao) ?? 0) + delta);
          }
        }
        existente.toneladas = total;
        existente.porTalhao = porTalhao;
        lancamentosAtualizados++;
      }
    }

    for (const [talhao, { valor }] of acumAutoritativo) {
      const t = talhaoNoMap.get(talhao.trim().toLowerCase());
      if (t) t.acumSafraT = valor;
    }
    for (const [talhao, incremento] of incrementoNaoAutoritativo) {
      const t = talhaoNoMap.get(talhao.trim().toLowerCase());
      if (t) t.acumSafraT = Math.round((t.acumSafraT + incremento) * 100) / 100;
    }

    // "Última entrada" reflete a produção do dia mais recente presente NESTE
    // lote de importação, por talhão — não mexe em talhões não citados nessa data.
    if (maiorDataDoLote) {
      const linhasUltimoDia = porData.get(maiorDataDoLote) ?? [];
      const somaUltimoDia = new Map<string, number>();
      for (const l of linhasUltimoDia) {
        somaUltimoDia.set(l.talhao, (somaUltimoDia.get(l.talhao) ?? 0) + l.toneladasDia);
      }
      for (const [talhao, soma] of somaUltimoDia) {
        const t = talhaoNoMap.get(talhao.trim().toLowerCase());
        if (t) t.ultimaEntradaT = Math.round(soma * 100) / 100;
      }
    }

    ordemAtual.atualizadoEm = nowIso;
  }

  saveDb(db);

  return { ordensCriadas, ordensAtualizadas, talhoesCriados, lancamentosCriados, lancamentosAtualizados, avisos };
}
