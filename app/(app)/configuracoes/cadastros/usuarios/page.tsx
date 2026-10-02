import { listUsuarios, usuarioAtual } from "@/lib/db";
import { ehAdmin } from "@/lib/permissoes";
import UsuariosClient from "./UsuariosClient";

export const dynamic = "force-dynamic";

export default async function UsuariosPage() {
  const usuario = await usuarioAtual();

  if (!usuario || !ehAdmin(usuario.perfil)) {
    return (
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex flex-shrink-0 items-center gap-3 border-b border-line bg-card px-6 py-3">
          <nav className="min-w-0 flex-1 text-[13px] text-muted">
            <span className="uppercase tracking-wide text-[11px] text-muted">Configurações</span>
            <div className="truncate text-[15px] font-bold text-ink">Cadastros · Usuários</div>
          </nav>
        </header>
        <div className="flex flex-1 items-center justify-center px-6">
          <div className="max-w-md rounded-xl2 border border-dashed border-line bg-card px-8 py-12 text-center shadow-card">
            <h1 className="text-[16px] font-bold text-ink">Somente administradores</h1>
            <p className="mt-2 text-[13px] leading-relaxed text-muted">
              O cadastro de usuários e níveis de acesso é restrito a administradores. Se você
              precisa de acesso, peça para um administrador te promover em Cadastros · Usuários.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const todos = await listUsuarios();
  const usuarios = todos.map(({ senhaHash: _senhaHash, ...resto }) => resto);
  return <UsuariosClient initialUsuarios={usuarios} usuarioLogadoId={usuario.id} />;
}
