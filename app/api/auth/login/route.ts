import { NextRequest, NextResponse } from "next/server";
import { getUsuarioPorEmail } from "@/lib/db";
import {
  criarTokenSessao,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  verificarSenha,
} from "@/lib/auth";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const senha = typeof body?.senha === "string" ? body.senha : "";

  if (!email || !senha) {
    return NextResponse.json({ erro: "Informe e-mail e senha." }, { status: 400 });
  }

  const usuario = await getUsuarioPorEmail(email);
  if (!usuario || !verificarSenha(senha, usuario.senhaHash)) {
    return NextResponse.json({ erro: "E-mail ou senha inválidos." }, { status: 401 });
  }

  const token = criarTokenSessao(usuario.id);
  const res = NextResponse.json({
    usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email, perfil: usuario.perfil },
  });
  res.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_MAX_AGE_SECONDS,
    path: "/",
  });
  return res;
}
