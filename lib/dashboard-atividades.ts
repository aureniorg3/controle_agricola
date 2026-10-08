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
  /** último dia com apontamento ou entrada de cana (para abrir a tela nele) */
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

/**
 * Agrupamento inicial das operações (código → grupo, nome), da planilha CALL "Rendimento Operacional":
 * a ordem aqui é a ordem dos grupos no dashboard. Depois pode ser alterado na própria tela.
 */
export const GRUPOS_OPERACOES_PADRAO: [string, string, string][] = [
  ["398", "ROTAÇÃO DE CULTURA", "PLANTIO ADUB.VERDE-MAN"],
  ["474", "ROTAÇÃO DE CULTURA", "PLANTIO MILHO-PARCERIA"],
  ["475", "ROTAÇÃO DE CULTURA", "PLANTIO SOJA-PARCERIA"],
  ["476", "ROTAÇÃO DE CULTURA", "PLANTIO AMENDOIM-PARCERIA"],
  ["117", "ROTAÇÃO DE CULTURA", "PLANTIO ADUB.VERDE-MEC"],
  ["118", "ROTAÇÃO DE CULTURA", "PLANTIO DE SOJA-MEC"],
  ["324", "ROTAÇÃO DE CULTURA", "PLANTIO DE SORGO"],
  ["404", "ROTAÇÃO DE CULTURA", "INCORPORAÇÃO SEMENTE-MEC"],
  ["473", "ROTAÇÃO DE CULTURA", "INCORP. SEMENTE S/INSUMO"],
  ["531", "ROTAÇÃO DE CULTURA", "INCORP SEMENTE - TERCEIRO"],
  ["282", "PREPARO DE SOLO", "DESSECAÇÃO 1"],
  ["427", "PREPARO DE SOLO", "DESSECAÇÃO 2"],
  ["428", "PREPARO DE SOLO", "DESSECAÇÃO 3"],
  ["14", "PREPARO DE SOLO", "SISTEMATIZAÇÃO"],
  ["3", "PREPARO DE SOLO", "CALCÁRIO"],
  ["5", "PREPARO DE SOLO", "GESSO"],
  ["6", "PREPARO DE SOLO", "FOSFATAGEM"],
  ["13", "PREPARO DE SOLO", "SUBSOLAGEM"],
  ["697", "PLANTIO", "PLANTIO"],
  ["706", "PLANTIO", "PLANTIO TERCEIRO"],
  ["9", "TRATOS CANA PLANTA", "HERBICIDA"],
  ["32", "TRATOS CANA PLANTA", "QUEBRA LOMBO"],
  ["7", "TRATOS CANA PLANTA", "COMPOSTAGEM"],
  ["11", "TRATOS CANA SOCA", "ADUBAÇÃO"],
  ["496", "TRATOS CANA SOCA", "VINHAÇA LOC"],
  ["218", "TRATOS CANA SOCA", "VINHAÇA ASP"],
  ["10", "TRATOS CANA SOCA", "HERBICIDA"],
  ["2", "TRATOS CANA SOCA", "CALCÁRIO"],
  ["4", "TRATOS CANA SOCA", "GESSO"],
  ["8", "TRATOS CANA SOCA", "COMPOSTAGEM"],
  ["266", "TRATOS CANA SOCA", "CAMA DE FRANGO"],
  ["139", "TRATOS CANA SOCA", "ROÇADA MECÂNICA"],
  ["690", "TRATOS CANA SOCA", "SEM ADUBAÇÃO"],
  ["154", "CATAÇÃO QUÍMICA", "M-10"],
  ["379", "CATAÇÃO QUÍMICA", "BOMBA COSTAL"],
  ["419", "CATAÇÃO QUÍMICA", "QUADRICICLO"],
  ["161", "CATAÇÃO QUÍMICA", "TRATORES"],
  ["434", "DESENVOLVIMENTO", "APLIC AÉREA PRÉ-MATURADOR"],
  ["78", "DESENVOLVIMENTO", "APLIC.AÉREA MATURADOR"],
  ["222", "DESENVOLVIMENTO", "APLICAÇÃO AÉREA ADUBO"],
  ["439", "DESENVOLVIMENTO", "APLIC. AÉREA ADUBO SÓLIDO"],
  ["279", "DESENVOLVIMENTO", "SEMEAD AÉREA ADUB VERDE"],
  ["277", "DESENVOLVIMENTO", "APLIC.AÉREA DE INSETICIDA"],
  ["319", "DESENVOLVIMENTO", "1º APLIC. AÉREA FUNGICIDA"],
  ["388", "DESENVOLVIMENTO", "APL. AÉREA INIBIDOR FLOR"],
  ["432", "DESENVOLVIMENTO", "APLIC AÉREA FUNG VAZ 50L"],
  ["466", "DESENVOLVIMENTO", "APLIC. FUNG +AD FOLIAR"],
  ["483", "DESENVOLVIMENTO", "1° LIB. PARAS. DRONE PROP"],
  ["484", "DESENVOLVIMENTO", "2° LIB. PARAS. DRONE PROP"],
  ["485", "DESENVOLVIMENTO", "3° LIB. PARAS. DRONE PROP"],
  ["513", "DESENVOLVIMENTO", "4° LIB. PARAS. DRONE PROP"],
  ["514", "DESENVOLVIMENTO", "5° LIB. PARAS. DRONE PROP"],
  ["33", "DESENVOLVIMENTO", "1º LEV./CONTR. FORMIGA-M"],
  ["41", "DESENVOLVIMENTO", "LEV. BROCA-MAN/LIBERAR PA"],
];

/** Operação do agrupamento (tela de ajuste dos grupos). */
export interface OperacaoGrupo {
  cod: string;
  ds: string;
  grupo: string;
  /** tem apontamento lançado */
  lancada: boolean;
}
