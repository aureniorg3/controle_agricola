"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext } from "react";
import { caminhoDaTela } from "@/lib/menu";
import { IconSetaEsquerda } from "./icons";

/*
 * Estrutura padrão das telas (no modelo dos sistemas corporativos de gestão agrícola):
 *
 *   <Pagina>
 *     <CabecalhoPagina titulo="Estoque Insumos" comandos={<>…<Comando/>…</>} info={…} />
 *     <CorpoPagina>
 *       <BarraFiltros>…</BarraFiltros>
 *       <Painel titulo="…">…</Painel>
 *     </CorpoPagina>
 *   </Pagina>
 *
 * A barra de comandos (branca, no topo da tela) traz o Voltar e as ações da tela; abaixo dela, a trilha do menu e o
 * título. O conteúdo rola por baixo, com o cabeçalho sempre à vista.
 */

/** Tela anterior desta aba, para o Voltar da barra de comandos (fornecida pelo AppShell). */
export const ContextoVoltar = createContext({
  anterior: null,
  voltar: () => {},
});

/** Raiz de uma tela: ocupa a área ao lado do menu, com cabeçalho fixo e corpo rolando. */
export function Pagina({ children, className = "", ...props }) {
  return (
    <div className={`flex min-w-0 flex-1 flex-col overflow-hidden ${className}`} {...props}>
      {children}
    </div>
  );
}

/**
 * Cabeçalho da tela: barra de comandos (Voltar + `comandos`) e, abaixo, a trilha do menu e o título; `info` fica à
 * direita do título (data de atualização, contadores, selos) e `abas` logo abaixo dele. `categoria` só é usada quando
 * a tela não está no menu (a trilha vem do menu).
 */
