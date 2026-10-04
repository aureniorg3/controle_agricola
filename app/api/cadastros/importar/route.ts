import { NextRequest, NextResponse } from "next/server";
import { upsertCadastroLote, usuarioDaRequisicao } from "@/lib/db";
import { specPorSlug } from "@/lib/cadastros-spec";
import { lerCadastro } from "@/lib/cadastros-import";
import { resolverReferencias } from "@/lib/cadastros-ref";
import { podeEditar } from "@/lib/permissoes";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_ARQUIVOS = 12;

interface ResultadoArquivo {
  nome: string;
  cadastro: string;
  titulo: string;
  ok: boolean;
  lidos: number;
  novos: number;
  atualizados: number;
  avisos: string[];
  erro?: string;
}

/**
 * Importa planilhas de cadastro. Cada arquivo chega com o cadastro a que
 * pertence (`cad_i`, sugerido pelo nome do arquivo na tela); a planilha é
 * conferida pelo cabeçalho antes de gravar. Itens novos entram, os que já
 * existem (mesmo código) são atualizados e o resto do cadastro permanece.
 */
export async function POST(req: NextRequest) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario || !podeEditar(usuario.perfil)) {
    return NextResponse.json({ error: "Você não tem permissão para importar cadastros." }, { status: 403 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Não foi possível ler os arquivos enviados." }, { status: 400 });
  }

  const resultados: ResultadoArquivo[] = [];
  for (let i = 0; i < MAX_ARQUIVOS; i++) {
    const arquivo = form.get(`arquivo_${i}`);
    if (!arquivo || typeof arquivo === "string") continue;
    const slug = String(form.get(`cad_${i}`) ?? "");
    const spec = specPorSlug(slug);
    const base: ResultadoArquivo = {
      nome: arquivo.name,
      cadastro: slug,
      titulo: spec?.titulo ?? slug,
      ok: false,
      lidos: 0,
      novos: 0,
      atualizados: 0,
      avisos: [],
    };
    if (!spec) {
      resultados.push({ ...base, erro: "Escolha a qual cadastro o arquivo pertence." });
      continue;
    }
    try {
      const lido = lerCadastro(await arquivo.arrayBuffer(), spec);
      if (lido.erros.length > 0) {
        resultados.push({ ...base, erro: lido.erros.join(" ") });
        continue;
      }
      // colunas que apontam para outro cadastro (ex.: Região) são conferidas; linhas com código inexistente ficam de fora
      const avisos = [...lido.avisos];
      let itens = lido.itens;
      if (spec.colunas.some((c) => c.ref)) {
        const validos: typeof itens = [];
        const recusados: string[] = [];
        for (const it of itens) {
          const erroRef = await resolverReferencias(spec, it.dados);
          if (erroRef) recusados.push(`${it.cod}: ${erroRef}`);
          else validos.push(it);
        }
        if (recusados.length > 0) {
          avisos.push(`${recusados.length} linha(s) não importada(s): ${recusados.slice(0, 5).join(" | ")}${recusados.length > 5 ? "…" : ""}`);
        }
        itens = validos;
      }
      const { novos, atualizados } = await upsertCadastroLote(spec.slug, itens);
      resultados.push({ ...base, ok: true, lidos: itens.length, novos, atualizados, avisos });
    } catch (e) {
      resultados.push({ ...base, erro: `Não foi possível ler o arquivo: ${e instanceof Error ? e.message : String(e)}` });
    }
  }

  if (resultados.length === 0) {
    return NextResponse.json({ error: "Anexe pelo menos um arquivo." }, { status: 400 });
  }
  return NextResponse.json({ resultados });
}
