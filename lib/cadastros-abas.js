/**
 * Filtro (SQL sobre cad_itm) de cada aba dos cadastros divididos em abas — fica só no servidor.
 * Material e Insumos: Insumos = grupos 01.02.00 a 01.02.35; Materiais = os demais (inclusive sem grupo).
 */
const GRUPO = "left(btrim(coalesce(dds->>'grupo_de_produto', '')), 8)";
const INSUMOS = `(${GRUPO} BETWEEN '01.02.00' AND '01.02.35')`;

export const FILTROS_ABA = {
  "materiais-insumos": {
    insumos: INSUMOS,
    materiais: `NOT ${INSUMOS}`,
  },
};

export function filtroDaAba(slug, aba) {
  return (aba && FILTROS_ABA[slug]?.[aba]) || "";
}
