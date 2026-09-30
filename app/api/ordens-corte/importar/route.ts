import { NextRequest, NextResponse } from "next/server";
import { substituirOrdens, usuarioDaRequisicao } from "@/lib/db";
import { montarOrdens, parseConferencia, parseOrdemColheita, parsePesagemPorHora } from "@/lib/import-pesagem";
import { podeEditar } from "@/lib/permissoes";

export const runtime = "nodejs";
// Os três arquivos somados passam de 20 MB e têm ~350 mil linhas juntas —
// vale mais tempo que o padrão de rotas simples.
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const usuario = usuarioDaRequisicao(req);
  if (!usuario || !podeEditar(usuario.perfil)) {
    return NextResponse.json({ error: "Você não tem permissão para importar planilha." }, { status: 403 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Não foi possível ler os arquivos enviados." }, { status: 400 });
  }

  const arquivoOrdens = form.get("ordens");
  const arquivoPesagem = form.get("pesagem");
  const arquivoConferencia = form.get("conferencia");

  const faltando: string[] = [];
  if (!arquivoOrdens || typeof arquivoOrdens === "string") faltando.push('"Ordem de Colheita"');
  if (!arquivoPesagem || typeof arquivoPesagem === "string") faltando.push('"Pesagem de Cana por Hora"');
  if (!arquivoConferencia || typeof arquivoConferencia === "string") faltando.push('"Conferência de Pesagens"');
  if (faltando.length > 0) {
    return NextResponse.json(
      { error: `Envie os 3 arquivos exigidos — faltando: ${faltando.join(", ")}.` },
      { status: 400 }
    );
  }

  const [bufOrdens, bufPesagem, bufConferencia] = await Promise.all([
    (arquivoOrdens as File).arrayBuffer(),
    (arquivoPesagem as File).arrayBuffer(),
    (arquivoConferencia as File).arrayBuffer(),
  ]);

  let resOrdens: ReturnType<typeof parseOrdemColheita>;
  let resPesagem: ReturnType<typeof parsePesagemPorHora>;
  let resConferencia: ReturnType<typeof parseConferencia>;
  try {
    resOrdens = parseOrdemColheita(bufOrdens);
    resPesagem = parsePesagemPorHora(bufPesagem);
    resConferencia = parseConferencia(bufConferencia);
  } catch (e) {
    return NextResponse.json(
      { error: `Não foi possível ler um dos arquivos: ${e instanceof Error ? e.message : String(e)}` },
      { status: 400 }
    );
  }

  const errosLeitura = [...resOrdens.erros, ...resPesagem.erros, ...resConferencia.erros];
  if (errosLeitura.length > 0) {
    return NextResponse.json(
      {
        error: "Não foi possível importar. Confira se cada arquivo foi anexado no campo certo.",
        erros: errosLeitura,
        avisos: [...resOrdens.avisos, ...resPesagem.avisos, ...resConferencia.avisos],
      },
      { status: 400 }
    );
  }

  const resultado = montarOrdens(resOrdens.ordens, resPesagem.viagens, resConferencia.porChave, "2026/27");
  substituirOrdens(resultado.ordens);

  return NextResponse.json({
    totalOrdens: resultado.totalOrdens,
    totalViagens: resultado.totalViagens,
    viagensSemOrdem: resultado.viagensSemOrdem,
    viagensSemConferencia: resultado.viagensSemConferencia,
    avisos: [...resOrdens.avisos, ...resPesagem.avisos, ...resConferencia.avisos, ...resultado.avisos],
    erros: [] as string[],
  });
}
