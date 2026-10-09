import { NextResponse } from "next/server";
import { salvarAcessosUsuario, usuarioDaRequisicao } from "@/lib/db";
import { telasDoMenu } from "@/lib/menu";
import { ehAdmin } from "@/lib/permissoes";

export const dynamic = "force-dynamic";

/** Define as telas que o usuário vê: `acessos: null` libera todas; uma lista restringe às telas listadas. */
export async function PUT(req) {
  const solicitante = await usuarioDaRequisicao(req);
  if (!solicitante || !ehAdmin(solicitante.perfil)) {
    return NextResponse.json({ error: "Só administradores alteram os Parâmetros." }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  const id = typeof body?.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ error: "Escolha o usuário." }, { status: 400 });
  let acessos = null;
  if (body?.acessos !== null) {
    if (!Array.isArray(body?.acessos)) return NextResponse.json({ error: "Lista de telas inválida." }, { status: 400 });
    const validas = new Set(telasDoMenu().map((t) => t.href));
    const lista = Array.from(new Set(body.acessos.filter((x) => typeof x === "string")));
    const desconhecidas = lista.filter((h) => !validas.has(h));
    if (desconhecidas.length > 0) return NextResponse.json({ error: `Tela desconhecida: ${desconhecidas[0]}` }, { status: 400 });
    acessos = lista;
  }
  const r = await salvarAcessosUsuario(id, acessos, solicitante.nome);
  if (r !== true) return NextResponse.json({ error: r.erro }, { status: 400 });
  return NextResponse.json({ ok: true, acessos });
}
