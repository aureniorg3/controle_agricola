import { NextRequest, NextResponse } from "next/server";
import { usuarioDaRequisicao } from "@/lib/db";
import { criarRodada, excluirRodada, listarRodadasCad } from "@/lib/db-rodadas";
import { gerarSemanas } from "@/lib/rodadas";
import { podeEditar } from "@/lib/permissoes";

export const dynamic = "force-dynamic";

const DATA = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario) return NextResponse.json({ error: "Sessão expirada. Entre novamente." }, { status: 401 });
  return NextResponse.json({ rodadas: await listarRodadasCad() });
}

/** Cria a rodada: número + data de início (a semana 1 começa na segunda-feira dessa data). */
export async function POST(req: NextRequest) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario || !podeEditar(usuario.perfil)) {
    return NextResponse.json({ error: "Você não tem permissão para cadastrar rodadas." }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  const rod = Number(body?.rod);
  const inicio = typeof body?.inicio === "string" ? body.inicio : "";
  if (!Number.isInteger(rod) || rod <= 0) return NextResponse.json({ error: "Informe o número da rodada." }, { status: 400 });
  if (!DATA.test(inicio) || Number.isNaN(Date.parse(inicio))) {
    return NextResponse.json({ error: "Informe a data de início da rodada." }, { status: 400 });
  }
  const r = await criarRodada(rod, inicio);
  if (r !== true) return NextResponse.json({ error: r.erro }, { status: 409 });
  return NextResponse.json({ ok: true, semanas: gerarSemanas(inicio) });
}

export async function DELETE(req: NextRequest) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario || !podeEditar(usuario.perfil)) {
    return NextResponse.json({ error: "Você não tem permissão para excluir rodadas." }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  const rod = Number(body?.rod);
  if (!Number.isInteger(rod)) return NextResponse.json({ error: "Informe a rodada." }, { status: 400 });
  const r = await excluirRodada(rod);
  if (r !== true) return NextResponse.json({ error: r.erro }, { status: 409 });
  return NextResponse.json({ ok: true });
}
