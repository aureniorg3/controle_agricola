import { NextRequest, NextResponse } from "next/server";
import { auditar } from "@/lib/auditar";
import {
  getPool,
  atualizarItemCadastro,
  excluirItemCadastro,
  listarCadastro,
  sincronizarDescricaoFazendas,
  upsertCadastroLote,
  usuarioDaRequisicao,
} from "@/lib/db";
import { specPorSlug, type DadosCadastro } from "@/lib/cadastros-spec";
import { atualizarReferenciasDaLista, resolverReferencias } from "@/lib/cadastros-ref";
import { podeEditar, podeIncluirCadastro } from "@/lib/permissoes";

const TAMANHO_PAGINA = 50;

type Contexto = { params: Promise<{ slug: string }> };

function dadosDoCorpo(v: unknown): DadosCadastro | null {
  if (!v || typeof v !== "object") return null;
  const dados: DadosCadastro = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === "number" && Number.isFinite(val)) dados[k] = val;
    else if (typeof val === "string") dados[k] = val.replace(/\s+/g, " ").trim();
  }
  return dados;
}

export async function GET(req: NextRequest, ctx: Contexto) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario) return NextResponse.json({ error: "Sessão expirada. Entre novamente." }, { status: 401 });
  const { slug } = await ctx.params;
  if (!specPorSlug(slug)) return NextResponse.json({ error: "Cadastro desconhecido." }, { status: 404 });

  const q = req.nextUrl.searchParams.get("q") ?? "";
  const pagina = Math.max(1, Number(req.nextUrl.searchParams.get("pg")) || 1);
  const { total, itens } = await listarCadastro(slug, q, pagina, TAMANHO_PAGINA);
  // descrições das referências lidas na hora do cadastro de origem (ex.: Operação e Classificação em Grupos de Operações)
  await atualizarReferenciasDaLista(specPorSlug(slug)!, itens);
  return NextResponse.json({ total, pagina, tamanho: TAMANHO_PAGINA, itens });
}

/** Cria um item (ou atualiza, se o código já existir). */
export async function POST(req: NextRequest, ctx: Contexto) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario || !podeEditar(usuario.perfil)) {
    return NextResponse.json({ error: "Você não tem permissão para alterar cadastros." }, { status: 403 });
  }
  const { slug } = await ctx.params;
  const spec = specPorSlug(slug);
  if (!spec) return NextResponse.json({ error: "Cadastro desconhecido." }, { status: 404 });
  const body = await req.json().catch(() => null);
  const dados = dadosDoCorpo(body?.dados);
  if (!dados) return NextResponse.json({ error: "Requisição inválida." }, { status: 400 });

  const erroRef = await resolverReferencias(spec, dados);
  if (erroRef) return NextResponse.json({ error: erroRef }, { status: 400 });
  const cod = spec.codigo(dados);
  if (!cod || cod === "|" || spec.chaves.some((k) => String(dados[k] ?? "").trim() === "")) {
    return NextResponse.json({ error: "Preencha o(s) campo(s) de código." }, { status: 400 });
  }
  const anterior = (await listarCadastro(slug, cod, 1, 50)).itens.find((i) => i.cod === cod);
  if (!anterior && !podeIncluirCadastro(usuario.perfil)) {
    return NextResponse.json({ error: "Seu perfil não inclui itens novos nos cadastros; peça a um usuário com perfil Gravação ou Administrador." }, { status: 403 });
  }
  await upsertCadastroLote(slug, [{ cod, nm: spec.nome(dados), dados }], usuario.nome);
  await auditar(getPool(), {
    usuario: usuario.nome,
    modulo: "Cadastros",
    entidade: `Cadastro de ${spec.titulo}`,
    chave: `${cod} · ${spec.nome(dados)}`,
    acao: anterior ? "alteracao" : "inclusao",
    antes: anterior?.dados,
    depois: dados,
  });
  if (slug === "fazendas") await sincronizarDescricaoFazendas();
  return NextResponse.json({ ok: true, cod });
}

/** Edita um item existente; as colunas que formam o código não mudam. */
export async function PATCH(req: NextRequest, ctx: Contexto) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario || !podeEditar(usuario.perfil)) {
    return NextResponse.json({ error: "Você não tem permissão para alterar cadastros." }, { status: 403 });
  }
  const { slug } = await ctx.params;
  const spec = specPorSlug(slug);
  if (!spec) return NextResponse.json({ error: "Cadastro desconhecido." }, { status: 404 });
  const body = await req.json().catch(() => null);
  const cod = typeof body?.cod === "string" ? body.cod : "";
  const dados = dadosDoCorpo(body?.dados);
  if (!cod || !dados) return NextResponse.json({ error: "Requisição inválida." }, { status: 400 });
  for (const k of spec.chaves) delete dados[k];

  // o nome é recalculado com o que já existe + o que mudou
  const atual = await listarCadastro(slug, cod, 1, 50);
  const existente = atual.itens.find((i) => i.cod === cod);
  if (!existente) return NextResponse.json({ error: "Item não encontrado." }, { status: 404 });
  const erroRef = await resolverReferencias(spec, dados);
  if (erroRef) return NextResponse.json({ error: erroRef }, { status: 400 });
  const nm = spec.nome({ ...existente.dados, ...dados });
  await atualizarItemCadastro(slug, cod, nm, dados, usuario.nome);
  await auditar(getPool(), {
    usuario: usuario.nome,
    modulo: "Cadastros",
    entidade: `Cadastro de ${spec.titulo}`,
    chave: `${cod} · ${nm}`,
    acao: "alteracao",
    antes: existente.dados,
    depois: { ...existente.dados, ...dados },
  });
  if (slug === "fazendas") await sincronizarDescricaoFazendas();
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: Contexto) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario || !podeEditar(usuario.perfil)) {
    return NextResponse.json({ error: "Você não tem permissão para alterar cadastros." }, { status: 403 });
  }
  const { slug } = await ctx.params;
  if (!specPorSlug(slug)) return NextResponse.json({ error: "Cadastro desconhecido." }, { status: 404 });
  const body = await req.json().catch(() => null);
  const cod = typeof body?.cod === "string" ? body.cod : "";
  if (!cod) return NextResponse.json({ error: "Informe o item." }, { status: 400 });
  const removido = (await listarCadastro(slug, cod, 1, 50)).itens.find((i) => i.cod === cod);
  await excluirItemCadastro(slug, cod);
  await auditar(getPool(), {
    usuario: usuario.nome,
    modulo: "Cadastros",
    entidade: `Cadastro de ${specPorSlug(slug)?.titulo ?? slug}`,
    chave: `${cod}${removido ? ` · ${removido.nm}` : ""}`,
    acao: "exclusao",
    antes: removido?.dados,
  });
  return NextResponse.json({ ok: true });
}
