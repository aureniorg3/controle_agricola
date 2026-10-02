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
  const [filtroFrente, setFiltroFrente] = useState("todas");
  const [editandoId, setEditandoId] = useState<string | null>(null);

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
        method: editandoId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editandoId ?? undefined, frente, metaDiaT: valor, vigencia }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Não foi possível salvar a meta.");
      setMeta("");
      setEditandoId(null);
      router.refresh();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível salvar a meta.");
    } finally {
      setSalvando(false);
    }
  }

  function editar(m: MetaFrente) {
    setErro(null);
    setEditandoId(m.id);
    setFrente(m.frente);
    setMeta(String(m.metaDiaT).replace(".", ","));
    setVigencia(m.vigencia);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function cancelarEdicao() {
    setEditandoId(null);
    setMeta("");
    setVigencia(todayISO());
    setErro(null);
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

  const frentesComMeta = useMemo(
    () => Array.from(new Set(metasIniciais.map((m) => m.frente))).sort((a, b) => a.localeCompare(b)),
    [metasIniciais]
  );

  const linhas = useMemo(
    () =>
      metasIniciais
        .filter((m) => filtroFrente === "todas" || m.frente === filtroFrente)
        .sort((a, b) => a.frente.localeCompare(b.frente) || b.vigencia.localeCompare(a.vigencia)),
    [metasIniciais, filtroFrente]
  );

  function situacao(m: MetaFrente): "vigente" | "futura" | "anterior" {
    if (m.vigencia > hoje) return "futura";
    const vigenteHoje = metaDoDia(metasIniciais, m.frente, hoje);
    const maisRecente = metasIniciais
      .filter((x) => x.frente === m.frente && x.vigencia <= hoje)
      .reduce((a, b) => (b.vigencia > a.vigencia ? b : a), m);
    return maisRecente.id === m.id && vigenteHoje === m.metaDiaT ? "vigente" : "anterior";
  }

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
            <h2 className="mb-3 text-[14px] font-bold text-ink">{editandoId ? "Editar meta" : "Cadastrar meta"}</h2>
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
              <Campo label="Data (vigência)">
                <input type="date" value={vigencia} onChange={(e) => setVigencia(e.target.value)} className={INPUT} />
              </Campo>
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={salvando || !frente}
                  className="rounded-lg bg-navy-900 px-4 py-2 text-[13px] font-semibold text-white shadow-card hover:bg-navy-800 disabled:opacity-50"
                >
                  {salvando ? "Salvando…" : editandoId ? "Salvar alteração" : "Cadastrar"}
                </button>
                {editandoId && (
                  <button
                    type="button"
                    onClick={cancelarEdicao}
                    className="rounded-lg border border-line bg-card px-4 py-2 text-[13px] font-semibold text-navy-800 shadow-card hover:bg-surface"
                  >
                    Cancelar
                  </button>
                )}
              </div>
            </div>
            {erro && <p className="mt-2 text-[12.5px] font-medium text-alert-600">{erro}</p>}
            <p className="mt-3 text-[12px] leading-relaxed text-muted">
              A meta é diária (toneladas por dia) e vale da data informada em diante, até uma nova meta da mesma frente.
              Os dias anteriores continuam com a meta antiga (e, antes da primeira meta, ficam sem meta). Cadastrar de
              novo na mesma data substitui o valor; use "Editar" na lista para corrigir uma meta já lançada. Semana, mês e safra somam a meta de cada dia, contando só a partir da primeira entrada de cana da frente em Ordens de Corte.
            </p>
          </form>
        )}

        {metasIniciais.length === 0 ? (
          <div className="rounded-xl2 border border-dashed border-line bg-card px-6 py-14 text-center text-muted">
            Nenhuma meta cadastrada ainda.
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl2 border border-line bg-card shadow-card">
            <div className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-4 py-2.5">
              <h2 className="text-[14px] font-bold text-ink">Metas cadastradas</h2>
              <select
                value={filtroFrente}
                onChange={(e) => setFiltroFrente(e.target.value)}
                className="rounded-md border border-line bg-card px-2.5 py-1.5 text-[12.5px] text-ink focus:border-brand-600 focus:outline-none"
                aria-label="Filtrar por frente"
              >
                <option value="todas">Todas as frentes</option>
                {frentesComMeta.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
              <span className="ml-auto text-[12px] text-muted">
                {linhas.length} meta{linhas.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="border-b border-line bg-surface text-left text-muted">
                    <th className="px-4 py-2 font-semibold">Frente</th>
                    <th className="px-3 py-2 font-semibold">Data</th>
                    <th className="px-3 py-2 text-right font-semibold">Meta (t/dia)</th>
                    <th className="px-3 py-2 font-semibold">Status</th>
                    <th className="w-24 px-2 py-2 text-right font-semibold">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {linhas.map((m) => {
                    const sit = situacao(m);
                    return (
                      <tr key={m.id} className="border-b border-line last:border-0">
                        <td className="px-4 py-1.5 font-semibold text-ink">{m.frente}</td>
                        <td className="px-3 py-1.5 text-ink">{fmtDateBR(m.vigencia)}</td>
                        <td className="px-3 py-1.5 text-right font-semibold tabular text-ink">{fmtT(m.metaDiaT)}</td>
                        <td className="px-3 py-1.5">
                          {sit === "vigente" && (
                            <span className="rounded-full bg-good-50 px-2 py-0.5 text-[10.5px] font-bold text-good-600">
                              Vigente
                            </span>
                          )}
                          {sit === "futura" && (
                            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10.5px] font-bold text-amber-600">
                              Futura
                            </span>
                          )}
                          {sit === "anterior" && <span className="text-[11px] text-muted">Substituída</span>}
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          {podeGravar && (
                            <button
                              type="button"
                              onClick={() => editar(m)}
                              aria-label="Editar meta"
                              className="mr-1 rounded px-1.5 py-0.5 text-[12px] font-semibold text-brand-700 hover:bg-brand-50"
                            >
                              Editar
                            </button>
                          )}
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
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
