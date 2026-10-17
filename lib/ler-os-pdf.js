/**
 * Leitura do relatório "OS - Ordem de Serviço" do ERP em PDF (arsc0146j): uma O.S. por página (a O.S. longa continua nas
 * páginas seguintes, com o cabeçalho, as operações e a requisição repetidos e os talhões continuando). Cada página traz:
 *   cabeçalho  empresa, data, nº da O.S., etapa, safra/ciclo, encarregado (matrícula e nome), usuário de abertura,
 *              situação e produtor
 *   talhões    propriedade, fundo agrícola, talhão, variedade, área do talhão e área rateio (a área da O.S. no talhão)
 *   operações  código, descrição e quantidade, ao lado dos talhões, e a observação da O.S. embaixo delas
 *   requisição operação, produto, descrição, almoxarifado, unidade, quantidade por ha (a dose) e a quantidade total
 * Não traz previsão, encerramento nem valores. Roda no navegador (pdf.js) e no Node; não depende do banco.
 */

/** Situação da O.S. no relatório → posição na base (A, L, E). */
const POSICAO = { ABERTA: "A", LIBERADA: "L", ENCERRADA: "E" };

/** "1.007,26" → 1007.26; o que não é número → null. */
export function numeroBR(s) {
  const t = String(s ?? "").trim();
  if (!/^-?[\d.]*\d(,\d+)?$/.test(t)) return null;
  return Number(t.replace(/\./g, "").replace(",", "."));
}

const semZeros = (s) => String(s ?? "").trim().replace(/^0+(?=\d)/, "");
const dataIso = (br) => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(br ?? "").trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};
const texto = (cs) =>
  cs
    .map((c) => c.t)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Itens de texto da página (pdf.js) → palavras { t, x0, x1, y } (y de cima para baixo). O pdf.js às vezes junta células
 * vizinhas num item só ("14324 2399532 PROTAC"); a posição de cada palavra sai da largura média do caractere do item —
 * exata nos talhões e nas operações, que vêm em fonte de largura fixa.
 */
function palavras(itens, altura) {
  const out = [];
  for (const it of itens) {
    if (typeof it.str !== "string" || !it.str.trim()) continue;
    const x = it.transform[4];
    const cw = it.str.length ? it.width / it.str.length : 0;
    const y = altura - it.transform[5];
    for (const m of it.str.matchAll(/\S+/g)) out.push({ t: m[0], x0: x + m.index * cw, x1: x + (m.index + m[0].length) * cw, y });
  }
  return out;
}

/** Células em linhas: a mesma altura (até 2,5 pt de diferença) é a mesma linha; cada linha da esquerda para a direita. */
function linhas(cels) {
  const ord = [...cels].sort((a, b) => a.y - b.y || a.x0 - b.x0);
  const out = [];
  for (const c of ord) {
    const ult = out[out.length - 1];
    if (ult && c.y - ult.yUlt <= 2.5) {
      ult.cs.push(c);
      ult.yUlt = c.y;
    } else out.push({ y: c.y, yUlt: c.y, cs: [c] });
  }
  for (const l of out) l.cs.sort((a, b) => a.x0 - b.x0);
  return out;
}

const achar = (cs, re) => cs.find((c) => re.test(c.t));

/**
 * Uma página do relatório. Devolve null quando a página não é de O.S. (sem o nº da O.S. ou sem a tabela de talhões) e
 * `erro` quando o layout não é o esperado.
 */
