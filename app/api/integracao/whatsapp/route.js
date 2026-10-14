import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { sincronizarDoBot } from "@/lib/db-import-whatsapp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Relatórios de produção lidos pelo bot do WhatsApp, mandados pelo app de disponibilidade da frota
 * (app-disponibilidade-frota, motor/agricola.py). Sem login: o cabeçalho X-Token tem de ser igual à
 * variável INTEGRACAO_TOKEN (sem ela a rota fica desligada). Fora do middleware de sessão (middleware.js).
 *
 * Corpo: {itens: [{chave, apagada?, dt, os[], opCod, atividade, categoria, equipe, frota, nEqp, nPes, vazao,
 * vazaoRec, calda, statusOs, solicitante, etapa, tipoAplicacao, observacao, talhoes[{faz, tlh, area}], avisos[],
 * grupo, remetente, msgEm, texto}]}. Resposta: {itens: [{chave, id, acao}]}.
 */
const ISO = /^\d{4}-\d{2}-\d{2}$/;

function tokenOk(req) {
  const esperado = process.env.INTEGRACAO_TOKEN ?? "";
  const veio = req.headers.get("x-token") ?? "";
  if (!esperado || veio.length !== esperado.length) return false;
  return timingSafeEqual(Buffer.from(veio), Buffer.from(esperado));
}

const txt = (v, n = 200) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Normaliza um item; null se não der para gravar. */
function item(i) {
  if (typeof i?.chave !== "string" || !i.chave || i.chave.length > 200) return null;
  if (i.apagada) return { chave: i.chave, apagada: true };
  if (!ISO.test(i.dt ?? "")) return null;
  const talhoes = (Array.isArray(i.talhoes) ? i.talhoes : [])
    .map((t) => ({ faz: txt(t?.faz, 20), tlh: txt(t?.tlh, 20), area: num(t?.area) }))
    .filter((t) => t.faz && t.area !== null && t.area > 0 && t.area < 5000);
  return {
    chave: i.chave,
    dt: i.dt,
    os: (Array.isArray(i.os) ? i.os : []).map((o) => txt(o, 20)).filter(Boolean),
    opCod: txt(i.opCod, 20),
    atividade: txt(i.atividade),
    categoria: txt(i.categoria || i.atividade, 80),
    equipe: txt(i.equipe),
    frota: txt(i.frota, 40),
    nEqp: Number.isInteger(i.nEqp) ? i.nEqp : 0,
    nPes: Number.isInteger(i.nPes) ? i.nPes : 0,
    vazao: num(i.vazao),
    vazaoRec: num(i.vazaoRec),
    calda: num(i.calda),
    statusOs: txt(i.statusOs, 40),
    solicitante: txt(i.solicitante),
    etapa: txt(i.etapa),
    tipoAplicacao: txt(i.tipoAplicacao),
    observacao: txt(i.observacao, 300),
    talhoes,
    avisos: (Array.isArray(i.avisos) ? i.avisos : []).map((a) => txt(a, 300)).filter(Boolean).slice(0, 20),
    grupo: txt(i.grupo, 80),
    remetente: txt(i.remetente, 80),
    msgEm: /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(i.msgEm ?? "") ? i.msgEm : `${i.dt} 00:00:00`,
    texto: typeof i.texto === "string" ? i.texto : "",
  };
}

export async function POST(req) {
  if (!tokenOk(req)) return NextResponse.json({ error: "Token inválido." }, { status: 401 });
  const b = await req.json().catch(() => null);
  const brutos = Array.isArray(b?.itens) ? b.itens.slice(0, 200) : [];
  const itens = brutos.map(item);
  const ruins = brutos.filter((_, k) => !itens[k]).map((i) => (typeof i?.chave === "string" ? i.chave : "?"));
  const validos = itens.filter(Boolean);
  try {
    const res = validos.length ? await sincronizarDoBot(validos) : [];
    // v: versão do contrato (3 = talhões encaixados na O.S.); o app de lá só marca como enviado com a versão que espera
    return NextResponse.json({ v: 3, itens: res, recusados: ruins });
  } catch (err) {
    console.error("[integracao/whatsapp]", err);
    return NextResponse.json({ error: String(err?.message ?? err) }, { status: 500 });
  }
}
