import { usuarioAtual } from "@/lib/db";
import OrdensOSClient from "./OrdensOSClient";

export const dynamic = "force-dynamic";

export default async function Page() {
  const usuario = await usuarioAtual();
  return <OrdensOSClient perfil={usuario?.perfil ?? "leitura"} />;
}
