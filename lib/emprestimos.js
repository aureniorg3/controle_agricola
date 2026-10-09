/** Tipos e regras (sem banco) do módulo Insumos › Empréstimos. */

export const ASSINANTES_PADRAO = ["Weslei Silva Zazenon", "Cloves Rodrigues de Oliveira Junior", "Leonardo Dias de Almeida"];

export const round2 = (n) => Math.round(n * 100) / 100;

/** Valor total de uma linha: quantidade × valor unitário. */
export const totalItem = (qtd, vu) => round2(qtd * vu);

const DATA = /^\d{4}-\d{2}-\d{2}$/;

/** Confere o formulário e devolve o texto do erro (ou null). */
export function validarEmprestimo(e, exigirSolicitacao) {
  if (exigirSolicitacao && !(e.boletim && e.boletim > 0)) return "Informe o número do boletim.";
  if (e.boletim !== null && (!Number.isInteger(e.boletim) || e.boletim <= 0)) return "Número do boletim inválido.";
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
