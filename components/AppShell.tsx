"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { nomeDaTela, podeAcessar } from "@/lib/menu";
import { useEffect, useState, type ReactNode } from "react";
import { IconMenu } from "./icons";
import OrdenarTabelas from "./OrdenarTabelas";
import Sidebar from "./Sidebar";

interface UsuarioLogado {
  nome: string;
  email: string;
  perfil: string;
  /** telas liberadas (Parâmetros → Usuários); null = todas */
  acessos?: string[] | null;
}

function SemAcesso() {
  return (
    <div className="flex flex-1 items-center justify-center px-6">
      <div className="max-w-md rounded-xl2 border border-line bg-card px-8 py-10 text-center shadow-card">
        <h1 className="text-[16px] font-semibold text-ink">Esta tela não está liberada para você</h1>
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
 * Dono do estado "menu mobile aberto/fechado" — vive aqui (não dentro do
 * Sidebar) porque o botão de abrir precisa continuar visível mesmo com o
 * menu fora da tela (`-translate-x-full`); se estivesse dentro do próprio
 * Sidebar, o botão sumiria junto com ele.
 */
export default function AppShell({ usuario, children }: { usuario?: UsuarioLogado; children: ReactNode }) {
  const [mobileAberto, setMobileAberto] = useState(false);
  const pathname = usePathname();
  const liberado = podeAcessar(pathname ?? "/", usuario?.perfil, usuario?.acessos ?? null);
  const anterior = usarTelaAnterior(pathname);
  const router = useRouter();

  return (
    <div className="app-shell-root flex h-screen w-full overflow-hidden bg-surface">
      {/* clicar no título de uma coluna ordena qualquer tabela */}
      <OrdenarTabelas />
      {mobileAberto && (
        <div
          className="fixed inset-0 z-40 bg-navy-950/60 md:hidden"
          onClick={() => setMobileAberto(false)}
          aria-hidden="true"
        />
      )}
      <div
        className={`print-hide fixed inset-y-0 left-0 z-50 transition-transform duration-200 md:static md:z-auto md:translate-x-0 ${
          mobileAberto ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <Sidebar usuario={usuario} onNavigate={() => setMobileAberto(false)} />
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="print-hide flex flex-shrink-0 items-center gap-2.5 border-b border-line bg-card px-3 py-2 md:hidden">
          <button
            type="button"
            onClick={() => setMobileAberto(true)}
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-ink hover:bg-surface"
            aria-label="Abrir menu"
          >
            <IconMenu size={20} />
          </button>
          <Link href="/painel" aria-label="Ir para o Início / Dashboard">
            <img src="/logo-crv-azul.png" alt="CRV Industrial" className="h-6 w-auto" />
          </Link>
        </div>
        {anterior && (
          <div className="print-hide flex flex-shrink-0 items-center border-b border-line bg-card px-3 py-1 md:px-6">
            <button
              type="button"
              onClick={() => router.back()}
              className="flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[12px] font-medium text-[#2E5FA8] hover:bg-[#2E5FA8]/[0.06]"
              title="Voltar para a tela anterior"
            >
              <span aria-hidden>←</span> Voltar{anterior.nome ? <span className="font-normal text-muted">· {anterior.nome}</span> : null}
            </button>
          </div>
        )}
        {liberado ? children : <SemAcesso />}
      </div>
    </div>
  );
}

/**
 * Telas visitadas nesta aba (sessionStorage): ao passar de uma tela para outra, aparece o botão Voltar com o nome da
 * tela de onde veio. Voltar pelo botão (ou pelo navegador) tira a tela da pilha.
 */
function usarTelaAnterior(pathname: string | null): { href: string; nome: string | null } | null {
  const [anterior, setAnterior] = useState<{ href: string; nome: string | null } | null>(null);
  useEffect(() => {
    if (!pathname) return;
    let pilha: string[] = [];
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
