import { agregarSafras, baseSafraFazenda, usuarioAtual } from "@/lib/db";
import HistoricoSafrasClient from "./HistoricoSafrasClient";

export const dynamic = "force-dynamic";

export default async function HistoricoSafrasPage() {
  const [resumo, base, usuario] = await Promise.all([agregarSafras("safra"), baseSafraFazenda(), usuarioAtual()]);
  return <HistoricoSafrasClient resumo={resumo} base={base} perfil={usuario?.perfil ?? "leitura"} />;
}
