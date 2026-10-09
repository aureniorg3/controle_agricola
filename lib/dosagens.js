/** Tipos e regras (sem banco) de Insumos › Dosagens. */

export const arredondarDose = (n) => Math.round(n * 1e6) / 1e6;

/** Código do cadastro: sem espaços e, se numérico, sem zeros à esquerda ("0858778" = "858778"). */
export function normalizarCodigo(c) {
  const t = c.trim();
  return /^\d+$/.test(t) ? t.replace(/^0+(?=\d)/, "") : t;
}

/** Confere mínima e máxima e devolve o texto do erro (ou null). Pelo menos uma das duas é obrigatória. */
export function validarDosagem(min, max) {
  if (min === null && max === null) return "Informe a dosagem mínima, a máxima ou as duas.";
  if (min !== null && (!Number.isFinite(min) || min < 0)) return "Dosagem mínima inválida: use um número maior ou igual a zero.";
  if (max !== null && (!Number.isFinite(max) || max < 0)) return "Dosagem máxima inválida: use um número maior ou igual a zero.";
  if (min !== null && max !== null && min > max) return "A dosagem mínima não pode ser maior que a máxima.";
  return null;
}
