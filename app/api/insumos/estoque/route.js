import { NextResponse } from "next/server";
import { usuarioDaRequisicao } from "@/lib/db";
import { relatorioEstoque } from "@/lib/db-estoque";

export const dynamic = "force-dynamic";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Relatório do estoque físico de insumos: `dt` (padrão: a mais recente), `emp` e `grp` (listas separadas por vírgula), `q`. */
export async function GET(req) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario) return NextResponse.json({ error: "Sessão expirada. Entre novamente." }, { status: 401 });
  const p = req.nextUrl.searchParams;
  const lista = (k) =>
    (p.get(k) ?? "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
  return NextResponse.json(
    await relatorioEstoque({
      dt: ISO.test(p.get("dt") ?? "") ? p.get("dt") : undefined,
      empresas: lista("emp")
        .map(Number)
        .filter((n) => Number.isInteger(n)),
      grupos: lista("grp"),
      q: p.get("q") ?? "",
    }),
  );
}
