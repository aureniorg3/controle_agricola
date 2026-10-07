import { usuarioAtual } from "@/lib/db";
import ApontamentoAtividadeClient from "./ApontamentoAtividadeClient";

export const dynamic = "force-dynamic";

export default async function Page() {
  const usuario = await usuarioAtual();
  return <ApontamentoAtividadeClient perfil={usuario?.perfil ?? "leitura"} nomeUsuario={usuario ? `${usuario.nome} ${usuario.sobrenome}`.trim() : ""} />;
}
