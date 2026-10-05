import { NextRequest, NextResponse } from "next/server";
import { usuarioDaRequisicao } from "@/lib/db";
import { buscarMateriais, itemMaterial } from "@/lib/db-insumos";

export const dynamic = "force-dynamic";

/** `?cod=` devolve o item do cadastro (descrição, UM) com o preço médio do saldo; `?q=` busca por código ou nome. */
export async function GET(req: NextRequest) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario) return NextResponse.json({ error: "Sessão expirada. Entre novamente." }, { status: 401 });
  const cod = req.nextUrl.searchParams.get("cod");
  if (cod !== null) return NextResponse.json({ item: cod.trim() ? await itemMaterial(cod) : null });
  return NextResponse.json({ itens: await buscarMateriais(req.nextUrl.searchParams.get("q") ?? "") });
}
