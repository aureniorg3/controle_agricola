import { buscarCodigo } from "./db-rodadas";
import type { CadastroSpec, DadosCadastro } from "./cadastros-spec";

/**
 * Colunas de um cadastro que apontam para outro cadastro (ex.: Região em
 * Responsável Região). O código informado é conferido no cadastro de origem,
 * gravado como ele está lá e a descrição vai junto (`<coluna>_nm`), para
 * aparecer na lista. Se o cadastro de origem ainda estiver vazio, o código
 * digitado é aceito. Devolve a mensagem de erro, ou null se estiver tudo certo.
 */
export async function resolverReferencias(spec: CadastroSpec, dados: DadosCadastro): Promise<string | null> {
  for (const col of spec.colunas) {
    if (!col.ref) continue;
    const valor = String(dados[col.chave] ?? "").trim();
    if (!valor) {
      delete dados[`${col.chave}_nm`];
      for (const k of Object.keys(col.traz ?? {})) delete dados[k];
      continue;
    }
    const r = await buscarCodigo(col.ref, valor);
    if (!r.item) {
      if (r.cadastroComItens) return `${col.rotulo}: código ${valor} não cadastrado.`;
      dados[`${col.chave}_nm`] = "";
      continue;
    }
    dados[col.chave] = r.item.cod;
    dados[`${col.chave}_nm`] = r.item.nm;
    for (const [k, campo] of Object.entries(col.traz ?? {})) dados[k] = String(r.item.dds?.[campo] ?? "");
  }
  return null;
}
