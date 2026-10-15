import { NextResponse } from "next/server";
import { salvarAcessosUsuario, usuarioDaRequisicao } from "@/lib/db";
import { MARCA_ACESSOS, telasDoMenu } from "@/lib/menu";
import { ehAdmin } from "@/lib/permissoes";

export const dynamic = "force-dynamic";

/**
 * Define as telas que o usuário vê: `acessos: null` libera todas; uma lista restringe às telas listadas (o Início
 * também é uma delas: "/painel"). Parâmetros → Usuários manda a lista com a marca de versão (MARCA_ACESSOS,
 * lib/menu.js) na frente e ela é gravada assim: o Início fora dela vale como desmarcado. Lista sem a marca (tela de
 * Parâmetros aberta antes de o Início ser marcável, que nem o mostra) é gravada como antes, sem a marca, e o Início
 * continua liberado — senão o usuário o perderia sem ninguém o ter desmarcado.
 */
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
    const formatoNovo = body.acessos.includes(MARCA_ACESSOS);
    // a marca sai daqui e, no formato novo, volta na frente abaixo
    const lista = Array.from(new Set(body.acessos.filter((x) => typeof x === "string" && x !== MARCA_ACESSOS)));
    const desconhecidas = lista.filter((h) => !validas.has(h));
    if (desconhecidas.length > 0) return NextResponse.json({ error: `Tela desconhecida: ${desconhecidas[0]}` }, { status: 400 });
    // vazia no formato novo é nenhuma tela; na antiga ainda sobra o Início (como antes)
    if (formatoNovo && lista.length === 0) return NextResponse.json({ error: "Marque ao menos uma tela." }, { status: 400 });
    acessos = formatoNovo ? [MARCA_ACESSOS, ...lista] : lista;
  }
  const r = await salvarAcessosUsuario(id, acessos, solicitante.nome);
  if (r !== true) return NextResponse.json({ error: r.erro }, { status: 400 });
  return NextResponse.json({ ok: true, acessos });
}
