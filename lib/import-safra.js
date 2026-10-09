import { dataIso, lerLinhas, numeroBR, texto } from "./import-pesagem";

function num(v) {
  return numeroBR(v);
}

/**
 * Lê o relatório "Rendimentos e Estimativas de Talhões - Modelo C" de uma
 * safra. Estrutura: para cada fundo agrícola (fazenda) há uma linha com
 * código, proprietário, nome da fazenda, município e UF, seguida de uma linha
 * por talhão. Colunas usadas (A=0):
 *   0 Talhão · 1 KM · 2/3 Variedade (código/nome) · 4 Dt. Colheita Ant ·
 *   5 Dt. Colheita · 6 Dt. Plantio · 7 Corte · 8 Área-Tot · 9 Área-Plant ·
 *   10 Área-Colh · 11 MT.Linear · 12 Espaç. · 13 Prod.Ant · 14 Ton/Ha (safra
 *   anterior) · 15 Prod.Est. · 16 (Q) TCH estimado · 17 Prod.Atual ·
 *   18 (S) TCH realizado · 19 Resultado · 20 % · 21 C.E.
 * Os dois cabeçalhos "Kg/Ha" do arquivo (colunas Q e S) são, na verdade, o TCH
 * (t/ha) estimado e realizado — o texto do relatório é que está divergente.
 * Um mesmo talhão pode aparecer em mais de uma linha (áreas parciais).
 */
export function parseSafra(buffer) {
  const res = { linhas: [], safraArquivo: null, avisos: [], erros: [] };
  const rows = lerLinhas(buffer);

  const titulo = rows
    .slice(0, 4)
    .map((r) => r.map(texto).join(" "))
    .join(" ");
  if (!/Rendimentos e Estimativas/i.test(titulo)) {
    res.erros.push('O arquivo não parece ser o relatório "Rendimentos e Estimativas de Talhões - Modelo C".');
    return res;
  }

  for (const r of rows.slice(0, 4)) {
    const ano = r.find((c) => typeof c === "number" && c >= 2000 && c <= 2100);
    if (typeof ano === "number") {
      res.safraArquivo = ano;
      break;
    }
  }

  let fazCod = "";
  let fazNome = "";
  let prpCod = "";
  let prpNome = "";
  let mun = "";
  let uf = "";
  const seq = new Map();

  for (const r of rows) {
    const c0 = texto(r[0]);

    // linha do fundo agrícola: sem talhão, com código, proprietário e "cod - nome"
    if (c0 === "" && typeof r[1] === "number" && /^\d+\s*-\s*/.test(texto(r[4]))) {
      fazCod = String(r[1]);
      prpCod = texto(r[2]);
      prpNome = texto(r[3]).replace(/\s+/g, " ");
      fazNome = texto(r[4])
        .replace(/^\d+\s*-\s*/, "")
        .replace(/\s+/g, " ");
      mun = texto(r[5]).replace(/\s+/g, " ");
      uf = texto(r[6]);
      continue;
    }

    // linha de talhão
    if (/^\d+$/.test(c0) && typeof r[8] === "number") {
      if (!fazCod) continue;
      const chave = `${fazCod}|${c0}`;
      const n = (seq.get(chave) ?? 0) + 1;
      seq.set(chave, n);
      res.linhas.push({
        safra: 0,
        seq: n,
        fazendaCodigo: fazCod,
        fazendaNome: fazNome,
        proprietarioCodigo: prpCod,
        proprietarioNome: prpNome,
        municipio: mun,
        uf,
        talhao: c0,
        km: num(r[1]),
        variedadeCodigo: texto(r[2]),
        variedadeNome: texto(r[3]).replace(/\s+/g, " "),
        dtColheitaAnt: dataIso(r[4]),
        dtColheita: dataIso(r[5]),
        dtPlantio: dataIso(r[6]),
        corte: num(r[7]),
        areaTot: num(r[8]),
        areaPlant: num(r[9]),
        areaColh: num(r[10]),
        mtLinear: num(r[11]),
        espac: num(r[12]),
        prodAnt: num(r[13]),
        tchAnt: num(r[14]),
        prodEst: num(r[15]),
        tchEst: num(r[16]),
        prodAtual: num(r[17]),
        tchReal: num(r[18]),
        resultado: num(r[19]),
        pct: num(r[20]),
        ce: texto(r[21]),
      });
    }
  }

  if (res.linhas.length === 0) res.erros.push("Nenhum talhão encontrado no arquivo (safra sem dados).");
  return res;
}
