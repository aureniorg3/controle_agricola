import { NextResponse } from "next/server";
import { usuarioDaRequisicao } from "@/lib/db";
import { listarGruposOperacoes, salvarGrupoOperacao } from "@/lib/db-dashboard-atividades";
import { podeEditar } from "@/lib/permissoes";

export const dynamic = "force-dynamic";

/** Grupo de cada operação no Dashboard de Atividades. */
export async function GET(req) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario) return NextResponse.json({ error: "Sessão expirada. Entre novamente." }, { status: 401 });
  return NextResponse.json(await listarGruposOperacoes());
}

/** Altera o grupo de uma operação: `{ cod, grupo }`, com o código do grupo no cadastro Grupo Op. Dashboard (vazio = Outras operações). */
export async function PUT(req) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario || !podeEditar(usuario.perfil)) return NextResponse.json({ error: "Você não tem permissão para alterar os grupos." }, { status: 403 });
  const b = await req.json().catch(() => null);
  const cod = typeof b?.cod === "string" ? b.cod.trim() : "";
  const grupo = typeof b?.grupo === "string" ? b.grupo.trim().slice(0, 20) : "";
  if (!cod) return NextResponse.json({ error: "Informe a operação." }, { status: 400 });
  const erro = await salvarGrupoOperacao(cod, grupo, usuario.nome);
  if (erro) return NextResponse.json({ error: erro.erro }, { status: 400 });
  return NextResponse.json(await listarGruposOperacoes());
}
