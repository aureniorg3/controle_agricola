import { listUsuarios, usuarioAtual } from "@/lib/db";
import { ehAdmin } from "@/lib/permissoes";
import ParametrosUsuariosClient from "./ParametrosUsuariosClient";

export const dynamic = "force-dynamic";

export default async function Page() {
  const usuario = await usuarioAtual();
  if (!usuario || !ehAdmin(usuario.perfil)) {
    return (
      <div className="flex flex-1 items-center justify-center px-6">
        <div className="max-w-md rounded-xl2 border border-line bg-card px-8 py-10 text-center shadow-card">
          <h1 className="text-[16px] font-semibold text-ink">Somente administradores</h1>
          <p className="mt-2 text-[13px] leading-relaxed text-muted">Os Parâmetros ficam disponíveis só para o perfil Administrador.</p>
        </div>
      </div>
    );
  }
  const usuarios = (await listUsuarios()).map(({ senhaHash: _senhaHash, ...resto }) => resto);
  return <ParametrosUsuariosClient usuariosIniciais={usuarios} idLogado={usuario.id} />;
}
