import { redirect } from "next/navigation";
import { SemAcesso } from "@/components/AppShell";
import { usuarioAtual } from "@/lib/db";
import { paginaInicial } from "@/lib/menu";

export const dynamic = "force-dynamic";

/**
 * A entrada do sistema é a página inicial do usuário: o Início / Dashboard ou, sem ele liberado em Parâmetros →
 * Usuários, a primeira tela liberada do menu. Sem nenhuma tela liberada fica aqui, com o aviso (sem redirecionar em
 * círculo).
 */
export default async function RootPage() {
  const usuario = await usuarioAtual();
  const destino = paginaInicial(usuario?.perfil, usuario?.acessos ?? null);
  if (destino) redirect(destino);
  return <SemAcesso destino={null} />;
}
