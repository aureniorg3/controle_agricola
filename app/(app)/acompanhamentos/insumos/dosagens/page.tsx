import { usuarioAtual } from "@/lib/db";
import DosagensClient from "./DosagensClient";

export const dynamic = "force-dynamic";

export default async function Page() {
  const usuario = await usuarioAtual();
  return <DosagensClient perfil={usuario?.perfil ?? "leitura"} />;
}
