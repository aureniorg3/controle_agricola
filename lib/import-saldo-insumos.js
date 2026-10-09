import { lerLinhas, numeroBR, texto } from "./import-pesagem";

const norm = (v) =>
  texto(v)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

/**
 * Lê o relatório diário de saldo de insumos do outro sistema (um por empresa):
 * Almx · Descrição · Codigo · Descrição · Grupo · Descrição do Grupo · Cons. · Comp. · Tam · Saldo Balanço ·
 * Novo Custo Médio · Localização … Não traz empresa nem data: a empresa se identifica pelo nome dos depósitos
 * e a data vem do nome do arquivo (AAAAMMDDhhmmss…), os dois confirmados na tela.
 */
export function lerSaldoInsumos(buffer) {
  const todas = lerLinhas(buffer);
  const idx = todas.findIndex((l) => norm(l[0]) === "almx" || l.some((c) => norm(c) === "almx"));
  if (idx < 0) return { linhas: [], erro: 'Não encontrei o cabeçalho do relatório (coluna "Almx").' };
  const cab = todas[idx];
  const col = (nome) => cab.findIndex((c) => norm(c) === nome);
  const cAlmx = col("almx");
  const cCod = col("codigo");
  const cGrp = col("grupo");
  const cGrpDs = col("descricao do grupo");
  const cUn = col("cons.");
  const cSaldo = col("saldo balanco");
  const cCusto = col("novo custo medio");
  const cLoc = col("localizacao");
  if ([cAlmx, cCod, cSaldo, cCusto].some((c) => c < 0)) {
    return { linhas: [], erro: "Cabeçalho inesperado: faltam colunas Almx, Codigo, Saldo Balanço ou Novo Custo Médio." };
  }
  const linhas = [];
  for (const l of todas.slice(idx + 1)) {
    // o rodapé "Total de Itens" não tem depósito: fica de fora
    if (texto(l[cAlmx]) === "") continue;
    const almx = Number(l[cAlmx]);
    const cod = texto(l[cCod]);
    if (!Number.isInteger(almx) || !cod) continue;
    linhas.push({
      almx,
      almxNm: texto(l[cAlmx + 1]),
      cod,
      ds: texto(l[cCod + 1]),
      grp: cGrp >= 0 ? texto(l[cGrp]) : "",
      grpDs: cGrpDs >= 0 ? texto(l[cGrpDs]) : "",
      un: cUn >= 0 ? texto(l[cUn]) : "",
      saldo: numeroBR(l[cSaldo]),
      custo: numeroBR(l[cCusto]),
      loc: cLoc >= 0 ? texto(l[cLoc]) : "",
    });
  }
  if (linhas.length === 0) return { linhas, erro: "O arquivo não tem linhas de saldo." };
  return { linhas };
}

/** Empresa pelo nome dos depósitos: "PFCMO" = PFCMO-MG (6); caso contrário CRV-MG (5). */
export function empresaPelosDepositos(linhas) {
  const pf = linhas.filter((l) => /PFCMO/i.test(l.almxNm)).length;
  return pf > linhas.length / 2 ? 6 : 5;
}

/** "20261005154030838.xlsx" → 2026-10-05; sem data válida no nome, a de hoje. */
export function dataDoArquivo(nome) {
  const m = nome.match(/(20\d{2})(\d{2})(\d{2})/);
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12 && Number(m[3]) >= 1 && Number(m[3]) <= 31) return `${m[1]}-${m[2]}-${m[3]}`;
  return new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
}

export function previaArquivo(nome, linhas, erro) {
  const deps = new Map();
  for (const l of linhas) {
    const d = deps.get(l.almx) ?? { nm: l.almxNm, n: 0 };
    d.n++;
    deps.set(l.almx, d);
  }
  return {
    arquivo: nome,
    linhas: linhas.length,
    valor: Math.round(linhas.reduce((s, l) => s + l.saldo * l.custo, 0) * 100) / 100,
    empresaSugerida: empresaPelosDepositos(linhas),
    dataSugerida: dataDoArquivo(nome),
    depositos: Array.from(deps.entries()).map(([almx, d]) => ({ almx, nm: d.nm, linhas: d.n })),
    erro,
  };
}
