import * as XLSX from "xlsx";
import { dataIso, numeroBR, texto } from "./import-pesagem";
import { normalizarTexto } from "./cadastros-spec";

export interface LinhaRodadaImportada {
  rod: number;
  dt: string;
  sem: number;
  periodo: string;
  resp: string;
  reg: string;
  faz: string;
  tlh: string;
  area: number | null;
  oco: string;
  rec: string;
  /** colunas extras da planilha (feito, atividade etc.) guardadas junto da linha */
  ext: Record<string, string>;
}

export interface ResultadoRodadasImport {
  linhas: LinhaRodadaImportada[];
  linhasLidas: number;
  avisos: string[];
  erros: string[];
}

const CHAVES = ["rodada", "data", "semana", "regiao", "fazenda", "talhao", "ocorrencia"];

/** Colunas que não são importadas (a coluna Status da planilha é desconsiderada). */
const IGNORAR = new Set(["status", "rodada", "data", "semana", "periodo", "responsavel", "regiao", "fazenda", "talhao", "area", "ocorrencia"]);

function dataDaCelula(c: unknown): string | null {
  if (c instanceof Date) return dataIso(c);
  const t = texto(c);
  // aceita ano com 2 dígitos e também digitado com zero a mais ("14/08/02026" → 2026)
  const br = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,5})$/);
  if (br) {
    const n = Number(br[3]);
    const ano = br[3].length === 2 ? 2000 + n : n;
    if (ano < 2000 || ano > 2100) return null;
    return `${ano}-${br[2].padStart(2, "0")}-${br[1].padStart(2, "0")}`;
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null;
}

/**
 * Lê a planilha "Acompanhamento de Levantamento de Área" (aba Base_Campo, ou a
 * aba que tiver o cabeçalho com Rodada, Data, Semana, Região, Fazenda, Talhão e
 * Ocorrência). A coluna Status é desconsiderada.
 */
export function lerRodadasCampo(buffer: ArrayBuffer): ResultadoRodadasImport {
  const res: ResultadoRodadasImport = { linhas: [], linhasLidas: 0, avisos: [], erros: [] };
  const wb = XLSX.read(buffer, { type: "array", cellDates: true });

  let achada: { linhas: unknown[][]; idx: number; chaves: string[] } | null = null;
  const ordemAbas = [...wb.SheetNames].sort((a, b) => (/base.?campo/i.test(b) ? 1 : 0) - (/base.?campo/i.test(a) ? 1 : 0));
  for (const nome of ordemAbas) {
    const linhas = XLSX.utils.sheet_to_json(wb.Sheets[nome], { header: 1, raw: true, defval: "" }) as unknown[][];
    for (let i = 0; i < Math.min(linhas.length, 40); i++) {
      const chaves = linhas[i].map((c) => normalizarTexto(String(c ?? "")));
      if (CHAVES.every((k) => chaves.includes(k))) {
        achada = { linhas, idx: i, chaves };
        break;
      }
    }
    if (achada) break;
  }
  if (!achada) {
    res.erros.push(
      "Não encontrei o cabeçalho esperado (Rodada, Data, Semana, Região, Fazenda, Talhão e Ocorrência) em nenhuma aba do arquivo."
    );
    return res;
  }

  const { linhas, idx, chaves } = achada;
  const col = (k: string) => chaves.indexOf(k);
  const cRod = col("rodada");
  const cData = col("data");
  const cSem = col("semana");
  const cPer = col("periodo");
  const cResp = col("responsavel");
  const cReg = col("regiao");
  const cFaz = col("fazenda");
  const cTlh = col("talhao");
  const cArea = col("area");
  const cOco = col("ocorrencia");
  const cRec = chaves.findIndex((k) => k.startsWith("recomendacao"));
  const extras = chaves.map((k, j) => ({ k, j })).filter(({ k, j }) => k && !IGNORAR.has(k) && j !== cRec);
  const nomesExtras = linhas[idx];

  let ignoradas = 0;
  for (let i = idx + 1; i < linhas.length; i++) {
    const l = linhas[i];
    const rod = Math.trunc(numeroBR(l[cRod]));
    const dt = dataDaCelula(l[cData]);
    const faz = texto(l[cFaz]);
    if (!rod && !dt && !faz) continue;
    res.linhasLidas++;
    if (!rod || !dt || !faz) {
      ignoradas++;
      continue;
    }
    const ext: Record<string, string> = {};
    for (const { j } of extras) {
      const v = texto(l[j]).replace(/\s+/g, " ");
      if (v) ext[texto(nomesExtras[j]).replace(/\s+/g, " ")] = v;
    }
    res.linhas.push({
      rod,
      dt,
      sem: Math.trunc(numeroBR(l[cSem])),
      periodo: cPer >= 0 ? texto(l[cPer]).replace(/\s+/g, " ") : "",
      resp: cResp >= 0 ? texto(l[cResp]).replace(/\s+/g, " ") : "",
      reg: texto(l[cReg]).replace(/\.0+$/, ""),
      faz: faz.replace(/\.0+$/, ""),
      tlh: texto(l[cTlh]).replace(/\.0+$/, ""),
      area: texto(l[cArea]) === "" ? null : numeroBR(l[cArea]),
      oco: texto(l[cOco]).replace(/\s+/g, " "),
      rec: cRec >= 0 ? texto(l[cRec]).replace(/\s+/g, " ") : "",
      ext,
    });
  }
  if (ignoradas > 0) res.avisos.push(`${ignoradas} linha(s) sem rodada, data ou fazenda foram ignoradas.`);
  if (res.linhas.length === 0) res.erros.push("Nenhuma linha válida foi encontrada no arquivo.");
  return res;
}
