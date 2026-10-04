import { NextRequest, NextResponse } from "next/server";
import { usuarioDaRequisicao } from "@/lib/db";
import { executarValidacoes } from "@/lib/validacoes";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Roda todas as verificações de consistência e devolve as divergências encontradas (somente leitura). */
export async function GET(req: NextRequest) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario) return NextResponse.json({ error: "Sessão expirada. Entre novamente." }, { status: 401 });
  return NextResponse.json(await executarValidacoes());
}
