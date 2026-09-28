import * as XLSX from "xlsx";

/**
 * Importação de planilha (Excel/CSV) para Ordens de Corte.
 *
 * Este módulo é deliberadamente TOLERANTE: a planilha de origem foi criada
 * para leitura humana (títulos, colunas com nomes variados, linhas de
 * cabeçalho fora do padrão), não para importação automática. Por isso:
 *  - o cabeçalho é localizado por busca nas primeiras linhas, não fixado na
 *    linha 1;
 *  - nomes de coluna são reconhecidos por uma lista de apelidos (ALIASES),
 *    tolerando acentos, maiúsculas/minúsculas e pequenas variações;
 *  - linhas que não puderem ser interpretadas viram um AVISO ou ERRO
 *    reportado ao usuário — nunca são silenciosamente ignoradas nem viram
 *    dado inventado.
 *
 * A planilha é tratada como uma "base de ideia": o resultado do parse é
 * sempre mostrado ao usuário (o que foi entendido, o que foi ignorado, o
 * que ficou ambíguo) antes/depois de gravar no sistema, em vez de assumir
 * que o arquivo é a verdade absoluta sobre como os dados devem ser
 * apresentados.
 */

export interface LinhaImportada {
  linha: number; // número da linha na planilha original (1-based, para mensagens ao usuário)
  ordem: string;
  frente: string;
  regiao: string;
  fazendaCodigo: string;
  fazendaNome: string;
  talhao: string;
  areaHa: number;
  data: string; // YYYY-MM-DD
  toneladasDia: number;
  acumSafraT?: number;
  tchEstimado?: number;
  safraLabel?: string;
}

export interface ResultadoParse {
  linhas: LinhaImportada[];
  avisos: string[];
  erros: string[];
  colunasEncontradas: Record<string, string>;
  camposNaoEncontrados: string[];
  totalLinhasPlanilha: number;
  linhaCabecalho: number | null;
}

type Campo =
  | "ordem"
  | "frente"
  | "regiao"
  | "fazendaCodigo"
  | "fazendaNome"
  | "talhao"
  | "areaHa"
  | "data"
  | "toneladasDia"
  | "acumSafraT"
  | "tchEstimado"
  | "safraLabel";

const CAMPOS_OBRIGATORIOS: Campo[] = ["ordem", "talhao", "data", "toneladasDia"];

// Apelidos tolerantes (já normalizados internamente por `normalizar`).
const ALIASES: Record<Campo, string[]> = {
  ordem: ["ordem", "ordemdecorte", "ordemcorte", "os", "numeroordem", "nordem", "numero", "num"],
  frente: ["frente", "frentedecorte", "frentecorte", "frentedecolheita"],
  regiao: ["regiao", "reg", "regional"],
  fazendaCodigo: ["codigo", "codfazenda", "codigofazenda", "fazendacodigo", "codfaz", "codigoprop", "codpropriedade"],
  fazendaNome: ["fazenda", "nomefazenda", "fazendanome", "propriedade", "nomepropriedade"],
  talhao: ["talhao", "talhoes", "quadra", "parcela", "piquete"],
  areaHa: ["area", "areaha", "ha", "areahectares", "areatotal", "areatotalha"],
  data: ["data", "datalancamento", "dataapontamento", "dia", "dataentrada", "dataregistro"],
  toneladasDia: [
    "toneladas",
    "toneladasdia",
    "ontemt",
    "ontem",
    "producaodia",
    "qtdedia",
    "tondiario",
    "toneladasdiarias",
    "diario",
    "entradadia",
    "toneladasentregues",
    "t",
  ],
  acumSafraT: [
    "acumt",
    "acum",
    "acumulado",
    "acumsafra",
    "acumsafrat",
    "acumuladosafra",
    "totalacumulado",
    "acumuladot",
  ],
  tchEstimado: ["tch", "tchestimado", "tchesperado", "tchprevisto"],
  safraLabel: ["safra", "safralabel", "anosafra"],
};

function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // remove acentos
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ""); // mantém só letras/números
}

