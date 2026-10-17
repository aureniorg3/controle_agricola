import { NextResponse } from "next/server";
import { auditar } from "@/lib/auditar";
import {
  getPool,
  alterarSituacaoItemCadastro,
  atualizarItemCadastro,
  excluirItemCadastro,
  listarCadastro,
  obterItemCadastro,
  sincronizarDescricaoFazendas,
  upsertCadastroLote,
  usuarioDaRequisicao,
} from "@/lib/db";
import { specPorSlug, validarDadosCadastro } from "@/lib/cadastros-spec";
import { atualizarReferenciasDaLista, resolverReferencias, separarNomesRepetidos } from "@/lib/cadastros-ref";
import { filtroDaAba, FILTROS_ABA } from "@/lib/cadastros-abas";
import { operacoesDoGrupo, sincronizarGruposOperacoes } from "@/lib/db-dashboard-atividades";
import { podeEditar, podeIncluirCadastro } from "@/lib/permissoes";

const TAMANHO_PAGINA = 50;
/** Máximo de linhas na exportação (todas as do filtro de uma vez, sem paginar). */
const LIMITE_EXPORTACAO = 30000;
const SITUACOES = new Set(["ativos", "inativos", "todos"]);
/** Como a situação vai para o Log de Alterações. */
const rotuloSituacao = (ativo) => (ativo ? "Ativo" : "Inativo");

function dadosDoCorpo(v) {
  if (!v || typeof v !== "object") return null;
  const dados = {};
  for (const [k, val] of Object.entries(v)) {
    if (typeof val === "number" && Number.isFinite(val)) dados[k] = val;
    else if (typeof val === "string") dados[k] = val.replace(/\s+/g, " ").trim();
  }
  return dados;
}

export async function GET(req, ctx) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario) return NextResponse.json({ error: "Sessão expirada. Entre novamente." }, { status: 401 });
  const { slug } = await ctx.params;
  const spec = specPorSlug(slug);
  if (!spec) return NextResponse.json({ error: "Cadastro desconhecido." }, { status: 404 });

  const sp = req.nextUrl.searchParams;
  const q = sp.get("q") ?? "";
  const pagina = Math.max(1, Number(sp.get("pg")) || 1);
  const aba = sp.get("aba");
  // situação: "ativos" nas listas de escolha (ex.: seletor F4 das Rodadas, sugestões das referências), "inativos" ou "todos" (padrão)
  const situacao = SITUACOES.has(sp.get("situacao")) ? sp.get("situacao") : "todos";
  // exportação: todas as linhas do filtro (até o limite), sem paginar e sem a contagem das abas
  if (sp.get("exportar") !== null) {
    const { total, itens } = await listarCadastro(slug, q, 1, LIMITE_EXPORTACAO, filtroDaAba(slug, aba), situacao, spec.ordenarPor);
    await atualizarReferenciasDaLista(specPorSlug(slug), itens);
    return NextResponse.json({ total, itens, limite: LIMITE_EXPORTACAO });
  }
  const { total, itens } = await listarCadastro(slug, q, pagina, TAMANHO_PAGINA, filtroDaAba(slug, aba), situacao, spec.ordenarPor);
  // quantos itens cada aba tem (com a mesma busca e situação), para mostrar no título das abas
  const abas = FILTROS_ABA[slug]
    ? Object.fromEntries(
        await Promise.all(Object.entries(FILTROS_ABA[slug]).map(async ([id, f]) => [id, (await listarCadastro(slug, q, 1, 1, f, situacao)).total])),
      )
    : undefined;
  // descrições das referências lidas na hora do cadastro de origem (ex.: Operação e Classificação em Grupos de Operações)
  await atualizarReferenciasDaLista(specPorSlug(slug), itens);
  return NextResponse.json({ total, pagina, tamanho: TAMANHO_PAGINA, itens, abas });
}

/**
 * Cria um item (ou atualiza, se o código já existir). `ativo` (opcional) é a situação escolhida na janela: sem ela, o
 * item novo entra ativo e o que já existe fica com a situação que tem.
 */
