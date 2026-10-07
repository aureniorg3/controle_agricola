import { NextRequest, NextResponse } from "next/server";
import { usuarioDaRequisicao } from "@/lib/db";
import { climaDaPic, codigoBase, picDaFazenda, zeusConfigurado } from "@/lib/zeus";

export const dynamic = "force-dynamic";

const DATA_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function addDias(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Clima por fazenda (PIC): resumo do dia da data filtrada (chuva, temperatura, umidade, vento) e chuva do dia anterior. GET ?data=YYYY-MM-DD&fazendas=9529,9479 */
export async function GET(req: NextRequest) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario) return NextResponse.json({ error: "Sessão expirada. Entre novamente." }, { status: 401 });
  if (!zeusConfigurado()) return NextResponse.json({ error: "Integração Zeus não configurada." }, { status: 503 });

  const data = req.nextUrl.searchParams.get("data") ?? "";
  if (!DATA_REGEX.test(data) || Number.isNaN(Date.parse(data))) {
    return NextResponse.json({ error: "Data inválida." }, { status: 400 });
  }
  const codigos = [
    ...new Set(
      (req.nextUrl.searchParams.get("fazendas") ?? "")
        .split(",")
        .map(codigoBase)
        .filter((c) => /^\d+$/.test(c))
    ),
  ].slice(0, 60);

  const hoje = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
  const anterior = addDias(data, -1);
  const resultado: Record<string, unknown> = {};

  try {
    // fazendas -> PIC (1 a 2 por fazenda; cache), depois 1 chamada por PIC distinta
    const picPorFazenda = new Map<string, Awaited<ReturnType<typeof picDaFazenda>>>();
    for (const cod of codigos) picPorFazenda.set(cod, await picDaFazenda(cod));
    const pics = new Map<number, string>();
    for (const p of picPorFazenda.values()) if (p) pics.set(p.picId, p.name);
    const climaPorPic = new Map<number, Awaited<ReturnType<typeof climaDaPic>>>();
    await Promise.all(
      [...pics.keys()].map(async (id) => {
        try {
          climaPorPic.set(id, await climaDaPic(id, anterior, data, hoje));
        } catch {
          /* PIC sem resposta: a fazenda fica sem dado */
        }
      })
    );
    for (const cod of codigos) {
      const pic = picPorFazenda.get(cod);
      const clima = pic ? climaPorPic.get(pic.picId) : undefined;
      resultado[cod] =
        pic && clima
          ? {
              pic: pic.name,
              anteriorMm: clima.dias[anterior]?.chuvaMm ?? null,
              dia: clima.dias[data] ?? null,
              ultimaLeitura: clima.ultimaLeitura,
            }
          : null;
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Falha ao consultar a Zeus." }, { status: 502 });
  }

  return NextResponse.json({ data, anterior, hoje: data === hoje, fazendas: resultado });
}
