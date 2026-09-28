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
  | "safraLabel"
  | "entCanaOntem"
  | "entCanaHoje";

// Apelidos tolerantes (já normalizados internamente por `normalizar`).
const ALIASES: Record<Campo, string[]> = {
  ordem: ["ordem", "ordemdecorte", "ordemcorte", "os", "numeroordem", "nordem", "numero", "num", "ordqc"],
  frente: ["frente", "frentedecorte", "frentecorte", "frentedecolheita"],
  regiao: ["regiao", "reg", "regional"],
  fazendaCodigo: [
    "codigo",
    "codfazenda",
    "codigofazenda",
    "fazendacodigo",
    "codfaz",
    "codigoprop",
    "codpropriedade",
  ],
  fazendaNome: ["nomefazenda", "fazendanome", "propriedade", "nomepropriedade", "fundoagricola"],
  talhao: ["talhao", "talhoes", "quadra", "parcela", "piquete"],
  areaHa: ["area", "areaha", "ha", "areahectares", "areatotal", "areatotalha", "areahaliberada"],
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
  // Formato "retrato do dia" (ex.: relatório Tb_Ord_Colheita_XX do CHBWEB):
  // em vez de uma coluna Data + uma coluna Toneladas, traz duas colunas fixas
  // com a entrada de ontem e a de hoje — ver `modoSnapshot` mais abaixo.
  entCanaOntem: ["entcanaontem"],
  entCanaHoje: ["entcanahoje"],
};

// A coluna "Fazenda" pura (sem "Código"/"Nome" no título) é ambígua entre
// planilhas: no modelo oferecido pelo sistema ela é o NOME da fazenda; no
// relatório do CHBWEB (Tb_Ord_Colheita_XX) ela é o CÓDIGO, e o nome mora
// numa coluna à parte ("Fundo Agrícola"). Por isso ela não entra em
// `ALIASES` como alias comum de nenhum dos dois campos — é resolvida à
// parte em `localizarCabecalho`, depois que os aliases específicos (mais
// fortes) de cada campo já tiveram a chance de reconhecer sua própria
// coluna: se "Fundo Agrícola" (ou similar) já preencheu fazendaNome, a
// coluna "Fazenda" sobra para fazendaCodigo; senão, ela preenche
// fazendaNome (comportamento original, documentado no modelo).
const ALIAS_FAZENDA_AMBIGUA = "fazenda";

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
    let colunaFazendaAmbigua: number | undefined;

    for (let col = 0; col < linha.length; col++) {
      const bruto = linha[col];
      if (bruto === undefined || bruto === null || bruto === "") continue;
      const norm = normalizar(String(bruto));
      if (!norm) continue;
      if (norm === ALIAS_FAZENDA_AMBIGUA) {
        if (colunaFazendaAmbigua === undefined) colunaFazendaAmbigua = col;
        continue;
      }
      for (const campo of Object.keys(ALIASES) as Campo[]) {
        if (mapa[campo] !== undefined) continue; // já achou esse campo nessa linha
        if (ALIASES[campo].includes(norm)) {
          mapa[campo] = col;
        }
      }
    }

    // Resolve a coluna "Fazenda" ambígua só depois que "Fundo Agrícola" (ou
    // equivalente) já teve a chance de preencher fazendaNome — ver o
    // comentário de `ALIAS_FAZENDA_AMBIGUA` acima.
    if (colunaFazendaAmbigua !== undefined) {
      if (mapa.fazendaNome === undefined) {
        mapa.fazendaNome = colunaFazendaAmbigua;
      } else if (mapa.fazendaCodigo === undefined) {
        mapa.fazendaCodigo = colunaFazendaAmbigua;
      }
    }

    // Uma linha de cabeçalho válida precisa reconhecer pelo menos os campos
    // que identificam "o quê" (ordem/talhão) e "quando" — seja uma coluna de
    // data (formato transacional) ou as colunas fixas de ontem/hoje (formato
    // retrato-do-dia, ver `modoSnapshot` mais abaixo).
    const acertos = Object.keys(mapa).length;
    const temQuando = mapa.data !== undefined || mapa.entCanaOntem !== undefined || mapa.entCanaHoje !== undefined;
    const temEssenciais = mapa.ordem !== undefined && (mapa.talhao !== undefined || temQuando);
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

