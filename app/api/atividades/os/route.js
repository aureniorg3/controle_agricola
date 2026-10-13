import { NextResponse } from "next/server";
import { usuarioDaRequisicao } from "@/lib/db";
import { consultarOS, resumoBaseOS } from "@/lib/db-atividades";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `?os=` devolve a O.S. com operações e talhões (e a área já apontada); sem parâmetro, o resumo da base.
 * A base é a de Ordem de Serviço Agr. (importada em Ordem de Serviço Agr. › Ordens de Serviço).
 */
export async function GET(req) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario) return NextResponse.json({ error: "Sessão expirada. Entre novamente." }, { status: 401 });
  const os = req.nextUrl.searchParams.get("os");
  if (os === null) return NextResponse.json(await resumoBaseOS());
  const excluir = Number(req.nextUrl.searchParams.get("excluir"));
  // a área dos talhões vem da base Fazenda e Talhões da safra da data do apontamento
  const dt = req.nextUrl.searchParams.get("dt") ?? undefined;
  const r = await consultarOS(os, Number.isInteger(excluir) && excluir > 0 ? excluir : undefined, dt);
  if (!r)
    return NextResponse.json(
      { error: `O.S. ${os} não encontrada. Importe o Relatório de Ordens de Serviço atualizado em Ordem de Serviço Agr. › Ordens de Serviço.` },
      { status: 404 },
    );
  return NextResponse.json(r);
}
