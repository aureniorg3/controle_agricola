import { NextResponse } from "next/server";
import { usuarioDaRequisicao } from "@/lib/db";
import {
  buscarResponsaveis,
  consultarLancamento,
  detalheDaOperacao,
  fazendaDoLancamento,
  gravarLancamentoMobile,
  lancamentoPorBoletim,
  lancamentosDaOS,
  meusLancamentos,
  opcoesLancamentoMobile,
  ordensDoResponsavel,
} from "@/lib/db-lancamento-mobile";
import { matriculaValida } from "@/lib/lancamento-mobile";
import { podeEditar } from "@/lib/permissoes";

export const dynamic = "force-dynamic";

/*
 * Lançamento Mobile (Atividades): o apontamento diário lançado no campo pelo celular.
 *
 * GET (com sessão):
 *   ?opcoes=1                              listas da tela (operações com a classificação e o modelo do texto, etapas, tipos
 *                                          de aplicação do cadastro, solicitantes, equipes, equipamentos e status da O.S.)
 *                                          e as regras dos Parâmetros › Apontamento Diário (O.S. e etapa obrigatórias)
 *   ?responsaveis=<trecho>                 sugestões de quem lança: código (matrícula) ou nome dos responsáveis (cadastro
 *                                          Responsáveis ativo + os das O.S.), sem acento nem caixa; até 20
 *   ?mat=<matrícula ou código>&dt=         quem lança e as O.S. em aberto dele (404 se a matrícula não está em lugar nenhum)
 *   ?os=<n>&op=<cód>&dt=[&excluir=<ids>]   a operação da O.S. para lançar: talhões, saldo e último apontamento (sem
 *                                          contar os apontamentos `excluir` — os ids do lançamento aberto, separados
 *                                          por vírgula)
 *   ?fazenda=<cód>&dt=                     fazenda do Cadastro de Fazenda com os talhões da base da safra da data
 *   ?meus=1&mat=<matrícula>&de=&ate=       lançamentos do Lançamento Mobile com a matrícula (o de várias O.S. é um item,
 *     [&offset=<n>]                        com os boletins e as O.S. dele; sem de/ate, todos), uma página por vez a partir
 *                                          do `offset` (quantos já vieram); `mais` diz se há outra página
 *   ?bol=<n>                               o lançamento do boletim feito pelo Lançamento Mobile (com várias O.S., todos os
 *                                          apontamentos dele, de qualquer um dos boletins) e o texto para o WhatsApp
 *   ?lancamentosOS=<n>                     os lançamentos da O.S., de qualquer origem (os 50 mais recentes e o total)
 *   ?apontamento=<id>                      um lançamento para consultar: o apontamento com a origem e, no do Lançamento
 *                                          Mobile, os apontamentos do lançamento e o texto para o WhatsApp
 * POST (pode editar): inclui ou altera um lançamento de uma ou várias O.S. (`ordens`: os, opCod, statusOS, talhões e,
 * na edição, o id de cada uma; `id` = um apontamento do lançamento aberto e `boletins`, os dele ao abrir); com avisos e
 * sem `confirmar`, 409 com os avisos. A O.S. em branco é o lançamento sem O.S. (um por lançamento, com a operação, a
 * etapa e as fazendas/talhões do cadastro; recusado com a O.S. obrigatória nos Parâmetros). Aceita também o formato de
 * uma O.S. só (os, opCod, statusOS e talhões soltos).
 */

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const dataValida = (s) => ISO.test(s) && !Number.isNaN(Date.parse(s));
const hojeSP = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
const erro = (error, status) => NextResponse.json({ error }, { status });

