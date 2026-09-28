"use client";

import { useMemo, useState, type ReactNode } from "react";
import { OrdemCorte, Periodo, StatusOrdem } from "@/lib/types";
import {
  calcOrdemMetrics,
  calcTalhaoEntradaPeriodo,
  endOfMonth,
  endOfWeekMonday,
  rangeForPeriod,
  resumoPorFrente,
  startOfMonth,
  startOfWeekMonday,
} from "@/lib/period";
import { fmtDateBR, fmtHa, fmtT, fmtTch, todayISO } from "@/lib/format";

const PERIODOS: { key: Periodo; label: string }[] = [
  { key: "dia", label: "Dia" },
  { key: "semana", label: "Semana" },
  { key: "mes", label: "Mês" },
  { key: "safra", label: "Safra" },
];

function ultimaDataComMovimento(ordens: OrdemCorte[]): string {
  let max = "";
  for (const o of ordens) for (const l of o.lancamentos) if (l.data > max) max = l.data;
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

export default function OrdensCorteClient({ initialOrdens }: { initialOrdens: OrdemCorte[] }) {
  const [ordens, setOrdens] = useState<OrdemCorte[]>(initialOrdens);
  const [period, setPeriod] = useState<Periodo>("dia");
  const [referencia, setReferencia] = useState<string>(() => ultimaDataComMovimento(initialOrdens));
  const [frenteFiltro, setFrenteFiltro] = useState<string>("todas");
  const [statusFiltro, setStatusFiltro] = useState<"todas" | StatusOrdem>("todas");
  const [busca, setBusca] = useState("");
  const [novaOrdemAberta, setNovaOrdemAberta] = useState(false);
  const [importarAberto, setImportarAberto] = useState(false);
  const [lancamentoAlvo, setLancamentoAlvo] = useState<OrdemCorte | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [ultimoSalvamento, setUltimoSalvamento] = useState<string>(() => new Date().toISOString());
  const [colapsadas, setColapsadas] = useState<Set<string>>(new Set());

  async function refetch() {
    const res = await fetch("/api/ordens-corte", { cache: "no-store" });
    const data = await res.json();
    setOrdens(data.ordens);
    setUltimoSalvamento(new Date().toISOString());
  }

  const frentes = useMemo(
    () => Array.from(new Set(ordens.map((o) => o.frente))).sort(),
    [ordens]
  );

  const safraLabel = ordens[0]?.safraLabel ?? "2026/27";

  const ordensFiltradas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return ordens.filter((o) => {
      if (frenteFiltro !== "todas" && o.frente !== frenteFiltro) return false;
      if (statusFiltro !== "todas" && o.status !== statusFiltro) return false;
      if (termo) {
        const alvo = `${o.numero} ${o.fazendaCodigo} ${o.fazendaNome}`.toLowerCase();
        if (!alvo.includes(termo)) return false;
      }
      return true;
    });
  }, [ordens, frenteFiltro, statusFiltro, busca]);

  const porFrente = useMemo(() => {
    const map = new Map<string, OrdemCorte[]>();
    for (const o of ordensFiltradas) {
      const arr = map.get(o.frente) ?? [];
      arr.push(o);
      map.set(o.frente, arr);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [ordensFiltradas]);

  const resumoFrentes = useMemo(
    () => resumoPorFrente(ordensFiltradas, period, referencia),
    [ordensFiltradas, period, referencia]
  );

  const totalGeral = useMemo(() => {
    let entradaPeriodoT = 0;
    let areaLiberadaHa = 0;
    let abertas = 0;
    let encerradas = 0;
    for (const o of ordensFiltradas) {
      const m = calcOrdemMetrics(o, period, referencia);
      entradaPeriodoT += m.entradaPeriodoT;
      areaLiberadaHa += o.areaLiberadaHa;
      if (o.status === "Aberta") abertas += 1;
      else encerradas += 1;
    }
    return {
      entradaPeriodoT: Math.round(entradaPeriodoT * 100) / 100,
      areaLiberadaHa: Math.round(areaLiberadaHa * 100) / 100,
      abertas,
      encerradas,
      total: ordensFiltradas.length,
    };
  }, [ordensFiltradas, period, referencia]);

  async function criarOrdem(payload: any) {
    setSalvando(true);
    try {
      const res = await fetch("/api/ordens-corte", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json();
        alert(err.error ?? "Não foi possível salvar a ordem.");
        return;
      }
      await refetch();
      setNovaOrdemAberta(false);
    } finally {
      setSalvando(false);
    }
  }

  async function lancarApontamento(ordemId: string, payload: any) {
    setSalvando(true);
    try {
      const res = await fetch(`/api/ordens-corte/${ordemId}/lancamentos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json();
        alert(err.error ?? "Não foi possível salvar o apontamento.");
        return;
      }
      await refetch();
      setLancamentoAlvo(null);
    } finally {
      setSalvando(false);
    }
  }

  async function alternarStatus(ordem: OrdemCorte) {
    setSalvando(true);
    try {
      const novo = ordem.status === "Aberta" ? "Encerrada" : "Aberta";
      const res = await fetch(`/api/ordens-corte/${ordem.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: novo }),
      });
      if (res.ok) await refetch();
    } finally {
      setSalvando(false);
    }
  }

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
          {salvando ? "Salvando…" : "Salvo no servidor"}
        </div>
        <button
          type="button"
          onClick={() => setImportarAberto(true)}
          className="flex items-center gap-1.5 rounded-lg border border-line bg-card px-3.5 py-2 text-[13px] font-semibold text-ink shadow-card hover:bg-surface"
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
          Importar planilha
        </button>
        <button
          type="button"
          onClick={() => setNovaOrdemAberta(true)}
          className="flex items-center gap-1.5 rounded-lg bg-navy-900 px-3.5 py-2 text-[13px] font-semibold text-white shadow-card hover:bg-navy-800"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
            <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
          </svg>
          Nova Ordem de Corte
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-5">
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
            onChange={(e) => setStatusFiltro(e.target.value as any)}
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
          <StatCard label="Ordens no filtro" value={totalGeral.total.toString()} sub={`${totalGeral.abertas} abertas · ${totalGeral.encerradas} encerradas`} />
          <StatCard label="Abertas" value={totalGeral.abertas.toString()} sub="Em corte ou liberadas" />
          <StatCard label="Encerradas" value={totalGeral.encerradas.toString()} sub="Concluídas na safra" />
          <StatCard label="Área liberada" value={`${fmtHa(totalGeral.areaLiberadaHa)} ha`} sub="Soma das ordens do filtro" />
          <StatCard
            label={`Entrada · ${PERIODOS.find((p) => p.key === period)?.label}`}
            value={`${fmtT(totalGeral.entradaPeriodoT)} t`}
            sub={periodoTexto(period, referencia, safraLabel)}
            destaque
          />
        </div>

        {period !== "safra" && totalGeral.entradaPeriodoT === 0 && totalGeral.total > 0 && (
          <p className="-mt-2 mb-4 text-[12px] text-muted">
            Nenhum apontamento registrado para {periodoTexto(period, referencia, safraLabel).toLowerCase()}. Os
            filtros só mostram as datas em que houve um lançamento — use{" "}
            <button type="button" onClick={() => setImportarAberto(true)} className="font-semibold text-brand-700">
              Importar planilha
            </button>{" "}
            ou lance um apontamento manual nessa data.
          </p>
        )}

        {/* Resumo por frente (como a tabela Frente x Total do relatório) */}
        {resumoFrentes.length > 0 && (
          <div className="mb-5 overflow-x-auto rounded-xl2 border border-line bg-card shadow-card">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-line bg-surface text-left text-muted">
                  <th className="px-4 py-2 font-semibold">Frente</th>
                  <th className="px-3 py-2 text-right font-semibold">Ordens</th>
                  <th className="px-3 py-2 text-right font-semibold">Área liberada (ha)</th>
                  <th className="px-4 py-2 text-right font-semibold">
                    Entrada {PERIODOS.find((p) => p.key === period)?.label.toLowerCase()} (t)
                  </th>
                </tr>
              </thead>
              <tbody>
                {resumoFrentes.map((r) => (
                  <tr key={r.frente} className="border-b border-line last:border-0">
                    <td className="px-4 py-1.5 font-semibold text-ink">{r.frente}</td>
                    <td className="px-3 py-1.5 text-right tabular text-muted">{r.ordens}</td>
                    <td className="px-3 py-1.5 text-right tabular text-ink">{fmtHa(r.areaLiberadaHa)}</td>
                    <td className="px-4 py-1.5 text-right tabular font-semibold text-brand-700">
                      {fmtT(r.entradaPeriodoT)}
                    </td>
                  </tr>
                ))}
                <tr className="bg-surface font-bold text-ink">
                  <td className="px-4 py-1.5">Total geral</td>
                  <td className="px-3 py-1.5 text-right tabular">{totalGeral.total}</td>
                  <td className="px-3 py-1.5 text-right tabular">{fmtHa(totalGeral.areaLiberadaHa)}</td>
                  <td className="px-4 py-1.5 text-right tabular text-brand-700">
                    {fmtT(totalGeral.entradaPeriodoT)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* Grupos por frente com os cards ("quadrados") */}
        {porFrente.length === 0 && (
          <div className="rounded-xl2 border border-dashed border-line bg-card px-6 py-14 text-center text-muted">
            Nenhuma ordem de corte encontrada para os filtros selecionados.
          </div>
        )}

        {porFrente.map(([frente, lista]) => {
          const aberto = !colapsadas.has(frente);
          const subtotal = lista.reduce(
            (s, o) => s + calcOrdemMetrics(o, period, referencia).entradaPeriodoT,
            0
          );
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
                      onLancar={() => setLancamentoAlvo(ordem)}
                      onAlternarStatus={() => alternarStatus(ordem)}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}

        <p className="mb-2 mt-6 text-center text-[11.5px] text-muted">
          Última atualização {new Date(ultimoSalvamento).toLocaleString("pt-BR")} · dados gravados no servidor
        </p>
      </div>

      {novaOrdemAberta && (
        <NovaOrdemModal
          frentesExistentes={frentes}
          safraLabel={safraLabel}
          salvando={salvando}
          onFechar={() => setNovaOrdemAberta(false)}
          onSalvar={criarOrdem}
        />
      )}

      {lancamentoAlvo && (
        <LancamentoModal
          ordem={lancamentoAlvo}
          salvando={salvando}
          onFechar={() => setLancamentoAlvo(null)}
          onSalvar={(payload) => lancarApontamento(lancamentoAlvo.id, payload)}
        />
      )}

      {importarAberto && (
        <ImportarModal onFechar={() => setImportarAberto(false)} onImportado={refetch} />
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
      {sub && (
        <div className={`mt-1.5 text-[11px] ${destaque ? "text-brand-200/90" : "text-muted"}`}>{sub}</div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: StatusOrdem }) {
  const aberta = status === "Aberta";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold ${
        aberta ? "bg-brand-100 text-brand-700" : "bg-good-50 text-good-600"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${aberta ? "bg-brand-600" : "bg-good-500"}`} />
      {aberta ? "Aberta" : "Encerrada"}
    </span>
  );
}

function OrdemCard({
  ordem,
  period,
  referencia,
  onLancar,
  onAlternarStatus,
}: {
  ordem: OrdemCorte;
  period: Periodo;
  referencia: string;
  onLancar: () => void;
  onAlternarStatus: () => void;
}) {
  const m = calcOrdemMetrics(ordem, period, referencia);
  const acimaDoEstimado = ordem.tchEstimado > 0 && m.tchGeralRealizado >= ordem.tchEstimado;

  return (
    <div className="flex flex-col overflow-hidden rounded-xl2 border border-line bg-card shadow-card">
      <div className="flex items-center justify-between gap-2 border-b border-amber-500/25 bg-amber-50 px-4 py-2.5">
        <div>
          <div className="text-[14px] font-extrabold tracking-tight text-navy-900">Ordem - {ordem.numero}</div>
          <div className="text-[11.5px] text-muted">
            {ordem.fazendaCodigo} · {ordem.fazendaNome}
          </div>
        </div>
        <StatusBadge status={ordem.status} />
      </div>

      <div className="px-4 pt-3 text-[11px] font-semibold uppercase tracking-wide text-muted">
        {ordem.regiao} · Talhões
      </div>
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
            {ordem.talhoes.map((t) => (
              <tr key={t.talhao} className="border-t border-line/70">
                <td className="py-1 font-medium text-ink">{t.talhao}</td>
                <td className="py-1 text-right tabular text-muted">{fmtHa(t.areaHa)}</td>
                <td className="py-1 text-right tabular text-muted">
                  {fmtT(calcTalhaoEntradaPeriodo(ordem, t, period, referencia))}
                </td>
                <td className="py-1 text-right tabular font-medium text-ink">{fmtT(t.acumSafraT)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mx-4 my-3 grid grid-cols-2 gap-2 rounded-lg bg-surface p-2.5 text-[12px]">
        <div>
          <div className="text-muted">Área colhida</div>
          <div className="font-semibold tabular text-ink">{fmtHa(ordem.areaColhidaHa)} ha</div>
        </div>
        <div>
          <div className="text-muted">Área liberada</div>
          <div className="font-semibold tabular text-ink">{fmtHa(ordem.areaLiberadaHa)} ha</div>
        </div>
        <div className="col-span-2 rounded-md bg-brand-50 px-2 py-1.5">
          <div className="text-brand-700">Entrada no período selecionado</div>
          <div className="text-[15px] font-bold tabular text-brand-700">{fmtT(m.entradaPeriodoT)} t</div>
        </div>
      </div>

      <div className="mx-4 mb-3 flex flex-wrap gap-1.5 text-[10.5px]">
        <span className="rounded-full bg-surface px-2 py-1 font-semibold text-muted">
          TCH safra ant. <b className="text-ink">{fmtTch(ordem.tchRealizadoSafraAnterior)}</b>
        </span>
        <span className="rounded-full bg-surface px-2 py-1 font-semibold text-muted">
          TCH estimado <b className="text-ink">{fmtTch(ordem.tchEstimado)}</b>
        </span>
        <span
          className={`rounded-full px-2 py-1 font-semibold ${
            acimaDoEstimado ? "bg-good-50 text-good-600" : "bg-amber-50 text-amber-600"
          }`}
        >
          TCH geral realizado <b>{fmtTch(m.tchGeralRealizado)}</b>
        </span>
      </div>

      <div className="mt-auto flex gap-2 border-t border-line px-4 py-2.5">
        <button
          type="button"
          onClick={onLancar}
          className="flex-1 rounded-lg bg-navy-900 px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-navy-800"
        >
          + Apontamento
        </button>
        <button
          type="button"
          onClick={onAlternarStatus}
          className="rounded-lg border border-line px-3 py-1.5 text-[12.5px] font-semibold text-ink hover:bg-surface"
        >
          {ordem.status === "Aberta" ? "Encerrar" : "Reabrir"}
        </button>
      </div>
    </div>
  );
}

function NovaOrdemModal({
  frentesExistentes,
  safraLabel,
  salvando,
  onFechar,
  onSalvar,
}: {
  frentesExistentes: string[];
  safraLabel: string;
  salvando: boolean;
  onFechar: () => void;
  onSalvar: (payload: any) => void;
}) {
  const [numero, setNumero] = useState("");
  const [frente, setFrente] = useState(frentesExistentes[0] ?? "");
  const [regiao, setRegiao] = useState("Reg - 1");
  const [fazendaCodigo, setFazendaCodigo] = useState("");
  const [fazendaNome, setFazendaNome] = useState("");
  const [tchEstimado, setTchEstimado] = useState("");
  const [talhoes, setTalhoes] = useState([{ talhao: "1", areaHa: "" }]);

  function addTalhao() {
    setTalhoes((prev) => [...prev, { talhao: String(prev.length + 1), areaHa: "" }]);
  }
  function removeTalhao(idx: number) {
    setTalhoes((prev) => prev.filter((_, i) => i !== idx));
  }
  function updateTalhao(idx: number, campo: "talhao" | "areaHa", valor: string) {
    setTalhoes((prev) => prev.map((t, i) => (i === idx ? { ...t, [campo]: valor } : t)));
  }

  function submeter() {
    onSalvar({
      numero,
      frente,
      regiao,
      fazendaCodigo,
      fazendaNome,
      safraLabel,
      tchEstimado: tchEstimado ? Number(tchEstimado) : undefined,
      talhoes: talhoes
        .filter((t) => t.talhao.trim())
        .map((t) => ({ talhao: t.talhao.trim(), areaHa: Number(t.areaHa) || 0 })),
    });
  }

  const valido = numero.trim() && frente.trim() && fazendaNome.trim() && talhoes.some((t) => t.talhao.trim());

  return (
    <ModalShell titulo="Nova Ordem de Corte" onFechar={onFechar}>
      <div className="grid grid-cols-2 gap-3">
        <Campo label="Número da ordem">
          <input value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="ex.: 2470" className="input" />
        </Campo>
        <Campo label="Frente">
          <input
            list="frentes-existentes"
            value={frente}
            onChange={(e) => setFrente(e.target.value)}
            placeholder="ex.: FRENTE-1"
            className="input"
          />
          <datalist id="frentes-existentes">
            {frentesExistentes.map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>
        </Campo>
        <Campo label="Região">
          <input value={regiao} onChange={(e) => setRegiao(e.target.value)} className="input" />
        </Campo>
        <Campo label="TCH estimado">
          <input
            value={tchEstimado}
            onChange={(e) => setTchEstimado(e.target.value)}
            inputMode="decimal"
            placeholder="ex.: 70"
            className="input"
          />
        </Campo>
        <Campo label="Código da fazenda">
          <input value={fazendaCodigo} onChange={(e) => setFazendaCodigo(e.target.value)} className="input" />
        </Campo>
        <Campo label="Nome da fazenda">
          <input value={fazendaNome} onChange={(e) => setFazendaNome(e.target.value)} className="input" />
        </Campo>
      </div>

      <div className="mt-4">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[12.5px] font-semibold text-ink">Talhões</span>
          <button type="button" onClick={addTalhao} className="text-[12.5px] font-semibold text-brand-700">
            + adicionar talhão
          </button>
        </div>
        <div className="flex flex-col gap-1.5">
          {talhoes.map((t, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <input
                value={t.talhao}
                onChange={(e) => updateTalhao(idx, "talhao", e.target.value)}
                placeholder="Talhão"
                className="input w-24"
              />
              <input
                value={t.areaHa}
                onChange={(e) => updateTalhao(idx, "areaHa", e.target.value)}
                placeholder="Área (ha)"
                inputMode="decimal"
                className="input flex-1"
              />
              {talhoes.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeTalhao(idx)}
                  className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-alert-500 hover:bg-alert-50"
                  aria-label="Remover talhão"
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={onFechar} className="rounded-lg border border-line px-4 py-2 text-[13px] font-semibold text-ink">
          Cancelar
        </button>
        <button
          type="button"
          disabled={!valido || salvando}
          onClick={submeter}
          className="rounded-lg bg-navy-900 px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-40"
        >
          {salvando ? "Salvando…" : "Criar ordem"}
        </button>
      </div>
    </ModalShell>
  );
}

function LancamentoModal({
  ordem,
  salvando,
  onFechar,
  onSalvar,
}: {
  ordem: OrdemCorte;
  salvando: boolean;
  onFechar: () => void;
  onSalvar: (payload: any) => void;
}) {
  const [data, setData] = useState(todayISO());
  const [modoDetalhado, setModoDetalhado] = useState(false);
  const [totalSimples, setTotalSimples] = useState("");
  const [porTalhao, setPorTalhao] = useState<Record<string, string>>({});

  const totalDetalhado = Object.values(porTalhao).reduce((s, v) => s + (Number(v) || 0), 0);

  function submeter() {
    if (modoDetalhado) {
      onSalvar({
        data,
        toneladas: totalDetalhado,
        porTalhao: ordem.talhoes
          .map((t) => ({ talhao: t.talhao, toneladas: Number(porTalhao[t.talhao]) || 0 }))
          .filter((p) => p.toneladas > 0),
      });
    } else {
      onSalvar({ data, toneladas: Number(totalSimples) || 0 });
    }
  }

  const valido = data && (modoDetalhado ? totalDetalhado > 0 : Number(totalSimples) > 0);

  return (
    <ModalShell titulo={`Apontamento · Ordem ${ordem.numero}`} onFechar={onFechar}>
      <p className="mb-3 text-[12.5px] text-muted">
        {ordem.fazendaCodigo} · {ordem.fazendaNome} — lance a tonelagem que entrou nesta data. Ela passa a
        contar nos filtros de dia, semana e mês, e soma ao acumulado da safra.
      </p>
      <Campo label="Data do apontamento">
        <input type="date" value={data} onChange={(e) => setData(e.target.value)} className="input" />
      </Campo>

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setModoDetalhado(false)}
          className={`rounded-md px-3 py-1.5 text-[12.5px] font-semibold ${
            !modoDetalhado ? "bg-navy-900 text-white" : "bg-surface text-ink"
          }`}
        >
          Total da ordem
        </button>
        <button
          type="button"
          onClick={() => setModoDetalhado(true)}
          className={`rounded-md px-3 py-1.5 text-[12.5px] font-semibold ${
            modoDetalhado ? "bg-navy-900 text-white" : "bg-surface text-ink"
          }`}
        >
          Detalhar por talhão
        </button>
      </div>

      {!modoDetalhado ? (
        <div className="mt-3">
          <Campo label="Toneladas entradas na data">
            <input
              value={totalSimples}
              onChange={(e) => setTotalSimples(e.target.value)}
              inputMode="decimal"
              placeholder="ex.: 140,09"
              className="input"
            />
          </Campo>
          <p className="mt-1 text-[11.5px] text-muted">
            A tonelagem é distribuída entre os talhões proporcionalmente à área de cada um.
          </p>
        </div>
      ) : (
        <div className="mt-3 max-h-[220px] overflow-y-auto rounded-lg border border-line">
          <table className="w-full text-[12.5px]">
            <thead className="sticky top-0 bg-surface">
              <tr className="text-left text-muted">
                <th className="px-3 py-1.5 font-semibold">Talhão</th>
                <th className="px-3 py-1.5 text-right font-semibold">Área (ha)</th>
                <th className="px-3 py-1.5 text-right font-semibold">Toneladas</th>
              </tr>
            </thead>
            <tbody>
              {ordem.talhoes.map((t) => (
                <tr key={t.talhao} className="border-t border-line">
                  <td className="px-3 py-1.5 font-medium text-ink">{t.talhao}</td>
                  <td className="px-3 py-1.5 text-right tabular text-muted">{fmtHa(t.areaHa)}</td>
                  <td className="px-3 py-1.5 text-right">
                    <input
                      value={porTalhao[t.talhao] ?? ""}
                      onChange={(e) => setPorTalhao((prev) => ({ ...prev, [t.talhao]: e.target.value }))}
                      inputMode="decimal"
                      placeholder="0"
                      className="input w-24 text-right"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex justify-end border-t border-line px-3 py-1.5 text-[12.5px] font-semibold text-ink">
            Total: {fmtT(totalDetalhado)} t
          </div>
        </div>
      )}

      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={onFechar} className="rounded-lg border border-line px-4 py-2 text-[13px] font-semibold text-ink">
          Cancelar
        </button>
        <button
          type="button"
          disabled={!valido || salvando}
          onClick={submeter}
          className="rounded-lg bg-navy-900 px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-40"
        >
          {salvando ? "Salvando…" : "Lançar apontamento"}
        </button>
      </div>
    </ModalShell>
  );
}

interface ResultadoImportacaoUI {
  ordensCriadas: number;
  ordensAtualizadas: number;
  talhoesCriados: number;
  lancamentosCriados: number;
  lancamentosAtualizados: number;
  linhasLidas: number;
  totalLinhasPlanilha: number;
  avisos: string[];
  erros: string[];
}

function ImportarModal({ onFechar, onImportado }: { onFechar: () => void; onImportado: () => void }) {
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoImportacaoUI | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function enviar() {
    if (!arquivo) return;
    setEnviando(true);
    setErro(null);
    setResultado(null);
    try {
      const form = new FormData();
      form.append("arquivo", arquivo);
      const res = await fetch("/api/ordens-corte/importar", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) {
        setErro(data?.error ?? "Não foi possível importar o arquivo.");
        if (data?.erros || data?.avisos) setResultado({ ...emptyResultado, ...data });
        return;
      }
      setResultado(data);
      onImportado();
    } catch {
      setErro("Não foi possível enviar o arquivo. Verifique a conexão e tente novamente.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <ModalShell titulo="Importar planilha de ordens de corte" onFechar={onFechar}>
      <p className="mb-3 text-[12.5px] text-muted">
        Envie a planilha de origem (.xlsx, .xls ou .csv). O sistema reconhece colunas como Ordem, Talhão, Área,
        Data e Toneladas mesmo com nomes um pouco diferentes do modelo — o que não for entendido aparece listado
        abaixo, sem travar o restante da importação. A planilha é tratada como referência: valores já cadastrados
        no sistema não são apagados, só completados.
      </p>

      <a
        href="/templates/modelo-importacao-ordens-corte.xlsx"
        download
        className="mb-4 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-brand-700 hover:underline"
      >
        ↓ Baixar modelo de planilha
      </a>

      <Campo label="Arquivo (.xlsx, .xls ou .csv)">
        <input
          type="file"
          accept=".xlsx,.xls,.csv"
          onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
          className="block w-full text-[12.5px] text-ink file:mr-3 file:rounded-md file:border-0 file:bg-navy-900 file:px-3 file:py-1.5 file:text-[12.5px] file:font-semibold file:text-white"
        />
      </Campo>

      {erro && (
        <div className="mt-3 rounded-lg border border-alert-500/30 bg-alert-50 px-3 py-2 text-[12.5px] text-alert-600">
          {erro}
        </div>
      )}

      {resultado && !erro && (
        <div className="mt-3 rounded-lg border border-good-500/30 bg-good-50 px-3 py-2 text-[12.5px] text-good-700">
          <p className="font-semibold">
            {resultado.ordensCriadas} ordem(ns) nova(s), {resultado.ordensAtualizadas} atualizada(s) ·{" "}
            {resultado.lancamentosCriados} apontamento(s) novo(s), {resultado.lancamentosAtualizados} atualizado(s).
          </p>
          <p className="mt-1 text-good-600">
            {resultado.linhasLidas} de {resultado.totalLinhasPlanilha} linhas da planilha foram usadas nesta
            importação.
          </p>
        </div>
      )}

      {resultado && resultado.avisos.length > 0 && (
        <div className="mt-3 max-h-[140px] overflow-y-auto rounded-lg border border-line bg-surface p-2.5 text-[12px] text-muted">
          <p className="mb-1 font-semibold text-ink">
            Avisos ({resultado.avisos.length}) — mantido o que já estava cadastrado no sistema:
          </p>
          <ul className="list-disc space-y-0.5 pl-4">
            {resultado.avisos.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </div>
      )}

      {resultado && resultado.erros.length > 0 && (
        <div className="mt-3 max-h-[140px] overflow-y-auto rounded-lg border border-alert-500/20 bg-alert-50/60 p-2.5 text-[12px] text-alert-600">
          <p className="mb-1 font-semibold">Linhas ignoradas ({resultado.erros.length}):</p>
          <ul className="list-disc space-y-0.5 pl-4">
            {resultado.erros.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={onFechar} className="rounded-lg border border-line px-4 py-2 text-[13px] font-semibold text-ink">
          {resultado && !erro ? "Fechar" : "Cancelar"}
        </button>
        <button
          type="button"
          disabled={!arquivo || enviando}
          onClick={enviar}
          className="rounded-lg bg-navy-900 px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-40"
        >
          {enviando ? "Importando…" : "Importar"}
        </button>
      </div>
    </ModalShell>
  );
}

const emptyResultado: ResultadoImportacaoUI = {
  ordensCriadas: 0,
  ordensAtualizadas: 0,
  talhoesCriados: 0,
  lancamentosCriados: 0,
  lancamentosAtualizados: 0,
  linhasLidas: 0,
  totalLinhasPlanilha: 0,
  avisos: [],
  erros: [],
};

function Campo({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-semibold text-muted">{label}</span>
      {children}
    </label>
  );
}

function ModalShell({
  titulo,
  onFechar,
  children,
}: {
  titulo: string;
  onFechar: () => void;
  children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy-950/50 px-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl2 bg-card p-5 shadow-pop">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[16px] font-bold text-ink">{titulo}</h2>
          <button
            type="button"
            onClick={onFechar}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-surface"
            aria-label="Fechar"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
