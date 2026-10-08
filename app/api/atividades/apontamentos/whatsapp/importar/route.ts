import { NextRequest, NextResponse } from "next/server";
import { usuarioDaRequisicao } from "@/lib/db";
import { importarWhatsapp, type DeParaOperacoes } from "@/lib/db-import-whatsapp";
import type { ApontamentoLido } from "@/lib/import-whatsapp";
import { podeEditar } from "@/lib/permissoes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Confere o que veio da prévia antes de gravar (a tela devolve os itens marcados). */
function itemValido(i: ApontamentoLido): boolean {
  return (
    typeof i?.chave === "string" &&
    i.chave.length > 0 &&
    ISO.test(i.dt) &&
    Array.isArray(i.talhoes) &&
    i.talhoes.length > 0 &&
    i.talhoes.every((t) => /^9\d{3}$/.test(String(t.faz)) && typeof t.tlh === "string" && Number.isFinite(t.area) && t.area > 0 && t.area < 5000) &&
    Array.isArray(i.os) &&
    Array.isArray(i.avisos)
  );
}

/** Grava os apontamentos marcados na prévia (os já importados ficam de fora) e lembra o de-para de operação. */
export async function POST(req: NextRequest) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario || !podeEditar(usuario.perfil)) return NextResponse.json({ error: "Você não tem permissão para importar apontamentos." }, { status: 403 });
  const b = (await req.json().catch(() => null)) as { itens?: ApontamentoLido[]; dePara?: DeParaOperacoes; atualizarOperacao?: boolean } | null;
  const itens = Array.isArray(b?.itens) ? b!.itens : [];
  if (itens.length === 0) return NextResponse.json({ error: "Marque ao menos um apontamento." }, { status: 400 });
  if (!itens.every(itemValido)) return NextResponse.json({ error: "Há apontamento com dados inválidos; gere a prévia de novo." }, { status: 400 });
  const dePara: DeParaOperacoes = {};
  for (const [k, v] of Object.entries(b?.dePara ?? {})) {
    if (typeof k === "string" && v && typeof v.cod === "string" && typeof v.ds === "string") dePara[k.slice(0, 80)] = { cod: v.cod.trim().slice(0, 20), ds: v.ds.trim().slice(0, 200) };
  }
  const nome = `${usuario.nome} ${usuario.sobrenome ?? ""}`.trim();
  return NextResponse.json(await importarWhatsapp(itens, dePara, nome, { atualizarOperacao: !!b?.atualizarOperacao }));
}
