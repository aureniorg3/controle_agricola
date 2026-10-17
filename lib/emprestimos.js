/** Tipos e regras (sem banco) do módulo Insumos › Empréstimos. */

export const ASSINANTES_PADRAO = ["Weslei Silva Zazenon", "Cloves Rodrigues de Oliveira Junior", "Leonardo Dias de Almeida"];

export const round2 = (n) => Math.round(n * 100) / 100;

/** Valor total de uma linha: quantidade × valor unitário. */
export const totalItem = (qtd, vu) => round2(qtd * vu);

const DATA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Nº da Solicitação: ANO + MÊS + sequência de 3 dígitos no mês (202608001 = 1ª de agosto de 2026), gerado pelo sistema.
 * O mês é o da data da solicitação (sem ela, o da saída; sem as duas, o do lançamento). `mesDaSolicitacao` dá o
 * AAAAMM de uma data AAAA-MM-DD; `MAX_POR_MES` é o limite da sequência.
 */
export const MAX_POR_MES = 999;
export const mesDaSolicitacao = (iso) => Number(String(iso).slice(0, 7).replace("-", ""));
export const numeroDaSolicitacao = (mes, seq) => mes * 1000 + seq;

/** Confere o formulário e devolve o texto do erro (ou null). O nº da Solicitação não vem do formulário: é gerado. */
export function validarEmprestimo(e, exigirSolicitacao) {
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
