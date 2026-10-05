import { usuarioAtual } from "@/lib/db";
import SaldoClient from "./SaldoClient";

export const dynamic = "force-dynamic";

export default async function Page() {
  const usuario = await usuarioAtual();
  return <SaldoClient perfil={usuario?.perfil ?? "leitura"} nomeUsuario={usuario?.nome ?? "Usuário"} />;
}
