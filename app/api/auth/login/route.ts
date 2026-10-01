import { NextRequest, NextResponse } from "next/server";
import { getUsuarioPorIdentificador } from "@/lib/db";
import {
  criarTokenSessao,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  verificarSenha,
} from "@/lib/auth";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const identificador = typeof body?.identificador === "string" ? body.identificador.trim() : "";
  const senha = typeof body?.senha === "string" ? body.senha : "";

  if (!identificador || !senha) {
    return NextResponse.json({ erro: "Informe e-mail/usuário e senha." }, { status: 400 });
  }

  const usuario = await getUsuarioPorIdentificador(identificador);
  if (!usuario || !verificarSenha(senha, usuario.senhaHash)) {
    return NextResponse.json({ erro: "E-mail/usuário ou senha inválidos." }, { status: 401 });
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
