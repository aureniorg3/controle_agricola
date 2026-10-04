import { NextRequest, NextResponse } from "next/server";
import { usuarioDaRequisicao } from "@/lib/db";
import { opcoesResumoRodadas, resumoRodadas } from "@/lib/db-rodadas";

export const dynamic = "force-dynamic";

const TAMANHO = 100;

export async function GET(req: NextRequest) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario) return NextResponse.json({ error: "Sessão expirada. Entre novamente." }, { status: 401 });
  const p = req.nextUrl.searchParams;
  const num = (v: string | null) => (v && /^\d+$/.test(v) ? Number(v) : undefined);
  const pagina = Math.max(1, num(p.get("pg")) ?? 1);
  const resumo = await resumoRodadas(
    { rod: num(p.get("rod")), sem: num(p.get("sem")), reg: p.get("reg") || undefined, faz: p.get("faz") || undefined, ori: p.get("ori") || undefined, q: p.get("q") || undefined },
    pagina,
    TAMANHO
  );
  const opcoes = p.get("opcoes") === "1" ? await opcoesResumoRodadas() : undefined;
  return NextResponse.json({ ...resumo, pagina, tamanho: TAMANHO, opcoes });
}
