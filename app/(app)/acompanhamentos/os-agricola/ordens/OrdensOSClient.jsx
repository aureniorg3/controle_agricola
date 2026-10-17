"use client";

import { Fragment, useEffect, useState } from "react";
import { BarraFiltros, CabecalhoPagina, CorpoPagina, Pagina } from "@/components/pagina";
import { fmtDateBR } from "@/lib/format";

import { nomePosicao, PRAZO_DIAS, textoDose } from "@/lib/os-agr";
import { podeEditar } from "@/lib/permissoes";

import { ehBooleano, ehTexto, usarPersistido } from "@/lib/usar-persistido";
import { nf } from "@/app/(app)/painel/blocos";
import { BarraFiltrosOS, BotaoExportar, BotaoImportarOS, FILTRO, SeloPosicao, paramsDosFiltros, usarFiltrosOS, usarOpcoesOS } from "../comum";

const int = (n) => n.toLocaleString("pt-BR");
const data = (iso) => (iso ? fmtDateBR(iso) : "");
const brl = (n) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const nf3 = (n) => n.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 3 });
const pctTexto = (p) => (p === null || p === undefined ? "–" : `${Math.round(p)}%`);
/** Como o encerramento foi identificado. */
const ORIGEM_ENC = {
  erp: "data que veio do ERP (relatório em planilha)",
  leitura: "data em que a importação do relatório identificou a O.S. encerrada",
};

/**
 * Barra da área prevista × realizada (apontada) da O.S.: verde até 100%; acima da área prevista, vermelha. Sem área
 * prevista, só o traço.
 */
function BarraRealizado({ prevista, apontado }) {
  const pct = prevista > 0 ? (apontado / prevista) * 100 : null;
  const cor = pct !== null && pct > 100.5 ? "bg-[#BE3132]" : "bg-[#5D9E48]";
  return (
    <div
      className="flex items-center gap-2"
      title={pct === null ? "Sem área prevista" : `${nf(apontado)} de ${nf(prevista)} ha apontados (${pctTexto(pct)})`}
    >
      <div className="h-1.5 w-20 flex-shrink-0 overflow-hidden rounded-full bg-line/80" aria-hidden="true">
        <div className={`h-full rounded-full ${cor}`} style={{ width: `${Math.min(100, Math.max(0, pct ?? 0))}%` }} />
      </div>
      <span className={`w-9 text-right tabular text-[11.5px] ${pct !== null && pct > 100.5 ? "font-medium text-[#BE3132]" : "text-muted"}`}>
        {pctTexto(pct)}
      </span>
    </div>
  );
}

