import { usuarioAtual } from "@/lib/db";
import EstoqueClient from "./EstoqueClient";

export const dynamic = "force-dynamic";

export default async function Page() {
  const usuario = await usuarioAtual();
  return <EstoqueClient perfil={usuario?.perfil ?? "leitura"} nomeUsuario={usuario?.nome ?? "Usuário"} />;
}
