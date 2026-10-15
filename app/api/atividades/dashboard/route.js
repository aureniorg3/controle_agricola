import { NextResponse } from "next/server";
import { usuarioDaRequisicao } from "@/lib/db";
import { dashboardAtividades, detalheDashboardAtividades, PERIODOS_DETALHE } from "@/lib/db-dashboard-atividades";

export const dynamic = "force-dynamic";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Dashboard das atividades na data `dt` (padrão: último dia com apontamento ou entrada de cana). Com `detalhe`
 * (moagem | operacoes) e `periodo` (dia | semana | mes | safra), o detalhe de um card (a janela da caixa).
 */
export async function GET(req) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario) return NextResponse.json({ error: "Sessão expirada. Entre novamente." }, { status: 401 });
  const dt = req.nextUrl.searchParams.get("dt") ?? "";
  const detalhe = req.nextUrl.searchParams.get("detalhe");
  if (detalhe) {
    const periodo = req.nextUrl.searchParams.get("periodo") ?? "";
    if (!["moagem", "operacoes"].includes(detalhe) || !PERIODOS_DETALHE.includes(periodo)) {
      return NextResponse.json({ error: "Detalhe ou período inválido." }, { status: 400 });
    }
    return NextResponse.json(await detalheDashboardAtividades(ISO.test(dt) ? dt : undefined, detalhe, periodo));
  }
  return NextResponse.json(await dashboardAtividades(ISO.test(dt) ? dt : undefined));
}
