import { NextRequest, NextResponse } from "next/server";
import { auditar } from "@/lib/auditar";
import { getPool, listMetas, listOrdens, salvarMeta, usuarioDaRequisicao } from "@/lib/db";
import { lerMetas, type MetaImportada } from "@/lib/metas-import";
import { podeEditar } from "@/lib/permissoes";

export const runtime = "nodejs";

const MAX_ARQUIVOS = 10;

/**
 * Importa metas por frente de planilha (Frente, Meta (t/dia), Data). Cada
 * linha cria a meta daquela frente na data ou, se já existir, atualiza o
 * valor; as demais metas continuam como estão.
 */
export async function POST(req: NextRequest) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario || !podeEditar(usuario.perfil)) {
    return NextResponse.json({ error: "Você não tem permissão para importar metas." }, { status: 403 });
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
  const porChave = new Map<string, MetaImportada>();
  for (const arq of arquivos) {
    try {
      const lido = lerMetas(await arq.arrayBuffer());
      if (lido.erros.length > 0) {
        return NextResponse.json({ error: `"${arq.name}": ${lido.erros.join(" ")}` }, { status: 400 });
      }
      avisos.push(...lido.avisos.map((a) => (arquivos.length > 1 ? `${arq.name}: ${a}` : a)));
      for (const m of lido.metas) porChave.set(`${m.frente}|${m.vigencia}`, m);
    } catch (e) {
      return NextResponse.json(
        { error: `Não foi possível ler "${arq.name}": ${e instanceof Error ? e.message : String(e)}` },
        { status: 400 }
      );
    }
  }

  const existentes = new Set((await listMetas()).map((m) => `${m.frente}|${m.vigencia}`));
  let novas = 0;
  let atualizadas = 0;
  for (const m of porChave.values()) {
    if (existentes.has(`${m.frente}|${m.vigencia}`)) atualizadas++;
    else novas++;
    await salvarMeta(m.frente, m.metaDiaT, m.vigencia, usuario.nome);
  }

  await auditar(getPool(), {
    usuario: usuario.nome,
    modulo: "Colheita",
    entidade: "Metas",
    chave: `Importação de ${arquivos.map((a) => a.name).join(", ")}`,
    acao: "importacao",
    depois: { lidas: porChave.size, novas, atualizadas },
  });

  // frentes da planilha que não aparecem em nenhuma ordem importada (provável diferença de nome)
  const frentesOrdens = new Set((await listOrdens()).map((o) => o.frente));
  if (frentesOrdens.size > 0) {
    const desconhecidas = [...new Set([...porChave.values()].map((m) => m.frente))].filter((f) => !frentesOrdens.has(f));
    if (desconhecidas.length > 0) {
      avisos.push(
        `Frente(s) sem ordem importada com esse nome: ${desconhecidas.join(", ")}. Confira se o nome é igual ao das Ordens de Corte.`
      );
    }
  }

  return NextResponse.json({ ok: true, lidas: porChave.size, novas, atualizadas, avisos });
}
