import { NextRequest, NextResponse } from "next/server";
import { updateOrdem } from "@/lib/db";
import { Lancamento } from "@/lib/types";

interface NovoLancamentoBody {
  data: string; // YYYY-MM-DD
  toneladas: number;
  porTalhao?: { talhao: string; toneladas: number }[];
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json()) as NovoLancamentoBody;

  if (!body.data || !/^\d{4}-\d{2}-\d{2}$/.test(body.data)) {
    return NextResponse.json({ error: "Informe uma data válida (AAAA-MM-DD)." }, { status: 400 });
  }
  const totalInformado = Number(body.toneladas) || 0;
  const porTalhao = (body.porTalhao ?? []).filter((p) => p.talhao?.trim() && Number(p.toneladas) > 0);
  const totalPorTalhao = porTalhao.reduce((s, p) => s + Number(p.toneladas), 0);
  const total = porTalhao.length > 0 ? totalPorTalhao : totalInformado;

  if (total <= 0) {
    return NextResponse.json({ error: "Informe uma tonelagem maior que zero." }, { status: 400 });
  }

  const updated = updateOrdem(id, (o) => {
    const lancamento: Lancamento = {
      id: `lanc-${o.id}-${Date.now()}`,
      data: body.data,
      toneladas: Math.round(total * 100) / 100,
      porTalhao: porTalhao.length > 0 ? porTalhao : undefined,
      criadoEm: new Date().toISOString(),
    };
    o.lancamentos = [...o.lancamentos, lancamento];

    if (porTalhao.length > 0) {
      for (const p of porTalhao) {
        const t = o.talhoes.find((tal) => tal.talhao === p.talhao);
        if (t) {
          t.acumSafraT = Math.round((t.acumSafraT + Number(p.toneladas)) * 100) / 100;
          t.ultimaEntradaT = Math.round(Number(p.toneladas) * 100) / 100;
        }
      }
    } else {
      // sem detalhe por talhão: distribui proporcionalmente pela área de cada talhão
      const areaTotal = o.talhoes.reduce((s, t) => s + t.areaHa, 0) || 1;
      for (const t of o.talhoes) {
        const parte = (t.areaHa / areaTotal) * total;
        t.acumSafraT = Math.round((t.acumSafraT + parte) * 100) / 100;
        t.ultimaEntradaT = Math.round(parte * 100) / 100;
      }
    }

    return o;
  });

  if (!updated) return NextResponse.json({ error: "Ordem não encontrada." }, { status: 404 });
  return NextResponse.json({ ordem: updated }, { status: 201 });
}
