import { NextRequest, NextResponse } from "next/server";
import { lancarAreaColhida, usuarioDaRequisicao } from "@/lib/db";
import { podeEditar } from "@/lib/permissoes";

export async function POST(req: NextRequest) {
  const usuario = usuarioDaRequisicao(req);
  if (!usuario || !podeEditar(usuario.perfil)) {
    return NextResponse.json({ error: "Você não tem permissão para lançar área colhida." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Corpo da requisição inválido." }, { status: 400 });
  }

  const { numero, modo } = (body ?? {}) as { numero?: unknown; modo?: unknown };
  if (typeof numero !== "string" || !numero.trim()) {
    return NextResponse.json({ error: "Informe o número da ordem." }, { status: 400 });
  }

  let resultado: ReturnType<typeof lancarAreaColhida>;
  if (modo === "ordem") {
    const totalHa = Number((body as { totalHa?: unknown }).totalHa);
    if (!Number.isFinite(totalHa)) {
      return NextResponse.json({ error: "Informe a área colhida (número válido)." }, { status: 400 });
    }
    resultado = lancarAreaColhida(numero.trim(), { modo: "ordem", totalHa });
  } else if (modo === "talhoes") {
    const valoresRaw = (body as { valores?: unknown }).valores;
    if (!Array.isArray(valoresRaw)) {
      return NextResponse.json({ error: "Informe os valores por talhão." }, { status: 400 });
    }
    const valores = valoresRaw.map((v) => ({
      fazendaCodigo: String((v as { fazendaCodigo?: unknown })?.fazendaCodigo ?? ""),
      talhao: String((v as { talhao?: unknown })?.talhao ?? ""),
      areaColhidaHa: Number((v as { areaColhidaHa?: unknown })?.areaColhidaHa),
    }));
    if (valores.some((v) => !Number.isFinite(v.areaColhidaHa))) {
      return NextResponse.json({ error: "Algum valor de área colhida não é um número válido." }, { status: 400 });
    }
    resultado = lancarAreaColhida(numero.trim(), { modo: "talhoes", valores });
  } else {
    return NextResponse.json({ error: 'Modo inválido — use "ordem" ou "talhoes".' }, { status: 400 });
  }

  if ("erro" in resultado) {
    return NextResponse.json({ error: resultado.erro }, { status: 400 });
  }
  return NextResponse.json({ ordem: resultado });
}
