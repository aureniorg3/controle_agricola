"use client";

import { useEffect, useState } from "react";

const CHAVE = "ca_tema";

/** Troca entre tema claro e escuro; a escolha fica neste navegador e é aplicada antes da tela abrir (ver layout). */
export default function TemaToggle({ compacto = false }: { compacto?: boolean }) {
  const [escuro, setEscuro] = useState(false);

  useEffect(() => {
    setEscuro(document.documentElement.classList.contains("dark"));
  }, []);

  function alternar() {
    const novo = !escuro;
    setEscuro(novo);
    document.documentElement.classList.toggle("dark", novo);
    try {
      localStorage.setItem(CHAVE, novo ? "escuro" : "claro");
    } catch {
      /* sem armazenamento: vale só nesta visita */
    }
  }

  const rotulo = escuro ? "Tema claro" : "Tema escuro";
  return (
    <button
      type="button"
      onClick={alternar}
      title={rotulo}
      aria-label={rotulo}
      aria-pressed={escuro}
      className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-[12px] font-medium text-slate-400 transition-colors hover:bg-white/10 hover:text-white ${compacto ? "justify-center" : ""}`}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="flex-shrink-0">
        {escuro ? (
          <>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" />
          </>
        ) : (
          <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
        )}
      </svg>
      {!compacto && <span>{rotulo}</span>}
    </button>
  );
}
