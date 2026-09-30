"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export default function TrocarSenhaForm({ nomeCompleto }: { nomeCompleto: string }) {
  const router = useRouter();
  const [novaSenha, setNovaSenha] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    if (novaSenha.length < 6) {
      setErro("A nova senha precisa ter ao menos 6 caracteres.");
      return;
    }
    if (novaSenha !== confirmar) {
      setErro("As duas senhas não são iguais.");
      return;
    }
    setCarregando(true);
    try {
      const res = await fetch("/api/auth/trocar-senha", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ novaSenha }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErro(data?.error || "Não foi possível trocar a senha.");
        setCarregando(false);
        return;
      }
      router.push("/");
      router.refresh();
    } catch {
      setErro("Não foi possível conectar ao servidor.");
      setCarregando(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-navy-950 px-4">
      <div className="w-full max-w-[380px]">
        <div className="mb-6 flex flex-col items-center gap-3">
          <img src="/logo-crv-branca.png" alt="CRV Industrial" className="h-auto w-64" />
          <div className="text-center text-[12px] text-brand-300">
            Controle Agrícola · Unidade Capinópolis-MG
          </div>
        </div>

        <form onSubmit={handleSubmit} className="rounded-xl2 border border-line bg-card p-6 shadow-pop">
          <h1 className="mb-1 text-[16px] font-bold text-ink">Trocar senha</h1>
          <p className="mb-5 text-[12.5px] text-muted">
            Olá, {nomeCompleto}. Essa é sua senha provisória — defina uma nova antes de continuar.
          </p>

          <label className="mb-1 block text-[12px] font-medium text-ink" htmlFor="nova-senha">
            Nova senha
          </label>
          <input
            id="nova-senha"
            type="password"
            autoComplete="new-password"
            required
            autoFocus
            value={novaSenha}
            onChange={(e) => setNovaSenha(e.target.value)}
            className="input mb-3"
            placeholder="Mínimo 6 caracteres"
          />

          <label className="mb-1 block text-[12px] font-medium text-ink" htmlFor="confirmar-senha">
            Confirmar nova senha
          </label>
          <input
            id="confirmar-senha"
            type="password"
            autoComplete="new-password"
            required
            value={confirmar}
            onChange={(e) => setConfirmar(e.target.value)}
            className="input mb-4"
            placeholder="••••••••"
          />

          {erro && (
            <div className="mb-4 rounded-lg border border-alert-500/30 bg-alert-50 px-3 py-2 text-[12.5px] text-alert-600">
              {erro}
            </div>
          )}

          <button
            type="submit"
            disabled={carregando}
            className="w-full rounded-lg bg-brand-600 px-3 py-2 text-[13.5px] font-semibold text-white transition-colors hover:bg-brand-700 disabled:opacity-60"
          >
            {carregando ? "Salvando..." : "Trocar senha e entrar"}
          </button>
        </form>
      </div>
    </div>
  );
}
