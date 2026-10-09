import { usuarioAtual } from "@/lib/db";
import { carregarApontamentosWhatsappIniciais } from "@/lib/db-import-whatsapp";
import ApontamentoAtividadeClient from "./ApontamentoAtividadeClient";

export const dynamic = "force-dynamic";

export default async function Page() {
  // primeira carga dos apontamentos do grupo C.A.P.F.O (WhatsApp), uma vez só
  await carregarApontamentosWhatsappIniciais();
  const usuario = await usuarioAtual();
  return <ApontamentoAtividadeClient perfil={usuario?.perfil ?? "leitura"} nomeUsuario={usuario ? `${usuario.nome} ${usuario.sobrenome}`.trim() : ""} />;
}
