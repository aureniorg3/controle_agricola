import { CabecalhoPagina, CorpoPagina, Pagina } from "@/components/pagina";
import { listUsuarios, usuarioAtual } from "@/lib/db";
import { ehAdmin } from "@/lib/permissoes";
import UsuariosClient from "./UsuariosClient";

export const dynamic = "force-dynamic";

export default async function UsuariosPage() {
  const usuario = await usuarioAtual();

  if (!usuario || !ehAdmin(usuario.perfil)) {
    return (
      <Pagina>
        <CabecalhoPagina titulo="Usuários" categoria="Configurações · Cadastros" />
        <CorpoPagina className="flex items-center justify-center">
          <div className="max-w-md rounded-xl2 border border-dashed border-line bg-card px-8 py-12 text-center shadow-card">
            <h2 className="font-display text-[20px] font-semibold text-ink">Somente administradores</h2>
            <p className="mt-2 text-[13px] leading-relaxed text-muted">
              O cadastro de usuários e níveis de acesso é restrito a administradores. Se você
              precisa de acesso, peça para um administrador te promover em Cadastros · Usuários.
            </p>
          </div>
        </CorpoPagina>
      </Pagina>
    );
  }

  const todos = await listUsuarios();
  const usuarios = todos.map(({ senhaHash: _senhaHash, ...resto }) => resto);
  return <UsuariosClient initialUsuarios={usuarios} usuarioLogadoId={usuario.id} />;
}
