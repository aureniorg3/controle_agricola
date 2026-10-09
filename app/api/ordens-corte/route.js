import { NextResponse } from "next/server";
import { listOrdens, listOrdensVisiveis, usuarioDaRequisicao } from "@/lib/db";

export async function GET(req) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario) {
    return NextResponse.json({ error: "Sessão expirada. Entre novamente." }, { status: 401 });
  }
  const ordens = await listOrdens();
  const ordensVisiveis = await listOrdensVisiveis();
  return NextResponse.json({ ordens, ordensVisiveis });
}
