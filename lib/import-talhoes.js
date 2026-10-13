import { normalizarTexto } from "./cadastros-spec";
import { limparNomeFazenda } from "./fazendas";
import { dataIso, num, txt, vazio } from "./import-os";
import { paraCadaLinha } from "./import-pesagem";

/**
 * Lê o "Relatório de Talhões I" do sistema agrícola (uma safra por arquivo):
 *  - topo: "Empresa : 6" e "Safra: 2026";
 *  - cabeçalho em três linhas (Bloco, Talhão, Parte, Variedade, Estágio de Corte, Ambiente de Produção, Plantio,
 *    Data Último Corte, Área (Ha) Talhão, Área (Ha) Parte, Finalid., Produtiv., Prod. Total, Dist., Esp., Tipo Corte);
 *  - cada fazenda começa numa linha "Propriedade: | 9001 | 0 | 9001 - FAZ. PARANAÍBA", seguida das linhas de
 *    talhão × parte (um talhão pode ter várias partes, cada uma com variedade, estágio e plantio próprios; a área do
 *    talhão se repete em todas as partes) e de uma linha de total da fazenda; no fim vem o total geral.
 * No arquivo do sistema os rótulos Parte/Variedade ficam uma coluna à esquerda dos valores (entre o talhão e a parte
 * há a coluna da letra do talhão), então entre o talhão e o estágio as colunas são achadas pelo tipo do valor.
 */
const COLUNAS = {
  bloco: ["bloco"],
  tlh: ["talhao"],
  estagio: ["estagio de corte"],
  ambiente: ["ambiente de producao"],
  plantio: ["plantio"],
  ultCorte: ["data ultimo corte", "ultimo corte"],
  areaTlh: ["area ha talhao", "area talhao"],
  areaParte: ["estimativas area ha parte", "area ha parte", "area parte"],
  finalidade: ["finalid", "finalidade"],
  produtividade: ["estimativas produtiv", "produtiv", "produtividade"],
  prodTotal: ["prod total ton", "prod total"],
  dist: ["dist", "distancia"],
  esp: ["esp", "espacamento"],
  tipoCorte: ["tipo corte", "tipo de corte"],
};

const inteiro = (v) => {
  const n = num(v);
  return n === null ? null : Math.round(n);
};
const ehNumero = (v) => typeof v === "number" || (typeof v === "string" && /^\s*\d+([.,]\d+)?\s*$/.test(v));
const r3 = (n) => Math.round(n * 1000) / 1000;

