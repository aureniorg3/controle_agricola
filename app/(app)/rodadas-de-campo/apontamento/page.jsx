import ApontamentoClient from "./ApontamentoClient";
import { usuarioAtual } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function Page() {
  const usuario = await usuarioAtual();
  return <ApontamentoClient perfil={usuario?.perfil ?? "leitura"} />;
}
