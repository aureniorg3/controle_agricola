import { NextResponse } from "next/server";
import { usuarioDaRequisicao } from "@/lib/db";
import { analiseApontamentos } from "@/lib/db-analise-apontamentos";

export const dynamic = "force-dynamic";

/** Análise dos Apontamentos Diários: as O.S. em aberto com os apontamentos lançados nelas e os alertas de cada uma. */
export async function GET(req) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario) return NextResponse.json({ error: "Sessão expirada. Entre novamente." }, { status: 401 });
  return NextResponse.json(await analiseApontamentos());
}
