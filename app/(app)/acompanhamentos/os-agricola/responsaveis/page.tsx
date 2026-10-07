import CadastroClient from "@/app/(app)/configuracoes/cadastros/[slug]/CadastroClient";
import { usuarioAtual } from "@/lib/db";
import { prepararOSAgr } from "@/lib/db-os-agr";

export const dynamic = "force-dynamic";

export default async function Page() {
  // garante a carga inicial dos cadastros da O.S.
  const [usuario] = await Promise.all([usuarioAtual(), prepararOSAgr()]);
  return <CadastroClient slug="responsaveis-os" perfil={usuario?.perfil ?? "leitura"} categoria="Ordem de Serviço Agr." />;
}
