import { NextRequest, NextResponse } from "next/server";
import { listNumerosOrdens, listOrdens, substituirEntradas, substituirOrdens, usuarioDaRequisicao } from "@/lib/db";
import { agregarPesagem, montarOrdens, parseOrdemColheita } from "@/lib/import-pesagem";
import { podeEditar } from "@/lib/permissoes";
import type { EntradaDiaria } from "@/lib/types";

export const runtime = "nodejs";
// O relatório de pesagem sozinho passa de 170 mil linhas — vale mais tempo
// que o padrão de rotas simples.
export const maxDuration = 120;

function arquivoValido(v: FormDataEntryValue | null): File | null {
  return v && typeof v !== "string" && v.size > 0 ? v : null;
}

/**
 * Importa um ou os dois relatórios do CHBWEB:
 *  - só "Ordem de Colheita": atualiza o cadastro (ordens e talhões); as
 *    entradas de cana e as áreas medidas à mão são mantidas;
 *  - só "Pesagem": troca as entradas de cana; o cadastro é mantido;
 *  - os dois: troca tudo (comportamento original).
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

  let resPesagem: Awaited<ReturnType<typeof agregarPesagem>> | null = null;
  if (arquivoPesagem) {
    try {
      resPesagem = await agregarPesagem(await arquivoPesagem.arrayBuffer(), ordensCadastradas);
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

  // ---- os dois arquivos
  if (resOrdens && resPesagem) {
    const resultado = montarOrdens(resOrdens.ordens, resPesagem, "2026/27");
    await substituirOrdens(resultado.ordens);
    return NextResponse.json({
      modo: "ambos",
      totalOrdens: resultado.totalOrdens,
      totalViagens: resultado.totalViagens,
      viagensSemOrdem: resultado.viagensSemOrdem,
      avisos: [...resOrdens.avisos, ...resPesagem.avisos, ...resultado.avisos],
      erros: [] as string[],
    });
  }

  // ---- só o cadastro de ordens: mantém as entradas de cana já importadas
  if (resOrdens) {
    const existentes = await listOrdens();
    const entradasPorOrdem = new Map<string, EntradaDiaria[]>(existentes.map((o) => [o.numero, o.entradas]));
    const vazio = { agregados: new Map(), totalViagens: 0, semOrdem: 0, ordensNaoCadastradas: new Set<string>() };
    const resultado = montarOrdens(resOrdens.ordens, vazio, "2026/27");
    for (const o of resultado.ordens) o.entradas = entradasPorOrdem.get(o.numero) ?? [];
    await substituirOrdens(resultado.ordens);
    return NextResponse.json({
      modo: "ordens",
      totalOrdens: resultado.totalOrdens,
      totalViagens: 0,
      viagensSemOrdem: 0,
      avisos: resOrdens.avisos,
      erros: [] as string[],
    });
  }

  // ---- só a pesagem: mantém o cadastro, troca as entradas
  const pesagem = resPesagem!;
  const entradasPorOrdem = new Map<string, EntradaDiaria[]>();
  for (const acc of pesagem.agregados.values()) {
    const lista = entradasPorOrdem.get(acc.ordem) ?? [];
    lista.push({
      data: acc.data,
      fazendaCodigo: acc.fazendaCodigo,
      talhao: acc.talhao,
      toneladas: Math.round(acc.toneladas * 100) / 100,
      toneladasAte6h: Math.round(acc.toneladasAte6h * 100) / 100,
      toneladasAte12h: Math.round(acc.toneladasAte12h * 100) / 100,
      toneladasAte18h: Math.round(acc.toneladasAte18h * 100) / 100,
      viagens: acc.viagens,
    });
    entradasPorOrdem.set(acc.ordem, lista);
  }
  await substituirEntradas(entradasPorOrdem);

  const avisos = [...pesagem.avisos];
  if (pesagem.ordensNaoCadastradas.size > 0) {
    avisos.push(
      `${pesagem.ordensNaoCadastradas.size} ordem(ns) aparecem nas viagens mas não estão no cadastro atual (importe "Ordem de Colheita"): ${[
        ...pesagem.ordensNaoCadastradas,
      ]
        .slice(0, 15)
        .join(", ")}${pesagem.ordensNaoCadastradas.size > 15 ? "…" : ""}.`
    );
  }
  return NextResponse.json({
    modo: "pesagem",
    totalOrdens: ordensCadastradas.size,
    totalViagens: pesagem.totalViagens,
    viagensSemOrdem: pesagem.semOrdem,
    avisos,
    erros: [] as string[],
  });
}
