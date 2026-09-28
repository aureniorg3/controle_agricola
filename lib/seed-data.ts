import { OrdemCorte, Talhao } from "./types";

/**
 * Dados de carga inicial, extraídos do relatório "Relatório de entrada de cana
 * por Ordem de Colheita" (CRV Industrial, Unidade Capinópolis-MG, safra 2026/27,
 * fechamento de 27/09/2026 considerando entradas até as 06:00h).
 *
 * Cada card do relatório impresso vira uma Ordem de Corte aqui. O lançamento do
 * dia 26/09/2026 é semeado a partir da coluna "Ontem(t)" de cada talhão, que é
 * a tonelagem que efetivamente entrou naquele dia — isso alimenta os filtros de
 * Dia / Semana / Mês. A coluna "Acum(t)" alimenta a visão de Safra (acumulado).
 *
 * É uma carga inicial ilustrativa para o sistema nascer com dados reais da
 * operação: a partir daqui, novas ordens e novos lançamentos diários são feitos
 * pela própria tela e passam a ser a fonte de verdade.
 */

const SAFRA = "2026/27";
const DATA_LANCAMENTO_SEED = "2026-09-26"; // "Entrada de Ontem" do relatório
const DATA_ABERTURA_PADRAO = "2026-08-15";

function talhoes(rows: [string, number, number, number][]): Talhao[] {
  return rows.map(([talhao, areaHa, ultimaEntradaT, acumSafraT]) => ({
    talhao,
    areaHa,
    ultimaEntradaT,
    acumSafraT,
  }));
}

function lancamentoSeed(id: string, toneladas: number) {
  if (toneladas <= 0) return [];
  return [
    {
      id: `lanc-${id}-seed`,
      data: DATA_LANCAMENTO_SEED,
      toneladas,
      criadoEm: new Date(`${DATA_LANCAMENTO_SEED}T06:00:00-03:00`).toISOString(),
    },
  ];
}

interface SeedInput {
  id: string;
  numero: string;
  frente: string;
  regiao: string;
  fazendaCodigo: string;
  fazendaNome: string;
  status: "Aberta" | "Encerrada";
  talhoes: [string, number, number, number][];
  areaLiberadaHa: number;
  areaColhidaHa: number;
  tchRealizadoSafraAnterior: number;
  tchEstimado: number;
}

