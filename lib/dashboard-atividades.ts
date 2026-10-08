/** Tipos e regras (sem banco) de Atividades › Dashboard: moagem por frente e área das operações lançadas. */

/** Valores de uma linha: um por dia da semana de referência (seg a dom; null depois da data) e os acumulados. */
export interface ValoresPeriodo {
  dias: (number | null)[];
  semana: number;
  mes: number;
  safra: number;
}

export interface LinhaMoagem extends ValoresPeriodo {
  frente: string;
}

export interface LinhaOperacao extends ValoresPeriodo {
  cod: string;
  ds: string;
}

export interface GrupoOperacoes {
  grupo: string;
  linhas: LinhaOperacao[];
  subtotal: ValoresPeriodo;
}

export interface DashboardAtividades {
  /** data de referência */
  dt: string;
  /** os 7 dias da semana de referência (segunda a domingo) */
  semana: string[];
  mesInicio: string;
  /** início do acumulado da safra das operações (início do ano-safra) e da moagem (início da produção) */
  safraOperacoes: { inicio: string; rotulo: string } | null;
  safraMoagem: { inicio: string; rotulo: string } | null;
  moagem: { total: ValoresPeriodo; frentes: LinhaMoagem[] };
  operacoes: { grupos: GrupoOperacoes[]; total: ValoresPeriodo };
  /** data máxima do dashboard: ontem (só dias fechados) */
  ultimoLancamento: string | null;
}

/** Grupo das operações sem grupo definido. */
export const GRUPO_OUTRAS = "OUTRAS OPERAÇÕES";

/** Código da operação sem zeros à esquerda (o cadastro do grupo vale para "010" e "10"). */
export const codigoOperacao = (cod: string) => cod.trim().replace(/^0+(?=\d)/, "");

export const vazio = (): ValoresPeriodo => ({ dias: [null, null, null, null, null, null, null], semana: 0, mes: 0, safra: 0 });

/** Soma linhas (dias depois da referência continuam null). */
export function somarValores(linhas: ValoresPeriodo[], diasValidos: boolean[]): ValoresPeriodo {
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
export interface OperacaoGrupo {
  cod: string;
  ds: string;
  /** Classificação de Operações (do cadastro Operações) */
  classificacao: string;
  grupo: string;
  /** tem apontamento lançado */
  lancada: boolean;
  /** está no cadastro Operações (só essas podem ter grupo) */
  noCadastro: boolean;
}
