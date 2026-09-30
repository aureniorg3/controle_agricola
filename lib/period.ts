import { EntradaDiaria, OrdemCorte, Periodo, TalhaoOrdem } from "./types";

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

export function addDays(dateStr: string, delta: number): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + delta);
  return toDateOnly(d);
}

/** Quinzena civil da data: dia 1–15 ou 16–fim do mês. */
export function quinzenaRange(dateStr: string): { inicio: string; fim: string } {
  const dia = Number(dateStr.slice(8, 10));
  if (dia <= 15) return { inicio: startOfMonth(dateStr), fim: `${dateStr.slice(0, 7)}-15` };
  return { inicio: `${dateStr.slice(0, 7)}-16`, fim: endOfMonth(dateStr) };
}

/** Mês civil anterior ao da data (ex.: referência em setembro -> agosto inteiro). */
export function mesAnteriorRange(dateStr: string): { inicio: string; fim: string } {
  const [y, m] = dateStr.split("-").map(Number);
  const anterior = toDateOnly(new Date(y, m - 2, 1)); // m é 1-indexado; m-2 = mês anterior em Date (0-indexado)
  return { inicio: startOfMonth(anterior), fim: endOfMonth(anterior) };
}

export function rangeForPeriod(period: Periodo, referencia: string): { inicio: string; fim: string } | null {
  if (period === "dia") return { inicio: referencia, fim: referencia };
  if (period === "semana") return { inicio: startOfWeekMonday(referencia), fim: endOfWeekMonday(referencia) };
  if (period === "mes") return { inicio: startOfMonth(referencia), fim: endOfMonth(referencia) };
  return null; // safra = sem recorte de data (acumulado)
}

/** Entrada de um talhão no período selecionado — soma direta, sem rateio:
 * cada `EntradaDiaria` já vem por talhão, direto das viagens reais. */
export function calcTalhaoEntradaPeriodo(
  ordem: OrdemCorte,
  talhao: TalhaoOrdem,
  period: Periodo,
  referencia: string
): number {
  const range = rangeForPeriod(period, referencia);
  const total = ordem.entradas
    .filter((e) => e.talhao === talhao.talhao)
    .filter((e) => range === null || (e.data >= range.inicio && e.data <= range.fim))
    .reduce((s, e) => s + e.toneladas, 0);
  return Math.round(total * 100) / 100;
}

export interface OrdemMetrics {
  entradaPeriodoT: number;
  acumSafraT: number;
  areaTotalHa: number;
  tchGeralRealizado: number;
  temMovimentoNoPeriodo: boolean;
}

export function calcAcumSafraT(ordem: OrdemCorte): number {
  return ordem.entradas.reduce((s, e) => s + e.toneladas, 0);
}

export function calcAreaTotalHa(ordem: OrdemCorte): number {
  return ordem.talhoes.reduce((s, t) => s + t.areaHa, 0);
}

export function calcOrdemMetrics(ordem: OrdemCorte, period: Periodo, referencia: string): OrdemMetrics {
  const acumSafraT = calcAcumSafraT(ordem);
  const areaTotalHa = calcAreaTotalHa(ordem);
  const range = rangeForPeriod(period, referencia);
  const entradaPeriodoT =
    range === null
      ? acumSafraT
      : ordem.entradas
          .filter((e) => e.data >= range.inicio && e.data <= range.fim)
          .reduce((s, e) => s + e.toneladas, 0);
  const tchGeralRealizado = areaTotalHa > 0 ? acumSafraT / areaTotalHa : 0;
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
  areaHa: number;
  safraT: number;
  mesAnteriorT: number;
  mesAtualT: number;
  quinzenaT: number;
  semanaT: number;
  diaAnteriorT: number;
  /** só a fração das entradas do dia de referência pesada até 06:00. */
  diaAtualT: number;
}

function somaNoIntervalo(entradas: EntradaDiaria[], range: { inicio: string; fim: string } | null): number {
  if (range === null) return entradas.reduce((s, e) => s + e.toneladas, 0);
  return entradas
    .filter((e) => e.data >= range.inicio && e.data <= range.fim)
    .reduce((s, e) => s + e.toneladas, 0);
}

/**
 * Resumo por frente com todos os recortes de período de uma vez (em vez de
 * um só, controlado pelos botões Dia/Semana/Mês/Safra) — cada coluna se
 * recalcula sozinha sempre que a data de referência muda.
 */
export function resumoPorFrente(ordens: OrdemCorte[], referencia: string): FrenteResumo[] {
  const diaAnterior = { inicio: addDays(referencia, -1), fim: addDays(referencia, -1) };
  const semana = { inicio: startOfWeekMonday(referencia), fim: endOfWeekMonday(referencia) };
  const quinzena = quinzenaRange(referencia);
  const mesAtual = { inicio: startOfMonth(referencia), fim: endOfMonth(referencia) };
  const mesAnterior = mesAnteriorRange(referencia);

  const map = new Map<string, FrenteResumo>();
  for (const ordem of ordens) {
    const atual = map.get(ordem.frente) ?? {
      frente: ordem.frente,
      ordens: 0,
      areaHa: 0,
      safraT: 0,
      mesAnteriorT: 0,
      mesAtualT: 0,
      quinzenaT: 0,
      semanaT: 0,
      diaAnteriorT: 0,
      diaAtualT: 0,
    };
    atual.ordens += 1;
    atual.areaHa += calcAreaTotalHa(ordem);
    atual.safraT += somaNoIntervalo(ordem.entradas, null);
    atual.mesAnteriorT += somaNoIntervalo(ordem.entradas, mesAnterior);
    atual.mesAtualT += somaNoIntervalo(ordem.entradas, mesAtual);
    atual.quinzenaT += somaNoIntervalo(ordem.entradas, quinzena);
    atual.semanaT += somaNoIntervalo(ordem.entradas, semana);
    atual.diaAnteriorT += somaNoIntervalo(ordem.entradas, diaAnterior);
    atual.diaAtualT += ordem.entradas
      .filter((e) => e.data === referencia)
      .reduce((s, e) => s + e.toneladasAte6h, 0);
    map.set(ordem.frente, atual);
  }
  return Array.from(map.values())
    .map((r) => ({
      ...r,
      areaHa: Math.round(r.areaHa * 100) / 100,
      safraT: Math.round(r.safraT * 100) / 100,
      mesAnteriorT: Math.round(r.mesAnteriorT * 100) / 100,
      mesAtualT: Math.round(r.mesAtualT * 100) / 100,
      quinzenaT: Math.round(r.quinzenaT * 100) / 100,
      semanaT: Math.round(r.semanaT * 100) / 100,
      diaAnteriorT: Math.round(r.diaAnteriorT * 100) / 100,
      diaAtualT: Math.round(r.diaAtualT * 100) / 100,
    }))
    .sort((a, b) => a.frente.localeCompare(b.frente));
}
