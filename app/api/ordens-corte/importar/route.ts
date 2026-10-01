import { NextRequest, NextResponse } from "next/server";
import { substituirOrdens, usuarioDaRequisicao } from "@/lib/db";
import { agregarPesagem, montarOrdens, parseOrdemColheita } from "@/lib/import-pesagem";
import { podeEditar } from "@/lib/permissoes";

export const runtime = "nodejs";
// O relatório de pesagem sozinho passa de 170 mil linhas — vale mais tempo
// que o padrão de rotas simples.
export const maxDuration = 120;

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

  const arquivoOrdens = form.get("ordens");
  const arquivoPesagem = form.get("pesagem");

  const faltando: string[] = [];
  if (!arquivoOrdens || typeof arquivoOrdens === "string") faltando.push('"Ordem de Colheita"');
  if (!arquivoPesagem || typeof arquivoPesagem === "string") faltando.push('"Relatório de Pesagem de Cana"');
  if (faltando.length > 0) {
    return NextResponse.json(
      { error: `Envie os 2 arquivos exigidos — faltando: ${faltando.join(", ")}.` },
      { status: 400 }
    );
  }

  let resOrdens: ReturnType<typeof parseOrdemColheita>;
  try {
    resOrdens = parseOrdemColheita(await (arquivoOrdens as File).arrayBuffer());
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

  const ordensCadastradas = new Set(resOrdens.ordens.map((o) => o.numero));
  let resPesagem: Awaited<ReturnType<typeof agregarPesagem>>;
  try {
    resPesagem = await agregarPesagem(await (arquivoPesagem as File).arrayBuffer(), ordensCadastradas);
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
        avisos: [...resOrdens.avisos, ...resPesagem.avisos],
      },
      { status: 400 }
    );
  }

  const resultado = montarOrdens(resOrdens.ordens, resPesagem, "2026/27");
  await substituirOrdens(resultado.ordens);

  return NextResponse.json({
    totalOrdens: resultado.totalOrdens,
    totalViagens: resultado.totalViagens,
    viagensSemOrdem: resultado.viagensSemOrdem,
    avisos: [...resOrdens.avisos, ...resPesagem.avisos, ...resultado.avisos],
    erros: [] as string[],
  });
}
