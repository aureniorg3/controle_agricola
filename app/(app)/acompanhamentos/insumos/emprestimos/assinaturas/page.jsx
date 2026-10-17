import CadastroClient from "@/app/(app)/configuracoes/cadastros/[slug]/CadastroClient";
import { usuarioAtual } from "@/lib/db";
import { prepararAssinaturas } from "@/lib/db-emprestimos";

export const dynamic = "force-dynamic";

/** Insumos › Empréstimos › Assinaturas: quem assina o termo de empréstimo, com a função e a ordem (nível hierárquico). */
export default async function Page() {
  // a carga inicial das assinaturas (os nomes que o termo já usava)
  const [usuario] = await Promise.all([usuarioAtual(), prepararAssinaturas()]);
  return <CadastroClient slug="assinaturas-emprestimo" perfil={usuario?.perfil ?? "leitura"} categoria="Insumos · Empréstimos" />;
}
