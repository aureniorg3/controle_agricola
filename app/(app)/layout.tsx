import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import { SESSION_COOKIE_NAME, verificarTokenSessao } from "@/lib/auth";
import { diagnosticoArmazenamento, getUsuarioPorId } from "@/lib/db";

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

  const armazenamento = diagnosticoArmazenamento();

  return (
    <div className="flex h-screen w-full overflow-hidden bg-surface">
      <Sidebar
        usuario={{ nome: `${usuario.nome} ${usuario.sobrenome}`.trim(), email: usuario.email, perfil: usuario.perfil }}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        {usuario.perfil === "admin" && !armazenamento.persistente && (
          <div className="shrink-0 border-b border-alert-500/30 bg-alert-50 px-4 py-2 text-center text-[12.5px] font-semibold text-alert-600">
            ⚠ Armazenamento não persistente — usuários, ordens e a seleção de
            ordens visíveis serão apagados no próximo deploy/restart. Configure
            um disco persistente e a variável <code>DATA_DIR</code> no Render
            (ver README, seção &quot;Deploy no Render&quot;).
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
