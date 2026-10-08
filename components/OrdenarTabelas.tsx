"use client";

import { useEffect } from "react";

/**
 * Ordenação em todas as tabelas do sistema: clicar no título de uma coluna (última linha do cabeçalho) ordena as linhas
 * por ela; clicar de novo inverte. Funciona em qualquer tela sem mexer nela:
 * - números no formato brasileiro (1.234,56), percentuais, valores em R$ e datas (dd/mm/aaaa) são comparados como tal;
 * - linhas de grupo, subtotal e total (com células mescladas ou começando por "Total"/"Subtotal") ficam no lugar e a
 *   ordenação acontece dentro de cada bloco entre elas;
 * - vazio ("", "–") vai sempre para o fim;
 * - quando a tela redesenha a tabela (filtro, nova busca), a ordem escolhida é aplicada de novo.
 * Uma tabela fica de fora com o atributo `data-sem-ordenar`.
 */

type Estado = { coluna: number; desc: boolean; observador?: MutationObserver; ocupado?: boolean };
const estados = new WeakMap<HTMLTableElement, Estado>();

/** Coluna (contando as mescladas) em que a célula começa. */
function colunaDe(celula: HTMLTableCellElement): number {
  let col = 0;
  let c = celula.previousElementSibling as HTMLTableCellElement | null;
  while (c) {
    col += c.colSpan || 1;
    c = c.previousElementSibling as HTMLTableCellElement | null;
  }
  return col;
}

function celulaNaColuna(linha: HTMLTableRowElement, coluna: number): HTMLTableCellElement | null {
  let col = 0;
  for (const c of Array.from(linha.cells)) {
    if (col === coluna) return c;
    col += c.colSpan || 1;
    if (col > coluna) return null;
  }
  return null;
}

const VAZIOS = new Set(["", "–", "—", "-", "—"]);

