import { NextResponse } from "next/server";
import { auditar } from "@/lib/auditar";
import { excluirSafra, getPool, usuarioDaRequisicao } from "@/lib/db";
import { podeEditar } from "@/lib/permissoes";

export async function DELETE(req) {
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
  await auditar(getPool(), {
    usuario: usuario.nome,
    modulo: "Colheita",
    entidade: "Histórico de Safras",
    chave: `Safra ${safra}`,
    acao: "exclusao",
    antes: { safra },
  });
  return NextResponse.json({ ok: true });
}
