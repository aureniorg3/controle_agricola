import { usuarioAtual } from "@/lib/db";
import SaldoResumoClient from "./SaldoResumoClient";

export const dynamic = "force-dynamic";

export default async function Page() {
  const usuario = await usuarioAtual();
  return <SaldoResumoClient perfil={usuario?.perfil ?? "leitura"} nomeUsuario={usuario?.nome ?? "Usuário"} />;
}
