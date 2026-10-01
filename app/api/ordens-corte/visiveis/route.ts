import { NextRequest, NextResponse } from "next/server";
import { adicionarOrdemVisivel, removerOrdemVisivel, usuarioDaRequisicao } from "@/lib/db";
import { podeEditar } from "@/lib/permissoes";

async function lerNumero(req: NextRequest): Promise<string | null> {
  try {
    const body = await req.json();
    const numero = typeof body?.numero === "string" ? body.numero.trim() : "";
    return numero || null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario || !podeEditar(usuario.perfil)) {
    return NextResponse.json({ error: "Você não tem permissão para escolher ordens exibidas." }, { status: 403 });
  }
  const numero = await lerNumero(req);
  if (!numero) {
    return NextResponse.json({ error: "Informe o número da ordem." }, { status: 400 });
  }
  const resultado = await adicionarOrdemVisivel(numero);
  if (resultado !== true) {
    return NextResponse.json({ error: resultado.erro }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario || !podeEditar(usuario.perfil)) {
    return NextResponse.json({ error: "Você não tem permissão para escolher ordens exibidas." }, { status: 403 });
  }
  const numero = await lerNumero(req);
  if (!numero) {
    return NextResponse.json({ error: "Informe o número da ordem." }, { status: 400 });
  }
  await removerOrdemVisivel(numero);
  return NextResponse.json({ ok: true });
}
