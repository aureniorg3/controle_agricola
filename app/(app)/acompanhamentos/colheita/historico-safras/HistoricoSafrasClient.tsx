"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ModalShell } from "@/components/ui";
import { fmtHa, fmtT, fmtTch } from "@/lib/format";
import { podeEditar } from "@/lib/permissoes";
import type { BaseSafraFazenda } from "@/lib/db";
import type { PerfilUsuario, SafraAgregado } from "@/lib/types";

const FILTRO =
  "rounded-md border border-line bg-card px-2.5 py-1.5 text-[12.5px] text-ink focus:border-brand-600 focus:outline-none";
const LIMITE_INICIAL = 300;

export default function HistoricoSafrasClient({
  resumo,
  base,
  perfil,
}: {
  resumo: SafraAgregado[];
  base: BaseSafraFazenda[];
  perfil: PerfilUsuario;
}) {
  const router = useRouter();
  const podeGravar = podeEditar(perfil);
  const [importarAberto, setImportarAberto] = useState(false);
  const [safraFiltro, setSafraFiltro] = useState("todas");
  const [busca, setBusca] = useState("");
  const [verTudo, setVerTudo] = useState(false);

  const filtradas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return base
      .filter((l) => safraFiltro === "todas" || String(l.safra) === safraFiltro)
      .filter(
        (l) =>
          !termo ||
          l.fazendaNome.toLowerCase().includes(termo) ||
          l.fazendaCodigo.includes(termo) ||
          l.proprietario.toLowerCase().includes(termo) ||
          l.municipio.toLowerCase().includes(termo)
      );
  }, [base, safraFiltro, busca]);
  const visiveis = verTudo ? filtradas : filtradas.slice(0, LIMITE_INICIAL);

  async function excluir(safra: number) {
    if (!window.confirm(`Excluir toda a base da safra ${safra}? Os comparativos deixam de incluí-la.`)) return;
    const res = await fetch("/api/safras", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ safra }),
    });
    if (res.ok) router.refresh();
    else window.alert("Não foi possível excluir a safra.");
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <header className="flex flex-shrink-0 items-center gap-3 border-b border-line bg-card px-6 py-3">
        <nav className="min-w-0 flex-1 text-[13px] text-muted">
          <span className="text-[11px] uppercase tracking-wide">Acompanhamentos · Colheita</span>
          <div className="truncate text-[15px] font-bold text-ink">Histórico de Safras</div>
        </nav>
        {!podeGravar && (
          <div className="rounded-full border border-line bg-surface px-3 py-1.5 text-[12px] font-semibold text-muted">
            Somente leitura
          </div>
        )}
        {podeGravar && (
          <button
            type="button"
            onClick={() => setImportarAberto(true)}
            className="rounded-lg bg-navy-900 px-3.5 py-2 text-[13px] font-semibold text-white shadow-card hover:bg-navy-800"
          >
            Importar safras
          </button>
        )}
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        {resumo.length === 0 ? (
          <div className="rounded-xl2 border border-dashed border-line bg-card px-6 py-14 text-center text-muted">
            Nenhuma safra importada ainda.{" "}
            {podeGravar ? (
              <button type="button" onClick={() => setImportarAberto(true)} className="font-semibold text-brand-700">
                Importar safras
              </button>
            ) : (
              "Peça para um usuário com nível Gravação ou Administrador importar os arquivos."
            )}
          </div>
        ) : (
          <>
            <div className="mb-5 overflow-hidden rounded-xl2 border border-line bg-card shadow-card">
              <div className="border-b border-line bg-surface px-4 py-2.5 text-[14px] font-bold text-ink">
                Safras importadas
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr className="border-b border-line bg-surface text-left text-muted">
                      <th className="px-4 py-2 font-semibold">Safra</th>
                      <th className="px-3 py-2 text-right font-semibold">Área Total (ha)</th>
                      <th className="px-3 py-2 text-right font-semibold">Área Colhida (ha)</th>
                      <th className="px-3 py-2 text-right font-semibold">Produção (t)</th>
                      <th className="px-3 py-2 text-right font-semibold">TCH Realizado (t/ha)</th>
                      <th className="px-3 py-2 text-right font-semibold">TCH Estimado (t/ha)</th>
                      <th className="w-20 px-2 py-2 text-right font-semibold">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resumo.map((r) => (
                      <tr key={r.safra} className="border-b border-line last:border-0">
                        <td className="px-4 py-1.5 font-semibold text-ink">{r.safra}</td>
                        <td className="px-3 py-1.5 text-right tabular text-ink">{fmtHa(r.areaTot)}</td>
                        <td className="px-3 py-1.5 text-right tabular text-ink">{fmtHa(r.areaColhida)}</td>
                        <td className="px-3 py-1.5 text-right tabular text-ink">{fmtT(r.producaoT)}</td>
                        <td className="px-3 py-1.5 text-right font-semibold tabular text-ink">
                          {r.tchReal !== null ? fmtTch(r.tchReal) : "—"}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular text-muted">
                          {r.tchEst !== null ? fmtTch(r.tchEst) : "—"}
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          {podeGravar && (
                            <button
                              type="button"
                              onClick={() => excluir(r.safra)}
                              aria-label={`Excluir safra ${r.safra}`}
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
            </div>

            <div className="overflow-hidden rounded-xl2 border border-line bg-card shadow-card">
              <div className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-4 py-2.5">
                <h2 className="text-[14px] font-bold text-ink">Base consolidada por fazenda</h2>
                <select
                  value={safraFiltro}
                  onChange={(e) => setSafraFiltro(e.target.value)}
                  aria-label="Filtrar por safra"
                  className={FILTRO}
                >
                  <option value="todas">Todas as safras</option>
                  {resumo.map((r) => (
                    <option key={r.safra} value={r.safra}>
                      Safra {r.safra}
                    </option>
                  ))}
                </select>
                <input
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Buscar fazenda, proprietário, município…"
                  className={`${FILTRO} min-w-[260px]`}
                />
                <span className="ml-auto text-[12px] text-muted">
                  {filtradas.length} linha{filtradas.length === 1 ? "" : "s"}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr className="border-b border-line bg-surface text-left text-muted">
                      <th className="px-4 py-2 font-semibold">Safra</th>
                      <th className="px-3 py-2 font-semibold">Fazenda</th>
                      <th className="px-3 py-2 font-semibold">Proprietário</th>
                      <th className="px-3 py-2 font-semibold">Município</th>
                      <th className="px-3 py-2 text-right font-semibold">Talhões</th>
                      <th className="px-3 py-2 text-right font-semibold">Área Total (ha)</th>
                      <th className="px-3 py-2 text-right font-semibold">Produção (t)</th>
                      <th className="px-3 py-2 text-right font-semibold">TCH Realizado (t/ha)</th>
                      <th className="px-4 py-2 text-right font-semibold">TCH Estimado (t/ha)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visiveis.map((l) => (
                      <tr key={`${l.safra}|${l.fazendaCodigo}`} className="border-b border-line last:border-0">
                        <td className="px-4 py-1.5 font-semibold text-ink">{l.safra}</td>
                        <td className="px-3 py-1.5 text-ink">
                          {l.fazendaCodigo} - {l.fazendaNome}
                        </td>
                        <td className="px-3 py-1.5 text-muted">{l.proprietario}</td>
                        <td className="px-3 py-1.5 text-muted">
                          {l.municipio}
                          {l.uf ? `/${l.uf}` : ""}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular text-ink">{l.talhoes}</td>
                        <td className="px-3 py-1.5 text-right tabular text-ink">{fmtHa(l.areaTot)}</td>
                        <td className="px-3 py-1.5 text-right tabular text-ink">{fmtT(l.producaoT)}</td>
                        <td className="px-3 py-1.5 text-right font-semibold tabular text-ink">
                          {l.tchReal !== null ? fmtTch(l.tchReal) : "—"}
                        </td>
                        <td className="px-4 py-1.5 text-right tabular text-muted">
                          {l.tchEst !== null ? fmtTch(l.tchEst) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!verTudo && filtradas.length > LIMITE_INICIAL && (
                <div className="border-t border-line bg-surface px-4 py-2 text-center text-[12.5px]">
                  Mostrando {LIMITE_INICIAL} de {filtradas.length}.{" "}
                  <button type="button" onClick={() => setVerTudo(true)} className="font-semibold text-brand-700">
                    Mostrar todas
                  </button>
                </div>
              )}
              <p className="border-t border-line bg-surface px-4 py-2 text-[11.5px] leading-relaxed text-muted">
                TCH Realizado = produção atual ÷ área colhida (colunas do relatório já colhidas). TCH Estimado =
                produção estimada ÷ área total. Os rótulos &quot;Kg/Ha&quot; do arquivo de origem são, na verdade, o TCH
                (t/ha) estimado e realizado.
              </p>
            </div>
          </>
        )}
      </div>

      {importarAberto && <ImportarModal onFechar={() => setImportarAberto(false)} />}
    </div>
  );
}

interface Slot {
  arquivo: File | null;
  safra: string;
}

interface ResultadoArquivo {
  nome: string;
  safra: string;
  ok: boolean;
  talhoes: number;
  fazendas: number;
  areaHa: number;
  avisos: string[];
  erro?: string;
}

const MAX_SLOTS = 5;

function ImportarModal({ onFechar }: { onFechar: () => void }) {
  const router = useRouter();
  const [slots, setSlots] = useState<Slot[]>([{ arquivo: null, safra: "" }]);
  const [enviando, setEnviando] = useState(false);
  const [resultados, setResultados] = useState<ResultadoArquivo[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  function atualizar(i: number, parcial: Partial<Slot>) {
    setSlots((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...parcial } : s)));
  }

  const preenchidos = slots.filter((s) => s.arquivo);
  const pronto = preenchidos.length > 0 && preenchidos.every((s) => /^\d{4}$/.test(s.safra));

  async function enviar() {
    setEnviando(true);
    setErro(null);
    setResultados(null);
    try {
      const form = new FormData();
      slots.forEach((s, i) => {
        if (s.arquivo) {
          form.append(`arquivo_${i}`, s.arquivo);
          form.append(`safra_${i}`, s.safra);
        }
      });
      const res = await fetch("/api/safras/importar", { method: "POST", body: form });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErro(json.error ?? "Não foi possível importar os arquivos.");
        return;
      }
      setResultados(json.resultados);
      router.refresh();
    } catch {
      setErro("Não foi possível enviar os arquivos. Verifique a conexão e tente novamente.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <ModalShell titulo="Importar Histórico de Safras" onFechar={onFechar}>
      <p className="mb-4 text-[12.5px] leading-relaxed text-muted">
        Envie de <b className="text-ink">1 a {MAX_SLOTS} arquivos</b> do relatório &quot;Rendimentos e Estimativas de
        Talhões - Modelo C&quot; e informe a <b className="text-ink">safra de cada um</b> (ano, ex.: 2025). Importar
        uma safra que já existe substitui toda a base dela.
      </p>

      <div className="space-y-2.5">
        {slots.map((s, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface p-2.5">
            <span className="text-[12px] font-semibold text-muted">{i + 1}.</span>
            <input
              type="file"
              accept=".xlsx,.xls"
              onChange={(e) => atualizar(i, { arquivo: e.target.files?.[0] ?? null })}
              className="min-w-0 flex-1 text-[12.5px] text-ink file:mr-3 file:rounded-md file:border-0 file:bg-navy-900 file:px-3 file:py-1.5 file:text-[12.5px] file:font-semibold file:text-white"
            />
            <input
              value={s.safra}
              onChange={(e) => atualizar(i, { safra: e.target.value.replace(/\D/g, "").slice(0, 4) })}
              inputMode="numeric"
              placeholder="Safra (ano)"
              aria-label={`Safra do arquivo ${i + 1}`}
              className={`${FILTRO} w-[110px]`}
            />
            {slots.length > 1 && (
              <button
                type="button"
                onClick={() => setSlots((prev) => prev.filter((_, idx) => idx !== i))}
                aria-label="Remover arquivo"
                className="rounded px-1.5 text-[16px] leading-none text-muted hover:bg-alert-50 hover:text-alert-600"
              >
                ×
              </button>
            )}
          </div>
        ))}
      </div>

      {slots.length < MAX_SLOTS && (
        <button
          type="button"
          onClick={() => setSlots((prev) => [...prev, { arquivo: null, safra: "" }])}
          className="mt-2.5 text-[12.5px] font-semibold text-brand-700"
        >
          + Adicionar outro arquivo ({slots.length}/{MAX_SLOTS})
        </button>
      )}

      {erro && (
        <div className="mt-3 rounded-lg border border-alert-500/30 bg-alert-50 px-3 py-2 text-[12.5px] text-alert-600">
          {erro}
        </div>
      )}

      {resultados && (
        <div className="mt-3 space-y-1.5">
          {resultados.map((r, i) => (
            <div
              key={i}
              className={`rounded-lg border px-3 py-2 text-[12.5px] ${
                r.ok
                  ? "border-good-500/30 bg-good-50 text-good-600"
                  : "border-alert-500/30 bg-alert-50 text-alert-600"
              }`}
            >
              <p className="font-semibold">
                {r.nome} {r.safra && `· Safra ${r.safra}`}
              </p>
              {r.ok ? (
                <p>
                  {r.fazendas} fazenda(s) · {r.talhoes} talhão(ões) · {fmtHa(r.areaHa)} ha importados.
                </p>
              ) : (
                <p>{r.erro}</p>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="mt-5 flex justify-end gap-2">
        <button
          type="button"
          onClick={onFechar}
          className="rounded-lg border border-line px-4 py-2 text-[13px] font-semibold text-ink"
        >
          {resultados ? "Fechar" : "Cancelar"}
        </button>
        <button
          type="button"
          disabled={!pronto || enviando}
          onClick={enviar}
          className="rounded-lg bg-navy-900 px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-40"
        >
          {enviando ? "Importando…" : "Importar"}
        </button>
      </div>
    </ModalShell>
  );
}
