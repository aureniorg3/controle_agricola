import { usuarioAtual } from "@/lib/db";
import EmprestimosClient from "./EmprestimosClient";

export const dynamic = "force-dynamic";

export default async function Page() {
  const usuario = await usuarioAtual();
  return <EmprestimosClient perfil={usuario?.perfil ?? "leitura"} />;
}
