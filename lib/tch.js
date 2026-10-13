/**
 * Regras (sem tela) do TCH das ordens: o sinaleiro da produtividade e a variação do TCH médio realizado contra a
 * referência — usadas pelos cards da tela e do relatório em PDF.
 */

/**
 * Sinaleiro do TCH (faixas provisórias, a validar com a operação): verde a partir de 60 (Bom; Excelente acima de 80),
 * amarelo de 40 a 60 (Médio) e vermelho abaixo de 40 (Baixo).
 */
export function sinaleiroTch(tch) {
  const t = Number(tch) || 0;
  if (t > 80) return { luz: "verde", nivel: "Excelente", faixa: "TCH acima de 80" };
  if (t >= 60) return { luz: "verde", nivel: "Bom", faixa: "TCH de 60 a 80" };
  if (t >= 40) return { luz: "amarelo", nivel: "Médio", faixa: "TCH de 40 a 60" };
  return { luz: "vermelho", nivel: "Baixo", faixa: "TCH abaixo de 40" };
}

/**
 * Variação do TCH médio realizado da ordem contra a referência: o TCH realizado da safra anterior; sem ele, o TCH
 * estimado da safra atual; sem ele, o da safra mais antiga. `historico` = [{ safra, tchReal, tchEst }];
 * `safrasAnteriores` da mais recente para a mais antiga. Sem produção ou sem referência, null.
 */
export function variacaoTch(tchAtual, historico, safraAtual, safrasAnteriores) {
  if (!(tchAtual > 0)) return null;
  const real = (safra) => historico?.find((h) => h.safra === safra)?.tchReal ?? null;
  const estimado = historico?.find((h) => h.safra === safraAtual)?.tchEst ?? null;
  const [anterior, ...antigas] = safrasAnteriores ?? [];
  const bases = [
    ...(anterior !== undefined ? [{ valor: real(anterior), rotulo: `TCH Realizado Safra ${anterior}` }] : []),
    { valor: estimado, rotulo: `TCH Estimado ${safraAtual}` },
    ...antigas.map((s) => ({ valor: real(s), rotulo: `TCH Realizado Safra ${s}` })),
  ];
  const base = bases.find((b) => b.valor !== null && b.valor > 0);
  if (!base) return null;
  return { pct: ((tchAtual - base.valor) / base.valor) * 100, base: base.rotulo, valorBase: base.valor };
}
