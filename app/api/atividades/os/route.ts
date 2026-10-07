import { NextRequest, NextResponse } from "next/server";
import { usuarioDaRequisicao } from "@/lib/db";
import { consultarOS, importarBaseOS, resumoBaseOS } from "@/lib/db-atividades";
import { lerBaseOS } from "@/lib/import-os";
import { podeEditar } from "@/lib/permissoes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** `?os=` devolve a O.S. com operações e talhões (e a área já apontada); sem parâmetro, o resumo da base. */
export async function GET(req: NextRequest) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario) return NextResponse.json({ error: "Sessão expirada. Entre novamente." }, { status: 401 });
  const os = req.nextUrl.searchParams.get("os");
  if (os === null) return NextResponse.json(await resumoBaseOS());
  const excluir = Number(req.nextUrl.searchParams.get("excluir"));
  const r = await consultarOS(os, Number.isInteger(excluir) && excluir > 0 ? excluir : undefined);
  if (!r) return NextResponse.json({ error: `O.S. ${os} não encontrada. Importe a base de O.S. atualizada (aqui ou em Ordem de Serviço Agr. › Ordens de Serviço).` }, { status: 404 });
  return NextResponse.json(r);
}

/** Importa a base de Acompanhamento de O.S.: as O.S. do arquivo são substituídas; as demais permanecem. */
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
  if (!arquivo || typeof arquivo === "string") return NextResponse.json({ error: "Anexe o arquivo da base de O.S." }, { status: 400 });
  const lido = await lerBaseOS(await arquivo.arrayBuffer());
  if (lido.erro) return NextResponse.json({ error: lido.erro }, { status: 400 });
  const r = await importarBaseOS(lido.linhas, usuario.nome);
  return NextResponse.json({ ok: true, ...r, lidas: lido.lidas });
}
