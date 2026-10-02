import { NextRequest, NextResponse } from "next/server";
import {
  atualizarEquiptoFrente,
  excluirEquiptoFrente,
  salvarEquiptoFrente,
  usuarioDaRequisicao,
} from "@/lib/db";
import { podeEditar } from "@/lib/permissoes";

const DATA_REGEX = /^\d{4}-\d{2}-\d{2}$/;

interface Corpo {
  id?: unknown;
  eqp?: unknown;
  frente?: unknown;
  vigencia?: unknown;
}

function validar(body: Corpo): { eqp: string; frente: string; vigencia: string } | string {
  const eqp = typeof body.eqp === "string" ? body.eqp.trim() : "";
  const frente = typeof body.frente === "string" ? body.frente.trim() : "";
  const vigencia = typeof body.vigencia === "string" ? body.vigencia : "";
  if (!eqp) return "Informe o código do equipamento.";
  if (!frente) return "Informe a frente.";
  if (!DATA_REGEX.test(vigencia) || Number.isNaN(Date.parse(vigencia))) return "Informe uma data válida.";
  return { eqp, frente, vigencia };
}

async function autorizar(req: NextRequest, acao: string): Promise<NextResponse | null> {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario || !podeEditar(usuario.perfil)) {
    return NextResponse.json({ error: `Você não tem permissão para ${acao}.` }, { status: 403 });
  }
  return null;
}

async function lerCorpo(req: NextRequest): Promise<Corpo | null> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const negado = await autorizar(req, "lançar equipamento por frente");
  if (negado) return negado;
  const body = await lerCorpo(req);
  if (!body) return NextResponse.json({ error: "Requisição inválida." }, { status: 400 });
  const dados = validar(body);
  if (typeof dados === "string") return NextResponse.json({ error: dados }, { status: 400 });
  await salvarEquiptoFrente(dados.eqp, dados.frente, dados.vigencia);
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest) {
  const negado = await autorizar(req, "editar equipamento por frente");
  if (negado) return negado;
  const body = await lerCorpo(req);
  if (!body) return NextResponse.json({ error: "Requisição inválida." }, { status: 400 });
  const id = typeof body.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ error: "Informe o lançamento." }, { status: 400 });
  const dados = validar(body);
  if (typeof dados === "string") return NextResponse.json({ error: dados }, { status: 400 });
  const resultado = await atualizarEquiptoFrente(id, dados.eqp, dados.frente, dados.vigencia);
  if (resultado !== true) return NextResponse.json({ error: resultado.erro }, { status: 409 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const negado = await autorizar(req, "excluir equipamento por frente");
  if (negado) return negado;
  const body = await lerCorpo(req);
  const id = body && typeof body.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ error: "Informe o lançamento." }, { status: 400 });
  await excluirEquiptoFrente(id);
  return NextResponse.json({ ok: true });
}
