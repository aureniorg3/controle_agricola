import { NextRequest, NextResponse } from "next/server";
import { usuarioDaRequisicao } from "@/lib/db";
import { gravarAreaColhidaDia, listarAreaColhidaDia } from "@/lib/db-area";
import { podeEditar } from "@/lib/permissoes";

export const dynamic = "force-dynamic";

const DATA = /^\d{4}-\d{2}-\d{2}$/;

/** Histórico do apontamento diário da área colhida (filtros: ordem, de, ate). */
export async function GET(req: NextRequest) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario) return NextResponse.json({ error: "Sessão expirada. Entre novamente." }, { status: 401 });
  const p = req.nextUrl.searchParams;
  const data = (v: string | null) => (v && DATA.test(v) ? v : undefined);
  const lancamentos = await listarAreaColhidaDia({ ord: p.get("ordem") || undefined, de: data(p.get("de")), ate: data(p.get("ate")) });
  return NextResponse.json({ lancamentos });
}

/** Lança ou corrige a área colhida de um dia: { ordem, dt, itens: [{ faz, tlh, ha }] } (ha 0 apaga o lançamento do dia). */
export async function POST(req: NextRequest) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario || !podeEditar(usuario.perfil)) {
    return NextResponse.json({ error: "Você não tem permissão para lançar área colhida." }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  const ordem = typeof body?.ordem === "string" ? body.ordem.trim() : "";
  const dt = typeof body?.dt === "string" ? body.dt : "";
  if (!ordem) return NextResponse.json({ error: "Informe a ordem." }, { status: 400 });
  if (!DATA.test(dt) || Number.isNaN(Date.parse(dt))) return NextResponse.json({ error: "Informe a data." }, { status: 400 });
  if (!Array.isArray(body?.itens)) return NextResponse.json({ error: "Informe a área por talhão." }, { status: 400 });
  const itens = (body.itens as Record<string, unknown>[]).slice(0, 500).map((i) => ({
    faz: String(i.faz ?? ""),
    tlh: String(i.tlh ?? ""),
    ha: typeof i.ha === "number" ? i.ha : Number(String(i.ha ?? "0").replace(",", ".")),
  }));
  if (itens.some((i) => !Number.isFinite(i.ha) || i.ha < 0)) {
    return NextResponse.json({ error: "Há área colhida que não é um número válido." }, { status: 400 });
  }
  const r = await gravarAreaColhidaDia(ordem, dt, itens, usuario.nome);
  if ("erro" in r) return NextResponse.json({ error: r.erro }, { status: 400 });
  return NextResponse.json({ ok: true, ...r });
}
