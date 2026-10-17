import { gunzipSync } from "zlib";
import { NextResponse } from "next/server";
import { usuarioDaRequisicao } from "@/lib/db";
import { importarOSPdf } from "@/lib/db-os-agr";
import { podeEditar } from "@/lib/permissoes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** O relatório inteiro (~2,5 mil O.S.) dá uns 5 MB de JSON; acima disso, algo está errado. */
const MAX_BYTES = 60 * 1024 * 1024;

/**
 * Importa o relatório "OS - Ordem de Serviço" em PDF, lido no navegador (lib/ler-os-pdf.js). O corpo é o JSON
 * { arquivo, geradoEm, paginas, avisos, ordens, aplicar, removerAusentes }, de preferência compactado (gzip). Sem
 * `aplicar`, só confere contra a base e devolve a prévia; com `aplicar`, grava (e, com `removerAusentes`, tira da base as
 * O.S. do período que não vieram no arquivo).
 */
export async function POST(req) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario || !podeEditar(usuario.perfil)) {
    return NextResponse.json({ error: "Você não tem permissão para importar a base de O.S." }, { status: 403 });
  }
  let corpo;
  try {
    let buf = Buffer.from(await req.arrayBuffer());
    // gzip: 1f 8b
    if (buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b) buf = gunzipSync(buf, { maxOutputLength: MAX_BYTES });
    if (buf.length > MAX_BYTES) throw new Error("grande demais");
    corpo = JSON.parse(buf.toString("utf8"));
  } catch {
    return NextResponse.json({ error: "Não foi possível ler os dados do relatório enviados." }, { status: 400 });
  }
  if (!corpo || !Array.isArray(corpo.ordens)) {
    return NextResponse.json({ error: "Envie o relatório OS - Ordem de Serviço (PDF)." }, { status: 400 });
  }
  try {
    const aplicar = corpo.aplicar === true;
    const r = await importarOSPdf(corpo, usuario.nome, aplicar, corpo.removerAusentes === true);
    if (r.erro) return NextResponse.json({ error: r.erro }, { status: 400 });
    return NextResponse.json({ aplicado: aplicar, ...r });
  } catch (e) {
    return NextResponse.json({ error: `Não foi possível importar: ${e instanceof Error ? e.message : String(e)}` }, { status: 500 });
  }
}
