import { buscarCodigo } from "./db-rodadas";
import { getPool } from "./db";
import { specPorSlug } from "./cadastros-spec";

const semZeros = (v) => (/^\d+$/.test(v) ? v.replace(/^0+(?=\d)/, "") : v);

/** Nome comparável: sem acento, maiúsculas e espaços simples ("Catação  química" = "CATACAO QUIMICA"). */
export const nomeComparavel = (s) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();

/** Item de um cadastro pelo nome (para colunas que aceitam o nome no lugar do código, ex.: o grupo numa planilha). */
async function itemPorNome(cad, nome) {
  const alvo = nomeComparavel(nome);
  if (!alvo) return null;
  const { rows } = await getPool().query("SELECT cod, nm, dds FROM cad_itm WHERE cad = $1", [cad]);
  return rows.find((r) => nomeComparavel(r.nm) === alvo) ?? null;
}

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
 * Colunas `refLivre` não são conferidas (a descrição só aparece na lista, lida na hora); colunas `aceitaNome` aceitam
 * também o nome do item (ex.: o nome do grupo numa planilha) e guardam o código.
 */
export async function resolverReferencias(spec, dados) {
  const cache = new Map();
  for (const col of spec.colunas) {
    if (!col.ref || col.refLivre) continue;
    // coluna que não veio (ex.: a chave numa edição): o que está gravado fica como está
    if (!(col.chave in dados)) continue;
    const valor = String(dados[col.chave] ?? "").trim();
    if (!valor) {
      // referência apagada: a descrição e o que vinha junto também (a gravação junta com o que já está no item)
      dados[`${col.chave}_nm`] = "";
      for (const k of Object.keys(col.traz ?? {})) dados[k] = "";
      continue;
    }
    const r = await buscarCodigo(col.ref, valor);
    if (!r.item && col.aceitaNome) r.item = await itemPorNome(col.ref, valor);
    if (!r.item) {
      if (r.cadastroComItens) {
        return col.aceitaNome
          ? `${col.rotulo}: ${valor} não está no cadastro ${specPorSlug(col.ref)?.titulo ?? col.ref} (nem como código, nem como nome).`
          : `${col.rotulo}: código ${valor} não cadastrado.`;
      }
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

/**
 * Cadastros com `nomeUnico` (ex.: Grupo Op. Dashboard): todo item tem nome e o mesmo nome não fica em dois códigos —
 * nem com outra grafia ("CATAÇAO QUIMICA" = "CATAÇÃO QUÍMICA"), que é o que o cadastro existe para evitar. Recebe os
 * itens a gravar (`{ cod, nm }`) e devolve os que podem entrar e os recusados (`{ cod, erro }`); o item já gravado com
 * o mesmo código (que vai ser substituído) não conta.
 */
export async function separarNomesRepetidos(spec, itens) {
  if (!spec.nomeUnico) return { validos: itens, recusados: [] };
  const { rows } = await getPool().query("SELECT cod, nm FROM cad_itm WHERE cad = $1", [spec.slug]);
  const doLote = new Set(itens.map((i) => semZeros(String(i.cod).trim())));
  const dono = new Map();
  for (const r of rows) {
    const k = nomeComparavel(r.nm);
    if (k && !doLote.has(semZeros(r.cod)) && !dono.has(k)) dono.set(k, r);
  }
  // quem já tem o nome no cadastro (mesmo código, mesmo nome) passa primeiro: o código novo com o nome dele é que fica de fora
  const nomeAtual = new Map(rows.map((r) => [semZeros(r.cod), nomeComparavel(r.nm)]));
  const mantem = (it) => nomeAtual.get(semZeros(String(it.cod).trim())) === nomeComparavel(it.nm);
  const validos = [];
  const recusados = [];
  for (const it of [...itens.filter(mantem), ...itens.filter((it) => !mantem(it))]) {
    const k = nomeComparavel(it.nm);
    if (!k) {
      recusados.push({ cod: it.cod, erro: "preencha o nome." });
      continue;
    }
    const outro = dono.get(k);
    if (outro && semZeros(String(outro.cod).trim()) !== semZeros(String(it.cod).trim())) {
      recusados.push({ cod: it.cod, erro: `${it.nm} já está cadastrado no código ${outro.cod} (${outro.nm}).` });
      continue;
    }
    dono.set(k, { cod: it.cod, nm: it.nm });
    validos.push(it);
  }
  return { validos, recusados };
}
