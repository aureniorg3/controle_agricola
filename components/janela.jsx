"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Janelas (caixas suspensas) das telas de lançamento: o formulário abre por cima da página, como no Apontamento
 * Diário. Esc e F2 valem só para a janela de cima (as abertas ficam numa pilha) e não disparam se outro componente
 * já tratou a tecla (paleta de comandos, seletor, lista de sugestões).
 */

/**
 * Janelas abertas, com a camada de cada uma (a mesma ordem do z-index: formulário 40, modais 50, confirmação 60,
 * busca de telas 70). A de cima é a da camada mais alta; na mesma camada, a aberta por último. Assim um formulário
 * que termina de abrir com uma confirmação na tela não fica com o Esc, o F2 e o foco.
 */
const pilha = [];
export const algumaJanelaAberta = () => pilha.length > 0;
const janelaDeCima = () => pilha.reduce((topo, j) => (!topo || j.camada >= topo.camada ? j : topo), null)?.id;
export const ehJanelaDeCima = (id) => janelaDeCima() === id;

/** Registra a janela enquanto `aberto`: `onEsc` e `onF2` só disparam se ela for a de cima. */
export function useJanela(aberto, { onEsc, onF2, camada = 50 } = {}) {
  const id = useId();
  const cb = useRef({});
  cb.current = { onEsc, onF2 };
  useEffect(() => {
    if (!aberto) return;
    pilha.push({ id, camada });
    const tecla = (e) => {
      if (e.defaultPrevented || janelaDeCima() !== id) return;
      if (e.key === "Escape" && cb.current.onEsc) {
        e.preventDefault();
        cb.current.onEsc();
      } else if (e.key === "F2" && cb.current.onF2) {
        e.preventDefault();
        cb.current.onF2();
      }
    };
    window.addEventListener("keydown", tecla);
    return () => {
      window.removeEventListener("keydown", tecla);
      const i = pilha.findIndex((j) => j.id === id);
      if (i >= 0) pilha.splice(i, 1);
    };
  }, [aberto, id, camada]);
  return id;
}

/**
 * Clique fora de um modal (no fundo escuro): só fecha se o botão desceu e subiu no fundo (arrastar uma seleção para
 * fora não fecha) e fora da barra de rolagem do fundo (conteúdo mais alto que a tela). Espalhe no elemento do fundo.
 */
export function useCliqueFora(fechar) {
  const desceu = useRef(false);
  const noFundo = (e) => e.target === e.currentTarget && e.clientX < e.currentTarget.clientWidth;
  return {
    onMouseDown: (e) => {
      desceu.current = noFundo(e);
    },
    onClick: (e) => {
      const ok = desceu.current && noFundo(e);
      desceu.current = false;
      if (ok) fechar?.();
    },
  };
}

