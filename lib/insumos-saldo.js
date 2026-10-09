/** Tipos e regras (sem banco) do módulo Insumos › Saldo de Insumos. */

export const EMPRESAS = [
  { id: 5, nome: "CRV-MG" },
  { id: 6, nome: "PFCMO-MG" },
];
export const nomeEmpresa = (id) => EMPRESAS.find((e) => e.id === id)?.nome ?? `Empresa ${id}`;

/** Depósitos (almoxarifados) mostrados por padrão: insumos agrícolas. */
export const DEPOSITOS_PADRAO = [207, 401];

/** Dosagem por hectare, na unidade de consumo do insumo; qualquer uma das duas pode faltar. */
const nfDose = (n) => n.toLocaleString("pt-BR", { maximumFractionDigits: 4 });
const nfHa = (n) => n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "0,3 – 0,5", "até 0,5" (só máxima) ou "mín. 0,3" (só mínima); vazio se não há dosagem. */
export function textoDosagem(d) {
  if (!d) return "";
  const { min, max } = d;
  if (min !== null && max !== null) return min === max ? nfDose(max) : `${nfDose(min)} – ${nfDose(max)}`;
  if (max !== null) return `até ${nfDose(max)}`;
  if (min !== null) return `mín. ${nfDose(min)}`;
  return "";
}

/**
 * Hectares que o saldo cobre: quantidade ÷ dosagem por hectare. Com a dosagem máxima é o piso (menos hectares);
 * se houver mínima também, o teto é a quantidade ÷ mínima. Sem dosagem (ou sem saldo positivo) não há cálculo.
 */
export function hectaresDoSaldo(qtd, d) {
  if (!d || !(qtd > 0)) return null;
  const alta = d.max !== null && d.max > 0 ? d.max : d.min !== null && d.min > 0 ? d.min : null;
  if (alta === null) return null;
  const de = qtd / alta;
  const ate = d.max !== null && d.max > 0 && d.min !== null && d.min > 0 && d.min < d.max ? qtd / d.min : null;
  return { de, ate };
}

/** "1.250,00" ou "1.250,00 – 2.083,33"; vazio se não há como calcular. */
export function textoHectares(h) {
  if (!h) return "";
  return h.ate !== null ? `${nfHa(h.de)} – ${nfHa(h.ate)}` : nfHa(h.de);
}

export const round2 = (n) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------
// Matriz do relatório: Grupo → Insumo, uma coluna por empresa (ou empresa × depósito) + total
// ---------------------------------------------------------------------------

/** Preço médio ponderado: valor ÷ quantidade. */
export const precoMedio = (c) => (c.qtd !== 0 ? c.valor / c.qtd : 0);

export function montarMatriz(linhas, separarDepositos) {
  const chaveDe = (l) => (separarDepositos ? `${l.emp}|${l.almx}` : `${l.emp}`);
  const colunas = new Map();
  for (const l of linhas) {
    const k = chaveDe(l);
    if (!colunas.has(k)) {
      colunas.set(k, { chave: k, emp: l.emp, almx: separarDepositos ? l.almx : null, rotulo: nomeEmpresa(l.emp), sub: separarDepositos ? String(l.almx) : "" });
    }
  }
  const cols = Array.from(colunas.values()).sort((a, b) => a.emp - b.emp || (a.almx ?? 0) - (b.almx ?? 0));
  const soma = (acc, k, l) => {
    const c = (acc[k] ??= { qtd: 0, valor: 0 });
    c.qtd += l.qtd;
    c.valor += l.valor;
  };
  const grupos = new Map();
  const itensPorGrupo = new Map();
  const geral = {};
  const totalGeral = { qtd: 0, valor: 0 };
  for (const l of linhas) {
    const k = chaveDe(l);
    let g = grupos.get(l.grp);
    if (!g) {
      g = { grp: l.grp, grpDs: l.grpDs, itens: [], cels: {}, total: { qtd: 0, valor: 0 } };
      grupos.set(l.grp, g);
      itensPorGrupo.set(l.grp, new Map());
    }
    const mapa = itensPorGrupo.get(l.grp);
    let it = mapa.get(l.cod);
    if (!it) {
      it = { cod: l.cod, ds: l.ds, un: l.un, cels: {}, total: { qtd: 0, valor: 0 } };
      mapa.set(l.cod, it);
      g.itens.push(it);
    }
    soma(it.cels, k, l);
    it.total.qtd += l.qtd;
    it.total.valor += l.valor;
    soma(g.cels, k, l);
    g.total.qtd += l.qtd;
    g.total.valor += l.valor;
    soma(geral, k, l);
    totalGeral.qtd += l.qtd;
    totalGeral.valor += l.valor;
  }
  const lista = Array.from(grupos.values()).sort((a, b) => a.grp.localeCompare(b.grp));
  for (const g of lista) g.itens.sort((a, b) => b.total.valor - a.total.valor);
  return { colunas: cols, grupos: lista, cels: geral, total: totalGeral };
}
