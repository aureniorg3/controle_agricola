"use client";

import { useState, type ReactNode } from "react";
import { IconMenu } from "./icons";
import Sidebar from "./Sidebar";

interface UsuarioLogado {
  nome: string;
  email: string;
  perfil: string;
}

/**
 * Dono do estado "menu mobile aberto/fechado" — vive aqui (não dentro do
 * Sidebar) porque o botão de abrir precisa continuar visível mesmo com o
 * menu fora da tela (`-translate-x-full`); se estivesse dentro do próprio
 * Sidebar, o botão sumiria junto com ele.
 */
export default function AppShell({ usuario, children }: { usuario?: UsuarioLogado; children: ReactNode }) {
  const [mobileAberto, setMobileAberto] = useState(false);

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
        {children}
      </div>
    </div>
  );
}
