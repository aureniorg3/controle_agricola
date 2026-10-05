import { NextRequest, NextResponse } from "next/server";
import { usuarioDaRequisicao } from "@/lib/db";
import { aplicarPadronizarOcorrencias, previaPadronizarOcorrencias } from "@/lib/db-rodadas";
import { podeEditar } from "@/lib/permissoes";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET: mostra o que a padronização faria (não altera nada). */
export async function GET(req: NextRequest) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario || !podeEditar(usuario.perfil)) {
    return NextResponse.json({ error: "Você não tem permissão para padronizar ocorrências." }, { status: 403 });
  }
  const r = await previaPadronizarOcorrencias();
  if ("erro" in r) return NextResponse.json({ error: r.erro }, { status: 409 });
  return NextResponse.json(r);
}

/** POST: aplica a padronização nas linhas importadas que ainda têm a ocorrência só em texto. */
export async function POST(req: NextRequest) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario || !podeEditar(usuario.perfil)) {
    return NextResponse.json({ error: "Você não tem permissão para padronizar ocorrências." }, { status: 403 });
  }
  const r = await aplicarPadronizarOcorrencias();
  if ("erro" in r) return NextResponse.json({ error: r.erro }, { status: 409 });
  return NextResponse.json({ ok: true, ...r });
}
