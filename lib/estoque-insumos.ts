/** Tipos e regras (sem banco) de Insumos › Estoque Insumos (Relatório de Estoque Físico do sistema). */

/** Um produto num retrato de estoque (empresa + data do relatório). */
export interface ItemEstoque {
  grp: string;
  cod: string;
  ds: string;
  un: string;
  /** estoque real e o valor dele (custo médio atual) */
  est: number;
  vr: number;
  /** disponível e o valor dele */
  disp: number;
  vrDisp: number;
}

/** Linha do relatório (somando as empresas escolhidas). */
export interface LinhaEstoque {
  grp: string;
  grpDs: string;
  cod: string;
  ds: string;
  un: string;
  est: number;
  disp: number;
  /** disponível − real */
  dif: number;
  vr: number;
  /** valor unitário = valor total ÷ estoque real */
  vlrUnit: number | null;
  /** dosagem por ha: a da planilha de estoque (histórico); sem ela, Insumos › Dosagens (máxima) */
  dose: number | null;
  doseOrigem: "dosagens" | "historico" | null;
  /** hectares que o estoque real cobre (estoque real ÷ dose), como na planilha */
  ha: number | null;
  /** disponível na data anterior com relatório (para a variação) */
  dispAnterior: number | null;
}

export interface RelatorioEstoque {
  dt: string | null;
  dtAnterior: string | null;
  /** datas com relatório (mais recente primeiro) */
  datas: string[];
  empresas: number[];
  grupos: { grp: string; ds: string }[];
  linhas: LinhaEstoque[];
  ultimaImportacao: string | null;
}

/** Grupos do relatório "Estoque Herbicida" da planilha (herbicidas e adjuvantes). */
export const GRUPOS_PADRAO_ESTOQUE = ["01.02.15", "01.02.16"];

export const round = (n: number, c = 2) => Math.round(n * 10 ** c) / 10 ** c;

export function totaisEstoque(linhas: LinhaEstoque[]) {
  return linhas.reduce(
    (a, l) => ({ est: a.est + l.est, disp: a.disp + l.disp, dif: a.dif + l.dif, vr: a.vr + l.vr, ha: a.ha + (l.ha ?? 0) }),
    { est: 0, disp: 0, dif: 0, vr: 0, ha: 0 }
  );
}
