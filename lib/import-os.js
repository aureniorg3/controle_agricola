import { normalizarTexto } from "./cadastros-spec";
import { paraCadaLinha } from "./import-pesagem";
import { POSICOES } from "./os-agr";

/**
 * Lê a base de Acompanhamento de O.S. (uma linha por O.S. × talhão × operação, às vezes repetida por produto).
 * O cabeçalho é achado pelos nomes das colunas — aceita os nomes da extração (codigo_os, id_propriedade, talhao,
 * area_talhao…) e os do "Relatório de Ordens de Serviço das Etapas II" do sistema, nas duas formas em que ele sai:
 *  - em colunas (Código da OS, Propriedade, Código do Talhão, Letra, Área Plantada Total, Área Recomendada Total,
 *    Operação Agrícola, Descrição da Operação Agrícola, Etapa, Safra, Posição, Nome…);
 *  - agrupado: linhas "Operação : 14250  Descrição : …" e "Etapa : 105  Descrição : …" valem para as linhas de
 *    O.S. × talhão de baixo (OS, Data OS, Posição, Propriedade, Fundo Agrícola, Talhão, Área Plantada, Recom.…);
 *    a empresa vem da linha "Empresa: 6" do topo.
 */
const CAMPOS = {
  emp: ["id empresa", "empresa", "codigo empresa", "codigo da empresa"],
  os: ["codigo os", "codigo da os", "os", "o s", "ordem de servico", "numero os", "n os", "ordem servico"],
  propCod: ["id propriedade", "codigo propriedade", "propriedade", "fazenda", "cod propriedade"],
  propNm: ["descricao propriedade", "fundo agricola", "descricao fazenda", "nome propriedade"],
  tlh: ["talhao", "id talhao", "codigo talhao", "codigo do talhao"],
  letra: ["letra"],
  areaTlh: ["area talhao", "area do talhao", "area ha", "area", "area plantada total", "area plantada", "plantada"],
  areaRec: ["area recomendada", "area rec", "area recomendada total", "recom"],
  opCod: ["codigo operacao agricola", "codigo operacao", "operacao", "cod operacao", "operacao agricola"],
  opDs: ["descricao operacao agricola", "descricao operacao", "descricao da operacao", "descricao da operacao agricola"],
  etapaCod: ["codigo etapa", "etapa"],
  etapaDs: ["descricao etapa", "descricao da etapa", "descricao etapa insumo"],
  tipoCod: ["codigo tipo aplicacao", "tipo aplicacao", "tipo de aplicacao"],
  tipoDs: ["descricao tipo aplicacao", "descricao tipo de aplicacao", "desc tipo de apl"],
  resp: ["responsavel", "solicitante"],
  respNome: ["nome"],
  status: ["status", "situacao", "posicao"],
  safra: ["safra"],
  dtLanc: ["data lancamento", "data de lancamento", "data emissao", "data os", "data da os"],
  obs: ["observacao", "obs", "observacao da os"],
};

export const vazio = (v) => v === null || v === undefined || (typeof v === "string" && (v.trim() === "" || v.trim() === "\\N"));
export const txt = (v) => (vazio(v) ? "" : typeof v === "number" ? String(Number.isInteger(v) ? v : v) : String(v).replace(/\s+/g, " ").trim());
export const num = (v) => {
  if (vazio(v)) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).trim();
  const n = s.includes(",") ? Number(s.replace(/\./g, "").replace(",", ".")) : Number(s);
  return Number.isFinite(n) ? n : null;
};
/** número de série do Excel (dias desde 1899-12-30) ou "dd/mm/aaaa" → ISO */
export function dataIso(v) {
  if (vazio(v)) return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  if (typeof v === "number" && v > 20000 && v < 80000) return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
  const m = String(v).match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  const iso = String(v).match(/^(\d{4}-\d{2}-\d{2})/);
  return iso ? iso[1] : null;
}
/** a O.S. às vezes vem formatada como data no Excel (1 = 01/01/1900): volta a ser o número */
export function codigoOS(v) {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return String(Math.round((v.getTime() - Date.UTC(1899, 11, 30)) / 86400000));
  const n = num(v);
  return n !== null && Number.isInteger(n) ? String(n) : txt(v);
}

/** Rótulo de linha de grupo do relatório agrupado ("Operação :", "Etapa :", "Empresa:"), sem acento e sem os dois-pontos. */
const rotulo = (v) => normalizarTexto(String(v ?? ""));

/** Linha de grupo "Operação : 14250  Descrição : IRRIG…" (ou Etapa): o código e a descrição que vêm depois do rótulo. */
function grupoDaLinha(l, nome) {
  const i = l.findIndex((c) => rotulo(c) === nome);
  if (i < 0) return null;
  const cod = txt(l.slice(i + 1).find((c) => !vazio(c)));
  const iDs = l.findIndex((c, k) => k > i && rotulo(c) === "descricao");
  const ds = iDs >= 0 ? txt(l.slice(iDs + 1).find((c) => !vazio(c))) : "";
  return cod ? { cod, ds } : null;
}