function contarLinhasComAtividade(
  matriz: unknown[][],
  cabecalho: { indice: number; mapa: Partial<Record<Campo, number>> }
): number {
  const col = cabecalho.mapa.entCanaHoje ?? cabecalho.mapa.toneladasDia ?? cabecalho.mapa.entCanaOntem;
  if (col === undefined) return 0;
  let count = 0;
  for (let i = cabecalho.indice + 1; i < matriz.length; i++) {
    const v = paraNumero(matriz[i]?.[col]);
    if (v !== null && v > 0) count++;
  }
  return count;
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

  // Planilhas reais (como o relatório oficial da safra) costumam ter dezenas
  // de abas auxiliares — muitas vezes uma por ano/safra, todas com o MESMO
  // layout de colunas (arquivos históricos mantidos lado a lado com o atual).
  // Por isso a escolha não pode parar em "quantos campos a aba reconhece":
  // empata entre "Tb_Ord_Corte_24", "..._25" e "..._26", por exemplo. O
  // desempate é a quantidade de linhas com produção de fato em "hoje" (ou,
  // no formato transacional, em toneladas do dia) — abas de safras
  // encerradas ficam zeradas nessas colunas, a safra corrente não.
  let nomeAba: string | null = null;
  let matriz: unknown[][] = [];
  let cabecalho: ReturnType<typeof localizarCabecalho> = null;
  let melhorPontuacao = -1;

  for (const nome of wb.SheetNames) {
    const aba = wb.Sheets[nome];
    if (!aba) continue;
    const matrizAba: unknown[][] = XLSX.utils.sheet_to_json(aba, { header: 1, raw: true, defval: "" });
    const cabecalhoAba = localizarCabecalho(matrizAba);
    if (!cabecalhoAba) continue;
    const pontuacao =
      Object.keys(cabecalhoAba.mapa).length * 100000 + contarLinhasComAtividade(matrizAba, cabecalhoAba);
    if (pontuacao > melhorPontuacao) {
      melhorPontuacao = pontuacao;
      nomeAba = nome;
      matriz = matrizAba;
      cabecalho = cabecalhoAba;
    }
  }

  if (!nomeAba) {
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
    avisos.push(`O arquivo tem ${wb.SheetNames.length} abas; a aba usada foi "${nomeAba}".`);
  }

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

  // Duas formas de dizer "quando" e "quanto": um par Data + Toneladas
  // (planilha transacional, um lançamento por linha) ou o par fixo
  // Ontem/Hoje (retrato do dia, ver `modoSnapshot` abaixo). Precisa de pelo
  // menos uma das duas, além de Ordem e Talhão sempre.
  const modoSnapshot = mapa.data === undefined && (mapa.entCanaOntem !== undefined || mapa.entCanaHoje !== undefined);
  const obrigatoriosFaltando: string[] = [];
  if (mapa.ordem === undefined) obrigatoriosFaltando.push("ordem");
  if (mapa.talhao === undefined) obrigatoriosFaltando.push("talhao");
  if (!modoSnapshot) {
    if (mapa.data === undefined) obrigatoriosFaltando.push("data");
    if (mapa.toneladasDia === undefined) obrigatoriosFaltando.push("toneladasDia (ou Ent_Cana Ontem/Hoje)");
  }
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

  // Modo retrato-do-dia: a planilha não traz uma data por linha, só o
  // estado de "ontem" e "hoje" — usa a data em que o arquivo está sendo
  // importado como "hoje" (é assim que a planilha é usada na prática: quem
  // atualiza a base sobe o arquivo no mesmo dia). Reimportar no dia
  // seguinte gera o apontamento do novo dia sem mexer nos anteriores,
  // porque cada apontamento é identificado por ordem+data (ver `db.ts`).
  const hojeDate = new Date();
  const ontemDate = new Date(hojeDate);
  ontemDate.setDate(ontemDate.getDate() - 1);
  const dataHojeIso = isoDeDataLocal(hojeDate);
  const dataOntemIso = isoDeDataLocal(ontemDate);
  if (modoSnapshot) {
    avisos.push(
      `Planilha em formato "retrato do dia" (colunas fixas de ontem/hoje, sem uma coluna de data por linha): ` +
        `a entrada de "hoje" foi gravada em ${dataHojeIso} e a de "ontem" em ${dataOntemIso}, as datas em que este ` +
        `arquivo está sendo importado — confira se é isso mesmo antes de repetir a importação em outro dia.`
    );
  }

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

    const base = {
      linha: numeroLinha,
      ordem,
      frente: frente || "FRENTE-IMPORT",
      regiao: regiao || "-",
      fazendaCodigo: fazendaCodigo || "-",
      fazendaNome: fazendaNome || "Fazenda não informada",
      talhao,
      areaHa,
      acumSafraT: acumRaw !== null ? Math.round(acumRaw * 100) / 100 : undefined,
      tchEstimado: tchRaw !== null ? Math.round(tchRaw * 100) / 100 : undefined,
      safraLabel,
    };

    if (modoSnapshot) {
      // Cada linha pode virar até dois apontamentos (ontem e hoje). Um
      // talhão sem corte nesses dois dias (ambos zero/vazios) não gera
      // erro nem aviso — é o normal da maioria das linhas num arquivo com
      // milhares de talhões, só os que colheram entram na lista.
      const ontemT = paraNumero(get("entCanaOntem"));
      const hojeT = paraNumero(get("entCanaHoje"));
      if (ontemT !== null && ontemT > 0) {
        linhas.push({ ...base, data: dataOntemIso, toneladasDia: Math.round(ontemT * 100) / 100 });
      }
      if (hojeT !== null && hojeT > 0) {
        linhas.push({ ...base, data: dataHojeIso, toneladasDia: Math.round(hojeT * 100) / 100 });
      }
      continue;
    }

    const dataIso = paraData(get("data"));
    const toneladas = paraNumero(get("toneladasDia"));

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

    linhas.push({ ...base, data: dataIso, toneladasDia: Math.round(toneladas * 100) / 100 });
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
