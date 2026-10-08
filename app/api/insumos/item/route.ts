import { NextRequest, NextResponse } from "next/server";
import { usuarioDaRequisicao } from "@/lib/db";
import { obterDosagem } from "@/lib/db-dosagens";
import { buscarMateriais, itemMaterial } from "@/lib/db-insumos";

export const dynamic = "force-dynamic";

/** `?cod=` devolve o item do cadastro (descrição, UM) com o preço médio do saldo; `?q=` busca por código ou nome. */
export async function GET(req: NextRequest) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario) return NextResponse.json({ error: "Sessão expirada. Entre novamente." }, { status: 401 });
  const cod = req.nextUrl.searchParams.get("cod");
  if (cod !== null) {
    if (!cod.trim()) return NextResponse.json({ item: null, dose: null });
    const [item, dosagem] = await Promise.all([itemMaterial(cod), obterDosagem(cod).catch(() => null)]);
    return NextResponse.json({ item, dose: dosagem?.max ?? null });
  }
  return NextResponse.json({ itens: await buscarMateriais(req.nextUrl.searchParams.get("q") ?? "") });
}
