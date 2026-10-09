"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { IconExpandir, IconFechar, IconRecolher, IconSetaDireita } from "@/components/icons";
import { ITEM_INICIO, type ItemMenu, type SecaoMenu } from "@/lib/menu";

function hrefAtivo(pathname: string | null, href?: string, exato = false): boolean {
  if (!href || !pathname) return false;
  return pathname === href || (!exato && pathname.startsWith(href + "/"));
}

function contemAtivo(item: ItemMenu, pathname: string | null): boolean {
  return hrefAtivo(pathname, item.href, !!item.children || !!item.exato) || !!item.children?.some((c) => contemAtivo(c, pathname));
}

const inicioAtivo = (pathname: string | null) => pathname === "/painel" || pathname === "/";

/** Recuo do texto por nível: o 1º nível tem ícone; os de baixo alinham com o texto do pai. */
const RECUO = [12, 40, 52, 64];

/**
 * Menu lateral claro (no modelo dos sistemas corporativos): seções com os módulos, grupos que abrem e fecham, item
 * da tela atual marcado com o filete verde CRV. Recolhido, vira uma coluna de ícones; clicar num grupo abre a lista
 * dele ao lado. Na gaveta do celular aparece sempre aberto, com o botão de fechar.
 */
export default function MenuLateral({
  secoes,
  recolhido,
  gaveta = false,
  onNavigate,
  onAlternar,
  onFechar,
}: {
  secoes: SecaoMenu[];
  recolhido: boolean;
  /** dentro da gaveta do celular */
  gaveta?: boolean;
  onNavigate?: () => void;
  onAlternar: () => void;
  onFechar?: () => void;
}) {
  const pathname = usePathname();
  const [abertos, setAbertos] = useState<Record<string, boolean>>({});
  const [flyout, setFlyout] = useState<{ chave: string; item: ItemMenu; top: number; left: number } | null>(null);
  const flyoutRef = useRef<HTMLDivElement>(null);

  // a lista ao lado fecha ao trocar de tela, ao clicar fora ou com Esc
  useEffect(() => setFlyout(null), [pathname, recolhido]);
  useEffect(() => {
    if (!flyout) return;
    const fora = (e: globalThis.MouseEvent) => {
      const alvo = e.target as Node;
      if (flyoutRef.current?.contains(alvo)) return;
      if ((alvo as HTMLElement).closest?.(`[data-flyout="${CSS.escape(flyout.chave)}"]`)) return;
      setFlyout(null);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setFlyout(null);
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", fora);
      document.removeEventListener("keydown", esc);
    };
  }, [flyout]);

  function abrirFlyout(e: MouseEvent<HTMLButtonElement>, chave: string, item: ItemMenu) {
    if (flyout?.chave === chave) return setFlyout(null);
    const r = e.currentTarget.getBoundingClientRect();
    const top = Math.max(8, Math.min(r.top, window.innerHeight - 360));
    setFlyout({ chave, item, top, left: r.right + 8 });
  }

  /** Linha de um item no menu aberto (e na lista ao lado do menu recolhido). */
  function linha(item: ItemMenu, depth: number, chave: string, noFlyout = false): ReactNode {
    const temFilhos = !!item.children?.length;
    const aberto = temFilhos && (noFlyout || (abertos[chave] ?? contemAtivo(item, pathname)));
    const ativo = hrefAtivo(pathname, item.href, temFilhos || !!item.exato);
    const contem = !ativo && temFilhos && !aberto && contemAtivo(item, pathname);
    const Icon = depth === 0 && !noFlyout ? item.icon : undefined;
    const tamanho = depth === 0 && !noFlyout ? "h-9 text-[13.5px]" : depth <= 1 ? "h-8 text-[13px]" : "h-8 text-[12.5px]";
    const cor = ativo
      ? "bg-[#E6F1EA] font-semibold text-navy-900 dark:bg-white/[0.08] dark:text-white"
      : `${contem ? "font-semibold" : ""} text-ink hover:bg-hover`;
    const recuo = noFlyout ? 12 + depth * 12 : RECUO[Math.min(depth, RECUO.length - 1)];
    const conteudo = (
      <>
        {ativo && <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-r bg-crv-verde" aria-hidden="true" />}
        {Icon && (
          <span className={`flex w-[18px] flex-shrink-0 justify-center ${ativo || contem ? "text-crv-verde" : "text-navy-900"}`}>
            <Icon size={18} />
          </span>
        )}
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
        {item.badge ? <span className="rounded-full bg-alert-500 px-1.5 py-0.5 text-[10px] font-bold text-white">{item.badge}</span> : null}
        {temFilhos && !noFlyout && (
          <span className={`flex-shrink-0 text-muted transition-transform duration-150 ${aberto ? "rotate-90" : ""}`}>
            <IconSetaDireita size={14} />
          </span>
        )}
      </>
    );
    const classes = `relative flex w-full min-w-0 items-center gap-2.5 rounded-lg pr-2 text-left ${tamanho} ${cor}`;
    return (
      <div key={chave}>
        {item.href && !temFilhos ? (
          <Link href={item.href} onClick={onNavigate} className={classes} style={{ paddingLeft: recuo }} aria-current={ativo ? "page" : undefined}>
            {conteudo}
          </Link>
        ) : noFlyout ? (
          <div className="flex h-7 items-center truncate pr-2 text-[11.5px] font-semibold text-muted" style={{ paddingLeft: recuo }}>
            {item.label}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAbertos((o) => ({ ...o, [chave]: !aberto }))}
            className={classes}
            style={{ paddingLeft: recuo }}
            aria-expanded={aberto}
          >
            {conteudo}
          </button>
        )}
        {aberto && (
          <div className="mt-0.5 flex flex-col gap-0.5">
            {item.children!.map((c) => linha(c, depth + 1, `${chave}/${c.label}`, noFlyout))}
          </div>
        )}
      </div>
    );
  }

  /** Ícone de um módulo no menu recolhido. */
  function icone(item: ItemMenu, chave: string): ReactNode {
    const Icon = item.icon;
    if (!Icon) return null;
    const ativo = contemAtivo(item, pathname);
    const temFilhos = !!item.children?.length;
    const cls = `relative mx-auto flex h-10 w-10 items-center justify-center rounded-lg ${
      ativo ? "bg-[#E6F1EA] text-crv-verde dark:bg-white/[0.08]" : flyout?.chave === chave ? "bg-hover text-navy-900" : "text-navy-900 hover:bg-hover"
    }`;
    const marca = ativo && <span className="absolute inset-y-2 -left-2 w-[3px] rounded-r bg-crv-verde" aria-hidden="true" />;
    if (!temFilhos && item.href) {
      return (
        <Link key={chave} href={item.href} onClick={onNavigate} title={item.label} aria-label={item.label} className={cls}>
          {marca}
          <Icon size={20} />
        </Link>
      );
    }
    return (
      <button
        key={chave}
        type="button"
        data-flyout={chave}
        onClick={(e) => abrirFlyout(e, chave, item)}
        title={item.label}
        aria-label={item.label}
        aria-expanded={flyout?.chave === chave}
        className={cls}
      >
        {marca}
        <Icon size={20} />
      </button>
    );
  }

  const IconInicio = ITEM_INICIO.icon!;
  const largura = recolhido ? "w-14" : gaveta ? "w-[284px]" : "w-[256px]";

  return (
    <aside className={`flex h-full flex-shrink-0 flex-col border-r border-line bg-card transition-[width] duration-200 ${largura}`}>
      {gaveta && (
        <div className="flex h-12 flex-shrink-0 items-center gap-2 border-b-[3px] border-crv-verde bg-navy-900 pl-4 pr-2 text-white">
          <span className="flex-1 font-display text-[19px] font-semibold">Controle Agrícola</span>
          <button type="button" onClick={onFechar} className="flex h-9 w-9 items-center justify-center rounded-lg hover:bg-white/10" aria-label="Fechar menu">
            <IconFechar size={18} />
          </button>
        </div>
      )}

      <nav className={`flex-1 overflow-y-auto overflow-x-hidden py-2 ${recolhido ? "px-2" : "px-2"}`} aria-label="Menu do sistema">
        {recolhido ? (
          <Link
            href="/painel"
            onClick={onNavigate}
            title={ITEM_INICIO.label}
            aria-label={ITEM_INICIO.label}
            className={`relative mx-auto flex h-10 w-10 items-center justify-center rounded-lg ${
              inicioAtivo(pathname) ? "bg-[#E6F1EA] text-crv-verde dark:bg-white/[0.08]" : "text-navy-900 hover:bg-hover"
            }`}
          >
            {inicioAtivo(pathname) && <span className="absolute inset-y-2 -left-2 w-[3px] rounded-r bg-crv-verde" aria-hidden="true" />}
            <IconInicio size={20} />
          </Link>
        ) : (
          <Link
            href="/painel"
            onClick={onNavigate}
            aria-current={inicioAtivo(pathname) ? "page" : undefined}
            className={`relative flex h-9 items-center gap-2.5 rounded-lg pl-3 pr-2 text-[13.5px] ${
              inicioAtivo(pathname) ? "bg-[#E6F1EA] font-semibold text-navy-900 dark:bg-white/[0.08] dark:text-white" : "text-ink hover:bg-hover"
            }`}
          >
            {inicioAtivo(pathname) && <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-r bg-crv-verde" aria-hidden="true" />}
            <span className={`flex w-[18px] justify-center ${inicioAtivo(pathname) ? "text-crv-verde" : "text-navy-900"}`}>
              <IconInicio size={18} />
            </span>
            {ITEM_INICIO.label}
          </Link>
        )}

        {secoes.map((secao) => (
          <div key={secao.title} className={recolhido ? "mt-1.5 border-t border-line pt-1.5" : "mt-3"}>
            {!recolhido && <div className="px-3 pb-1 text-[11.5px] font-semibold text-muted">{secao.title}</div>}
            <div className="flex flex-col gap-0.5">
              {secao.items.map((item) => (recolhido ? icone(item, `${secao.title}/${item.label}`) : linha(item, 0, `${secao.title}/${item.label}`)))}
            </div>
          </div>
        ))}
      </nav>

      {!gaveta && (
        <div className="flex-shrink-0 border-t border-line p-2">
          <button
            type="button"
            onClick={onAlternar}
            title={recolhido ? "Expandir menu" : "Recolher menu"}
            aria-label={recolhido ? "Expandir menu" : "Recolher menu"}
            className={`flex h-9 w-full items-center gap-2.5 rounded-lg text-[13px] text-muted hover:bg-hover hover:text-ink ${recolhido ? "justify-center" : "pl-3"}`}
          >
            {recolhido ? <IconExpandir size={18} /> : <IconRecolher size={18} />}
            {!recolhido && "Recolher menu"}
          </button>
        </div>
      )}

      {flyout && (
        <div
          ref={flyoutRef}
          className="fixed z-50 w-[272px] overflow-y-auto rounded-xl2 border border-line bg-card py-2 shadow-pop"
          style={{ top: flyout.top, left: flyout.left, maxHeight: `calc(100vh - ${flyout.top + 8}px)` }}
          role="menu"
        >
          <div className="px-3 pb-1.5 font-display text-[16px] font-semibold text-ink">{flyout.item.label}</div>
          <div className="flex flex-col gap-0.5 px-1.5">
            {flyout.item.children!.map((c) => linha(c, 0, `${flyout.chave}/${c.label}`, true))}
          </div>
        </div>
      )}
    </aside>
  );
}
