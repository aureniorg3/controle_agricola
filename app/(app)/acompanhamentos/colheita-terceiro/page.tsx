import { ultimaDataPesagem, usuarioAtual } from "@/lib/db";
import ColheitaTerceiroClient from "./ColheitaTerceiroClient";

export const dynamic = "force-dynamic";

export default async function Page() {
  const [usuario, ultimaData] = await Promise.all([usuarioAtual(), ultimaDataPesagem()]);
  return <ColheitaTerceiroClient nomeUsuario={usuario?.nome ?? "Usuário"} ultimaData={ultimaData} />;
}
