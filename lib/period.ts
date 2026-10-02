import { MetaFrente, EntradaDiaria, OrdemCorte, Periodo, TalhaoOrdem } from "./types";

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
    .filter((e) => e.talhao === talhao.talhao && e.fazendaCodigo === talhao.fazendaCodigo)
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

/** Soma da área colhida lançada manualmente (medição de campo) por talhão. */
export function calcAreaColhidaHa(ordem: OrdemCorte): number {
  return Math.round(ordem.talhoes.reduce((s, t) => s + t.areaColhidaHa, 0) * 100) / 100;
}

/** Entrada do talhão no dia anterior à referência (dia civil inteiro). */
export function calcTalhaoDiaAnterior(ordem: OrdemCorte, talhao: TalhaoOrdem, referencia: string): number {
  const diaAnterior = addDays(referencia, -1);
  const total = ordem.entradas
    .filter((e) => e.talhao === talhao.talhao && e.fazendaCodigo === talhao.fazendaCodigo && e.data === diaAnterior)
    .reduce((s, e) => s + e.toneladas, 0);
  return Math.round(total * 100) / 100;
}

/** Entrada do talhão no dia da referência, só a fração pesada até 06:00. */
export function calcTalhaoDiaAtualAte6h(ordem: OrdemCorte, talhao: TalhaoOrdem, referencia: string): number {
  const total = ordem.entradas
    .filter((e) => e.talhao === talhao.talhao && e.fazendaCodigo === talhao.fazendaCodigo && e.data === referencia)
    .reduce((s, e) => s + e.toneladasAte6h, 0);
  return Math.round(total * 100) / 100;
}

export interface LinhaResumoDetalhado {
  frente: string;
  ordem: string;
  fazendaCodigo: string;
  fazendaNome: string;
  areaColhidaHa: number;
  producaoTotalT: number;
  /** Produção ÷ área colhida — "parcial" porque divide pelo que já foi
   * colhido até agora, não pela área total da ordem. */
  tchRealParcial: number;
}

/**
 * Uma linha por (ordem, fazenda) — uma ordem com mais de uma fazenda vira
 * mais de uma linha, igual ao relatório impresso de referência. Usada no
 * resumo detalhado da tela e no PDF.
 */