function localizarCabecalho(linhas: unknown[][]): { indice: number; mapa: Partial<Record<Campo, number>> } | null {
  const limite = Math.min(linhas.length, 15);
  let melhor: { indice: number; mapa: Partial<Record<Campo, number>> } | null = null;

  for (let i = 0; i < limite; i++) {
    const linha = linhas[i];
    if (!linha || linha.length === 0) continue;
    const mapa: Partial<Record<Campo, number>> = {};

    for (let col = 0; col < linha.length; col++) {
      const bruto = linha[col];
      if (bruto === undefined || bruto === null || bruto === "") continue;
      const norm = normalizar(String(bruto));
      if (!norm) continue;
      for (const campo of Object.keys(ALIASES) as Campo[]) {
        if (mapa[campo] !== undefined) continue; // já achou esse campo nessa linha
        if (ALIASES[campo].includes(norm)) {
          mapa[campo] = col;
        }
      }
    }

    // Uma linha de cabeçalho válida precisa reconhecer pelo menos os campos
    // que identificam "o quê" e "quando" (ordem/talhão + data ou toneladas).
    const acertos = Object.keys(mapa).length;
    const temEssenciais = mapa.ordem !== undefined && (mapa.talhao !== undefined || mapa.data !== undefined);
    if (temEssenciais && (!melhor || acertos > Object.keys(melhor.mapa).length)) {
      melhor = { indice: i, mapa };
    }
  }

  return melhor;
}

function paraTexto(v: unknown): string {
  if (v === undefined || v === null) return "";
  return String(v).trim();
}

