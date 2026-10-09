"use client";

import { IconOlho, IconOlhoOculto } from "./icons";
import { useState } from "react";

export function Campo({ label, children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-semibold text-muted">{label}</span>
      {children}
    </label>
  );
}

export function ModalShell({ titulo, onFechar, children }) {
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
export function InputSenha({ className, ...props }) {
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
        {visivel ? <IconOlhoOculto size={16} /> : <IconOlho size={16} />}
      </button>
    </div>
  );
}