export async function POST(req, ctx) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario || !podeEditar(usuario.perfil)) {
    return NextResponse.json({ error: "Você não tem permissão para alterar cadastros." }, { status: 403 });
  }
  const { slug } = await ctx.params;
  const spec = specPorSlug(slug);
  if (!spec) return NextResponse.json({ error: "Cadastro desconhecido." }, { status: 404 });
  const body = await req.json().catch(() => null);
  const lido = dadosDoCorpo(body?.dados);
  if (!lido) return NextResponse.json({ error: "Requisição inválida." }, { status: 400 });
  const ativo = typeof body?.ativo === "boolean" ? body.ativo : undefined;
  const conferido = validarDadosCadastro(spec, lido);
  if (conferido.erro) return NextResponse.json({ error: conferido.erro }, { status: 400 });
  const dados = conferido.dados;

  const erroRef = await resolverReferencias(spec, dados);
  if (erroRef) return NextResponse.json({ error: erroRef }, { status: 400 });
  const cod = spec.codigo(dados);
  if (!cod || cod === "|" || spec.chaves.some((k) => String(dados[k] ?? "").trim() === "")) {
    return NextResponse.json({ error: "Preencha o(s) campo(s) de código." }, { status: 400 });
  }
  // nome que já está em outro código (ex.: o mesmo grupo com outra grafia no Grupo Op. Dashboard)
  const [nomeRecusado] = (await separarNomesRepetidos(spec, [{ cod, nm: spec.nome(dados) }])).recusados;
  if (nomeRecusado) return NextResponse.json({ error: `${spec.titulo}: ${nomeRecusado.erro}` }, { status: 400 });
  const anterior = await obterItemCadastro(slug, cod);
  if (!anterior && !podeIncluirCadastro(usuario.perfil)) {
    return NextResponse.json(
      { error: "Seu perfil não inclui itens novos nos cadastros; peça a um usuário com perfil Gravação ou Administrador." },
      { status: 403 },
    );
  }
  await upsertCadastroLote(slug, [{ cod, nm: spec.nome(dados), dados }], usuario.nome);
  // item novo entra ativo (padrão da coluna); a situação só muda se a escolhida for outra
  const mudaSituacao = ativo !== undefined && ativo !== (anterior ? anterior.ativo : true);
  if (mudaSituacao) await alterarSituacaoItemCadastro(slug, cod, ativo, usuario.nome);
  await auditar(getPool(), {
    usuario: usuario.nome,
    modulo: "Cadastros",
    entidade: `Cadastro de ${spec.titulo}`,
    chave: `${cod} · ${spec.nome(dados)}`,
    acao: anterior ? "alteracao" : "inclusao",
    antes: anterior && { ...anterior.dados, ...(mudaSituacao ? { situacao: rotuloSituacao(anterior.ativo) } : {}) },
    depois: { ...dados, ...(mudaSituacao ? { situacao: rotuloSituacao(ativo) } : {}) },
  });
  if (slug === "fazendas") await sincronizarDescricaoFazendas();
  if (slug === "grupos-dashboard") await sincronizarGruposOperacoes();
  return NextResponse.json({ ok: true, cod });
}

/**
 * Edita um item existente; as colunas que formam o código não mudam. `ativo` (true/false) muda a situação do item:
 * sozinho (`{ cod, ativo }`, botão Ativar/Inativar da linha) ou junto com os campos (edição na linha).
 */