function paraNumero(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  let s = String(v).trim();
  if (!s) return null;
  s = s.replace(/[^\d,.\-]/g, ""); // remove "t", "ha", espaços etc.
  if (!s) return null;
  // Formato BR: "1.234,56" -> "1234.56". Formato já-US: "1234.56" fica igual.
  if (s.includes(",") && s.includes(".")) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (s.includes(",")) {
    s = s.replace(",", ".");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function paraData(v: unknown): string | null {
  if (v === undefined || v === null || v === "") return null;

  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return isoDeDataLocal(v);
  }

  if (typeof v === "number") {
    // Número de série do Excel (dias desde 1899-12-30).
    const ms = Math.round((v - 25569) * 86400 * 1000);
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) return isoDeDataLocal(d, true);
    return null;
  }

  const s = String(v).trim();
  if (!s) return null;

  // YYYY-MM-DD
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`;

  // DD/MM/YYYY ou DD-MM-YYYY (também aceita ano com 2 dígitos)
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
  if (m) {
    let ano = m[3];
    if (ano.length === 2) ano = Number(ano) > 50 ? `19${ano}` : `20${ano}`;
    return `${ano}-${pad2(m[1])}-${pad2(m[2])}`;
  }

  return null;
}

function pad2(v: string | number): string {
  return String(v).padStart(2, "0");
}

function isoDeDataLocal(d: Date, utc = false): string {
  const ano = utc ? d.getUTCFullYear() : d.getFullYear();
  const mes = (utc ? d.getUTCMonth() : d.getMonth()) + 1;
  const dia = utc ? d.getUTCDate() : d.getDate();
  return `${ano}-${pad2(mes)}-${pad2(dia)}`;
}

export function parseWorkbook(buffer: ArrayBuffer, nomeArquivo: string): ResultadoParse {
  const avisos: string[] = [];
  const erros: string[] = [];

  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buffer, { type: "array", cellDates: true });
  } catch {
    return {
      linhas: [],
      avisos: [],
      erros: [`Não foi possível ler "${nomeArquivo}". Verifique se é um arquivo .xlsx, .xls ou .csv válido.`],
      colunasEncontradas: {},
      camposNaoEncontrados: [],
      totalLinhasPlanilha: 0,
      linhaCabecalho: null,
    };
  }

  const nomeAba = wb.SheetNames[0];
  const sheet = wb.Sheets[nomeAba];
  if (!sheet) {
    return {
      linhas: [],
      avisos: [],
      erros: [`O arquivo "${nomeArquivo}" não tem nenhuma planilha legível.`],
      colunasEncontradas: {},
      camposNaoEncontrados: [],
      totalLinhasPlanilha: 0,
      linhaCabecalho: null,
    };
  }
  if (wb.SheetNames.length > 1) {
    avisos.push(
      `O arquivo tem ${wb.SheetNames.length} abas; apenas a primeira ("${nomeAba}") foi lida.`
    );
  }

  const matriz: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: "" });

  const cabecalho = localizarCabecalho(matriz);
  if (!cabecalho) {
    return {
      linhas: [],
      avisos,
      erros: [
        "Não encontrei uma linha de cabeçalho reconhecível nas primeiras 15 linhas. " +
          "Confira se a planilha tem colunas como Ordem, Talhão, Data e Toneladas " +
          "(veja o modelo para o formato esperado).",
      ],
      colunasEncontradas: {},
      camposNaoEncontrados: Object.keys(ALIASES),
      totalLinhasPlanilha: matriz.length,
      linhaCabecalho: null,
    };
  }

  const { indice: idxCabecalho, mapa } = cabecalho;
  const colunasEncontradas: Record<string, string> = {};
  for (const campo of Object.keys(mapa) as Campo[]) {
    const col = mapa[campo]!;
    colunasEncontradas[campo] = paraTexto(matriz[idxCabecalho][col]) || `coluna ${col + 1}`;
  }
  const camposNaoEncontrados = (Object.keys(ALIASES) as Campo[]).filter((c) => mapa[c] === undefined);
  const obrigatoriosFaltando = CAMPOS_OBRIGATORIOS.filter((c) => mapa[c] === undefined);
  if (obrigatoriosFaltando.length > 0) {
    erros.push(
      `Colunas obrigatórias não encontradas: ${obrigatoriosFaltando.join(", ")}. ` +
        `Encontradas: ${Object.entries(colunasEncontradas)
          .map(([c, n]) => `${c}="${n}"`)
          .join(", ") || "nenhuma"}.`
    );
  }

  const linhas: LinhaImportada[] = [];
  let ultimaOrdemVista = "";
  let ultimaFrenteVista = "";
  let ultimaRegiaoVista = "";
  let ultimoCodigoVisto = "";
  let ultimaFazendaVista = "";

  for (let i = idxCabecalho + 1; i < matriz.length; i++) {
    const linhaCrua = matriz[i];
    const numeroLinha = i + 1;
    if (!linhaCrua || linhaCrua.every((v) => v === "" || v === undefined || v === null)) continue;

    const get = (campo: Campo) => (mapa[campo] !== undefined ? linhaCrua[mapa[campo]!] : undefined);

    // Muitas planilhas de relatório só repetem "Ordem/Frente/Fazenda" na
    // primeira linha de um grupo de talhões — herda da linha anterior
    // quando a célula está vazia, em vez de descartar a linha.
    let ordem = paraTexto(get("ordem")) || ultimaOrdemVista;
    let frente = paraTexto(get("frente")) || ultimaFrenteVista;
    let regiao = paraTexto(get("regiao")) || ultimaRegiaoVista;
    let fazendaCodigo = paraTexto(get("fazendaCodigo")) || ultimoCodigoVisto;
    let fazendaNome = paraTexto(get("fazendaNome")) || ultimaFazendaVista;
    const talhao = paraTexto(get("talhao"));
    const areaHa = paraNumero(get("areaHa")) ?? 0;
    const dataIso = paraData(get("data"));
    const toneladas = paraNumero(get("toneladasDia"));
    const acumRaw = paraNumero(get("acumSafraT"));
    const tchRaw = paraNumero(get("tchEstimado"));
    const safraLabel = paraTexto(get("safraLabel")) || undefined;

    if (ordem) ultimaOrdemVista = ordem;
    if (frente) ultimaFrenteVista = frente;
    if (regiao) ultimaRegiaoVista = regiao;
    if (fazendaCodigo) ultimoCodigoVisto = fazendaCodigo;
    if (fazendaNome) ultimaFazendaVista = fazendaNome;

    if (!ordem || !talhao) {
      erros.push(`Linha ${numeroLinha}: sem número de ordem e/ou talhão — linha ignorada.`);
      continue;
    }
    if (!dataIso) {
      erros.push(`Linha ${numeroLinha} (ordem ${ordem}, talhão ${talhao}): data ausente ou não reconhecida — linha ignorada.`);
      continue;
    }
    if (toneladas === null) {
      erros.push(
        `Linha ${numeroLinha} (ordem ${ordem}, talhão ${talhao}, ${dataIso}): toneladas do dia ausente ou não numérico — linha ignorada.`
      );
      continue;
    }
    if (toneladas < 0) {
      avisos.push(`Linha ${numeroLinha}: toneladas negativa (${toneladas}) — linha ignorada.`);
      continue;
    }

    linhas.push({
      linha: numeroLinha,
      ordem,
      frente: frente || "FRENTE-IMPORT",
      regiao: regiao || "-",
      fazendaCodigo: fazendaCodigo || "-",
      fazendaNome: fazendaNome || "Fazenda não informada",
      talhao,
      areaHa,
      data: dataIso,
      toneladasDia: Math.round(toneladas * 100) / 100,
      acumSafraT: acumRaw !== null ? Math.round(acumRaw * 100) / 100 : undefined,
      tchEstimado: tchRaw !== null ? Math.round(tchRaw * 100) / 100 : undefined,
      safraLabel,
    });
  }

  if (linhas.length === 0 && erros.length === 0) {
    erros.push("Nenhuma linha de dados foi encontrada abaixo do cabeçalho.");
  }

  return {
    linhas,
    avisos,
    erros,
    colunasEncontradas,
    camposNaoEncontrados,
    totalLinhasPlanilha: matriz.length,
    linhaCabecalho: idxCabecalho + 1,
  };
}
