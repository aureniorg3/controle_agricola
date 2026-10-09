import { dataIso, lerLinhas, numeroBR, texto } from "./import-pesagem";

/**
 * Lê o "Relatório de Frentes por Especialidade - Cana Moagem" (colhedoras):
 * blocos "Frente .: N  Descrição .: NOME" seguidos de uma linha por
 * equipamento + fazenda com as toneladas (a coluna "Toneladas" do arquivo vem
 * em kg — o total do rodapé é que está em toneladas). A data não vem em
 * cada linha: é a do período do cabeçalho, informada por quem importa.
 */
export function parseConferenciaPesagem(buffer, data) {
  const res = { linhas: [], periodoInicio: null, periodoFim: null, avisos: [], erros: [] };
  const rows = lerLinhas(buffer);

  const titulo = rows
    .slice(0, 5)
    .map((r) => r.map(texto).join(" "))
    .join(" ");
  if (!/Frentes por Especialidade/i.test(titulo)) {
    res.erros.push('O arquivo não parece ser o "Relatório de Frentes por Especialidade - Cana Moagem".');
    return res;
  }

  for (const r of rows.slice(0, 6)) {
    const datas = r.map((c) => dataIso(c)).filter((d) => !!d);
    if (datas.length >= 2 && /Per/i.test(r.map(texto).join(" "))) {
      res.periodoInicio = datas[0];
      res.periodoFim = datas[1];
      break;
    }
  }

  const acumulado = new Map();
  let frenteAtual = "";
  let totalGeralRelatorio = null;

  for (const r of rows) {
    const c0 = texto(r[0]);
    if (/^Frente/i.test(c0)) {
      frenteAtual = texto(r[3]).replace(/\s+/g, " ");
      continue;
    }
    if (/Total Geral/i.test(texto(r[8]))) {
      totalGeralRelatorio = numeroBR(r[9]);
      continue;
    }
    if (/^\d+$/.test(c0) && texto(r[4]) !== "") {
      // linhas antes do primeiro bloco "Frente" são o cabeçalho do relatório
      // (a primeira traz o código da empresa na coluna 0), não equipamentos.
      if (!frenteAtual) continue;
      const fazCod = texto(r[2]);
      const fundo = texto(r[4]);
      const fazNome = fundo.replace(/^\d+\s*-\s*/, "").replace(/\s+/g, " ");
      const toneladas = numeroBR(r[5]) / 1000;
      const chave = `${c0}|${frenteAtual}|${fazCod}`;
      const atual = acumulado.get(chave);
      if (atual) {
        atual.toneladas += toneladas;
      } else {
        acumulado.set(chave, {
          data,
          eqp: c0,
          eqpNome: texto(r[1]).replace(/\s+/g, " "),
          frente: frenteAtual,
          fazendaCodigo: fazCod,
          fazendaNome: fazNome,
          toneladas,
        });
      }
    }
  }

  res.linhas = Array.from(acumulado.values()).map((l) => ({ ...l, toneladas: Math.round(l.toneladas * 1000) / 1000 }));
  if (res.linhas.length === 0) res.erros.push("Nenhuma linha de equipamento encontrada no arquivo.");

  if (totalGeralRelatorio !== null && res.linhas.length > 0) {
    const soma = res.linhas.reduce((s, l) => s + l.toneladas, 0);
    if (Math.abs(soma - totalGeralRelatorio) > 0.5) {
      res.avisos.push(`A soma das linhas (${soma.toFixed(2)} t) difere do "Total Geral" do relatório (${totalGeralRelatorio.toFixed(2)} t).`);
    }
  }
  return res;
}
