import { NextRequest, NextResponse } from "next/server";
import { usuarioDaRequisicao } from "@/lib/db";
import { importarOSAgr } from "@/lib/db-os-agr";
import { lerOSAgr } from "@/lib/import-os-agr";
import { podeEditar } from "@/lib/permissoes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Importa o Relatório de Ordens de Serviço. Com `aplicar` diferente de "1" só confere o arquivo contra a base e devolve a
 * prévia (O.S. novas, com alteração e iguais); com "1" grava: novas entram, alteradas são substituídas, o resto fica.
 */
export async function POST(req: NextRequest) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario || !podeEditar(usuario.perfil)) {
    return NextResponse.json({ error: "Você não tem permissão para importar a base de O.S." }, { status: 403 });
  }
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Não foi possível ler o arquivo enviado." }, { status: 400 });
  }
  const arquivo = form.get("arquivo");
  if (!arquivo || typeof arquivo === "string") return NextResponse.json({ error: "Anexe o Relatório de Ordens de Serviço (.xlsx)." }, { status: 400 });
  try {
    const lido = await lerOSAgr(await arquivo.arrayBuffer());
    if (lido.erro) return NextResponse.json({ error: lido.erro }, { status: 400 });
    const aplicar = form.get("aplicar") === "1";
    const previa = await importarOSAgr(lido.linhas, { repetidas: lido.repetidas, periodo: lido.periodo, arquivo: arquivo.name }, usuario.nome, aplicar);
    return NextResponse.json({ aplicado: aplicar, ...previa });
  } catch (e) {
    return NextResponse.json({ error: `Não foi possível ler o arquivo: ${e instanceof Error ? e.message : String(e)}` }, { status: 400 });
  }
}
