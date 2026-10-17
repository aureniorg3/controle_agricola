import { NextResponse } from "next/server";
import { usuarioDaRequisicao } from "@/lib/db";
import { anexarArquivo, excluirAnexo, listarAnexos, MAX_ANEXO, obterAnexo } from "@/lib/db-emprestimos";
import { podeEditar } from "@/lib/permissoes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const inteiro = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/**
 * Anexos da Solicitação de empréstimo (o comunicado assinado e outros arquivos):
 *   GET ?emp=<id>   a lista (sem o conteúdo)
 *   GET ?id=<id>    o arquivo, para abrir no navegador (`&baixar=1` baixa)
 */
export async function GET(req) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario) return NextResponse.json({ error: "Sessão expirada. Entre novamente." }, { status: 401 });
  const p = req.nextUrl.searchParams;
  const id = inteiro(p.get("id"));
  if (id) {
    const a = await obterAnexo(id);
    if (!a) return NextResponse.json({ error: "Anexo não encontrado." }, { status: 404 });
    const nome = encodeURIComponent(a.nome);
    return new Response(new Uint8Array(a.dados), {
      headers: {
        "Content-Type": a.tipo,
        "Content-Length": String(a.dados.length),
        "Content-Disposition": `${p.get("baixar") ? "attachment" : "inline"}; filename*=UTF-8''${nome}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
  const emp = inteiro(p.get("emp"));
  if (!emp) return NextResponse.json({ error: "Informe a solicitação." }, { status: 400 });
  return NextResponse.json({ anexos: await listarAnexos(emp) });
}

/** Anexa um arquivo (campo `arquivo`) à Solicitação `emp`: PDF ou imagem, até 10 MB. */
export async function POST(req) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario || !podeEditar(usuario.perfil)) {
    return NextResponse.json({ error: "Você não tem permissão para anexar arquivos." }, { status: 403 });
  }
  let form;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Não foi possível ler o arquivo enviado." }, { status: 400 });
  }
  const emp = inteiro(form.get("emp"));
  const arquivo = form.get("arquivo");
  if (!emp) return NextResponse.json({ error: "Informe a solicitação." }, { status: 400 });
  if (!arquivo || typeof arquivo === "string") return NextResponse.json({ error: "Escolha o arquivo." }, { status: 400 });
  if (arquivo.size > MAX_ANEXO) {
    return NextResponse.json({ error: `O arquivo passa de ${MAX_ANEXO / 1024 / 1024} MB. Diminua a resolução da imagem ou do PDF.` }, { status: 400 });
  }
  const r = await anexarArquivo(emp, { nome: arquivo.name, tipo: arquivo.type, dados: Buffer.from(await arquivo.arrayBuffer()) }, usuario.nome);
  if ("erro" in r) return NextResponse.json({ error: r.erro }, { status: 400 });
  return NextResponse.json({ ok: true, id: r.id });
}

export async function DELETE(req) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario || !podeEditar(usuario.perfil)) {
    return NextResponse.json({ error: "Você não tem permissão para excluir anexos." }, { status: 403 });
  }
  const b = await req.json().catch(() => null);
  const id = inteiro(b?.id);
  if (!id) return NextResponse.json({ error: "Informe o anexo." }, { status: 400 });
  const r = await excluirAnexo(id, usuario.nome);
  if (r !== true) return NextResponse.json({ error: r.erro }, { status: 404 });
  return NextResponse.json({ ok: true });
}
