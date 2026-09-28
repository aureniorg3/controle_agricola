import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import { SESSION_COOKIE_NAME, verificarTokenSessao } from "@/lib/auth";
import { getUsuarioPorId } from "@/lib/db";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const token = cookies().get(SESSION_COOKIE_NAME)?.value;
  const uid = verificarTokenSessao(token);
  const usuario = uid ? getUsuarioPorId(uid) : undefined;

  if (!usuario) {
    redirect("/login");
  }

  return (
    <div className="flex h-screen w-full overflow-hidden bg-surface">
      <Sidebar
        usuario={{ nome: usuario.nome, email: usuario.email, perfil: usuario.perfil }}
      />
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
