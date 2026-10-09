// Todas as contas de data trabalham em UTC sobre strings "YYYY-MM-DD" — assim o
// resultado não muda com o fuso do navegador/servidor (antes, Date local +
// toISOString podia "voltar" ou "avançar" um dia).
function parseDia(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function toDateOnly(d) {
  return d.toISOString().slice(0, 10);
}

export function startOfWeekMonday(dateStr) {
  const d = parseDia(dateStr);
  const day = d.getUTCDay(); // 0=domingo
  const diff = (day === 0 ? -6 : 1) - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return toDateOnly(d);
}

export function endOfWeekMonday(dateStr) {
  return addDays(startOfWeekMonday(dateStr), 6);
}

export function startOfMonth(dateStr) {
  return dateStr.slice(0, 7) + "-01";
}

export function endOfMonth(dateStr) {
  const [y, m] = dateStr.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${dateStr.slice(0, 7)}-${String(last).padStart(2, "0")}`;
}

export function addDays(dateStr, delta) {
  const d = parseDia(dateStr);
  d.setUTCDate(d.getUTCDate() + delta);
  return toDateOnly(d);
}

/** Mesmo dia do mês anterior; se o mês anterior for mais curto (ex.: 31/03 ->
 * fevereiro), cai no último dia dele em vez de "estourar" pro mês seguinte. */
export function mesmoDiaMesAnterior(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const primeiro = new Date(Date.UTC(y, m - 2, 1));
  const ultimoDia = new Date(Date.UTC(y, m - 1, 0)).getUTCDate();
  const dia = Math.min(d, ultimoDia);
  return toDateOnly(new Date(Date.UTC(primeiro.getUTCFullYear(), primeiro.getUTCMonth(), dia)));
}

/** Quinzena civil da data: dia 1–15 ou 16–fim do mês. */
export function quinzenaRange(dateStr) {
  const dia = Number(dateStr.slice(8, 10));
  if (dia <= 15) return { inicio: startOfMonth(dateStr), fim: `${dateStr.slice(0, 7)}-15` };
  return { inicio: `${dateStr.slice(0, 7)}-16`, fim: endOfMonth(dateStr) };
}

/** Mês civil anterior ao da data (ex.: referência em setembro -> agosto inteiro). */
export function mesAnteriorRange(dateStr) {
  const anterior = mesmoDiaMesAnterior(startOfMonth(dateStr));
  return { inicio: startOfMonth(anterior), fim: endOfMonth(anterior) };
}

export function rangeForPeriod(period, referencia) {
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
export function tonAteReferencia(e, referencia) {
  if (e.data > referencia) return 0;
  return e.data === referencia ? e.toneladasAte6h : e.toneladas;
}

/** Entrada de um talhão no período selecionado — soma direta, sem rateio:
 * cada `EntradaDiaria` já vem por talhão, direto das viagens reais. */
export function calcTalhaoEntradaPeriodo(ordem, talhao, period, referencia) {
  const range = rangeForPeriod(period, referencia);
  const total = ordem.entradas
    .filter((e) => e.talhao === talhao.talhao && e.fazendaCodigo === talhao.fazendaCodigo)
    .filter((e) => range === null || (e.data >= range.inicio && e.data <= range.fim))
    .reduce((s, e) => s + tonAteReferencia(e, referencia), 0);
  return Math.round(total * 100) / 100;
}

/** Acumulado da ordem até a referência (dia da referência só até 06:00). */
export function calcAcumSafraT(ordem, referencia) {
  return ordem.entradas.reduce((s, e) => s + tonAteReferencia(e, referencia), 0);
}

export function calcAreaTotalHa(ordem) {
  return ordem.talhoes.reduce((s, t) => s + t.areaHa, 0);
}

/** Soma da área colhida lançada manualmente (medição de campo) por talhão. */
export function calcAreaColhidaHa(ordem) {
  return Math.round(ordem.talhoes.reduce((s, t) => s + t.areaColhidaHa, 0) * 100) / 100;
}

/** Entrada do talhão no dia anterior à referência (dia civil inteiro). */
export function calcTalhaoDiaAnterior(ordem, talhao, referencia) {
  const diaAnterior = addDays(referencia, -1);
  const total = ordem.entradas
    .filter((e) => e.talhao === talhao.talhao && e.fazendaCodigo === talhao.fazendaCodigo && e.data === diaAnterior)
    .reduce((s, e) => s + e.toneladas, 0);
  return Math.round(total * 100) / 100;
}

/** Entrada do talhão no dia da referência, só a fração pesada até 06:00. */
export function calcTalhaoDiaAtualAte6h(ordem, talhao, referencia) {
  const total = ordem.entradas
    .filter((e) => e.talhao === talhao.talhao && e.fazendaCodigo === talhao.fazendaCodigo && e.data === referencia)
    .reduce((s, e) => s + e.toneladasAte6h, 0);
  return Math.round(total * 100) / 100;
}

/** Números do resumo detalhado (de uma linha, do total da frente ou do total geral). */
/**
 * Variação da produção total projetada da ordem (entregue + a colher, sobre a área toda) sobre a produção estimada
 * (área total × TCH estimado): (ton projetada ÷ ton estimada − 1) em %; positivo é ganho, negativo é perda. Nos
 * totais, só as linhas com TCH estimado entram dos dois lados. Sem estimativa ou sem projeção, null.
 */
export function deltaProjetadoPct(v) {
  return v.tonEst > 0 && v.tonProjetadaComEst > 0 ? round2((v.tonProjetadaComEst / v.tonEst - 1) * 100) : null;
}

/** "+12,3%" / "-8,4%" (uma casa) ou "–". */
export function fmtDeltaPct(p) {
  if (p === null) return "–";
  return `${p > 0 ? "+" : ""}${p.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

/** Soma linhas do resumo detalhado (TCHs ponderados pela área de cada um). */
export function totaisResumoDetalhado(linhas) {
  let areaTotalHa = 0,
    areaComEst = 0,
    tonEst = 0,
    areaColhidaHa = 0,
    producaoTotalT = 0,
    areaAColherHa = 0,
    tonAColher = 0,
    tonProjetada = 0,
    tonProjetadaComEst = 0;
  for (const l of linhas) {
    areaTotalHa += l.areaTotalHa;
    if (l.tchEst !== null) areaComEst += l.areaTotalHa;
    tonEst += l.tonEst;
    areaColhidaHa += l.areaColhidaHa;
    producaoTotalT += l.producaoTotalT;
    areaAColherHa += l.areaAColherHa;
    tonAColher += l.tonAColher;
    tonProjetada += l.tonProjetada;
    tonProjetadaComEst += l.tonProjetadaComEst;
  }
  return {
    areaTotalHa: round2(areaTotalHa),
    tchEst: areaComEst > 0 ? round2(tonEst / areaComEst) : null,
    tonEst: round2(tonEst),
    areaColhidaHa: round2(areaColhidaHa),
    producaoTotalT: round2(producaoTotalT),
    tchRealParcial: areaColhidaHa > 0 ? round2(producaoTotalT / areaColhidaHa) : 0,
    areaAColherHa: round2(areaAColherHa),
    tchAColher: areaAColherHa > 0 && tonAColher > 0 ? round2(tonAColher / areaAColherHa) : null,
    tonAColher: round2(tonAColher),
    tonProjetada: round2(tonProjetada),
    tonProjetadaComEst: round2(tonProjetadaComEst),
  };
}

/**
 * Uma linha por (ordem, fazenda) — uma ordem com mais de uma fazenda vira
 * mais de uma linha, igual ao relatório impresso de referência. Usada no
 * resumo detalhado da tela e no PDF. `tchEstimado` dá o TCH estimado da ordem.
 */
export function resumoDetalhadoPorOrdemFazenda(ordens, referencia, tchEstimado = () => null) {
  const linhas = [];
  for (const ordem of ordens) {
    const est = tchEstimado(ordem.numero);
    const tchEst = est !== null && est > 0 ? est : null;
    const porFazenda = new Map();
    for (const t of ordem.talhoes) {
      const atual = porFazenda.get(t.fazendaCodigo) ?? { fazendaNome: t.fazendaNome, areaTotalHa: 0, areaColhidaHa: 0, producaoT: 0 };
      atual.areaTotalHa += t.areaHa;
      atual.areaColhidaHa += t.areaColhidaHa;
      porFazenda.set(t.fazendaCodigo, atual);
    }
    for (const e of ordem.entradas) {
      const atual = porFazenda.get(e.fazendaCodigo);
      if (atual) atual.producaoT += tonAteReferencia(e, referencia);
    }
    for (const [fazendaCodigo, dados] of porFazenda) {
      const areaTotalHa = round2(dados.areaTotalHa);
      const areaColhidaHa = round2(dados.areaColhidaHa);
      const producaoTotalT = round2(dados.producaoT);
      const tchRealParcial = areaColhidaHa > 0 ? round2(producaoTotalT / areaColhidaHa) : 0;
      // ordem encerrada não tem mais o que colher
      const areaAColherHa = ordem.status === "Aberta" ? round2(Math.max(0, areaTotalHa - areaColhidaHa)) : 0;
      const tchAColher = areaAColherHa > 0 ? (tchRealParcial > 0 ? tchRealParcial : tchEst) : null;
      const tonAColher = tchAColher !== null ? round2(areaAColherHa * tchAColher) : 0;
      linhas.push({
        frente: ordem.frente,
        ordem: ordem.numero,
        fazendaCodigo,
        fazendaNome: dados.fazendaNome,
        areaTotalHa,
        tchEst,
        tonEst: tchEst !== null ? round2(areaTotalHa * tchEst) : 0,
        areaColhidaHa,
        producaoTotalT,
        tchRealParcial,
        areaAColherHa,
        tchAColher,
        tchAColherEstimado: tchAColher !== null && !(tchRealParcial > 0),
        tonAColher,
        tonProjetada: round2(producaoTotalT + tonAColher),
        tonProjetadaComEst: tchEst !== null ? round2(producaoTotalT + tonAColher) : 0,
      });
    }
  }
  return linhas.sort((a, b) => (a.frente === b.frente ? a.ordem.localeCompare(b.ordem, undefined, { numeric: true }) : a.frente.localeCompare(b.frente)));
}

export function calcOrdemMetrics(ordem, period, referencia) {
  const acumSafraT = calcAcumSafraT(ordem, referencia);
  const areaTotalHa = calcAreaTotalHa(ordem);
  const range = rangeForPeriod(period, referencia);
  const entradaPeriodoT =
    range === null
      ? acumSafraT
      : ordem.entradas.filter((e) => e.data >= range.inicio && e.data <= range.fim).reduce((s, e) => s + tonAteReferencia(e, referencia), 0);
  const tchGeralRealizado = areaTotalHa > 0 ? acumSafraT / areaTotalHa : 0;
  return {
    entradaPeriodoT: Math.round(entradaPeriodoT * 100) / 100,
    acumSafraT: Math.round(acumSafraT * 100) / 100,
    areaTotalHa: Math.round(areaTotalHa * 100) / 100,
    tchGeralRealizado: Math.round(tchGeralRealizado * 100) / 100,
    temMovimentoNoPeriodo: range === null ? acumSafraT > 0 : entradaPeriodoT > 0,
  };
}

function diasInclusivo(inicio, fim) {
  const a = Date.parse(inicio + "T00:00:00Z");
  const b = Date.parse(fim + "T00:00:00Z");
  return b < a ? 0 : Math.round((b - a) / 86400000) + 1;
}

/** Período de atividade da frente (Metas › Atividade das frentes); sem cadastro, sempre ativa. */
function atividadeDaFrente(metas, frente) {
  const m = metas.find((x) => x.frente === frente && (x.atvIni || x.atvFim));
  return { ini: m?.atvIni || "0000-01-01", fim: m?.atvFim || "9999-12-31" };
}

/** Meta (t/dia) em vigor num dia: a última cadastrada com vigência <= dia (zero fora da atividade da frente). */
export function metaDoDia(metas, frente, dia) {
  const atv = atividadeDaFrente(metas, frente);
  if (dia < atv.ini || dia > atv.fim) return 0;
  let atual;
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
export function metaNoIntervalo(metas, frente, range) {
  const lista = metas.filter((m) => m.frente === frente).sort((a, b) => a.vigencia.localeCompare(b.vigencia));
  // só os dias em que a frente está em atividade (início–fim) contam meta
  const atv = atividadeDaFrente(metas, frente);
  range = { inicio: range.inicio > atv.ini ? range.inicio : atv.ini, fim: range.fim < atv.fim ? range.fim : atv.fim };
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

function round2(n) {
  return Math.round(n * 100) / 100;
}

function somaNoIntervalo(entradas, range, referencia) {
  return entradas.filter((e) => range === null || (e.data >= range.inicio && e.data <= range.fim)).reduce((s, e) => s + tonAteReferencia(e, referencia), 0);
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
  ordensSelecionadas,
  ordensTodas,
  referencia,
  metas = [],
  safraInicio,
  primeiraEntradaPorFrente,
  /** horário de corte do dia atual (6, 12, 18 ou 24 = 00:00); a meta do dia atual é a fração hora/24 */
  horaCorte = 6,
) {
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
  function metasDaFrente(frente) {
    const primeira = primeiraEntradaPorFrente ? primeiraEntradaPorFrente[frente] : "0000-01-01";
    const desde = (r) =>
      primeira === undefined ? { inicio: "9999-12-31", fim: "0000-01-01" } : { inicio: r.inicio > primeira ? r.inicio : primeira, fim: r.fim };
    return {
      // a tela só compara com meta a partir do mês atual: safra e mês anterior ficam sem meta
      safra: 0,
      mesAnterior: 0,
      mesAtual: round2(metaNoIntervalo(metas, frente, desde(mesAtual))),
      quinzena: round2(metaNoIntervalo(metas, frente, desde(quinzena))),
      semana: round2(metaNoIntervalo(metas, frente, desde(semana))),
      diaAnterior: round2(metaNoIntervalo(metas, frente, desde(diaAnterior))),
      diaAtual: primeira !== undefined && referencia >= primeira ? round2((metaDoDia(metas, frente, referencia) * horaCorte) / 24) : 0,
    };
  }

  const map = new Map();
  function getOrInit(frente) {
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
        diasEfetivos: 0,
        mediaDiaEfetivoT: 0,
      };
      map.set(frente, atual);
    }
    return atual;
  }

  const diasPorFrente = new Map();
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
    atual.diaAtualT += ordem.entradas.filter((e) => e.data === referencia).reduce((s, e) => s + e.toneladasAte6h, 0);
    let dias = diasPorFrente.get(ordem.frente);
    if (!dias) diasPorFrente.set(ordem.frente, (dias = new Set()));
    for (const e of ordem.entradas) {
      if (e.data >= safra.inicio && e.data <= safra.fim && e.toneladas > 0) dias.add(e.data);
    }
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
      diasEfetivos: diasPorFrente.get(r.frente)?.size ?? 0,
      mediaDiaEfetivoT: (diasPorFrente.get(r.frente)?.size ?? 0) > 0 ? round2(r.safraT / diasPorFrente.get(r.frente).size) : 0,
    }))
    .sort((a, b) => a.frente.localeCompare(b.frente));
}

