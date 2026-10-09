import { normalizarTexto } from "./cadastros-spec";
import { codigoOS, dataIso, num, txt } from "./import-os";
import { paraCadaLinha } from "./import-pesagem";

/**
 * Lê o "Relatório de Ordens de Serviço das Etapas" (uma linha por O.S. × talhão × operação). O cabeçalho é achado
 * pelos nomes das colunas; acima dele vêm a empresa (1ª linha) e o período do relatório.
 */
const CAMPOS = {
  emp: ["empresa", "codigo da empresa"],
  os: ["codigo da os", "os", "ordem de servico"],
  dtOs: ["data da os"],
  dtEnc: ["data de encerramento"],
  prevIni: ["previsao inicial"],
  prevFim: ["previsao final"],
  propCod: ["propriedade"],
  setor: ["setor"],
  propNm: ["fundo agricola"],
  tlh: ["codigo do talhao", "talhao"],
  letra: ["letra"],
  areaPlant: ["area plantada total", "area plantada"],
  areaRec: ["area recomendada total", "area recomendada"],
  opCod: ["operacao agricola"],
  opDs: ["descricao da operacao agricola"],
  etapaCod: ["etapa"],
  etapaDs: ["descricao da etapa"],
  ccCod: ["centro de custo"],
  ccDs: ["descricao do centro de custo"],
  safra: ["safra"],
  ciclo: ["ciclo"],
  posicao: ["posicao"],
  mesExec: ["mes de execucao"],
  anoExec: ["ano de execucao"],
  respCod: ["responsavel"],
  respNm: ["nome"],
  raio: ["raio"],
  usrOs: ["usuario que lancou a os"],
  obs: ["observacao da os", "observacao"],
};

const dataBR = (iso) => (iso ? iso.split("-").reverse().join("/") : "");
const inteiro = (v) => {
  const n = num(v);
  return n === null ? null : Math.round(n);
};

export async function lerOSAgr(buffer) {
  let idx = null;
  let n = 0;
  let emp = "";
  let periodo = "";
  let repetidas = 0;
  const porChave = new Map();

  const lerLinha = (l) => {
    n++;
    if (!idx) {
      if (n > 30) return;
      const nomes = l.map((c) => normalizarTexto(String(c ?? "")));
      // 1ª linha: "6 | CONDOMINIO AGRICOLA ..." (código da empresa)
      if (n === 1 && num(l[0]) !== null) emp = String(inteiro(l[0]));
      // "Data da OS : | 26/12/2025 | à | 31/12/2099"
      const iData = nomes.indexOf("data da os");
      if (iData >= 0 && nomes.indexOf("codigo da os") < 0) {
        const datas = l
          .slice(iData + 1)
          .map(dataIso)
          .filter(Boolean);
        if (datas.length >= 2) periodo = `${dataBR(datas[0])} a ${dataBR(datas[1])}`;
      }
      const achar = (alt) => {
        for (const a of alt) {
          const i = nomes.indexOf(a);
          if (i >= 0) return i;
        }
        return -1;
      };
      if (achar(CAMPOS.os) < 0 || achar(CAMPOS.tlh) < 0 || achar(CAMPOS.propCod) < 0 || achar(CAMPOS.opCod) < 0) return;
      const ind = {};
      for (const [campo, alt] of Object.entries(CAMPOS)) {
        const i = achar(alt);
        if (i >= 0) ind[campo] = i;
      }
      idx = ind;
      return;
    }
    const g = (c) => (idx[c] === undefined ? undefined : l[idx[c]]);
    const os = codigoOS(g("os"));
    const propCod = txt(g("propCod"));
    const tlh = txt(g("tlh"));
    if (!os || !propCod || !tlh || !/^\d+$/.test(os)) return;
    const linha = {
      emp: txt(g("emp")) || emp,
      os,
      dtOs: dataIso(g("dtOs")),
      dtEnc: dataIso(g("dtEnc")),
      prevIni: dataIso(g("prevIni")),
      prevFim: dataIso(g("prevFim")),
      propCod,
      setor: txt(g("setor")),
      // "9386 - FAZ. NOSSA SENHORA DE LOURDES" → só o nome
      propNm: txt(g("propNm")).replace(/^\d+\s*-\s*/, ""),
      tlh,
      letra: txt(g("letra")),
      areaPlant: num(g("areaPlant")),
      areaRec: num(g("areaRec")),
      opCod: txt(g("opCod")),
      opDs: txt(g("opDs")),
      etapaCod: txt(g("etapaCod")),
      etapaDs: txt(g("etapaDs")),
      ccCod: txt(g("ccCod")),
      ccDs: txt(g("ccDs")),
      safra: txt(g("safra")),
      ciclo: txt(g("ciclo")),
      posicao: txt(g("posicao")).toUpperCase().slice(0, 1),
      mesExec: inteiro(g("mesExec")),
      anoExec: inteiro(g("anoExec")),
      respCod: txt(g("respCod")),
      respNm: txt(g("respNm")),
      raio: txt(g("raio")),
      usrOs: txt(g("usrOs")),
      obs: txt(g("obs")).slice(0, 1000),
    };
    const chave = chaveLinhaOS(linha);
    if (porChave.has(chave)) repetidas++;
    else porChave.set(chave, linha);
  };

  try {
    await paraCadaLinha(buffer, lerLinha, false);
  } catch (e) {
    if (n > 0) throw e;
    await paraCadaLinha(buffer, lerLinha, true);
  }
  if (!idx) {
    return {
      linhas: [],
      ordens: 0,
      repetidas: 0,
      periodo,
      erro: 'Não encontrei o cabeçalho do Relatório de Ordens de Serviço (colunas "Código da OS", "Propriedade", "Código do Talhão" e "Operação Agrícola") nas primeiras linhas da primeira aba.',
    };
  }
  const linhas = [...porChave.values()];
  if (linhas.length === 0) return { linhas, ordens: 0, repetidas, periodo, erro: "Nenhuma linha de O.S. encontrada abaixo do cabeçalho." };
  return { linhas, ordens: new Set(linhas.map((x) => `${x.emp}|${x.os}`)).size, repetidas, periodo };
}

/** Identifica a linha dentro da base: O.S. × propriedade × setor × talhão × letra × operação. */
export const chaveLinhaOS = (l) => [l.emp, l.os, l.propCod, l.setor, l.tlh, l.letra, l.opCod].join("|");
