import { NextResponse } from "next/server";
import { usuarioDaRequisicao } from "@/lib/db";
import { listarOrdensOS, opcoesOS, painelOS, talhoesDaOS } from "@/lib/db-os-agr";
import { round2 } from "@/lib/os-agr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TAMANHO = 100;
const DATA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `?opcoes=1` listas dos filtros; `?painel=1` o Dashboard; `?talhoes=1&emp=&os=` os talhões de uma O.S.;
 * sem esses, a lista de O.S. paginada (`pg`) ou inteira (`todos=1`, para exportar).
 */
export async function GET(req) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario) return NextResponse.json({ error: "Sessão expirada. Entre novamente." }, { status: 401 });
  const p = req.nextUrl.searchParams;
  if (p.get("opcoes") === "1") return NextResponse.json(await opcoesOS());
  if (p.get("talhoes") === "1") return NextResponse.json({ talhoes: await talhoesDaOS(p.get("emp") ?? "", p.get("os") ?? "") });

  const s = (k) => (p.get(k) ?? "").trim() || undefined;
  const f = {
    de: DATA.test(p.get("de") ?? "") ? p.get("de") : undefined,
    ate: DATA.test(p.get("ate") ?? "") ? p.get("ate") : undefined,
    safra: s("safra"),
    resp: s("resp"),
    etapa: s("etapa"),
    op: s("op"),
    posicao: ["A", "L", "E", "aberto"].includes(p.get("posicao") ?? "") ? p.get("posicao") : undefined,
    q: s("q"),
  };
  if (p.get("painel") === "1") return NextResponse.json(await painelOS(f));

  const lista = await listarOrdensOS({ ...f, faixa: s("faixa"), atrasadas: p.get("atrasadas") === "1" });
  const totais = {
    ordens: lista.length,
    abertas: lista.filter((o) => o.posicao !== "E").length,
    atrasadas: lista.filter((o) => o.atrasada).length,
    areaRec: round2(lista.reduce((a, o) => a + o.areaRec, 0)),
    talhoes: lista.reduce((a, o) => a + o.nTlh, 0),
  };
  if (p.get("todos") === "1") return NextResponse.json({ ordens: lista, totais });
  const pagina = Math.max(1, Number(p.get("pg")) || 1);
  return NextResponse.json({ ordens: lista.slice((pagina - 1) * TAMANHO, pagina * TAMANHO), totais, pagina, tamanho: TAMANHO });
}
