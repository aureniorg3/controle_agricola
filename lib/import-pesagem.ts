import * as XLSX from "xlsx";
import ExcelJS from "exceljs";
import { Readable } from "stream";
import { EntradaDiaria, OrdemCorte, StatusOrdem, TalhaoOrdem } from "./types";

/**
 * Importação a partir de 3 relatórios do sistema de origem (CHBWEB),
 * gerados e anexados diariamente:
 *
 *  1. "Ordem de Colheita.xlsx"       — cadastro de cada ordem (status,
 *     frente, fazenda, talhões e suas áreas). Um bloco de linhas por ordem.
 *  2. "Pesagem de Cana por Hora"     — uma linha por viagem de caminhão
 *     (Controle+Sequência), com data, frente, fazenda, talhão e peso.
 *  3. "Conferência de Pesagens"      — mesma chave Controle+Sequência,
 *     usada só para descobrir a qual ordem (O.Q.) cada viagem pertence.
 *
 * Os três cobrem a safra inteira até a data de geração (não é um
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
  viagensSemConferencia: number;
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
// 2) Pesagem de Cana por Hora — uma linha por viagem
// ---------------------------------------------------------------------------
//
// O cruzamento com a Conferência (Controle+Sequência -> O.Q.) e a agregação
// por (ordem, data, talhão) acontecem AQUI, linha a linha, em vez de guardar
// as ~176 mil viagens num array para juntar depois — a instância gratuita do
// Render (512 MB) não sobra memória para reter as viagens inteiras E a
// agregação ao mesmo tempo.

export interface EntradaAgregada {
  ordem: string;
  data: string;
  fazendaCodigo: string;
  talhao: string;
  toneladas: number;
  /** parte de `toneladas` pesada com Hora < 06:00 — usada pela coluna
   * "Dia Atual" do resumo por frente. */
  toneladasAte6h: number;
  viagens: number;
}

export async function agregarPesagem(
  buffer: ArrayBuffer,
  conferencia: Map<number, string>,
  ordensCadastradas: Set<string>
): Promise<{
  agregados: Map<string, EntradaAgregada>;
  totalViagens: number;
  semOrdem: number;
  semConferencia: number;
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
  let frenteAtual = "";
  let semFrente = 0;
  let totalViagens = 0;
  let semOrdem = 0;
  let semConferencia = 0;

  await paraCadaLinha(buffer, (l) => {
    const linhaAtual = numLinha++;

    if (idxCabecalho === null) {
      if (linhaAtual < 15 && l[0] === "Data" && l[1] === "Hora" && l[2] === "Veiculo" && l[3] === "Controle") {
        idxCabecalho = linhaAtual;
      }
      return;
    }

    if (!l || l.every((v) => v === undefined || v === "")) return;

    if (l[0] === "Frente:") {
      frenteAtual = texto(l[2]);
      return;
    }

    const data = dataIsoSerial(l[0]);
    if (!data) return; // linhas de rodapé ("Total Frente.....", "Total Geral.....")
    if (!frenteAtual) semFrente++;
    totalViagens++;

    const controle = numeroBR(l[3]);
    const seq = numeroBR(l[4]);
    const ordemInfo = conferencia.get(chaveControleSeq(controle, seq));
    if (ordemInfo === undefined) {
      semConferencia++;
      return;
    }
    if (!ordemInfo || !ordensCadastradas.has(ordemInfo)) {
      if (ordemInfo) ordensNaoCadastradas.add(ordemInfo);
      semOrdem++;
      return;
    }

    const fazendaCodigo = texto(l[6]);
    const talhao = texto(l[8]);
    const toneladas = numeroBR(l[12]) / 1000;
    const horaFracao = numeroBR(l[1]); // fração do dia (0 a <1) — 0,25 = 06:00
    // Fazenda entra na chave porque o número do talhão sozinho não é único
    // dentro da ordem quando ela abrange mais de uma fazenda (ver TalhaoOrdem).
    const k = `${ordemInfo}|${data}|${fazendaCodigo}|${talhao}`;
    const acc =
      agregados.get(k) ?? { ordem: ordemInfo, data, fazendaCodigo, talhao, toneladas: 0, toneladasAte6h: 0, viagens: 0 };
    acc.toneladas += toneladas;
    if (horaFracao < 0.25) acc.toneladasAte6h += toneladas;
    acc.viagens += 1;
    agregados.set(k, acc);
  });

  if (idxCabecalho === null) {
    erros.push(
      'Não encontrei o cabeçalho esperado (Data / Hora / Veiculo / Controle) nas primeiras linhas do arquivo "Pesagem de Cana por Hora". Confira se é o arquivo certo.'
    );
    return { agregados: new Map(), totalViagens: 0, semOrdem: 0, semConferencia: 0, ordensNaoCadastradas, avisos, erros };
  }

  if (semFrente > 0) {
    avisos.push(`${semFrente} viagem(ns) apareceram antes de qualquer marcador "Frente:" — agrupadas em "SEM FRENTE".`);
  }
  if (totalViagens === 0) {
    erros.push('Nenhuma viagem foi lida do arquivo "Pesagem de Cana por Hora".');
  }

  return { agregados, totalViagens, semOrdem, semConferencia, ordensNaoCadastradas, avisos, erros };
}

// ---------------------------------------------------------------------------
// 3) Conferência de Pesagens — só para o cruzamento Controle+Sequência -> O.Q.
// ---------------------------------------------------------------------------

/** Chave compacta Controle+Sequência — um número em vez de string, para não
 * pagar hashing de string nem o overhead de um objeto por entrada num mapa
 * de ~176 mil linhas (a Sequência nunca chega perto de 1 milhão). */
function chaveControleSeq(controle: number, seq: number): number {
  return controle * 1_000_000 + seq;
}

export async function parseConferencia(buffer: ArrayBuffer): Promise<{
  porChave: Map<number, string>;
  avisos: string[];
  erros: string[];
}> {
  const avisos: string[] = [];
  const erros: string[] = [];
  const porChave = new Map<number, string>();

  let numLinha = 0;
  let idxCabecalho: number | null = null;
  let colOQ = -1;

  await paraCadaLinha(buffer, (l) => {
    const linhaAtual = numLinha++;

    if (idxCabecalho === null) {
      if (linhaAtual < 15 && l[0] === "Controle" && l.includes("O.Q.")) {
        idxCabecalho = linhaAtual;
        colOQ = l.indexOf("O.Q.");
      }
      return;
    }

    if (!l || typeof l[0] !== "number") return;
    porChave.set(chaveControleSeq(l[0], numeroBR(l[1])), texto(l[colOQ]));
  });

  if (idxCabecalho === null) {
    erros.push(
      'Não encontrei o cabeçalho esperado (Controle ... O.Q.) nas primeiras linhas do arquivo "Conferência de Pesagens". Confira se é o arquivo certo.'
    );
    return { porChave, avisos, erros };
  }

  if (porChave.size === 0) {
    erros.push('Nenhuma linha foi lida do arquivo "Conferência de Pesagens".');
  }

  return { porChave, avisos, erros };
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
    semConferencia: number;
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

  if (agregado.semConferencia > 0) {
    avisos.push(
      `${agregado.semConferencia} viagem(ns) não encontraram o par Controle+Sequência na Conferência de Pesagens — não entraram em nenhuma ordem.`
    );
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
    viagensSemConferencia: agregado.semConferencia,
  };
}
