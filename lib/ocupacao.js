/**
 * Regras (sem banco) do cadastro Ocupação: cada ocupação é uma faixa de código de talhão (ex.: 01 a 800 = cana;
 * 999 = carreador) ou de número de parte (ex.: partes 1000 a 1999 = talhão a plantar), com o tipo de área — se a
 * área entra no local de produção, é subtraída dele ou é uma ocupação da fazenda fora da produção.
 */

export const TIPO_AREA_PRODUCAO = "Área do Local de Produção/Talhão/Parte";
export const TIPOS_AREA_OCUPACAO = [
  TIPO_AREA_PRODUCAO,
  "Área Subtraída do Local de Produção/Talhão/Parte",
  "Área Subtraída do Local de Produção (0,01)",
  "Área Total da Ocupação na Fazenda e/ou Fundo Agrícola",
];

/** talhão sem zeros à esquerda e em maiúsculas ("01" = "1", "2a" = "2A") */
export const normTlh = (t) =>
  String(t ?? "")
    .trim()
    .toUpperCase()
    .replace(/^0+(?=\d)/, "");

/** fazenda sem a sequência e sem zeros à esquerda ("09001-1" → "9001") */
export const normFaz = (f) =>
  String(f ?? "")
    .trim()
    .split("-")[0]
    .replace(/^0+(?=\d)/, "");

/** número digitado: "1.000" (ponto de milhar) = 1000; "1,5" = 1.5 */
export function numeroDigitado(v) {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).trim();
  const x = Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : /^\d{1,3}(\.\d{3})+$/.test(s) ? s.replace(/\./g, "") : s);
  return Number.isFinite(x) ? x : null;
}
const n = numeroDigitado;

/** Item do cadastro (cod, nm, dados) → { cod, descricao, talhaoDe, talhaoAte, parteDe, parteAte, tipo }. */
export function ocupacaoDoItem(cod, nm, d) {
  const talhaoDe = n(d?.talhao_de);
  const parteDe = n(d?.parte_de);
  return {
    cod: String(cod),
    descricao: String(nm ?? ""),
    talhaoDe,
    talhaoAte: n(d?.talhao_ate) ?? talhaoDe,
    parteDe,
    parteAte: n(d?.parte_ate) ?? parteDe,
    tipo: String(d?.tipo_de_area ?? ""),
  };
}

/**
 * A ocupação de um talhão/parte: primeiro as faixas de parte (que podem limitar também o talhão), depois as de talhão;
 * entre as que servem, a faixa mais estreita. Talhão com letra ("12A") usa o número.
 */
export function ocupacaoDoTalhao(lista, tlh, parte) {
  const t = Number.parseInt(normTlh(tlh), 10);
  const p = Number(parte);
  const cabe = (v, de, ate) => de !== null && Number.isFinite(v) && v >= de && v <= (ate ?? de);
  const largura = (de, ate) => (ate ?? de) - de;
  const porParte = lista
    .filter((o) => o.parteDe !== null && cabe(p, o.parteDe, o.parteAte) && (o.talhaoDe === null || cabe(t, o.talhaoDe, o.talhaoAte)))
    .sort((a, b) => largura(a.parteDe, a.parteAte) - largura(b.parteDe, b.parteAte));
  if (porParte.length > 0) return porParte[0];
  const porTalhao = lista
    .filter((o) => o.parteDe === null && cabe(t, o.talhaoDe, o.talhaoAte))
    .sort((a, b) => largura(a.talhaoDe, a.talhaoAte) - largura(b.talhaoDe, b.talhaoAte));
  return porTalhao[0] ?? null;
}

/** A área conta como local de produção (cana): tipo "Área do Local de Produção…". */
export const ehProducao = (oc) => !!oc && oc.tipo === TIPO_AREA_PRODUCAO;

/**
 * Converte a planilha de Ocupações do jeito que ela vem (CÓDIGO "De 01 a 800" ou 990; RANGER/PARTE 1000; TIPO) para as
 * colunas do cadastro. A faixa de parte vai do número dado até o milhar seguinte (1000 → 1000 a 1999).
 */