export function CabecalhoPagina({ titulo, categoria, comandos, info, abas, children }) {
  const pathname = usePathname();
  const { anterior, voltar } = useContext(ContextoVoltar);
  const local = caminhoDaTela(pathname ?? "/");
  const trilha = local && (local.secao || local.grupos.length) ? [local.secao, ...local.grupos].filter(Boolean) : categoria ? [categoria] : [];
  const temBarra = !!anterior || !!comandos;
  return (
    <div className="flex-shrink-0">
      {temBarra && (
        <div className="print-hide flex min-h-[44px] items-center gap-0.5 overflow-x-auto border-b border-line bg-card px-2 py-1.5 md:px-4">
          {anterior && (
            <>
              <button
                type="button"
                onClick={voltar}
                className={classeComando()}
                title={`Voltar para ${anterior.nome ?? "a tela anterior"}`}
                aria-label={`Voltar para ${anterior.nome ?? "a tela anterior"}`}
              >
                <span className="text-navy-900">
                  <IconSetaEsquerda size={16} />
                </span>
                <span className="hidden sm:inline">Voltar</span>
              </button>
              {comandos && <SeparadorComandos />}
            </>
          )}
          {comandos}
        </div>
      )}
      <div className="flex flex-wrap items-end gap-x-4 gap-y-1.5 px-4 pb-3 pt-3.5 md:px-6">
        <div className="min-w-[min(100%,240px)] flex-1">
          {trilha.length > 0 && <div className="truncate text-[12px] text-muted">{trilha.join(" › ")}</div>}
          <h1 className="truncate font-display text-[24px] font-semibold leading-[1.15] text-ink">{titulo}</h1>
        </div>
        {info && <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pb-0.5 text-[12px] text-muted">{info}</div>}
      </div>
      {abas && <div className="mb-3 px-4 md:px-6">{abas}</div>}
      {children}
    </div>
  );
}

/** Classes de um comando da barra (para `<label>` de envio de arquivo e outros elementos que não são `<Comando>`). */
export function classeComando(primario = false) {
  return primario
    ? "inline-flex h-8 flex-shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-lg bg-navy-900 px-3 text-[13px] font-medium text-white hover:bg-navy-800 dark:bg-crv-acao dark:hover:bg-[#3A6DBA] disabled:pointer-events-none disabled:opacity-45 aria-disabled:pointer-events-none aria-disabled:opacity-45"
    : "inline-flex h-8 flex-shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 text-[13px] font-medium text-ink hover:bg-hover disabled:pointer-events-none disabled:opacity-45 aria-disabled:pointer-events-none aria-disabled:opacity-45";
}

/** Um comando da barra de comandos: ícone + texto, sem caixa; o principal da tela em azul cheio. */
export function Comando({ icone, primario = false, href, className = "", children, type = "button", ...props }) {
  const cls = `${classeComando(primario)} ${className}`;
  const conteudo = (
    <>
      {icone && <span className={`flex flex-shrink-0 ${primario ? "" : "text-navy-900"}`}>{icone}</span>}
      {children}
    </>
  );
  if (href) {
    return (
      <Link href={href} className={cls} title={props.title}>
        {conteudo}
      </Link>
    );
  }
  return (
    <button type={type} className={cls} {...props}>
      {conteudo}
    </button>
  );
}

/** Selo pequeno para o `info` do cabeçalho (ex.: "Somente leitura"). */
export function Selo({ children, title }) {
  return (
    <span className="whitespace-nowrap rounded-full border border-line bg-card px-2.5 py-0.5 text-[11.5px] font-medium text-muted" title={title}>
      {children}
    </span>
  );
}

/** Traço vertical entre grupos de comandos. */
export function SeparadorComandos() {
  return <span className="mx-1 h-5 w-px flex-shrink-0 bg-line" aria-hidden="true" />;
}

/** Empurra os comandos seguintes para a direita da barra. */
export function EspacoComandos() {
  return <span className="min-w-2 flex-1" aria-hidden="true" />;
}

/** Corpo da tela: rola por baixo do cabeçalho, com o recuo padrão. */
export function CorpoPagina({ children, className = "" }) {
  return (
    <div data-corpo-pagina="" className={`flex-1 overflow-y-auto px-4 pb-6 pt-1 md:px-6 ${className}`}>
      {children}
    </div>
  );
}

/** Volta o corpo da tela para o topo (quem rola é o CorpoPagina, não a janela) — ex.: ao abrir um item para editar. */
export function rolarCorpoParaOTopo(suave = true) {
  document.querySelector("[data-corpo-pagina]")?.scrollTo({ top: 0, behavior: suave ? "smooth" : "auto" });
}

/**
 * Painel: caixa branca com borda fina e, se houver, título (e ações à direita) numa faixa de cabeçalho.
 * `semEspaco` tira o recuo interno (tabelas que vão de borda a borda; tabela larga precisa de um
 * `<div className="overflow-x-auto">` por fora, porque o painel corta o que passa da borda). `icone` vai antes do título.
 */
export function Painel({ titulo, subtitulo, acoes, icone, children, className = "", semEspaco = false, id }) {
  return (
    <section id={id} className={`rounded-xl2 border border-line bg-card shadow-card ${semEspaco ? "overflow-hidden" : ""} ${className}`}>
      {(titulo || acoes) && (
        <header className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line px-4 py-2.5">
          <div className="min-w-0 flex-1">
            {titulo && (
              <h2 className="flex min-w-0 items-center gap-2 font-display text-[17px] font-semibold leading-tight text-ink">
                {icone && <span className="flex flex-shrink-0 text-crv-verde">{icone}</span>}
                <span className="min-w-0 truncate">{titulo}</span>
              </h2>
            )}
            {subtitulo && <p className="mt-0.5 text-[12px] text-muted">{subtitulo}</p>}
          </div>
          {acoes && <div className="flex flex-wrap items-center gap-1.5">{acoes}</div>}
        </header>
      )}
      {semEspaco ? children : <div className="p-4">{children}</div>}
    </section>
  );
}

/** Faixa de filtros da tela: os campos lado a lado (rótulo em cima), quebrando linha quando não cabem. */
export function BarraFiltros({ children, className = "" }) {
  return (
    <div className={`mb-4 flex flex-wrap items-end gap-x-3 gap-y-2.5 rounded-xl2 border border-line bg-card px-4 py-3 shadow-card ${className}`}>
      {children}
    </div>
  );
}

/** Cores de significado do padrão CRV, para o indicador. */
const COR_FILETE = {
  azul: "#23396B",
  verde: "#5D9E48",
  laranja: "#D77B38",
  cinza: "#5C6777",
  vermelho: "#BE3132",
  amarelo: "#D9A21B",
};
const COR_VALOR = {
  azul: "text-navy-900",
  verde: "text-[#4A8A36] dark:text-[#7CC46A]",
  laranja: "text-[#C76A28] dark:text-[#F0A066]",
  cinza: "text-[#5C6777] dark:text-muted",
  vermelho: "text-[#BE3132] dark:text-[#F08A78]",
  amarelo: "text-amber-600",
};

/**
 * Indicador (cartão de número): rótulo, valor grande em fonte condensada, unidade pequena e linha de apoio.
 * `cor` pinta o filete à esquerda e o valor com a cor do significado (azul total, verde realizado, laranja a colher,
 * cinza neutro, vermelho crítico); `icone` aparece pequeno no canto, na mesma cor.
 */
export function Indicador({ rotulo, valor, unidade, apoio, cor, icone, className = "", title, children }) {
  return (
    <div className={`relative min-w-0 overflow-hidden rounded-xl2 border border-line bg-card py-3 pl-4 pr-3.5 shadow-card ${className}`} title={title}>
      {cor && <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: COR_FILETE[cor] }} aria-hidden="true" />}
      <div className="flex items-start gap-2">
        <div className="line-clamp-2 min-w-0 flex-1 text-[12px] leading-snug text-muted">{rotulo}</div>
        {icone && <span className={`flex flex-shrink-0 opacity-80 ${cor ? COR_VALOR[cor] : "text-muted"}`}>{icone}</span>}
      </div>
      <div
        className={`mt-1 flex min-w-0 flex-wrap items-baseline gap-x-1 font-display text-[22px] font-semibold leading-[1.05] tabular sm:text-[26px] ${cor ? COR_VALOR[cor] : "text-ink"}`}
      >
        <span className="min-w-0 break-words">{valor}</span>
        {unidade && <span className="flex-shrink-0 font-sans text-[12px] font-normal text-muted">{unidade}</span>}
      </div>
      {apoio && <div className="mt-1.5 line-clamp-2 text-[11.5px] leading-snug text-muted">{apoio}</div>}
      {children}
    </div>
  );
}