export function lerPagina(itens, altura) {
  const ls = linhas(palavras(itens, altura));
  const cab = {};
  for (const l of ls) {
    const t = texto(l.cs);
    let m;
    if ((m = /Data \.\.:\s*(\d\d\/\d\d\/\d{4})\s+OS \.:\s*(\d+)/.exec(t))) {
      cab.dt = dataIso(m[1]);
      cab.os = semZeros(m[2]);
      cab.emp = semZeros(/^(\d+)\s/.exec(t)?.[1] ?? "");
    }
    if ((m = /Etapa \.:\s*(\d+)\s+(.*)$/.exec(t))) {
      cab.etapaCod = m[1];
      cab.etapaDs = m[2].trim();
    }
    if ((m = /Safra\/Ciclo \.:\s*(\d+)\s*\/\s*(\d+)\s+P.gina \.:\s*(\d+)/.exec(t))) {
      cab.safra = m[1];
      cab.ciclo = m[2];
      cab.pagina = Number(m[3]);
    }
    if ((m = /Encarregado:\s*(\d*)\s*Nome\.\.:\s*(.*)$/.exec(t))) {
      cab.respCod = semZeros(m[1]) === "0" ? "" : semZeros(m[1]);
      cab.respNm = m[2].trim();
    }
    if ((m = /Abertura:\s*(.*?)\s*Situa..o:\s*(\S+)/.exec(t))) {
      cab.usr = m[1].trim();
      cab.situacao = m[2].trim();
    }
    if ((m = /Produtor :\s*(\d*)\s*(.*)$/.exec(t))) {
      cab.prdrCod = semZeros(m[1]);
      cab.prdrNm = m[2].trim();
    }
  }
  if (!cab.os) return null;
  const iTab = ls.findIndex((l) => l.cs.some((c) => c.t === "Propriedade"));
  const iReq = ls.findIndex((l) => l.cs.some((c) => /^REQUISI/.test(c.t)));
  if (iTab < 0 || iReq < 0 || iReq < iTab) return { ...cab, erro: "página sem a tabela de talhões ou sem a requisição de produtos" };

  // colunas pelo cabeçalho da tabela de talhões
  const h = ls[iTab].cs;
  const iRateio = h.findIndex((c) => c.t === "Rateio");
  const col = {
    fundo: achar(h, /^Fundo/)?.x0,
    // o talhão vem alinhado à direita, no fim do título
    tlh: achar(h, /^Talh/)?.x1,
    vari: achar(h, /^Variedade/)?.x0,
    area: h.find((c, i) => c.t === "Area" && h[i + 1]?.t !== "Rateio")?.x1,
    rateio: iRateio >= 0 ? h[iRateio].x1 : undefined,
    op: achar(h, /^Opera/)?.x0,
    qtd: achar(h, /^Quantidade/)?.x0,
  };
  if (Object.values(col).some((v) => v === undefined)) return { ...cab, erro: "cabeçalho da tabela de talhões fora do padrão" };
  const meioArea = (col.area + col.rateio) / 2;

  const talhoes = [];
  const ops = [];
  const obs = [];
  let totais = null;
  let emObs = false;
  for (const l of ls.slice(iTab + 1, iReq)) {
    const esq = l.cs.filter((c) => c.x0 < col.op - 3);
    const dir = l.cs.filter((c) => c.x0 >= col.op - 3);
    if (esq.length) {
      if (/^Total/.test(esq[0].t) || esq.some((c) => c.t === "Total")) {
        const ns = esq.map((c) => numeroBR(c.t)).filter((n) => n !== null);
        totais = { area: ns[0] ?? null, rateio: ns[1] ?? null };
      } else {
        // propriedade e talhão alinhados à direita; o nome do fundo agrícola longo invade a coluna do talhão
        // ("…DALLAS II" + "12"): o talhão é a palavra que termina no fim da coluna
        const prop = esq.filter((c) => c.x1 <= col.fundo - 1);
        const tlh = esq.find((c) => c.x0 > col.fundo + 3 && Math.abs(c.x1 - col.tlh) <= 2.5 && /^[0-9A-Z]{1,6}$/.test(c.t));
        const fundo = esq.filter((c) => c !== tlh && c.x0 >= col.fundo - 2 && c.x1 < col.vari - 2);
        const vari = esq.filter((c) => c.x0 >= col.vari - 2 && c.x0 < col.area - 25);
        const nums = esq.filter((c) => c.x0 >= col.area - 25 && numeroBR(c.t) !== null);
        const area = nums.find((c) => c.x1 <= meioArea);
        const rateio = nums.find((c) => c.x1 > meioArea);
        // linha da fazenda sem talhão (e sem área): é o talhão "0", como no relatório em planilha
        if (prop.length && (tlh || fundo.length)) {
          talhoes.push({
            prop: semZeros(texto(prop)),
            // "9325 - LARGO DOS BAÚS" → só o nome
            fundo: texto(fundo).replace(/^\d+\s*-\s*/, "").trim(),
            tlh: tlh ? semZeros(tlh.t).toUpperCase() : "0",
            vari: texto(vari),
            area: area ? numeroBR(area.t) : null,
            rateio: rateio ? numeroBR(rateio.t) : null,
          });
        }
      }
    }
    if (dir.length) {
      const td = texto(dir);
      if (/^Obs \.:/.test(td)) {
        emObs = true;
        const resto = td.replace(/^Obs \.:\s*/, "");
        if (resto) obs.push(resto);
        continue;
      }
      if (emObs) {
        obs.push(td);
        continue;
      }
      if (/^Total/.test(td)) continue;
      const qtdCel = dir.find((c) => c.x0 >= col.qtd - 5 && numeroBR(c.t) !== null);
      const resto = dir.filter((c) => c !== qtdCel);
      const tr = texto(resto);
      const m = /^(\d{3,6})\s*(.*)$/.exec(tr);
      if (m) ops.push({ cod: m[1], ds: m[2].trim(), qtd: qtdCel ? numeroBR(qtdCel.t) : null });
      else if (ops.length) {
        const o = ops[ops.length - 1];
        if (tr) o.ds = `${o.ds} ${tr}`.trim();
        if (qtdCel && o.qtd === null) o.qtd = numeroBR(qtdCel.t);
      }
    }
  }

  // requisição de produtos: operação, produto e descrição até o almoxarifado; dali, código e nome do almoxarifado,
  // unidade, quantidade por ha e quantidade total — pela sequência dos campos (a fonte não tem largura fixa)
  const hr = ls[iReq + 1]?.cs ?? [];
  const xAlmox = achar(hr, /^Almox/)?.x0;
  const xHa = hr.find((c, i) => c.t === "HA" && hr[i - 1]?.t === "Qtde")?.x1;
  const xTotal = hr.find((c, i) => c.t === "Qtde" && hr[i + 1]?.t === "Total")?.x0;
  if (xAlmox === undefined) return { ...cab, erro: "cabeçalho da requisição de produtos fora do padrão" };
  const meioQtd = xHa !== undefined && xTotal !== undefined ? (xHa + xTotal) / 2 : null;
  const req = [];
  let reqTotal = null;
  for (const l of ls.slice(iReq + 2)) {
    const cs = l.cs;
    if (cs.some((c) => /^Total/.test(c.t))) {
      const n = cs.filter((c) => numeroBR(c.t) !== null).pop();
      reqTotal = n ? numeroBR(n.t) : null;
      break;
    }
    const antes = cs.filter((c) => c.x0 < xAlmox - 3);
    const depois = cs.filter((c) => c.x0 >= xAlmox - 3);
    const ma = /^(\d+)\s+(\d+)\s*(.*)$/.exec(texto(antes));
    if (!ma) continue;
    // do fim para o começo: total, dose (quando há), unidade; o resto é o almoxarifado
    const ws = [...depois];
    const qtdW = ws.length && numeroBR(ws[ws.length - 1].t) !== null ? ws.pop() : null;
    const doseW = ws.length && numeroBR(ws[ws.length - 1].t) !== null ? ws.pop() : null;
    // um número só: pela posição, é a dose ou o total
    const soDose = qtdW && !doseW && meioQtd !== null && qtdW.x1 <= meioQtd;
    const unW = ws.length > 1 && /^[A-Z]{1,4}$/.test(ws[ws.length - 1].t) ? ws.pop() : null;
    const am = /^(\d+)\s*(.*)$/.exec(texto(ws));
    req.push({
      op: ma[1],
      prod: semZeros(ma[2]),
      ds: ma[3].trim(),
      almoxCod: am ? am[1] : "",
      almoxNm: am ? am[2].trim() : texto(ws),
      un: unW?.t ?? "",
      dose: soDose ? numeroBR(qtdW.t) : doseW ? numeroBR(doseW.t) : null,
      qtd: soDose ? null : qtdW ? numeroBR(qtdW.t) : null,
    });
  }
  return { ...cab, talhoes, ops, obs, totais, req, reqTotal };
}

