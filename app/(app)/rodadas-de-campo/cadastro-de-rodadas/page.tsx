import RodadasCadClient from "./RodadasCadClient";
import { usuarioAtual } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function Page() {
  const usuario = await usuarioAtual();
  return <RodadasCadClient perfil={usuario?.perfil ?? "leitura"} />;
}
