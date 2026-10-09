import { usuarioAtual } from "@/lib/db";
import DashboardAtividadesClient from "./DashboardAtividadesClient";

export const dynamic = "force-dynamic";

export default async function Page() {
  const usuario = await usuarioAtual();
  return (
    <DashboardAtividadesClient perfil={usuario?.perfil ?? "leitura"} nomeUsuario={usuario ? `${usuario.nome} ${usuario.sobrenome ?? ""}`.trim() : "Usuário"} />
  );
}
