/** Tipos e regras (sem banco) de Insumos › Estoque Insumos (Relatório de Estoque Físico do sistema). */

/** Um produto num retrato de estoque (empresa + data do relatório). */

/** Linha do relatório (somando as empresas escolhidas). */

/** Grupos do relatório "Estoque Herbicida" da planilha (herbicidas e adjuvantes). */
export const GRUPOS_PADRAO_ESTOQUE = ["01.02.15", "01.02.16"];

export const round = (n, c = 2) => Math.round(n * 10 ** c) / 10 ** c;

export function totaisEstoque(linhas) {
  return linhas.reduce((a, l) => ({ est: a.est + l.est, disp: a.disp + l.disp, dif: a.dif + l.dif, vr: a.vr + l.vr, ha: a.ha + (l.ha ?? 0) }), {
    est: 0,
    disp: 0,
    dif: 0,
    vr: 0,
    ha: 0,
  });
}
