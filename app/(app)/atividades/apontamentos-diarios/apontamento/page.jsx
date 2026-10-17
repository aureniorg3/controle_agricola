import { usuarioAtual } from "@/lib/db";
import { carregarApontamentosWhatsappIniciais } from "@/lib/db-import-whatsapp";
import ApontamentoAtividadeClient from "./ApontamentoAtividadeClient";

export const dynamic = "force-dynamic";

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const texto = (v) => (typeof v === "string" ? v : "");

export default async function Page({ searchParams }) {
  // primeira carga dos apontamentos do grupo C.A.P.F.O (WhatsApp), uma vez só
  await carregarApontamentosWhatsappIniciais();
  const usuario = await usuarioAtual();
  // vindo de um link (ex.: a O.S. na Análise): a lista já abre filtrada pela O.S., no período dela
  const q = await searchParams;
  const os = texto(q?.os).replace(/\D/g, "");
  const inicial = os ? { os, de: ISO.test(texto(q?.de)) ? q.de : null, ate: ISO.test(texto(q?.ate)) ? q.ate : null } : null;
  return (
    <ApontamentoAtividadeClient
      perfil={usuario?.perfil ?? "leitura"}
      nomeUsuario={usuario ? `${usuario.nome} ${usuario.sobrenome}`.trim() : ""}
      inicial={inicial}
    />
  );
}
