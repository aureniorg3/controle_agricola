import { NextRequest, NextResponse } from "next/server";
import { substituirOrdens, usuarioDaRequisicao } from "@/lib/db";
import { agregarPesagem, montarOrdens, parseConferencia, parseOrdemColheita } from "@/lib/import-pesagem";
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

  // Lidos e interpretados um de cada vez (não em paralelo), e o cruzamento
  // com a Conferência já acontece durante a leitura da Pesagem (não guarda
  // as ~176 mil viagens num array à parte) — a instância gratuita do Render
  // só tem 512 MB de RAM, e esses dois relatórios não cabem inteiros nela
  // se forem lidos e retidos em separado.
  let resOrdens: Awaited<ReturnType<typeof parseOrdemColheita>>;
  let resConferencia: Awaited<ReturnType<typeof parseConferencia>>;
  try {
    resOrdens = parseOrdemColheita(await (arquivoOrdens as File).arrayBuffer());
    resConferencia = await parseConferencia(await (arquivoConferencia as File).arrayBuffer());
  } catch (e) {
    return NextResponse.json(
      { error: `Não foi possível ler um dos arquivos: ${e instanceof Error ? e.message : String(e)}` },
      { status: 400 }
    );
  }

  const errosCadastro = [...resOrdens.erros, ...resConferencia.erros];
  if (errosCadastro.length > 0) {
    return NextResponse.json(
      {
        error: "Não foi possível importar. Confira se cada arquivo foi anexado no campo certo.",
        erros: errosCadastro,
        avisos: [...resOrdens.avisos, ...resConferencia.avisos],
      },
      { status: 400 }
    );
  }

  const ordensCadastradas = new Set(resOrdens.ordens.map((o) => o.numero));

  // Solta pro coletor de lixo o que sobrou da leitura da Conferência antes de
  // começar a Pesagem (o outro relatório de ~176 mil linhas) — sem isso o
  // V8 só libera essa memória sob pressão, e os dois picos podem se somar.
  // `--expose-gc` é ligado no script "start" (ver package.json); se não
  // estiver disponível (ex. `next dev`), o import segue normalmente.
  if (typeof global.gc === "function") global.gc();

  let resPesagem: Awaited<ReturnType<typeof agregarPesagem>>;
  try {
    resPesagem = await agregarPesagem(await (arquivoPesagem as File).arrayBuffer(), resConferencia.porChave, ordensCadastradas);
  } catch (e) {
    return NextResponse.json(
      { error: `Não foi possível ler o arquivo "Pesagem de Cana por Hora": ${e instanceof Error ? e.message : String(e)}` },
      { status: 400 }
    );
  }

  if (resPesagem.erros.length > 0) {
    return NextResponse.json(
      {
        error: "Não foi possível importar. Confira se cada arquivo foi anexado no campo certo.",
        erros: resPesagem.erros,
        avisos: [...resOrdens.avisos, ...resConferencia.avisos, ...resPesagem.avisos],
      },
      { status: 400 }
    );
  }

  const resultado = montarOrdens(resOrdens.ordens, resPesagem, "2026/27");
  substituirOrdens(resultado.ordens);

  return NextResponse.json({
    totalOrdens: resultado.totalOrdens,
    totalViagens: resultado.totalViagens,
    viagensSemOrdem: resultado.viagensSemOrdem,
    viagensSemConferencia: resultado.viagensSemConferencia,
    avisos: [...resOrdens.avisos, ...resConferencia.avisos, ...resPesagem.avisos, ...resultado.avisos],
    erros: [] as string[],
  });
}
