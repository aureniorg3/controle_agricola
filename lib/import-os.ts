import type { LinhaBaseOS } from "./atividades";
import { normalizarTexto } from "./cadastros-spec";
import { paraCadaLinha } from "./import-pesagem";

/**
 * Lê a base de Acompanhamento de O.S. (uma linha por O.S. × talhão × operação, às vezes repetida por produto).
 * O cabeçalho é achado pelos nomes das colunas — aceita tanto os nomes da extração (codigo_os, id_propriedade,
 * talhao, area_talhao…) quanto rótulos do relatório (O.S., Propriedade, Talhão, Área…).
 */
const CAMPOS: Record<keyof Omit<LinhaBaseOS, never>, string[]> = {
  emp: ["id empresa", "empresa", "codigo empresa"],
  os: ["codigo os", "os", "o s", "ordem de servico", "numero os", "n os", "ordem servico"],
  propCod: ["id propriedade", "codigo propriedade", "propriedade", "fazenda", "cod propriedade"],
  propNm: ["descricao propriedade", "fundo agricola", "descricao fazenda", "nome propriedade"],
  tlh: ["talhao", "id talhao", "codigo talhao"],
  areaTlh: ["area talhao", "area do talhao", "area ha", "area"],
  areaRec: ["area recomendada", "area rec"],
  opCod: ["codigo operacao agricola", "codigo operacao", "operacao", "cod operacao"],
  opDs: ["descricao operacao agricola", "descricao operacao", "descricao da operacao"],
  etapaCod: ["codigo etapa", "etapa"],
  etapaDs: ["descricao etapa", "descricao da etapa"],
  tipoCod: ["codigo tipo aplicacao", "tipo aplicacao", "tipo de aplicacao"],
  tipoDs: ["descricao tipo aplicacao", "descricao tipo de aplicacao", "desc tipo de apl"],
  resp: ["responsavel", "solicitante"],
  status: ["status", "situacao"],
  safra: ["safra"],
  dtLanc: ["data lancamento", "data de lancamento", "data emissao"],
  obs: ["observacao", "obs"],
};

const vazio = (v: unknown) => v === null || v === undefined || (typeof v === "string" && (v.trim() === "" || v.trim() === "\\N"));
const txt = (v: unknown) => (vazio(v) ? "" : typeof v === "number" ? String(Number.isInteger(v) ? v : v) : String(v).replace(/\s+/g, " ").trim());
const num = (v: unknown): number | null => {
  if (vazio(v)) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).trim();
  const n = s.includes(",") ? Number(s.replace(/\./g, "").replace(",", ".")) : Number(s);
  return Number.isFinite(n) ? n : null;
};
/** número de série do Excel (dias desde 1899-12-30) ou "dd/mm/aaaa" → ISO */
function dataIso(v: unknown): string | null {
  if (vazio(v)) return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  if (typeof v === "number" && v > 20000 && v < 80000) return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
  const m = String(v).match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  const iso = String(v).match(/^(\d{4}-\d{2}-\d{2})/);
  return iso ? iso[1] : null;
}
/** a O.S. às vezes vem formatada como data no Excel (1 = 01/01/1900): volta a ser o número */
function codigoOS(v: unknown): string {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return String(Math.round((v.getTime() - Date.UTC(1899, 11, 30)) / 86400000));
  const n = num(v);
  return n !== null && Number.isInteger(n) ? String(n) : txt(v);
}

export interface ResultadoBaseOS {
  linhas: LinhaBaseOS[];
  lidas: number;
  ordens: number;
  erro?: string;
}

export async function lerBaseOS(buffer: ArrayBuffer): Promise<ResultadoBaseOS> {
  let indices: Partial<Record<keyof LinhaBaseOS, number>> | null = null;
  let n = 0;
  let lidas = 0;
  const porChave = new Map<string, LinhaBaseOS>();
  const lerLinha = (l: unknown[]) => {
    n++;
    if (!indices) {
      if (n > 30) return;
      const nomes = l.map((c) => normalizarTexto(String(c ?? "")));
      const achar = (alternativas: string[]) => {
        for (const a of alternativas) {
          const i = nomes.indexOf(a);
          if (i >= 0) return i;
        }
        return -1;
      };
      const os = achar(CAMPOS.os);
      const tlh = achar(CAMPOS.tlh);
      const prop = achar(CAMPOS.propCod);
      if (os < 0 || tlh < 0 || prop < 0) return;
      const idx: Partial<Record<keyof LinhaBaseOS, number>> = {};
      for (const [campo, alt] of Object.entries(CAMPOS) as [keyof LinhaBaseOS, string[]][]) {
        const i = achar(alt);
        if (i >= 0) idx[campo] = i;
      }
      // "operacao"/"etapa"/"tipo aplicacao" podem ser só a descrição; se o código e a descrição caíram na mesma coluna, fica só como descrição
      for (const [c, d] of [["opCod", "opDs"], ["etapaCod", "etapaDs"], ["tipoCod", "tipoDs"]] as const) {
        if (idx[c] !== undefined && idx[c] === idx[d]) delete idx[c];
      }
      indices = idx;
      return;
    }
    const g = (c: keyof LinhaBaseOS) => (indices![c] === undefined ? undefined : l[indices![c]!]);
    const os = codigoOS(g("os"));
    const propCod = txt(g("propCod"));
    const tlh = txt(g("tlh"));
    if (!os || !propCod || !tlh || normalizarTexto(os) === "codigo os") return;
    lidas++;
    const linha: LinhaBaseOS = {
      emp: txt(g("emp")),
      os,
      propCod,
      propNm: txt(g("propNm")),
      tlh,
      areaTlh: num(g("areaTlh")),
      areaRec: num(g("areaRec")),
      opCod: txt(g("opCod")) || txt(g("opDs")),
      opDs: txt(g("opDs")),
      etapaCod: txt(g("etapaCod")),
      etapaDs: txt(g("etapaDs")),
      tipoCod: txt(g("tipoCod")),
      tipoDs: txt(g("tipoDs")),
      resp: txt(g("resp")),
      status: txt(g("status")),
      safra: txt(g("safra")),
      dtLanc: dataIso(g("dtLanc")),
      obs: txt(g("obs")).slice(0, 500),
    };
    // a mesma O.S. × talhão × operação se repete por produto: vale a primeira
    const chave = `${linha.emp}|${os}|${propCod}|${tlh}|${linha.opCod}`;
    if (!porChave.has(chave)) porChave.set(chave, linha);
  };
  try {
    await paraCadaLinha(buffer, lerLinha, false);
  } catch (e) {
    if (n > 0) throw e;
    await paraCadaLinha(buffer, lerLinha, true);
  }
  if (!indices) {
    return { linhas: [], lidas: 0, ordens: 0, erro: "Não encontrei o cabeçalho da base de O.S. (colunas da O.S., da propriedade e do talhão) nas primeiras linhas da primeira aba." };
  }
  const linhas = Array.from(porChave.values());
  if (linhas.length === 0) return { linhas, lidas, ordens: 0, erro: "Nenhuma linha de O.S. com propriedade e talhão encontrada." };
  return { linhas, lidas, ordens: new Set(linhas.map((l) => `${l.emp}|${l.os}`)).size };
}