/** "VAZÃO : 150" / "VOLUME CALDA : 6.000,00" da observação. */
function valorDaObs(obs, re) {
  const m = re.exec(obs);
  return m ? numeroBR(m[1].replace(/[.,]$/, "")) : null;
}

/**
 * Junta as páginas por O.S. (empresa + nº): talhões das páginas em sequência, operações e requisição sem repetir,
 * observação da 1ª página e os totais da última. Confere os totais do relatório e devolve os avisos.
 */
export function juntarPaginas(paginas) {
  const ordens = new Map();
  const avisos = [];
  for (const { n, p } of paginas) {
    if (!p) continue;
    if (p.erro) {
      avisos.push(`Página ${n}${p.os ? ` (O.S. ${p.os})` : ""}: ${p.erro}.`);
      continue;
    }
    const k = `${p.emp}|${p.os}`;
    let o = ordens.get(k);
    if (!o) {
      o = {
        emp: p.emp,
        os: p.os,
        dt: p.dt,
        etapaCod: p.etapaCod ?? "",
        etapaDs: p.etapaDs ?? "",
        safra: p.safra ?? "",
        ciclo: p.ciclo ?? "",
        respCod: p.respCod ?? "",
        respNm: p.respNm ?? "",
        usr: p.usr ?? "",
        situacao: p.situacao ?? "",
        posicao: POSICAO[(p.situacao ?? "").toUpperCase()] ?? (p.situacao ?? "").slice(0, 1).toUpperCase(),
        prdrCod: p.prdrCod ?? "",
        prdrNm: p.prdrNm ?? "",
        obs: p.obs.join("\n"),
        talhoes: [],
        ops: [],
        req: [],
        totais: null,
        reqTotal: null,
        paginas: 0,
      };
      ordens.set(k, o);
    }
    o.paginas++;
    const vistos = new Set(o.talhoes.map((t) => `${t.prop}|${t.tlh}`));
    for (const t of p.talhoes) {
      const kt = `${t.prop}|${t.tlh}`;
      if (vistos.has(kt)) avisos.push(`O.S. ${p.os}: talhão ${t.prop}/${t.tlh} repetido no relatório (ficou o primeiro).`);
      else {
        vistos.add(kt);
        o.talhoes.push(t);
      }
    }
    for (const op of p.ops) if (!o.ops.some((x) => x.cod === op.cod)) o.ops.push(op);
    for (const r of p.req) if (!o.req.some((x) => x.op === r.op && x.prod === r.prod && x.almoxCod === r.almoxCod)) o.req.push(r);
    if (p.totais) o.totais = p.totais;
    if (p.reqTotal !== null) o.reqTotal = p.reqTotal;
  }
  const r2 = (n) => Math.round(n * 100) / 100;
  for (const o of ordens.values()) {
    // "VAZÃO : 150", "VAZÃO 150LT/HA"; "VOLUME CALDA : 6.589,40", "CALDA 2.148,00LTS"
    o.vazao = valorDaObs(o.obs, /VAZ[ÃA]O\s*:?\s*(\d[\d.,]*)/i);
    o.volCalda = valorDaObs(o.obs, /CALDA\s*:?\s*(\d[\d.,]*)/i);
    if (o.talhoes.length === 0) avisos.push(`O.S. ${o.os}: sem talhões no relatório.`);
    if (o.ops.length === 0) avisos.push(`O.S. ${o.os}: sem operação no relatório.`);
    if (o.totais) {
      const sa = r2(o.talhoes.reduce((s, t) => s + (t.area ?? 0), 0));
      const sr = r2(o.talhoes.reduce((s, t) => s + (t.rateio ?? 0), 0));
      if ((o.totais.area !== null && Math.abs(sa - o.totais.area) > 0.02) || (o.totais.rateio !== null && Math.abs(sr - o.totais.rateio) > 0.02)) {
        avisos.push(`O.S. ${o.os}: a soma dos talhões (${sa} / ${sr} ha) não bate com o total do relatório (${o.totais.area} / ${o.totais.rateio} ha).`);
      }
    }
    for (const r of o.req) if (!o.ops.some((x) => x.cod === r.op)) avisos.push(`O.S. ${o.os}: produto ${r.prod} da operação ${r.op}, que não está na O.S.`);
  }
  return { ordens: [...ordens.values()], avisos };
}

