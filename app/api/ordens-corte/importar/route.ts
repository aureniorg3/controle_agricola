import { NextRequest, NextResponse } from "next/server";
import { auditar } from "@/lib/auditar";
import {
  getPool,
  gravarPesagens,
  listNumerosOrdens,
  listOrdens,
  reconstruirEntradas,
  substituirOrdens,
  usuarioDaRequisicao,
  type LotePesagem,
  type ResultadoPesagem,
} from "@/lib/db";
import { lerViagensPesagem, montarOrdens, parseOrdemColheita } from "@/lib/import-pesagem";
import { podeEditar } from "@/lib/permissoes";
import type { EntradaDiaria } from "@/lib/types";

export const runtime = "nodejs";
// O relatório de pesagem pode passar de 170 mil linhas — vale mais tempo
// que o padrão de rotas simples.
export const maxDuration = 120;

const MAX_ARQUIVOS = 10;

function arquivosValidos(form: FormData, campo: string): File[] {
  return form.getAll(campo).filter((v): v is File => typeof v !== "string" && v.size > 0);
}

function fmtBR(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

/**
 * Importa até 10 arquivos de cada relatório do CHBWEB, sem apagar o histórico:
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

  // aplicar = "0": só a prévia da pesagem (o que muda em cada data), sem gravar nada
  const aplicar = form.get("aplicar") !== "0";
  const arquivosOrdens = arquivosValidos(form, "ordens");
  const arquivosPesagem = arquivosValidos(form, "pesagem");
  if (arquivosOrdens.length === 0 && arquivosPesagem.length === 0) {
    return NextResponse.json(
      { error: 'Envie pelo menos um arquivo: "Ordem de Colheita" ou "Relatório de Pesagem de Cana".' },
      { status: 400 }
    );
  }
  if (arquivosOrdens.length > MAX_ARQUIVOS || arquivosPesagem.length > MAX_ARQUIVOS) {
    return NextResponse.json({ error: `Envie no máximo ${MAX_ARQUIVOS} arquivos de cada tipo por vez.` }, { status: 400 });
  }

  // Ordem de Colheita: vários arquivos se somam; a mesma ordem em dois arquivos vale a do último
  const avisosOrdens: string[] = [];
  let resOrdens: { ordens: ReturnType<typeof parseOrdemColheita>["ordens"] } | null = null;
  if (arquivosOrdens.length > 0) {
    const porNumero = new Map<string, ReturnType<typeof parseOrdemColheita>["ordens"][number]>();
    for (const arq of arquivosOrdens) {
      let lido: ReturnType<typeof parseOrdemColheita>;
      try {
        lido = parseOrdemColheita(await arq.arrayBuffer());
      } catch (e) {
        return NextResponse.json(
          { error: `Não foi possível ler "${arq.name}" (Ordem de Colheita): ${e instanceof Error ? e.message : String(e)}` },
          { status: 400 }
        );
      }
      if (lido.erros.length > 0) {
        return NextResponse.json(
          {
            error: `Não foi possível importar "${arq.name}". Confira se cada arquivo foi anexado no campo certo.`,
            erros: lido.erros,
            avisos: [...avisosOrdens, ...lido.avisos],
          },
          { status: 400 }
        );
      }
      avisosOrdens.push(...lido.avisos.map((a) => (arquivosOrdens.length > 1 ? `${arq.name}: ${a}` : a)));
      for (const o of lido.ordens) porNumero.set(o.numero, o);
    }
    resOrdens = { ordens: [...porNumero.values()] };
  }

  // Ordens que a pesagem pode referenciar: as do arquivo novo ou, se ele não veio, as já cadastradas.
  const ordensCadastradas = resOrdens
    ? new Set(resOrdens.ordens.map((o) => o.numero))
    : new Set(await listNumerosOrdens());

  // Pesagem: viagens de todos os arquivos juntas; mesma data + ordem + controle vale a do último arquivo
  type ResPes = Awaited<ReturnType<typeof lerViagensPesagem>>;
  let resPesagem: { lotes: LotePesagem[]; total: number; semOrdem: number; ordensNaoCadastradas: Set<string>; periodoLido: ResPes["periodoLido"]; avisos: string[] } | null = null;
  if (arquivosPesagem.length > 0) {
    // cada arquivo é um lote, aplicado na ordem em que veio (o mais recente por último)
    const lotes: LotePesagem[] = [];
    const acc = { semOrdem: 0, ordensNaoCadastradas: new Set<string>(), periodoLido: null as ResPes["periodoLido"], avisos: [] as string[] };
    for (const arq of arquivosPesagem) {
      let lido: ResPes;
      try {
        lido = await lerViagensPesagem(await arq.arrayBuffer(), ordensCadastradas);
      } catch (e) {
        return NextResponse.json(
          { error: `Não foi possível ler "${arq.name}" (Relatório de Pesagem de Cana): ${e instanceof Error ? e.message : String(e)}` },
          { status: 400 }
        );
      }
      if (lido.erros.length > 0) {
        return NextResponse.json(
          {
            error: `Não foi possível importar "${arq.name}". Confira se cada arquivo foi anexado no campo certo.`,
            erros: lido.erros,
            avisos: [...avisosOrdens, ...acc.avisos, ...lido.avisos],
          },
          { status: 400 }
        );
      }
      lotes.push({ arquivo: arq.name, viagens: lido.viagens, periodo: lido.periodoCabecalho ?? lido.periodoLido, completo: lido.completo });
      acc.semOrdem += lido.semOrdem;
      lido.ordensNaoCadastradas.forEach((o) => acc.ordensNaoCadastradas.add(o));
      if (lido.periodoLido) {
        acc.periodoLido = acc.periodoLido
          ? {
              inicio: lido.periodoLido.inicio < acc.periodoLido.inicio ? lido.periodoLido.inicio : acc.periodoLido.inicio,
              fim: lido.periodoLido.fim > acc.periodoLido.fim ? lido.periodoLido.fim : acc.periodoLido.fim,
            }
          : lido.periodoLido;
      }
      acc.avisos.push(...lido.avisos.map((a) => (arquivosPesagem.length > 1 ? `${arq.name}: ${a}` : a)));
    }
    resPesagem = { lotes, total: lotes.reduce((s, l) => s + l.viagens.length, 0), ...acc };
  }

  const avisos: string[] = [...avisosOrdens];

  if (!aplicar) {
    if (!resPesagem) return NextResponse.json({ error: "A prévia é só para o Relatório de Pesagem." }, { status: 400 });
    const previa = await gravarPesagens(resPesagem.lotes, false);
    return NextResponse.json({
      previa: true,
      modo: resOrdens ? "ambos" : "pesagem",
      totalOrdens: resOrdens ? resOrdens.ordens.length : ordensCadastradas.size,
      totalViagens: resPesagem.total,
      viagensNovas: previa.novas,
      viagensSubstituidas: previa.alteradas,
      viagensMantidas: previa.mantidas,
      viagensCorrigidas: previa.corrigidas,
      viagensRemovidas: previa.removidas,
      alteracoesPorData: previa.porData,
      periodo: resPesagem.periodoLido ? `${fmtBR(resPesagem.periodoLido.inicio)} a ${fmtBR(resPesagem.periodoLido.fim)}` : null,
      viagensSemOrdem: resPesagem.semOrdem,
      avisos: [...avisos, ...resPesagem.avisos],
      erros: [] as string[],
    });
  }

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

  // 2) viagens da pesagem: conferência linha a linha pelo controle (ver gravarPesagens)
  let pes: ResultadoPesagem = { novas: 0, alteradas: 0, mantidas: 0, corrigidas: 0, removidas: 0, porData: [] };
  if (resPesagem) {
    pes = await gravarPesagens(resPesagem.lotes);
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

  await auditar(getPool(), {
    usuario: usuario.nome,
    modulo: "Colheita",
    entidade: "Importação de ordens e pesagem",
    chave: [...arquivosOrdens, ...arquivosPesagem].map((a) => a.name).join(", "),
    acao: "importacao",
    depois: {
      ordens: resOrdens ? resOrdens.ordens.length : 0,
      viagens: resPesagem?.total ?? 0,
      novas: pes.novas,
      alteradas: pes.alteradas,
      mantidas: pes.mantidas,
      corrigidas: pes.corrigidas,
      removidas: pes.removidas,
      porData: pes.porData.map((d) => `${fmtBR(d.data)}: ${d.antesT} → ${d.depoisT} t`).join("; ") || undefined,
    },
  });

  // 3) entradas diárias refeitas a partir das viagens (histórico sem viagens fica intacto)
  await reconstruirEntradas();

  return NextResponse.json({
    modo: resOrdens && resPesagem ? "ambos" : resOrdens ? "ordens" : "pesagem",
    totalOrdens,
    totalViagens: resPesagem?.total ?? 0,
    viagensNovas: pes.novas,
    viagensSubstituidas: pes.alteradas,
    viagensMantidas: pes.mantidas,
    viagensCorrigidas: pes.corrigidas,
    viagensRemovidas: pes.removidas,
    alteracoesPorData: pes.porData,
    periodo: resPesagem?.periodoLido ? `${fmtBR(resPesagem.periodoLido.inicio)} a ${fmtBR(resPesagem.periodoLido.fim)}` : null,
    viagensSemOrdem: resPesagem?.semOrdem ?? 0,
    avisos,
    erros: [] as string[],
  });
}
