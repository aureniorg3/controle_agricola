"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { podeAcessar } from "@/lib/menu";
import { useEffect, useState, type ReactNode } from "react";
import { IconMenu } from "./icons";
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

  // lembra a última tela aberta, para o sistema voltar nela ao entrar de novo
  useEffect(() => {
    if (!pathname || pathname === "/" || pathname === "/login" || pathname === "/trocar-senha" || !liberado) return;
    try {
      localStorage.setItem("ca_ultima_tela", pathname);
    } catch {
      /* sem armazenamento: abre na tela padrão */
    }
  }, [pathname, liberado]);

  return (
    <div className="app-shell-root flex h-screen w-full overflow-hidden bg-surface">
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
          <img src="/logo-crv-azul.png" alt="CRV Industrial" className="h-6 w-auto" />
        </div>
        {liberado ? children : <SemAcesso />}
      </div>
    </div>
  );
}
