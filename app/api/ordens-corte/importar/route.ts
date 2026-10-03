import { NextRequest, NextResponse } from "next/server";
import {
  listNumerosOrdens,
  listOrdens,
  reconstruirEntradas,
  substituirOrdens,
  upsertViagens,
  usuarioDaRequisicao,
} from "@/lib/db";
import { lerViagensPesagem, montarOrdens, parseOrdemColheita } from "@/lib/import-pesagem";
import { podeEditar } from "@/lib/permissoes";
import type { EntradaDiaria } from "@/lib/types";

export const runtime = "nodejs";
// O relatório de pesagem pode passar de 170 mil linhas — vale mais tempo
// que o padrão de rotas simples.
export const maxDuration = 120;

function arquivoValido(v: FormDataEntryValue | null): File | null {
  return v && typeof v !== "string" && v.size > 0 ? v : null;
}

function fmtBR(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

/**
 * Importa um ou os dois relatórios do CHBWEB, sem apagar o histórico:
 *  - "Ordem de Colheita" atualiza o cadastro (ordens e talhões); as entradas de
 *    cana e as áreas medidas à mão são mantidas;
 *  - "Pesagem" traz um período (ex.: 25/09 a 30/09): cada viagem, identificada
 *    por data + liberação (ordem) + controle, substitui a de mesma chave; as
 *    viagens de outras datas continuam como estavam.
 * Há dias sem abertura de ordem ou sem entrada de cana, então nenhum dos dois
 * é obrigatório.
 */
export async function POST(req: NextRequest) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario || !podeEditar(usuario.perfil)) {
    return NextResponse.json({ error: "Você não tem permissão para importar planilha." }, { status: 403 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Não foi possível ler os arquivos enviados." }, { status: 400 });
  }

  const arquivoOrdens = arquivoValido(form.get("ordens"));
  const arquivoPesagem = arquivoValido(form.get("pesagem"));
  if (!arquivoOrdens && !arquivoPesagem) {
    return NextResponse.json(
      { error: 'Envie pelo menos um arquivo: "Ordem de Colheita" ou "Relatório de Pesagem de Cana".' },
      { status: 400 }
    );
  }

  let resOrdens: ReturnType<typeof parseOrdemColheita> | null = null;
  if (arquivoOrdens) {
    try {
      resOrdens = parseOrdemColheita(await arquivoOrdens.arrayBuffer());
    } catch (e) {
      return NextResponse.json(
        { error: `Não foi possível ler o arquivo "Ordem de Colheita": ${e instanceof Error ? e.message : String(e)}` },
        { status: 400 }
      );
    }
    if (resOrdens.erros.length > 0) {
      return NextResponse.json(
        {
          error: "Não foi possível importar. Confira se cada arquivo foi anexado no campo certo.",
          erros: resOrdens.erros,
          avisos: resOrdens.avisos,
        },
        { status: 400 }
      );
    }
  }

  // Ordens que a pesagem pode referenciar: as do arquivo novo ou, se ele não veio, as já cadastradas.
  const ordensCadastradas = resOrdens
    ? new Set(resOrdens.ordens.map((o) => o.numero))
    : new Set(await listNumerosOrdens());

  let resPesagem: Awaited<ReturnType<typeof lerViagensPesagem>> | null = null;
  if (arquivoPesagem) {
    try {
      resPesagem = await lerViagensPesagem(await arquivoPesagem.arrayBuffer(), ordensCadastradas);
    } catch (e) {
      return NextResponse.json(
        { error: `Não foi possível ler o arquivo "Relatório de Pesagem de Cana": ${e instanceof Error ? e.message : String(e)}` },
        { status: 400 }
      );
    }
    if (resPesagem.erros.length > 0) {
      return NextResponse.json(
        {
          error: "Não foi possível importar. Confira se cada arquivo foi anexado no campo certo.",
          erros: resPesagem.erros,
          avisos: [...(resOrdens?.avisos ?? []), ...resPesagem.avisos],
        },
        { status: 400 }
      );
    }
  }

  const avisos: string[] = [...(resOrdens?.avisos ?? [])];

  // 1) cadastro de ordens (mantém as entradas já existentes)
  let totalOrdens = ordensCadastradas.size;
  if (resOrdens) {
    const existentes = await listOrdens();
    const entradasPorOrdem = new Map<string, EntradaDiaria[]>(existentes.map((o) => [o.numero, o.entradas]));
    const vazio = { agregados: new Map(), totalViagens: 0, semOrdem: 0, ordensNaoCadastradas: new Set<string>() };
    const resultado = montarOrdens(resOrdens.ordens, vazio, "2026/27");
    for (const o of resultado.ordens) o.entradas = entradasPorOrdem.get(o.numero) ?? [];
    await substituirOrdens(resultado.ordens);
    totalOrdens = resultado.totalOrdens;
  }

  // 2) viagens da pesagem: substitui por data + liberação + controle, sem apagar o resto
  let novas = 0;
  let substituidas = 0;
  if (resPesagem) {
    ({ novas, substituidas } = await upsertViagens(resPesagem.viagens));
    avisos.push(...resPesagem.avisos);
    if (resPesagem.ordensNaoCadastradas.size > 0) {
      avisos.push(
        `${resPesagem.ordensNaoCadastradas.size} ordem(ns) aparecem nas viagens mas não estão no cadastro (importe "Ordem de Colheita" — as viagens ficam guardadas e entram sozinhas quando a ordem for cadastrada): ${[
          ...resPesagem.ordensNaoCadastradas,
        ]
          .slice(0, 15)
          .join(", ")}${resPesagem.ordensNaoCadastradas.size > 15 ? "…" : ""}.`
      );
    }
  }

  // 3) entradas diárias refeitas a partir das viagens (histórico sem viagens fica intacto)
  await reconstruirEntradas();

  return NextResponse.json({
    modo: resOrdens && resPesagem ? "ambos" : resOrdens ? "ordens" : "pesagem",
    totalOrdens,
    totalViagens: resPesagem?.viagens.length ?? 0,
    viagensNovas: novas,
    viagensSubstituidas: substituidas,
    periodo: resPesagem?.periodoLido ? `${fmtBR(resPesagem.periodoLido.inicio)} a ${fmtBR(resPesagem.periodoLido.fim)}` : null,
    viagensSemOrdem: resPesagem?.semOrdem ?? 0,
    avisos,
    erros: [] as string[],
  });
}