export async function GET(req) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario) return erro("Sessão expirada. Entre novamente.", 401);
  const p = req.nextUrl.searchParams;
  try {
    if (p.get("opcoes") !== null) return NextResponse.json(await opcoesLancamentoMobile());
    if (p.get("responsaveis") !== null) {
      const termo = (p.get("responsaveis") ?? "").trim().slice(0, 60);
      return NextResponse.json({ responsaveis: termo.length < 2 ? [] : await buscarResponsaveis(termo) });
    }
    if (p.get("lancamentosOS") !== null) {
      const os = (p.get("lancamentosOS") ?? "").trim().slice(0, 20);
      if (!os) return erro("Informe a O.S.", 400);
      return NextResponse.json(await lancamentosDaOS(os));
    }
    if (p.get("apontamento") !== null) {
      const id = Number(p.get("apontamento"));
      if (!Number.isInteger(id) || id <= 0) return erro("Apontamento inválido.", 400);
      const r = await consultarLancamento(id);
      if (r.erro) return erro(r.erro, r.status);
      return NextResponse.json(r);
    }
    // sem data: hoje
    const dtParam = (p.get("dt") ?? "").trim();
    if (dtParam && !dataValida(dtParam)) return erro("Informe uma data válida.", 400);
    const dt = dtParam || hojeSP();
    const mat = (p.get("mat") ?? "").trim();

    if (p.get("meus") !== null) {
      if (!matriculaValida(mat)) return erro("Informe a matrícula.", 400);
      const de = (p.get("de") ?? "").trim();
      const ate = (p.get("ate") ?? "").trim();
      if ((de && !dataValida(de)) || (ate && !dataValida(ate)) || (de && ate && de > ate)) return erro("Informe um período válido.", 400);
      const offset = Number((p.get("offset") ?? "").trim() || 0);
      if (!Number.isInteger(offset) || offset < 0 || offset > 100000) return erro("Página inválida.", 400);
      const { itens, mais } = await meusLancamentos(mat, de, ate, { offset });
      return NextResponse.json({ apontamentos: itens, mais });
    }
    if (p.get("bol") !== null) {
      const n = Number(p.get("bol"));
      if (!Number.isInteger(n) || n <= 0) return erro("Informe o número do boletim.", 400);
      const r = await lancamentoPorBoletim(n);
      if (r.erro) return erro(r.erro, r.status);
      return NextResponse.json(r);
    }
    if (p.get("fazenda") !== null) {
      const cod = (p.get("fazenda") ?? "").trim().slice(0, 20);
      if (!cod) return erro("Informe a fazenda.", 400);
      return NextResponse.json(await fazendaDoLancamento(cod, dt));
    }
    if (p.get("os") !== null) {
      const os = (p.get("os") ?? "").trim().slice(0, 20);
      const op = (p.get("op") ?? "").trim().slice(0, 20);
      if (!os || !op) return erro("Informe a O.S. e a operação.", 400);
      // um id ou os do lançamento aberto para editar, separados por vírgula
      const ex = (p.get("excluir") ?? "").trim();
      const excluir = ex ? ex.split(",").slice(0, 30).map((x) => Number(x.trim())) : [];
      if (excluir.some((x) => !Number.isInteger(x) || x <= 0)) return erro("Apontamento inválido.", 400);
      const r = await detalheDaOperacao(os, op, dt, excluir);
      if (r.erro) return erro(r.erro, r.status);
      return NextResponse.json(r);
    }
    if (p.get("mat") !== null) {
      if (!matriculaValida(mat)) return erro("Informe a matrícula ou o código de quem vai lançar.", 400);
      const r = await ordensDoResponsavel(mat, dt);
      if (!r)
        return erro(`Matrícula não encontrada: ${mat} não está no Cadastro de Responsáveis (Ordem de Serviço Agr. › Cadastro Responsáveis).`, 404);
      if (r.inativo)
        return erro(`A matrícula ${r.responsavel.matricula} (${r.responsavel.nome}) está inativa no Cadastro de Responsáveis (Ordem de Serviço Agr.).`, 404);
      return NextResponse.json(r);
    }
    return erro("Consulta inválida.", 400);
  } catch (err) {
    console.error("[atividades/lancamento-mobile]", err);
    return erro("Não foi possível consultar agora. Tente de novo.", 500);
  }
}

/**
 * Inclui (sem id) ou altera (com id, só o que o Lançamento Mobile lançou) o lançamento de uma ou várias O.S. (e o sem
 * O.S.) e devolve os boletins e o texto para o grupo do WhatsApp.
 */
export async function POST(req) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario || !podeEditar(usuario.perfil)) return erro("Você não tem permissão para lançar apontamentos.", 403);
  const b = await req.json().catch(() => null);
  if (!b || typeof b !== "object" || Array.isArray(b)) return erro("Requisição inválida.", 400);
  try {
    const r = await gravarLancamentoMobile(b, usuario.nome);
    return NextResponse.json(r.corpo, { status: r.status });
  } catch (err) {
    console.error("[atividades/lancamento-mobile]", err);
    return erro("Não foi possível gravar agora. Tente de novo.", 500);
  }
}
