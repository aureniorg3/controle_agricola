import { NextRequest, NextResponse } from "next/server";
import { usuarioDaRequisicao } from "@/lib/db";
import { opcoesResumoRodadas, resumoRodadas } from "@/lib/db-rodadas";

export const dynamic = "force-dynamic";

const TAMANHO = 100;
const DATA = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario) return NextResponse.json({ error: "Sessão expirada. Entre novamente." }, { status: 401 });
  const p = req.nextUrl.searchParams;
  const num = (v: string | null) => (v && /^\d+$/.test(v) ? Number(v) : undefined);
  // todos=1: todas as linhas do filtro, para exportar
  const todos = p.get("todos") === "1";
  const pagina = todos ? 1 : Math.max(1, num(p.get("pg")) ?? 1);
  const data = (k: string) => (DATA.test(p.get(k) ?? "") ? p.get(k)! : undefined);
  const resumo = await resumoRodadas(
    {
      rod: num(p.get("rod")),
      sem: num(p.get("sem")),
      reg: p.get("reg") || undefined,
      faz: p.get("faz") || undefined,
      ori: p.get("ori") || undefined,
      q: p.get("q") || undefined,
      de: data("de"),
      ate: data("ate"),
      usr: p.get("usr") || undefined,
    },
    pagina,
    todos ? 200000 : TAMANHO
  );
  const opcoes = p.get("opcoes") === "1" ? await opcoesResumoRodadas() : undefined;
  return NextResponse.json({ ...resumo, pagina, tamanho: TAMANHO, opcoes });
}
