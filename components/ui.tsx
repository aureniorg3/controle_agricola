"use client";

import { useState, type InputHTMLAttributes, type ReactNode } from "react";

export function Campo({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-semibold text-muted">{label}</span>
      {children}
    </label>
  );
}

export function ModalShell({
  titulo,
  onFechar,
  children,
}: {
  titulo: string;
  onFechar: () => void;
  children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy-950/50 px-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl2 bg-card p-5 shadow-pop">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[16px] font-bold text-ink">{titulo}</h2>
          <button
            type="button"
            onClick={onFechar}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-surface"
            aria-label="Fechar"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Campo de senha com botão de olho para mostrar/ocultar o que foi digitado
 * — aceita as mesmas props de um `<input>` normal (menos `type`). */
export function InputSenha({
  className,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  const [visivel, setVisivel] = useState(false);
  return (
    <div className="relative">
      <input type={visivel ? "text" : "password"} className={`${className ?? ""} pr-9`} {...props} />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setVisivel((v) => !v)}
        aria-label={visivel ? "Ocultar senha" : "Mostrar senha"}
        className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-muted hover:text-ink"
      >
        {visivel ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path
              d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8M9.5 5.2A10.4 10.4 0 0112 5c5 0 9 4 10 7-.4 1.2-1.3 2.6-2.6 3.9M6.6 6.6C4.4 8 2.9 9.9 2 12c1 3 5 7 10 7 1.3 0 2.5-.3 3.6-.7"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path
              d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinejoin="round"
            />
            <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
          </svg>
        )}
      </button>
    </div>
  );
}