export default function OrdensOSClient({ perfil }) {
  const [f, setF] = usarFiltrosOS();
  const [faixa, setFaixa] = usarPersistido("os-agr.ordens.faixa", "", ehTexto);
  const [atrasadas, setAtrasadas] = usarPersistido("os-agr.ordens.atrasadas", false, ehBooleano);
  const [busca, setBusca] = usarPersistido("os-agr.ordens.busca", "", ehTexto);
  const [termo, setTermo] = useState(busca);
  const [pagina, setPagina] = useState(1);
  const [versao, setVersao] = useState(0);
  const opcoes = usarOpcoesOS(versao);
  const [ordens, setOrdens] = useState([]);
  const [totais, setTotais] = useState(null);
  const [tamanho, setTamanho] = useState(100);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(null);
  const [aberta, setAberta] = useState(null);

  // vindo do Dashboard (clique numa faixa de dias): só as em aberto daquela faixa
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const fx = p.get("faixa");
    if (fx) {
      setFaixa(fx);
      setF((x) => ({ ...x, posicao: "aberto" }));
      window.history.replaceState(null, "", window.location.pathname);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setTermo(busca), 350);
    return () => clearTimeout(t);
  }, [busca]);

  const params = () => {
    const p = paramsDosFiltros(f);
    if (faixa) p.set("faixa", faixa);
    if (atrasadas) p.set("atrasadas", "1");
    if (termo.trim()) p.set("q", termo.trim());
    return p;
  };
  const chaveFiltro = JSON.stringify([f, faixa, atrasadas, termo]);
  useEffect(() => setPagina(1), [chaveFiltro]);

  useEffect(() => {
    let ativo = true;
    setCarregando(true);
    const p = params();
    p.set("pg", String(pagina));
    fetch(`/api/os-agricola?${p}`, { cache: "no-store" })
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (!ativo) return;
        if (!ok) return setErro(j.error ?? "Não foi possível carregar as O.S.");
        setErro(null);
        setOrdens(j.ordens);
        setTotais(j.totais);
        setTamanho(j.tamanho);
      })
      .catch(() => ativo && setErro("Não foi possível carregar as O.S."))
      .finally(() => ativo && setCarregando(false));
    return () => {
      ativo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chaveFiltro, pagina, versao]);

  async function todas() {
    const p = params();
    p.set("todos", "1");
    const res = await fetch(`/api/os-agricola?${p}`, { cache: "no-store" });
    const j = await res.json();
    if (!res.ok) throw new Error(j.error ?? "Não foi possível exportar.");
    return j.ordens;
  }

  const totalPaginas = Math.max(1, Math.ceil((totais?.ordens ?? 0) / tamanho));

  return (
    <Pagina>
      <CabecalhoPagina
        titulo="Ordens de Serviço"
        categoria="Ordem de Serviço Agr."
        comandos={
          <>
            {podeEditar(perfil) && <BotaoImportarOS onImportado={() => setVersao((v) => v + 1)} />}
            <BotaoExportar
              nome="Ordens de Servico"
              buscar={todas}
              colunas={[
                { rotulo: "O.S.", valor: (o) => Number(o.os) || o.os },
                { rotulo: "Data da O.S.", valor: (o) => data(o.dtOs) },
                { rotulo: `Prazo (data da O.S. + ${PRAZO_DIAS} dias)`, valor: (o) => data(o.prevFim) },
                { rotulo: "Encerramento", valor: (o) => data(o.dtEnc) },
                { rotulo: "Encerramento identificado por", valor: (o) => (o.dtEnc ? (o.encOrig === "leitura" ? "Leitura do relatório" : "ERP") : "") },
                { rotulo: "Posição", valor: (o) => nomePosicao(o.posicao) },
                { rotulo: "Dias", valor: (o) => o.dias },
                { rotulo: "Faixa de dias", valor: (o) => o.faixa },
                { rotulo: "Prazo vencido", valor: (o) => (o.atrasada ? "Sim" : "") },
                { rotulo: "Operação", valor: (o) => o.operacoes.map((x) => `${x.cod} - ${x.ds}`).join(" | ") },
                { rotulo: "Etapa", valor: (o) => `${o.etapaCod} - ${o.etapaDs}` },
                { rotulo: "Solicitante", valor: (o) => o.respNm },
                { rotulo: "Fazenda", valor: (o) => o.fazendas.map((x) => x.split(" · ")[0]).join(" | ") },
                { rotulo: "Descrição Fazenda", valor: (o) => o.fazendas.map((x) => x.split(" · ").slice(1).join(" · ")).join(" | ") },
                { rotulo: "Talhões", valor: (o) => o.nTlh },
                { rotulo: "Área plantada (ha)", valor: (o) => o.areaPlant },
                { rotulo: "Área prevista (ha)", valor: (o) => o.areaRec },
                { rotulo: "Área apontada (ha)", valor: (o) => o.apontado },
                { rotulo: "% realizado", valor: (o) => (o.pctApontado === null ? "" : o.pctApontado) },
                { rotulo: "Insumos", valor: (o) => o.nInsumos },
                { rotulo: "Valor estimado dos insumos (R$)", valor: (o) => o.valorInsumos ?? "" },
                { rotulo: "Safra", valor: (o) => o.safra },
                { rotulo: "Lançada por", valor: (o) => o.usrOs },
                { rotulo: "Observação", valor: (o) => o.obs },
              ]}
            />
          </>
        }
        info={
          opcoes?.ultimaImportacao && (
            <span>
              Base atualizada em {opcoes.ultimaImportacao}
              {opcoes.ultimoRelatorio ? ` · relatório de ${opcoes.ultimoRelatorio}` : ""}
            </span>
          )
        }
      />

      <CorpoPagina>
        <BarraFiltros>
          <BarraFiltrosOS
            f={f}
            setF={setF}
            opcoes={opcoes}
            extraAtivo={!!(faixa || atrasadas || busca)}
            limparExtra={() => {
              setFaixa("");
              setAtrasadas(false);
              setBusca("");
              setTermo("");
            }}
            extra={
              <>
                <label className="flex flex-col gap-1 text-[11.5px] text-muted">
                  Faixa de dias (em aberto)
                  <select value={faixa} onChange={(e) => setFaixa(e.target.value)} className={FILTRO}>
                    <option value="">Todas</option>
                    {opcoes?.faixas.map((x) => (
                      <option key={x.descricao} value={x.descricao}>
                        {x.descricao}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-[11.5px] text-muted">
                  Buscar
                  <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="O.S., fazenda, operação…" className={`${FILTRO} w-[200px]`} />
                </label>
                <label className="flex items-center gap-1.5 pb-1.5 text-[12.5px] text-ink">
                  <input type="checkbox" checked={atrasadas} onChange={(e) => setAtrasadas(e.target.checked)} />
                  Só prazo vencido
                </label>
              </>
            }
          />
        </BarraFiltros>

        {totais && (
          <div className="mb-3 flex flex-wrap gap-x-6 gap-y-1 text-[12.5px] text-muted">
            <span>
              <b className="tabular font-semibold text-ink">{int(totais.ordens)}</b> O.S.
            </span>
            <span>
              <b className="tabular font-semibold text-ink">{int(totais.abertas)}</b> em aberto
            </span>
            <span>
              <b className="tabular font-semibold text-[#BE3132]">{int(totais.atrasadas)}</b> com prazo vencido
            </span>
            <span>
              <b className="tabular font-semibold text-ink">{int(totais.talhoes)}</b> talhões
            </span>
            <span>
              <b className="tabular font-semibold text-ink">{nf(totais.apontado ?? 0)}</b> de <b className="tabular font-semibold text-ink">{nf(totais.areaRec)}</b>{" "}
              ha previstos apontados
            </span>
            {totais.valorInsumos > 0 && (
              <span title="Quantidade requisitada × custo médio do Saldo Insumos">
                <b className="tabular font-semibold text-ink">{brl(totais.valorInsumos)}</b> em insumos (estimado)
              </span>
            )}
          </div>
        )}

        {erro && <p className="mb-3 rounded-md border border-alert-500/40 bg-alert-50 px-3 py-2 text-[12.5px] text-alert-700">{erro}</p>}

        <div className={`overflow-hidden rounded-xl2 border border-line bg-card shadow-card transition-opacity ${carregando ? "opacity-60" : ""}`}>
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-line bg-surface text-left text-muted">
                  <th className="w-6 px-2 py-2" />
                  <th className="px-3 py-2 text-right font-medium">O.S.</th>
                  <th className="px-3 py-2 font-medium">Data</th>
                  <th className="px-3 py-2 font-medium">Posição</th>
                  <th className="px-3 py-2 text-right font-medium">Dias</th>
                  <th className="px-3 py-2 font-medium" title={`Data da O.S. + ${PRAZO_DIAS} dias`}>
                    Prazo
                  </th>
                  <th className="px-3 py-2 font-medium">Encerramento</th>
                  <th className="min-w-[220px] px-3 py-2 font-medium">Operação</th>
                  <th className="px-3 py-2 font-medium">Etapa</th>
                  <th className="px-3 py-2 font-medium">Solicitante</th>
                  <th className="px-3 py-2 font-medium">Fazenda</th>
                  <th className="min-w-[180px] px-3 py-2 font-medium">Descrição Fazenda</th>
                  <th className="px-3 py-2 text-right font-medium">Talhões</th>
                  <th className="px-3 py-2 text-right font-medium">Área prevista (ha)</th>
                  <th className="px-3 py-2 text-right font-medium">Área apontada (ha)</th>
                  <th className="px-3 py-2 font-medium">Prevista × realizada</th>
                  <th className="px-3 py-2 text-right font-medium" title="Quantidade requisitada × custo médio do Saldo Insumos">
                    Insumos (R$)
                  </th>
                  <th className="px-3 py-2 font-medium">Lançada por</th>
                </tr>
              </thead>
              <tbody>
                {ordens.map((o) => {
                  const k = `${o.emp}|${o.os}`;
                  const ab = aberta === k;
                  return (
                    <Fragment key={k}>
                      <tr
                        data-linha={k}
                        className={`cursor-pointer border-t border-line/60 hover:bg-surface/60 ${ab ? "bg-[#2E5FA8]/[0.06]" : ""}`}
                        onClick={() => setAberta(ab ? null : k)}
                      >
                        <td className="px-2 py-1.5 text-center text-muted">{ab ? "▾" : "▸"}</td>
                        <td className="px-3 py-1.5 text-right tabular font-medium text-ink">{o.os}</td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-ink">{data(o.dtOs)}</td>
                        <td className="px-3 py-1.5">
                          <SeloPosicao p={o.posicao} />
                        </td>
                        <td className="px-3 py-1.5 text-right tabular text-ink" title={o.faixa || undefined}>
                          {o.dias ?? "–"}
                        </td>
                        <td className={`whitespace-nowrap px-3 py-1.5 ${o.atrasada ? "font-medium text-[#BE3132]" : "text-ink"}`}>{data(o.prevFim)}</td>
                        <td
                          className="whitespace-nowrap px-3 py-1.5 text-ink"
                          title={o.dtEnc ? ORIGEM_ENC[o.encOrig] : o.posicao === "E" ? "Já veio encerrada na 1ª leitura: data não conhecida" : undefined}
                        >
                          {data(o.dtEnc) || "–"}
                        </td>
                        <td className="px-3 py-1.5 text-ink">
                          {o.operacoes[0] && (
                            <>
                              <span className="tabular text-muted">{o.operacoes[0].cod} · </span>
                              {o.operacoes[0].ds}
                            </>
                          )}
                          {o.operacoes.length > 1 && <span className="ml-1 text-[11px] text-muted">+{o.operacoes.length - 1}</span>}
                        </td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-ink">{o.etapaDs}</td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-ink">{o.respNm || "–"}</td>
                        <td className="px-3 py-1.5 tabular text-ink">
                          {o.fazendas[0]?.split(" · ")[0]}
                          {o.fazendas.length > 1 && <span className="ml-1 text-[11px] text-muted">+{o.fazendas.length - 1}</span>}
                        </td>
                        <td className="px-3 py-1.5 text-ink">{o.fazendas[0]?.split(" · ").slice(1).join(" · ")}</td>
                        <td className="px-3 py-1.5 text-right tabular text-ink">{o.nTlh}</td>
                        <td className="px-3 py-1.5 text-right tabular text-ink">{nf(o.areaRec)}</td>
                        <td className={`px-3 py-1.5 text-right tabular ${o.apontado > 0 ? "text-ink" : "text-muted"}`}>{o.apontado > 0 ? nf(o.apontado) : "–"}</td>
                        <td className="px-3 py-1.5">
                          <BarraRealizado prevista={o.areaRec} apontado={o.apontado} />
                        </td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-right tabular text-ink" title={o.nInsumos ? `${o.nInsumos} insumo(s)` : undefined}>
                          {o.valorInsumos ? brl(o.valorInsumos) : o.nInsumos ? "s/ custo" : "–"}
                        </td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-muted">{o.usrOs}</td>
                      </tr>
                      {ab && (
                        // acompanha a linha da O.S. quando a tabela é ordenada pelo título de uma coluna (OrdenarTabelas)
                        <tr data-detalhe-de={k} className="border-t border-line/60 bg-surface/50">
                          <td />
                          <td colSpan={17} className="px-3 py-3">
                            <DetalheOS emp={o.emp} os={o.os} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
                {!carregando && ordens.length === 0 && (
                  <tr>
                    <td colSpan={18} className="px-4 py-10 text-center text-muted">
                      {opcoes?.ordens === 0
                        ? 'A base de O.S. está vazia. Use "Importar O.S." com o relatório OS - Ordem de Serviço (PDF) do ERP.'
                        : "Nenhuma O.S. no filtro."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t border-line bg-surface px-4 py-2 text-[12.5px] text-muted">
            <span>{carregando ? "Carregando…" : `Página ${pagina} de ${totalPaginas}`}</span>
            <span className="flex gap-1.5">
              <button
                type="button"
                disabled={pagina <= 1 || carregando}
                onClick={() => setPagina((p) => p - 1)}
                className="rounded-md border border-line bg-card px-2.5 py-1 font-medium text-navy-800 disabled:opacity-40"
              >
                Anterior
              </button>
              <button
                type="button"
                disabled={pagina >= totalPaginas || carregando}
                onClick={() => setPagina((p) => p + 1)}
                className="rounded-md border border-line bg-card px-2.5 py-1 font-medium text-navy-800 disabled:opacity-40"
              >
                Próxima
              </button>
            </span>
          </div>
        </div>
        <p className="mt-3 text-[11.5px] text-muted">
          Dias: O.S. em aberto, desde a data da O.S. até hoje; encerrada, da data da O.S. ao encerramento (a data em que a importação identificou a O.S.
          encerrada; as que vieram do ERP mantêm a data dele). Prazo = data da O.S. + {PRAZO_DIAS} dias; em vermelho, vencido com a O.S. ainda em aberto.
          Área apontada: os apontamentos (tela, Lançamento Mobile e bot do WhatsApp) nos talhões e nas operações da O.S.; a barra compara com a área
          prevista. Insumos (R$): quantidade requisitada × custo médio do Saldo Insumos (estimado; serviços sem custo ficam de fora). Com operação ou
          fazenda no filtro, cada O.S. traz só as operações e as fazendas escolhidas. Clique numa O.S. para ver a observação, os insumos e os talhões.
        </p>
      </CorpoPagina>
    </Pagina>
  );
}

function DetalheOS({ emp, os }) {
  const [d, setD] = useState(null);
  useEffect(() => {
    fetch(`/api/os-agricola?detalhe=1&emp=${encodeURIComponent(emp)}&os=${encodeURIComponent(os)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setD(j.talhoes ? j : { talhoes: [], insumos: [], cab: null }))
      .catch(() => setD({ talhoes: [], insumos: [], cab: null }));
  }, [emp, os]);
  if (!d) return <span className="text-[12px] text-muted">Carregando a O.S.…</span>;
  const p = d.talhoes[0];
  const c = d.cab;
  const insumos = d.insumos.filter((i) => !i.servico);
  const servicos = d.insumos.filter((i) => i.servico);
  const valor = insumos.reduce((a, i) => a + (i.valor ?? 0), 0);
  return (
    <div className="space-y-3">
      {p && (
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-muted">
          <span>Centro de custo: {p.ccCod ? `${p.ccCod} · ${p.ccDs}` : "–"}</span>
          <span>
            Prazo: {data(p.prevFim)} (data da O.S. + {PRAZO_DIAS} dias)
            {p.prevFimErp ? ` · previsão antiga do ERP: ${data(p.prevFimErp)}` : ""}
          </span>
          <span title={c?.dtEnc ? ORIGEM_ENC[c.encOrig] : undefined}>
            Encerramento: {c?.dtEnc ? `${data(c.dtEnc)} (${c.encOrig === "leitura" ? "identificado na importação" : "do ERP"})` : p.posicao === "E" ? "data não conhecida" : "–"}
          </span>
          {c?.prdrNm && (
            <span>
              Produtor: {c.prdrCod ? `${c.prdrCod} · ` : ""}
              {c.prdrNm}
            </span>
          )}
          {c?.vazao ? <span>Vazão: {nf3(c.vazao)} L/ha</span> : null}
          {c?.volCalda ? <span>Volume de calda: {nf(c.volCalda)} L</span> : null}
          {c?.relEm && <span>Relatório lido de {data(c.relEm)}</span>}
        </div>
      )}
      {c?.obs && (
        <div className="max-w-4xl rounded-lg border border-line bg-card px-3 py-2">
          <div className="mb-0.5 text-[11.5px] font-medium text-muted">Observação da O.S.</div>
          <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-ink">{c.obs}</p>
        </div>
      )}
      {d.insumos.length > 0 && (
        <div className="max-w-5xl overflow-x-auto rounded-lg border border-line bg-card">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="whitespace-nowrap border-b border-line text-left text-muted">
                <th className="px-3 py-1.5 font-medium">Operação</th>
                <th className="px-3 py-1.5 font-medium">Insumo</th>
                <th className="px-3 py-1.5 text-right font-medium">Dose recomendada</th>
                <th className="px-3 py-1.5 text-right font-medium">Área (ha)</th>
                <th className="px-3 py-1.5 text-right font-medium" title="Dose × área da operação na O.S.">
                  Qtde prevista
                </th>
                <th className="px-3 py-1.5 text-right font-medium">Qtde requisitada</th>
                <th className="px-3 py-1.5 text-right font-medium" title="Custo médio do Saldo Insumos">
                  Custo médio
                </th>
                <th className="px-3 py-1.5 text-right font-medium">Valor (R$)</th>
                <th className="px-3 py-1.5 font-medium">Almoxarifado</th>
              </tr>
            </thead>
            <tbody>
              {[...insumos, ...servicos].map((i) => (
                <tr key={`${i.opCod}|${i.prodCod}|${i.almox}`} className="border-t border-line/60">
                  <td className="px-3 py-1 text-ink">
                    <span className="tabular text-muted">{i.opCod}</span>
                    {i.opDs ? ` · ${i.opDs}` : ""}
                  </td>
                  <td className="px-3 py-1 text-ink">
                    <span className="tabular text-muted">{i.prodCod} · </span>
                    {i.ds}
                    {i.servico && <span className="ml-1.5 rounded-full border border-line px-1.5 text-[10.5px] text-muted">serviço</span>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1 text-right tabular font-medium text-ink">{textoDose(i)}</td>
                  <td className="px-3 py-1 text-right tabular text-ink">{i.area ? nf(i.area) : "–"}</td>
                  <td className="whitespace-nowrap px-3 py-1 text-right tabular text-ink">{i.prevista === null ? "–" : `${nf3(i.prevista)} ${i.un}`}</td>
                  <td className="whitespace-nowrap px-3 py-1 text-right tabular text-ink">{i.qtd === null ? "–" : `${nf3(i.qtd)} ${i.un}`}</td>
                  <td className="whitespace-nowrap px-3 py-1 text-right tabular text-muted" title={i.precoData ? `Saldo Insumos de ${data(i.precoData)}` : undefined}>
                    {i.preco === null ? "–" : brl(i.preco)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1 text-right tabular text-ink">{i.valor === null ? "–" : brl(i.valor)}</td>
                  <td className="px-3 py-1 text-muted">{i.almox ? `${i.almox} · ${i.almoxNm}` : i.almoxNm || "–"}</td>
                </tr>
              ))}
              {valor > 0 && (
                <tr className="border-t border-line bg-surface font-semibold text-ink">
                  <td colSpan={7} className="px-3 py-1.5">
                    Total estimado dos insumos
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right tabular">{brl(valor)}</td>
                  <td />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      <table className="w-full max-w-5xl rounded-lg border border-line bg-card text-[12px]">
        <thead>
          <tr className="border-b border-line text-left text-muted">
            <th className="px-3 py-1.5 font-medium">Operação</th>
            <th className="px-3 py-1.5 font-medium">Fazenda</th>
            <th className="px-3 py-1.5 font-medium">Descrição Fazenda</th>
            <th className="px-3 py-1.5 text-center font-medium">Talhão</th>
            <th className="px-3 py-1.5 font-medium">Variedade</th>
            <th className="px-3 py-1.5 text-right font-medium">Área plantada (ha)</th>
            <th className="px-3 py-1.5 text-right font-medium">Área prevista (ha)</th>
            <th className="px-3 py-1.5 text-right font-medium">Área apontada (ha)</th>
          </tr>
        </thead>
        <tbody>
          {d.talhoes.map((l) => {
            const prevista = l.areaRec ?? l.areaPlant ?? 0;
            const acima = prevista > 0 && l.apontado > prevista + 0.01;
            return (
              <tr key={`${l.opCod}|${l.propCod}|${l.setor}|${l.tlh}|${l.letra}`} className="border-t border-line/60">
                <td className="px-3 py-1 text-ink">
                  <span className="tabular text-muted">{l.opCod} · </span>
                  {l.opDs}
                </td>
                <td className="px-3 py-1 tabular text-ink">{l.propCod}</td>
                <td className="px-3 py-1 text-ink">{l.propNm}</td>
                <td className="px-3 py-1 text-center text-ink">
                  {l.tlh}
                  {l.letra}
                </td>
                <td className="px-3 py-1 text-ink">{l.varied || "–"}</td>
                <td className="px-3 py-1 text-right tabular text-ink">{l.areaPlant === null ? "–" : nf(l.areaPlant)}</td>
                <td className="px-3 py-1 text-right tabular text-ink">{l.areaRec === null ? "–" : nf(l.areaRec)}</td>
                <td className={`px-3 py-1 text-right tabular ${acima ? "font-medium text-[#BE3132]" : l.apontado > 0 ? "text-ink" : "text-muted"}`}>
                  {l.apontado > 0 ? nf(l.apontado) : "–"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
