"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { fmtHa, fmtT, fmtTch } from "@/lib/format";
import type { SafraAgregado } from "@/lib/types";

type Dimensao = "fazenda" | "proprietario" | "municipio" | "variedade" | "corte";

const DIMENSOES: { key: Dimensao; label: string; coluna: string }[] = [
  { key: "fazenda", label: "Fazenda", coluna: "Fazenda" },
  { key: "proprietario", label: "Proprietário", coluna: "Proprietário" },
  { key: "municipio", label: "Município", coluna: "Município" },
  { key: "variedade", label: "Variedade", coluna: "Variedade" },
  { key: "corte", label: "Corte", coluna: "Corte" },
];

const FILTRO =
  "rounded-md border border-line bg-card px-2.5 py-1.5 text-[12.5px] text-ink focus:border-brand-600 focus:outline-none";
const LIMITE = 200;

function variacao(atual: number | null, anterior: number | null): number | null {
  if (atual === null || anterior === null || anterior <= 0) return null;
  return ((atual - anterior) / anterior) * 100;
}

function Variacao({ valor }: { valor: number | null }) {
  if (valor === null) return <span className="text-muted">—</span>;
  const cor = valor >= 0 ? "text-good-600" : "text-alert-600";
  return (
    <span className={`font-semibold ${cor}`}>
      {valor >= 0 ? "▲" : "▼"} {Math.abs(valor).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%
    </span>
  );
}

export default function ColheitaPainelClient({
  safras,
  dimensoes,
}: {
  safras: SafraAgregado[];
  dimensoes: Record<Dimensao, SafraAgregado[]>;
}) {
  const [dim, setDim] = useState<Dimensao>("fazenda");
  const [busca, setBusca] = useState("");
  const [verTudo, setVerTudo] = useState(false);

  const anos = useMemo(() => safras.map((s) => s.safra).sort((a, b) => a - b), [safras]);
  const ultima = anos[anos.length - 1];
  const anterior = anos.length > 1 ? anos[anos.length - 2] : undefined;
  const porAno = useMemo(() => new Map(safras.map((s) => [s.safra, s])), [safras]);

  const maxTch = Math.max(1, ...safras.flatMap((s) => [s.tchReal ?? 0, s.tchEst ?? 0]));

  const pivot = useMemo(() => {
    const mapa = new Map<string, Map<number, SafraAgregado>>();
    for (const r of dimensoes[dim]) {
      const linha = mapa.get(r.chave) ?? new Map<number, SafraAgregado>();
      linha.set(r.safra, r);
      mapa.set(r.chave, linha);
    }
    const termo = busca.trim().toLowerCase();
    return Array.from(mapa.entries())
      .filter(([chave]) => !termo || chave.toLowerCase().includes(termo))
      .map(([chave, linha]) => ({
        chave,
        linha,
        producaoUltima: ultima !== undefined ? (linha.get(ultima)?.producaoT ?? 0) : 0,
        areaUltima: ultima !== undefined ? (linha.get(ultima)?.areaTot ?? 0) : 0,
      }))
      .sort((a, b) => b.areaUltima - a.areaUltima || a.chave.localeCompare(b.chave));
  }, [dimensoes, dim, busca, ultima]);

  const visiveis = verTudo ? pivot : pivot.slice(0, LIMITE);
  const dimInfo = DIMENSOES.find((d) => d.key === dim)!;

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <header className="flex flex-shrink-0 items-center gap-3 border-b border-line bg-card px-6 py-3">
        <nav className="min-w-0 flex-1 text-[13px] text-muted">
          <span className="text-[11px] uppercase tracking-wide">Acompanhamentos</span>
          <div className="truncate text-[15px] font-bold text-ink">Colheita</div>
        </nav>
        <Link
          href="/acompanhamentos/colheita/historico-safras"
          className="rounded-lg border border-line bg-card px-3.5 py-2 text-[13px] font-semibold text-navy-800 shadow-card hover:bg-surface"
        >
          Histórico de Safras
        </Link>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        {safras.length === 0 ? (
          <div className="rounded-xl2 border border-dashed border-line bg-card px-6 py-14 text-center text-muted">
            Nenhuma safra importada ainda. Importe os relatórios em{" "}
            <Link href="/acompanhamentos/colheita/historico-safras" className="font-semibold text-brand-700">
              Histórico de Safras
            </Link>{" "}
            para ver os comparativos.
          </div>
        ) : (
          <>
            <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
              {ultima !== undefined && (
                <>
                  <Kpi titulo={`Safra ${ultima} · Área Total (ha)`} valor={fmtHa(porAno.get(ultima)!.areaTot)} />
                  <Kpi titulo={`Safra ${ultima} · Produção (t)`} valor={fmtT(porAno.get(ultima)!.producaoT)} />
                  <Kpi
                    titulo={`Safra ${ultima} · TCH Realizado (t/ha)`}
                    valor={porAno.get(ultima)!.tchReal !== null ? fmtTch(porAno.get(ultima)!.tchReal!) : "—"}
                    extra={
                      anterior !== undefined ? (
                        <>
                          vs {anterior}: <Variacao valor={variacao(porAno.get(ultima)!.tchReal, porAno.get(anterior)!.tchReal)} />
                        </>
                      ) : null
                    }
                  />
                  <Kpi
                    titulo={`Safra ${ultima} · TCH Estimado (t/ha)`}
                    valor={porAno.get(ultima)!.tchEst !== null ? fmtTch(porAno.get(ultima)!.tchEst!) : "—"}
                    extra={
                      porAno.get(ultima)!.tchEst && porAno.get(ultima)!.tchReal ? (
                        <>
                          Real/Est.:{" "}
                          <b>
                            {(((porAno.get(ultima)!.tchReal as number) / (porAno.get(ultima)!.tchEst as number)) * 100).toLocaleString(
                              "pt-BR",
                              { maximumFractionDigits: 0 }
                            )}
                            %
                          </b>
                        </>
                      ) : null
                    }
                  />
                </>
              )}
            </div>

            <div className="mb-5 grid grid-cols-1 gap-4 xl:grid-cols-[1.2fr_1fr]">
              <div className="overflow-hidden rounded-xl2 border border-line bg-card shadow-card">
                <div className="border-b border-line bg-surface px-4 py-2.5 text-[14px] font-bold text-ink">
                  Comparativo por safra
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-[12.5px]">
                    <thead>
                      <tr className="border-b border-line bg-surface text-left text-muted">
                        <th className="px-4 py-2 font-semibold">Safra</th>
                        <th className="px-3 py-2 text-right font-semibold">Área Total (ha)</th>
                        <th className="px-3 py-2 text-right font-semibold">Produção (t)</th>
                        <th className="px-3 py-2 text-right font-semibold">TCH Realizado (t/ha)</th>
                        <th className="px-3 py-2 text-right font-semibold">TCH Estimado (t/ha)</th>
                        <th className="px-4 py-2 text-right font-semibold">Variação TCH</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...anos].reverse().map((ano, idx, lista) => {
                        const r = porAno.get(ano)!;
                        const ant = lista[idx + 1] !== undefined ? porAno.get(lista[idx + 1]) : undefined;
                        return (
                          <tr key={ano} className="border-b border-line last:border-0">
                            <td className="px-4 py-1.5 font-semibold text-ink">{ano}</td>
                            <td className="px-3 py-1.5 text-right tabular text-ink">{fmtHa(r.areaTot)}</td>
                            <td className="px-3 py-1.5 text-right tabular text-ink">{fmtT(r.producaoT)}</td>
                            <td className="px-3 py-1.5 text-right font-semibold tabular text-ink">
                              {r.tchReal !== null ? fmtTch(r.tchReal) : "—"}
                            </td>
                            <td className="px-3 py-1.5 text-right tabular text-muted">
                              {r.tchEst !== null ? fmtTch(r.tchEst) : "—"}
                            </td>
                            <td className="px-4 py-1.5 text-right tabular">
                              <Variacao valor={ant ? variacao(r.tchReal, ant.tchReal) : null} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="overflow-hidden rounded-xl2 border border-line bg-card shadow-card">
                <div className="flex items-center justify-between border-b border-line bg-surface px-4 py-2.5">
                  <span className="text-[14px] font-bold text-ink">TCH por safra (t/ha)</span>
                  <span className="flex items-center gap-3 text-[11px] text-muted">
                    <span className="flex items-center gap-1">
                      <span className="h-2 w-2 rounded-sm bg-navy-900" /> Realizado
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="h-2 w-2 rounded-sm bg-amber-500" /> Estimado
                    </span>
                  </span>
                </div>
                <div className="space-y-2.5 px-4 py-3">
                  {anos.map((ano) => {
                    const r = porAno.get(ano)!;
                    return (
                      <div key={ano} className="flex items-center gap-3 text-[12px]">
                        <span className="w-10 font-semibold text-ink">{ano}</span>
                        <div className="flex-1 space-y-1">
                          <Barra valor={r.tchReal} max={maxTch} cor="bg-navy-900" />
                          <Barra valor={r.tchEst} max={maxTch} cor="bg-amber-500" />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="overflow-hidden rounded-xl2 border border-line bg-card shadow-card">
              <div className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-4 py-2.5">
                <h2 className="text-[14px] font-bold text-ink">TCH Realizado (t/ha) por {dimInfo.label}</h2>
                <select
                  value={dim}
                  onChange={(e) => {
                    setDim(e.target.value as Dimensao);
                    setVerTudo(false);
                  }}
                  aria-label="Agrupar por"
                  className={FILTRO}
                >
                  {DIMENSOES.map((d) => (
                    <option key={d.key} value={d.key}>
                      Por {d.label}
                    </option>
                  ))}
                </select>
                <input
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder={`Buscar ${dimInfo.label.toLowerCase()}…`}
                  className={`${FILTRO} min-w-[220px]`}
                />
                <span className="ml-auto text-[12px] text-muted">
                  {pivot.length} {pivot.length === 1 ? "linha" : "linhas"}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr className="border-b border-line bg-surface text-left text-muted">
                      <th className="px-4 py-2 font-semibold">{dimInfo.coluna}</th>
                      <th className="px-3 py-2 text-right font-semibold">
                        Área {ultima} (ha)
                      </th>
                      {anos.map((ano) => (
                        <th key={ano} className="px-3 py-2 text-right font-semibold">
                          TCH {ano} (t/ha)
                        </th>
                      ))}
                      {ultima !== undefined && anterior !== undefined && (
                        <th className="px-4 py-2 text-right font-semibold">
                          Variação {ultima} x {anterior}
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {visiveis.map((l) => (
                      <tr key={l.chave} className="border-b border-line last:border-0">
                        <td className="px-4 py-1.5 font-semibold text-ink">{l.chave || "—"}</td>
                        <td className="px-3 py-1.5 text-right tabular text-ink">
                          {l.areaUltima > 0 ? fmtHa(l.areaUltima) : "—"}
                        </td>
                        {anos.map((ano) => {
                          const v = l.linha.get(ano)?.tchReal ?? null;
                          return (
                            <td key={ano} className="px-3 py-1.5 text-right tabular text-ink">
                              {v !== null ? fmtTch(v) : "—"}
                            </td>
                          );
                        })}
                        {ultima !== undefined && anterior !== undefined && (
                          <td className="px-4 py-1.5 text-right tabular">
                            <Variacao
                              valor={variacao(l.linha.get(ultima)?.tchReal ?? null, l.linha.get(anterior)?.tchReal ?? null)}
                            />
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!verTudo && pivot.length > LIMITE && (
                <div className="border-t border-line bg-surface px-4 py-2 text-center text-[12.5px]">
                  Mostrando {LIMITE} de {pivot.length}.{" "}
                  <button type="button" onClick={() => setVerTudo(true)} className="font-semibold text-brand-700">
                    Mostrar todas
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Kpi({ titulo, valor, extra }: { titulo: string; valor: string; extra?: React.ReactNode }) {
  return (
    <div className="rounded-xl2 border border-line bg-card px-4 py-3 shadow-card">
      <div className="text-[11.5px] font-semibold text-muted">{titulo}</div>
      <div className="text-[20px] font-bold text-ink">{valor}</div>
      {extra ? <div className="mt-0.5 text-[11.5px] text-muted">{extra}</div> : null}
    </div>
  );
}

function Barra({ valor, max, cor }: { valor: number | null; max: number; cor: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-surface">
        {valor !== null && <div className={`h-full rounded-full ${cor}`} style={{ width: `${(valor / max) * 100}%` }} />}
      </div>
      <span className="w-12 text-right text-[11px] tabular text-muted">{valor !== null ? fmtTch(valor) : "—"}</span>
    </div>
  );
}
