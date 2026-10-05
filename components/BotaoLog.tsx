"use client";

import { useState } from "react";
import AuditoriaModal from "./AuditoriaModal";

/** Botão "Log de alterações" do cabeçalho de uma tela: abre o histórico (quem, quando, o quê) do que aquela tela lança. */
export default function BotaoLog({
  titulo,
  filtro,
}: {
  titulo: string;
  filtro: { modulo?: string; entidade?: string; chave?: string; q?: string };
}) {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="rounded-lg border border-line bg-card px-3.5 py-1.5 text-[13px] font-semibold text-navy-800 shadow-card hover:bg-surface"
      >
        Log de alterações
      </button>
      {aberto && <AuditoriaModal titulo={titulo} filtro={filtro} onFechar={() => setAberto(false)} />}
    </>
  );
}
