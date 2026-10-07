import { NextRequest, NextResponse } from "next/server";
import {
  atualizarSafraCadastro,
  excluirSafraCadastro,
  salvarSafraCadastro,
  usuarioDaRequisicao,
  type DadosSafraCadastro,
} from "@/lib/db";
import { podeEditar, podeIncluirCadastro } from "@/lib/permissoes";

const DATA_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function dataValida(v: unknown): v is string {
  return typeof v === "string" && DATA_REGEX.test(v) && !Number.isNaN(Date.parse(v));
}

function validar(body: Record<string, unknown>): DadosSafraCadastro | string {
  const tipo = body.tipo;
  const ano = Number(body.ano);
  if (tipo !== "AGR" && tipo !== "IND") return "Informe o tipo da safra (AGR ou IND).";
  if (!Number.isInteger(ano) || ano < 2000 || ano > 2100) return "Informe o ano da safra (ex.: 2026).";
  const { anoInicio, anoFim, producaoInicio, producaoFim } = body;
  if (!dataValida(anoInicio) || !dataValida(anoFim)) return "Informe as datas de início e fim do ano.";
  if (!dataValida(producaoInicio) || !dataValida(producaoFim)) return "Informe as datas de início e fim da produção.";
  if (anoInicio > anoFim) return "No ano, a data de início não pode ser depois da data final.";
  if (producaoInicio > producaoFim) return "Na produção, a data de início não pode ser depois da data final.";
  return { tipo, ano, anoInicio, anoFim, producaoInicio, producaoFim };
}

async function autorizar(req: NextRequest, acao: string): Promise<NextResponse | null> {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario || !podeEditar(usuario.perfil)) {
    return NextResponse.json({ error: `Você não tem permissão para ${acao}.` }, { status: 403 });
  }
  return null;
}

async function lerCorpo(req: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const negado = await autorizar(req, "cadastrar safras");
  if (negado) return negado;
  if (!podeIncluirCadastro((await usuarioDaRequisicao(req))?.perfil)) {
    return NextResponse.json({ error: "Seu perfil não inclui itens novos nos cadastros; peça a um usuário com perfil Gravação ou Administrador." }, { status: 403 });
  }
  const body = await lerCorpo(req);
  if (!body) return NextResponse.json({ error: "Requisição inválida." }, { status: 400 });
  const dados = validar(body);
  if (typeof dados === "string") return NextResponse.json({ error: dados }, { status: 400 });
  await salvarSafraCadastro(dados, (await usuarioDaRequisicao(req))?.nome ?? "");
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest) {
  const negado = await autorizar(req, "editar safras");
  if (negado) return negado;
  const body = await lerCorpo(req);
  if (!body) return NextResponse.json({ error: "Requisição inválida." }, { status: 400 });
  const id = typeof body.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ error: "Informe a safra." }, { status: 400 });
  const dados = validar(body);
  if (typeof dados === "string") return NextResponse.json({ error: dados }, { status: 400 });
  const resultado = await atualizarSafraCadastro(id, dados, (await usuarioDaRequisicao(req))?.nome ?? "");
  if (resultado !== true) return NextResponse.json({ error: resultado.erro }, { status: 409 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const negado = await autorizar(req, "excluir safras");
  if (negado) return negado;
  const body = await lerCorpo(req);
  const id = body && typeof body.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ error: "Informe a safra." }, { status: 400 });
  await excluirSafraCadastro(id, (await usuarioDaRequisicao(req))?.nome ?? "");
  return NextResponse.json({ ok: true });
}
