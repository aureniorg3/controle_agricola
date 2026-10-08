import { NextRequest, NextResponse } from "next/server";
import { usuarioDaRequisicao } from "@/lib/db";
import { importarEstoque } from "@/lib/db-estoque";
import { lerEstoqueFisico } from "@/lib/import-estoque";
import { podeEditar } from "@/lib/permissoes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Importa um ou mais "Relatório de Estoque Físico": cada arquivo substitui o retrato da sua empresa + data. */
export async function POST(req: NextRequest) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario || !podeEditar(usuario.perfil)) return NextResponse.json({ error: "Você não tem permissão para importar o estoque." }, { status: 403 });
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Não foi possível ler os arquivos enviados." }, { status: 400 });
  }
  const arquivos = form.getAll("arquivo").filter((v): v is File => typeof v !== "string" && v.size > 0).slice(0, 10);
  if (arquivos.length === 0) return NextResponse.json({ error: "Anexe o Relatório de Estoque Físico (.xlsx)." }, { status: 400 });
  const resultados: { arquivo: string; ok: boolean; emp?: number; dt?: string; itens?: number; substituiu?: number; erro?: string }[] = [];
  for (const a of arquivos) {
    try {
      const lido = lerEstoqueFisico(await a.arrayBuffer());
      if (lido.erro || !lido.emp || !lido.dt) {
        resultados.push({ arquivo: a.name, ok: false, erro: lido.erro ?? "Arquivo sem empresa ou data." });
        continue;
      }
      const r = await importarEstoque(lido.emp, lido.dt, lido.itens, usuario.nome, a.name);
      resultados.push({ arquivo: a.name, ok: true, emp: lido.emp, dt: lido.dt, ...r });
    } catch (e) {
      resultados.push({ arquivo: a.name, ok: false, erro: `Não foi possível ler: ${e instanceof Error ? e.message : String(e)}` });
    }
  }
  return NextResponse.json({ resultados });
}
