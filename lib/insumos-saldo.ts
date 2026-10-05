/** Tipos e regras (sem banco) do módulo Insumos › Saldo de Insumos. */

export const EMPRESAS: { id: number; nome: string }[] = [
  { id: 5, nome: "CRV-MG" },
  { id: 6, nome: "PFCMO-MG" },
];
export const nomeEmpresa = (id: number) => EMPRESAS.find((e) => e.id === id)?.nome ?? `Empresa ${id}`;

/** Depósitos (almoxarifados) mostrados por padrão: insumos agrícolas. */
export const DEPOSITOS_PADRAO = [207, 401];

export interface LinhaSaldo {
  grp: string;
  grpDs: string;
  cod: string;
  ds: string;
  un: string;
  emp: number;
  almx: number;
  qtd: number;
  valor: number;
}

export interface PontoSerie {
  dt: string;
  emp: number;
  almx: number;
  valor: number;
}

export interface DepositoInfo {
  emp: number;
  almx: number;
  nm: string;
}

export interface ResultadoSaldo {
  datas: string[];
  dtBase: string | null;
  depositos: DepositoInfo[];
  grupos: { cod: string; ds: string }[];
  linhas: LinhaSaldo[];
  serie: PontoSerie[];
  /** data anterior a `de` com saldo, para a primeira variação do período */
  dtAnterior: string | null;
}

export interface LinhaArquivoSaldo {
  almx: number;
  almxNm: string;
  cod: string;
  ds: string;
  grp: string;
  grpDs: string;
  un: string;
  saldo: number;
  custo: number;
  loc: string;
}

export interface PreviaArquivoSaldo {
  arquivo: string;
  linhas: number;
  valor: number;
  empresaSugerida: number;
  dataSugerida: string;
  depositos: { almx: number; nm: string; linhas: number }[];
  /** snapshot dessa empresa nessa data já existe (será substituído) */
  erro?: string;
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------
// Matriz do relatório: Grupo → Insumo, uma coluna por empresa (ou empresa × depósito) + total
// ---------------------------------------------------------------------------

export interface ColunaSaldo {
  chave: string;
  emp: number;
  almx: number | null;
  rotulo: string;
  sub: string;
}

export interface CelSaldo {
  qtd: number;
  valor: number;
}

export interface ItemMatriz {
  cod: string;
  ds: string;
  un: string;
  cels: Record<string, CelSaldo>;
  total: CelSaldo;
}

export interface GrupoMatriz {
  grp: string;
  grpDs: string;
  itens: ItemMatriz[];
  cels: Record<string, CelSaldo>;
  total: CelSaldo;
}

export interface MatrizSaldo {
  colunas: ColunaSaldo[];
  grupos: GrupoMatriz[];
  cels: Record<string, CelSaldo>;
  total: CelSaldo;
}

/** Preço médio ponderado: valor ÷ quantidade. */
export const precoMedio = (c: CelSaldo) => (c.qtd !== 0 ? c.valor / c.qtd : 0);

export function montarMatriz(linhas: LinhaSaldo[], separarDepositos: boolean): MatrizSaldo {
  const chaveDe = (l: LinhaSaldo) => (separarDepositos ? `${l.emp}|${l.almx}` : `${l.emp}`);
  const colunas = new Map<string, ColunaSaldo>();
  for (const l of linhas) {
    const k = chaveDe(l);
    if (!colunas.has(k)) {
      colunas.set(k, { chave: k, emp: l.emp, almx: separarDepositos ? l.almx : null, rotulo: nomeEmpresa(l.emp), sub: separarDepositos ? String(l.almx) : "" });
    }
  }
  const cols = Array.from(colunas.values()).sort((a, b) => a.emp - b.emp || (a.almx ?? 0) - (b.almx ?? 0));
  const soma = (acc: Record<string, CelSaldo>, k: string, l: LinhaSaldo) => {
    const c = (acc[k] ??= { qtd: 0, valor: 0 });
    c.qtd += l.qtd;
    c.valor += l.valor;
  };
  const grupos = new Map<string, GrupoMatriz>();
  const itensPorGrupo = new Map<string, Map<string, ItemMatriz>>();
  const geral: Record<string, CelSaldo> = {};
  const totalGeral: CelSaldo = { qtd: 0, valor: 0 };
  for (const l of linhas) {
    const k = chaveDe(l);
    let g = grupos.get(l.grp);
    if (!g) {
      g = { grp: l.grp, grpDs: l.grpDs, itens: [], cels: {}, total: { qtd: 0, valor: 0 } };
      grupos.set(l.grp, g);
      itensPorGrupo.set(l.grp, new Map());
    }
    const mapa = itensPorGrupo.get(l.grp)!;
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