const SEED_INPUT: SeedInput[] = [
  {
    id: "2461-9321",
    numero: "2461",
    frente: "FRENTE-1",
    regiao: "Reg - 1",
    fazendaCodigo: "9321",
    fazendaNome: "SANTARITA DE CASSIA",
    status: "Aberta",
    talhoes: [
      ["1", 37.44, 675.84, 2504.72],
      ["2", 20.69, 373.51, 1384.24],
      ["3", 35.64, 643.41, 2384.52],
      ["4", 22.98, 414.83, 1537.46],
      ["5", 23.34, 421.39, 1561.62],
    ],
    areaLiberadaHa: 140.09,
    areaColhidaHa: 64.09,
    tchRealizadoSafraAnterior: 101.23,
    tchEstimado: 95.0,
  },
  {
    id: "2463-9425",
    numero: "2463",
    frente: "FRENTE-2",
    regiao: "Reg - 1",
    fazendaCodigo: "9425",
    fazendaNome: "FUNDAO",
    status: "Aberta",
    talhoes: [
      ["1", 14.56, 252.66, 1033.98],
      ["2", 12.03, 208.73, 854.25],
      ["3", 12.76, 221.44, 906.14],
      ["4", 52.76, 915.48, 3746.54],
      ["5", 25.75, 446.81, 1828.55],
    ],
    areaLiberadaHa: 117.86,
    areaColhidaHa: 56.37,
    tchRealizadoSafraAnterior: 69.63,
    tchEstimado: 60.0,
  },
  {
    id: "2458-9414",
    numero: "2458",
    frente: "FRENTE-2",
    regiao: "Reg - 1",
    fazendaCodigo: "9414",
    fazendaNome: "NOSSA SENHORA DO CARMO",
    status: "Aberta",
    talhoes: [
      ["2", 5.88, 10.77, 318.92],
      ["3", 22.46, 41.15, 1218.14],
      ["6", 22.68, 41.55, 1230.08],
      ["7", 22.69, 41.55, 1230.54],
    ],
    areaLiberadaHa: 73.71,
    areaColhidaHa: 61.71,
    tchRealizadoSafraAnterior: 72.36,
    tchEstimado: 71.0,
  },
  {
    id: "2467-9414",
    numero: "2467",
    frente: "FRENTE-2",
    regiao: "Reg - 1",
    fazendaCodigo: "9414",
    fazendaNome: "NOSSA SENHORA DO CARMO",
    status: "Aberta",
    talhoes: [
      ["5", 0, 0, 0],
      ["8", 0, 0, 0],
      ["9", 0, 0, 0],
    ],
    areaLiberadaHa: 0,
    areaColhidaHa: 0,
    tchRealizadoSafraAnterior: 0,
    tchEstimado: 0,
  },
  {
    id: "2462-9476",
    numero: "2462",
    frente: "FRENTE-3",
    regiao: "Reg - 2",
    fazendaCodigo: "9476",
    fazendaNome: "JUPATIS",
    status: "Aberta",
    talhoes: [
      ["4", 4.03, 35.96, 169.02],
      ["9", 7.72, 81.0, 380.91],
      ["10", 21.31, 237.56, 1117.14],
      ["11", 28.06, 312.82, 1470.99],
      ["12", 12.89, 114.96, 540.61],
      ["13", 6.6, 58.85, 276.77],
      ["14", 10.41, 116.06, 545.79],
      ["15", 34.72, 387.08, 1820.14],
      ["16", 3.41, 30.42, 143.0],
      ["17", 3.07, 27.37, 128.75],
    ],
    areaLiberadaHa: 132.22,
    areaColhidaHa: 56.0,
    tchRealizadoSafraAnterior: 64.94,
    tchEstimado: 67.0,
  },
  {
    id: "2464-9365",
    numero: "2464",
    frente: "FRENTE-4",
    regiao: "Reg - 2",
    fazendaCodigo: "9365",
    fazendaNome: "DIVISA",
    status: "Aberta",
    talhoes: [
      ["10", 1.64, 3.31, 170.3],
      ["11", 15.93, 32.16, 1654.27],
      ["12", 19.51, 39.39, 2026.07],
    ],
    areaLiberadaHa: 37.08,
    areaColhidaHa: 25.98,
    tchRealizadoSafraAnterior: 64.8,
    tchEstimado: 70.0,
  },
  {
    id: "2454-9386",
    numero: "2454",
    frente: "FRENTE-4",
    regiao: "Reg - 2",
    fazendaCodigo: "9386",
    fazendaNome: "NOSSA SENHORA DE LOURDES",
    status: "Encerrada",
    talhoes: [
      ["6", 18.38, 0, 1216.68],
      ["7", 13.91, 0, 920.77],
      ["8", 14.96, 0, 990.31],
      ["9", 19.3, 0, 1277.56],
      ["10", 7.34, 0, 485.89],
      ["11", 10.49, 0, 694.39],
    ],
    areaLiberadaHa: 84.38,
    areaColhidaHa: 84.38,
    tchRealizadoSafraAnterior: 63.22,
    tchEstimado: 60.0,
  },
  {
    id: "2468-9399",
    numero: "2468",
    frente: "FRENTE-4",
    regiao: "Reg - 2",
    fazendaCodigo: "9399",
    fazendaNome: "CORREGO DA DIVISA",
    status: "Aberta",
    talhoes: [
      ["1", 10.25, 326.89, 359.08],
      ["2", 2.81, 89.62, 98.44],
      ["3", 9.28, 295.98, 325.13],
      ["4", 2.06, 65.71, 72.18],
      ["5", 14.35, 457.68, 502.75],
      ["6", 7.39, 235.7, 258.92],
    ],
    areaLiberadaHa: 46.14,
    areaColhidaHa: 32.22,
    tchRealizadoSafraAnterior: 64.79,
    tchEstimado: 70.0,
  },
  {
    id: "2466-9442",
    numero: "2466",
    frente: "FRENTE-5",
    regiao: "Reg - 3",
    fazendaCodigo: "9442",
    fazendaNome: "PANTANO OU MARIANO",
    status: "Aberta",
    talhoes: [
      ["29", 21.01, 469.79, 1234.25],
      ["30", 16.92, 378.32, 994.03],
      ["31", 19.19, 429.07, 1127.38],
      ["32", 10.15, 226.96, 596.31],
      ["33", 3.23, 72.22, 189.75],
    ],
    areaLiberadaHa: 70.5,
    areaColhidaHa: 21.0,
    tchRealizadoSafraAnterior: 51.33,
    tchEstimado: 55.0,
  },
  {
    id: "2456-9442",
    numero: "2456",
    frente: "FRENTE-5",
    regiao: "Reg - 3",
    fazendaCodigo: "9442",
    fazendaNome: "PANTANO OU MARIANO",
    status: "Encerrada",
    talhoes: [
      ["18", 4.59, 0, 211.64],
      ["19", 4.29, 0, 197.81],
      ["20", 6.22, 0, 284.09],
      ["21", 7.16, 0, 453.88],
      ["22", 7.57, 0, 523.49],
      ["23", 20.94, 0, 1447.91],
      ["24", 9.34, 0, 645.87],
      ["25", 6.89, 0, 476.45],
      ["26", 11.48, 0, 793.87],
      ["34", 2.71, 0, 187.39],
      ["35", 4.42, 0, 305.67],
      ["36", 3.72, 0, 257.21],
    ],
    areaLiberadaHa: 89.33,
    areaColhidaHa: 89.33,
    tchRealizadoSafraAnterior: 43.11,
    tchEstimado: 56.0,
  },
  {
    id: "2457-9840",
    numero: "2457",
    frente: "FRENTE-20-GO",
    regiao: "Reg - L",
    fazendaCodigo: "9840",
    fazendaNome: "QUEIXADA E SERTAOZINHO",
    status: "Encerrada",
    talhoes: [
      ["8", 10.48, 0, 602.67],
      ["9", 3.84, 0, 220.83],
      ["10", 0.52, 0, 29.89],
      ["11", 4.99, 0, 286.93],
      ["38", 21.6, 0, 1242.04],
      ["39", 15.13, 0, 870.05],
      ["40", 13.22, 0, 760.25],
      ["41", 14.21, 0, 817.1],
      ["42", 6.69, 0, 384.76],
    ],
    areaLiberadaHa: 90.68,
    areaColhidaHa: 19.83,
    tchRealizadoSafraAnterior: 0,
    tchEstimado: 65.0,
  },
  {
    id: "2457-9844",
    numero: "2457",
    frente: "FRENTE-20-GO",
    regiao: "Reg - L",
    fazendaCodigo: "9844",
    fazendaNome: "NOSSA SENHORA DA CONCEICAO",
    status: "Aberta",
    talhoes: [
      ["1", 0.59, 15.7, 25.92],
      ["2", 0.3, 7.99, 13.19],
      ["3", 3.3, 87.72, 144.96],
      ["4", 11.22, 298.3, 492.85],
      ["5", 1.49, 39.62, 65.46],
      ["6", 12.69, 337.36, 557.42],
      ["8", 5.46, 145.18, 239.84],
      ["9", 1.05, 27.93, 46.14],
    ],
    areaLiberadaHa: 52.42,
    areaColhidaHa: 70.85,
    tchRealizadoSafraAnterior: 0,
    tchEstimado: 65.0,
  },
  {
    id: "2443-9840",
    numero: "2443",
    frente: "FRENTE-20-GO",
    regiao: "Reg - L",
    fazendaCodigo: "9840",
    fazendaNome: "QUEIXADA E SERTAOZINHO",
    status: "Encerrada",
    talhoes: [
      ["12", 20.72, 0, 1515.26],
      ["13", 16.16, 0, 1181.79],
      ["34", 38.59, 0, 2822.12],
      ["35", 33.02, 0, 2414.89],
      ["36", 11.89, 0, 869.53],
      ["37", 16.82, 0, 1230.09],
      ["43", 0.43, 0, 31.46],
    ],
    areaLiberadaHa: 137.63,
    areaColhidaHa: 36.88,
    tchRealizadoSafraAnterior: 0,
    tchEstimado: 65.0,
  },
  {
    id: "2465-9457",
    numero: "2465",
    frente: "FRENTE-11-TERCEIRO",
    regiao: "Reg - 3",
    fazendaCodigo: "9457",
    fazendaNome: "DAS PONTINHAS E PANTANO",
    status: "Aberta",
    talhoes: [
      ["1", 2.19, 19.05, 56.08],
      ["2", 6.86, 59.67, 175.72],
    ],
    areaLiberadaHa: 43.68,
    areaColhidaHa: 1.49,
    tchRealizadoSafraAnterior: 48.5,
    tchEstimado: 53.0,
  },
  {
    id: "2465-9486",
    numero: "2465",
    frente: "FRENTE-11-TERCEIRO",
    regiao: "Reg - 3",
    fazendaCodigo: "9486",
    fazendaNome: "DAS PONTINHAS",
    status: "Aberta",
    talhoes: [
      ["1", 4.75, 37.57, 110.64],
      ["2", 12.63, 99.87, 294.13],
    ],
    areaLiberadaHa: 0,
    areaColhidaHa: 2.86,
    tchRealizadoSafraAnterior: 48.5,
    tchEstimado: 53.0,
  },
  {
    id: "2465-9490",
    numero: "2465",
    frente: "FRENTE-11-TERCEIRO",
    regiao: "Reg - 3",
    fazendaCodigo: "9490",
    fazendaNome: "SAO PEDRO",
    status: "Aberta",
    talhoes: [
      ["1", 14.31, 124.41, 366.56],
      ["2", 1.78, 15.48, 45.59],
      ["3", 1.16, 10.09, 29.7],
    ],
    areaLiberadaHa: 0,
    areaColhidaHa: 2.84,
    tchRealizadoSafraAnterior: 48.5,
    tchEstimado: 53.0,
  },
  {
    id: "2444-9474",
    numero: "2444",
    frente: "FRENTE-11-TERCEIRO",
    regiao: "Reg - 3",
    fazendaCodigo: "9474",
    fazendaNome: "PONTINHAS",
    status: "Encerrada",
    talhoes: [
      ["1", 25.17, 0, 1614.96],
      ["2", 31.43, 0, 2016.61],
      ["3", 23.59, 0, 1513.63],
      ["4", 27.51, 0, 1765.14],
    ],
    areaLiberadaHa: 107.7,
    areaColhidaHa: 107.7,
    tchRealizadoSafraAnterior: 48.98,
    tchEstimado: 55.0,
  },
];

export function buildSeedOrdens(): OrdemCorte[] {
  const nowIso = new Date().toISOString();
  return SEED_INPUT.map((input) => {
    const talhoesList = talhoes(input.talhoes);
    const somaUltimaEntrada = talhoesList.reduce((s, t) => s + t.ultimaEntradaT, 0);
    return {
      id: input.id,
      numero: input.numero,
      frente: input.frente,
      regiao: input.regiao,
      fazendaCodigo: input.fazendaCodigo,
      fazendaNome: input.fazendaNome,
      status: input.status,
      dataAbertura: DATA_ABERTURA_PADRAO,
      dataEncerramento: input.status === "Encerrada" ? "2026-09-27" : undefined,
      talhoes: talhoesList,
      areaLiberadaHa: input.areaLiberadaHa,
      areaColhidaHa: input.areaColhidaHa,
      tchRealizadoSafraAnterior: input.tchRealizadoSafraAnterior,
      tchEstimado: input.tchEstimado,
      safraLabel: SAFRA,
      lancamentos: lancamentoSeed(input.id, Math.round(somaUltimaEntrada * 100) / 100),
      criadoEm: nowIso,
      atualizadoEm: nowIso,
    };
  });
}
