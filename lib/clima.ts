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

/**
 * Agrupa as fazendas da ordem pela estação da Zeus: fazendas da mesma estação mostram o clima uma vez só; estações
 * diferentes (ou fazenda sem estação) ficam em blocos separados.
 */
export function agruparClimaPorEstacao<F extends { codigo: string; nome: string }>(
  fazendas: F[],
  resp: ClimaResp
): { fazendas: F[]; c: ClimaFazenda | null }[] {
  const grupos = new Map<string, { fazendas: F[]; c: ClimaFazenda | null }>();
  for (const f of fazendas) {
    const c = resp.fazendas[codigoFazendaBase(f.codigo)] ?? null;
    const chave = c ? `pic:${c.pic}` : `sem:${f.codigo}`;
    if (!grupos.has(chave)) grupos.set(chave, { fazendas: [], c });
    grupos.get(chave)!.fazendas.push(f);
  }
  return [...grupos.values()];
}

export type IconeClima = "gota" | "vento" | "termometro" | "chuva";

/** Itens do clima na ordem da tela e do PDF: umidade, vento, temperatura, dia anterior e chuva do dia (ou do período). */
export function itensClima(
  c: ClimaFazenda,
  periodo: boolean,
  fmt: (n: number | null | undefined, casas?: number) => string
): { icone: IconeClima; rotulo: string; valor: string; unidade: string; destaque?: boolean }[] {
  const d = c.dia!;
  return [
    { icone: "gota", rotulo: "Umidade", valor: fmt(d.umidadeMed), unidade: "%" },
    { icone: "vento", rotulo: "Vento (rajada)", valor: d.ventoMedKmh == null ? "—" : `${fmt(d.ventoMedKmh)} (${fmt(d.rajadaMaxKmh)})`, unidade: "km/h" },
    { icone: "termometro", rotulo: "Temp. mín–máx", valor: d.tMin == null || d.tMax == null ? "—" : `${fmt(d.tMin)}–${fmt(d.tMax)}`, unidade: "°C" },
    periodo
      ? { icone: "chuva", rotulo: "Dias com chuva (≥1 mm)", valor: `${d.diasComChuva} de ${d.nDias}`, unidade: "" }
      : { icone: "chuva", rotulo: "Dia anterior", valor: fmt(c.anteriorMm, 1), unidade: "mm" },
    { icone: "chuva", rotulo: periodo ? "Chuva acumulada" : "Chuva dia atual", valor: fmt(d.chuvaMm, 1), unidade: "mm", destaque: true },
  ];
}
