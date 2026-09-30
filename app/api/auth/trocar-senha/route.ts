import { NextRequest, NextResponse } from "next/server";
import { trocarSenhaPrimeiroAcesso, usuarioDaRequisicao } from "@/lib/db";

export async function POST(req: NextRequest) {
  const usuario = usuarioDaRequisicao(req);
  if (!usuario) {
    return NextResponse.json({ error: "Sessão expirada — faça login de novo." }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const novaSenha = typeof body?.novaSenha === "string" ? body.novaSenha : "";
  if (novaSenha.length < 6) {
    return NextResponse.json({ error: "A nova senha precisa ter ao menos 6 caracteres." }, { status: 400 });
  }

  const resultado = trocarSenhaPrimeiroAcesso(usuario.id, novaSenha);
  if (resultado !== true) {
    return NextResponse.json({ error: resultado.erro }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}