/**
 * Média de tonelada entregue por dia efetivo (só dias com entrada de cana) em cada recorte do resumo,
 * somando todas as frentes. Mesmos recortes de `resumoPorFrente`.
 */
export function mediaDiariaPorPeriodo(ordensTodas, referencia, safraInicio) {
  const ontem = addDays(referencia, -1);
  const faixas = {
    safra: { inicio: safraInicio ?? "0000-01-01", fim: ontem },
    mesAnterior: mesAnteriorRange(referencia),
    mesAtual: { inicio: startOfMonth(referencia), fim: ontem },
    quinzena: { inicio: quinzenaRange(referencia).inicio, fim: ontem },
    semana: { inicio: startOfWeekMonday(referencia), fim: ontem },
    diaAnterior: { inicio: ontem, fim: ontem },
    diaAtual: { inicio: referencia, fim: referencia },
  };
  const porDia = new Map();
  for (const o of ordensTodas) {
    for (const e of o.entradas) {
      const t = e.data === referencia ? e.toneladasAte6h : e.data < referencia ? e.toneladas : 0;
      if (t > 0) porDia.set(e.data, (porDia.get(e.data) ?? 0) + t);
    }
  }
  const res = {};
  for (const [k, f] of Object.entries(faixas)) {
    let t = 0;
    let dias = 0;
    for (const [data, v] of porDia) {
      if (data >= f.inicio && data <= f.fim) {
        t += v;
        dias++;
      }
    }
    res[k] = { t: round2(t), dias, media: dias > 0 ? round2(t / dias) : 0 };
  }
  return res;
}

