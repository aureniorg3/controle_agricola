import { NextResponse } from "next/server";
import { usuarioDaRequisicao } from "@/lib/db";
import { cadastroMaterialImportado, excluirDosagem, itemCadastroMaterial, listarDosagens, obterDosagem, salvarDosagem } from "@/lib/db-dosagens";
import { podeEditar } from "@/lib/permissoes";

export const dynamic = "force-dynamic";

/** Número digitado (vírgula ou ponto) ou vazio; texto que não é número vira NaN e a validação recusa. */
function numero(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return v;
  const t = String(v).trim();
  if (t === "") return null;
  return t.includes(",") ? Number(t.replace(/\./g, "").replace(",", ".")) : Number(t);
}

/** Sem parâmetros, a lista de dosagens; com `?cod=`, o insumo do cadastro (descrição e UM) e a dosagem dele, se houver. */
export async function GET(req) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario) return NextResponse.json({ error: "Sessão expirada. Entre novamente." }, { status: 401 });
  const cod = req.nextUrl.searchParams.get("cod");
  if (cod !== null) {
    const item = await itemCadastroMaterial(cod);
    return NextResponse.json({ item, dosagem: item ? await obterDosagem(item.cod) : null });
  }
  const [dosagens, cadastroImportado] = await Promise.all([listarDosagens(), cadastroMaterialImportado()]);
  return NextResponse.json({ dosagens, cadastroImportado });
}

/** Inclui ou atualiza a dosagem de um insumo (mínima e máxima por hectare). */
export async function POST(req) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario || !podeEditar(usuario.perfil)) {
    return NextResponse.json({ error: "Você não tem permissão para lançar dosagens." }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  const cod = typeof body?.cod === "string" ? body.cod : "";
  if (!cod.trim()) return NextResponse.json({ error: "Informe o código do insumo." }, { status: 400 });
  const r = await salvarDosagem(cod, numero(body?.min), numero(body?.max), usuario.nome);
  if ("erro" in r) return NextResponse.json({ error: r.erro }, { status: 400 });
  return NextResponse.json(r);
}

export async function DELETE(req) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario || !podeEditar(usuario.perfil)) {
    return NextResponse.json({ error: "Você não tem permissão para excluir dosagens." }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  const cod = typeof body?.cod === "string" ? body.cod : "";
  if (!cod.trim()) return NextResponse.json({ error: "Informe o código do insumo." }, { status: 400 });
  const r = await excluirDosagem(cod, usuario.nome);
  if (r !== true) return NextResponse.json({ error: r.erro }, { status: 404 });
  return NextResponse.json({ ok: true });
}
