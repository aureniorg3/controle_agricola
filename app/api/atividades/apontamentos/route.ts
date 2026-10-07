import { NextRequest, NextResponse } from "next/server";
import { usuarioDaRequisicao } from "@/lib/db";
import { excluirApontamento, listarApontamentos, salvarApontamento } from "@/lib/db-atividades";
import type { EntradaApontamento } from "@/lib/atividades";
import { podeEditar } from "@/lib/permissoes";

export const dynamic = "force-dynamic";

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const texto = (v: unknown) => (typeof v === "string" ? v : "");
const inteiro = (v: unknown) => (typeof v === "number" ? v : Number(String(v ?? "").trim() || NaN));
const numero = (v: unknown) => {
  if (typeof v === "number") return v;
  const s = String(v ?? "").trim();
  return s.includes(",") ? Number(s.replace(/\./g, "").replace(",", ".")) : Number(s);
};

export async function GET(req: NextRequest) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario) return NextResponse.json({ error: "Sessão expirada. Entre novamente." }, { status: 401 });
  const p = req.nextUrl.searchParams;
  const de = p.get("de") ?? "";
  const ate = p.get("ate") ?? "";
  if (!ISO.test(de) || !ISO.test(ate) || de > ate) return NextResponse.json({ error: "Informe um período válido." }, { status: 400 });
  return NextResponse.json({ apontamentos: await listarApontamentos({ de, ate, os: p.get("os") ?? "" }) });
}

/** Inclui (sem id) ou altera (com id) um apontamento diário. */
export async function POST(req: NextRequest) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario || !podeEditar(usuario.perfil)) {
    return NextResponse.json({ error: "Você não tem permissão para lançar apontamentos." }, { status: 403 });
  }
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) return NextResponse.json({ error: "Requisição inválida." }, { status: 400 });
  const entrada: EntradaApontamento = {
    dt: texto(b.dt),
    os: texto(b.os),
    opCod: texto(b.opCod),
    solicitante: texto(b.solicitante),
    etapaCod: texto(b.etapaCod),
    tipoAplicacao: texto(b.tipoAplicacao),
    numEquipamentos: inteiro(b.numEquipamentos),
    numPessoas: inteiro(b.numPessoas),
    obs: texto(b.obs),
    talhoes: (Array.isArray(b.talhoes) ? (b.talhoes as Record<string, unknown>[]) : []).map((t) => ({ propCod: texto(t.propCod), tlh: texto(t.tlh), area: numero(t.area) })),
  };
  const id = b.id === undefined || b.id === null ? undefined : Number(b.id);
  const r = await salvarApontamento(entrada, usuario.nome, id);
  if ("erro" in r) return NextResponse.json({ error: r.erro }, { status: 400 });
  return NextResponse.json({ ok: true, id: r.id });
}

export async function DELETE(req: NextRequest) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario || !podeEditar(usuario.perfil)) {
    return NextResponse.json({ error: "Você não tem permissão para excluir apontamentos." }, { status: 403 });
  }
  const b = await req.json().catch(() => null);
  const id = Number(b?.id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Informe o apontamento." }, { status: 400 });
  const r = await excluirApontamento(id, usuario.nome);
  if (r !== true) return NextResponse.json({ error: r.erro }, { status: 404 });
  return NextResponse.json({ ok: true });
}
