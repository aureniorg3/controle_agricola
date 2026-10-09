import { NextResponse } from "next/server";
import { atualizarMeta, excluirMeta, salvarMeta, usuarioDaRequisicao } from "@/lib/db";
import { podeEditar } from "@/lib/permissoes";

const DATA_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(req) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario || !podeEditar(usuario.perfil)) {
    return NextResponse.json({ error: "Você não tem permissão para cadastrar metas." }, { status: 403 });
  }
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Requisição inválida." }, { status: 400 });
  }
  const frente = typeof body.frente === "string" ? body.frente.trim() : "";
  const metaDiaT = typeof body.metaDiaT === "number" ? body.metaDiaT : Number(body.metaDiaT);
  const vigencia = typeof body.vigencia === "string" ? body.vigencia : "";
  if (!frente) return NextResponse.json({ error: "Informe a frente." }, { status: 400 });
  if (!Number.isFinite(metaDiaT) || metaDiaT < 0) {
    return NextResponse.json({ error: "Informe uma meta válida (toneladas por dia)." }, { status: 400 });
  }
  if (!DATA_REGEX.test(vigencia) || Number.isNaN(Date.parse(vigencia))) {
    return NextResponse.json({ error: "Informe uma data válida." }, { status: 400 });
  }
  await salvarMeta(frente, metaDiaT, vigencia, usuario.nome);
  return NextResponse.json({ ok: true });
}

export async function PATCH(req) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario || !podeEditar(usuario.perfil)) {
    return NextResponse.json({ error: "Você não tem permissão para editar metas." }, { status: 403 });
  }
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Requisição inválida." }, { status: 400 });
  }
  const id = typeof body.id === "string" ? body.id : "";
  const frente = typeof body.frente === "string" ? body.frente.trim() : "";
  const metaDiaT = typeof body.metaDiaT === "number" ? body.metaDiaT : Number(body.metaDiaT);
  const vigencia = typeof body.vigencia === "string" ? body.vigencia : "";
  if (!id) return NextResponse.json({ error: "Informe a meta." }, { status: 400 });
  if (!frente) return NextResponse.json({ error: "Informe a frente." }, { status: 400 });
  if (!Number.isFinite(metaDiaT) || metaDiaT < 0) {
    return NextResponse.json({ error: "Informe uma meta válida (toneladas por dia)." }, { status: 400 });
  }
  if (!DATA_REGEX.test(vigencia) || Number.isNaN(Date.parse(vigencia))) {
    return NextResponse.json({ error: "Informe uma data válida." }, { status: 400 });
  }
  const resultado = await atualizarMeta(id, frente, metaDiaT, vigencia, usuario.nome);
  if (resultado !== true) return NextResponse.json({ error: resultado.erro }, { status: 409 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario || !podeEditar(usuario.perfil)) {
    return NextResponse.json({ error: "Você não tem permissão para excluir metas." }, { status: 403 });
  }
  let id = "";
  try {
    const body = await req.json();
    id = typeof body?.id === "string" ? body.id : "";
  } catch {
    id = "";
  }
  if (!id) return NextResponse.json({ error: "Informe a meta." }, { status: 400 });
  await excluirMeta(id, usuario.nome);
  return NextResponse.json({ ok: true });
}
