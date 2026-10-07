import { NextRequest, NextResponse } from "next/server";
import { ajustarCadastro, usuarioDaRequisicao } from "@/lib/db";
import { specPorSlug } from "@/lib/cadastros-spec";
import { podeIncluirCadastro } from "@/lib/permissoes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** GET `?slug=`: prévia da correção do cadastro; POST `{ slug }`: grava (e, em Fazenda, leva a descrição para o sistema). */
async function tratar(req: NextRequest, slug: string, gravar: boolean) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario || !podeIncluirCadastro(usuario.perfil)) {
    return NextResponse.json({ error: "Só os perfis Gravação e Administrador corrigem os cadastros." }, { status: 403 });
  }
  const spec = specPorSlug(slug);
  if (!spec?.ajuste) return NextResponse.json({ error: "Este cadastro não tem correção automática." }, { status: 404 });
  return NextResponse.json(await ajustarCadastro(spec, gravar, usuario.nome));
}

export async function GET(req: NextRequest) {
  return tratar(req, req.nextUrl.searchParams.get("slug") ?? "", false);
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  return tratar(req, typeof body?.slug === "string" ? body.slug : "", true);
}
