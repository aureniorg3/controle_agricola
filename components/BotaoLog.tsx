"use client";

import { useState } from "react";
import AuditoriaModal from "./AuditoriaModal";
import { IconHistorico } from "./icons";
import { Comando } from "./pagina";

/** Botão "Log de alterações" do cabeçalho de uma tela: abre o histórico (quem, quando, o quê) do que aquela tela lança. */
export default function BotaoLog({
  titulo,
  filtro,
  rotulo = "Log de alterações",
}: {
  titulo: string;
  filtro: { modulo?: string; entidade?: string; chave?: string; q?: string };
  /** texto do botão, quando a tela tem mais de um log */
  rotulo?: string;
}) {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <Comando icone={<IconHistorico size={16} />} onClick={() => setAberto(true)} title="Quem alterou o quê e quando nesta tela">
        {rotulo}
      </Comando>
      {aberto && <AuditoriaModal titulo={titulo} filtro={filtro} onFechar={() => setAberto(false)} />}
    </>
  );
}
