import { NextResponse } from "next/server";
import { usuarioDaRequisicao } from "@/lib/db";
import { listarTalhoes, opcoesTalhoes } from "@/lib/db-talhoes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** `?opcoes=1`: safras importadas e ocupações; `?saf=2026`: todas as partes da safra (campos + linhas). */
export async function GET(req) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario) return NextResponse.json({ error: "Sessão expirada. Entre novamente." }, { status: 401 });
  if (req.nextUrl.searchParams.get("opcoes")) return NextResponse.json(await opcoesTalhoes());
  const saf = Number(req.nextUrl.searchParams.get("saf"));
  if (!Number.isInteger(saf) || saf < 2000 || saf > 2100) return NextResponse.json({ error: "Informe a safra (ano)." }, { status: 400 });
  return NextResponse.json(await listarTalhoes(saf));
}
