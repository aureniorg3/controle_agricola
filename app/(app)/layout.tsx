import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import { SESSION_COOKIE_NAME, verificarTokenSessao } from "@/lib/auth";
import { getUsuarioPorId } from "@/lib/db";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const uid = verificarTokenSessao(token);
  const usuario = uid ? getUsuarioPorId(uid) : undefined;

  if (!usuario) {
    redirect("/login");
  }

  // Senha provisória (recém-cadastrado, ou resetada por um admin) — barra
  // todo o resto do sistema até trocar em /trocar-senha, que é a única
  // rota fora deste layout que ainda exige essa checagem.
  const pathname = (await headers()).get("x-pathname") ?? "";
  if (usuario.precisaTrocarSenha && pathname !== "/trocar-senha") {
    redirect("/trocar-senha");
  }

  return (
    <div className="flex h-screen w-full overflow-hidden bg-surface">
      <Sidebar
        usuario={{ nome: `${usuario.nome} ${usuario.sobrenome}`.trim(), email: usuario.email, perfil: usuario.perfil }}
      />
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
