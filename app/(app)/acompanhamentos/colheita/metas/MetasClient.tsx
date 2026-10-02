"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Campo } from "@/components/ui";
import { fmtDateBR, fmtT, todayISO } from "@/lib/format";
import { metaDoDia } from "@/lib/period";
import { podeEditar } from "@/lib/permissoes";
import type { MetaFrente, PerfilUsuario } from "@/lib/types";

const INPUT =
  "w-full rounded-md border border-line bg-card px-3 py-2 text-[13px] text-ink focus:border-brand-600 focus:outline-none";

export default function MetasClient({
  metasIniciais,
  frentes,
  perfil,
}: {
  metasIniciais: MetaFrente[];
  frentes: string[];
  perfil: PerfilUsuario;
}) {
  const router = useRouter();
  const podeGravar = podeEditar(perfil);
  const [frente, setFrente] = useState(frentes[0] ?? "");
  const [meta, setMeta] = useState("");
  const [vigencia, setVigencia] = useState(todayISO());
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const todasFrentes = useMemo(
    () => Array.from(new Set([...frentes, ...metasIniciais.map((m) => m.frente)])).sort((a, b) => a.localeCompare(b)),
    [frentes, metasIniciais]
  );
  const hoje = todayISO();

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    const valor = Number(meta.replace(/\./g, "").replace(",", "."));
    if (!frente) return setErro("Escolha a frente.");
    if (meta.trim() === "" || !Number.isFinite(valor) || valor < 0) {
      return setErro("Informe a meta em toneladas por dia.");
    }
    setSalvando(true);
    try {
      const res = await fetch("/api/metas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ frente, metaDiaT: valor, vigencia }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Não foi possível salvar a meta.");
      setMeta("");
      router.refresh();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível salvar a meta.");
    } finally {
      setSalvando(false);
    }
  }

  async function excluir(m: MetaFrente) {
    const texto = `Excluir a meta de ${fmtT(m.metaDiaT)} t/dia da ${m.frente} (a partir de ${fmtDateBR(m.vigencia)})?`;
    if (!window.confirm(texto)) return;
    const res = await fetch("/api/metas", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: m.id }),
    });
    if (res.ok) router.refresh();
    else window.alert("Não foi possível excluir a meta.");
  }

  const porFrente = todasFrentes
    .map((f) => ({
      frente: f,
      metas: metasIniciais.filter((m) => m.frente === f).sort((a, b) => b.vigencia.localeCompare(a.vigencia)),
    }))
    .filter((g) => g.metas.length > 0);

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <header className="flex flex-shrink-0 items-center gap-3 border-b border-line bg-card px-6 py-3">
        <nav className="min-w-0 flex-1 text-[13px] text-muted">
          <span className="text-[11px] uppercase tracking-wide">Acompanhamentos · Colheita</span>
          <div className="truncate text-[15px] font-bold text-ink">Metas</div>
        </nav>
        {!podeGravar && (
          <div className="rounded-full border border-line bg-surface px-3 py-1.5 text-[12px] font-semibold text-muted">
            Somente leitura
          </div>
        )}
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        {podeGravar && (
          <form onSubmit={salvar} className="mb-5 rounded-xl2 border border-line bg-card p-4 shadow-card">
            <h2 className="mb-3 text-[14px] font-bold text-ink">Cadastrar meta</h2>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-[1.2fr_1fr_1fr_auto] md:items-end">
              <Campo label="Frente">
                <select value={frente} onChange={(e) => setFrente(e.target.value)} className={INPUT}>
                  {todasFrentes.length === 0 && <option value="">Nenhuma frente importada ainda</option>}
                  {todasFrentes.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </Campo>
              <Campo label="Meta (t/dia)">
                <input
                  value={meta}
                  onChange={(e) => setMeta(e.target.value)}
                  inputMode="decimal"
                  placeholder="Ex.: 1.500,00"
                  className={INPUT}
                />
              </Campo>
              <Campo label="Vale a partir de">
                <input type="date" value={vigencia} onChange={(e) => setVigencia(e.target.value)} className={INPUT} />
              </Campo>
              <button
                type="submit"
                disabled={salvando || !frente}
                className="rounded-lg bg-navy-900 px-4 py-2 text-[13px] font-semibold text-white shadow-card hover:bg-navy-800 disabled:opacity-50"
              >
                {salvando ? "Salvando…" : "Cadastrar"}
              </button>
            </div>
            {erro && <p className="mt-2 text-[12.5px] font-medium text-alert-600">{erro}</p>}
            <p className="mt-3 text-[12px] leading-relaxed text-muted">
              A meta é diária (toneladas por dia) e vale da data informada em diante, até uma nova meta da mesma frente.
              Os dias anteriores continuam com a meta antiga (e, antes da primeira meta, ficam sem meta). Cadastrar de
              novo na mesma data substitui o valor. Semana, mês e safra somam a meta de cada dia.
            </p>
          </form>
        )}

        {porFrente.length === 0 ? (
          <div className="rounded-xl2 border border-dashed border-line bg-card px-6 py-14 text-center text-muted">
            Nenhuma meta cadastrada ainda.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
            {porFrente.map((g) => (
              <div key={g.frente} className="overflow-hidden rounded-xl2 border border-line bg-card shadow-card">
                <div className="flex items-center justify-between bg-navy-900 px-4 py-2 text-white">
                  <span className="text-[13px] font-bold">{g.frente}</span>
                  <span className="text-[11.5px] text-slate-300">
                    Hoje: <b className="text-white">{fmtT(metaDoDia(metasIniciais, g.frente, hoje))} t/dia</b>
                  </span>
                </div>
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr className="border-b border-line bg-surface text-left text-muted">
                      <th className="px-4 py-1.5 font-semibold">A partir de</th>
                      <th className="px-3 py-1.5 text-right font-semibold">Meta (t/dia)</th>
                      <th className="w-10 px-2 py-1.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {g.metas.map((m) => (
                      <tr key={m.id} className="border-b border-line last:border-0">
                        <td className="px-4 py-1.5 text-ink">
                          {fmtDateBR(m.vigencia)}
                          {m.vigencia > hoje && (
                            <span className="ml-2 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-600">
                              futura
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-right font-semibold tabular text-ink">{fmtT(m.metaDiaT)}</td>
                        <td className="px-2 py-1.5 text-right">
                          {podeGravar && (
                            <button
                              type="button"
                              onClick={() => excluir(m)}
                              aria-label="Excluir meta"
                              className="rounded px-1.5 text-[15px] leading-none text-muted hover:bg-alert-50 hover:text-alert-600"
                            >
                              ×
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