/** Atalho da página (ex.: F2 = novo lançamento) que só vale com nenhuma janela aberta. */
export function useAtalhoTela(tecla, fn, ativo = true) {
  const r = useRef(fn);
  r.current = fn;
  useEffect(() => {
    if (!ativo) return;
    const h = (e) => {
      if (e.key !== tecla || e.defaultPrevented || algumaJanelaAberta()) return;
      e.preventDefault();
      r.current();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [tecla, ativo]);
}

const LARGURAS = { md: "max-w-md", lg: "max-w-lg", "2xl": "max-w-2xl", "3xl": "max-w-3xl", "4xl": "max-w-4xl", "5xl": "max-w-5xl", "6xl": "max-w-6xl" };

/** O portal só existe no navegador (a página é renderizada antes no servidor). */
function usePortal() {
  const [ok, setOk] = useState(false);
  useEffect(() => setOk(true), []);
  return ok;
}

/**
 * Janela de lançamento: fundo escuro, caixa azul-clara do formulário (.caixa-form) com título, campos à direita do
 * título (ex.: nº do boletim), conteúdo e rodapé com os botões. Fecha pelo ×, pelo Esc e clicando fora (passando
 * sempre por `onFechar`, que decide se pergunta antes); F2 chama `onGravar`. Com `ocupado` (gravando) não fecha.
 */
export default function JanelaFormulario({
  aberto,
  titulo,
  subtitulo,
  topoDireita,
  aviso,
  rodape,
  children,
  onFechar,
  onGravar,
  ocupado = false,
  largura = "6xl",
  fecharAoClicarFora = true,
  focoInicial,
  corpoRef,
  onKeyDown,
  rotulo,
}) {
  const id = useJanela(aberto, { onEsc: () => !ocupado && onFechar?.(), onF2: onGravar, camada: 40 });
  const secao = useRef(null);
  const montado = usePortal();
  const cliqueFora = useCliqueFora(() => fecharAoClicarFora && !ocupado && onFechar?.());

  // foco no primeiro campo ao abrir; ao fechar, volta para onde estava (o botão que abriu)
  useEffect(() => {
    if (!aberto) return;
    const antes = document.activeElement;
    const t = setTimeout(() => {
      // com outra janela por cima (ex.: confirmação aberta enquanto esta carregava), o foco fica com ela
      if (secao.current?.contains(document.activeElement) || !ehJanelaDeCima(id)) return;
      const el = focoInicial?.current ?? secao.current?.querySelector("[data-nav]:not(:disabled), input:not(:disabled), select:not(:disabled)");
      el?.focus();
      el?.select?.();
    }, 0);
    return () => {
      clearTimeout(t);
      if (antes instanceof HTMLElement && document.contains(antes)) antes.focus({ preventScroll: true });
    };
  }, [aberto]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!aberto || !montado) return null;
  return createPortal(
    <div
      translate="no"
      className="fixed inset-0 z-40 overflow-y-auto overscroll-contain bg-navy-950/50 px-3 py-4 sm:px-6 sm:py-8"
      {...cliqueFora}
    >
      <div className={`mx-auto ${LARGURAS[largura] ?? largura} space-y-3`}>
        {aviso}
        <section
          role="dialog"
          aria-modal="true"
          aria-labelledby={`${id}-t`}
          aria-label={rotulo}
          onKeyDown={onKeyDown}
          ref={(el) => {
            secao.current = el;
            if (corpoRef) corpoRef.current = el;
          }}
          className="caixa-form shadow-pop"
        >
          <div className="caixa-form-topo">
            <div className="min-w-0">
              <h2 id={`${id}-t`} className="caixa-form-titulo">
                {titulo}
              </h2>
              {subtitulo && <div className="text-[11.5px] text-muted">{subtitulo}</div>}
            </div>
            <div className="flex items-center gap-2">
              {topoDireita}
              <button
                type="button"
                onClick={() => !ocupado && onFechar?.()}
                disabled={ocupado}
                className="flex h-8 w-8 items-center justify-center rounded-md text-[20px] leading-none text-muted hover:bg-surface disabled:opacity-40"
                aria-label="Fechar"
                title="Fechar (Esc)"
              >
                ×
              </button>
            </div>
          </div>
          {children}
          {rodape && <div className="mt-4 flex flex-wrap justify-end gap-2">{rodape}</div>}
        </section>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Janela de consulta (detalhe de um card, de um registro): caixa branca com título, subtítulo, ações no topo
 * (ex.: exportar), conteúdo rolável e rodapé. Fecha pelo ×, pelo Esc e clicando fora.
 */
export function JanelaInfo({ titulo, subtitulo, acoes, rodape, children, onFechar, largura = "5xl", rotulo }) {
  const id = useJanela(true, { onEsc: onFechar });
  const montado = usePortal();
  const cliqueFora = useCliqueFora(onFechar);
  const fechar = useRef(null);
  useEffect(() => {
    const antes = document.activeElement;
    const t = setTimeout(() => ehJanelaDeCima(id) && fechar.current?.focus({ preventScroll: true }), 0);
    return () => {
      clearTimeout(t);
      if (antes instanceof HTMLElement && document.contains(antes)) antes.focus({ preventScroll: true });
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!montado) return null;
  return createPortal(
    <div translate="no" className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto overscroll-contain bg-navy-950/50 px-3 py-6 sm:py-10" {...cliqueFora}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-t`}
        aria-label={rotulo}
        className={`w-full ${LARGURAS[largura] ?? largura} rounded-xl2 bg-card shadow-pop`}
      >
        <header className="flex items-start gap-3 border-b border-line px-5 py-3.5">
          <div className="min-w-0 flex-1">
            <h2 id={`${id}-t`} className="text-[15px] font-semibold text-ink">
              {titulo}
            </h2>
            {subtitulo && <div className="mt-0.5 text-[12px] text-muted">{subtitulo}</div>}
          </div>
          {acoes && <div className="flex shrink-0 items-center gap-2">{acoes}</div>}
          <button
            ref={fechar}
            type="button"
            onClick={onFechar}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[20px] leading-none text-muted hover:bg-surface"
            aria-label="Fechar"
            title="Fechar (Esc)"
          >
            ×
          </button>
        </header>
        <div className="px-5 py-4">{children}</div>
        {rodape && <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3">{rodape}</footer>}
      </div>
    </div>,
    document.body,
  );
}

/** Mensagem de retorno (sucesso ou erro) com botão de fechar. */
export function Aviso({ msg, onFechar }) {
  if (!msg) return null;
  return (
    <div
      role={msg.erro ? "alert" : "status"}
      className={`flex items-start gap-2 rounded-md border px-3 py-2 text-[13px] ${msg.erro ? "border-alert-500/40 bg-alert-50 text-alert-600" : "border-good-500/40 bg-good-50 text-good-600"}`}
    >
      <span className="min-w-0 flex-1 whitespace-pre-line">{msg.texto}</span>
      {onFechar && (
        <button type="button" onClick={onFechar} aria-label="Fechar a mensagem" className="px-1 leading-none opacity-70 hover:opacity-100">
          ×
        </button>
      )}
    </div>
  );
}

/** Confirmação (descartar, excluir…) por cima de qualquer janela; Esc cancela. Ao fechar, o foco volta ao campo. */
export function JanelaConfirmar({ titulo, texto, botao = "Confirmar", perigo = false, onConfirmar, onCancelar }) {
  useJanela(true, { onEsc: onCancelar, camada: 60 });
  const ok = useRef(null);
  const montado = usePortal();
  const cliqueFora = useCliqueFora(onCancelar);
  useEffect(() => {
    const antes = document.activeElement;
    const t = setTimeout(() => ok.current?.focus(), 0);
    return () => {
      clearTimeout(t);
      if (antes instanceof HTMLElement && document.contains(antes)) antes.focus({ preventScroll: true });
    };
  }, []);
  if (!montado) return null;
  return createPortal(
    <div
      translate="no"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-navy-950/50 px-4"
      {...cliqueFora}
    >
      <div role="alertdialog" aria-modal="true" aria-label={titulo} className="w-full max-w-md rounded-xl2 bg-card p-5 shadow-pop">
        <h2 className="text-[15px] font-semibold text-ink">{titulo}</h2>
        {texto && <p className="mt-2 whitespace-pre-line text-[13px] text-muted">{texto}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancelar}
            className="rounded-lg border border-line bg-card px-3 py-1.5 text-[12.5px] font-medium text-navy-800 hover:bg-surface"
          >
            Voltar
          </button>
          <button
            ref={ok}
            type="button"
            onClick={onConfirmar}
            className={`rounded-lg px-4 py-1.5 text-[12.5px] font-medium text-white ${perigo ? "bg-alert-600 hover:bg-alert-500" : "bg-navy-900 hover:bg-navy-800"}`}
          >
            {botao}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
