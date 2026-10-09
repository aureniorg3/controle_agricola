/** Tipos e regras (sem banco) de Atividades › Dashboard: moagem por frente e área das operações lançadas. */

/** Valores de uma linha: um por dia da semana de referência (seg a dom; null depois da data) e os acumulados. */

/** Grupo das operações sem grupo definido. */
export const GRUPO_OUTRAS = "OUTRAS OPERAÇÕES";

/** Código da operação sem zeros à esquerda (o cadastro do grupo vale para "010" e "10"). */
export const codigoOperacao = (cod) => cod.trim().replace(/^0+(?=\d)/, "");

export const vazio = () => ({ dias: [null, null, null, null, null, null, null], semana: 0, mes: 0, safra: 0 });

/** Soma linhas (dias depois da referência continuam null). */
export function somarValores(linhas, diasValidos) {
  const t = vazio();
  t.dias = diasValidos.map((ok, i) => (ok ? linhas.reduce((s, l) => s + (l.dias[i] ?? 0), 0) : null));
  for (const l of linhas) {
    t.semana += l.semana;
    t.mes += l.mes;
    t.safra += l.safra;
  }
  return t;
}

/** Operação do agrupamento (tela de ajuste dos grupos). */