/**
 * Uma linha por dia do mês (todos os dias, até os que ainda não chegaram) e
 * uma coluna por frente, com a tonelada do dia e a meta do dia da frente. Os
 * dias passados valem o dia inteiro; o dia da referência vale até o horário
 * de corte (`toneladasAte6h` já vem assim da tela) com a meta proporcional
 * hora/24; os seguintes ficam em branco.
 */
export function resumoDiarioMes(ordens, mes, referencia, frentes, metas, primeiraEntradaPorFrente, horaCorte) {
  const porDia = new Map();
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
  const totais = Object.fromEntries(frentes.map((f) => [f, { t: 0, meta: 0 }]));
  const dias = [];
  for (let d = inicio; d <= fim; d = addDays(d, 1)) {
    const futuro = d > referencia;
    const celulas = {};
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

/**
 * Produção da área colhida apontada: só a cana dos talhões que já têm área colhida lançada, e essa área.
 * O TCH realizado da área colhida é ton ÷ área (talhão colhido sem apontamento de área não entra).
 */
export function calcProducaoAreaColhida(ordem, referencia) {
  let t = 0;
  let areaHa = 0;
  for (const tl of ordem.talhoes) {
    if (!(tl.areaColhidaHa > 0)) continue;
    areaHa += tl.areaColhidaHa;
    t += calcTalhaoEntradaPeriodo(ordem, tl, "safra", referencia);
  }
  return { t: Math.round(t * 100) / 100, areaHa: Math.round(areaHa * 100) / 100, tch: areaHa > 0 ? Math.round((t / areaHa) * 100) / 100 : 0 };
}
