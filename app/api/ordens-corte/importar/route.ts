import { NextRequest, NextResponse } from "next/server";
import { importarLinhas, usuarioDaRequisicao } from "@/lib/db";
import { parseWorkbook } from "@/lib/import-ordens";
import { podeEditar } from "@/lib/permissoes";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const usuario = usuarioDaRequisicao(req);
  if (!usuario || !podeEditar(usuario.perfil)) {
    return NextResponse.json({ error: "Você não tem permissão para importar planilha." }, { status: 403 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Não foi possível ler o arquivo enviado." }, { status: 400 });
  }

  const arquivo = form.get("arquivo");
  if (!arquivo || typeof arquivo === "string") {
    return NextResponse.json({ error: "Envie um arquivo (.xlsx, .xls ou .csv) no campo 'arquivo'." }, { status: 400 });
  }

  const buffer = await arquivo.arrayBuffer();
  const parse = parseWorkbook(buffer, arquivo.name || "planilha");

  if (parse.erros.length > 0 && parse.linhas.length === 0) {
    return NextResponse.json(
      {
        error: "Não foi possível importar o arquivo.",
        erros: parse.erros,
        avisos: parse.avisos,
        colunasEncontradas: parse.colunasEncontradas,
      },
      { status: 400 }
    );
  }

  const resultado = importarLinhas(parse.linhas);

  return NextResponse.json({
    ...resultado,
    avisos: [...parse.avisos, ...resultado.avisos],
    erros: parse.erros, // linhas ignoradas durante a leitura (não impedem o restante da importação)
    linhasLidas: parse.linhas.length,
    totalLinhasPlanilha: parse.totalLinhasPlanilha,
    colunasEncontradas: parse.colunasEncontradas,
    camposNaoEncontrados: parse.camposNaoEncontrados,
  });
}
