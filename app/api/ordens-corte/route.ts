import { NextRequest, NextResponse } from "next/server";
import { insertOrdem, listOrdens, usuarioDaRequisicao } from "@/lib/db";
import { podeEditar } from "@/lib/permissoes";
import { OrdemCorte, Talhao } from "@/lib/types";

export async function GET() {
  const ordens = listOrdens();
  return NextResponse.json({ ordens });
}

interface NovaOrdemBody {
  numero: string;
  frente: string;
  regiao?: string;
  fazendaCodigo: string;
  fazendaNome: string;
  safraLabel?: string;
  tchEstimado?: number;
  observacoes?: string;
  talhoes: { talhao: string; areaHa: number }[];
}

export async function POST(req: NextRequest) {
  const usuario = usuarioDaRequisicao(req);
  if (!usuario || !podeEditar(usuario.perfil)) {
    return NextResponse.json({ error: "Você não tem permissão para criar ordens." }, { status: 403 });
  }

  const body = (await req.json()) as NovaOrdemBody;

  if (!body.numero?.trim() || !body.fazendaNome?.trim() || !body.frente?.trim()) {
    return NextResponse.json(
      { error: "Informe ao menos número da ordem, frente e fazenda." },
      { status: 400 }
    );
  }
  if (!body.talhoes || body.talhoes.length === 0) {
    return NextResponse.json(
      { error: "Inclua ao menos um talhão com área." },
      { status: 400 }
    );
  }

  const nowIso = new Date().toISOString();
  const talhoes: Talhao[] = body.talhoes
    .filter((t) => t.talhao?.trim())
    .map((t) => ({
      talhao: t.talhao.trim(),
      areaHa: Number(t.areaHa) || 0,
      ultimaEntradaT: 0,
      acumSafraT: 0,
    }));

  const ordem: OrdemCorte = {
    id: `${body.numero.trim()}-${body.fazendaCodigo.trim() || Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 7)}`,
    numero: body.numero.trim(),
    frente: body.frente.trim(),
    regiao: body.regiao?.trim() || "-",
    fazendaCodigo: body.fazendaCodigo.trim() || "-",
    fazendaNome: body.fazendaNome.trim(),
    status: "Aberta",
    dataAbertura: nowIso.slice(0, 10),
    talhoes,
    areaLiberadaHa: talhoes.reduce((s, t) => s + t.areaHa, 0),
    areaColhidaHa: 0,
    tchRealizadoSafraAnterior: 0,
    tchEstimado: Number(body.tchEstimado) || 0,
    safraLabel: body.safraLabel?.trim() || "2026/27",
    lancamentos: [],
    observacoes: body.observacoes?.trim() || undefined,
    criadoEm: nowIso,
    atualizadoEm: nowIso,
  };

  insertOrdem(ordem);
  return NextResponse.json({ ordem }, { status: 201 });
}