/** Abas de uma tela (sublinhado verde CRV na ativa). */
export function Abas({ itens, ativo, onChange, className = "" }) {
  return (
    <div role="tablist" className={`flex gap-1 overflow-x-auto border-b border-line ${className}`}>
      {itens.map((a) => {
        const on = a.id === ativo;
        return (
          <button
            key={a.id}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(a.id)}
            title={a.title}
            className={`relative whitespace-nowrap px-3 pb-2 pt-1.5 text-[13px] ${on ? "font-semibold text-ink" : "text-muted hover:text-ink"}`}
          >
            {a.label}
            {on && <span className="absolute inset-x-2 bottom-0 h-[3px] rounded-t-sm bg-crv-verde" aria-hidden="true" />}
          </button>
        );
      })}
    </div>
  );
}

/** Mensagem de tela ou painel sem dados: o que falta e, se houver, a ação que resolve. */
export function EstadoVazio({ titulo, children, acao }) {
  return (
    <div className="px-6 py-10 text-center">
      <div className="text-[14px] font-semibold text-ink">{titulo}</div>
      {children && <div className="mx-auto mt-1 max-w-md text-[12.5px] leading-relaxed text-muted">{children}</div>}
      {acao && <div className="mt-4 flex justify-center">{acao}</div>}
    </div>
  );
}
