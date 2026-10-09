import { NextResponse } from "next/server";
import { usuarioDaRequisicao } from "@/lib/db";
import { importarSaldoDia, snapshotsExistentes } from "@/lib/db-insumos";
import { lerSaldoInsumos, previaArquivo } from "@/lib/import-saldo-insumos";
import { EMPRESAS } from "@/lib/insumos-saldo";
import { podeEditar } from "@/lib/permissoes";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_ARQUIVOS = 6;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Importa o relatório diário de saldo (um arquivo por empresa). Sem `confirmar`, só devolve a prévia (empresa e
 * data sugeridas); com `confirmar=1`, grava usando `empresa_N` e `data_N` de cada arquivo `arquivo_N` — o retrato
 * da mesma empresa e data é substituído, os demais dias do histórico ficam intactos.
 */
export async function POST(req) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario || !podeEditar(usuario.perfil)) {
    return NextResponse.json({ error: "Você não tem permissão para importar o saldo de insumos." }, { status: 403 });
  }
  let form;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Não foi possível ler os arquivos enviados." }, { status: 400 });
  }
  const arquivos = form.getAll("arquivos").filter((v) => typeof v !== "string" && v.size > 0);
  if (arquivos.length === 0) return NextResponse.json({ error: "Envie o relatório de saldo (um arquivo por empresa)." }, { status: 400 });
  if (arquivos.length > MAX_ARQUIVOS) return NextResponse.json({ error: `Envie no máximo ${MAX_ARQUIVOS} arquivos por vez.` }, { status: 400 });

  const lidos = await Promise.all(
    arquivos.map(async (a) => {
      const r = lerSaldoInsumos(await a.arrayBuffer());
      return { nome: a.name, ...r };
    }),
  );

  if (form.get("confirmar") !== "1") {
    const previas = lidos.map((l) => previaArquivo(l.nome, l.linhas, l.erro));
    const existentes = await snapshotsExistentes(previas.filter((p) => !p.erro).map((p) => ({ empresa: p.empresaSugerida, data: p.dataSugerida })));
    return NextResponse.json({
      previas: previas.map((p) => ({ ...p, jaExiste: existentes.has(`${p.empresaSugerida}|${p.dataSugerida}`) })),
    });
  }

  const escolhas = lidos.map((l, i) => ({
    ...l,
    empresa: Number(form.get(`empresa_${i}`)),
    data: String(form.get(`data_${i}`) ?? ""),
  }));
  for (const e of escolhas) {
    if (e.erro) return NextResponse.json({ error: `${e.nome}: ${e.erro}` }, { status: 400 });
    if (!EMPRESAS.some((x) => x.id === e.empresa)) return NextResponse.json({ error: `${e.nome}: escolha a empresa.` }, { status: 400 });
    if (!ISO.test(e.data) || Number.isNaN(Date.parse(e.data))) return NextResponse.json({ error: `${e.nome}: informe a data base.` }, { status: 400 });
  }
  const repetidos = new Set();
  for (const e of escolhas) {
    const k = `${e.empresa}|${e.data}`;
    if (repetidos.has(k)) return NextResponse.json({ error: "Dois arquivos estão com a mesma empresa e data: confira a empresa de cada um." }, { status: 400 });
    repetidos.add(k);
  }
  const resultados = [];
  for (const e of escolhas) resultados.push(await importarSaldoDia(e.empresa, e.data, e.linhas, usuario.nome));
  return NextResponse.json({ ok: true, resultados });
}