/** Valor comparável da célula: número (inclui data) ou texto. */
function valorDe(celula: HTMLTableCellElement | null): { vazio: boolean; num: number | null; txt: string } {
  if (!celula) return { vazio: true, num: null, txt: "" };
  const campo = celula.querySelector("input, select, textarea") as HTMLInputElement | HTMLSelectElement | null;
  let txt: string;
  if (campo && campo instanceof HTMLInputElement && (campo.type === "checkbox" || campo.type === "radio")) return { vazio: false, num: campo.checked ? 1 : 0, txt: "" };
  if (campo) txt = (campo instanceof HTMLSelectElement ? campo.selectedOptions[0]?.text : campo.value) ?? "";
  else txt = celula.innerText ?? celula.textContent ?? "";
  txt = txt.replace(/\s+/g, " ").trim();
  if (VAZIOS.has(txt)) return { vazio: true, num: null, txt: "" };
  // data dd/mm/aaaa (com hora opcional) ou dd/mm
  const d = txt.match(/^(\d{2})\/(\d{2})(?:\/(\d{2,4}))?(?:,?\s+(\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (d && Number(d[2]) <= 12) {
    const ano = d[3] ? (d[3].length === 2 ? 2000 + Number(d[3]) : Number(d[3])) : 0;
    return { vazio: false, num: ano * 1e10 + Number(d[2]) * 1e8 + Number(d[1]) * 1e6 + Number(d[4] ?? 0) * 1e4 + Number(d[5] ?? 0) * 100 + Number(d[6] ?? 0), txt };
  }
  // número brasileiro, com R$, %, unidade ou sinal
  const n = txt
    .replace(/^R\$\s*/i, "")
    .replace(/\s*(%|ha|t|t\/ha|kg|l|lts?|un|dias?)$/i, "")
    .replace(/−/g, "-")
    .replace(/^\+/, "");
  if (/^-?\d{1,3}(\.\d{3})*(,\d+)?$/.test(n) || /^-?\d+(,\d+)?$/.test(n)) return { vazio: false, num: Number(n.replace(/\./g, "").replace(",", ".")), txt };
  return { vazio: false, num: null, txt };
}

const ordenadorTexto = new Intl.Collator("pt-BR", { numeric: true, sensitivity: "base" });

/** Linha de dado (ordenável): sem célula mesclada, com todas as colunas e que não é total. */
function ehLinhaDeDado(linha: HTMLTableRowElement, colunas: number): boolean {
  const cells = Array.from(linha.cells);
  if (cells.length !== colunas || cells.some((c) => (c.colSpan || 1) > 1)) return false;
  const inicio = `${cells[0]?.textContent ?? ""} ${cells[1]?.textContent ?? ""}`.trim();
  return !/^(sub)?total\b/i.test(inicio);
}

function ordenar(tabela: HTMLTableElement) {
  const est = estados.get(tabela);
  const cab = tabela.tHead?.rows[tabela.tHead.rows.length - 1];
  if (!est || !cab) return;
  const colunas = Array.from(cab.cells).reduce((s, c) => s + (c.colSpan || 1), 0);
  est.ocupado = true;
  for (const corpo of Array.from(tabela.tBodies)) {
    const linhas = Array.from(corpo.rows);
    // blocos de linhas de dado entre as linhas fixas (grupo, subtotal, total, detalhe aberto)
    const blocos: HTMLTableRowElement[][] = [];
    let atual: HTMLTableRowElement[] = [];
    for (const l of linhas) {
      if (ehLinhaDeDado(l, colunas)) atual.push(l);
      else if (atual.length) {
        blocos.push(atual);
        atual = [];
      }
    }
    if (atual.length) blocos.push(atual);
    for (const bloco of blocos) {
      if (bloco.length < 2) continue;
      const antes = bloco[0].previousElementSibling;
      const ordenadas = bloco
        .map((l, i) => ({ l, i, v: valorDe(celulaNaColuna(l, est.coluna)) }))
        .sort((a, b) => {
          if (a.v.vazio !== b.v.vazio) return a.v.vazio ? 1 : -1;
          let r = 0;
          if (a.v.num !== null && b.v.num !== null) r = a.v.num - b.v.num;
          else if (a.v.num !== null) r = -1;
          else if (b.v.num !== null) r = 1;
          else r = ordenadorTexto.compare(a.v.txt, b.v.txt);
          return (est.desc ? -r : r) || a.i - b.i;
        });
      let ref: Element | null = antes;
      for (const { l } of ordenadas) {
        corpo.insertBefore(l, ref ? ref.nextSibling : corpo.firstChild);
        ref = l;
      }
    }
  }
  // as mudanças feitas aqui não disparam nova ordenação; corpo novo (a tela trocou o tbody) passa a ser observado
  est.observador?.takeRecords();
  for (const corpo of Array.from(tabela.tBodies)) est.observador?.observe(corpo, { childList: true });
  est.ocupado = false;
}

function marcarCabecalho(tabela: HTMLTableElement, th: HTMLTableCellElement, desc: boolean) {
  tabela.querySelectorAll("thead th[data-ordem]").forEach((x) => x.removeAttribute("data-ordem"));
  th.setAttribute("data-ordem", desc ? "desc" : "asc");
}

export default function OrdenarTabelas() {
  useEffect(() => {
    function aoClicar(e: MouseEvent) {
      const alvo = e.target as HTMLElement | null;
      if (!alvo || alvo.closest("input, button, select, textarea, a, label")) return;
      const th = alvo.closest("th") as HTMLTableCellElement | null;
      const tabela = th?.closest("table") as HTMLTableElement | null;
      if (!th || !tabela || tabela.closest("[data-sem-ordenar]")) return;
      const cab = tabela.tHead;
      if (!cab || th.parentElement !== cab.rows[cab.rows.length - 1]) return;
      if (!(th.textContent ?? "").trim()) return;
      const coluna = colunaDe(th);
      const anterior = estados.get(tabela);
      const desc = anterior?.coluna === coluna ? !anterior.desc : false;
      const est: Estado = { coluna, desc, observador: anterior?.observador };
      estados.set(tabela, est);
      if (!est.observador) {
        let pendente = 0;
        est.observador = new MutationObserver(() => {
          const e2 = estados.get(tabela);
          if (!e2 || e2.ocupado) return;
          cancelAnimationFrame(pendente);
          pendente = requestAnimationFrame(() => ordenar(tabela));
        });
        for (const corpo of Array.from(tabela.tBodies)) est.observador.observe(corpo, { childList: true });
        est.observador.observe(tabela, { childList: true });
      }
      marcarCabecalho(tabela, th, desc);
      ordenar(tabela);
    }
    document.addEventListener("click", aoClicar);
    return () => document.removeEventListener("click", aoClicar);
  }, []);
  return null;
}
