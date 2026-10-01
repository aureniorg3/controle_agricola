import * as XLSX from "xlsx";
import ExcelJS from "exceljs";
import { Readable } from "stream";
import { EntradaDiaria, OrdemCorte, StatusOrdem, TalhaoOrdem } from "./types";

/**
 * Importação a partir de 2 relatórios do sistema de origem (CHBWEB),
 * gerados e anexados diariamente:
 *
 *  1. "Ordem de Colheita.xlsx"        — cadastro de cada ordem (status,
 *     frente, fazenda, talhões e suas áreas). Um bloco de linhas por ordem.
 *  2. "Relatório de Pesagem de Cana"  — uma linha por viagem de caminhão já
 *     com tudo junto: a coluna "Liberação" já é o número da ordem (O.Q.)
 *     diretamente, então não precisa mais de um terceiro arquivo
 *     (Conferência) só para descobrir a qual ordem cada viagem pertence —
 *     esse cruzamento Controle+Sequência existia porque o relatório antigo
 *     de pesagem não trazia a ordem junto; este traz.
 *
 * Os dois cobrem a safra inteira até a data de geração (não é um
 * incremento do dia) — por isso a importação sempre SUBSTITUI a base
 * (ver `substituirOrdens` em lib/db.ts), nunca mescla com o que já existe.
 */

export interface ResultadoImportacaoArquivos {
  ordens: OrdemCorte[];
  avisos: string[];
  erros: string[];
  totalOrdens: number;
  totalViagens: number;
  viagensSemOrdem: number;
}

// ---------------------------------------------------------------------------
// Helpers de leitura tolerante de célula
// ---------------------------------------------------------------------------

function numeroBR(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const limpo = v.trim().replace(/\./g, "").replace(",", ".");
    const n = Number(limpo);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function texto(v: unknown): string {
  if (v === undefined || v === null) return "";
  return String(v).trim();
}

function dataIso(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
  }
  return null;
}

/** Converte um serial de data do Excel (dias desde 1899-12-30) para ISO —
 * usado pelos parsers em streaming, que leem sem estilos e por isso não
 * recebem `Date` prontos como o `cellDates` do pacote xlsx. */
