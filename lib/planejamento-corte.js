/**
 * Leitor (sem banco) da mensagem diária "Planejamento Ordem de Cortes" do WhatsApp:
 *
 *   *Planejamento Ordem de Cortes*
 *   Data: *14/10/2026*
 *   *_# Frente  I_*
 *   Ordem. *2496*
 *   Faz. São João 9845
 *   Área. 227.38
 *   Realizado. 107.38
 *   Resta. 120.00
 *
 * Cada frente começa numa linha com "Frente" (o número vem em romano, em arábico ou com barras: "||" = II); abaixo
 * dela, um bloco por ordem. O Realizado é a área colhida acumulada da ordem. Números com ponto decimal ("227.38") ou
 * no formato brasileiro ("1.234,56").
 */

/** tira a formatação do WhatsApp (*negrito*, _itálico_, ~riscado~) e espaços sobrando */
const limpar = (s) =>
  s
    .replace(/[*_~]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const semAcento = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

/** "227.38" e "1.234,56" → número; null se não for número */
export function numeroMensagem(v) {
  const s = String(v ?? "")
    .trim()
    .replace(/\s/g, "");
  if (!s) return null;
  const n = s.includes(",") ? Number(s.replace(/\./g, "").replace(",", ".")) : Number(s);
  return Number.isFinite(n) ? n : null;
}

const ROMANOS = { I: 1, V: 5, X: 10, L: 50 };
function romanoParaNumero(r) {
  let total = 0;
  for (let i = 0; i < r.length; i++) {
    const v = ROMANOS[r[i]];
    const prox = ROMANOS[r[i + 1]] ?? 0;
    total += v < prox ? -v : v;
  }
  return total;
}
function numeroParaRomano(n) {
  const tabela = [
    [50, "L"],
    [40, "XL"],
    [10, "X"],
    [9, "IX"],
    [5, "V"],
    [4, "IV"],
    [1, "I"],
  ];
  let r = "";
  for (const [v, s] of tabela) {
    while (n >= v) {
      r += s;
      n -= v;
    }
  }
  return r;
}

/**
 * Formas equivalentes do número de uma frente: "II" = "2"; "||" = "II"; "11" pode ser o "II" digitado com uns.
 * Recebe "Frente II", "FRENTE 2", "II"…; devolve o conjunto de formas (em maiúsculas, sem "FRENTE").
 */
export function formasDaFrente(f) {
  const t = semAcento(String(f ?? ""))
    .toUpperCase()
    .replace(/FRENTE/g, " ")
    .replace(/\|/g, "I")
    .replace(/[^A-Z0-9 ]/g, " ")
    .trim()
    .split(/\s+/)[0];
  const formas = new Set();
  if (!t) return formas;
  formas.add(t);
  if (/^[IVXL]+$/.test(t)) formas.add(String(romanoParaNumero(t)));
  if (/^\d+$/.test(t)) {
    formas.add(numeroParaRomano(Number(t)));
    // "11" digitado no lugar de "II" (e "111" no lugar de "III")
    if (/^1+$/.test(t)) {
      formas.add("I".repeat(t.length));
      formas.add(String(t.length));
    }
  }
  return formas;
}

/** As duas frentes podem ser a mesma (alguma forma em comum)? */
export function mesmaFrente(a, b) {
  const fa = formasDaFrente(a);
  for (const x of formasDaFrente(b)) if (fa.has(x)) return true;
  return false;
}

/** Lê a mensagem: { data (ISO) | null, ordens: [{ frente, numero, fazendaTexto, fazendas, area, realizado, resta, linha }], avisos }. */
export function lerPlanejamentoCorte(texto) {
  const linhas = String(texto ?? "").split(/\r?\n/);
  let data = null;
  let frente = "";
  const ordens = [];
  const avisos = [];
  let atual = null;

  const fechar = () => {
    if (atual) ordens.push(atual);
    atual = null;
  };

  linhas.forEach((bruta, i) => {
    const l = limpar(bruta);
    if (!l) return;
    const sa = semAcento(l).toLowerCase();

    // "Data: 14/10/2026", "Data 14-10-26", "Data: 14.10.2026"; outra linha Data: = outra mensagem colada junto: vale só a última
    const d = l.match(/data\s*:?\s*(\d{1,2})\s*[/.-]\s*(\d{1,2})\s*[/.-]\s*(\d{4}|\d{2})\b/i);
    if (d) {
      fechar();
      const ano = d[3].length === 2 ? `20${d[3]}` : d[3];
      const nova = `${ano}-${d[2].padStart(2, "0")}-${d[1].padStart(2, "0")}`;
      if (data !== null) {
        avisos.push(`O texto colado tem mais de uma mensagem (mais de uma linha "Data:"); vale só a última, de ${d[1].padStart(2, "0")}/${d[2].padStart(2, "0")}/${ano}.`);
        ordens.length = 0;
        frente = "";
      }
      data = nova;
      return;
    }
    // "# Frente II", "#Frente 11 #", "# Frente 20 # (Goiás)#"
    const fr = sa.match(/^#?\s*frente\s*([^#()]*)/);
    if (fr && /#|^frente/.test(sa)) {
      fechar();
      const nome = l
        .replace(/^#?\s*frente/i, "")
        .replace(/[#()].*$/, "")
        .replace(/[-–—.\s]+$/, "")
        .trim();
      frente = `Frente ${nome.replace(/\|/g, "I")}`.trim();
      return;
    }
    const o = sa.match(/^ordem\s*[.:]?\s*(\d+)/);
    if (o) {
      fechar();
      atual = { frente, numero: o[1], fazendaTexto: "", fazendas: [], area: null, realizado: null, resta: null, linha: i + 1 };
      return;
    }
    if (!atual) return;
    const campo = (rotulo) => {
      const m = sa.match(new RegExp(`^${rotulo}\\s*[.:]?\\s*([\\d.,]+)`));
      return m ? numeroMensagem(m[1]) : undefined;
    };
    if (/^faz/.test(sa)) {
      atual.fazendaTexto = l.replace(/^faz\w*\s*\.?\s*/i, "").trim();
      atual.fazendas = Array.from(new Set((atual.fazendaTexto.match(/\b\d{4,5}\b/g) ?? []).map(String)));
      return;
    }
    const area = campo("area");
    if (area !== undefined) {
      atual.area = area;
      return;
    }
    const realizado = campo("realizado");
    if (realizado !== undefined) {
      atual.realizado = realizado;
      return;
    }
    const resta = campo("resta");
    if (resta !== undefined) atual.resta = resta;
  });
  fechar();

  // a mesma ordem duas vezes ("02496" = "2496"): vale a última
  const vistas = new Map();
  for (const o of ordens) {
    const chave = o.numero.replace(/^0+(?=\d)/, "");
    if (vistas.has(chave)) avisos.push(`A ordem ${o.numero} aparece mais de uma vez na mensagem; vale a última (linha ${o.linha}).`);
    vistas.set(chave, o);
  }
  if (!data) avisos.push('Não achei a data da mensagem (linha "Data: dd/mm/aaaa").');
  return { data, ordens: Array.from(vistas.values()), avisos };
}
