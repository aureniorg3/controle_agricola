import { usuarioAtual } from "@/lib/db";
import PainelOSClient from "./PainelOSClient";

export const dynamic = "force-dynamic";

export default async function Page() {
  const usuario = await usuarioAtual();
  return <PainelOSClient perfil={usuario?.perfil ?? "leitura"} />;
}
