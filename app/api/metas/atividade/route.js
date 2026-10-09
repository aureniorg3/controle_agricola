import { NextResponse } from "next/server";
import { listAtividadesFrentes, salvarAtividadeFrente, usuarioDaRequisicao } from "@/lib/db";
import { podeEditar } from "@/lib/permissoes";

export const dynamic = "force-dynamic";

const DATA = /^\d{4}-\d{2}-\d{2}$/;

/** Início e fim de atividade das frentes. */
export async function GET(req) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario) return NextResponse.json({ error: "Sessão expirada. Entre novamente." }, { status: 401 });
  return NextResponse.json({ atividades: await listAtividadesFrentes() });
}

/** Grava `{ frente, inicio, fim }` (datas AAAA-MM-DD ou vazias; fim vazio = frente ativa). */
export async function PUT(req) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario || !podeEditar(usuario.perfil))
    return NextResponse.json({ error: "Você não tem permissão para alterar a atividade das frentes." }, { status: 403 });
  const b = await req.json().catch(() => null);
  const frente = typeof b?.frente === "string" ? b.frente.trim() : "";
  const data = (v) => (typeof v === "string" && DATA.test(v) && !Number.isNaN(Date.parse(v)) ? v : null);
  if (!frente) return NextResponse.json({ error: "Informe a frente." }, { status: 400 });
  if ((b?.inicio && !data(b.inicio)) || (b?.fim && !data(b.fim))) return NextResponse.json({ error: "Data inválida." }, { status: 400 });
  const r = await salvarAtividadeFrente(frente, data(b?.inicio), data(b?.fim), usuario.nome);
  if (r !== true) return NextResponse.json({ error: r.erro }, { status: 400 });
  return NextResponse.json({ atividades: await listAtividadesFrentes() });
}
