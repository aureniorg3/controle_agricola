import { NextRequest, NextResponse } from "next/server";
import { usuarioDaRequisicao } from "@/lib/db";
import { importarRodadasCampo } from "@/lib/db-rodadas";
import { lerRodadasCampo, type LinhaRodadaImportada } from "@/lib/rodadas-import";
import { podeEditar } from "@/lib/permissoes";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_ARQUIVOS = 10;

/**
 * Importa a planilha de levantamento (Rodadas de Campo). A coluna Status é
 * desconsiderada; cada combinação Rodada + Data + Região + Semana + Fazenda
 * vira um boletim, numerado a partir do último + 1.
 */
export async function POST(req: NextRequest) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario || !podeEditar(usuario.perfil)) {
    return NextResponse.json({ error: "Você não tem permissão para importar." }, { status: 403 });
  }
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Não foi possível ler os arquivos enviados." }, { status: 400 });
  }
  const arquivos = form.getAll("arquivo").filter((v): v is File => typeof v !== "string" && v.size > 0);
  if (arquivos.length === 0) return NextResponse.json({ error: "Anexe pelo menos um arquivo." }, { status: 400 });
  if (arquivos.length > MAX_ARQUIVOS) {
    return NextResponse.json({ error: `Envie no máximo ${MAX_ARQUIVOS} arquivos por vez.` }, { status: 400 });
  }

  const avisos: string[] = [];
  const linhas: LinhaRodadaImportada[] = [];
  let lidas = 0;
  for (const arq of arquivos) {
    try {
      const lido = lerRodadasCampo(await arq.arrayBuffer());
      if (lido.erros.length > 0) {
        return NextResponse.json({ error: `"${arq.name}": ${lido.erros.join(" ")}` }, { status: 400 });
      }
      lidas += lido.linhasLidas;
      linhas.push(...lido.linhas);
      avisos.push(...lido.avisos.map((a) => (arquivos.length > 1 ? `${arq.name}: ${a}` : a)));
    } catch (e) {
      return NextResponse.json(
        { error: `Não foi possível ler "${arq.name}": ${e instanceof Error ? e.message : String(e)}` },
        { status: 400 }
      );
    }
  }

  const r = await importarRodadasCampo(linhas);
  if (r.jaImportados > 0) {
    avisos.push(`${r.jaImportados} boletim(ns) já existiam (mesma rodada, data, região, semana e fazenda) e foram mantidos como estavam.`);
  }
  return NextResponse.json({ ok: true, lidas, ...r, avisos });
}
