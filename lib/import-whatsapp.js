/**
 * Leitura da conversa exportada do WhatsApp (grupo C.A.P.F.O) para Apontamento das Atividades Diárias.
 *
 * Cada mensagem de produção vira um ou mais apontamentos (um por atividade da mensagem), com a data da operação escrita
 * no texto — a produção de um dia sai à tarde ou no dia seguinte, então a data da mensagem não serve. Sem data no texto,
 * vale o dia anterior (mensagem até o meio-dia) ou o próprio dia (à tarde), com aviso.
 */

const LIMPAR_INVISIVEIS = /[‎‏‪-‮⁦-⁩﻿]/g;

/** Separa a conversa exportada em mensagens (formato iPhone "[dd/mm/aaaa, hh:mm:ss] Nome: texto" e Android "dd/mm/aaaa hh:mm - Nome: texto"). */
export function lerMensagens(conversa) {
  const linhas = conversa.replace(/\r\n?/g, "\n").split("\n");
  // a hora guarda os segundos: duas mensagens no mesmo minuto continuam diferentes
  const ios = /^\[(\d{2})\/(\d{2})\/(\d{4}),? (\d{2}:\d{2}(?::\d{2})?)\] ([^:]+?): ?(.*)$/;
  const android = /^(\d{2})\/(\d{2})\/(\d{4}),? (\d{2}:\d{2}) - ([^:]+?): ?(.*)$/;
  const msgs = [];
  for (const bruta of linhas) {
    const l = bruta.replace(LIMPAR_INVISIVEIS, "");
    const m = l.match(ios) ?? l.match(android);
    if (m) msgs.push({ data: `${m[3]}-${m[2]}-${m[1]}`, hora: m[4], remetente: m[5].replace(/^~\s*/, "").trim(), texto: m[6] });
    else if (msgs.length) msgs[msgs.length - 1].texto += `\n${l}`;
  }
  return msgs;
}

