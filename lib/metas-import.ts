import { dataIso, lerLinhas, numeroBR, texto } from "./import-pesagem";
import { normalizarTexto } from "./cadastros-spec";

export interface MetaImportada {
  frente: string;
  metaDiaT: number;
  /** YYYY-MM-DD — primeiro dia em que a meta vale */
  vigencia: string;
}

export interface ResultadoMetas {
  metas: MetaImportada[];
  linhasLidas: number;
  avisos: string[];
  erros: string[];
}

function dataDaCelula(c: unknown): string | null {
  if (c instanceof Date) return dataIso(c);
  const t = texto(c);
  const br = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (br) {
    const ano = br[3].length === 2 ? `20${br[3]}` : br[3];
    return `${ano}-${br[2].padStart(2, "0")}-${br[1].padStart(2, "0")}`;
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null;
}

/**
 * Lê a planilha de metas: uma linha por Frente + Data (vigência) + Meta (t/dia).
 * A meta vale da data em diante, até a próxima da mesma frente. Repetidas
 * (mesma frente e data) valem a última.
 */
export function lerMetas(buffer: ArrayBuffer): ResultadoMetas {
  const res: ResultadoMetas = { metas: [], linhasLidas: 0, avisos: [], erros: [] };
  const linhas = lerLinhas(buffer);

  let idxCab = -1;
  let cFrente = -1;
  let cMeta = -1;
  let cData = -1;
  for (let i = 0; i < Math.min(linhas.length, 15); i++) {
    const nomes = linhas[i].map((c) => normalizarTexto(String(c ?? "")));
    const f = nomes.findIndex((n) => n === "frente");
    const m = nomes.findIndex((n) => n.startsWith("meta"));
    const d = nomes.findIndex((n) => n === "data" || n.startsWith("vigencia") || n.startsWith("data vigencia"));
    if (f >= 0 && m >= 0 && d >= 0) {
      idxCab = i;
      cFrente = f;
      cMeta = m;
      cData = d;
      break;
    }
  }
  if (idxCab < 0) {
    res.erros.push('Não encontrei o cabeçalho esperado ("Frente", "Meta (t/dia)" e "Data") nas primeiras linhas do arquivo.');
    return res;
  }

  const porChave = new Map<string, MetaImportada>();
  let ignoradas = 0;
  for (let i = idxCab + 1; i < linhas.length; i++) {
    const l = linhas[i];
    const frente = texto(l[cFrente]).replace(/\s+/g, " ");
    if (!frente && !texto(l[cMeta]) && !texto(l[cData])) continue;
    res.linhasLidas++;
    const vigencia = dataDaCelula(l[cData]);
    const metaDiaT = numeroBR(l[cMeta]);
    const metaTexto = texto(l[cMeta]);
    if (!frente || !vigencia || metaTexto === "" || !(metaDiaT >= 0)) {
      ignoradas++;
      continue;
    }
    porChave.set(`${frente}|${vigencia}`, { frente, metaDiaT, vigencia });
  }
  res.metas = [...porChave.values()];
  if (ignoradas > 0) res.avisos.push(`${ignoradas} linha(s) sem frente, data ou meta válidas foram ignoradas.`);
  if (res.metas.length === 0) res.erros.push("Nenhuma meta válida foi encontrada no arquivo.");
  return res;
}
