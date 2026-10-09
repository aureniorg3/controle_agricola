import { NextResponse } from "next/server";
import { usuarioDaRequisicao } from "@/lib/db";
import { dashboardAtividades } from "@/lib/db-dashboard-atividades";

export const dynamic = "force-dynamic";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Dashboard das atividades na data `dt` (padrão: último dia com apontamento ou entrada de cana). */
export async function GET(req) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario) return NextResponse.json({ error: "Sessão expirada. Entre novamente." }, { status: 401 });
  const dt = req.nextUrl.searchParams.get("dt") ?? "";
  return NextResponse.json(await dashboardAtividades(ISO.test(dt) ? dt : undefined));
}
