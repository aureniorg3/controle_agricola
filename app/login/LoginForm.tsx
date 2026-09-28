"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export default function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setCarregando(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, senha }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErro(data?.erro || "Não foi possível entrar.");
        setCarregando(false);
        return;
      }
      const params = new URLSearchParams(window.location.search);
      const next = params.get("next") || "/";
      router.push(next);
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
          <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-white shadow-card">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M12 21V6" stroke="#1d54b8" strokeWidth="2" strokeLinecap="round" />
              <path d="M12 10c-4-1-6.5-3.2-7.5-6.5C8.5 3.8 11.3 6 12 10z" fill="#1d54b8" />
              <path d="M12 15c4-1 6.5-3.2 7.5-6.5C15.5 8.8 12.7 11 12 15z" fill="#2a6bd6" />
            </svg>
          </div>
          <div className="text-center">
            <div className="text-[15px] font-bold tracking-wide text-white">CRV INDUSTRIAL</div>
            <div className="text-[12px] text-brand-300">
              Controle Agrícola · Unidade Capinópolis-MG
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="rounded-xl2 border border-line bg-card p-6 shadow-pop">
          <h1 className="mb-1 text-[16px] font-bold text-ink">Entrar</h1>
          <p className="mb-5 text-[12.5px] text-muted">
            Acesse com seu e-mail e senha cadastrados.
          </p>

          <label className="mb-1 block text-[12px] font-medium text-ink" htmlFor="email">
            E-mail
          </label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="input mb-3"
            placeholder="seu.email@crv.com.br"
          />

          <label className="mb-1 block text-[12px] font-medium text-ink" htmlFor="senha">
            Senha
          </label>
          <input
            id="senha"
            type="password"
            autoComplete="current-password"
            required
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
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
            {carregando ? "Entrando..." : "Entrar"}
          </button>
        </form>

        <p className="mt-4 text-center text-[11.5px] text-slate-400">
          Problemas para acessar? Fale com o administrador do sistema.
        </p>
      </div>
    </div>
  );
}
