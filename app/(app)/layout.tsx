import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import AppShell from "@/components/AppShell";
import { SESSION_COOKIE_NAME, verificarTokenSessao } from "@/lib/auth";
import { diagnosticoArmazenamento, getUsuarioPorId } from "@/lib/db";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const uid = verificarTokenSessao(token);
  const usuario = uid ? await getUsuarioPorId(uid) : undefined;

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
    <AppShell
      usuario={{ nome: `${usuario.nome} ${usuario.sobrenome}`.trim(), email: usuario.email, perfil: usuario.perfil }}
    >
      {usuario.perfil === "admin" && !armazenamento.persistente && (
        <div className="shrink-0 border-b border-alert-500/30 bg-alert-50 px-4 py-2 text-center text-[12.5px] font-semibold text-alert-600">
          ⚠ Banco de dados não configurado — usuários, ordens e a seleção de
          ordens visíveis não estão sendo salvos. Configure a variável{" "}
          <code>DATABASE_URL</code> no Render (ver README, seção &quot;Deploy
          no Render&quot;).
        </div>
      )}
      {children}
    </AppShell>
  );
}
