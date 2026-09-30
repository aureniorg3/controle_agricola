"use client";

import { Fragment, FormEvent, useMemo, useState } from "react";
import { OrdemCorte, PerfilUsuario, Periodo, StatusOrdem, TalhaoOrdem } from "@/lib/types";
import {
  addDays,
  calcAreaColhidaHa,
  calcAreaTotalHa,
  calcOrdemMetrics,
  calcTalhaoEntradaPeriodo,
  endOfMonth,
  endOfWeekMonday,
  mesAnteriorRange,
  quinzenaRange,
  resumoPorFrente,
  startOfMonth,
  startOfWeekMonday,
} from "@/lib/period";
import { fmtDateBR, fmtHa, fmtT, fmtTch, todayISO } from "@/lib/format";
import { Campo, ModalShell } from "@/components/ui";
import { podeEditar } from "@/lib/permissoes";

const PERIODOS: { key: Periodo; label: string }[] = [
  { key: "dia", label: "Dia" },
  { key: "semana", label: "Semana" },
  { key: "mes", label: "Mês" },
  { key: "safra", label: "Safra" },
];

function ultimaDataComMovimento(ordens: OrdemCorte[]): string {
  let max = "";
  for (const o of ordens) for (const e of o.entradas) if (e.data > max) max = e.data;
  return max || todayISO();
}

function periodoTexto(period: Periodo, referencia: string, safraLabel: string): string {
  if (period === "dia") return `Dia ${fmtDateBR(referencia)}`;
  if (period === "semana")
    return `Semana de ${fmtDateBR(startOfWeekMonday(referencia))} a ${fmtDateBR(endOfWeekMonday(referencia))}`;
  if (period === "mes")
    return `Mês de ${fmtDateBR(startOfMonth(referencia)).slice(3)} (${fmtDateBR(startOfMonth(referencia))} a ${fmtDateBR(
      endOfMonth(referencia)
    )})`;
  return `Safra ${safraLabel} · acumulado`;
}

