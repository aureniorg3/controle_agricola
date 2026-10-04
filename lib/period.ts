import { MetaFrente, EntradaDiaria, OrdemCorte, Periodo, TalhaoOrdem } from "./types";

// Todas as contas de data trabalham em UTC sobre strings "YYYY-MM-DD" — assim o
// resultado não muda com o fuso do navegador/servidor (antes, Date local +
// toISOString podia "voltar" ou "avançar" um dia).
function parseDia(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function toDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function startOfWeekMonday(dateStr: string): string {
  const d = parseDia(dateStr);
  const day = d.getUTCDay(); // 0=domingo
  const diff = (day === 0 ? -6 : 1) - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return toDateOnly(d);
}

export function endOfWeekMonday(dateStr: string): string {
  return addDays(startOfWeekMonday(dateStr), 6);
}

export function startOfMonth(dateStr: string): string {
  return dateStr.slice(0, 7) + "-01";
}

export function endOfMonth(dateStr: string): string {
  const [y, m] = dateStr.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${dateStr.slice(0, 7)}-${String(last).padStart(2, "0")}`;
}

export function addDays(dateStr: string, delta: number): string {
  const d = parseDia(dateStr);
  d.setUTCDate(d.getUTCDate() + delta);
  return toDateOnly(d);
}

/** Mesmo dia do mês anterior; se o mês anterior for mais curto (ex.: 31/03 ->
 * fevereiro), cai no último dia dele em vez de "estourar" pro mês seguinte. */
export function mesmoDiaMesAnterior(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const primeiro = new Date(Date.UTC(y, m - 2, 1));
  const ultimoDia = new Date(Date.UTC(y, m - 1, 0)).getUTCDate();
  const dia = Math.min(d, ultimoDia);
  return toDateOnly(new Date(Date.UTC(primeiro.getUTCFullYear(), primeiro.getUTCMonth(), dia)));
}

/** Quinzena civil da data: dia 1–15 ou 16–fim do mês. */
export function quinzenaRange(dateStr: string): { inicio: string; fim: string } {
  const dia = Number(dateStr.slice(8, 10));
  if (dia <= 15) return { inicio: startOfMonth(dateStr), fim: `${dateStr.slice(0, 7)}-15` };
  return { inicio: `${dateStr.slice(0, 7)}-16`, fim: endOfMonth(dateStr) };
}

/** Mês civil anterior ao da data (ex.: referência em setembro -> agosto inteiro). */
export function mesAnteriorRange(dateStr: string): { inicio: string; fim: string } {
  const anterior = mesmoDiaMesAnterior(startOfMonth(dateStr));
  return { inicio: startOfMonth(anterior), fim: endOfMonth(anterior) };
}

export function rangeForPeriod(period: Periodo, referencia: string): { inicio: string; fim: string } | null {
  if (period === "dia") return { inicio: referencia, fim: referencia };
  if (period === "semana") return { inicio: startOfWeekMonday(referencia), fim: endOfWeekMonday(referencia) };
  if (period === "mes") return { inicio: startOfMonth(referencia), fim: endOfMonth(referencia) };
  return null; // safra = sem recorte de data (acumulado)
}

/**
 * Toneladas de uma entrada que contam nos acumulados/períodos da tela: os
 * dias anteriores à referência valem inteiros, o dia da referência vale só até
 * as 06:00 (a fração pesada depois disso não soma) e nada depois da referência.
 */
export function tonAteReferencia(e: EntradaDiaria, referencia: string): number {
  if (e.data > referencia) return 0;
  return e.data === referencia ? e.toneladasAte6h : e.toneladas;
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
    .reduce((s, e) => s + tonAteReferencia(e, referencia), 0);
  return Math.round(total * 100) / 100;
}

export interface OrdemMetrics {
  entradaPeriodoT: number;
  acumSafraT: number;
  areaTotalHa: number;
  tchGeralRealizado: number;
  temMovimentoNoPeriodo: boolean;
}

/** Acumulado da ordem até a referência (dia da referência só até 06:00). */
export function calcAcumSafraT(ordem: OrdemCorte, referencia: string): number {
  return ordem.entradas.reduce((s, e) => s + tonAteReferencia(e, referencia), 0);
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
export function resumoDetalhadoPorOrdemFazenda(ordens: OrdemCorte[], referencia: string): LinhaResumoDetalhado[] {
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
      if (atual) atual.producaoT += tonAteReferencia(e, referencia);
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
  const acumSafraT = calcAcumSafraT(ordem, referencia);
  const areaTotalHa = calcAreaTotalHa(ordem);
  const range = rangeForPeriod(period, referencia);
  const entradaPeriodoT =
    range === null
      ? acumSafraT
      : ordem.entradas
          .filter((e) => e.data >= range.inicio && e.data <= range.fim)
          .reduce((s, e) => s + tonAteReferencia(e, referencia), 0);
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

function somaNoIntervalo(
  entradas: EntradaDiaria[],
  range: { inicio: string; fim: string } | null,
  referencia: string
): number {
  return entradas
    .filter((e) => range === null || (e.data >= range.inicio && e.data <= range.fim))
    .reduce((s, e) => s + tonAteReferencia(e, referencia), 0);
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
  metas: MetaFrente[] = [],
  safraInicio?: string,
  primeiraEntradaPorFrente?: Record<string, string>,
  /** horário de corte do dia atual (6, 12, 18 ou 24 = 00:00); a meta do dia atual é a fração hora/24 */
  horaCorte = 6
): FrenteResumo[] {
  // Semana/Quinzena/Mês Atual/Safra vão até o DIA ANTERIOR à referência: a
  // entrada do dia atual (parcial, até o horário de corte) aparece só na
  // coluna "Dia Atual" e não entra nesses acumulados. Também não passam da
  // referência — escolher uma data retroativa não mistura produção de dias
  // futuros já presentes na base. Mês Anterior e Dia Anterior já são
  // inteiramente passados.
  const ontem = addDays(referencia, -1);
  const diaAnterior = { inicio: ontem, fim: ontem };
  const semana = { inicio: startOfWeekMonday(referencia), fim: ontem };
  const quinzena = { inicio: quinzenaRange(referencia).inicio, fim: ontem };
  const mesAtual = { inicio: startOfMonth(referencia), fim: ontem };
  const mesAnterior = mesAnteriorRange(referencia);
  // a safra conta a partir do início da produção cadastrada (Cadastros > Safras)
  const safra = { inicio: safraInicio ?? "0000-01-01", fim: ontem };

  // A meta de uma frente só conta a partir do dia da primeira entrada de cana
  // dela (e é reajustada pelas vigências das metas cadastradas); antes disso,
  // ou se a frente ainda não teve entrada, a meta é zero.
  function metasDaFrente(frente: string): MetasPorPeriodo {
    const primeira = primeiraEntradaPorFrente ? primeiraEntradaPorFrente[frente] : "0000-01-01";
    const desde = (r: { inicio: string; fim: string }) =>
      primeira === undefined ? { inicio: "9999-12-31", fim: "0000-01-01" } : { inicio: r.inicio > primeira ? r.inicio : primeira, fim: r.fim };
    return {
      safra: round2(metaNoIntervalo(metas, frente, desde(safra))),
      mesAnterior: round2(metaNoIntervalo(metas, frente, desde(mesAnterior))),
      mesAtual: round2(metaNoIntervalo(metas, frente, desde(mesAtual))),
      quinzena: round2(metaNoIntervalo(metas, frente, desde(quinzena))),
      semana: round2(metaNoIntervalo(metas, frente, desde(semana))),
      diaAnterior: round2(metaNoIntervalo(metas, frente, desde(diaAnterior))),
      diaAtual:
        primeira !== undefined && referencia >= primeira
          ? round2((metaDoDia(metas, frente, referencia) * horaCorte) / 24)
          : 0,
    };
  }

  const map = new Map<string, FrenteResumo>();
  function getOrInit(frente: string): FrenteResumo {
    let atual = map.get(frente);
    if (!atual) {
      atual = {
        frente,
        meta: metasDaFrente(frente),
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
    atual.safraT += somaNoIntervalo(ordem.entradas, safra, referencia);
    atual.mesAnteriorT += somaNoIntervalo(ordem.entradas, mesAnterior, referencia);
    atual.mesAtualT += somaNoIntervalo(ordem.entradas, mesAtual, referencia);
    atual.quinzenaT += somaNoIntervalo(ordem.entradas, quinzena, referencia);
    atual.semanaT += somaNoIntervalo(ordem.entradas, semana, referencia);
    atual.diaAnteriorT += somaNoIntervalo(ordem.entradas, diaAnterior, referencia);
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

export interface CelulaResumoMensal {
  /** toneladas da frente no dia (até o horário de corte, no dia da referência) */
  t: number;
  /** meta da frente no dia; 0 quando não há meta (antes da 1ª entrada da frente ou sem meta vigente) */
  meta: number;
}

export interface DiaResumoMensal {
  data: string;
  /** depois da data de referência: o dia ainda não aconteceu, fica em branco */
  futuro: boolean;
  frentes: Record<string, CelulaResumoMensal>;
  totalT: number;
  totalMeta: number;
}

export interface ResumoMensal {
  mes: string;
  frentes: string[];
  dias: DiaResumoMensal[];
  /** acumulado do mês até a referência, por frente */
  totais: Record<string, CelulaResumoMensal>;
  totalT: number;
  totalMeta: number;
}

/**
 * Uma linha por dia do mês (todos os dias, até os que ainda não chegaram) e
 * uma coluna por frente, com a tonelada do dia e a meta do dia da frente. Os
 * dias passados valem o dia inteiro; o dia da referência vale até o horário
 * de corte (`toneladasAte6h` já vem assim da tela) com a meta proporcional
 * hora/24; os seguintes ficam em branco.
 */
export function resumoDiarioMes(
  ordens: OrdemCorte[],
  mes: string,
  referencia: string,
  frentes: string[],
  metas: MetaFrente[],
  primeiraEntradaPorFrente: Record<string, string>,
  horaCorte: number
): ResumoMensal {
  const porDia = new Map<string, number>();
  for (const o of ordens) {
    for (const e of o.entradas) {
      if (e.data.slice(0, 7) !== mes) continue;
      const t = e.data === referencia ? e.toneladasAte6h : e.toneladas;
      const k = `${o.frente}|${e.data}`;
      porDia.set(k, (porDia.get(k) ?? 0) + t);
    }
  }

  const inicio = `${mes}-01`;
  const fim = endOfMonth(inicio);
  const totais: Record<string, CelulaResumoMensal> = Object.fromEntries(frentes.map((f) => [f, { t: 0, meta: 0 }]));
  const dias: DiaResumoMensal[] = [];
  for (let d = inicio; d <= fim; d = addDays(d, 1)) {
    const futuro = d > referencia;
    const celulas: Record<string, CelulaResumoMensal> = {};
    let totalT = 0;
    let totalMeta = 0;
    for (const f of frentes) {
      const primeira = primeiraEntradaPorFrente[f];
      let meta = primeira !== undefined && d >= primeira && !futuro ? metaDoDia(metas, f, d) : 0;
      if (d === referencia) meta = (meta * horaCorte) / 24;
      const t = futuro ? 0 : round2(porDia.get(`${f}|${d}`) ?? 0);
      celulas[f] = { t, meta: round2(meta) };
      totalT += t;
      totalMeta += meta;
      if (!futuro) {
        totais[f].t += t;
        totais[f].meta += meta;
      }
    }
    dias.push({ data: d, futuro, frentes: celulas, totalT: round2(totalT), totalMeta: round2(totalMeta) });
  }
  for (const f of frentes) totais[f] = { t: round2(totais[f].t), meta: round2(totais[f].meta) };
  const totalT = round2(dias.reduce((s, x) => s + x.totalT, 0));
  const totalMeta = round2(dias.reduce((s, x) => s + x.totalMeta, 0));
  return { mes, frentes, dias, totais, totalT, totalMeta };
}
