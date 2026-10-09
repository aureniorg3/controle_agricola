import { listUsuarios, usuarioAtual } from "@/lib/db";
import { CabecalhoPagina, CorpoPagina, Pagina } from "@/components/pagina";
import { ehAdmin } from "@/lib/permissoes";
import ParametrosUsuariosClient from "./ParametrosUsuariosClient";

export const dynamic = "force-dynamic";

export default async function Page() {
  const usuario = await usuarioAtual();
  if (!usuario || !ehAdmin(usuario.perfil)) {
    return (
      <Pagina>
        <CabecalhoPagina titulo="Usuários" categoria="Configurações · Parâmetros" />
        <CorpoPagina className="flex items-center justify-center">
          <div className="max-w-md rounded-xl2 border border-line bg-card px-8 py-10 text-center shadow-card">
            <h2 className="text-[16px] font-semibold text-ink">Somente administradores</h2>
            <p className="mt-2 text-[13px] leading-relaxed text-muted">Os Parâmetros ficam disponíveis só para o perfil Administrador.</p>
          </div>
        </CorpoPagina>
      </Pagina>
    );
  }
  const usuarios = (await listUsuarios()).map(({ senhaHash: _senhaHash, ...resto }) => resto);
  return <ParametrosUsuariosClient usuariosIniciais={usuarios} idLogado={usuario.id} />;
}
