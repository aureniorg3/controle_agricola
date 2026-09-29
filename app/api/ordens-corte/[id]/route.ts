import { NextRequest, NextResponse } from "next/server";
import { deleteOrdem, getOrdem, updateOrdem, usuarioDaRequisicao } from "@/lib/db";
import { podeEditar } from "@/lib/permissoes";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ordem = getOrdem(id);
  if (!ordem) return NextResponse.json({ error: "Ordem não encontrada." }, { status: 404 });
  return NextResponse.json({ ordem });
}

interface PatchBody {
  status?: "Aberta" | "Encerrada";
  areaColhidaHa?: number;
  areaLiberadaHa?: number;
  tchEstimado?: number;
  tchRealizadoSafraAnterior?: number;
  observacoes?: string;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const usuario = usuarioDaRequisicao(req);
  if (!usuario || !podeEditar(usuario.perfil)) {
    return NextResponse.json({ error: "Você não tem permissão para editar ordens." }, { status: 403 });
  }

  const { id } = await params;
  const body = (await req.json()) as PatchBody;
  const nowDate = new Date().toISOString().slice(0, 10);

  const updated = updateOrdem(id, (o) => {
    if (body.status && body.status !== o.status) {
      o.status = body.status;
      o.dataEncerramento = body.status === "Encerrada" ? nowDate : undefined;
    }
    if (body.areaColhidaHa !== undefined) o.areaColhidaHa = Number(body.areaColhidaHa) || 0;
    if (body.areaLiberadaHa !== undefined) o.areaLiberadaHa = Number(body.areaLiberadaHa) || 0;
    if (body.tchEstimado !== undefined) o.tchEstimado = Number(body.tchEstimado) || 0;
    if (body.tchRealizadoSafraAnterior !== undefined)
      o.tchRealizadoSafraAnterior = Number(body.tchRealizadoSafraAnterior) || 0;
    if (body.observacoes !== undefined) o.observacoes = body.observacoes.trim() || undefined;
    return o;
  });

  if (!updated) return NextResponse.json({ error: "Ordem não encontrada." }, { status: 404 });
  return NextResponse.json({ ordem: updated });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const usuario = usuarioDaRequisicao(req);
  if (!usuario || !podeEditar(usuario.perfil)) {
    return NextResponse.json({ error: "Você não tem permissão para excluir ordens." }, { status: 403 });
  }

  const { id } = await params;
  const ok = deleteOrdem(id);
  if (!ok) return NextResponse.json({ error: "Ordem não encontrada." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