export async function lerBaseOS(buffer) {
  let indices = null;
  let n = 0;
  let lidas = 0;
  let empresaDoTopo = "";
  // relatório agrupado: a operação e a etapa da vez valem para as linhas de baixo
  let opDaVez = null;
  let etapaDaVez = null;
  let semOperacao = 0;
  const porChave = new Map();
  const lerLinha = (l) => {
    n++;
    if (!indices) {
      if (n > 30) return;
      // "Empresa: 6 CONDOMINIO…" no topo do relatório
      const iEmp = l.findIndex((c) => rotulo(c) === "empresa");
      if (iEmp >= 0) {
        const v = l.slice(iEmp + 1).find((c) => !vazio(c));
        if (v !== undefined && /^\d+$/.test(txt(v))) empresaDoTopo = txt(v);
      }
      // ou só "6 | CONDOMINIO…" na primeira linha (relatório em colunas)
      const cheias = l.filter((c) => !vazio(c));
      if (!empresaDoTopo && n <= 2 && typeof cheias[0] === "number" && Number.isInteger(cheias[0]) && /[a-z]{3}/i.test(txt(cheias[1]))) {
        empresaDoTopo = String(cheias[0]);
      }
      const nomes = l.map((c) => normalizarTexto(String(c ?? "")));
      const achar = (alternativas) => {
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
      const idx = {};
      for (const [campo, alt] of Object.entries(CAMPOS)) {
        const i = achar(alt);
        if (i >= 0) idx[campo] = i;
      }
      // "operacao"/"etapa"/"tipo aplicacao" podem ser só a descrição; se o código e a descrição caíram na mesma coluna, fica só como descrição
      for (const [c, d] of [
        ["opCod", "opDs"],
        ["etapaCod", "etapaDs"],
        ["tipoCod", "tipoDs"],
      ]) {
        if (idx[c] !== undefined && idx[c] === idx[d]) delete idx[c];
      }
      // relatório com "Etapa/Insumo": a coluna Insumo traz o código da etapa
      if (idx.etapaCod === undefined && nomes[idx.etapaDs] === "descricao etapa insumo") {
        const i = nomes.indexOf("insumo");
        if (i >= 0) idx.etapaCod = i;
      }
      // "Responsável" é o código quando há a coluna "Nome" ao lado (relatório em colunas)
      if (idx.respNome !== undefined) idx.resp = idx.respNome;
      indices = idx;
      return;
    }
    const op = grupoDaLinha(l, "operacao");
    if (op) {
      opDaVez = op;
      return;
    }
    const etapa = grupoDaLinha(l, "etapa");
    if (etapa) {
      etapaDaVez = etapa;
      return;
    }
    const g = (c) => (indices[c] === undefined ? undefined : l[indices[c]]);
    const os = codigoOS(g("os"));
    const propCod = txt(g("propCod"));
    const letra = txt(g("letra"));
    const tlh = txt(g("tlh")) + (letra && /^[a-z]$/i.test(letra) ? letra.toUpperCase() : "");
    if (!os || !propCod || !tlh || normalizarTexto(os) === "codigo os" || normalizarTexto(os) === "os") return;
    lidas++;
    const opCod = txt(g("opCod")) || txt(g("opDs")) || opDaVez?.cod || "";
    if (!opCod) semOperacao++;
    const linha = {
      emp: txt(g("emp")) || empresaDoTopo,
      os,
      propCod,
      propNm: txt(g("propNm")),
      tlh,
      areaTlh: num(g("areaTlh")),
      areaRec: num(g("areaRec")),
      opCod,
      opDs: txt(g("opDs")) || (opCod && opCod === opDaVez?.cod ? opDaVez.ds : ""),
      etapaCod: txt(g("etapaCod")) || etapaDaVez?.cod || "",
      etapaDs: txt(g("etapaDs")) || etapaDaVez?.ds || "",
      tipoCod: txt(g("tipoCod")),
      tipoDs: txt(g("tipoDs")),
      resp: txt(g("resp")),
      // a posição às vezes vem só com a letra (A aberta, L liberada, E encerrada)
      status: POSICOES[txt(g("status")).toUpperCase()] ?? txt(g("status")),
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
    return {
      linhas: [],
      lidas: 0,
      ordens: 0,
      erro: "Não encontrei o cabeçalho da base de O.S. (colunas da O.S., da propriedade e do talhão) nas primeiras linhas da primeira aba.",
    };
  }
  const linhas = Array.from(porChave.values());
  if (linhas.length === 0) return { linhas, lidas, ordens: 0, erro: "Nenhuma linha de O.S. com propriedade e talhão encontrada." };
  const osSemOperacao = new Set(linhas.filter((l) => !l.opCod).map((l) => l.os)).size;
  return { linhas, lidas, ordens: new Set(linhas.map((l) => `${l.emp}|${l.os}`)).size, semOperacao, osSemOperacao };
}
