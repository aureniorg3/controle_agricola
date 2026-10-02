import type { SafraCadastro } from "./types";

/**
 * Safra cujo período de produção vale hoje: entre as que já começaram, prefere
 * a que ainda está em produção (industrial antes de agrícola e, no empate, a
 * mais recente); se nenhuma está em produção, a que começou por último.
 */
export function escolherSafraVigente(safras: SafraCadastro[], hoje: string): SafraCadastro | null {
  const iniciadas = safras.filter((s) => s.producaoInicio <= hoje);
  if (iniciadas.length === 0) return null;
  const emProducao = iniciadas.filter((s) => s.producaoFim >= hoje);
  const ordenar = (a: SafraCadastro, b: SafraCadastro) =>
    (a.tipo === b.tipo ? 0 : a.tipo === "IND" ? -1 : 1) || b.ano - a.ano || b.producaoInicio.localeCompare(a.producaoInicio);
  if (emProducao.length > 0) return [...emProducao].sort(ordenar)[0];
  return [...iniciadas].sort((a, b) => b.producaoInicio.localeCompare(a.producaoInicio) || ordenar(a, b))[0];
}
