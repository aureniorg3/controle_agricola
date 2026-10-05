/** Tipos e regras (sem banco) do módulo Insumos › Empréstimos. */

export type StatusEmprestimo = "Aberto" | "Devolvido" | "Pago";

export interface ItemEmprestimo {
  cod: string;
  nm: string;
  um: string;
  dose: number | null;
  qtd: number;
  vu: number;
  vt: number;
}

export interface FazendaEmprestimo {
  cod: string;
  nome: string;
  area: number | null;
}

export interface Emprestimo {
  id: number;
  fornCod: string;
  fornNm: string;
  /** CPF ou CNPJ do destinatário */
  doc: string;
  /** data da saída do insumo (data do comunicado) */
  dt: string | null;
  dtSol: string | null;
  faz: FazendaEmprestimo[];
  /** "Volume de Calda: 18.800 lt" / "Volume de Insumo: 58 ton" — texto livre depois dos dois-pontos */
  vol: string;
  volTipo: "Calda" | "Insumo";
  assin: string[];
  itens: ItemEmprestimo[];
  total: number;
  obs: string;
  status: StatusEmprestimo;
  dtBaixa: string | null;
  baixaObs: string;
  ref: string;
  usr: string;
  criEm: string;
  atuUsr: string | null;
  atuEm: string | null;
}

export const ASSINANTES_PADRAO = ["Weslei Silva Zazenon", "Cloves Rodrigues de Oliveira Junior", "Leonardo Dias de Almeida"];

export const round2 = (n: number) => Math.round(n * 100) / 100;

/** Valor total de uma linha: quantidade × valor unitário. */
export const totalItem = (qtd: number, vu: number) => round2(qtd * vu);

export interface EntradaEmprestimo {
  fornCod: string;
  fornNm: string;
  doc: string;
  dt: string | null;
  dtSol: string | null;
  faz: FazendaEmprestimo[];
  vol: string;
  volTipo: "Calda" | "Insumo";
  assin: string[];
  itens: Omit<ItemEmprestimo, "vt">[];
  obs: string;
}

const DATA = /^\d{4}-\d{2}-\d{2}$/;

/** Confere o formulário e devolve o texto do erro (ou null). */
export function validarEmprestimo(e: EntradaEmprestimo, exigirSolicitacao: boolean): string | null {
  if (!e.fornNm.trim()) return "Informe o destinatário (fornecedor).";
  if (!e.fornCod.trim()) return "Informe a matrícula/código do fornecedor.";
  if (exigirSolicitacao && !(e.dtSol && DATA.test(e.dtSol))) return "Informe a data da solicitação.";
  if (e.dtSol && !DATA.test(e.dtSol)) return "Data da solicitação inválida.";
  if (e.dt && !DATA.test(e.dt)) return "Data da saída inválida.";
  if (e.faz.length === 0 || e.faz.some((f) => !f.cod.trim())) return "Informe ao menos uma fazenda (código) de aplicação.";
  if (e.itens.length === 0) return "Inclua ao menos um insumo.";
  for (const [i, it] of e.itens.entries()) {
    if (!it.cod.trim() || !it.nm.trim()) return `Insumo ${i + 1}: informe o código e a descrição.`;
    if (!it.um.trim()) return `Insumo ${i + 1}: informe a unidade (U.M.).`;
    if (!(it.qtd > 0)) return `Insumo ${i + 1}: a quantidade deve ser maior que zero.`;
    if (!(it.vu >= 0)) return `Insumo ${i + 1}: valor unitário inválido.`;
  }
  return null;
}
