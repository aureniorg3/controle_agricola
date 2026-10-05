import { usuarioAtual } from "@/lib/db";
import ColheitaTerceiroClient from "./ColheitaTerceiroClient";

export const dynamic = "force-dynamic";

export default async function Page() {
  const usuario = await usuarioAtual();
  return <ColheitaTerceiroClient nomeUsuario={usuario?.nome ?? "Usuário"} />;
}
