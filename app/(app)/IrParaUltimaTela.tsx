"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

const TELA_PADRAO = "/acompanhamentos/ordens-de-corte";

/** Abre a última tela em que o usuário estava (guardada neste navegador); sem ela, vai para as Ordens de Corte. */
export default function IrParaUltimaTela() {
  const router = useRouter();
  useEffect(() => {
    let destino = TELA_PADRAO;
    try {
      const guardada = localStorage.getItem("ca_ultima_tela");
      if (guardada && guardada.startsWith("/") && !guardada.startsWith("//")) destino = guardada;
    } catch {
      /* usa a tela padrão */
    }
    router.replace(destino);
  }, [router]);
  return <div className="flex flex-1 items-center justify-center text-[13px] text-muted">Abrindo…</div>;
}
