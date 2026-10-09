// Tipos e helpers do clima (Zeus) compartilhados entre a rota, a tela e o PDF.
import { addDays, rangeForPeriod } from "./period";
import { fmtDateBR } from "./format";

/** "9001-1" -> "9001": a Zeus só conhece o código base da fazenda. */
export function codigoFazendaBase(codigo) {
  return codigo.trim().split("-")[0].trim();
}

/**
 * Intervalo de clima que acompanha o filtro de período da tela. Semana e mês
 * seguem os mesmos limites das toneladas (até a data de referência); safra, que
 * não tem recorte, mostra os últimos 30 dias.
 */
export function janelaClima(period, referencia) {
  if (period === "dia") return { inicio: referencia, fim: referencia };
  if (period === "safra") return { inicio: addDays(referencia, -29), fim: referencia };
  const r = rangeForPeriod(period, referencia);
  return { inicio: r.inicio, fim: r.fim < referencia ? r.fim : referencia };
}

/** Legenda do rodapé de clima. */
export function rotuloClima(resp, referencia, ultimaLeitura) {
  if (resp.periodo) {
    const dias = Math.round((Date.parse(resp.fim) - Date.parse(resp.inicio)) / 86400000) + 1;
    return `${fmtDateBR(resp.inicio)} a ${fmtDateBR(resp.fim)} · ${dias} dias`;
  }
  return resp.hoje ? `hoje${ultimaLeitura ? ` · leitura até ${ultimaLeitura.slice(11, 16)}` : ""}` : `histórico · ${fmtDateBR(referencia)}`;
}

/**
 * Agrupa as fazendas da ordem pela estação da Zeus: fazendas da mesma estação mostram o clima uma vez só; estações
 * diferentes (ou fazenda sem estação) ficam em blocos separados.
 */
export function agruparClimaPorEstacao(fazendas, resp) {
  const grupos = new Map();
  for (const f of fazendas) {
    const c = resp.fazendas[codigoFazendaBase(f.codigo)] ?? null;
    const chave = c ? `pic:${c.pic}` : `sem:${f.codigo}`;
    if (!grupos.has(chave)) grupos.set(chave, { fazendas: [], c });
    grupos.get(chave).fazendas.push(f);
  }
  return [...grupos.values()];
}

/** Itens do clima na ordem da tela e do PDF: umidade, vento, temperatura, dia anterior e chuva do dia (ou do período). */
export function itensClima(c, periodo, fmt) {
  const d = c.dia;
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