export default function OrdensCorteClient({
  initialOrdens,
  initialOrdensVisiveis,
  perfil,
}: {
  initialOrdens: OrdemCorte[];
  initialOrdensVisiveis: string[];
  perfil: PerfilUsuario;
}) {
  const podeGravar = podeEditar(perfil);
  const [ordens, setOrdens] = useState<OrdemCorte[]>(initialOrdens);
  const [ordensVisiveis, setOrdensVisiveis] = useState<Set<string>>(() => new Set(initialOrdensVisiveis));
  const [inserirNumero, setInserirNumero] = useState("");
  const [inserirErro, setInserirErro] = useState<string | null>(null);
  const [inserindo, setInserindo] = useState(false);
  const [period, setPeriod] = useState<Periodo>("dia");
  const [referencia, setReferencia] = useState<string>(() => ultimaDataComMovimento(initialOrdens));
  const [frenteFiltro, setFrenteFiltro] = useState<string>("todas");
  const [statusFiltro, setStatusFiltro] = useState<"todas" | StatusOrdem>("todas");
  const [busca, setBusca] = useState("");
  const [importarAberto, setImportarAberto] = useState(false);
  const [areaColhidaAlvo, setAreaColhidaAlvo] = useState<OrdemCorte | null>(null);
  const [ultimaSincronizacao, setUltimaSincronizacao] = useState<string>(() => new Date().toISOString());
  const [colapsadas, setColapsadas] = useState<Set<string>>(new Set());

  function atualizarOrdemLocal(atualizada: OrdemCorte) {
    setOrdens((prev) => prev.map((o) => (o.numero === atualizada.numero ? atualizada : o)));
  }

  async function refetch() {
    const res = await fetch("/api/ordens-corte", { cache: "no-store" });
    const data = await res.json();
    setOrdens(data.ordens);
    setOrdensVisiveis(new Set<string>(data.ordensVisiveis ?? []));
    setReferencia(ultimaDataComMovimento(data.ordens));
    setUltimaSincronizacao(new Date().toISOString());
  }

  async function inserirOrdem(e: FormEvent) {
    e.preventDefault();
    const numero = inserirNumero.trim();
    if (!numero) return;
    setInserindo(true);
    setInserirErro(null);
    try {
      const res = await fetch("/api/ordens-corte/visiveis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ numero }),
      });
      const data = await res.json();
      if (!res.ok) {
        setInserirErro(data?.error ?? "Não foi possível inserir a ordem.");
        return;
      }
      setOrdensVisiveis((prev) => new Set(prev).add(numero));
      setInserirNumero("");
    } catch {
      setInserirErro("Não foi possível enviar a solicitação. Verifique a conexão.");
    } finally {
      setInserindo(false);
    }
  }

  async function removerOrdem(numero: string) {
    setOrdensVisiveis((prev) => {
      const next = new Set(prev);
      next.delete(numero);
      return next;
    });
    await fetch("/api/ordens-corte/visiveis", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ numero }),
    });
  }

  const frentes = useMemo(() => Array.from(new Set(ordens.map((o) => o.frente))).sort(), [ordens]);

  const ordensDisponiveis = useMemo(
    () => ordens.filter((o) => !ordensVisiveis.has(o.numero)).sort((a, b) => a.numero.localeCompare(b.numero, undefined, { numeric: true })),
    [ordens, ordensVisiveis]
  );

  const safraLabel = ordens[0]?.safraLabel ?? "2026/27";

  const ordensSelecionadas = useMemo(() => ordens.filter((o) => ordensVisiveis.has(o.numero)), [ordens, ordensVisiveis]);

  const ordensFiltradas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return ordensSelecionadas.filter((o) => {
      if (frenteFiltro !== "todas" && o.frente !== frenteFiltro) return false;
      if (statusFiltro !== "todas" && o.status !== statusFiltro) return false;
      if (termo) {
        const alvo = `${o.numero} ${o.fazendaCodigo} ${o.fazendaNome}`.toLowerCase();
        if (!alvo.includes(termo)) return false;
      }
      return true;
    });
  }, [ordensSelecionadas, frenteFiltro, statusFiltro, busca]);

  const porFrente = useMemo(() => {
    const map = new Map<string, OrdemCorte[]>();
    for (const o of ordensFiltradas) {
      const arr = map.get(o.frente) ?? [];
      arr.push(o);
      map.set(o.frente, arr);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [ordensFiltradas]);

  const resumoFrentes = useMemo(() => resumoPorFrente(ordensFiltradas, referencia), [ordensFiltradas, referencia]);

  const resumoTotais = useMemo(
    () =>
      resumoFrentes.reduce(
        (acc, r) => ({
          ordens: acc.ordens + r.ordens,
          areaHa: acc.areaHa + r.areaHa,
          safraT: acc.safraT + r.safraT,
          mesAnteriorT: acc.mesAnteriorT + r.mesAnteriorT,
          mesAtualT: acc.mesAtualT + r.mesAtualT,
          quinzenaT: acc.quinzenaT + r.quinzenaT,
          semanaT: acc.semanaT + r.semanaT,
          diaAnteriorT: acc.diaAnteriorT + r.diaAnteriorT,
          diaAtualT: acc.diaAtualT + r.diaAtualT,
        }),
        {
          ordens: 0,
          areaHa: 0,
          safraT: 0,
          mesAnteriorT: 0,
          mesAtualT: 0,
          quinzenaT: 0,
          semanaT: 0,
          diaAnteriorT: 0,
          diaAtualT: 0,
        }
      ),
    [resumoFrentes]
  );

  const rotulosResumo = useMemo(() => {
    // Os fins de Semana/Quinzena/Mês Atual são sempre a própria referência
    // (não o fim natural do período) — mesma regra "até a data selecionada"
    // usada em resumoPorFrente, pra o rótulo bater com o que é somado de
    // verdade.
    const dm = (iso: string) => fmtDateBR(iso).slice(0, 5);
    const mesAnterior = mesAnteriorRange(referencia);
    return {
      diaAnterior: dm(addDays(referencia, -1)),
      diaAtual: dm(referencia),
      semana: `${dm(startOfWeekMonday(referencia))}–${dm(referencia)}`,
      quinzena: `${dm(quinzenaRange(referencia).inicio)}–${dm(referencia)}`,
      mesAtual: `${dm(startOfMonth(referencia))}–${dm(referencia)}`,
      mesAnterior: `${dm(mesAnterior.inicio)}–${dm(mesAnterior.fim)}`,
    };
  }, [referencia]);

  const totalGeral = useMemo(() => {
    let entradaPeriodoT = 0;
    let areaTotalHa = 0;
    let abertas = 0;
    let encerradas = 0;
    for (const o of ordensFiltradas) {
      const m = calcOrdemMetrics(o, period, referencia);
      entradaPeriodoT += m.entradaPeriodoT;
      areaTotalHa += m.areaTotalHa;
      if (o.status === "Aberta") abertas += 1;
      else encerradas += 1;
    }
    return {
      entradaPeriodoT: Math.round(entradaPeriodoT * 100) / 100,
      areaTotalHa: Math.round(areaTotalHa * 100) / 100,
      abertas,
      encerradas,
      total: ordensFiltradas.length,
    };
  }, [ordensFiltradas, period, referencia]);

  function toggleColapso(frente: string) {
    setColapsadas((prev) => {
      const next = new Set(prev);
      if (next.has(frente)) next.delete(frente);
      else next.add(frente);
      return next;
    });
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      {/* Topbar */}
      <header className="flex flex-shrink-0 items-center gap-3 border-b border-line bg-card px-6 py-3">
        <nav className="min-w-0 flex-1 text-[13px] text-muted">
          <span className="uppercase tracking-wide text-[11px] text-muted">Acompanhamentos</span>
          <div className="truncate text-[15px] font-bold text-ink">Ordens de Corte</div>
        </nav>
        <div className="flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-[12.5px] font-medium text-ink">
          Safra <span className="font-bold text-brand-700">{safraLabel}</span>
          <span className="text-muted">· Capinópolis-MG</span>
        </div>
        <div className="flex items-center gap-1.5 rounded-full border border-good-500/30 bg-good-50 px-3 py-1.5 text-[12px] font-semibold text-good-600">
          <span className="h-1.5 w-1.5 rounded-full bg-good-500" />
          Dados do servidor
        </div>
        {!podeGravar && (
          <div className="flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-[12px] font-semibold text-muted">
            Somente leitura
          </div>
        )}
        {podeGravar && (
          <button
            type="button"
            onClick={() => setImportarAberto(true)}
            className="flex items-center gap-1.5 rounded-lg bg-navy-900 px-3.5 py-2 text-[13px] font-semibold text-white shadow-card hover:bg-navy-800"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 15V4M12 4l-4 4M12 4l4 4M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Importar planilhas
          </button>
        )}
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        {/* Inserir ordem manualmente */}
        {podeGravar && (
          <div className="mb-4 flex flex-wrap items-center gap-2.5 rounded-xl2 border border-line bg-card px-4 py-3 shadow-card">
            <form onSubmit={inserirOrdem} className="flex flex-wrap items-center gap-2">
              <label className="text-[12.5px] font-semibold text-ink" htmlFor="inserir-ordem-input">
                Inserir Ordem
              </label>
              <input
                id="inserir-ordem-input"
                type="text"
                list="ordens-disponiveis-datalist"
                placeholder="Nº da ordem…"
                value={inserirNumero}
                onChange={(e) => setInserirNumero(e.target.value)}
                className="w-40 rounded-lg border border-line bg-card px-3 py-1.5 text-[13px] text-ink shadow-card placeholder:text-muted"
              />
              <datalist id="ordens-disponiveis-datalist">
                {ordensDisponiveis.map((o) => (
                  <option key={o.numero} value={o.numero}>
                    {o.fazendaNome}
                  </option>
                ))}
              </datalist>
              <button
                type="submit"
                disabled={inserindo || !inserirNumero.trim()}
                className="rounded-lg bg-navy-900 px-3.5 py-1.5 text-[13px] font-semibold text-white shadow-card hover:bg-navy-800 disabled:opacity-50"
              >
                {inserindo ? "Inserindo…" : "Inserir"}
              </button>
            </form>
            {inserirErro && <span className="text-[12.5px] font-medium text-alert-600">{inserirErro}</span>}
            <span className="ml-auto text-[12px] font-medium text-muted">
              {ordensVisiveis.size} de {ordens.length} ordem(ns) importada(s) selecionada(s)
            </span>
          </div>
        )}

        {/* Filtros */}
        <div className="mb-4 flex flex-wrap items-center gap-2.5">
          <div className="flex rounded-lg bg-navy-900/5 p-1">
            {PERIODOS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => setPeriod(p.key)}
                className={`rounded-md px-3.5 py-1.5 text-[13px] font-semibold transition-colors ${
                  period === p.key ? "bg-navy-900 text-white shadow-card" : "text-navy-800 hover:bg-white"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {period !== "safra" && (
            <input
              type="date"
              value={referencia}
              onChange={(e) => setReferencia(e.target.value)}
              className="rounded-lg border border-line bg-card px-3 py-1.5 text-[13px] font-medium text-ink shadow-card"
            />
          )}

          <select
            value={frenteFiltro}
            onChange={(e) => setFrenteFiltro(e.target.value)}
            className="rounded-lg border border-line bg-card px-3 py-1.5 text-[13px] font-medium text-ink shadow-card"
          >
            <option value="todas">Todas as frentes</option>
            {frentes.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>

          <select
            value={statusFiltro}
            onChange={(e) => setStatusFiltro(e.target.value as "todas" | StatusOrdem)}
            className="rounded-lg border border-line bg-card px-3 py-1.5 text-[13px] font-medium text-ink shadow-card"
          >
            <option value="todas">Todos os status</option>
            <option value="Aberta">Abertas</option>
            <option value="Encerrada">Encerradas</option>
          </select>

          <input
            type="search"
            placeholder="Buscar nº da ordem, fazenda…"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="min-w-[220px] flex-1 rounded-lg border border-line bg-card px-3 py-1.5 text-[13px] text-ink shadow-card placeholder:text-muted"
          />

          <span className="ml-auto text-[12.5px] font-medium text-muted">
            {periodoTexto(period, referencia, safraLabel)}
          </span>
        </div>

        {/* KPIs */}
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
          <StatCard
            label="Ordens no filtro"
            value={totalGeral.total.toString()}
            sub={`${totalGeral.abertas} abertas · ${totalGeral.encerradas} encerradas`}
          />
          <StatCard label="Abertas" value={totalGeral.abertas.toString()} sub="Em corte ou liberadas" />
          <StatCard label="Encerradas" value={totalGeral.encerradas.toString()} sub="Concluídas na safra" />
          <StatCard label="Área" value={`${fmtHa(totalGeral.areaTotalHa)} ha`} sub="Soma das ordens do filtro" />
          <StatCard
            label={`Entrada · ${PERIODOS.find((p) => p.key === period)?.label}`}
            value={`${fmtT(totalGeral.entradaPeriodoT)} t`}
            sub={periodoTexto(period, referencia, safraLabel)}
            destaque
          />
        </div>

        {period !== "safra" && totalGeral.entradaPeriodoT === 0 && totalGeral.total > 0 && (
          <p className="-mt-2 mb-4 text-[12px] text-muted">
            Nenhuma entrada registrada para {periodoTexto(period, referencia, safraLabel).toLowerCase()}. Os
            filtros só mostram as datas presentes na última importação.
          </p>
        )}

        {/* Resumo por frente — todos os recortes de período de uma vez, sempre
            recalculados a partir da data de referência selecionada acima */}
        {resumoFrentes.length > 0 && (
          <div className="mb-5 overflow-x-auto rounded-xl2 border border-line bg-card shadow-card">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-line bg-surface text-left text-muted">
                  <th className="px-4 py-2 font-semibold">Frente</th>
                  <th className="px-3 py-2 text-right font-semibold">Ordens</th>
                  <th className="px-3 py-2 text-right font-semibold">Área (ha)</th>
                  <th className="px-3 py-2 text-right font-semibold">
                    Safra
                    <div className="font-normal normal-case text-muted/70">acumulado</div>
                  </th>
                  <th className="px-3 py-2 text-right font-semibold">
                    Mês Anterior
                    <div className="font-normal normal-case text-muted/70">{rotulosResumo.mesAnterior}</div>
                  </th>
                  <th className="px-3 py-2 text-right font-semibold">
                    Mês Atual
                    <div className="font-normal normal-case text-muted/70">{rotulosResumo.mesAtual}</div>
                  </th>
                  <th className="px-3 py-2 text-right font-semibold">
                    Quinzena
                    <div className="font-normal normal-case text-muted/70">{rotulosResumo.quinzena}</div>
                  </th>
                  <th className="px-3 py-2 text-right font-semibold">
                    Semana
                    <div className="font-normal normal-case text-muted/70">{rotulosResumo.semana}</div>
                  </th>
                  <th className="px-3 py-2 text-right font-semibold">
                    Dia Anterior
                    <div className="font-normal normal-case text-muted/70">{rotulosResumo.diaAnterior}</div>
                  </th>
                  <th className="px-4 py-2 text-right font-semibold">
                    Dia Atual
                    <div className="font-normal normal-case text-muted/70">{rotulosResumo.diaAtual} até 06h</div>
                  </th>
                </tr>
              </thead>
              <tbody>
                {resumoFrentes.map((r) => (
                  <tr key={r.frente} className="border-b border-line last:border-0">
                    <td className="px-4 py-1.5 font-semibold text-ink">{r.frente}</td>
                    <td className="px-3 py-1.5 text-right tabular text-muted">{r.ordens}</td>
                    <td className="px-3 py-1.5 text-right tabular text-ink">{fmtHa(r.areaHa)}</td>
                    <td className="px-3 py-1.5 text-right tabular text-ink">{fmtT(r.safraT)}</td>
                    <td className="px-3 py-1.5 text-right tabular text-ink">{fmtT(r.mesAnteriorT)}</td>
                    <td className="px-3 py-1.5 text-right tabular text-ink">{fmtT(r.mesAtualT)}</td>
                    <td className="px-3 py-1.5 text-right tabular text-ink">{fmtT(r.quinzenaT)}</td>
                    <td className="px-3 py-1.5 text-right tabular text-ink">{fmtT(r.semanaT)}</td>
                    <td className="px-3 py-1.5 text-right tabular text-ink">{fmtT(r.diaAnteriorT)}</td>
                    <td className="px-4 py-1.5 text-right tabular font-semibold text-brand-700">
                      {fmtT(r.diaAtualT)}
                    </td>
                  </tr>
                ))}
                <tr className="bg-surface font-bold text-ink">
                  <td className="px-4 py-1.5">Total geral</td>
                  <td className="px-3 py-1.5 text-right tabular">{resumoTotais.ordens}</td>
                  <td className="px-3 py-1.5 text-right tabular">{fmtHa(resumoTotais.areaHa)}</td>
                  <td className="px-3 py-1.5 text-right tabular">{fmtT(resumoTotais.safraT)}</td>
                  <td className="px-3 py-1.5 text-right tabular">{fmtT(resumoTotais.mesAnteriorT)}</td>
                  <td className="px-3 py-1.5 text-right tabular">{fmtT(resumoTotais.mesAtualT)}</td>
                  <td className="px-3 py-1.5 text-right tabular">{fmtT(resumoTotais.quinzenaT)}</td>
                  <td className="px-3 py-1.5 text-right tabular">{fmtT(resumoTotais.semanaT)}</td>
                  <td className="px-3 py-1.5 text-right tabular">{fmtT(resumoTotais.diaAnteriorT)}</td>
                  <td className="px-4 py-1.5 text-right tabular text-brand-700">{fmtT(resumoTotais.diaAtualT)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* Grupos por frente com os cards ("quadrados") */}
        {porFrente.length === 0 && (
          <div className="rounded-xl2 border border-dashed border-line bg-card px-6 py-14 text-center text-muted">
            {ordens.length === 0 ? (
              <>
                Nenhuma ordem importada ainda.{" "}
                {podeGravar ? (
                  <button
                    type="button"
                    onClick={() => setImportarAberto(true)}
                    className="font-semibold text-brand-700"
                  >
                    Importar planilhas
                  </button>
                ) : (
                  "Peça para um usuário com nível Gravação ou Administrador importar as planilhas."
                )}
              </>
            ) : ordensVisiveis.size === 0 ? (
              podeGravar
                ? 'Nenhuma ordem selecionada para exibição. Use "Inserir Ordem" acima para escolher quais ordens aparecem na tela.'
                : "Nenhuma ordem selecionada para exibição. Peça para um usuário com nível Gravação ou Administrador inserir as ordens."
            ) : (
              "Nenhuma ordem de corte encontrada para os filtros selecionados."
            )}
          </div>
        )}

        {porFrente.map(([frente, lista]) => {
          const aberto = !colapsadas.has(frente);
          const subtotal = lista.reduce((s, o) => s + calcOrdemMetrics(o, period, referencia).entradaPeriodoT, 0);
          return (
            <div key={frente} className="mb-5">
              <button
                type="button"
                onClick={() => toggleColapso(frente)}
                className="mb-2.5 flex w-full items-center gap-2.5 rounded-lg bg-navy-900 px-4 py-2 text-left text-white"
              >
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  className={`flex-shrink-0 transition-transform ${aberto ? "rotate-90" : ""}`}
                >
                  <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className="text-[13.5px] font-bold tracking-wide">{frente}</span>
                <span className="text-[12px] font-medium text-brand-200">{lista.length} ordem(ns)</span>
                <span className="ml-auto text-[12.5px] font-semibold text-white/90">
                  {fmtT(Math.round(subtotal * 100) / 100)} t no período
                </span>
              </button>
              {aberto && (
                <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 xl:grid-cols-4">
                  {lista.map((ordem) => (
                    <OrdemCard
                      key={ordem.id}
                      ordem={ordem}
                      period={period}
                      referencia={referencia}
                      onRemover={podeGravar ? () => removerOrdem(ordem.numero) : undefined}
                      onLancarAreaColhida={podeGravar ? () => setAreaColhidaAlvo(ordem) : undefined}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}

        <p className="mb-2 mt-6 text-center text-[11.5px] text-muted">
          Sincronizado com o servidor {new Date(ultimaSincronizacao).toLocaleString("pt-BR")}
        </p>
      </div>

      {importarAberto && <ImportarModal onFechar={() => setImportarAberto(false)} onImportado={refetch} />}
      {areaColhidaAlvo && (
        <AreaColhidaModal
          ordem={areaColhidaAlvo}
          onFechar={() => setAreaColhidaAlvo(null)}
          onSalvo={(atualizada) => {
            atualizarOrdemLocal(atualizada);
            setAreaColhidaAlvo(null);
          }}
        />
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  destaque,
}: {
  label: string;
  value: string;
  sub?: string;
  destaque?: boolean;
}) {
  return (
    <div
      className={`rounded-xl2 border px-4 py-3 shadow-card ${
        destaque ? "border-navy-900 bg-navy-900 text-white" : "border-line bg-card text-ink"
      }`}
    >
      <div className={`text-[11.5px] font-semibold ${destaque ? "text-brand-200" : "text-muted"}`}>{label}</div>
      <div className="mt-1 text-[22px] font-bold tabular leading-none">{value}</div>
      {sub && <div className={`mt-1.5 text-[11px] ${destaque ? "text-brand-200/90" : "text-muted"}`}>{sub}</div>}
    </div>
  );
}

function StatusBadge({ status }: { status: StatusOrdem }) {
  const aberta = status === "Aberta";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold ${
        aberta ? "bg-good-50 text-good-600" : "bg-amber-50 text-amber-600"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${aberta ? "bg-good-500" : "bg-amber-500"}`} />
      {aberta ? "Aberta" : "Encerrada"}
    </span>
  );
}

function OrdemCard({
  ordem,
  period,
  referencia,
  onRemover,
  onLancarAreaColhida,
}: {
  ordem: OrdemCorte;
  period: Periodo;
  referencia: string;
  onRemover?: () => void;
  onLancarAreaColhida?: () => void;
}) {
  const m = calcOrdemMetrics(ordem, period, referencia);
  const areaColhidaHa = calcAreaColhidaHa(ordem);

  const gruposFazenda = useMemo(() => {
    const map = new Map<string, { fazendaCodigo: string; fazendaNome: string; talhoes: TalhaoOrdem[] }>();
    for (const t of ordem.talhoes) {
      const g = map.get(t.fazendaCodigo) ?? { fazendaCodigo: t.fazendaCodigo, fazendaNome: t.fazendaNome, talhoes: [] };
      g.talhoes.push(t);
      map.set(t.fazendaCodigo, g);
    }
    return [...map.values()];
  }, [ordem.talhoes]);

  return (
    <div className="flex flex-col overflow-hidden rounded-xl2 border border-line bg-card shadow-card">
      <div className="flex items-center justify-between gap-2 border-b border-amber-500/25 bg-amber-50 px-4 py-2.5">
        <div>
          <div className="text-[14px] font-extrabold tracking-tight text-navy-900">Ordem - {ordem.numero}</div>
          <div className="text-[11.5px] text-muted">
            {ordem.fazendaCodigo} · {ordem.fazendaNome}
            {gruposFazenda.length > 1 && ` · +${gruposFazenda.length - 1} fazenda(s)`}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <StatusBadge status={ordem.status} />
          {onRemover && (
            <button
              type="button"
              onClick={onRemover}
              title="Remover da tela"
              className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-muted hover:bg-alert-50 hover:text-alert-600"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
                <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </div>
      </div>

      <div className="px-4 pt-3 text-[11px] font-semibold uppercase tracking-wide text-muted">Talhões</div>
      <div className="px-4">
        <table className="w-full text-[12px]">
          <thead className="bg-card">
            <tr className="text-left text-muted">
              <th className="py-1 font-semibold">Talhão</th>
              <th className="py-1 text-right font-semibold">Área</th>
              <th className="py-1 text-right font-semibold">Entrada</th>
              <th className="py-1 text-right font-semibold">Acum(t)</th>
            </tr>
          </thead>
          <tbody>
            {ordem.talhoes.length === 0 && (
              <tr>
                <td colSpan={4} className="py-2 text-center text-muted">
                  Sem talhões cadastrados.
                </td>
              </tr>
            )}
            {gruposFazenda.map((g) => (
              <Fragment key={g.fazendaCodigo}>
                {gruposFazenda.length > 1 && (
                  <tr className="border-t border-line/70 bg-surface">
                    <td colSpan={4} className="py-1 text-[10.5px] font-semibold text-muted">
                      {g.fazendaCodigo} · {g.fazendaNome}
                    </td>
                  </tr>
                )}
                {g.talhoes.map((t) => (
                  <tr key={`${t.fazendaCodigo}-${t.talhao}`} className="border-t border-line/70">
                    <td className="py-1 font-medium text-ink">{t.talhao}</td>
                    <td className="py-1 text-right tabular text-muted">{fmtHa(t.areaHa)}</td>
                    <td className="py-1 text-right tabular text-muted">
                      {fmtT(calcTalhaoEntradaPeriodo(ordem, t, period, referencia))}
                    </td>
                    <td className="py-1 text-right tabular font-medium text-ink">
                      {fmtT(calcTalhaoEntradaPeriodo(ordem, t, "safra", referencia))}
                    </td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mx-4 my-3 mt-auto grid grid-cols-3 gap-2 rounded-lg bg-surface p-2.5 text-[12px]">
        <div>
          <div className="text-muted">Área da ordem</div>
          <div className="font-semibold tabular text-ink">{fmtHa(m.areaTotalHa)} ha</div>
        </div>
        <div>
          <div className="text-muted">Área colhida</div>
          <div className="font-semibold tabular text-ink">{fmtHa(areaColhidaHa)} ha</div>
        </div>
        <div>
          <div className="text-muted">Acum. safra</div>
          <div className="font-semibold tabular text-ink">{fmtT(m.acumSafraT)} t</div>
        </div>
        <div className="col-span-3 rounded-md bg-brand-50 px-2 py-1.5">
          <div className="text-brand-700">Entrada no período selecionado</div>
          <div className="text-[15px] font-bold tabular text-brand-700">{fmtT(m.entradaPeriodoT)} t</div>
        </div>
        {onLancarAreaColhida && (
          <button
            type="button"
            onClick={onLancarAreaColhida}
            className="col-span-3 rounded-md border border-line bg-card px-2 py-1.5 text-center text-[11.5px] font-semibold text-navy-800 hover:bg-navy-900/5"
          >
            Lançar área colhida
          </button>
        )}
      </div>

      <div className="mx-4 mb-3 flex flex-wrap gap-1.5 text-[10.5px]">
        <span className="rounded-full bg-surface px-2 py-1 font-semibold text-muted">
          TCH geral realizado <b className="text-ink">{fmtTch(m.tchGeralRealizado)}</b>
        </span>
        {ordem.tipoCana && (
          <span
            className={`rounded-full px-2 py-1 font-semibold ${
              ordem.tipoCana.toLowerCase().includes("queimada")
                ? "bg-amber-50 text-amber-600"
                : "bg-brand-50 text-brand-700"
            }`}
          >
            {ordem.tipoCana}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Único lançamento manual que sobrou depois da reformulação: a área já
 * colhida de cada talhão (medição de campo, sempre parcial) — as toneladas
 * continuam 100% vindas da importação. "Por ordem" distribui o total
 * proporcionalmente pela área de cada talhão; "Por talhão" grava os valores
 * exatos.
 */
function AreaColhidaModal({
  ordem,
  onFechar,
  onSalvo,
}: {
  ordem: OrdemCorte;
  onFechar: () => void;
  onSalvo: (ordemAtualizada: OrdemCorte) => void;
}) {
  const [modo, setModo] = useState<"ordem" | "talhoes">("ordem");
  const areaTotalHa = calcAreaTotalHa(ordem);
  const [totalHa, setTotalHa] = useState(() => calcAreaColhidaHa(ordem).toString());
  const [porTalhao, setPorTalhao] = useState<Record<string, string>>(() =>
    Object.fromEntries(ordem.talhoes.map((t) => [`${t.fazendaCodigo}|${t.talhao}`, t.areaColhidaHa.toString()]))
  );
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      const body =
        modo === "ordem"
          ? { numero: ordem.numero, modo: "ordem", totalHa: Number(totalHa.replace(",", ".")) }
          : {
              numero: ordem.numero,
              modo: "talhoes",
              valores: ordem.talhoes.map((t) => ({
                fazendaCodigo: t.fazendaCodigo,
                talhao: t.talhao,
                areaColhidaHa: Number((porTalhao[`${t.fazendaCodigo}|${t.talhao}`] ?? "0").replace(",", ".")),
              })),
            };
      const res = await fetch("/api/ordens-corte/area-colhida", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setErro(data?.error ?? "Não foi possível lançar a área colhida.");
        return;
      }
      onSalvo(data.ordem as OrdemCorte);
    } catch {
      setErro("Não foi possível enviar a solicitação. Verifique a conexão.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <ModalShell titulo={`Lançar área colhida — Ordem ${ordem.numero}`} onFechar={onFechar}>
      <div className="mb-4 flex gap-1.5 rounded-lg bg-navy-900/5 p-1">
        <button
          type="button"
          onClick={() => setModo("ordem")}
          className={`flex-1 rounded-md px-3 py-1.5 text-[12.5px] font-semibold transition-colors ${
            modo === "ordem" ? "bg-navy-900 text-white shadow-card" : "text-navy-800 hover:bg-white"
          }`}
        >
          Total da ordem
        </button>
        <button
          type="button"
          onClick={() => setModo("talhoes")}
          className={`flex-1 rounded-md px-3 py-1.5 text-[12.5px] font-semibold transition-colors ${
            modo === "talhoes" ? "bg-navy-900 text-white shadow-card" : "text-navy-800 hover:bg-white"
          }`}
        >
          Por talhão
        </button>
      </div>

      <form onSubmit={salvar} className="space-y-3">
        {modo === "ordem" ? (
          <Campo label={`Área colhida da ordem (ha) — total da ordem: ${fmtHa(areaTotalHa)} ha`}>
            <input
              type="text"
              inputMode="decimal"
              value={totalHa}
              onChange={(e) => setTotalHa(e.target.value)}
              className="w-full rounded-lg border border-line bg-card px-3 py-1.5 text-[13px] text-ink shadow-card"
            />
            <span className="mt-1 block text-[11px] text-muted">
              Distribuído proporcionalmente pela área de cada talhão.
            </span>
          </Campo>
        ) : (
          <div className="max-h-[45vh] space-y-2 overflow-y-auto">
            {ordem.talhoes.map((t) => {
              const chave = `${t.fazendaCodigo}|${t.talhao}`;
              return (
                <Campo key={chave} label={`Talhão ${t.talhao} · ${t.fazendaNome} (área: ${fmtHa(t.areaHa)} ha)`}>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={porTalhao[chave] ?? "0"}
                    onChange={(e) => setPorTalhao((prev) => ({ ...prev, [chave]: e.target.value }))}
                    className="w-full rounded-lg border border-line bg-card px-3 py-1.5 text-[13px] text-ink shadow-card"
                  />
                </Campo>
              );
            })}
          </div>
        )}

        {erro && (
          <div className="rounded-lg border border-alert-500/30 bg-alert-50 px-3 py-2 text-[12.5px] text-alert-600">
            {erro}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onFechar}
            className="rounded-lg border border-line px-3.5 py-1.5 text-[13px] font-semibold text-ink hover:bg-surface"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={enviando}
            className="rounded-lg bg-navy-900 px-3.5 py-1.5 text-[13px] font-semibold text-white shadow-card hover:bg-navy-800 disabled:opacity-50"
          >
            {enviando ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

interface ResultadoImportacaoUI {
  totalOrdens: number;
  totalViagens: number;
  viagensSemOrdem: number;
  viagensSemConferencia: number;
  avisos: string[];
  erros: string[];
}

const emptyResultado: ResultadoImportacaoUI = {
  totalOrdens: 0,
  totalViagens: 0,
  viagensSemOrdem: 0,
  viagensSemConferencia: 0,
  avisos: [],
  erros: [],
};

function ImportarModal({ onFechar, onImportado }: { onFechar: () => void; onImportado: () => void }) {
  const [arqOrdens, setArqOrdens] = useState<File | null>(null);
  const [arqPesagem, setArqPesagem] = useState<File | null>(null);
  const [arqConferencia, setArqConferencia] = useState<File | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoImportacaoUI | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function enviar() {
    if (!arqOrdens || !arqPesagem || !arqConferencia) return;
    setEnviando(true);
    setErro(null);
    setResultado(null);
    try {
      const form = new FormData();
      form.append("ordens", arqOrdens);
      form.append("pesagem", arqPesagem);
      form.append("conferencia", arqConferencia);
      const res = await fetch("/api/ordens-corte/importar", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) {
        setErro(data?.error ?? "Não foi possível importar os arquivos.");
        if (data?.erros || data?.avisos) setResultado({ ...emptyResultado, ...data });
        return;
      }
      setResultado(data);
      await onImportado();
    } catch {
      setErro("Não foi possível enviar os arquivos. Verifique a conexão e tente novamente.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <ModalShell titulo="Importar planilhas de Ordens de Corte" onFechar={onFechar}>
      <p className="mb-4 text-[12.5px] leading-relaxed text-muted">
        Envie os <b className="text-ink">3 relatórios</b> gerados pelo sistema de origem, do jeito que saem de lá
        — sem mexer nas colunas. Cada envio <b className="text-ink">substitui</b> a base inteira (os três relatórios
        já trazem a safra completa até a data de geração, não é um incremento do dia).
      </p>

      <div className="space-y-3">
        <Campo label='1. "Ordem de Colheita.xlsx" — cadastro (status, frente, fazenda, talhões)'>
          <input
            type="file"
            accept=".xlsx,.xls"
            onChange={(e) => setArqOrdens(e.target.files?.[0] ?? null)}
            className="block w-full text-[12.5px] text-ink file:mr-3 file:rounded-md file:border-0 file:bg-navy-900 file:px-3 file:py-1.5 file:text-[12.5px] file:font-semibold file:text-white"
          />
        </Campo>
        <Campo label='2. "Pesagem de Cana por Hora - Mod. B" — viagens (data, frente, talhão, peso)'>
          <input
            type="file"
            accept=".xlsx,.xls"
            onChange={(e) => setArqPesagem(e.target.files?.[0] ?? null)}
            className="block w-full text-[12.5px] text-ink file:mr-3 file:rounded-md file:border-0 file:bg-navy-900 file:px-3 file:py-1.5 file:text-[12.5px] file:font-semibold file:text-white"
          />
        </Campo>
        <Campo label='3. "Conferência de Pesagens" — cruza cada viagem com sua ordem (O.Q.)'>
          <input
            type="file"
            accept=".xlsx,.xls"
            onChange={(e) => setArqConferencia(e.target.files?.[0] ?? null)}
            className="block w-full text-[12.5px] text-ink file:mr-3 file:rounded-md file:border-0 file:bg-navy-900 file:px-3 file:py-1.5 file:text-[12.5px] file:font-semibold file:text-white"
          />
        </Campo>
      </div>

      {erro && (
        <div className="mt-3 rounded-lg border border-alert-500/30 bg-alert-50 px-3 py-2 text-[12.5px] text-alert-600">
          {erro}
        </div>
      )}

      {resultado && !erro && (
        <div className="mt-3 rounded-lg border border-good-500/30 bg-good-50 px-3 py-2 text-[12.5px] text-good-700">
          <p className="font-semibold">
            {resultado.totalOrdens} ordem(ns) · {resultado.totalViagens} viagem(ns) lida(s).
          </p>
          {(resultado.viagensSemOrdem > 0 || resultado.viagensSemConferencia > 0) && (
            <p className="mt-1 text-good-600">
              {resultado.viagensSemConferencia > 0 && (
                <>{resultado.viagensSemConferencia} sem par na Conferência. </>
              )}
              {resultado.viagensSemOrdem > 0 && <>{resultado.viagensSemOrdem} sem ordem cadastrada.</>}
            </p>
          )}
        </div>
      )}

      {resultado && resultado.avisos.length > 0 && (
        <div className="mt-3 max-h-[160px] overflow-y-auto rounded-lg border border-line bg-surface p-2.5 text-[12px] text-muted">
          <p className="mb-1 font-semibold text-ink">Avisos ({resultado.avisos.length}):</p>
          <ul className="list-disc space-y-0.5 pl-4">
            {resultado.avisos.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </div>
      )}

      {resultado && resultado.erros.length > 0 && (
        <div className="mt-3 max-h-[140px] overflow-y-auto rounded-lg border border-alert-500/20 bg-alert-50/60 p-2.5 text-[12px] text-alert-600">
          <p className="mb-1 font-semibold">Erros ({resultado.erros.length}):</p>
          <ul className="list-disc space-y-0.5 pl-4">
            {resultado.erros.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-5 flex justify-end gap-2">
        <button
          type="button"
          onClick={onFechar}
          className="rounded-lg border border-line px-4 py-2 text-[13px] font-semibold text-ink"
        >
          {resultado && !erro ? "Fechar" : "Cancelar"}
        </button>
        <button
          type="button"
          disabled={!arqOrdens || !arqPesagem || !arqConferencia || enviando}
          onClick={enviar}
          className="rounded-lg bg-navy-900 px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-40"
        >
          {enviando ? "Importando…" : "Importar"}
        </button>
      </div>
    </ModalShell>
  );
}
