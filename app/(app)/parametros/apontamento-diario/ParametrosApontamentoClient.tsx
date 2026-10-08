"use client";

import { useState } from "react";
import BotaoLog from "@/components/BotaoLog";
import { CAMPOS_APONTAMENTO, REGRAS_PADRAO, type RegrasApontamento } from "@/lib/atividades";

/** Parâmetros › Apontamento Diário: quais campos o lançamento exige. */
export default function ParametrosApontamentoClient({ regrasIniciais }: { regrasIniciais: RegrasApontamento }) {
  const [regras, setRegras] = useState(regrasIniciais);
  const [salvas, setSalvas] = useState(regrasIniciais);
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState<{ texto: string; erro: boolean } | null>(null);
  const mudou = JSON.stringify(regras) !== JSON.stringify(salvas);

  async function salvar() {
    setSalvando(true);
    setMsg(null);
    try {
      const res = await fetch("/api/parametros/apontamento", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ regras }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "Não foi possível salvar.");
      setRegras(j.regras);
      setSalvas(j.regras);
      setMsg({ texto: "Parâmetros salvos. Valem para os próximos lançamentos.", erro: false });
    } catch (e) {
      setMsg({ texto: e instanceof Error ? e.message : "Não foi possível salvar.", erro: true });
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <header className="flex flex-shrink-0 items-center gap-3 border-b border-line bg-card px-6 py-3">
        <nav className="min-w-0 flex-1 text-[13px] text-muted">
          <span className="text-[11px]">Parâmetros</span>
          <div className="truncate text-[15px] font-semibold text-ink">Apontamento Diário</div>
        </nav>
        <BotaoLog titulo="Log dos parâmetros do Apontamento Diário" filtro={{ modulo: "Parâmetros", entidade: "Apontamento Diário" }} />
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        <section className="max-w-3xl rounded-xl2 border border-line bg-card p-5 shadow-card">
          <h2 className="text-[14.5px] font-semibold text-ink">Campos obrigatórios</h2>
          <p className="mb-4 mt-1 text-[12.5px] leading-relaxed text-muted">
            Marque o que o Apontamento Diário exige para gravar. Boletim, data, fazenda e área realizada são sempre obrigatórios. Na tela, os campos marcados aparecem com
            asterisco (*).
          </p>
          {msg && (
            <p className={`mb-3 rounded-md border px-3 py-2 text-[12.5px] ${msg.erro ? "border-alert-500/40 bg-alert-50 text-alert-700" : "border-good-500/40 bg-good-50 text-good-700"}`}>
              {msg.texto}
            </p>
          )}
          <div className="divide-y divide-line/70 rounded-lg border border-line">
            {CAMPOS_APONTAMENTO.map((c) => (
              <label key={c.campo} className="flex cursor-pointer items-start gap-3 px-4 py-2.5 hover:bg-surface/60">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4"
                  checked={regras[c.campo]}
                  onChange={(e) => setRegras((r) => ({ ...r, [c.campo]: e.target.checked }))}
                />
                <span className="min-w-0">
                  <span className="text-[13px] font-medium text-ink">{c.rotulo}</span>
                  {c.ajuda && <span className="block text-[11.5px] text-muted">{c.ajuda}</span>}
                </span>
                <span className={`ml-auto flex-shrink-0 text-[11.5px] ${regras[c.campo] ? "font-medium text-[#2E5FA8]" : "text-muted"}`}>
                  {regras[c.campo] ? "Obrigatório" : "Opcional"}
                </span>
              </label>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => setRegras(REGRAS_PADRAO)}
              className="rounded-lg border border-line bg-card px-3.5 py-1.5 text-[12.5px] font-medium text-navy-800 hover:bg-surface"
            >
              Voltar ao padrão
            </button>
            <button
              type="button"
              disabled={!mudou || salvando}
              onClick={salvar}
              className="rounded-lg bg-navy-900 px-5 py-1.5 text-[12.5px] font-medium text-white hover:bg-navy-800 disabled:opacity-40"
            >
              {salvando ? "Salvando…" : "Salvar"}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
