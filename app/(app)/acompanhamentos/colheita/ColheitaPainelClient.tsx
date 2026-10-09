"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { fmtHa, fmtT, fmtTch } from "@/lib/format";
import type { SafraAgregado, SafraVariedadeCorte } from "@/lib/types";
import { ehBooleano, ehTexto, usarPersistido } from "@/lib/usar-persistido";
import BotaoLimparFiltros from "@/components/BotaoLimparFiltros";
import { IconHistorico } from "@/components/icons";
import { CabecalhoPagina, Comando, CorpoPagina, EstadoVazio, Indicador, Pagina, Painel, type CorIndicador } from "@/components/pagina";

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
  variedadeCorte,
}: {
  safras: SafraAgregado[];
  dimensoes: Record<Dimensao, SafraAgregado[]>;
  variedadeCorte: SafraVariedadeCorte[];
}) {
  const [dim, setDim] = usarPersistido<Dimensao>("colheita.dimensao", "fazenda", ehTexto as (v: unknown) => v is Dimensao);
  const [busca, setBusca] = usarPersistido("colheita.busca", "", ehTexto);
  const [verTudo, setVerTudo] = usarPersistido("colheita.verTudo", false, ehBooleano);
  const algumFiltroAtivo = busca !== "" || verTudo !== false;
  function limparFiltros() {
    setBusca("");
    setVerTudo(false);
  }

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
    <Pagina>
      <CabecalhoPagina
        titulo="Dashboard"
        categoria="Moagem"
        comandos={
          <Comando href="/acompanhamentos/colheita/historico-safras" icone={<IconHistorico size={16} />}>
            Histórico de Safras
          </Comando>
        }
      />

      <CorpoPagina>
        {safras.length === 0 ? (
          <Painel semEspaco>
            <EstadoVazio titulo="Nenhuma safra importada ainda.">
              Importe os relatórios em{" "}
              <Link href="/acompanhamentos/colheita/historico-safras" className="font-semibold text-brand-700">
                Histórico de Safras
              </Link>{" "}
              para ver os comparativos.
            </EstadoVazio>
          </Painel>
        ) : (
          <>
            <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
              {ultima !== undefined && (
                <>
                  <Kpi cor="azul" titulo={`Safra ${ultima} · Área Total (ha)`} valor={fmtHa(porAno.get(ultima)!.areaTot)} />
                  <Kpi cor="azul" titulo={`Safra ${ultima} · Produção (t)`} valor={fmtT(porAno.get(ultima)!.producaoT)} />
                  <Kpi
                    cor="verde"
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
                    cor="cinza"
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
              <Painel titulo="Comparativo por safra" semEspaco>
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
              </Painel>

              <Painel
                titulo="TCH por safra (t/ha)"
                semEspaco
                acoes={
                  <span className="flex items-center gap-3 text-[11px] text-muted">
                    <span className="flex items-center gap-1">
                      <span className="h-2 w-2 rounded-sm bg-navy-900" /> Realizado
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="h-2 w-2 rounded-sm bg-amber-500" /> Estimado
                    </span>
                  </span>
                }
              >
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
              </Painel>
            </div>

            <VariedadesSecao anos={anos} variedades={dimensoes.variedade} variedadeCorte={variedadeCorte} />

            <Painel
              titulo={`TCH Realizado (t/ha) por ${dimInfo.label}`}
              semEspaco
              acoes={
                <>
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
                  <BotaoLimparFiltros ativo={algumFiltroAtivo} onLimpar={limparFiltros} />
                  <span className="ml-1.5 text-[12px] text-muted">
                    {pivot.length} {pivot.length === 1 ? "linha" : "linhas"}
                  </span>
                </>
              }
            >
              <div className="overflow-x-auto">
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr className="border-b border-line bg-surface text-left text-muted">
                      <th className="px-4 py-2 font-semibold">{dimInfo.coluna}</th>
                      {dim === "fazenda" && <th className="px-3 py-2 font-semibold">Descrição Fazenda</th>}
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
                        {dim === "fazenda" ? (
                          <>
                            <td className="px-4 py-1.5 font-semibold tabular text-ink">{l.chave.split(" - ")[0] || "—"}</td>
                            <td className="px-3 py-1.5 text-ink">{l.chave.split(" - ").slice(1).join(" - ")}</td>
                          </>
                        ) : (
                          <td className="px-4 py-1.5 font-semibold text-ink">{l.chave || "—"}</td>
                        )}
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
            </Painel>
          </>
        )}
      </CorpoPagina>
    </Pagina>
  );
}

/** Variedades de uma safra: participação na área, produção, TCH e variação; e o
 * TCH de cada variedade por corte. */
function VariedadesSecao({
  anos,
  variedades,
  variedadeCorte,
}: {
  anos: number[];
  variedades: SafraAgregado[];
  variedadeCorte: SafraVariedadeCorte[];
}) {
  const [safra, setSafra] = useState<number>(anos[anos.length - 1]);
  const anoAnterior = useMemo(() => {
    const menores = anos.filter((a) => a < safra);
    return menores.length > 0 ? menores[menores.length - 1] : undefined;
  }, [anos, safra]);

  const linhas = useMemo(() => {
    const doAno = variedades.filter((v) => v.safra === safra);
    const total = doAno.reduce((s, v) => s + v.areaTot, 0);
    const anterior = new Map(variedades.filter((v) => v.safra === anoAnterior).map((v) => [v.chave, v]));
    return doAno
      .map((v) => ({
        ...v,
        pctArea: total > 0 ? (v.areaTot / total) * 100 : 0,
        anterior: anterior.get(v.chave)?.tchReal ?? null,
      }))
      .sort((a, b) => b.areaTot - a.areaTot);
  }, [variedades, safra, anoAnterior]);

  const cortes = useMemo(
    () => Array.from(new Set(variedadeCorte.filter((v) => v.safra === safra).map((v) => v.corte))).sort((a, b) => a - b),
    [variedadeCorte, safra]
  );
  const matriz = useMemo(() => {
    const mapa = new Map<string, Map<number, SafraVariedadeCorte>>();
    for (const v of variedadeCorte.filter((x) => x.safra === safra)) {
      const linha = mapa.get(v.variedade) ?? new Map<number, SafraVariedadeCorte>();
      linha.set(v.corte, v);
      mapa.set(v.variedade, linha);
    }
    return linhas.map((l) => ({ chave: l.chave, linha: mapa.get(l.chave) ?? new Map<number, SafraVariedadeCorte>() }));
  }, [variedadeCorte, safra, linhas]);

  return (
    <Painel
      className="mb-5"
      titulo="Variedades da safra"
      semEspaco
      acoes={
        <>
          <select
            value={safra}
            onChange={(e) => setSafra(Number(e.target.value))}
            aria-label="Safra"
            className={FILTRO}
          >
            {[...anos].reverse().map((a) => (
              <option key={a} value={a}>
                Safra {a}
              </option>
            ))}
          </select>
          <span className="ml-1.5 text-[12px] text-muted">
            {linhas.length} variedade{linhas.length === 1 ? "" : "s"}
          </span>
        </>
      }
    >
      <div className="max-h-[420px] overflow-auto">
        <table className="w-full text-[12.5px]">
          <thead className="sticky top-0 bg-surface">
            <tr className="border-b border-line text-left text-muted">
              <th className="px-4 py-2 font-semibold">Variedade</th>
              <th className="px-3 py-2 text-right font-semibold">Área Total (ha)</th>
              <th className="px-3 py-2 font-semibold">% da Área</th>
              <th className="px-3 py-2 text-right font-semibold">Produção (t)</th>
              <th className="px-3 py-2 text-right font-semibold">TCH Realizado (t/ha)</th>
              <th className="px-3 py-2 text-right font-semibold">TCH Estimado (t/ha)</th>
              {anoAnterior !== undefined && (
                <>
                  <th className="px-3 py-2 text-right font-semibold">TCH {anoAnterior} (t/ha)</th>
                  <th className="px-4 py-2 text-right font-semibold">Variação</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.chave} className="border-b border-line last:border-0">
                <td className="px-4 py-1.5 font-semibold text-ink">{l.chave || "(sem variedade)"}</td>
                <td className="px-3 py-1.5 text-right tabular text-ink">{fmtHa(l.areaTot)}</td>
                <td className="px-3 py-1.5">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-24 overflow-hidden rounded-full bg-surface">
                      <div className="h-full rounded-full bg-navy-900" style={{ width: `${Math.min(100, l.pctArea)}%` }} />
                    </div>
                    <span className="w-12 text-right text-[11.5px] tabular text-muted">
                      {l.pctArea.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%
                    </span>
                  </div>
                </td>
                <td className="px-3 py-1.5 text-right tabular text-ink">{fmtT(l.producaoT)}</td>
                <td className="px-3 py-1.5 text-right font-semibold tabular text-ink">
                  {l.tchReal !== null ? fmtTch(l.tchReal) : "—"}
                </td>
                <td className="px-3 py-1.5 text-right tabular text-muted">
                  {l.tchEst !== null ? fmtTch(l.tchEst) : "—"}
                </td>
                {anoAnterior !== undefined && (
                  <>
                    <td className="px-3 py-1.5 text-right tabular text-muted">
                      {l.anterior !== null ? fmtTch(l.anterior) : "—"}
                    </td>
                    <td className="px-4 py-1.5 text-right tabular">
                      <Variacao valor={variacao(l.tchReal, l.anterior)} />
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {cortes.length > 0 && (
        <>
          <div className="border-y border-line bg-surface px-4 py-2 text-[13px] font-bold text-ink">
            TCH Realizado (t/ha) por Variedade e Corte — safra {safra}
          </div>
          <div className="max-h-[360px] overflow-auto">
            <table className="w-full text-[12.5px]">
              <thead className="sticky top-0 bg-surface">
                <tr className="border-b border-line text-left text-muted">
                  <th className="px-4 py-2 font-semibold">Variedade</th>
                  {cortes.map((c) => (
                    <th key={c} className="px-3 py-2 text-right font-semibold">
                      {c}º Corte
                      <div className="font-normal normal-case text-muted/70">TCH · área (ha)</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matriz.map((m) => (
                  <tr key={m.chave} className="border-b border-line last:border-0">
                    <td className="px-4 py-1.5 font-semibold text-ink">{m.chave || "(sem variedade)"}</td>
                    {cortes.map((c) => {
                      const v = m.linha.get(c);
                      return (
                        <td key={c} className="px-3 py-1.5 text-right tabular text-ink">
                          {v && v.tchReal !== null ? (
                            <>
                              <b>{fmtTch(v.tchReal)}</b>
                              <span className="ml-1.5 text-[11px] text-muted">{fmtHa(v.areaTot)}</span>
                            </>
                          ) : v ? (
                            <span className="text-[11px] text-muted">— {fmtHa(v.areaTot)}</span>
                          ) : (
                            "—"
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Painel>
  );
}

function Kpi({ titulo, valor, extra, cor }: { titulo: string; valor: string; extra?: React.ReactNode; cor: CorIndicador }) {
  return <Indicador cor={cor} rotulo={titulo} valor={valor} apoio={extra || undefined} title={titulo} />;
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
