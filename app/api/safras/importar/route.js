import { NextResponse } from "next/server";
import { auditar } from "@/lib/auditar";
import { getPool, substituirSafra, usuarioDaRequisicao } from "@/lib/db";
import { parseSafra } from "@/lib/import-safra";
import { podeEditar } from "@/lib/permissoes";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_ARQUIVOS = 5;

export async function POST(req) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario || !podeEditar(usuario.perfil)) {
    return NextResponse.json({ error: "Você não tem permissão para importar arquivos." }, { status: 403 });
  }

  let form;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Não foi possível ler os arquivos enviados." }, { status: 400 });
  }

  const resultados = [];
  const usadas = new Set();

  for (let i = 0; i < MAX_ARQUIVOS; i++) {
    const arquivo = form.get(`arquivo_${i}`);
    const safraInformada = form.get(`safra_${i}`);
    if (!arquivo || typeof arquivo === "string") continue;

    const nome = arquivo.name;
    const safraTexto = typeof safraInformada === "string" ? safraInformada.trim() : "";
    const base = { nome, safra: safraTexto, ok: false, talhoes: 0, fazendas: 0, areaHa: 0, avisos: [] };

    const safra = Number(safraTexto);
    if (!Number.isInteger(safra) || safra < 2000 || safra > 2100) {
      resultados.push({ ...base, erro: "Informe a safra do arquivo (ano, ex.: 2025)." });
      continue;
    }
    if (usadas.has(safra)) {
      resultados.push({ ...base, erro: `A safra ${safra} foi informada em mais de um arquivo.` });
      continue;
    }
    usadas.add(safra);

    try {
      const lido = parseSafra(await arquivo.arrayBuffer());
      if (lido.erros.length > 0) {
        resultados.push({ ...base, erro: lido.erros.join(" ") });
        continue;
      }
      if (lido.safraArquivo !== null && lido.safraArquivo !== safra) {
        resultados.push({
          ...base,
          erro: `O arquivo é da safra ${lido.safraArquivo}, mas foi informada a safra ${safra}.`,
        });
        continue;
      }
      const linhas = lido.linhas.map((l) => ({ ...l, safra }));
      await substituirSafra(safra, linhas);
      await auditar(getPool(), {
        usuario: usuario.nome,
        modulo: "Colheita",
        entidade: "Histórico de Safras",
        chave: `Safra ${safra} (${arquivo.name})`,
        acao: "importacao",
        depois: { linhas: linhas.length },
      });
      resultados.push({
        ...base,
        ok: true,
        talhoes: new Set(linhas.map((l) => `${l.fazendaCodigo}|${l.talhao}`)).size,
        fazendas: new Set(linhas.map((l) => l.fazendaCodigo)).size,
        areaHa: Math.round(linhas.reduce((s, l) => s + l.areaTot, 0) * 100) / 100,
        avisos: lido.avisos,
      });
    } catch (e) {
      resultados.push({ ...base, erro: `Não foi possível ler o arquivo: ${e instanceof Error ? e.message : String(e)}` });
    }
  }

  if (resultados.length === 0) {
    return NextResponse.json({ error: "Anexe pelo menos um arquivo (até 5)." }, { status: 400 });
  }
  return NextResponse.json({ resultados });
}
