import { NextRequest, NextResponse } from "next/server";
import { usuarioDaRequisicao } from "@/lib/db";
import { addDays } from "@/lib/period";
import { codigoFazendaBase, type ClimaFazenda, type ClimaResp } from "@/lib/clima";
import { agregarClima, climaDaPicPeriodo, picDaFazenda, zeusConfigurado } from "@/lib/zeus";

export const dynamic = "force-dynamic";

const DATA_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const DATA_VALIDA = (s: string) => DATA_REGEX.test(s) && !Number.isNaN(Date.parse(s));
const MAX_DIAS = 62;

/**
 * Clima por fazenda (PIC) no intervalo inicio..data (padrão: só o dia da data) e chuva do dia anterior.
 * GET ?data=YYYY-MM-DD[&inicio=YYYY-MM-DD]&fazendas=9529,9479
 */
export async function GET(req: NextRequest) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario) return NextResponse.json({ error: "Sessão expirada. Entre novamente." }, { status: 401 });
  if (!zeusConfigurado()) return NextResponse.json({ error: "Integração Zeus não configurada." }, { status: 503 });

  const data = req.nextUrl.searchParams.get("data") ?? "";
  const inicio = req.nextUrl.searchParams.get("inicio") || data;
  if (!DATA_VALIDA(data) || !DATA_VALIDA(inicio) || inicio > data) {
    return NextResponse.json({ error: "Datas inválidas." }, { status: 400 });
  }
  if ((Date.parse(data) - Date.parse(inicio)) / 86400000 + 1 > MAX_DIAS) {
    return NextResponse.json({ error: `Período máximo de ${MAX_DIAS} dias.` }, { status: 400 });
  }
  const codigos = [
    ...new Set(
      (req.nextUrl.searchParams.get("fazendas") ?? "")
        .split(",")
        .map(codigoFazendaBase)
        .filter((c) => /^\d+$/.test(c))
    ),
  ].slice(0, 60);

  const hoje = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
  const anterior = addDays(data, -1);
  const fazendas: Record<string, ClimaFazenda | null> = {};

  try {
    // fazendas -> PIC (1 a 2 por fazenda; cache), depois 1 busca por PIC distinta
    const picPorFazenda = new Map<string, Awaited<ReturnType<typeof picDaFazenda>>>();
    for (const cod of codigos) picPorFazenda.set(cod, await picDaFazenda(cod));
    const pics = new Set<number>();
    for (const p of picPorFazenda.values()) if (p) pics.add(p.picId);
    const climaPorPic = new Map<number, Awaited<ReturnType<typeof climaDaPicPeriodo>>>();
    await Promise.all(
      [...pics].map(async (id) => {
        try {
          climaPorPic.set(id, await climaDaPicPeriodo(id, inicio < anterior ? inicio : anterior, data, hoje));
        } catch {
          /* PIC sem resposta: a fazenda fica sem dado */
        }
      })
    );
    for (const cod of codigos) {
      const pic = picPorFazenda.get(cod);
      const clima = pic ? climaPorPic.get(pic.picId) : undefined;
      fazendas[cod] =
        pic && clima
          ? {
              pic: pic.name,
              anteriorMm: clima.dias[anterior]?.chuvaMm ?? null,
              dia: agregarClima(clima.dias, inicio, data),
              ultimaLeitura: clima.ultimaLeitura,
            }
          : null;
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Falha ao consultar a Zeus." }, { status: 502 });
  }

  const resp: ClimaResp = { hoje: data === hoje, inicio, fim: data, periodo: inicio !== data, fazendas };
  return NextResponse.json(resp);
}
