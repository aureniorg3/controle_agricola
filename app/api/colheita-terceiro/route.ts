import { NextRequest, NextResponse } from "next/server";
import { entradaTerceiros, usuarioDaRequisicao } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Entrada de cana diária dos terceiros por frente, data e caminhão (somente leitura). */
export async function GET(req: NextRequest) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario) return NextResponse.json({ error: "Sessão expirada. Entre novamente." }, { status: 401 });
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  const inicio = req.nextUrl.searchParams.get("inicio") ?? "";
  const fim = req.nextUrl.searchParams.get("fim") ?? "";
  if (!iso.test(inicio) || !iso.test(fim) || inicio > fim) {
    return NextResponse.json({ error: "Informe um período válido." }, { status: 400 });
  }
  return NextResponse.json(await entradaTerceiros(inicio, fim, req.nextUrl.searchParams.get("frente") ?? ""));
}
