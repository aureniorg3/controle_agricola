import { listSafrasCadastro, usuarioAtual } from "@/lib/db";
import SafrasClient from "./SafrasClient";

export const dynamic = "force-dynamic";

export default async function SafrasCadastroPage() {
  const [safras, usuario] = await Promise.all([listSafrasCadastro(), usuarioAtual()]);
  return <SafrasClient safrasIniciais={safras} perfil={usuario?.perfil ?? "leitura"} />;
}
