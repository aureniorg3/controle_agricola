import { Lancamento, OrdemCorte, Periodo } from "./types";

export function toDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function startOfWeekMonday(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  const day = d.getDay(); // 0=domingo
  const diff = (day === 0 ? -6 : 1) - day;
  d.setDate(d.getDate() + diff);
  return toDateOnly(d);
}

export function endOfWeekMonday(dateStr: string): string {
  const start = new Date(`${startOfWeekMonday(dateStr)}T00:00:00`);
  start.setDate(start.getDate() + 6);
  return toDateOnly(start);
}

export function startOfMonth(dateStr: string): string {
  return dateStr.slice(0, 7) + "-01";
}

export function endOfMonth(dateStr: string): string {
  const [y, m] = dateStr.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  return `${dateStr.slice(0, 7)}-${String(last).padStart(2, "0")}`;
}

export function rangeForPeriod(period: Periodo, referencia: string): { inicio: string; fim: string } | null {
  if (period === "dia") return { inicio: referencia, fim: referencia };
  if (period === "semana") return { inicio: startOfWeekMonday(referencia), fim: endOfWeekMonday(referencia) };
  if (period === "mes") return { inicio: startOfMonth(referencia), fim: endOfMonth(referencia) };
  return null; // safra = sem recorte de data
}

function somaLancamentos(lancamentos: Lancamento[], inicio: string, fim: string): number {
  return lancamentos
    .filter((l) => l.data >= inicio && l.data <= fim)
    .reduce((s, l) => s + l.toneladas, 0);
}

export interface OrdemMetrics {
  entradaPeriodoT: number;
  acumSafraT: number;
  areaTotalHa: number;
  tchGeralRealizado: number;
  temMovimentoNoPeriodo: boolean;
}

export function calcAcumSafraT(ordem: OrdemCorte): number {
  return ordem.talhoes.reduce((s, t) => s + t.acumSafraT, 0);
}

export function calcAreaTotalHa(ordem: OrdemCorte): number {
  return ordem.talhoes.reduce((s, t) => s + t.areaHa, 0);
}

export function calcOrdemMetrics(ordem: OrdemCorte, period: Periodo, referencia: string): OrdemMetrics {
  const acumSafraT = calcAcumSafraT(ordem);
  const areaTotalHa = calcAreaTotalHa(ordem);
  const range = rangeForPeriod(period, referencia);
  const entradaPeriodoT =
    range === null ? acumSafraT : somaLancamentos(ordem.lancamentos, range.inicio, range.fim);
  const tchGeralRealizado = ordem.areaColhidaHa > 0 ? acumSafraT / ordem.areaColhidaHa : 0;
  return {
    entradaPeriodoT: Math.round(entradaPeriodoT * 100) / 100,
    acumSafraT: Math.round(acumSafraT * 100) / 100,
    areaTotalHa: Math.round(areaTotalHa * 100) / 100,
    tchGeralRealizado: Math.round(tchGeralRealizado * 100) / 100,
    temMovimentoNoPeriodo: range === null ? acumSafraT > 0 : entradaPeriodoT > 0,
  };
}

export interface FrenteResumo {
  frente: string;
  ordens: number;
  entradaPeriodoT: number;
  areaLiberadaHa: number;
}

export function resumoPorFrente(
  ordens: OrdemCorte[],
  period: Periodo,
  referencia: string
): FrenteResumo[] {
  const map = new Map<string, FrenteResumo>();
  for (const ordem of ordens) {
    const m = calcOrdemMetrics(ordem, period, referencia);
    const atual = map.get(ordem.frente) ?? {
      frente: ordem.frente,
      ordens: 0,
      entradaPeriodoT: 0,
      areaLiberadaHa: 0,
    };
    atual.ordens += 1;
    atual.entradaPeriodoT += m.entradaPeriodoT;
    atual.areaLiberadaHa += ordem.areaLiberadaHa;
    map.set(ordem.frente, atual);
  }
  return Array.from(map.values())
    .map((r) => ({
      ...r,
      entradaPeriodoT: Math.round(r.entradaPeriodoT * 100) / 100,
      areaLiberadaHa: Math.round(r.areaLiberadaHa * 100) / 100,
    }))
    .sort((a, b) => a.frente.localeCompare(b.frente));
}
