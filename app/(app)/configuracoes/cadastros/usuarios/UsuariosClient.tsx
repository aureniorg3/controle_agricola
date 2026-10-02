"use client";

import { useState } from "react";
import { PerfilUsuario, UsuarioPublico } from "@/lib/types";
import { PERFIL_DESCRICAO, PERFIL_LABEL } from "@/lib/permissoes";
import { fmtDateBR } from "@/lib/format";
import { Campo, InputSenha, ModalShell } from "@/components/ui";

const PERFIS: PerfilUsuario[] = ["leitura", "gravacao", "admin"];

function PerfilBadge({ perfil }: { perfil: PerfilUsuario }) {
  const cores: Record<PerfilUsuario, string> = {
    leitura: "bg-surface text-muted",
    gravacao: "bg-brand-50 text-brand-700",
    admin: "bg-good-50 text-good-600",
  };
  return (
    <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${cores[perfil]}`}>
      {PERFIL_LABEL[perfil]}
    </span>
  );
}

export default function UsuariosClient({
  initialUsuarios,
  usuarioLogadoId,
}: {
  initialUsuarios: UsuarioPublico[];
  usuarioLogadoId: string;
}) {
  const [usuarios, setUsuarios] = useState<UsuarioPublico[]>(initialUsuarios);
  const [novoAberto, setNovoAberto] = useState(false);
  const [editando, setEditando] = useState<UsuarioPublico | null>(null);
  const [erroGeral, setErroGeral] = useState<string | null>(null);

  async function refetch() {
    const res = await fetch("/api/usuarios");
    if (res.ok) {
      const data = await res.json();
      setUsuarios(data.usuarios);
    }
  }

  async function excluir(usuario: UsuarioPublico) {
    if (!confirm(`Excluir o usuário "${usuario.nome} ${usuario.sobrenome}"? Isso não pode ser desfeito.`)) return;
    setErroGeral(null);
    const res = await fetch(`/api/usuarios/${usuario.id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setErroGeral(data?.error ?? "Não foi possível excluir o usuário.");
      return;
    }
    await refetch();
  }

  async function alternarAtivo(usuario: UsuarioPublico) {
    setErroGeral(null);
    const res = await fetch(`/api/usuarios/${usuario.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ativo: !usuario.ativo }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setErroGeral(data?.error ?? "Não foi possível atualizar o usuário.");
      return;
    }
    await refetch();
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <header className="flex flex-shrink-0 items-center gap-3 border-b border-line bg-card px-6 py-3">
        <nav className="min-w-0 flex-1 text-[13px] text-muted">
          <span className="uppercase tracking-wide text-[11px] text-muted">Configurações</span>
          <div className="truncate text-[15px] font-bold text-ink">Cadastros · Usuários</div>
        </nav>
        <button
          type="button"
          onClick={() => setNovoAberto(true)}
          className="flex items-center gap-1.5 rounded-lg bg-navy-900 px-3.5 py-2 text-[13px] font-semibold text-white shadow-card hover:bg-navy-800"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
            <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
          </svg>
          Novo usuário
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        <p className="mb-4 max-w-2xl text-[13px] leading-relaxed text-muted">
          Controla quem entra no sistema e o que cada um pode fazer. <b className="text-ink">Leitura</b>{" "}
          {PERFIL_DESCRICAO.leitura.toLowerCase()} <b className="text-ink">Gravação</b>{" "}
          {PERFIL_DESCRICAO.gravacao.toLowerCase()} <b className="text-ink">Administrador</b>{" "}
          {PERFIL_DESCRICAO.admin.toLowerCase()}
        </p>

        {erroGeral && (
          <div className="mb-4 rounded-lg border border-alert-500/30 bg-alert-50 px-3 py-2 text-[12.5px] text-alert-600">
            {erroGeral}
          </div>
        )}

        <div className="overflow-x-auto rounded-xl2 border border-line bg-card shadow-card">
          <table className="w-full min-w-[720px] text-[12.5px]">
            <thead>
              <tr className="border-b border-line bg-surface text-left text-muted">
                <th className="px-4 py-2 font-semibold">Nome</th>
                <th className="px-3 py-2 font-semibold">Usuário</th>
                <th className="px-3 py-2 font-semibold">E-mail</th>
                <th className="px-3 py-2 font-semibold">Nível</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="px-3 py-2 font-semibold">Criado em</th>
                <th className="px-3 py-2 font-semibold">Ações</th>
              </tr>
            </thead>
            <tbody>
              {usuarios.map((u) => (
                <tr key={u.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-1.5 font-medium text-ink">
                    {u.nome} {u.sobrenome}
                    {u.id === usuarioLogadoId && (
                      <span className="ml-1.5 text-[11px] font-normal text-muted">(você)</span>
                    )}
                    {u.precisaTrocarSenha && (
                      <span
                        className="ml-1.5 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-600"
                        title="Ainda não trocou a senha provisória"
                      >
                        senha provisória
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-muted">{u.usuario}</td>
                  <td className="px-3 py-1.5 text-muted">{u.email}</td>
                  <td className="px-3 py-1.5">
                    <PerfilBadge perfil={u.perfil} />
                  </td>
                  <td className="px-3 py-1.5">
                    <span
                      className={`rounded-full px-2 py-1 text-[11px] font-semibold ${
                        u.ativo ? "bg-good-50 text-good-600" : "bg-alert-50 text-alert-600"
                      }`}
                    >
                      {u.ativo ? "Ativo" : "Desativado"}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-muted">{fmtDateBR(u.criadoEm.slice(0, 10))}</td>
                  <td className="px-3 py-1.5">
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        onClick={() => setEditando(u)}
                        className="rounded-md border border-line px-2.5 py-1 text-[12px] font-semibold text-ink hover:bg-surface"
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        onClick={() => alternarAtivo(u)}
                        disabled={u.id === usuarioLogadoId}
                        className="rounded-md border border-line px-2.5 py-1 text-[12px] font-semibold text-ink hover:bg-surface disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {u.ativo ? "Desativar" : "Ativar"}
                      </button>
                      <button
                        type="button"
                        onClick={() => excluir(u)}
                        disabled={u.id === usuarioLogadoId}
                        className="rounded-md border border-alert-500/30 px-2.5 py-1 text-[12px] font-semibold text-alert-600 hover:bg-alert-50 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Excluir
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {novoAberto && (
        <NovoUsuarioModal
          onFechar={() => setNovoAberto(false)}
          onCriado={async () => {
            setNovoAberto(false);
            await refetch();
          }}
        />
      )}

      {editando && (
        <EditarUsuarioModal
          usuario={editando}
          ehVoceMesmo={editando.id === usuarioLogadoId}
          onFechar={() => setEditando(null)}
          onSalvo={async () => {
            setEditando(null);
            await refetch();
          }}
        />
      )}
    </div>
  );
}

interface ResultadoCriacao {
  usuario: string;
  senhaProvisoria: string;
}

function NovoUsuarioModal({ onFechar, onCriado }: { onFechar: () => void; onCriado: () => void }) {
  const [nome, setNome] = useState("");
  const [sobrenome, setSobrenome] = useState("");
  const [email, setEmail] = useState("");
  const [usuario, setUsuario] = useState("");
  const [perfil, setPerfil] = useState<PerfilUsuario>("leitura");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ResultadoCriacao | null>(null);

  async function salvar() {
    setEnviando(true);
    setErro(null);
    try {
      const res = await fetch("/api/usuarios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome, sobrenome, email, usuario, perfil }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErro(data?.error ?? "Não foi possível criar o usuário.");
        return;
      }
      setResultado({ usuario, senhaProvisoria: data.senhaProvisoria });
    } catch {
      setErro("Não foi possível enviar. Verifique a conexão e tente novamente.");
    } finally {
      setEnviando(false);
    }
  }

  if (resultado) {
    return (
      <ModalShell titulo="Usuário criado" onFechar={onCriado}>
        <div className="rounded-lg border border-brand-500/25 bg-brand-50 px-3 py-2.5 text-[12.5px] text-brand-700">
          <p className="font-semibold">Repasse esses dados de acesso pra {resultado.usuario}:</p>
          <p className="mt-2">
            Usuário: <span className="font-mono text-[13px] text-ink">{resultado.usuario}</span>
          </p>
          <p className="mt-1">
            Senha provisória:{" "}
            <span className="rounded-md bg-card px-2 py-0.5 font-mono text-[13px] text-ink">
              {resultado.senhaProvisoria}
            </span>
          </p>
          <p className="mt-2 text-[11px] text-brand-700/80">
            No primeiro acesso, o sistema vai pedir pra trocar essa senha por uma definitiva.
          </p>
        </div>
        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={onCriado}
            className="rounded-lg bg-navy-900 px-4 py-2 text-[13px] font-semibold text-white"
          >
            Concluir
          </button>
        </div>
      </ModalShell>
    );
  }

  return (
    <ModalShell titulo="Novo usuário" onFechar={onFechar}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Campo label="Nome">
            <input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              className="w-full rounded-lg border border-line px-3 py-1.5 text-[13px]"
            />
          </Campo>
          <Campo label="Sobrenome">
            <input
              value={sobrenome}
              onChange={(e) => setSobrenome(e.target.value)}
              className="w-full rounded-lg border border-line px-3 py-1.5 text-[13px]"
            />
          </Campo>
        </div>
        <Campo label="E-mail">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-line px-3 py-1.5 text-[13px]"
          />
        </Campo>
        <Campo label="Nome de usuário (login)">
          <input
            value={usuario}
            onChange={(e) => setUsuario(e.target.value.toLowerCase())}
            placeholder="ex.: joao.silva"
            className="w-full rounded-lg border border-line px-3 py-1.5 text-[13px]"
          />
          <span className="mt-1 block text-[11.5px] text-muted">
            3-30 caracteres: letras, números, ponto, hífen ou underscore. O login aceita e-mail ou esse usuário.
          </span>
        </Campo>
        <Campo label="Nível de acesso">
          <select
            value={perfil}
            onChange={(e) => setPerfil(e.target.value as PerfilUsuario)}
            className="w-full rounded-lg border border-line bg-card px-3 py-1.5 text-[13px]"
          >
            {PERFIS.map((p) => (
              <option key={p} value={p}>
                {PERFIL_LABEL[p]}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-[11.5px] text-muted">{PERFIL_DESCRICAO[perfil]}</span>
        </Campo>
        <p className="text-[11.5px] text-muted">
          A senha é gerada automaticamente e mostrada na tela ao concluir — o usuário troca por uma definitiva no
          primeiro acesso.
        </p>
      </div>

      {erro && (
        <div className="mt-3 rounded-lg border border-alert-500/30 bg-alert-50 px-3 py-2 text-[12.5px] text-alert-600">
          {erro}
        </div>
      )}

      <div className="mt-5 flex justify-end gap-2">
        <button
          type="button"
          onClick={onFechar}
          className="rounded-lg border border-line px-4 py-2 text-[13px] font-semibold text-ink"
        >
          Cancelar
        </button>
        <button
          type="button"
          disabled={!nome.trim() || !sobrenome.trim() || !email.trim() || !usuario.trim() || enviando}
          onClick={salvar}
          className="rounded-lg bg-navy-900 px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-50"
        >
          {enviando ? "Criando..." : "Criar usuário"}
        </button>
      </div>
    </ModalShell>
  );
}

function EditarUsuarioModal({
  usuario,
  ehVoceMesmo,
  onFechar,
  onSalvo,
}: {
  usuario: UsuarioPublico;
  ehVoceMesmo: boolean;
  onFechar: () => void;
  onSalvo: () => void;
}) {
  const [nome, setNome] = useState(usuario.nome);
  const [sobrenome, setSobrenome] = useState(usuario.sobrenome);
  const [nomeUsuario, setNomeUsuario] = useState(usuario.usuario);
  const [perfil, setPerfil] = useState<PerfilUsuario>(usuario.perfil);
  const [novaSenha, setNovaSenha] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar() {
    setEnviando(true);
    setErro(null);
    try {
      const res = await fetch(`/api/usuarios/${usuario.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome, sobrenome, usuario: nomeUsuario, perfil, senha: novaSenha || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErro(data?.error ?? "Não foi possível salvar.");
        return;
      }
      onSalvo();
    } catch {
      setErro("Não foi possível enviar. Verifique a conexão e tente novamente.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <ModalShell titulo={`Editar ${usuario.nome} ${usuario.sobrenome}`} onFechar={onFechar}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Campo label="Nome">
            <input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              className="w-full rounded-lg border border-line px-3 py-1.5 text-[13px]"
            />
          </Campo>
          <Campo label="Sobrenome">
            <input
              value={sobrenome}
              onChange={(e) => setSobrenome(e.target.value)}
              className="w-full rounded-lg border border-line px-3 py-1.5 text-[13px]"
            />
          </Campo>
        </div>
        <Campo label="E-mail">
          <input
            value={usuario.email}
            disabled
            className="w-full rounded-lg border border-line bg-surface px-3 py-1.5 text-[13px] text-muted"
          />
        </Campo>
        <Campo label="Nome de usuário (login)">
          <input
            value={nomeUsuario}
            onChange={(e) => setNomeUsuario(e.target.value.toLowerCase())}
            className="w-full rounded-lg border border-line px-3 py-1.5 text-[13px]"
          />
          <span className="mt-1 block text-[11.5px] text-muted">
            3-30 caracteres: letras, números, ponto, hífen ou underscore.
          </span>
        </Campo>
        <Campo label="Nível de acesso">
          <select
            value={perfil}
            onChange={(e) => setPerfil(e.target.value as PerfilUsuario)}
            disabled={ehVoceMesmo}
            className="w-full rounded-lg border border-line bg-card px-3 py-1.5 text-[13px] disabled:opacity-50"
          >
            {PERFIS.map((p) => (
              <option key={p} value={p}>
                {PERFIL_LABEL[p]}
              </option>
            ))}
          </select>
          {ehVoceMesmo ? (
            <span className="mt-1 block text-[11.5px] text-muted">
              Você não pode mudar o próprio nível de acesso.
            </span>
          ) : (
            <span className="mt-1 block text-[11.5px] text-muted">{PERFIL_DESCRICAO[perfil]}</span>
          )}
        </Campo>
        <Campo label="Nova senha (deixe em branco para manter a atual)">
          <InputSenha
            value={novaSenha}
            onChange={(e) => setNovaSenha(e.target.value)}
            className="w-full rounded-lg border border-line px-3 py-1.5 text-[13px]"
          />
          {!ehVoceMesmo && (
            <span className="mt-1 block text-[11.5px] text-muted">
              Se preencher, essa senha vira provisória — o usuário vai precisar trocar no próximo acesso.
            </span>
          )}
        </Campo>
      </div>

      {erro && (
        <div className="mt-3 rounded-lg border border-alert-500/30 bg-alert-50 px-3 py-2 text-[12.5px] text-alert-600">
          {erro}
        </div>
      )}

      <div className="mt-5 flex justify-end gap-2">
        <button
          type="button"
          onClick={onFechar}
          className="rounded-lg border border-line px-4 py-2 text-[13px] font-semibold text-ink"
        >
          Cancelar
        </button>
        <button
          type="button"
          disabled={
            !nome.trim() ||
            !sobrenome.trim() ||
            !nomeUsuario.trim() ||
            (novaSenha.length > 0 && novaSenha.length < 6) ||
            enviando
          }
          onClick={salvar}
          className="rounded-lg bg-navy-900 px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-50"
        >
          {enviando ? "Salvando..." : "Salvar"}
        </button>
      </div>
    </ModalShell>
  );
}
