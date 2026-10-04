import CadastroClient from "@/app/(app)/configuracoes/cadastros/[slug]/CadastroClient";
import { usuarioAtual } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function Page() {
  const usuario = await usuarioAtual();
  return <CadastroClient slug="nivel-infestacao" perfil={usuario?.perfil ?? "leitura"} categoria="Rodadas de Campo · Cadastros" />;
}