export async function lerRelatorioTalhoes(buffer) {
  let n = 0;
  let emp = "";
  let safra = "";
  /** linhas do cabeçalho (até 3) já vistas, para juntar os rótulos de cada coluna */
  const cab = [];
  let idx = null;
  let faz = null;
  let semFazenda = 0;
  let totalGeral = null;
  const linhas = [];
  const vistas = new Set();
  const repetidas = [];

  const lerLinha = (l) => {
    n++;
    const primeira = normalizarTexto(String(l[0] ?? ""));
    if (!idx) {
      if (n > 40) return;
      // "Empresa : | 6" e "Safra: | 2026 | Propriedade: …"
      if (primeira === "empresa" && !vazio(l[1])) emp = txt(l[1]);
      if (primeira === "safra" && !vazio(l[1])) safra = txt(l[1]);
      cab.push(l.map((c) => normalizarTexto(String(c ?? ""))));
      if (cab.length > 3) cab.shift();
      const ultima = cab[cab.length - 1];
      if (ultima[0] !== "bloco" || ultima[1] !== "talhao") return;
      // rótulo de cada coluna = as três linhas do cabeçalho juntas ("estagio" + "de" + "corte")
      const largura = Math.max(...cab.map((c) => c.length));
      const rotulos = Array.from({ length: largura }, (_, j) =>
        cab
          .map((c) => c[j] ?? "")
          .filter(Boolean)
          .join(" "),
      );
      const ind = {};
      for (const [campo, alt] of Object.entries(COLUNAS)) {
        // a coluna mais à direita que bate (os rótulos de baixo, "Talhão" e "Parte", também aparecem nas áreas)
        for (const a of alt) {
          const i = campo === "bloco" || campo === "tlh" ? rotulos.indexOf(a) : rotulos.lastIndexOf(a);
          if (i >= 0) {
            ind[campo] = i;
            break;
          }
        }
      }
      if (ind.tlh === undefined || ind.estagio === undefined || ind.areaTlh === undefined) return;
      idx = ind;
      return;
    }
    // "Propriedade: | 9001 | 0 | 9001 - FAZ. PARANAÍBA"
    if (primeira === "propriedade") {
      const cod = inteiro(l[1]);
      const seq = inteiro(l[2]);
      const nome = txt(l.slice(3).find((c) => !vazio(c)));
      faz = cod === null ? null : { propCod: seq ? `${cod}-${seq}` : String(cod), propNm: limparNomeFazenda(nome, String(cod)) };
      return;
    }
    const g = (c) => (idx[c] === undefined ? undefined : l[idx[c]]);
    const tlhV = g("tlh");
    if (vazio(tlhV)) {
      // linha de total (da fazenda ou geral): só números à direita
      const nums = l.filter((c) => typeof c === "number");
      if (nums.length >= 2) totalGeral = { areaTlh: nums[0], areaParte: nums[1] };
      return;
    }
    if (!ehNumero(tlhV)) return;
    if (!faz) {
      semFazenda++;
      return;
    }
    // entre o talhão e o estágio: [letra?] parte variedade — achadas pelo tipo
    const meio = l.slice(idx.tlh + 1, idx.estagio);
    const iVar = meio.reduce((a, c, k) => (typeof c === "string" && c.trim() && !ehNumero(c) && c.trim().length > 1 ? k : a), -1);
    const iParte = meio.reduce((a, c, k) => ((iVar < 0 || k < iVar) && ehNumero(c) ? k : a), -1);
    const letra = meio.find((c, k) => k !== iVar && typeof c === "string" && /^[a-z]$/i.test(c.trim()));
    const tlh = String(inteiro(tlhV));
    const parte = iParte >= 0 ? inteiro(meio[iParte]) : 1;
    const linha = {
      propCod: faz.propCod,
      propNm: faz.propNm,
      bloco: txt(g("bloco")),
      tlh,
      letra: letra ? letra.trim().toUpperCase() : "",
      parte: parte ?? 1,
      variedade: iVar >= 0 ? txt(meio[iVar]) : "",
      estagio: inteiro(g("estagio")),
      ambiente: txt(g("ambiente")),
      plantio: dataIso(g("plantio")),
      ultCorte: dataIso(g("ultCorte")),
      areaTlh: num(g("areaTlh")),
      areaParte: num(g("areaParte")),
      finalidade: txt(g("finalidade")),
      produtividade: num(g("produtividade")),
      prodTotal: num(g("prodTotal")),
      dist: num(g("dist")),
      esp: num(g("esp")),
      tipoCorte: txt(g("tipoCorte")),
    };
    const chave = `${linha.propCod}|${linha.tlh}${linha.letra}|${linha.parte}`;
    if (vistas.has(chave)) {
      if (repetidas.length < 20) repetidas.push(chave.replace(/\|/g, " · "));
      return;
    }
    vistas.add(chave);
    linhas.push(linha);
  };

  try {
    await paraCadaLinha(buffer, lerLinha, false);
  } catch (e) {
    if (n > 0) throw e;
    await paraCadaLinha(buffer, lerLinha, true);
  }

  if (!idx) {
    return {
      linhas: [],
      erro: "Não encontrei o cabeçalho do Relatório de Talhões (Bloco, Talhão, Parte, Variedade, Estágio de Corte, Área Talhão…) nas primeiras linhas da primeira aba.",
    };
  }
  if (!/^\d{4}$/.test(safra)) {
    return { linhas: [], erro: "Não encontrei a safra no topo do relatório (linha \"Safra: 2026\")." };
  }
  if (linhas.length === 0) return { linhas, erro: "Nenhuma linha de talhão encontrada abaixo das propriedades." };

  // conferência com o total geral do relatório (área do talhão conta uma vez por talhão)
  const talhoes = new Map();
  for (const l of linhas) talhoes.set(`${l.propCod}|${l.tlh}${l.letra}`, l.areaTlh ?? 0);
  const somaTlh = r3([...talhoes.values()].reduce((a, b) => a + b, 0));
  const somaParte = r3(linhas.reduce((a, l) => a + (l.areaParte ?? 0), 0));
  const avisos = [];
  if (totalGeral && (Math.abs(totalGeral.areaTlh - somaTlh) > 0.01 || Math.abs(totalGeral.areaParte - somaParte) > 0.01)) {
    avisos.push(
      `Os totais lidos (talhões ${somaTlh} ha, partes ${somaParte} ha) não batem com o total do relatório (${r3(totalGeral.areaTlh)} ha e ${r3(totalGeral.areaParte)} ha).`,
    );
  }
  if (repetidas.length) avisos.push(`Linhas repetidas ignoradas (fazenda · talhão · parte): ${repetidas.join(", ")}.`);
  if (semFazenda) avisos.push(`${semFazenda} linha(s) de talhão antes da primeira propriedade foram ignoradas.`);
  return {
    safra,
    emp,
    linhas,
    fazendas: new Set(linhas.map((l) => l.propCod)).size,
    talhoes: talhoes.size,
    areaTalhoes: somaTlh,
    areaPartes: somaParte,
    avisos,
  };
}
