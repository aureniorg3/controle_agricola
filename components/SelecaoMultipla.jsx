"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { IconBusca, IconSetaBaixo } from "./icons";

/**
 * Seleção de um ou mais itens de uma lista (ex.: operações, fazendas), no padrão dos campos de filtro: o botão mostra
 * "Todas", o item escolhido ou "3 operações"; ao abrir, um painel com busca (código ou nome, sem acento nem caixa), as
 * caixas de marcar, "Marcar todos" (os filtrados pela busca) e "Limpar". O que se marca vale ao fechar o painel (OK, Esc,
 * clique fora ou Tab para fora), assim a tela não recarrega a cada caixa marcada. Os marcados ao abrir ficam no topo.
 *
 * Teclado: no botão, ↓ abre; na busca, ↓ desce para a lista e Enter marca o único resultado; na lista, ↑/↓, Home/End e
 * PgUp/PgDn andam, Espaço ou Enter marcam, e digitar volta para a busca; Esc limpa a busca e, depois, fecha.
 *
 * `opcoes`: [{ cod, nome }] (null enquanto carrega); `valor`: códigos marcados (vazio = todos); `maximo` limita a lista.
 * `soNome`: as opções são só nomes (o `cod` é o nome, sem coluna de código), como solicitantes e apontadores.
 */

/** Mesmo visual dos campos de filtro das telas (o FILTRO das O.S.); quem usa passa a largura em `className`. */
const CAMPO = "rounded-md border border-line bg-card px-2.5 py-1.5 text-[12.5px] text-ink focus:border-brand-600 focus:outline-none";
const LINK = "rounded px-1 py-0.5 text-[12px] font-medium text-crv-acao hover:underline disabled:pointer-events-none disabled:opacity-40 dark:text-[#8fb6f2]";

const semAcento = (s) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
const int = (n) => n.toLocaleString("pt-BR");

/**
 * Onde o painel abre (posição fixa na tela, para não ser cortado pela rolagem da página): embaixo do botão ou, se lá
 * couber menos, em cima; sem espaço bom nem de um lado nem do outro (celular deitado), cobre a altura da tela. Sempre
 * dentro da largura da tela, e só na parte visível (com o teclado do celular aberto, a área visível encolhe).
 */
function posicaoDoPainel(botao) {
  const r = botao.getBoundingClientRect();
  const vv = window.visualViewport;
  const m = 8;
  const larguraTela = window.innerWidth;
  const topoVisivel = vv?.offsetTop ?? 0;
  const fimVisivel = vv ? vv.offsetTop + vv.height : window.innerHeight;
  const width = Math.min(360, larguraTela - 2 * m);
  const left = Math.min(Math.max(m, r.left), larguraTela - width - m);
  const abaixo = fimVisivel - r.bottom - 4 - m;
  const acima = r.top - topoVisivel - 4 - m;
  if (Math.max(abaixo, acima) < 280) return { left, width, top: topoVisivel + m, maxHeight: Math.min(440, fimVisivel - topoVisivel - 2 * m) };
  if (abaixo >= 260 || abaixo >= acima) return { left, width, top: r.bottom + 4, maxHeight: Math.min(440, abaixo) };
  return { left, width, bottom: window.innerHeight - r.top + 4, maxHeight: Math.min(440, acima) };
}

