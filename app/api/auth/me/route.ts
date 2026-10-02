import { NextRequest, NextResponse } from "next/server";
import { getUsuarioPorId } from "@/lib/db";
import { SESSION_COOKIE_NAME, verificarTokenSessao } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  const uid = verificarTokenSessao(token);
  const usuario = uid ? await getUsuarioPorId(uid) : undefined;

  if (!usuario || !usuario.ativo) {
    return NextResponse.json({ usuario: null });
  }

  return NextResponse.json({
    usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email, perfil: usuario.perfil },
  });
}