const semAcento = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Número escrito à mão: "1.234,56", "18.747,00", "10.14", "3..37", "02.500,00". `milhar`: "1,900" / "1.500" de litros = milhar. */
export function numeroBr(s, milhar = false) {
  let t = s
    .trim()
    .replace(/\s/g, "")
    .replace(/\.{2,}/g, ".");
  if (!/\d/.test(t)) return null;
  t = t.replace(/[^\d.,]/g, "");
  if (t.includes(",") && t.includes(".")) t = t.lastIndexOf(",") > t.lastIndexOf(".") ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  else if (t.includes(",")) t = milhar && /,\d{3}$/.test(t) ? t.replace(",", "") : t.replace(",", ".");
  else if (milhar && /^\d{1,3}\.\d{3}$/.test(t)) t = t.replace(".", "");
  else if ((t.match(/\./g) ?? []).length > 1) t = t.replace(/\.(?=.*\.)/g, "");
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const r2 = (n) => Math.round(n * 100) / 100;

/** Categoria da atividade (o de-para de operação é por ela). */
export function categoriaAtividade(texto) {
  const t = semAcento(texto);
  if (/formig|profog/.test(t)) return "Controle de formiga";
  if (/colheitabilidade/.test(t)) return "Colheitabilidade";
  if (/retampa/.test(t)) return "Retampa";
  if (/replanta/.test(t)) return "Replanta";
  if (/arranc\w* de capim/.test(t)) return "Arranca de capim";
  if (/carpina/.test(t)) return "Carpina";
  if (/aceir/.test(t)) return "Aceiro";
  if (/corte de cana manual/.test(t)) return "Corte de cana manual";
  if (/dessecac/.test(t)) return "Dessecação";
  if (/carreador|mangueirao/.test(t)) return "Aplicação em carreadores";
  if (/pingente/.test(t)) return "Aplicação de pingente";
  if (/quadriciclo/.test(t) && !/adub/.test(t)) return "Catação química";
  if (/cata\W{0,3}mato/.test(t)) return "Cata-mato";
  if (/quebra.?lombo/.test(t)) return "Quebra-lombo";
  if (/adubac|adubo/.test(t)) return /cocho/.test(t) ? "Adubação cocho" : "Adubação de socaria";
  if (/glifosato/.test(t)) return "Aplicação de glifosato";
  if (/cata.?mato/.test(t)) return "Cata-mato";
  if (/catac/.test(t)) return "Catação química";
  if (/drone|aere/.test(t) && /insetic/.test(t)) return "Inseticida via drone";
  if (/insetic/.test(t)) return "Inseticida";
  if (/terceira molecula|3.? molecula/.test(t)) return "Herbicida terceira molécula";
  if (/pre.?emerg/.test(t)) return "Herbicida pré-emergência";
  if (/pos.?(colheita|emerg)/.test(t)) return "Herbicida pós-emergência";
  if (/herbic|barra total/.test(t)) return "Herbicida barra total";
  if (/bordadura/.test(t)) return "Bordadura";
  if (/roco|rocada|rocadeira/.test(t)) return "Roçada";
  if (/muda/.test(t)) return "Colheita de mudas";
  if (/plantio/.test(t)) return "Plantio";
  if (/treinamento/.test(t)) return "Treinamento";
  return "Outras atividades";
}

/** Data escrita no texto: "07/10/2026", "07/ 10/ 26", "30/09 /26", "01/10-2026", "04/05", "05.10.2026". */
function dataNoTexto(texto, anoMsg) {
  const re = /(?<!\d)(\d{1,2})\s*[/.\-]\s*(\d{1,2})(?:\s*[/.\-]\s*(\d{2,4}))?(?!\d)/g;
  for (const m of texto.matchAll(re)) {
    const d = Number(m[1]);
    const mes = Number(m[2]);
    if (d < 1 || d > 31 || mes < 1 || mes > 12) continue;
    // "T-01=17.30" e números de área não são data: só aceita com ano ou em linha que parece de data
    const linha = texto.slice(texto.lastIndexOf("\n", m.index) + 1, texto.indexOf("\n", m.index) === -1 ? undefined : texto.indexOf("\n", m.index));
    let ano = m[3] ? Number(m[3]) : NaN;
    if (!m[3] && !/data|dia|^\s*\d{1,2}\s*\/\s*\d{1,2}\s*$|produ|\(|drone|farmtec|f[aá]bio|alencar/i.test(linha)) continue;
    if (!m[3] && m[0].includes(".")) continue;
    if (Number.isNaN(ano)) ano = anoMsg;
    else if (ano < 100) ano += 2000;
    // ano digitado errado ("30/ 09 /36"): vale o ano da mensagem
    if (Math.abs(ano - anoMsg) > 1) ano = anoMsg;
    return `${ano}-${String(mes).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  return null;
}

const addDias = (iso, n) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const RE_FAZ_LINHA = /(?:fazenda|faz)\b[^\n\d]{0,40}?(9\d{3})/i;
const RE_TALHAO =
  /^\s*(?:talh[aã]o|lote|tl|t)?\s*[-=.:]*\s*(\d{1,3}[a-z]?)\s*[.=:\-]*\s*(?:=|:|\s{2,}|\s(?=\d))\s*(\d{1,3}(?:\s*[.,]{1,2}\s*\d{1,2})?)\s*(?:ha|h[aá]|hc|hectares?)?\.?\s*$/i;
const RE_CARR = /^\s*carr\w*\s*[=:]\s*([\d.,]+)/i;

/** Lê as mensagens de produção da conversa (a partir de `desde`, pela data da operação). */
export function extrairApontamentos(mensagens, desde = "") {
  const res = [];
  const vistas = new Set();
  for (const msg of mensagens) {
    const texto = msg.texto.replace(/\*/g, "").trim();
    const norm = semAcento(texto);
    if (!/9\d{3}/.test(texto)) continue;
    if (/omitid|ocultad|mensagem apagada|\.pdf/.test(norm) && texto.length < 200) continue;
    // precisa ter área: talhão = área, "ha", "realizado", "área:", "total"
    if (!/(\d\s*(ha|h[aá]|hc|hectare))|realiz|area\s*:|total|=\s*\d/i.test(norm)) continue;

    const anoMsg = Number(msg.data.slice(0, 4));
    const dtTexto = dataNoTexto(texto, anoMsg);
    const dt = dtTexto ?? (msg.hora < "12:00" ? addDias(msg.data, -1) : msg.data);
    // a operação não pode ser depois da mensagem
    const dtFinal = dt > msg.data ? msg.data : dt;
    if (desde && dtFinal < desde) continue;

    let anterior = null;
    for (const [bi, bloco] of dividirBlocos(texto).entries()) {
      const a = lerBloco(bloco, texto, anterior);
      if (!a) continue;
      anterior = { atividade: a.atividade, categoria: a.categoria };
      if (a.talhoes.length === 0) continue;
      const avisos = [...a.avisos];
      if (!dtTexto) avisos.push(`Sem data no texto: usada ${dtFinal.split("-").reverse().join("/")} (pela hora da mensagem).`);
      if (dt > msg.data) avisos.push("Data do texto depois da mensagem: usada a data da mensagem.");
      // mensagem enviada em dobro (mesmo remetente, mesmo segundo, mesmo texto) entra uma vez
      const chave = `${msg.data} ${msg.hora}|${semAcento(msg.remetente)
        .replace(/[^a-z0-9]/g, "")
        .slice(0, 20)}|${semAcento(texto)
        .replace(/[^a-z0-9]/g, "")
        .slice(0, 60)}|${texto.length}|${bi}`;
      if (vistas.has(chave)) continue;
      vistas.add(chave);
      const area = r2(a.talhoes.reduce((s, t) => s + t.area, 0));
      // confere: algum total escrito (ou a soma dos totais por fazenda) bate com a soma dos talhões
      const { totais, ...lido } = a;
      const perto = (v) => Math.abs(v - area) <= 0.05;
      const somaTotais = r2(totais.reduce((s, v) => s + v, 0));
      const bate = totais.find(perto) ?? (totais.length > 1 && perto(somaTotais) ? somaTotais : undefined);
      const totalInformado = bate ?? a.totalInformado;
      if (totalInformado !== null && bate === undefined) {
        // total escrito por fazenda que bate com os talhões dela também vale; avisa só os que não batem com nada
        const somaFaz = [...new Set(a.talhoes.map((t) => t.faz))].map((f) => r2(a.talhoes.filter((t) => t.faz === f).reduce((s, t) => s + t.area, 0)));
        const naoBatem = totais.filter((t) => !somaFaz.some((sf) => Math.abs(sf - t) <= 0.05));
        if (naoBatem.length)
          avisos.push(
            `Total escrito ${naoBatem.map((t) => `${t.toLocaleString("pt-BR")} ha`).join(", ")} não bate com a soma dos talhões (${area.toLocaleString("pt-BR")} ha lançados).`,
          );
      }
      res.push({
        ...lido,
        totalInformado,
        chave,
        dt: dtFinal,
        dtDaMensagem: !dtTexto,
        msgEm: `${msg.data} ${msg.hora}`,
        remetente: msg.remetente,
        area,
        avisos,
        texto,
      });
    }
  }
  return res;
}

/** Uma mensagem pode ter mais de uma atividade ("Aplicação glifosato", "Quadriciclo rodando" no meio do texto). */
function dividirBlocos(texto) {
  const linhas = texto.split("\n");
  const blocos = [[]];
  linhas.forEach((l, i) => {
    const n = semAcento(l).trim();
    const novo =
      i > 3 && (/^aplicacao\b/.test(n) || /^quadriciclo\b/.test(n)) && blocos[blocos.length - 1].some((x) => RE_TALHAO.test(x) || /area\s*:/i.test(x));
    if (novo) blocos.push([]);
    blocos[blocos.length - 1].push(l);
  });
  return blocos.map((b) => b.join("\n"));
}

function lerBloco(bloco, mensagem, anterior) {
  const linhas = bloco.split("\n").map((l) => l.replace(LIMPAR_INVISIVEIS, ""));
  const avisos = [];
  // ---------- cabeçalho (atividade)
  const cab = [];
  for (const l of linhas) {
    // "Bom dia produção Aplicação de inseticida…": tira o cumprimento e fica com o resto
    const t = l
      .replace(/[-‐_=]{3,}/g, "")
      .replace(/^\s*(bom dia|boa tarde|boa noite)[,.!]*\s*/i, "")
      .replace(/^\s*produ[cç][aã]o di[aá]ria\.?\s*$/i, "")
      .trim();
    if (!t || /^ok\b/i.test(t)) continue;
    // "Adubação zona 3 fazenda 9475": o que vem antes da fazenda é a atividade
    if (RE_FAZ_LINHA.test(t) || RE_TALHAO.test(t) || /^9\d{3}$/.test(t)) {
      const antes = t.split(/\b(?:fazenda|faz)\b/i)[0].trim();
      if (!cab.length && antes.length > 3 && !/^\d/.test(antes)) cab.push(antes);
      break;
    }
    if (
      /^\s*(data|os\b|o\.s|vaz|real|c\.?\s*gasta|calda|status|estatus|total|frota|prestador|opera[cç][aã]o\s*:|turma|dose|produto|talh|conclu|n[aã]o conclu)/i.test(
        t,
      )
    )
      continue;
    if (/^\d{1,2}\s*[/.\-]\s*\d{1,2}/.test(t) && t.length < 14) continue;
    cab.push(
      t
        .replace(/^(atividade|atv|ativ)\s*[;:=]\s*/i, "")
        .replace(/[🧪✅❌👇]/gu, "")
        .trim(),
    );
    if (cab.join(" ").length > 70) break;
  }
  const atvLinha = linhas.find((l) => /^\s*(atividade|atv|ativ)\s*[;:=]/i.test(l));
  const atividade = (atvLinha ? atvLinha.replace(/^\s*(atividade|atv|ativ)\s*[;:=]\s*/i, "") : cab.join(" "))
    .replace(/[🧪✅❌👇*]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  // a atividade escrita ("Atv; Catação química") vale sobre o nome da turma; bloco sem atividade própria ("Quadriciclo rodando") herda a do anterior
  let categoria = categoriaAtividade(atvLinha ? atividade : `${atividade} ${cab.join(" ")}`);
  let atividadeFinal = atividade;
  if (anterior && !atvLinha && (categoria === "Outras atividades" || /^quadriciclo/i.test(atividade))) {
    categoria = anterior.categoria;
    atividadeFinal = `${anterior.atividade} (${atividade})`.slice(0, 120);
  }
  if (categoria === "Treinamento") return null;

  // ---------- campos
  const achar = (re, alvo = bloco) => alvo.match(re)?.[1]?.trim() ?? "";
  // "Operação: 24003" ou o código no início da atividade ("Ativ;5045 Colheitabilidade", "2049 - retampa")
  const opCod = achar(/opera[cç][aã]o\s*:\s*(\d{4,6})\b/i) || (atividade.match(/^(\d{4,5})\s*[-–;=]?\s*[a-zà-ú]/i)?.[1] ?? "");
  const osTxt = achar(/\bO\.?\s*S\.*\s*[:.]*\s*((?:\d{3,5})(?:\s*(?:e|\/|,)\s*\d{3,5})*)/i);
  const os = osTxt ? osTxt.split(/\s*(?:e|\/|,)\s*/).filter(Boolean) : [];
  const frota = achar(/frota\s*[.:]*\s*(\d{4,6})/i);
  const prestador = achar(/prestador\s*:\s*([^\n]+)/i);
  // equipe: turma / zona / terceiro (da mensagem inteira, vale para todos os blocos) e a máquina do bloco
  const turma = achar(/(turma[^\n]*)/i, mensagem) || achar(/^([^\n]*\(\s*cata mato[^\n]*\))/im, mensagem) || achar(/\b(zona\s*\d+)/i, mensagem);
  const terceiro = achar(/\b(fhd agro|jp agro|farmtec|profog)\b/i, mensagem);
  const maquina = /quadriciclo/i.test(bloco) ? "Quadriciclo" : /uniport/i.test(bloco) ? "Uniport" : /drone/i.test(mensagem) ? "Drone" : "";
  const equipe = [turma, prestador, terceiro, maquina].filter(Boolean).join(" · ").replace(/\s+/g, " ").slice(0, 80);
  const vazao = numeroBr(achar(/vaz[aã]o\s*[.:=]*\s*([\d.,]+)/i));
  let calda = null;
  const caldaTotal = achar(/calda\s+total\s*[=:]?\s*([\d.,]+)/i);
  if (caldaTotal) calda = numeroBr(caldaTotal, true);
  else {
    const valores = [...bloco.matchAll(/(?:c\.?\s*gasta|calda(?:\s+gast[ao])?|produto\s+gasto|total\s+de\s+calda)\s*[-=:.]*\s*([\d.,]+)/gi)].map((m) =>
      numeroBr(m[1], true),
    );
    const lt = [...bloco.matchAll(/([\d.,]+)\s*litros\s+de\s+calda/gi)].map((m) => numeroBr(m[1], true));
    const todos = [...valores, ...lt].filter((v) => v !== null);
    if (todos.length) calda = r2(todos.reduce((s, v) => s + v, 0));
  }
  // "Pessoas em atividade" sem número na linha: soma das linhas "2 auxiliar operando / 4 operadores / 12 aplicando"
  const somaPessoas = [...bloco.matchAll(/(?:^|\n)[ \t]*(\d+)[ \t]*-?[ \t]*(?:auxiliar|operador|aplicando|pessoas aplicando)/gi)].reduce(
    (s, m) => s + Number(m[1]),
    0,
  );
  const pessoas =
    numeroBr(achar(/pessoas[ \t]+em[ \t]+atividade[ \t]*[=:]?[ \t]*(\d+)/i)) ??
    (somaPessoas || null) ??
    numeroBr(achar(/total\s+de\s+pessoas\s*[=:]\s*(\d+)/i)) ??
    numeroBr(achar(/colaboradores\s*:\s*(\d+)/i)) ??
    numeroBr(achar(/(\d+)\s*-?\s*colaboradores/i)) ??
    0;
  const nEqp =
    numeroBr(achar(/(?:tratores|quadriciclo)\s+rodando\s*[=:]?\s*(\d+)/i)) ??
    numeroBr(achar(/(\d+)\s*-\s*tratores/i)) ??
    numeroBr(achar(/total de trator\.?\s*(\d+)/i)) ??
    0;
  const statusOs = achar(/(?:e?status\s+da\s+o\.?s\.?|os\s*:)\s*[:.]*\s*\n?\s*((?:n[aã]o\s+)?conclu[ií]da|finalizada|manter aberta|aberta)/i).toUpperCase();
  // todos os totais escritos (o que vale é escolhido depois, contra a soma dos talhões)
  const totais = [
    ...bloco.matchAll(/(?:^|\n)[ \t]*total(?:[ \t]+(?:realizado|geral|da opera[cç][aã]o|de [aá]ria|de hequitare))?[ \t.]*[=:\-]?[ \t]*(\d[\d.,]*)/gi),
    ...bloco.matchAll(/real(?:izado|izad)?[ \t]*[.:]*[ \t]*(\d[\d.,]*)[ \t]*(?:ha|h[aá]|hc)/gi),
  ]
    .map((m) => numeroBr(m[1]))
    .filter((v) => v !== null && v > 0);
  const totalInformado = totais.length ? totais[totais.length - 1] : null;

  // ---------- fazendas e talhões
  const talhoes = [];
  let faz = "";
  const fazDaLinha = (l) => {
    const lista = l.match(/(?:fazenda|faz)\b[^\n]*/i)?.[0] ?? "";
    const codigos = lista.match(/\b9\d{3}\b/g) ?? [];
    return codigos;
  };
  const fazendasCitadas = [];
  const areaSoltaPorFaz = new Map();
  for (const l of linhas) {
    const t = l.trim();
    const n = semAcento(t);
    const cods = fazDaLinha(t);
    // linhas só com o código ("9010") depois de "Faz :" ou "Faz 9503" (drone)
    const soCodigo = /^9\d{3}$/.test(t) ? [t] : [];
    const encontrados = cods.length ? cods : soCodigo;
    if (encontrados.length) {
      faz = encontrados[0];
      for (const c of encontrados) if (!fazendasCitadas.includes(c)) fazendasCitadas.push(c);
      // "Faz 9397 - 13,3 ha" / "Faz 9413 21,80 ha": área da fazenda na mesma linha
      const resto = t.slice(t.indexOf(encontrados[encontrados.length - 1]) + 4);
      const a = resto.match(/^\s*[-–:]?\s*([\d.,]+)\s*(?:ha|h[aá])/i);
      if (a && encontrados.length === 1) areaSoltaPorFaz.set(faz, numeroBr(a[1]) ?? 0);
      continue;
    }
    if (!faz) continue;
    if (/^total|^m[eé]dia|di[aá]ria|^calda|^produto|^vaz|^dose|^bag|^beg|^\d+\s*beg|formigueiro|pessoa|operador|aplicando|auxili/.test(n)) continue;
    const carr = t.match(RE_CARR);
    if (carr) {
      talhoes.push({ faz, tlh: "", area: numeroBr(carr[1]) ?? 0 });
      continue;
    }
    const m = t.match(RE_TALHAO);
    if (m) {
      const area = numeroBr(m[2]);
      if (area !== null && area > 0 && area < 500) {
        const tlh = m[1].replace(/^0+(?=\d)/, "").toUpperCase();
        const ja = talhoes.find((x) => x.faz === faz && x.tlh === tlh);
        if (ja && Math.abs(ja.area - area) < 0.005) avisos.push(`Talhão ${faz}-${tlh} repetido na mensagem com a mesma área: entrou uma vez.`);
        else if (ja) {
          ja.area = r2(ja.area + area);
          avisos.push(`Talhão ${faz}-${tlh} aparece duas vezes na mensagem: as áreas foram somadas.`);
        } else talhoes.push({ faz, tlh, area });
      }
      continue;
    }
    const area = n.match(/^area\s*:\s*([\d.,]+)/);
    if (area) areaSoltaPorFaz.set(faz, (areaSoltaPorFaz.get(faz) ?? 0) + (numeroBr(area[1]) ?? 0));
  }
  // fazendas sem talhão: área da linha, ou o total do bloco (uma fazenda só)
  const comTalhao = new Set(talhoes.map((t) => t.faz));
  for (const f of fazendasCitadas) {
    if (comTalhao.has(f)) continue;
    const a = areaSoltaPorFaz.get(f);
    if (a) talhoes.push({ faz: f, tlh: "", area: r2(a) });
  }
  const somaAtual = talhoes.reduce((s, t) => s + t.area, 0);
  const semArea = fazendasCitadas.filter((f) => !talhoes.some((t) => t.faz === f));
  if (talhoes.length > 0 && semArea.length > 0 && totalInformado && totalInformado - somaAtual > 0.05) {
    // "Faz 9503 / Faz 9501 / Faz 9397 - 13,3 ha / Total 363,57": o restante do total vai para a 1ª fazenda sem área
    talhoes.push({ faz: semArea[0], tlh: "", area: r2(totalInformado - somaAtual) });
    avisos.push(
      `Fazendas sem área (${semArea.join(", ")}): o restante do total (${r2(totalInformado - somaAtual).toLocaleString("pt-BR")} ha) foi lançado na fazenda ${semArea[0]}.`,
    );
  } else if (talhoes.length === 0 && fazendasCitadas.length > 0 && totalInformado) {
    talhoes.push({ faz: fazendasCitadas[0], tlh: "", area: totalInformado });
    if (fazendasCitadas.length > 1)
      avisos.push(`Área total de ${fazendasCitadas.length} fazendas (${fazendasCitadas.join(", ")}) sem divisão: lançada na fazenda ${fazendasCitadas[0]}.`);
  } else if (fazendasCitadas.length > new Set(talhoes.map((t) => t.faz)).size) {
    const sem = fazendasCitadas.filter((f) => !talhoes.some((t) => t.faz === f));
    if (sem.length && talhoes.length) avisos.push(`Fazenda(s) citada(s) sem área: ${sem.join(", ")}.`);
  }
  if (os.length > 1) avisos.push(`Mais de uma O.S. na mensagem (${os.join(", ")}).`);
  void mensagem;
  return {
    atividade: atividadeFinal || categoria,
    categoria,
    opCod,
    os,
    equipe,
    frota,
    nEqp,
    nPes: pessoas,
    vazao,
    calda,
    statusOs,
    talhoes,
    totalInformado,
    totais,
    avisos,
  };
}
