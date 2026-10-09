import { buscarCodigo } from "./db-rodadas";
import { getPool } from "./db";

const semZeros = (v) => (/^\d+$/.test(v) ? v.replace(/^0+(?=\d)/, "") : v);

/** Itens de um cadastro pelos códigos (1 = 01), de uma vez. */
async function itensPorCodigo(cad, codigos) {
  const lista = [...new Set(codigos.map((c) => c.trim()).filter(Boolean))];
  if (!lista.length) return new Map();
  const { rows } = await getPool().query(
    `SELECT cod, nm, dds FROM cad_itm WHERE cad = $1 AND (cod = ANY($2::text[]) OR (cod ~ '^[0-9]+$' AND ltrim(cod, '0') = ANY($3::text[])))`,
    [cad, lista, lista.map(semZeros)],
  );
  return new Map(rows.map((r) => [semZeros(r.cod), r]));
}

/** Campos que vêm junto do item referenciado: um campo dele, ou o nome do código guardado nele em outro cadastro. */
async function preencherTraz(traz, item, dados, cache) {
  for (const [k, origem] of Object.entries(traz)) {
    if (typeof origem === "string") {
      dados[k] = String(item.dds?.[origem] ?? "");
      continue;
    }
    const cod = String(item.dds?.[origem.campo] ?? "").trim();
    const chave = `${origem.ref}|${cod}`;
    if (!cache.has(chave)) cache.set(chave, await itensPorCodigo(origem.ref, [cod]));
    dados[k] = cache.get(chave).get(semZeros(cod))?.nm ?? String(item.dds?.[`${origem.campo}_nm`] ?? "");
  }
}

/**
 * Colunas de um cadastro que apontam para outro cadastro (ex.: Região em
 * Responsável Região). O código informado é conferido no cadastro de origem,
 * gravado como ele está lá e a descrição vai junto (`<coluna>_nm`), para
 * aparecer na lista. Se o cadastro de origem ainda estiver vazio, o código
 * digitado é aceito. Devolve a mensagem de erro, ou null se estiver tudo certo.
 */
export async function resolverReferencias(spec, dados) {
  const cache = new Map();
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
    if (col.traz) await preencherTraz(col.traz, r.item, dados, cache);
  }
  return null;
}

/**
 * Na lista, a descrição das referências (e o que vem junto, como a Classificação da Operação) é lida na hora do
 * cadastro de origem — assim acompanha o que mudou lá depois (ex.: Operações importadas de novo).
 */
export async function atualizarReferenciasDaLista(spec, itens) {
  const cache = new Map();
  for (const col of spec.colunas) {
    if (!col.ref) continue;
    const mapa = await itensPorCodigo(
      col.ref,
      itens.map((i) => String(i.dados[col.chave] ?? "")),
    );
    for (const i of itens) {
      const ref = mapa.get(semZeros(String(i.dados[col.chave] ?? "").trim()));
      if (!ref) continue;
      i.dados[`${col.chave}_nm`] = ref.nm;
      if (col.traz) await preencherTraz(col.traz, ref, i.dados, cache);
    }
  }
}
