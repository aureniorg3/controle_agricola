"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { IconBusca, IconMenu, IconSair } from "@/components/icons";
import { PERFIL_LABEL } from "@/lib/permissoes";

import TemaToggle from "./TemaToggle";

function iniciais(nome) {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "?";
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

/**
 * Barra superior azul CRV com o filete verde: botão do menu, nome do sistema, busca de telas (Ctrl K), tema, menu do
 * usuário e, à direita, o logo branco da CRV (padrão visual CRV: logo sempre branco e do lado direito).
 */
export default function BarraSuperior({ usuario, onMenu, onBuscar }) {
  const router = useRouter();
  const [menuAberto, setMenuAberto] = useState(false);
  const [saindo, setSaindo] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menuAberto) return;
    const fora = (e) => !menuRef.current?.contains(e.target) && setMenuAberto(false);
    const esc = (e) => e.key === "Escape" && setMenuAberto(false);
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", fora);
      document.removeEventListener("keydown", esc);
    };
  }, [menuAberto]);

  async function sair() {
    setSaindo(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.push("/login");
      router.refresh();
    }
  }

  return (
    <header className="barra-crv print-hide relative z-40 flex h-[51px] flex-shrink-0 items-center gap-1 border-b-[3px] border-crv-verde bg-navy-900 pl-1.5 pr-2 text-white md:pr-3">
      <button
        type="button"
        onClick={onMenu}
        className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-white/90 hover:bg-white/10 hover:text-white"
        aria-label="Mostrar ou recolher o menu"
        title="Menu"
      >
        <IconMenu size={20} />
      </button>
      <Link
        href="/painel"
        className="flex min-w-0 flex-shrink-0 items-baseline gap-2.5 rounded-lg px-1.5 py-1 hover:bg-white/[0.06]"
        aria-label="Controle Agrícola · ir para o Início"
      >
        <span className="whitespace-nowrap font-display text-[20px] font-semibold leading-none tracking-[0.01em]">Controle Agrícola</span>
        <span className="hidden whitespace-nowrap text-[12px] text-white/65 lg:inline">Unidade Capinópolis-MG</span>
      </Link>

      <div className="flex min-w-0 flex-1 justify-center px-2">
        <button
          type="button"
          onClick={onBuscar}
          className="hidden h-8 w-full max-w-[440px] items-center gap-2 rounded-lg bg-white/10 px-3 text-[13px] text-white/75 ring-1 ring-inset ring-white/15 hover:bg-white/[0.14] hover:text-white md:flex"
          title="Buscar tela (Ctrl K)"
        >
          <IconBusca size={16} />
          <span className="flex-1 truncate text-left">Buscar tela</span>
          <kbd className="rounded border border-white/25 px-1.5 py-px text-[10.5px] text-white/70">Ctrl K</kbd>
        </button>
      </div>

      <button
        type="button"
        onClick={onBuscar}
        className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-white/90 hover:bg-white/10 md:hidden"
        aria-label="Buscar tela"
      >
        <IconBusca size={18} />
      </button>
      <span className="hidden sm:block">
        <TemaToggle variante="icone" />
      </span>

      {usuario && (
        <div ref={menuRef} className="relative flex-shrink-0">
          <button
            type="button"
            onClick={() => setMenuAberto((v) => !v)}
            className={`flex h-9 items-center gap-2 rounded-lg pl-1 pr-1 hover:bg-white/10 sm:pr-2 ${menuAberto ? "bg-white/10" : ""}`}
            aria-haspopup="menu"
            aria-expanded={menuAberto}
            title={`${usuario.nome} · ${usuario.email}`}
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-crv-verde text-[11px] font-semibold text-white ring-2 ring-white/20">
              {iniciais(usuario.nome)}
            </span>
            <span className="hidden max-w-[160px] truncate text-[13px] text-white/90 xl:block">{usuario.nome}</span>
          </button>
          {menuAberto && (
            <div className="absolute right-0 top-[calc(100%+8px)] w-[280px] rounded-xl2 border border-line bg-card p-1.5 text-ink shadow-pop" role="menu">
              <div className="flex items-center gap-3 px-2.5 pb-3 pt-2">
                <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-crv-verde text-[13px] font-semibold text-white">
                  {iniciais(usuario.nome)}
                </span>
                <div className="min-w-0">
                  <div className="truncate text-[13.5px] font-semibold">{usuario.nome}</div>
                  <div className="truncate text-[12px] text-muted">{usuario.email}</div>
                  <div className="mt-0.5 text-[11.5px] text-muted">Perfil {PERFIL_LABEL[usuario.perfil] ?? usuario.perfil}</div>
                </div>
              </div>
              <div className="border-t border-line pt-1.5">
                <TemaToggle variante="linha" />
                <button
                  type="button"
                  onClick={sair}
                  disabled={saindo}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-ink hover:bg-hover disabled:opacity-60"
                >
                  <span className="text-navy-900">
                    <IconSair size={17} />
                  </span>
                  {saindo ? "Saindo…" : "Sair do sistema"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <span className="mx-1.5 hidden h-6 w-px bg-white/20 sm:block" aria-hidden="true" />
      <Link href="/painel" className="hidden flex-shrink-0 sm:block" aria-label="CRV Industrial · ir para o Início">
        <img src="/logo-crv-branca-pdf.png" alt="CRV Industrial" className="h-[30px] w-auto" />
      </Link>
    </header>
  );
}
