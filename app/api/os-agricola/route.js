import { NextResponse } from "next/server";
import { usuarioDaRequisicao } from "@/lib/db";
import { listarOrdensOS, opcoesOS, painelOS, talhoesDaOS } from "@/lib/db-os-agr";
import { round2 } from "@/lib/os-agr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TAMANHO = 100;
const DATA = /^\d{4}-\d{2}-\d{2}$/;
// operações e fazendas do filtro: códigos curtos (letras, dígitos, espaço, . _ / -), no máximo LIMITE_LISTA por filtro
// (o mesmo limite da tela)
const CODIGO = /^[\p{L}\p{N} ._\/-]{1,30}$/u;
const LIMITE_LISTA = 300;

/**
 * `?opcoes=1` listas dos filtros; `?painel=1` o Dashboard; `?talhoes=1&emp=&os=` os talhões de uma O.S.;
 * sem esses, a lista de O.S. paginada (`pg`) ou inteira (`todos=1`, para exportar). Operação e fazenda aceitam
 * vários códigos: `op=14330,14340&faz=9411,9001` (ou o parâmetro repetido).
 */
export async function GET(req) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario) return NextResponse.json({ error: "Sessão expirada. Entre novamente." }, { status: 401 });
  const p = req.nextUrl.searchParams;
  if (p.get("opcoes") === "1") return NextResponse.json(await opcoesOS());
  if (p.get("talhoes") === "1") return NextResponse.json({ talhoes: await talhoesDaOS(p.get("emp") ?? "", p.get("os") ?? "") });

  const s = (k) => (p.get(k) ?? "").trim() || undefined;
  const codigos = (k) => {
    const v = [...new Set(p.getAll(k).flatMap((x) => x.split(",")).map((x) => x.trim()))].filter((x) => CODIGO.test(x));
    return v.length ? v.slice(0, LIMITE_LISTA) : undefined;
  };
  const f = {
    de: DATA.test(p.get("de") ?? "") ? p.get("de") : undefined,
    ate: DATA.test(p.get("ate") ?? "") ? p.get("ate") : undefined,
    safra: s("safra"),
    resp: s("resp"),
    etapa: s("etapa"),
    op: codigos("op"),
    faz: codigos("faz"),
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
