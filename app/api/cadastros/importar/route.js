import { NextResponse } from "next/server";
import { auditar } from "@/lib/auditar";
import { getPool, sincronizarDescricaoFazendas, upsertCadastroLote, usuarioDaRequisicao } from "@/lib/db";
import { sincronizarGruposOperacoes } from "@/lib/db-dashboard-atividades";
import { specPorSlug } from "@/lib/cadastros-spec";
import { lerCadastro, lerCadastroGrande } from "@/lib/cadastros-import";
import { resolverReferencias, separarNomesRepetidos } from "@/lib/cadastros-ref";
import { podeEditar, podeIncluirCadastro } from "@/lib/permissoes";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_ARQUIVOS = 12;

/**
 * Importa planilhas de cadastro. Cada arquivo chega com o cadastro a que
 * pertence (`cad_i`, sugerido pelo nome do arquivo na tela); a planilha é
 * conferida pelo cabeçalho antes de gravar. Itens novos entram, os que já
 * existem (mesmo código) são atualizados e o resto do cadastro permanece.
 */
export async function POST(req) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario || !podeEditar(usuario.perfil)) {
    return NextResponse.json({ error: "Você não tem permissão para importar cadastros." }, { status: 403 });
  }
  if (!podeIncluirCadastro(usuario.perfil)) {
    return NextResponse.json(
      { error: "Seu perfil não inclui itens novos nos cadastros; peça a um usuário com perfil Gravação ou Administrador." },
      { status: 403 },
    );
  }

  let form;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Não foi possível ler os arquivos enviados." }, { status: 400 });
  }

  const resultados = [];
  for (let i = 0; i < MAX_ARQUIVOS; i++) {
    const arquivo = form.get(`arquivo_${i}`);
    if (!arquivo || typeof arquivo === "string") continue;
    const slug = String(form.get(`cad_${i}`) ?? "");
    const spec = specPorSlug(slug);
    const base = {
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
      // correção marcada na tela (ex.: Descrição Fazenda sem o número e o traço na frente)
      const ajustar = form.get(`ajustar_${i}`) === "1";
      const lido = spec.grande ? await lerCadastroGrande(await arquivo.arrayBuffer(), spec, ajustar) : lerCadastro(await arquivo.arrayBuffer(), spec, ajustar);
      if (lido.erros.length > 0) {
        resultados.push({ ...base, erro: lido.erros.join(" ") });
        continue;
      }
      // colunas que apontam para outro cadastro (ex.: Região) são conferidas; linhas com código inexistente ficam de fora
      // (as `refLivre`, como o Tipo em Operações, não são conferidas)
      const avisos = [...lido.avisos];
      let itens = lido.itens;
      if (spec.colunas.some((c) => c.ref && !c.refLivre)) {
        const validos = new Map();
        const recusados = [];
        let juntadas = 0;
        for (const it of itens) {
          const erroRef = await resolverReferencias(spec, it.dados);
          if (erroRef) {
            recusados.push(`${it.cod}: ${erroRef}`);
            continue;
          }
          // código e nome refeitos com a referência já resolvida: a operação como está no cadastro Operações ("045" → "45")
          // e o nome do grupo do Grupo Op. Dashboard, não o texto/código digitado na planilha
          const cod = spec.codigo(it.dados) || it.cod;
          if (validos.has(cod)) juntadas++;
          validos.set(cod, { ...it, cod, nm: spec.nome(it.dados) });
        }
        if (recusados.length > 0) {
          avisos.push(`${recusados.length} linha(s) não importada(s): ${recusados.slice(0, 5).join(" | ")}${recusados.length > 5 ? "…" : ""}`);
        }
        if (juntadas > 0) avisos.push(`${juntadas} linha(s) com o mesmo código depois de conferido no cadastro de origem — valeu a última de cada.`);
        itens = [...validos.values()];
      }
      // nome que já está em outro código (ex.: o mesmo grupo com outra grafia no Grupo Op. Dashboard)
      const nomes = await separarNomesRepetidos(spec, itens);
      if (nomes.recusados.length > 0) {
        avisos.push(
          `${nomes.recusados.length} linha(s) não importada(s): ${nomes.recusados
            .slice(0, 5)
            .map((r) => `${r.cod}: ${r.erro}`)
            .join(" | ")}${nomes.recusados.length > 5 ? "…" : ""}`,
        );
        itens = nomes.validos;
      }
      const { novos, atualizados } = await upsertCadastroLote(spec.slug, itens, usuario.nome);
      await auditar(getPool(), {
        usuario: usuario.nome,
        modulo: "Cadastros",
        entidade: `Cadastro de ${spec.titulo}`,
        chave: `Importação de ${arquivo.name}`,
        acao: "importacao",
        depois: { lidos: itens.length, novos, atualizados, ajuste: ajustar && spec.ajuste ? spec.ajuste.rotulo : undefined },
      });
      if (spec.slug === "grupos-dashboard") await sincronizarGruposOperacoes();
      if (spec.slug === "fazendas") {
        const sinc = await sincronizarDescricaoFazendas();
        const total = sinc.reduce((a, x) => a + x.linhas, 0);
        if (total > 0)
          avisos.push(`Descrição Fazenda atualizada em ${total.toLocaleString("pt-BR")} registro(s) do sistema (${sinc.map((x) => x.rotulo).join(", ")}).`);
      }
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