export async function PATCH(req, ctx) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario || !podeEditar(usuario.perfil)) {
    return NextResponse.json({ error: "Você não tem permissão para alterar cadastros." }, { status: 403 });
  }
  const { slug } = await ctx.params;
  const spec = specPorSlug(slug);
  if (!spec) return NextResponse.json({ error: "Cadastro desconhecido." }, { status: 404 });
  const body = await req.json().catch(() => null);
  const cod = typeof body?.cod === "string" ? body.cod : "";
  const ativo = typeof body?.ativo === "boolean" ? body.ativo : undefined;
  // só a situação: nenhum campo muda
  const dados = body?.dados === undefined && ativo !== undefined ? {} : dadosDoCorpo(body?.dados);
  if (!cod || !dados) return NextResponse.json({ error: "Requisição inválida." }, { status: 400 });
  for (const k of spec.chaves) delete dados[k];

  // o item pelo código exato; o nome é recalculado com o que já existe + o que mudou
  const existente = await obterItemCadastro(slug, cod);
  if (!existente) return NextResponse.json({ error: "Item não encontrado." }, { status: 404 });
  const mudaDados = Object.keys(dados).length > 0;
  let nm = existente.nm;
  if (mudaDados) {
    // a conferência vale para o item inteiro (o que já existe + o que mudou); grava os campos alterados já normalizados
    const conferido = validarDadosCadastro(spec, { ...existente.dados, ...dados });
    if (conferido.erro) return NextResponse.json({ error: conferido.erro }, { status: 400 });
    for (const k of Object.keys(dados)) dados[k] = conferido.dados[k];
    const erroRef = await resolverReferencias(spec, dados);
    if (erroRef) return NextResponse.json({ error: erroRef }, { status: 400 });
    nm = spec.nome({ ...existente.dados, ...dados });
    const [nomeRecusado] = (await separarNomesRepetidos(spec, [{ cod, nm }])).recusados;
    if (nomeRecusado) return NextResponse.json({ error: `${spec.titulo}: ${nomeRecusado.erro}` }, { status: 400 });
  }
  const mudaSituacao = ativo !== undefined && ativo !== existente.ativo;
  if (!mudaDados && !mudaSituacao) return NextResponse.json({ ok: true });
  if (mudaDados) await atualizarItemCadastro(slug, cod, nm, dados, usuario.nome);
  if (mudaSituacao) await alterarSituacaoItemCadastro(slug, cod, ativo, usuario.nome);
  await auditar(getPool(), {
    usuario: usuario.nome,
    modulo: "Cadastros",
    entidade: `Cadastro de ${spec.titulo}`,
    chave: `${cod} · ${nm}`,
    acao: "alteracao",
    antes: { ...(mudaDados ? existente.dados : {}), ...(mudaSituacao ? { situacao: rotuloSituacao(existente.ativo) } : {}) },
    depois: { ...(mudaDados ? { ...existente.dados, ...dados } : {}), ...(mudaSituacao ? { situacao: rotuloSituacao(ativo) } : {}) },
  });
  if (mudaDados && slug === "fazendas") await sincronizarDescricaoFazendas();
  if (mudaDados && slug === "grupos-dashboard") await sincronizarGruposOperacoes();
  return NextResponse.json({ ok: true });
}

export async function DELETE(req, ctx) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario || !podeEditar(usuario.perfil)) {
    return NextResponse.json({ error: "Você não tem permissão para alterar cadastros." }, { status: 403 });
  }
  const { slug } = await ctx.params;
  if (!specPorSlug(slug)) return NextResponse.json({ error: "Cadastro desconhecido." }, { status: 404 });
  const body = await req.json().catch(() => null);
  const cod = typeof body?.cod === "string" ? body.cod : "";
  if (!cod) return NextResponse.json({ error: "Informe o item." }, { status: 400 });
  // grupo do dashboard em uso por alguma operação (Grupos de Operações) não sai
  if (slug === "grupos-dashboard") {
    const usos = await operacoesDoGrupo(cod);
    if (usos.length > 0) {
      return NextResponse.json(
        {
          error: `O grupo está em uso em ${usos.length} operação(ões) de Grupos de Operações (${usos.slice(0, 8).join(", ")}${usos.length > 8 ? "…" : ""}). Troque o grupo dessas operações antes de excluí-lo.`,
        },
        { status: 400 },
      );
    }
  }
  // o item pelo código exato (a busca da lista pode trazer outros 50 antes dele)
  const linha = (await getPool().query("SELECT nm, dds FROM cad_itm WHERE cad = $1 AND cod = $2", [slug, cod])).rows[0];
  if (!linha) return NextResponse.json({ error: "Item não encontrado (já pode ter sido excluído)." }, { status: 404 });
  const removido = { nm: linha.nm, dados: linha.dds };
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
