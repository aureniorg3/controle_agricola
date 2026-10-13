import { NextResponse } from "next/server";
import { usuarioDaRequisicao } from "@/lib/db";
import { importarTalhoes } from "@/lib/db-talhoes";
import { lerRelatorioTalhoes } from "@/lib/import-talhoes";
import { podeEditar } from "@/lib/permissoes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Relatório de Talhões I: `aplicar` = "0" devolve a prévia; "1" substitui a safra do arquivo na base Fazenda e Talhões. */
export async function POST(req) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario || !podeEditar(usuario.perfil)) {
    return NextResponse.json({ error: "Você não tem permissão para importar a base Fazenda e Talhões." }, { status: 403 });
  }
  let form;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Não foi possível ler o arquivo enviado." }, { status: 400 });
  }
  const arquivo = form.get("arquivo");
  if (!arquivo || typeof arquivo === "string") return NextResponse.json({ error: "Anexe o Relatório de Talhões (.xlsx)." }, { status: 400 });
  let lido;
  try {
    lido = await lerRelatorioTalhoes(await arquivo.arrayBuffer());
  } catch (e) {
    console.error("Leitura do Relatório de Talhões:", e);
    return NextResponse.json({ error: "Não foi possível ler o arquivo. Confira se é o Relatório de Talhões I (.xlsx)." }, { status: 400 });
  }
  if (lido.erro) return NextResponse.json({ error: lido.erro }, { status: 400 });
  const aplicar = form.get("aplicar") === "1";
  try {
    return NextResponse.json(await importarTalhoes(lido, arquivo.name, usuario.nome, aplicar));
  } catch (e) {
    console.error("Importação do Relatório de Talhões:", e);
    return NextResponse.json(
      { error: `Não foi possível ${aplicar ? "gravar" : "conferir"} a base Fazenda e Talhões: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 },
    );
  }
}
