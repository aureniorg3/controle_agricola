"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { fmtDateBR, fmtT, todayISO } from "@/lib/format";
import { ehTexto, usarPersistido } from "@/lib/usar-persistido";
import { IconImprimir } from "@/components/icons";
import { BarraFiltros, CabecalhoPagina, Comando, CorpoPagina, Pagina } from "@/components/pagina";
import { gerarRelatorioTerceiroPdf } from "@/lib/relatorio-terceiro-pdf";

import BotaoLimparFiltros from "@/components/BotaoLimparFiltros";

const INPUT = "rounded-lg border border-line bg-surface px-3 py-2 text-[13px]";
const ROTULO = "mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted";
const dens = (ton, v) => (v > 0 ? fmtT(ton / v) : "–");

export default function ColheitaTerceiroClient({ nomeUsuario, ultimaData }) {
  const [gerando, setGerando] = useState(false);
  // abre na última pesagem importada: do início do mês dela até ela
  const fimInicial = ultimaData || todayISO();
  const [inicio, setInicio] = useState(`${fimInicial.slice(0, 8)}01`);
  const [fim, setFim] = useState(fimInicial);
  const [frente, setFrente] = usarPersistido("terceiro.frente", "", ehTexto);
  const inicioPadrao = `${fimInicial.slice(0, 8)}01`;
  const algumFiltroAtivo = inicio !== inicioPadrao || fim !== fimInicial || frente !== "";
  function limparFiltros() {
    setInicio(inicioPadrao);
    setFim(fimInicial);
    setFrente("");
  }
  const [opcoesFrente, setOpcoesFrente] = useState([]);
  const [linhas, setLinhas] = useState([]);
  const [totais, setTotais] = useState({ porData: [], porFrente: [], geral: { ton: 0, viagens: 0 } });
  const [semVeiculo, setSemVeiculo] = useState(0);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const res = await fetch(`/api/colheita-terceiro?inicio=${inicio}&fim=${fim}&frente=${encodeURIComponent(frente)}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Não foi possível carregar.");
      setLinhas(json.linhas);
      setOpcoesFrente(json.frentes);
      setSemVeiculo(json.semVeiculo);
      setTotais({ porData: json.porData, porFrente: json.porFrente, geral: json.geral });
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível carregar.");
    } finally {
      setCarregando(false);
    }
  }, [inicio, fim, frente]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  // frente → data → caminhões
  const frentes = useMemo(() => {
    const m = new Map();
    for (const l of linhas) {
      const datas = m.get(l.frente) ?? new Map();
      datas.set(l.data, [...(datas.get(l.data) ?? []), l]);
      m.set(l.frente, datas);
    }
    return Array.from(m.entries());
  }, [linhas]);

  // viagens = controles distintos: os subtotais vêm contados do servidor (somar as linhas não bate)
  const totData = (f, d) => totais.porData.find((t) => t.frente === f && t.data === d) ?? { ton: 0, viagens: 0 };
  const totFrente = (f) => totais.porFrente.find((t) => t.frente === f) ?? { ton: 0, viagens: 0 };
  const geral = totais.geral;
  const th = "px-3 py-2 text-left text-[11.5px] font-semibold uppercase tracking-wide";
  const num = "px-3 py-1.5 text-right tabular-nums";

  return (
    <Pagina translate="no" className="print-scroll">
      {/* o cabeçalho da tela não sai na impressão (como antes) */}
      <div className="flex-shrink-0 print:hidden">
        <CabecalhoPagina
          titulo="Colheita Terceiro — Entrada de cana"
          categoria="Acompanhamentos"
          comandos={
            <Comando
              icone={<IconImprimir size={16} />}
              onClick={async () => {
                setGerando(true);
                try {
                  await gerarRelatorioTerceiroPdf({ inicio, fim, frenteFiltro: frente, linhas, ...totais, nomeUsuario });
                } finally {
                  setGerando(false);
                }
              }}
              disabled={gerando || linhas.length === 0}
            >
              {gerando ? "Gerando…" : "Imprimir / PDF"}
            </Comando>
          }
        />
      </div>

      <CorpoPagina className="print-scroll space-y-4">
        <BarraFiltros className="print:hidden">
          <div>
            <label className={ROTULO}>De</label>
            <input type="date" value={inicio} onChange={(e) => e.target.value && setInicio(e.target.value)} className={INPUT} />
          </div>
          <div>
            <label className={ROTULO}>Até</label>
            <input type="date" value={fim} onChange={(e) => e.target.value && setFim(e.target.value)} className={INPUT} />
          </div>
          <div>
            <label className={ROTULO}>Frente</label>
            <select value={frente} onChange={(e) => setFrente(e.target.value)} className={`${INPUT} min-w-[170px]`}>
              <option value="">Todas</option>
              {frente && !opcoesFrente.includes(frente) && <option value={frente}>{frente}</option>}
              {opcoesFrente.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </div>
          <BotaoLimparFiltros ativo={algumFiltroAtivo} onLimpar={limparFiltros} />
        </BarraFiltros>

        {erro && <p className="rounded-md border border-alert-500/40 bg-alert-50 px-3 py-2 text-[13px] text-alert-700">{erro}</p>}
        {!carregando && linhas.length === 0 && !erro && (
          <p className="rounded-md border border-line bg-card px-3 py-3 text-[13px] text-muted">
            Nenhuma entrada no período para a frente escolhida.
            {semVeiculo > 0 &&
              ` Há ${semVeiculo} viagens importadas antes desta tela (sem veículo/frente): reimporte a pesagem do período em Ordens de Corte para que apareçam.`}
          </p>
        )}

        {linhas.length > 0 && (
          <div className="overflow-x-auto rounded-md border border-line">
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
                  const totF = totFrente(frente);
                  return (
                    <Fragment key={frente}>
                      <tr className="linha-subtotal">
                        <td className="px-3 py-1.5">{frente || "—"}</td>
                        <td className={num}>{fmtT(totF.ton)}</td>
                        <td className={num}>{totF.viagens}</td>
                        <td className={num}>{dens(totF.ton, totF.viagens)}</td>
                      </tr>
                      {Array.from(datas.entries()).map(([data, ls]) => {
                        const t = totData(frente, data);
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
          Viagens = controles de pesagem do dia; densidade = toneladas ÷ controles. Viagens com tara zerada não contam. Frente conforme a ordem de corte da
          viagem.
        </p>
      </CorpoPagina>
    </Pagina>
  );
}
