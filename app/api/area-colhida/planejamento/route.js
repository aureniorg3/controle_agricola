import { NextResponse } from "next/server";
import { usuarioDaRequisicao } from "@/lib/db";
import { conferirPlanejamento, lancarPlanejamento } from "@/lib/db-planejamento-corte";
import { podeEditar } from "@/lib/permissoes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Mensagem "Planejamento Ordem de Cortes" do WhatsApp: { texto, dt?, base: "saldo" | "area", lancar?: [ordens] }.
 * Sem `lancar`, só a conferência; com `lancar`, grava a área colhida das ordens escolhidas (um boletim por ordem).
 */
export async function POST(req) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario) return NextResponse.json({ error: "Sessão expirada. Entre novamente." }, { status: 401 });
  const body = await req.json().catch(() => null);
  const texto = typeof body?.texto === "string" ? body.texto.slice(0, 50000) : "";
  if (!texto.trim()) return NextResponse.json({ error: "Cole a mensagem do WhatsApp." }, { status: 400 });
  const dt = typeof body?.dt === "string" ? body.dt : undefined;
  const base = body?.base === "area" ? "area" : "saldo";
  if (Array.isArray(body?.lancar)) {
    if (!podeEditar(usuario.perfil)) return NextResponse.json({ error: "Você não tem permissão para lançar área colhida." }, { status: 403 });
    const r = await lancarPlanejamento(
      texto,
      dt,
      base,
      body.lancar.map((n) => String(n)),
      usuario.nome,
    );
    if (r.erro) return NextResponse.json({ error: r.erro }, { status: 400 });
    return NextResponse.json(r);
  }
  const r = await conferirPlanejamento(texto, dt, base);
  if (r.erro) return NextResponse.json({ error: r.erro }, { status: 400 });
  return NextResponse.json(r);
}
