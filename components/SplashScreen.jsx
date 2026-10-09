"use client";

import { useEffect, useState } from "react";

const DURACAO_MS = 1600;
const CHAVE = "ca_splash_visto";

export default function SplashScreen() {
  const [visivel, setVisivel] = useState(true);
  const [saindo, setSaindo] = useState(false);

  useEffect(() => {
    let jaVisto = false;
    try {
      jaVisto = sessionStorage.getItem(CHAVE) === "1";
    } catch {}
    if (jaVisto) {
      setVisivel(false);
      return;
    }
    const t1 = setTimeout(() => setSaindo(true), DURACAO_MS);
    const t2 = setTimeout(() => {
      setVisivel(false);
      try {
        sessionStorage.setItem(CHAVE, "1");
      } catch {}
    }, DURACAO_MS + 400);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  if (!visivel) return null;

  return (
    <div
      className={`fixed inset-0 z-[100] flex flex-col items-center justify-center bg-navy-950 transition-opacity duration-300 ${
        saindo ? "opacity-0" : "opacity-100"
      }`}
      role="status"
      aria-label="Carregando Controle Agrícola"
    >
      <img src="/logo-crv-branca-pdf.png" alt="CRV Industrial" className="w-48 max-w-[55vw]" />
      <h1 className="mt-8 font-display text-[30px] font-semibold text-white">Controle Agrícola</h1>
      <p className="mt-1 text-[12px] text-slate-400">Safra 2026/27 · Unidade Capinópolis-MG</p>
      <div className="mt-8 h-1.5 w-64 max-w-[70vw] overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full bg-crv-verde" style={{ animation: `splash-progress ${DURACAO_MS}ms ease-out forwards` }} />
      </div>
      <p className="mt-3 text-[11px] font-medium uppercase tracking-widest text-slate-500">Carregando…</p>
    </div>
  );
}