export function resumoDetalhadoPorOrdemFazenda(ordens: OrdemCorte[]): LinhaResumoDetalhado[] {
  const linhas: LinhaResumoDetalhado[] = [];
  for (const ordem of ordens) {
    const porFazenda = new Map<string, { fazendaNome: string; areaColhidaHa: number; producaoT: number }>();
    for (const t of ordem.talhoes) {
      const atual = porFazenda.get(t.fazendaCodigo) ?? { fazendaNome: t.fazendaNome, areaColhidaHa: 0, producaoT: 0 };
      atual.areaColhidaHa += t.areaColhidaHa;
      porFazenda.set(t.fazendaCodigo, atual);
    }
    for (const e of ordem.entradas) {
      const atual = porFazenda.get(e.fazendaCodigo);
      if (atual) atual.producaoT += e.toneladas;
    }
    for (const [fazendaCodigo, dados] of porFazenda) {
      const areaColhidaHa = round2(dados.areaColhidaHa);
      const producaoTotalT = round2(dados.producaoT);
      linhas.push({
        frente: ordem.frente,
        ordem: ordem.numero,
        fazendaCodigo,
        fazendaNome: dados.fazendaNome,
        areaColhidaHa,
        producaoTotalT,
        tchRealParcial: areaColhidaHa > 0 ? round2(producaoTotalT / areaColhidaHa) : 0,
      });
    }
  }
  return linhas.sort((a, b) =>
    a.frente === b.frente
      ? a.ordem.localeCompare(b.ordem, undefined, { numeric: true })
      : a.frente.localeCompare(b.frente)
  );
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

function diasInclusivo(inicio: string, fim: string): number {
  const a = Date.parse(inicio + "T00:00:00Z");
  const b = Date.parse(fim + "T00:00:00Z");
  return b < a ? 0 : Math.round((b - a) / 86400000) + 1;
}

/** Meta (t/dia) em vigor num dia: a última cadastrada com vigência <= dia. */
export function metaDoDia(metas: MetaFrente[], frente: string, dia: string): number {
  let atual: MetaFrente | undefined;
  for (const m of metas) {
    if (m.frente === frente && m.vigencia <= dia && (!atual || m.vigencia > atual.vigencia)) atual = m;
  }
  return atual ? atual.metaDiaT : 0;
}

/**
 * Soma da meta diária da frente nos dias do intervalo — cada trecho de dias
 * usa a meta vigente nele (uma meta nova só vale da sua data em diante; os
 * dias anteriores continuam com a anterior, e antes da primeira não há meta).
 */
export function metaNoIntervalo(
  metas: MetaFrente[],
  frente: string,
  range: { inicio: string; fim: string }
): number {
  const lista = metas.filter((m) => m.frente === frente).sort((a, b) => a.vigencia.localeCompare(b.vigencia));
  let total = 0;
  for (let i = 0; i < lista.length; i++) {
    const trechoInicio = lista[i].vigencia;
    const trechoFim = i + 1 < lista.length ? addDays(lista[i + 1].vigencia, -1) : "9999-12-31";
    const ini = trechoInicio > range.inicio ? trechoInicio : range.inicio;
    const fim = trechoFim < range.fim ? trechoFim : range.fim;
    total += diasInclusivo(ini, fim) * lista[i].metaDiaT;
  }
  return total;
}

export interface MetasPorPeriodo {
  safra: number;
  mesAnterior: number;
  mesAtual: number;
  quinzena: number;
  semana: number;
  diaAnterior: number;
  /** "Dia Atual" é só a madrugada (até 06h): meta proporcional, 6/24 do dia. */
  diaAtual: number;
}

export interface FrenteResumo {
  /** meta acumulada em cada recorte (t) — 0 quando a frente não tem meta. */
  meta: MetasPorPeriodo;
  frente: string;
  /** contagem e área só das ordens selecionadas/mostradas nos cards. */
  ordensSelecionadas: number;
  areaSelecionadaHa: number;
  /** área de TODAS as ordens da frente no filtro (frente/status/busca),
   * sem o recorte de seleção — mesmo critério dos campos abaixo. */
  areaAcumuladaHa: number;
  safraT: number;
  mesAnteriorT: number;
  mesAtualT: number;
  quinzenaT: number;
  semanaT: number;
  diaAnteriorT: number;
  /** só a fração das entradas do dia de referência pesada até 06:00. */
  diaAtualT: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
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
 *
 * Recebe duas listas: `ordensSelecionadas` (as marcadas pra aparecer nos
 * cards — alimenta só "Ordens" e "Área" selecionada) e `ordensTodas` (todo
 * mundo que bate com os filtros de frente/status/busca, sem o recorte de
 * seleção — alimenta a área acumulada e todas as colunas de tonelada). A
 * tabela de resumo é sempre o retrato real da frente inteira; só os cards
 * abaixo dela é que são curados pela seleção manual.
 */
export function resumoPorFrente(
  ordensSelecionadas: OrdemCorte[],
  ordensTodas: OrdemCorte[],
  referencia: string,
  metas: MetaFrente[] = []
): FrenteResumo[] {
  // Semana/Quinzena/Mês Atual/Safra são recortes "até a data selecionada":
  // o fim de cada um é sempre a própria referência, nunca o fim natural do
  // período — senão, escolher uma data retroativa mostraria produção de
  // dias futuros (já presentes na base por causa de importações mais
  // recentes) misturada com o que realmente tinha até aquele dia. Mês
  // Anterior e Dia Anterior já são inteiramente passados em relação à
  // referência, então não precisam desse limite.
  const diaAnterior = { inicio: addDays(referencia, -1), fim: addDays(referencia, -1) };
  const semana = { inicio: startOfWeekMonday(referencia), fim: referencia };
  const quinzena = { inicio: quinzenaRange(referencia).inicio, fim: referencia };
  const mesAtual = { inicio: startOfMonth(referencia), fim: referencia };
  const mesAnterior = mesAnteriorRange(referencia);
  const safra = { inicio: "0000-01-01", fim: referencia };

  const map = new Map<string, FrenteResumo>();
  function getOrInit(frente: string): FrenteResumo {
    let atual = map.get(frente);
    if (!atual) {
      atual = {
        frente,
        meta: {
          safra: round2(metaNoIntervalo(metas, frente, safra)),
          mesAnterior: round2(metaNoIntervalo(metas, frente, mesAnterior)),
          mesAtual: round2(metaNoIntervalo(metas, frente, mesAtual)),
          quinzena: round2(metaNoIntervalo(metas, frente, quinzena)),
          semana: round2(metaNoIntervalo(metas, frente, semana)),
          diaAnterior: round2(metaNoIntervalo(metas, frente, diaAnterior)),
          diaAtual: round2((metaDoDia(metas, frente, referencia) * 6) / 24),
        },
        ordensSelecionadas: 0,
        areaSelecionadaHa: 0,
        areaAcumuladaHa: 0,
        safraT: 0,
        mesAnteriorT: 0,
        mesAtualT: 0,
        quinzenaT: 0,
        semanaT: 0,
        diaAnteriorT: 0,
        diaAtualT: 0,
      };
      map.set(frente, atual);
    }
    return atual;
  }

  for (const ordem of ordensSelecionadas) {
    const atual = getOrInit(ordem.frente);
    atual.ordensSelecionadas += 1;
    atual.areaSelecionadaHa += calcAreaTotalHa(ordem);
  }

  for (const ordem of ordensTodas) {
    const atual = getOrInit(ordem.frente);
    atual.areaAcumuladaHa += calcAreaTotalHa(ordem);
    atual.safraT += somaNoIntervalo(ordem.entradas, safra);
    atual.mesAnteriorT += somaNoIntervalo(ordem.entradas, mesAnterior);
    atual.mesAtualT += somaNoIntervalo(ordem.entradas, mesAtual);
    atual.quinzenaT += somaNoIntervalo(ordem.entradas, quinzena);
    atual.semanaT += somaNoIntervalo(ordem.entradas, semana);
    atual.diaAnteriorT += somaNoIntervalo(ordem.entradas, diaAnterior);
    atual.diaAtualT += ordem.entradas
      .filter((e) => e.data === referencia)
      .reduce((s, e) => s + e.toneladasAte6h, 0);
  }

  return Array.from(map.values())
    .map((r) => ({
      ...r,
      areaSelecionadaHa: round2(r.areaSelecionadaHa),
      areaAcumuladaHa: round2(r.areaAcumuladaHa),
      safraT: round2(r.safraT),
      mesAnteriorT: round2(r.mesAnteriorT),
      mesAtualT: round2(r.mesAtualT),
      quinzenaT: round2(r.quinzenaT),
      semanaT: round2(r.semanaT),
      diaAnteriorT: round2(r.diaAnteriorT),
      diaAtualT: round2(r.diaAtualT),
    }))
    .sort((a, b) => a.frente.localeCompare(b.frente));
}
