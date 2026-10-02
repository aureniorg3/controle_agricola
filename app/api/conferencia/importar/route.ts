import { NextRequest, NextResponse } from "next/server";
import { substituirConferenciaDia, usuarioDaRequisicao } from "@/lib/db";
import { parseConferenciaPesagem } from "@/lib/import-conferencia";
import { podeEditar } from "@/lib/permissoes";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_ARQUIVOS = 5;
const DATA_REGEX = /^\d{4}-\d{2}-\d{2}$/;

interface ResultadoArquivo {
  nome: string;
  data: string;
  ok: boolean;
  linhas: number;
  toneladas: number;
  avisos: string[];
  erro?: string;
}

function fmtBR(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export async function POST(req: NextRequest) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario || !podeEditar(usuario.perfil)) {
    return NextResponse.json({ error: "Você não tem permissão para importar arquivos." }, { status: 403 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Não foi possível ler os arquivos enviados." }, { status: 400 });
  }

  const resultados: ResultadoArquivo[] = [];
  const datasUsadas = new Set<string>();

  for (let i = 0; i < MAX_ARQUIVOS; i++) {
    const arquivo = form.get(`arquivo_${i}`);
    const dataInformada = form.get(`data_${i}`);
    if (!arquivo || typeof arquivo === "string") continue;

    const nome = arquivo.name;
    const data = typeof dataInformada === "string" ? dataInformada : "";
    const base: ResultadoArquivo = { nome, data, ok: false, linhas: 0, toneladas: 0, avisos: [] };

    if (!DATA_REGEX.test(data) || Number.isNaN(Date.parse(data))) {
      resultados.push({ ...base, erro: "Informe a data do arquivo." });
      continue;
    }
    if (datasUsadas.has(data)) {
      resultados.push({ ...base, erro: `A data ${fmtBR(data)} foi informada em mais de um arquivo.` });
      continue;
    }
    datasUsadas.add(data);

    try {
      const lido = parseConferenciaPesagem(await arquivo.arrayBuffer(), data);
      if (lido.erros.length > 0) {
        resultados.push({ ...base, erro: lido.erros.join(" ") });
        continue;
      }
      if (lido.periodoInicio && lido.periodoInicio === lido.periodoFim && lido.periodoInicio !== data) {
        resultados.push({
          ...base,
          erro: `O período do arquivo é ${fmtBR(lido.periodoInicio)}, mas a data informada foi ${fmtBR(data)}.`,
        });
        continue;
      }
      await substituirConferenciaDia(data, lido.linhas);
      resultados.push({
        ...base,
        ok: true,
        linhas: lido.linhas.length,
        toneladas: Math.round(lido.linhas.reduce((s, l) => s + l.toneladas, 0) * 100) / 100,
        avisos: lido.avisos,
      });
    } catch (e) {
      resultados.push({
        ...base,
        erro: `Não foi possível ler o arquivo: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }

  if (resultados.length === 0) {
    return NextResponse.json({ error: "Anexe pelo menos um arquivo (até 5)." }, { status: 400 });
  }
  return NextResponse.json({ resultados });
}