export function prepararOcupacao(d) {
  const r = { ...d };
  const cod = String(r.codigo ?? "").trim();
  const faixa = cod.match(/^de\s*(\d+)\s*a\s*(\d+)$/i);
  const rp = n(r.ranger_parte);
  if (rp !== null && n(r.parte_de) === null) {
    r.parte_de = rp;
    r.parte_ate = rp + 999;
    if (!cod) r.codigo = rp;
  }
  if (faixa) {
    r.codigo = `${faixa[1]}-${faixa[2]}`;
    if (n(r.talhao_de) === null) {
      r.talhao_de = Number(faixa[1]);
      r.talhao_ate = Number(faixa[2]);
    }
  } else if (/^\d+$/.test(cod) && n(r.talhao_de) === null && n(r.parte_de) === null) {
    r.talhao_de = Number(cod);
    r.talhao_ate = Number(cod);
  }
  if (!String(r.tipo_de_area ?? "").trim() && String(r.tipo ?? "").trim()) r.tipo_de_area = String(r.tipo).trim();
  if (!String(r.descricao ?? "").trim() && String(r.codigo ?? "").trim()) r.descricao = `Ocupação ${r.codigo} (sem descrição)`;
  delete r.ranger_parte;
  delete r.tipo;
  return r;
}

/** Confere uma ocupação: ao menos uma faixa (talhão ou parte), "de" ≤ "até" e o tipo de área. */
export function validarOcupacao(d) {
  const tDe = n(d.talhao_de);
  const tAte = n(d.talhao_ate);
  const pDe = n(d.parte_de);
  const pAte = n(d.parte_ate);
  for (const [rotulo, v] of [
    ["Talhão de", tDe],
    ["Talhão até", tAte],
    ["Parte de", pDe],
    ["Parte até", pAte],
  ]) {
    if (v !== null && (!Number.isInteger(v) || v < 0)) return `${rotulo}: informe um número inteiro.`;
  }
  if (tDe === null && pDe === null) return "Informe a faixa de talhão (Talhão de/até) ou a de parte (Parte de/até).";
  if (tDe === null && tAte !== null) return "Informe o Talhão de.";
  if (pDe === null && pAte !== null) return "Informe a Parte de.";
  if (tDe !== null && tAte !== null && tAte < tDe) return "O Talhão até não pode ser menor que o Talhão de.";
  if (pDe !== null && pAte !== null && pAte < pDe) return "A Parte até não pode ser menor que a Parte de.";
  if (!String(d.tipo_de_area ?? "").trim()) return "Escolha o tipo de área.";
  return null;
}

/** Faixas da planilha "01 - Ocupações Talhões - Áreas" — valem enquanto o cadastro Ocupação estiver vazio. */
export const OCUPACOES_PADRAO = [
  ["01-800", "Área de Cana-de-açúcar (Rotação de Cultura, Adubação Verde)", 1, 800, null, null, 0],
  ["1000", "Talhão A Plantar (sobra plantio)", null, null, 1000, 1999, 1],
  ["2000", "Área Colhida 2 Vezes na Mesma Safra", null, null, 2000, 2999, 0],
  ["3000", "Talhão Desdobra Meiose", null, null, 3000, 3999, 1],
  ["4000", "Talhão Devolução Parcial", null, null, 4000, 4999, 1],
  ["5000", "Talhão Erro de Corte na Safra", null, null, 5000, 5999, 2],
  ["6000", "Talhão Expansão Parcial", null, null, 6000, 6999, 1],
  ["7000", "Talhão Normal/Bisado Colhido Parcial", null, null, 7000, 7999, 1],
  ["990", "Área Pátio Usina", 990, 990, null, null, 3],
  ["991", "Área de Eucalipto", 991, 991, null, null, 3],
  ["992", "Área Canal/Bacia/Lagoa/Casa de Bomba de Vinhaça", 992, 992, null, null, 3],
  ["993", "Área Pátio Compostagem", 993, 993, null, null, 3],
  ["994", "Ocupação 994 (sem descrição)", 994, 994, null, null, 3],
  ["995", "Área de Cemitério", 995, 995, null, null, 3],
  ["996", "Área de APP/Reflorestamento", 996, 996, null, null, 3],
  ["997", "Área Rede Elétrica", 997, 997, null, null, 3],
  ["998", "Área Pista Avião", 998, 998, null, null, 3],
  ["999", "Área Carreador", 999, 999, null, null, 3],
].map(([cod, descricao, talhaoDe, talhaoAte, parteDe, parteAte, tipo]) => ({
  cod,
  descricao,
  talhaoDe,
  talhaoAte,
  parteDe,
  parteAte,
  tipo: TIPOS_AREA_OCUPACAO[tipo],
}));
