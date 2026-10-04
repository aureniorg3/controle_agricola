import ResumoClient from "./ResumoClient";
import { usuarioAtual } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function Page() {
  const usuario = await usuarioAtual();
  return <ResumoClient perfil={usuario?.perfil ?? "leitura"} />;
}
