"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Campo } from "@/components/ui";
import { frenteDoEquipamento } from "@/lib/conferencia";
import BotaoLog from "@/components/BotaoLog";
import { fmtDataHora } from "@/components/AuditoriaModal";
import { fmtDateBR, todayISO } from "@/lib/format";
import { podeEditar } from "@/lib/permissoes";
import type { EquiptoFrente, PerfilUsuario } from "@/lib/types";
import { ehBooleano, ehDataIso, ehTexto, ehUmDe, usarPersistido } from "@/lib/usar-persistido";
import BotaoLimparFiltros from "@/components/BotaoLimparFiltros";

const INPUT =
  "w-full rounded-md border border-line bg-card px-3 py-2 text-[13px] text-ink focus:border-brand-600 focus:outline-none";

export default function EquiptoFrenteClient({
  lancamentosIniciais,
  frentes,
  nomesEquipamentos,
  perfil,
}: {
  lancamentosIniciais: EquiptoFrente[];
  frentes: string[];
  nomesEquipamentos: Record<string, string>;
  perfil: PerfilUsuario;
}) {
  const router = useRouter();
  const podeGravar = podeEditar(perfil);
  const [eqp, setEqp] = useState("");
  const [frente, setFrente] = useState(frentes[0] ?? "");
  const [vigencia, setVigencia] = useState(todayISO());
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [filtroFrente, setFiltroFrente] = usarPersistido("equipto.frente", "todas", ehTexto);
  const [filtroEqp, setFiltroEqp] = usarPersistido("equipto.eqp", "", ehTexto);
  const algumFiltroAtivo = filtroFrente !== "todas" || filtroEqp !== "";
  function limparFiltros() {
    setFiltroFrente("todas");
    setFiltroEqp("");
  }

  const hoje = todayISO();
  const codigosConhecidos = useMemo(
    () => Array.from(new Set([...Object.keys(nomesEquipamentos), ...lancamentosIniciais.map((l) => l.eqp)])).sort(),
    [nomesEquipamentos, lancamentosIniciais]
  );

  const linhas = useMemo(() => {
    const termo = filtroEqp.trim().toLowerCase();
    return lancamentosIniciais
      .filter((l) => filtroFrente === "todas" || l.frente === filtroFrente)
      .filter(
        (l) =>
          !termo || l.eqp.toLowerCase().includes(termo) || (nomesEquipamentos[l.eqp] ?? "").toLowerCase().includes(termo)
      )
      .sort((a, b) => a.eqp.localeCompare(b.eqp, undefined, { numeric: true }) || b.vigencia.localeCompare(a.vigencia));
  }, [lancamentosIniciais, filtroFrente, filtroEqp, nomesEquipamentos]);

  function situacao(l: EquiptoFrente): "vigente" | "futura" | "anterior" {
    if (l.vigencia > hoje) return "futura";
    return frenteDoEquipamento(lancamentosIniciais, l.eqp, hoje) === l.frente &&
      !lancamentosIniciais.some((x) => x.eqp === l.eqp && x.vigencia > l.vigencia && x.vigencia <= hoje)
      ? "vigente"
      : "anterior";
  }

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    if (!eqp.trim()) return setErro("Informe o código do equipamento.");
    if (!frente) return setErro("Escolha a frente.");
    setSalvando(true);
    try {
      const res = await fetch("/api/equipto-frente", {
        method: editandoId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editandoId ?? undefined, eqp: eqp.trim(), frente, vigencia }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Não foi possível salvar.");
      setEqp("");
      setEditandoId(null);
      router.refresh();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível salvar.");
    } finally {
      setSalvando(false);
    }
  }

  function editar(l: EquiptoFrente) {
    setErro(null);
    setEditandoId(l.id);
    setEqp(l.eqp);
    setFrente(l.frente);
    setVigencia(l.vigencia);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function cancelarEdicao() {
    setEditandoId(null);
    setEqp("");
    setVigencia(todayISO());
    setErro(null);
  }

  async function excluir(l: EquiptoFrente) {
    if (!window.confirm(`Excluir o lançamento do equipamento ${l.eqp} na ${l.frente} (a partir de ${fmtDateBR(l.vigencia)})?`)) {
      return;
    }
    const res = await fetch("/api/equipto-frente", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: l.id }),
    });
    if (res.ok) router.refresh();
    else window.alert("Não foi possível excluir o lançamento.");
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <header className="flex flex-shrink-0 items-center gap-3 border-b border-line bg-card px-6 py-3">
        <nav className="min-w-0 flex-1 text-[13px] text-muted">
          <span className="text-[11px] uppercase tracking-wide">Acompanhamentos · Colheita</span>
          <div className="truncate text-[15px] font-bold text-ink">Equipto Frente</div>
        </nav>
        <BotaoLog titulo="Log do Equipto Frente" filtro={{ modulo: "Colheita", entidade: "Equipto Frente" }} />
        {!podeGravar && (
          <div className="rounded-full border border-line bg-surface px-3 py-1.5 text-[12px] font-semibold text-muted">
            Somente leitura
          </div>
        )}
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        {podeGravar && (
          <form onSubmit={salvar} className="mb-5 rounded-xl2 border border-line bg-card p-4 shadow-card">
            <h2 className="mb-3 text-[14px] font-bold text-ink">{editandoId ? "Editar lançamento" : "Lançar equipamento"}</h2>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_1.2fr_1fr_auto] md:items-end">
              <Campo label="Código do Equipamento">
                <input
                  value={eqp}
                  onChange={(e) => setEqp(e.target.value)}
                  list="equipamentos-conhecidos"
                  placeholder="Ex.: 62503"
                  className={INPUT}
                />
                <datalist id="equipamentos-conhecidos">
                  {codigosConhecidos.map((c) => (
                    <option key={c} value={c}>
                      {nomesEquipamentos[c] ?? ""}
                    </option>
                  ))}
                </datalist>
              </Campo>
              <Campo label="Frente">
                <select value={frente} onChange={(e) => setFrente(e.target.value)} className={INPUT}>
                  {frentes.length === 0 && <option value="">Nenhuma frente disponível ainda</option>}
                  {frentes.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
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
                  {salvando ? "Salvando…" : editandoId ? "Salvar alteração" : "Lançar"}
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
              O equipamento fica na frente informada a partir da data (vigência). Se ele mudar de frente, lance de novo
              com a nova frente e a data da mudança: a conferência usa a nova frente dessa data em diante e a frente
              anterior até o dia anterior à mudança. Antes do primeiro lançamento, o equipamento fica sem cadastro.
            </p>
          </form>
        )}

        {lancamentosIniciais.length === 0 ? (
          <div className="rounded-xl2 border border-dashed border-line bg-card px-6 py-14 text-center text-muted">
            Nenhum equipamento lançado ainda.
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl2 border border-line bg-card shadow-card">
            <div className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-4 py-2.5">
              <h2 className="text-[14px] font-bold text-ink">Equipamentos lançados</h2>
              <select
                value={filtroFrente}
                onChange={(e) => setFiltroFrente(e.target.value)}
                aria-label="Filtrar por frente"
                className="rounded-md border border-line bg-card px-2.5 py-1.5 text-[12.5px] text-ink focus:border-brand-600 focus:outline-none"
              >
                <option value="todas">Todas as frentes</option>
                {frentes.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
              <input
                value={filtroEqp}
                onChange={(e) => setFiltroEqp(e.target.value)}
                placeholder="Buscar equipamento…"
                className="rounded-md border border-line bg-card px-2.5 py-1.5 text-[12.5px] text-ink focus:border-brand-600 focus:outline-none"
              />
              <BotaoLimparFiltros ativo={algumFiltroAtivo} onLimpar={limparFiltros} />
              <span className="ml-auto text-[12px] text-muted">
                {linhas.length} lançamento{linhas.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="border-b border-line bg-surface text-left text-muted">
                    <th className="px-4 py-2 font-semibold">Equipamento</th>
                    <th className="px-3 py-2 font-semibold">Descrição</th>
                    <th className="px-3 py-2 font-semibold">Frente</th>
                    <th className="px-3 py-2 font-semibold">Data</th>
                    <th className="px-3 py-2 font-semibold">Status</th>
                    <th className="px-3 py-2 font-semibold">Lançado por</th>
                    <th className="px-3 py-2 font-semibold">Última alteração</th>
                    <th className="w-28 px-2 py-2 text-right font-semibold">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {linhas.map((l) => {
                    const sit = situacao(l);
                    return (
                      <tr key={l.id} className="border-b border-line last:border-0">
                        <td className="px-4 py-1.5 font-semibold text-ink">{l.eqp}</td>
                        <td className="px-3 py-1.5 text-muted">{nomesEquipamentos[l.eqp] ?? "—"}</td>
                        <td className="px-3 py-1.5 text-ink">{l.frente}</td>
                        <td className="px-3 py-1.5 text-ink">{fmtDateBR(l.vigencia)}</td>
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
                        <td className="whitespace-nowrap px-3 py-1.5 text-muted">{l.lancadoPor || "—"}</td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-muted">{l.alteradoEm ? `${l.alteradoPor || "—"} · ${fmtDataHora(l.alteradoEm)}` : ""}</td>
                        <td className="px-2 py-1.5 text-right">
                          {podeGravar && (
                            <>
                              <button
                                type="button"
                                onClick={() => editar(l)}
                                aria-label="Editar lançamento"
                                className="mr-1 rounded px-1.5 py-0.5 text-[12px] font-semibold text-brand-700 hover:bg-brand-50"
                              >
                                Editar
                              </button>
                              <button
                                type="button"
                                onClick={() => excluir(l)}
                                aria-label="Excluir lançamento"
                                className="rounded px-1.5 text-[15px] leading-none text-muted hover:bg-alert-50 hover:text-alert-600"
                              >
                                ×
                              </button>
                            </>
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
