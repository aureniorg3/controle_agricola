import { usuarioAtual } from "@/lib/db";
import InsumosClient from "./InsumosClient";

export const dynamic = "force-dynamic";

export default async function Page() {
  const usuario = await usuarioAtual();
  return <InsumosClient perfil={usuario?.perfil ?? "leitura"} />;
}
