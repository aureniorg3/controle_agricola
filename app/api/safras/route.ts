import { NextRequest, NextResponse } from "next/server";
import { excluirSafra, usuarioDaRequisicao } from "@/lib/db";
import { podeEditar } from "@/lib/permissoes";

export async function DELETE(req: NextRequest) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario || !podeEditar(usuario.perfil)) {
    return NextResponse.json({ error: "Você não tem permissão para excluir safras." }, { status: 403 });
  }
  let safra = NaN;
  try {
    const body = await req.json();
    safra = Number(body?.safra);
  } catch {
    safra = NaN;
  }
  if (!Number.isInteger(safra)) return NextResponse.json({ error: "Informe a safra." }, { status: 400 });
  await excluirSafra(safra);
  return NextResponse.json({ ok: true });
}
