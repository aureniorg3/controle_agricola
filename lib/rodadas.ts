/** Tipos e regras de calendário das Rodadas de Campo (sem acesso a banco — vale no navegador e no servidor). */

export interface SemanaRodada {
  sem: number;
  /** YYYY-MM-DD (segunda-feira) */
  ini: string;
  /** YYYY-MM-DD (domingo) */
  fim: string;
}

export interface RodadaCad {
  rod: number;
  /** primeira segunda-feira da rodada */
  ini: string;
  semanas: SemanaRodada[];
  boletins: number;
}

export interface ItemBoletim {
  /** código da ocorrência (cadastro) — vazio nos itens importados de planilha */
  oco: string;
  /** texto livre da ocorrência (importação) */
  ocoTxt: string;
  pre: string;
  niv: string;
  pri: string;
  tlh: string;
  area: number | null;
  rec: string;
}

export interface LinhaResumoRodada {
  bol: number;
  rod: number;
  dt: string;
  sem: number;
  reg: string;
  regNm: string;
  resp: string;
  faz: string;
  fazNm: string;
  tlh: string;
  area: number | null;
  ocorrencia: string;
  presenca: string;
  nivel: string;
  prioridade: string;
  rec: string;
  atividade: string;
  executado: string;
}

export const SEMANAS_POR_RODADA = 8;

function utc(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function somarDias(isoData: string, dias: number): string {
  const d = utc(isoData);
  d.setUTCDate(d.getUTCDate() + dias);
  return iso(d);
}

/** Segunda-feira da semana da data (a própria data, se já for segunda). */
export function segundaDaSemana(isoData: string): string {
  const d = utc(isoData);
  const dow = d.getUTCDay(); // 0 = domingo
  d.setUTCDate(d.getUTCDate() - (dow === 0 ? 6 : dow - 1));
  return iso(d);
}

/** As 8 semanas da rodada, cada uma de segunda a domingo, a partir da semana da data informada. */
export function gerarSemanas(inicio: string): SemanaRodada[] {
  const primeira = segundaDaSemana(inicio);
  return Array.from({ length: SEMANAS_POR_RODADA }, (_, i) => {
    const ini = somarDias(primeira, i * 7);
    return { sem: i + 1, ini, fim: somarDias(ini, 6) };
  });
}

/** Semana da rodada em que a data cai (ou null se estiver fora do calendário). */
export function semanaDaData(semanas: SemanaRodada[], data: string): number | null {
  return semanas.find((s) => data >= s.ini && data <= s.fim)?.sem ?? null;
}
