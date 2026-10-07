// Tipos e helpers do clima (Zeus) compartilhados entre a rota, a tela e o PDF.
import { addDays, rangeForPeriod } from "./period";
import { fmtDateBR } from "./format";
import type { Periodo } from "./types";

export interface ClimaAgregado {
  chuvaMm: number;
  /** dias do intervalo com pelo menos 1 mm de chuva */
  diasComChuva: number;
  /** dias do intervalo com leitura */
  nDias: number;
  tMin: number | null;
  tMax: number | null;
  umidadeMed: number | null;
  ventoMedKmh: number | null;
  rajadaMaxKmh: number | null;
  /** dia: total do dia; período: média diária (Wh/m²) */
  radiacaoWhm2: number | null;
}

export interface ClimaFazenda {
  pic: string;
  /** chuva do dia anterior à data de referência */
  anteriorMm: number | null;
  /** resumo do intervalo inicio..data (um dia só no filtro "Dia") */
  dia: ClimaAgregado | null;
  ultimaLeitura: string | null;
}

export interface ClimaResp {
  /** a data de referência é hoje (leitura parcial) */
  hoje: boolean;
  inicio: string;
  fim: string;
  /** intervalo com mais de um dia */
  periodo: boolean;
  fazendas: Record<string, ClimaFazenda | null>;
}

/** "9001-1" -> "9001": a Zeus só conhece o código base da fazenda. */
export function codigoFazendaBase(codigo: string): string {
  return codigo.trim().split("-")[0].trim();
}

/**
 * Intervalo de clima que acompanha o filtro de período da tela. Semana e mês
 * seguem os mesmos limites das toneladas (até a data de referência); safra, que
 * não tem recorte, mostra os últimos 30 dias.
 */
export function janelaClima(period: Periodo, referencia: string): { inicio: string; fim: string } {
  if (period === "dia") return { inicio: referencia, fim: referencia };
  if (period === "safra") return { inicio: addDays(referencia, -29), fim: referencia };
  const r = rangeForPeriod(period, referencia)!;
  return { inicio: r.inicio, fim: r.fim < referencia ? r.fim : referencia };
}

/** Legenda do rodapé de clima. */
export function rotuloClima(resp: ClimaResp, referencia: string, ultimaLeitura?: string): string {
  if (resp.periodo) {
    const dias = Math.round((Date.parse(resp.fim) - Date.parse(resp.inicio)) / 86400000) + 1;
    return `${fmtDateBR(resp.inicio)} a ${fmtDateBR(resp.fim)} · ${dias} dias`;
  }
  return resp.hoje
    ? `hoje${ultimaLeitura ? ` · leitura até ${ultimaLeitura.slice(11, 16)}` : ""}`
    : `histórico · ${fmtDateBR(referencia)}`;
}
