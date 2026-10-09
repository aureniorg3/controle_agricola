"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { filtrarMenu, nomeDaTela, podeAcessar, SECOES_MENU, telaDoEndereco } from "@/lib/menu";
import { useCallback, useEffect, useMemo, useState } from "react";
import BarraSuperior from "./BarraSuperior";
import MenuLateral from "./MenuLateral";
import OrdenarTabelas from "./OrdenarTabelas";
import { ContextoVoltar } from "./pagina";
import PaletaComandos, { registrarRecente } from "./PaletaComandos";

const CHAVE_RECOLHIDO = "ca_menu_recolhido";

function SemAcesso() {
  return (
    <div className="flex flex-1 items-center justify-center px-6">
      <div className="max-w-md rounded-xl2 border border-line bg-card px-8 py-10 text-center shadow-card">
        <h1 className="font-display text-[20px] font-semibold text-ink">Esta tela não está liberada para você</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-muted">
          O acesso às telas é definido pelo administrador em Parâmetros → Usuários. Se precisar dela, peça a liberação.
        </p>
        <Link href="/painel" className="mt-5 inline-block rounded-lg bg-navy-900 px-4 py-2 text-[13px] font-medium text-white hover:bg-navy-800">
          Ir para o Início
        </Link>
      </div>
    </div>
  );
}

/**
 * Estrutura do sistema: barra superior azul CRV (menu, busca de telas, tema, usuário, logo), menu lateral claro
 * (recolhível; gaveta no celular) e a tela ao lado. Também guarda as telas visitadas nesta aba, para o Voltar da
 * barra de comandos de cada tela.
 */
export default function AppShell({ usuario, children }) {
  const [gavetaAberta, setGavetaAberta] = useState(false);
  const [recolhido, setRecolhido] = useState(false);
  const [buscaAberta, setBuscaAberta] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const liberado = podeAcessar(pathname ?? "/", usuario?.perfil, usuario?.acessos ?? null);
  const anterior = usarTelaAnterior(pathname);
  // menu do usuário: sem os itens de administrador e só com as telas liberadas (Parâmetros → Usuários)
  const secoes = useMemo(() => filtrarMenu(SECOES_MENU, usuario?.perfil, usuario?.acessos ?? null), [usuario?.perfil, usuario?.acessos]);

  useEffect(() => {
    try {
      setRecolhido(localStorage.getItem(CHAVE_RECOLHIDO) === "1");
    } catch {
      /* sem armazenamento: menu aberto */
    }
  }, []);

  useEffect(() => {
    setGavetaAberta(false);
    if (pathname) registrarRecente(pathname === "/" ? "/painel" : (telaDoEndereco(pathname) ?? (pathname.startsWith("/painel") ? "/painel" : null)));
  }, [pathname]);

  useEffect(() => {
    function onKeyDown(e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setBuscaAberta(true);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const alternarRecolhido = useCallback(() => {
    setRecolhido((r) => {
      try {
        localStorage.setItem(CHAVE_RECOLHIDO, r ? "0" : "1");
      } catch {
        /* vale só nesta visita */
      }
      return !r;
    });
  }, []);

  // botão do menu: no celular abre a gaveta; na tela larga recolhe/expande o menu
  const botaoMenu = useCallback(() => {
    if (window.matchMedia("(min-width: 768px)").matches) alternarRecolhido();
    else setGavetaAberta(true);
  }, [alternarRecolhido]);

  const voltar = useCallback(() => router.back(), [router]);
  const contexto = useMemo(() => ({ anterior, voltar }), [anterior, voltar]);

  return (
    <ContextoVoltar.Provider value={contexto}>
      <div className="app-shell-root flex h-screen w-full flex-col overflow-hidden bg-surface">
        {/* clicar no título de uma coluna ordena qualquer tabela */}
        <OrdenarTabelas />
        <BarraSuperior usuario={usuario} onMenu={botaoMenu} onBuscar={() => setBuscaAberta(true)} />
        <div className="app-shell-corpo flex min-h-0 flex-1">
          {gavetaAberta && <div className="fixed inset-0 z-40 bg-navy-950/55 md:hidden" onClick={() => setGavetaAberta(false)} aria-hidden="true" />}
          {/* celular: gaveta por cima da tela */}
          <div
            className={`print-hide fixed inset-y-0 left-0 z-50 transition-transform duration-200 md:hidden ${gavetaAberta ? "translate-x-0" : "-translate-x-full"}`}
          >
            <MenuLateral
              secoes={secoes}
              recolhido={false}
              gaveta
              onNavigate={() => setGavetaAberta(false)}
              onAlternar={alternarRecolhido}
              onFechar={() => setGavetaAberta(false)}
            />
          </div>
          {/* tela larga: menu fixo ao lado */}
          <div className="print-hide hidden md:flex">
            <MenuLateral secoes={secoes} recolhido={recolhido} onAlternar={alternarRecolhido} />
          </div>
          <main className="flex min-w-0 flex-1 flex-col">{liberado ? children : <SemAcesso />}</main>
        </div>
        {buscaAberta && <PaletaComandos secoes={secoes} onFechar={() => setBuscaAberta(false)} />}
      </div>
    </ContextoVoltar.Provider>
  );
}

/**
 * Telas visitadas nesta aba (sessionStorage): ao passar de uma tela para outra, a barra de comandos mostra o Voltar
 * com o nome da tela de onde veio. Voltar pelo botão (ou pelo navegador) tira a tela da pilha.
 */
function usarTelaAnterior(pathname) {
  const [anterior, setAnterior] = useState(null);
  useEffect(() => {
    if (!pathname) return;
    let pilha = [];
    try {
      pilha = JSON.parse(sessionStorage.getItem("ca_nav") ?? "[]");
      if (!Array.isArray(pilha)) pilha = [];
    } catch {
      pilha = [];
    }
    if (pilha[pilha.length - 1] === pathname) {
      /* recarregou a mesma tela */
    } else if (pilha[pilha.length - 2] === pathname) pilha.pop();
    else pilha.push(pathname);
    pilha = pilha.slice(-30);
    try {
      sessionStorage.setItem("ca_nav", JSON.stringify(pilha));
    } catch {
      /* sem armazenamento: o Voltar só não aparece */
    }
    const prev = pilha.length >= 2 ? pilha[pilha.length - 2] : null;
    setAnterior(prev ? { href: prev, nome: nomeDaTela(prev) } : null);
  }, [pathname]);
  return anterior;
}
