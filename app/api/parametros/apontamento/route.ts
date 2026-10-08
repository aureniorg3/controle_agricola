import { NextRequest, NextResponse } from "next/server";
import { usuarioDaRequisicao } from "@/lib/db";
import { regrasApontamento, salvarRegrasApontamento } from "@/lib/db-atividades";
import { normalizarRegras } from "@/lib/atividades";
import { ehAdmin } from "@/lib/permissoes";

export const dynamic = "force-dynamic";

/** Campos obrigatórios do Apontamento Diário: qualquer usuário lê; só o administrador altera. */
export async function GET(req: NextRequest) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario) return NextResponse.json({ error: "Sessão expirada. Entre novamente." }, { status: 401 });
  return NextResponse.json({ regras: await regrasApontamento() });
}

export async function PUT(req: NextRequest) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario || !ehAdmin(usuario.perfil)) return NextResponse.json({ error: "Só o administrador altera os Parâmetros." }, { status: 403 });
  const b = await req.json().catch(() => null);
  return NextResponse.json({ regras: await salvarRegrasApontamento(normalizarRegras(b?.regras), usuario.nome) });
}
