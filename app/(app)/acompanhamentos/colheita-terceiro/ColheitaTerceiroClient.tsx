"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { fmtDateBR, fmtT, todayISO } from "@/lib/format";
import { ehDataIso, usarPersistido } from "@/lib/usar-persistido";
import type { LinhaTerceiro } from "@/lib/db";

const INPUT = "rounded-lg border border-line bg-surface px-3 py-2 text-[13px]";
const ROTULO = "mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted";
const dens = (ton: number, v: number) => (v > 0 ? fmtT(ton / v) : "–");

export default function ColheitaTerceiroClient() {
  const hoje = todayISO();
  const [inicio, setInicio] = usarPersistido("terceiro.inicio", `${hoje.slice(0, 8)}01`, ehDataIso);
  const [fim, setFim] = usarPersistido("terceiro.fim", hoje, ehDataIso);
  const [linhas, setLinhas] = useState<LinhaTerceiro[]>([]);
  const [semVeiculo, setSemVeiculo] = useState(0);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const res = await fetch(`/api/colheita-terceiro?inicio=${inicio}&fim=${fim}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Não foi possível carregar.");
      setLinhas(json.linhas);
      setSemVeiculo(json.semVeiculo);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível carregar.");
    } finally {
      setCarregando(false);
    }
  }, [inicio, fim]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  // frente → data → caminhões
  const frentes = useMemo(() => {
    const m = new Map<string, Map<string, LinhaTerceiro[]>>();
    for (const l of linhas) {
      const datas = m.get(l.frente) ?? new Map<string, LinhaTerceiro[]>();
      datas.set(l.data, [...(datas.get(l.data) ?? []), l]);
      m.set(l.frente, datas);
    }
    return Array.from(m.entries());
  }, [linhas]);

  const soma = (ls: LinhaTerceiro[]) => ({ ton: ls.reduce((a, l) => a + l.ton, 0), viagens: ls.reduce((a, l) => a + l.viagens, 0) });
  const geral = soma(linhas);
  const th = "px-3 py-2 text-left text-[11.5px] font-semibold uppercase tracking-wide";
  const num = "px-3 py-1.5 text-right tabular-nums";

  return (
    <div className="space-y-4" translate="no">
      <header className="flex flex-wrap items-end justify-between gap-3 print:hidden">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">Acompanhamentos</p>
          <h1 className="text-[22px] font-bold text-navy-900">Colheita Terceiro — Entrada de cana</h1>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className={ROTULO}>De</label>
            <input type="date" value={inicio} onChange={(e) => e.target.value && setInicio(e.target.value)} className={INPUT} />
          </div>
          <div>
            <label className={ROTULO}>Até</label>
            <input type="date" value={fim} onChange={(e) => e.target.value && setFim(e.target.value)} className={INPUT} />
          </div>
          <button
            type="button"
            onClick={() => window.print()}
            className="rounded-lg border border-line bg-surface px-3.5 py-2 text-[13px] font-semibold text-navy-800 hover:bg-card"
          >
            Imprimir
          </button>
        </div>
      </header>

      {erro && <p className="rounded-md border border-alert-500/40 bg-alert-50 px-3 py-2 text-[13px] text-alert-700">{erro}</p>}
      {!carregando && linhas.length === 0 && !erro && (
        <p className="rounded-md border border-line bg-card px-3 py-3 text-[13px] text-muted">
          Nenhuma entrada de terceiros no período.
          {semVeiculo > 0 &&
            ` Há ${semVeiculo} viagens importadas antes desta tela (sem veículo/frente): reimporte a pesagem do período em Ordens de Corte para que apareçam.`}
        </p>
      )}

      {linhas.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-line">
          <p className="hidden px-3 pt-3 text-[13px] font-semibold print:block">
            Entrada de Cana — Terceiro · {fmtDateBR(inicio)} a {fmtDateBR(fim)}
          </p>
          <table className="w-full min-w-[560px] text-[13px]">
            <thead className="bg-navy-900 text-white">
              <tr>
                <th className={th}>Frente / Data / Caminhão</th>
                <th className={`${th} text-right`}>TON (t)</th>
                <th className={`${th} text-right`}>Viagens</th>
                <th className={`${th} text-right`}>Densidade (t/viagem)</th>
              </tr>
            </thead>
            <tbody>
              {frentes.map(([frente, datas]) => {
                const totF = soma(Array.from(datas.values()).flat());
                return (
                  <Fragment key={frente}>
                    <tr className="bg-navy-900/10 font-semibold">
                      <td className="px-3 py-1.5">{frente || "—"}</td>
                      <td className={num}>{fmtT(totF.ton)}</td>
                      <td className={num}>{totF.viagens}</td>
                      <td className={num}>{dens(totF.ton, totF.viagens)}</td>
                    </tr>
                    {Array.from(datas.entries()).map(([data, ls]) => {
                      const t = soma(ls);
                      return (
                        <Fragment key={data}>
                          <tr className="bg-card font-semibold">
                            <td className="px-3 py-1.5 pl-6">{fmtDateBR(data)}</td>
                            <td className={num}>{fmtT(t.ton)}</td>
                            <td className={num}>{t.viagens}</td>
                            <td className={num}>{dens(t.ton, t.viagens)}</td>
                          </tr>
                          {ls.map((l) => (
                            <tr key={l.veiculo} className="border-t border-line/60">
                              <td className="px-3 py-1 pl-10">{l.veiculo || "—"}</td>
                              <td className={num}>{fmtT(l.ton)}</td>
                              <td className={num}>{l.viagens}</td>
                              <td className={num}>{dens(l.ton, l.viagens)}</td>
                            </tr>
                          ))}
                        </Fragment>
                      );
                    })}
                  </Fragment>
                );
              })}
              <tr className="bg-navy-900 font-semibold text-white">
                <td className="px-3 py-2">Total geral</td>
                <td className={num}>{fmtT(geral.ton)}</td>
                <td className={num}>{geral.viagens}</td>
                <td className={num}>{dens(geral.ton, geral.viagens)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[11.5px] text-muted print:hidden">
        Densidade = toneladas ÷ viagens. Viagens com tara zerada não contam. Somente frentes “TERCEIRO – …” da pesagem importada.
      </p>
    </div>
  );
}
