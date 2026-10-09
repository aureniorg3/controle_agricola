import { NextResponse } from "next/server";
import yauzl from "yauzl";
import { usuarioDaRequisicao } from "@/lib/db";
import { previaWhatsapp } from "@/lib/db-import-whatsapp";
import { extrairApontamentos, lerMensagens } from "@/lib/import-whatsapp";
import { podeEditar } from "@/lib/permissoes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Texto da conversa: o .txt direto ou o _chat.txt de dentro do .zip exportado pelo WhatsApp. */
async function textoDaConversa(arquivo) {
  const buf = Buffer.from(await arquivo.arrayBuffer());
  if (!/\.zip$/i.test(arquivo.name)) return buf.toString("utf8");
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buf, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err ?? new Error("Arquivo .zip inválido."));
      let achou = false;
      zip.on("entry", (entry) => {
        if (achou || !/\.txt$/i.test(entry.fileName)) return zip.readEntry();
        achou = true;
        zip.openReadStream(entry, (e, stream) => {
          if (e || !stream) return reject(e ?? new Error("Não foi possível ler a conversa do .zip."));
          const partes = [];
          stream.on("data", (c) => partes.push(c));
          stream.on("end", () => {
            zip.close();
            resolve(Buffer.concat(partes).toString("utf8"));
          });
          stream.on("error", reject);
        });
      });
      zip.on("end", () => !achou && reject(new Error("O .zip não tem a conversa (.txt) exportada do WhatsApp.")));
      zip.readEntry();
    });
  });
}

/** Prévia: lê a conversa exportada do WhatsApp e mostra os apontamentos (a partir de `desde`, pela data da operação). */
export async function POST(req) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario || !podeEditar(usuario.perfil)) return NextResponse.json({ error: "Você não tem permissão para importar apontamentos." }, { status: 403 });
  let form;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Não foi possível ler o arquivo enviado." }, { status: 400 });
  }
  const arquivo = form.get("arquivo");
  if (!arquivo || typeof arquivo === "string") return NextResponse.json({ error: "Anexe a conversa exportada do WhatsApp (.zip ou .txt)." }, { status: 400 });
  const desde = String(form.get("desde") ?? "");
  const ate = String(form.get("ate") ?? "");
  try {
    const mensagens = lerMensagens(await textoDaConversa(arquivo));
    if (mensagens.length === 0) return NextResponse.json({ error: "O arquivo não parece uma conversa exportada do WhatsApp." }, { status: 400 });
    let itens = extrairApontamentos(mensagens, ISO.test(desde) ? desde : "");
    if (ISO.test(ate)) itens = itens.filter((i) => i.dt <= ate);
    const previa = await previaWhatsapp(itens.slice(0, 3000));
    return NextResponse.json({ ...previa, mensagens: mensagens.length, periodo: { de: mensagens[0].data, ate: mensagens[mensagens.length - 1].data } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Não foi possível ler a conversa." }, { status: 400 });
  }
}