export default function SelecaoMultipla({
  rotulo,
  opcoes,
  valor,
  onChange,
  todos = "Todas",
  singular = "item",
  plural = "itens",
  maximo = 300,
  className = `${CAMPO} w-[200px]`,
  placeholder = "Buscar código ou nome…",
  soNome = false,
}) {
  const id = useId();
  const caixaRef = useRef(null);
  const botaoRef = useRef(null);
  const painelRef = useRef(null);
  const buscaRef = useRef(null);
  const listaRef = useRef(null);
  const abertoRef = useRef(false);
  // aberto = com posição na tela
  const [pos, setPos] = useState(null);
  const [rascunho, setRascunho] = useState([]);
  const [fixados, setFixados] = useState([]);
  const [busca, setBusca] = useState("");
  const [ativo, setAtivo] = useState(0);
  const aberto = !!pos;
  const escolhidos = useMemo(() => valor ?? [], [valor]);

  // opções + códigos marcados que não estão nelas (saíram da base, ou as opções ainda não chegaram / falharam): podem
  // ser desmarcados e não se perdem ao fechar o painel
  const todas = useMemo(() => {
    const base = opcoes ?? [];
    const tem = new Set(base.map((o) => o.cod));
    const extras = escolhidos.filter((c) => !tem.has(c)).map((c) => ({ cod: c, nome: "" }));
    return [...extras, ...base].map((o) => ({ ...o, chave: semAcento(`${o.cod} ${o.nome}`) }));
  }, [opcoes, escolhidos]);
  const nomes = useMemo(() => new Map(todas.map((o) => [o.cod, o.nome])), [todas]);
  const marcados = useMemo(() => new Set(rascunho), [rascunho]);

  // busca por todos os termos digitados (em qualquer ordem); os marcados ao abrir vêm primeiro
  const visiveis = useMemo(() => {
    const termos = semAcento(busca).split(/\s+/).filter(Boolean);
    const fix = new Set(fixados);
    const achados = todas.filter((o) => termos.every((t) => o.chave.includes(t)));
    return [...achados.filter((o) => fix.has(o.cod)), ...achados.filter((o) => !fix.has(o.cod))];
  }, [todas, busca, fixados]);
  const ativoOk = Math.min(ativo, Math.max(0, visiveis.length - 1));

  const nomeDe = (c) => (nomes.get(c) ? `${c} · ${nomes.get(c)}` : c);
  const n = escolhidos.length;
  const texto = n === 0 ? todos : n === 1 ? nomeDe(escolhidos[0]) : `${int(n)} ${plural}`;
  const dica =
    n === 0 ? undefined : escolhidos.slice(0, 15).map(nomeDe).join("\n") + (n > 15 ? `\n… e mais ${int(n - 15)}` : "");

  function abrir() {
    abertoRef.current = true;
    setRascunho(escolhidos);
    setFixados(escolhidos);
    setBusca("");
    setAtivo(0);
    setPos(posicaoDoPainel(botaoRef.current));
  }

  /** Fecha o painel e, se algo mudou, entrega a lista (na ordem das opções). */
  function fechar(devolverFoco) {
    if (!abertoRef.current) return;
    abertoRef.current = false;
    setPos(null);
    const novo = todas.filter((o) => marcados.has(o.cod)).map((o) => o.cod);
    const antes = new Set(escolhidos);
    if (novo.length !== antes.size || novo.some((c) => !antes.has(c))) onChange(novo);
    if (devolverFoco) botaoRef.current?.focus();
  }
  const fecharRef = useRef(fechar);
  fecharRef.current = fechar;

  function alternar(cod) {
    setRascunho((r) => (r.includes(cod) ? r.filter((c) => c !== cod) : r.length >= maximo ? r : [...r, cod]));
  }

  function marcarFiltrados() {
    setRascunho((r) => {
      const s = new Set(r);
      for (const o of visiveis) {
        if (s.size >= maximo) break;
        s.add(o.cod);
      }
      return [...s];
    });
  }

  // aberto: clique fora fecha; rolar a página ou mudar o tamanho da tela (teclado do celular) reposiciona o painel
  useEffect(() => {
    if (!aberto) return;
    const fora = (e) => {
      if (caixaRef.current && !caixaRef.current.contains(e.target)) fecharRef.current(false);
    };
    const reposicionar = (e) => {
      if (e?.type === "scroll" && e.target instanceof Node && painelRef.current?.contains(e.target)) return;
      if (botaoRef.current && abertoRef.current) setPos(posicaoDoPainel(botaoRef.current));
    };
    const vv = window.visualViewport;
    document.addEventListener("pointerdown", fora, true);
    document.addEventListener("scroll", reposicionar, true);
    window.addEventListener("resize", reposicionar);
    vv?.addEventListener("resize", reposicionar);
    vv?.addEventListener("scroll", reposicionar);
    return () => {
      document.removeEventListener("pointerdown", fora, true);
      document.removeEventListener("scroll", reposicionar, true);
      window.removeEventListener("resize", reposicionar);
      vv?.removeEventListener("resize", reposicionar);
      vv?.removeEventListener("scroll", reposicionar);
    };
  }, [aberto]);

  // ao abrir: com mouse/teclado o cursor já vai para a busca; no toque, não (o teclado do celular cobriria a lista)
  useEffect(() => {
    if (!aberto) return;
    if (window.matchMedia?.("(pointer: coarse)").matches) painelRef.current?.focus();
    else buscaRef.current?.focus();
  }, [aberto]);

  function focarItem(i) {
    if (visiveis.length === 0) return;
    const k = Math.max(0, Math.min(visiveis.length - 1, i));
    setAtivo(k);
    listaRef.current?.querySelector(`[data-i="${k}"]`)?.focus();
  }

  function teclaBusca(e) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      focarItem(ativoOk);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (visiveis.length === 1) alternar(visiveis[0].cod);
      else focarItem(0);
    }
  }

  function teclaLista(e) {
    const i = Number(e.target.dataset?.i);
    if (!Number.isInteger(i)) return;
    const ir = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: visiveis.length - 1, PageDown: i + 10, PageUp: i - 10 }[e.key];
    if (ir !== undefined) {
      e.preventDefault();
      if (e.key === "ArrowUp" && i === 0) buscaRef.current?.focus();
      else focarItem(ir);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (visiveis[i]) alternar(visiveis[i].cod);
    } else if (e.key.length === 1 && e.key !== " " && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // digitar com o foco na lista continua a busca
      buscaRef.current?.focus();
    }
  }

  const total = todas.length;
  const qtd = rascunho.length;

  return (
    <div
      ref={caixaRef}
      className="flex flex-col gap-1 text-[11.5px] text-muted"
      onKeyDown={(e) => {
        if (e.key !== "Escape" || !abertoRef.current) return;
        e.preventDefault();
        e.stopPropagation();
        if (e.target === buscaRef.current && busca) setBusca("");
        else fechar(true);
      }}
      onBlur={(e) => {
        // Tab para fora fecha (clique fora é tratado no pointerdown; foco "para lugar nenhum" não fecha)
        if (abertoRef.current && e.relatedTarget && !caixaRef.current?.contains(e.relatedTarget)) fechar(false);
      }}
    >
      {rotulo && <span id={`${id}-rotulo`}>{rotulo}</span>}
      <button
        ref={botaoRef}
        type="button"
        className={`${className} flex items-center justify-between gap-1.5 text-left`}
        aria-haspopup="dialog"
        aria-expanded={aberto}
        aria-controls={aberto ? `${id}-painel` : undefined}
        aria-labelledby={rotulo ? `${id}-rotulo ${id}-valor` : undefined}
        title={dica}
        onClick={() => (abertoRef.current ? fechar(false) : abrir())}
        onKeyDown={(e) => {
          if (!abertoRef.current && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            e.preventDefault();
            abrir();
          }
        }}
      >
        <span id={`${id}-valor`} className={`min-w-0 truncate ${n ? "font-medium" : ""}`}>
          {texto}
        </span>
        <IconSetaBaixo size={14} className={`flex-shrink-0 text-muted transition-transform ${aberto ? "rotate-180" : ""}`} />
      </button>

      {pos && (
        <div
          ref={painelRef}
          id={`${id}-painel`}
          role="dialog"
          aria-label={rotulo ? `Escolher ${rotulo.toLowerCase()}` : `Escolher ${plural}`}
          tabIndex={-1}
          className="fixed z-50 flex flex-col overflow-hidden rounded-lg border border-line bg-card text-[12.5px] text-ink shadow-pop outline-none"
          style={{ left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom, maxHeight: pos.maxHeight }}
        >
          <div className="border-b border-line p-2">
            <div className="relative">
              <IconBusca size={14} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted" />
              <input
                ref={buscaRef}
                type="search"
                value={busca}
                onChange={(e) => {
                  setBusca(e.target.value);
                  setAtivo(0);
                }}
                onKeyDown={teclaBusca}
                placeholder={placeholder}
                aria-label={`Buscar ${plural}`}
                aria-controls={`${id}-lista`}
                autoComplete="off"
                spellCheck={false}
                className="w-full rounded-md border border-line bg-card py-1.5 pl-7 pr-2 text-[12.5px] text-ink placeholder:text-muted/80 focus:border-brand-600 focus:outline-none [@media(pointer:coarse)]:text-base"
              />
            </div>
            <div className="mt-1.5 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={marcarFiltrados}
                disabled={qtd >= maximo || !visiveis.some((o) => !marcados.has(o.cod))}
                className={LINK}
              >
                {busca.trim() ? `Marcar todos os filtrados (${int(visiveis.length)})` : "Marcar todos"}
              </button>
              <button type="button" onClick={() => setRascunho([])} disabled={qtd === 0} className={LINK}>
                Limpar
              </button>
            </div>
          </div>

          <div
            ref={listaRef}
            id={`${id}-lista`}
            role="group"
            aria-label={plural}
            onKeyDown={teclaLista}
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-1"
          >
            {!opcoes ? (
              <p className="px-3 py-3 text-muted">Carregando…</p>
            ) : visiveis.length === 0 ? (
              <p className="px-3 py-3 text-muted">{total === 0 ? "Nada para escolher." : "Nada encontrado na busca."}</p>
            ) : (
              visiveis.map((o, i) => (
                <label
                  key={o.cod}
                  className="flex cursor-pointer items-start gap-2 px-3 py-1.5 focus-within:bg-hover hover:bg-hover [@media(pointer:coarse)]:py-2"
                >
                  <input
                    type="checkbox"
                    data-i={i}
                    tabIndex={i === ativoOk ? 0 : -1}
                    checked={marcados.has(o.cod)}
                    onChange={() => alternar(o.cod)}
                    onFocus={() => setAtivo(i)}
                    className="mt-[2px] h-3.5 w-3.5 flex-shrink-0 cursor-pointer accent-[#23396B] dark:accent-[#7FA8E8]"
                  />
                  {soNome ? (
                    <span className="min-w-0 break-words">{o.cod}</span>
                  ) : (
                    <>
                      <span className="min-w-[2.75rem] flex-shrink-0 tabular text-muted">{o.cod}</span>
                      <span className="min-w-0 break-words">{o.nome || "—"}</span>
                    </>
                  )}
                </label>
              ))
            )}
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-line bg-surface px-3 py-2 text-[12px] text-muted">
            <span aria-live="polite">
              {qtd === 0
                ? `${todos} (nada marcado)`
                : opcoes
                  ? `${int(qtd)} de ${int(total)} ${total === 1 ? singular : plural}`
                  : `${int(qtd)} ${qtd === 1 ? singular : plural}`}
              {qtd >= maximo && ` · máximo de ${int(maximo)}`}
            </span>
            <button
              type="button"
              onClick={() => fechar(true)}
              className="rounded-md bg-navy-900 px-3 py-1 text-[12px] font-medium text-white hover:bg-navy-800"
            >
              OK
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
