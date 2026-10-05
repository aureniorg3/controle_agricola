import { NextRequest, NextResponse } from "next/server";
import { salvarCorrecaoConferencia, usuarioDaRequisicao } from "@/lib/db";
import { podeEditar } from "@/lib/permissoes";

const DATA_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export async function PATCH(req: NextRequest) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario || !podeEditar(usuario.perfil)) {
    return NextResponse.json({ error: "Você não tem permissão para lançar correções." }, { status: 403 });
  }
  let body: { data?: unknown; eqp?: unknown; frente?: unknown; fazendaCodigo?: unknown; frenteCorreta?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Requisição inválida." }, { status: 400 });
  }
  const data = typeof body.data === "string" ? body.data : "";
  const eqp = typeof body.eqp === "string" ? body.eqp : "";
  const frente = typeof body.frente === "string" ? body.frente : "";
  const fazendaCodigo = typeof body.fazendaCodigo === "string" ? body.fazendaCodigo : "";
  const corrigida = typeof body.frenteCorreta === "string" ? body.frenteCorreta.trim() : "";
  if (!DATA_REGEX.test(data) || !eqp || !frente || !fazendaCodigo) {
    return NextResponse.json({ error: "Linha da conferência inválida." }, { status: 400 });
  }
  const ok = await salvarCorrecaoConferencia(data, eqp, frente, fazendaCodigo, corrigida || null, usuario.nome);
  if (!ok) return NextResponse.json({ error: "Linha não encontrada (reimporte o arquivo?)." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
