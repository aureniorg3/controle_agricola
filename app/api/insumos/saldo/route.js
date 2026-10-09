import { NextResponse } from "next/server";
import { usuarioDaRequisicao } from "@/lib/db";
import { consultarSaldo } from "@/lib/db-insumos";
import { DEPOSITOS_PADRAO, EMPRESAS } from "@/lib/insumos-saldo";

export const dynamic = "force-dynamic";

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const lista = (v, padrao) => {
  if (v === null) return padrao;
  return v
    .split(",")
    .map(Number)
    .filter((n) => Number.isInteger(n));
};

/** Resumo do saldo de insumos: posição na data base e série diária do período (somente leitura). */
export async function GET(req) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario) return NextResponse.json({ error: "Sessão expirada. Entre novamente." }, { status: 401 });
  const p = req.nextUrl.searchParams;
  const data = (k) => {
    const v = p.get(k) ?? "";
    return ISO.test(v) ? v : "";
  };
  const r = await consultarSaldo({
    dtBase: data("dt") || undefined,
    empresas: lista(
      p.get("emp"),
      EMPRESAS.map((e) => e.id),
    ),
    depositos: lista(p.get("almx"), DEPOSITOS_PADRAO),
    q: p.get("q") ?? "",
    grupo: p.get("grupo") ?? "",
    de: data("de"),
    ate: data("ate"),
  });
  return NextResponse.json(r);
}