/** "D:20261017122515-03'00'" → "2026-10-17" (a data em que o relatório foi emitido). */
export function dataDoPdf(d) {
  const m = /^D:(\d{4})(\d{2})(\d{2})/.exec(String(d ?? ""));
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/**
 * Lê o relatório inteiro de um documento do pdf.js. `aoProgresso(pagina, total)` a cada página (se devolver uma promessa,
 * a leitura espera). Devolve as O.S., a data de emissão do relatório (null quando o PDF não informa), o nº de páginas e
 * os avisos de leitura.
 */
export async function lerOSPdf(doc, aoProgresso) {
  const paginas = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const pg = await doc.getPage(n);
    const { height } = pg.getViewport({ scale: 1 });
    const tc = await pg.getTextContent();
    paginas.push({ n, p: lerPagina(tc.items, height) });
    pg.cleanup();
    // a tela pode pedir uma pausa (devolve uma promessa) para desenhar a barra de progresso
    await aoProgresso?.(n, doc.numPages);
  }
  const { ordens, avisos } = juntarPaginas(paginas);
  let geradoEm = null;
  try {
    geradoEm = dataDoPdf((await doc.getMetadata())?.info?.CreationDate);
  } catch {
    /* sem metadados: a data fica a do dia da importação */
  }
  return { ordens, geradoEm, paginas: doc.numPages, avisos };
}
