import { usuarioAtual } from "@/lib/db";
import FazendasTalhoesClient from "./FazendasTalhoesClient";

export const dynamic = "force-dynamic";

export default async function Page() {
  const usuario = await usuarioAtual();
  return <FazendasTalhoesClient perfil={usuario?.perfil ?? "leitura"} acessos={usuario?.acessos ?? null} />;
}