function dataIsoSerial(v: unknown): string | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  const d = new Date(Math.round((v - 25569) * 86400 * 1000));
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function lerLinhas(buffer: ArrayBuffer): unknown[][] {
  const wb = XLSX.read(buffer, { type: "array", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" }) as unknown[][];
}

/** Lê a primeira aba linha a linha, sem materializar a planilha inteira em
 * memória — os relatórios de Pesagem/Conferência têm ~176 mil linhas, e o
 * parser padrão do pacote xlsx passa de 700 MB de RAM nesses arquivos
 * (estoura o limite de 512 MB da instância gratuita do Render). */
async function paraCadaLinha(buffer: ArrayBuffer, onLinha: (linha: unknown[]) => void): Promise<void> {
  const stream = Readable.from(Buffer.from(buffer));
  const wb = new ExcelJS.stream.xlsx.WorkbookReader(stream, {
    entries: "emit",
    sharedStrings: "cache",
    styles: "ignore",
    worksheets: "emit",
  });
  for await (const worksheetReader of wb) {
    for await (const row of worksheetReader) {
      onLinha((row.values as unknown[]).slice(1));
    }
    break; // só a primeira aba
  }
}

// ---------------------------------------------------------------------------
// 1) Ordem de Colheita.xlsx — cadastro da ordem
// ---------------------------------------------------------------------------

export interface OrdemCadastro {
  numero: string;
  frente: string;
  fazendaCodigo: string;
  fazendaNome: string;
  proprietarioCodigo?: string;
  proprietarioNome?: string;
  status: StatusOrdem;
  tipoCana?: string;
  dataQueima?: string;
  observacao?: string;
  talhoes: TalhaoOrdem[];
}

export function parseOrdemColheita(buffer: ArrayBuffer): {
  ordens: OrdemCadastro[];
  avisos: string[];
  erros: string[];
} {
  const linhas = lerLinhas(buffer);
  const avisos: string[] = [];
  const erros: string[] = [];
  const ordens: OrdemCadastro[] = [];
  const numerosVistos = new Set<string>();

  type Bloco = { inicio: number; linhas: unknown[][] };
  const blocos: Bloco[] = [];
  let atual: Bloco | null = null;
  for (let i = 0; i < linhas.length; i++) {
    const r = linhas[i];
    if (r[0] === "Ordem de Colheita") {
      if (atual) blocos.push(atual);
      atual = { inicio: i, linhas: [r] };
    } else if (atual) {
      atual.linhas.push(r);
    }
  }
  if (atual) blocos.push(atual);

  if (blocos.length === 0) {
    erros.push('Não encontrei nenhum bloco "Ordem de Colheita" no arquivo. Confira se é o arquivo certo.');
    return { ordens: [], avisos, erros };
  }

  for (const bloco of blocos) {
    const linhaNum = bloco.linhas[0];
    const numero = texto(linhaNum[5]);
    if (!numero) {
      avisos.push(`Bloco na linha ${bloco.inicio + 1}: sem número de ordem (O.Q.) — bloco ignorado.`);
      continue;
    }
    if (numerosVistos.has(numero)) {
      avisos.push(`Ordem ${numero} aparece mais de uma vez no arquivo — mantida a última ocorrência.`);
    }
    numerosVistos.add(numero);

    const linhaStatus = bloco.linhas.find((l) => l[3] === "Status:");
    const linhaFrente = bloco.linhas.find((l) => l[0] === "Frente");
    const linhaTipoCana = bloco.linhas.find((l) => l[0] === "Tipo de Cana");
    const linhaObs = bloco.linhas.find((l) => l[0] === "Observação");
    const linhaPropriedade = bloco.linhas.find((l) => l[0] === "Propriedade");

    const statusTxt = linhaStatus ? texto(linhaStatus[4]) : "";
    const status: StatusOrdem = statusTxt === "Encerrada" ? "Encerrada" : "Aberta";
    if (statusTxt !== "Encerrada" && statusTxt !== "Aberta") {
      avisos.push(`Ordem ${numero}: status "${statusTxt || "(vazio)"}" não reconhecido — tratada como Aberta.`);
    }

    const frente = linhaFrente ? texto(linhaFrente[2]) : "";
    if (!frente) avisos.push(`Ordem ${numero}: sem frente identificada.`);

    let fazendaCodigo = "";
    let fazendaNome = "";
    if (linhaPropriedade) {
      fazendaCodigo = texto(linhaPropriedade[1]);
      const label = texto(linhaPropriedade[3]);
      const partes = label.split(" - ");
      fazendaNome = partes.length > 1 ? partes.slice(1).join(" - ").trim() : label;
    }
    if (!fazendaCodigo) avisos.push(`Ordem ${numero}: sem fazenda identificada.`);

    const proprietarioCodigo = linhaStatus ? texto(linhaStatus[1]) || undefined : undefined;
    const proprietarioNome = linhaStatus ? texto(linhaStatus[2]) || undefined : undefined;
    const dataQueima = linhaStatus ? dataIso(linhaStatus[6]) ?? undefined : undefined;
    const tipoCana = linhaTipoCana ? texto(linhaTipoCana[2]) || undefined : undefined;
    const observacao = linhaObs ? texto(linhaObs[1]) || undefined : undefined;

    // Uma ordem pode ter mais de um bloco "Propriedade" (mais de uma
    // fazenda), cada um seguido pelos seus próprios talhões — e o número do
    // talhão sozinho se repete entre fazendas (ex.: talhão "1" em duas
    // fazendas da mesma ordem), então a chave real é fazenda+talhão. As
    // linhas de talhão têm col0..col4 vazias, col5 preenchida, e não são a
    // linha "Totais:" (col5 vazia, "Totais:" na col6).
    const areaPorFazendaTalhao = new Map<
      string,
      { fazendaCodigo: string; fazendaNome: string; talhao: string; areaHa: number }
    >();
    let fazendaAtualCodigo = "";
    let fazendaAtualNome = "";
    for (const l of bloco.linhas) {
      if (l[0] === "Propriedade") {
        fazendaAtualCodigo = texto(l[1]);
        const label = texto(l[3]);
        const partes = label.split(" - ");
        fazendaAtualNome = partes.length > 1 ? partes.slice(1).join(" - ").trim() : label;
        continue;
      }
      const vazio = l[0] === "" && l[1] === "" && l[2] === "" && l[3] === "" && l[4] === "";
      if (!vazio) continue;
      if (l[6] === "Totais:") continue;
      const talhao = texto(l[5]);
      if (!talhao) continue;
      const area = numeroBR(l[6]);
      const codigo = fazendaAtualCodigo || fazendaCodigo || "-";
      const chave = `${codigo}|${talhao}`;
      const atual = areaPorFazendaTalhao.get(chave) ?? {
        fazendaCodigo: codigo,
        fazendaNome: fazendaAtualNome || fazendaNome || "Fazenda não informada",
        talhao,
        areaHa: 0,
      };
      atual.areaHa += area;
      areaPorFazendaTalhao.set(chave, atual);
    }
    const talhoes: TalhaoOrdem[] = [...areaPorFazendaTalhao.values()]
      .map((t) => ({ ...t, areaHa: Math.round(t.areaHa * 100) / 100, areaColhidaHa: 0 }))
      .sort((a, b) =>
        a.fazendaCodigo === b.fazendaCodigo
          ? a.talhao.localeCompare(b.talhao, undefined, { numeric: true })
          : a.fazendaCodigo.localeCompare(b.fazendaCodigo)
      );

    if (talhoes.length === 0) {
      avisos.push(`Ordem ${numero}: nenhum talhão encontrado no bloco.`);
    }

    ordens.push({
      numero,
      frente: frente || "SEM FRENTE",
      fazendaCodigo: fazendaCodigo || "-",
      fazendaNome: fazendaNome || "Fazenda não informada",
      proprietarioCodigo,
      proprietarioNome,
      status,
      tipoCana,
      dataQueima,
      observacao,
      talhoes,
    });
  }

  return { ordens, avisos, erros };
}

// ---------------------------------------------------------------------------
// 2) Relatório de Pesagem de Cana — uma linha por viagem, já com a ordem
// ---------------------------------------------------------------------------
//
// A agregação por (ordem, data, fazenda, talhão) acontece AQUI, linha a
// linha, em vez de guardar cada viagem num array para juntar depois — a
// instância gratuita do Render (512 MB) não sobra memória para reter as
// ~176 mil viagens inteiras E a agregação ao mesmo tempo.

export interface EntradaAgregada {
  ordem: string;
  data: string;
  fazendaCodigo: string;
  talhao: string;
  toneladas: number;
  /** parte de `toneladas` pesada com "Hora Saída Indústria" < 06:00 — usada
   * pela coluna "Dia Atual" do resumo por frente. */
  toneladasAte6h: number;
  viagens: number;
}

export async function agregarPesagem(
  buffer: ArrayBuffer,
  ordensCadastradas: Set<string>
): Promise<{
  agregados: Map<string, EntradaAgregada>;
  totalViagens: number;
  semOrdem: number;
  ordensNaoCadastradas: Set<string>;
  avisos: string[];
  erros: string[];
}> {
  const avisos: string[] = [];
  const erros: string[] = [];
  const agregados = new Map<string, EntradaAgregada>();
  const ordensNaoCadastradas = new Set<string>();

  let numLinha = 0;
  let idxCabecalho: number | null = null;
  let totalViagens = 0;
  let semOrdem = 0;

  await paraCadaLinha(buffer, (l) => {
    const linhaAtual = numLinha++;

    if (idxCabecalho === null) {
      if (
        linhaAtual < 15 &&
        l[1] === "Data Mov." &&
        l[2] === "Turno" &&
        l[3] === "Liberação" &&
        l[4] === "Controle"
      ) {
        idxCabecalho = linhaAtual;
      }
      return;
    }

    // Linhas de verdade sempre têm "Liberação" (a ordem) numérica — pula
    // linhas em branco e o rodapé (totais) sem precisar reconhecer o
    // formato exato deles.
    if (typeof l[3] !== "number") return;

    const data = dataIsoSerial(l[1]); // "Data Mov." — sempre igual à "Data Saída Indústria"
    if (!data) return;
    totalViagens++;

    const ordem = texto(l[3]); // "Liberação" já é o número da ordem (O.Q.)
    if (!ordensCadastradas.has(ordem)) {
      ordensNaoCadastradas.add(ordem);
      semOrdem++;
      return;
    }

    // "Fundo Agrícola" vem como "9529 - FAZ. SANTA VITÓRIA", mesmo formato
    // da linha "Propriedade" em Ordem de Colheita.xlsx — mesma lógica de
    // split pra extrair o código.
    const fundoAgricola = texto(l[13]);
    const fazendaCodigo = fundoAgricola.split(" - ")[0]?.trim() || "-";
    const talhao = texto(l[14]);
    const toneladas = numeroBR(l[19]) / 1000; // Peso Líquido, em kg
    const horaSaidaIndustria = texto(l[31]); // "HH:MM" — já é texto, não fração de dia

    // Fazenda entra na chave porque o número do talhão sozinho não é único
    // dentro da ordem quando ela abrange mais de uma fazenda (ver TalhaoOrdem).
    const k = `${ordem}|${data}|${fazendaCodigo}|${talhao}`;
    const acc =
      agregados.get(k) ?? { ordem, data, fazendaCodigo, talhao, toneladas: 0, toneladasAte6h: 0, viagens: 0 };
    acc.toneladas += toneladas;
    if (horaSaidaIndustria && horaSaidaIndustria < "06:00") acc.toneladasAte6h += toneladas;
    acc.viagens += 1;
    agregados.set(k, acc);
  });

  if (idxCabecalho === null) {
    erros.push(
      'Não encontrei o cabeçalho esperado (Data Mov. / Turno / Liberação / Controle) nas primeiras linhas do arquivo "Relatório de Pesagem de Cana". Confira se é o arquivo certo.'
    );
    return { agregados: new Map(), totalViagens: 0, semOrdem: 0, ordensNaoCadastradas, avisos, erros };
  }

  if (totalViagens === 0) {
    erros.push('Nenhuma viagem foi lida do arquivo "Relatório de Pesagem de Cana".');
  }

  return { agregados, totalViagens, semOrdem, ordensNaoCadastradas, avisos, erros };
}

// ---------------------------------------------------------------------------
// Monta as ordens finais a partir do cadastro + da agregação já pronta
// ---------------------------------------------------------------------------

export function montarOrdens(
  cadastro: OrdemCadastro[],
  agregado: {
    agregados: Map<string, EntradaAgregada>;
    totalViagens: number;
    semOrdem: number;
    ordensNaoCadastradas: Set<string>;
  },
  safraLabel: string
): ResultadoImportacaoArquivos {
  const avisos: string[] = [];
  const erros: string[] = [];

  const ordensPorNumero = new Map<string, OrdemCorte>();
  for (const c of cadastro) {
    ordensPorNumero.set(c.numero, {
      id: c.numero,
      numero: c.numero,
      frente: c.frente,
      fazendaCodigo: c.fazendaCodigo,
      fazendaNome: c.fazendaNome,
      proprietarioCodigo: c.proprietarioCodigo,
      proprietarioNome: c.proprietarioNome,
      status: c.status,
      tipoCana: c.tipoCana,
      dataQueima: c.dataQueima,
      observacao: c.observacao,
      safraLabel,
      talhoes: c.talhoes,
      entradas: [],
      atualizadoEm: new Date().toISOString(),
    });
  }

  for (const acc of agregado.agregados.values()) {
    const ordem = ordensPorNumero.get(acc.ordem);
    if (!ordem) continue;
    ordem.entradas.push({
      data: acc.data,
      fazendaCodigo: acc.fazendaCodigo,
      talhao: acc.talhao,
      toneladas: Math.round(acc.toneladas * 100) / 100,
      toneladasAte6h: Math.round(acc.toneladasAte6h * 100) / 100,
      viagens: acc.viagens,
    });
  }

  if (agregado.ordensNaoCadastradas.size > 0) {
    avisos.push(
      `${agregado.ordensNaoCadastradas.size} ordem(ns) aparecem nas viagens mas não têm cadastro em "Ordem de Colheita": ${[
        ...agregado.ordensNaoCadastradas,
      ]
        .slice(0, 15)
        .join(", ")}${agregado.ordensNaoCadastradas.size > 15 ? "…" : ""}.`
    );
  }

  const ordens = [...ordensPorNumero.values()];
  for (const o of ordens) {
    o.entradas.sort((a, b) => (a.data === b.data ? a.talhao.localeCompare(b.talhao) : a.data.localeCompare(b.data)));
  }

  return {
    ordens,
    avisos,
    erros,
    totalOrdens: ordens.length,
    totalViagens: agregado.totalViagens,
    viagensSemOrdem: agregado.semOrdem,
  };
}
