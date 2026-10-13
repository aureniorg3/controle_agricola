"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import BotaoLimparFiltros from "@/components/BotaoLimparFiltros";
import { IconImportar } from "@/components/icons";
import { BarraFiltros, CabecalhoPagina, Comando, CorpoPagina, EstadoVazio, Indicador, Pagina } from "@/components/pagina";
import { fmtDateBR } from "@/lib/format";
import { ehProducao } from "@/lib/ocupacao";
import { podeEditar } from "@/lib/permissoes";
import { ehTexto, usarPersistido } from "@/lib/usar-persistido";
import { BotaoExportar, FILTRO } from "@/app/(app)/acompanhamentos/os-agricola/comum";

const nf = (n, c = 2) => (n ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: c, maximumFractionDigits: c });
const int = (n) => (n ?? 0).toLocaleString("pt-BR");
const data = (iso) => (iso ? fmtDateBR(iso) : "");
const r3 = (n) => Math.round(n * 1000) / 1000;
const minusculo = (s) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
/** área do talhão: a Área Talhão do relatório; se vier 0, a soma das partes (mesma regra do apontamento) */
const areaDoTalhao = (t) => (t.areaTlh > 0 ? t.areaTlh : t.somaPartes > 0 ? r3(t.somaPartes) : (t.areaTlh ?? 0));
const diverge = (t) => t.partes.length > 1 && t.areaTlh > 0 && Math.abs(t.areaTlh - t.somaPartes) > 0.005;

/** Ocupação escolhida no filtro: "" todas; "producao" área de produção; "fora" as demais; ou o código de uma ocupação. */
function passaOcupacao(filtro, oc) {
  if (!filtro) return true;
  if (filtro === "producao") return ehProducao(oc);
  if (filtro === "fora") return !ehProducao(oc);
  if (filtro === "sem") return !oc;
  return oc?.cod === filtro;
}

export default function FazendasTalhoesClient({ perfil }) {
  const pode = podeEditar(perfil);
  const [opcoes, setOpcoes] = useState(null);
  const [safra, setSafra] = usarPersistido("fazendas-talhoes.safra", "", ehTexto);
  const [busca, setBusca] = usarPersistido("fazendas-talhoes.busca", "", ehTexto);
  const [ocupacao, setOcupacao] = usarPersistido("fazendas-talhoes.ocupacao", "", ehTexto);
  const [variedade, setVariedade] = usarPersistido("fazendas-talhoes.variedade", "", ehTexto);
  const [dados, setDados] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(null);
  const [abertas, setAbertas] = useState(() => new Set());
  const [importar, setImportar] = useState(false);

  const carregarOpcoes = useCallback(async () => {
    try {
      const res = await fetch("/api/talhoes?opcoes=1", { cache: "no-store" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Não foi possível carregar a base.");
      setOpcoes(j);
      return j;
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível carregar a base.");
      setCarregando(false);
      return null;
    }
  }, []);

  useEffect(() => {
    carregarOpcoes();
  }, [carregarOpcoes]);

  // safra lembrada que não está mais na base: vale a mais recente
  const safraAtiva = useMemo(() => {
    if (!opcoes) return null;
    const lista = opcoes.safras.map((s) => String(s.safra));
    return lista.includes(safra) ? safra : (lista[0] ?? null);
  }, [opcoes, safra]);

  useEffect(() => {
    if (!opcoes) return;
    if (!safraAtiva) {
      setDados(null);
      setCarregando(false);
      return;
    }
    let ativo = true;
    setCarregando(true);
    setErro(null);
    fetch(`/api/talhoes?saf=${safraAtiva}`, { cache: "no-store" })
      .then(async (res) => {
        const j = await res.json();
        if (!res.ok) throw new Error(j.error ?? "Não foi possível carregar os talhões.");
        if (ativo) setDados(j);
      })
      .catch((e) => ativo && setErro(e instanceof Error ? e.message : "Não foi possível carregar os talhões."))
      .finally(() => ativo && setCarregando(false));
    return () => {
      ativo = false;
    };
  }, [opcoes, safraAtiva]);

  const ocPorCod = useMemo(() => new Map((opcoes?.ocupacoes ?? []).map((o) => [o.cod, o])), [opcoes]);
  const linhas = useMemo(
    () => (dados ? dados.linhas.map((v) => Object.fromEntries(dados.campos.map((c, i) => [c, v[i]]))) : []),
    [dados],
  );
  const variedades = useMemo(() => Array.from(new Set(linhas.map((l) => l.variedade).filter(Boolean))).sort((a, b) => a.localeCompare(b)), [linhas]);
  // filtro lembrado que não existe nesta safra (ou ocupação excluída do cadastro) não vale — senão a lista some
  const variedadeAtiva = dados && variedade && !variedades.includes(variedade) ? "" : variedade;
  const ocupacaoAtiva = opcoes && ocupacao && !["producao", "fora", "sem"].includes(ocupacao) && !ocPorCod.has(ocupacao) ? "" : ocupacao;

  /** partes que passam nos filtros, agrupadas em fazenda → talhão (o talhão mostra todas as partes dele que passam) */
  const fazendas = useMemo(() => {
    const termo = minusculo(busca.trim());
    const m = new Map();
    for (const l of linhas) {
      const oc = ocPorCod.get(l.ocupacao) ?? null;
      if (!passaOcupacao(ocupacaoAtiva, oc)) continue;
      if (variedadeAtiva && l.variedade !== variedadeAtiva) continue;
      if (termo && !minusculo(`${l.propCod} ${l.propNm} ${l.variedade}`).includes(termo) && termo !== minusculo(`${l.tlh}${l.letra}`)) continue;
      let f = m.get(l.propCod);
      if (!f) {
        f = { propCod: l.propCod, propNm: l.propNm, talhoes: new Map() };
        m.set(l.propCod, f);
      }
      const k = `${l.tlh}${l.letra}`;
      let t = f.talhoes.get(k);
      if (!t) {
        t = { tlh: k, bloco: l.bloco, areaTlh: l.areaTlh ?? 0, somaPartes: 0, partes: [], oc };
        f.talhoes.set(k, t);
      }
      t.somaPartes += l.areaParte ?? 0;
      t.partes.push({ ...l, oc });
    }
    return Array.from(m.values()).map((f) => {
      const talhoes = Array.from(f.talhoes.values());
      return {
        ...f,
        talhoes,
        nPartes: talhoes.reduce((s, t) => s + t.partes.length, 0),
        area: r3(talhoes.reduce((s, t) => s + areaDoTalhao(t), 0)),
        areaProducao: r3(talhoes.filter((t) => ehProducao(t.oc)).reduce((s, t) => s + areaDoTalhao(t), 0)),
        areaPartes: r3(talhoes.reduce((s, t) => s + t.somaPartes, 0)),
      };
    });
  }, [linhas, ocPorCod, ocupacaoAtiva, variedadeAtiva, busca]);

  const totais = useMemo(() => {
    const talhoes = fazendas.flatMap((f) => f.talhoes);
    const area = r3(fazendas.reduce((s, f) => s + f.area, 0));
    const producao = r3(fazendas.reduce((s, f) => s + f.areaProducao, 0));
    return {
      fazendas: fazendas.length,
      talhoes: talhoes.length,
      partes: fazendas.reduce((s, f) => s + f.nPartes, 0),
      area,
      producao,
      fora: r3(area - producao),
      areaPartes: r3(fazendas.reduce((s, f) => s + f.areaPartes, 0)),
      divergentes: talhoes.filter(diverge).length,
    };
  }, [fazendas]);

  const info = opcoes?.safras.find((s) => String(s.safra) === safraAtiva);
  const algumFiltro = !!(busca || ocupacaoAtiva || variedadeAtiva);
  function limparFiltros() {
    setBusca("");
    setOcupacao("");
    setVariedade("");
  }
  const alternar = (cod) =>
    setAbertas((a) => {
      const n = new Set(a);
      if (n.has(cod)) n.delete(cod);
      else n.add(cod);
      return n;
    });
  const todasAbertas = fazendas.length > 0 && fazendas.every((f) => abertas.has(f.propCod));

  const colunasExportar = [
    { rotulo: "Safra", valor: () => Number(safraAtiva) },
    { rotulo: "Fazenda", valor: (l) => l.propCod },
    { rotulo: "Descrição Fazenda", valor: (l) => l.propNm },
    { rotulo: "Bloco", valor: (l) => l.bloco },
    { rotulo: "Talhão", valor: (l) => `${l.tlh}${l.letra}` },
    { rotulo: "Parte", valor: (l) => l.parte },
    { rotulo: "Variedade", valor: (l) => l.variedade },
    { rotulo: "Estágio de Corte", valor: (l) => l.estagio },
    { rotulo: "Ambiente de Produção", valor: (l) => l.ambiente },
    { rotulo: "Plantio", valor: (l) => data(l.plantio) },
    { rotulo: "Último Corte", valor: (l) => data(l.ultCorte) },
    { rotulo: "Área Talhão (ha)", valor: (l) => l.areaTlh },
    { rotulo: "Área Parte (ha)", valor: (l) => l.areaParte },
    { rotulo: "Finalidade", valor: (l) => l.finalidade },
    { rotulo: "Produtiv.", valor: (l) => l.produtividade },
    { rotulo: "Prod. Total", valor: (l) => l.prodTotal },
    { rotulo: "Dist.", valor: (l) => l.dist },
    { rotulo: "Esp.", valor: (l) => l.esp },
    { rotulo: "Tipo Corte", valor: (l) => l.tipoCorte },
    { rotulo: "Ocupação", valor: (l) => l.oc?.descricao ?? "Sem ocupação no cadastro" },
    { rotulo: "Tipo de área", valor: (l) => l.oc?.tipo ?? "" },
  ];

  const vazia = opcoes && opcoes.safras.length === 0;
  return (
    <Pagina>
      <CabecalhoPagina
        titulo="Fazenda e Talhões"
        categoria="Planejamento Agrícola"
        info={
          info && (
            <span className="hidden sm:block">
              Safra {info.safra} · atualizada em {info.atualizadaEm}
              {info.por ? ` por ${info.por}` : ""}
            </span>
          )
        }
        comandos={
          <>
            {pode && (
              <Comando primario icone={<IconImportar size={16} />} onClick={() => setImportar(true)}>
                Importar Relatório de Talhões
              </Comando>
            )}
            {!vazia && (
              <BotaoExportar
                nome={`Fazenda e Talhões ${safraAtiva ?? ""}`.trim()}
                colunas={colunasExportar}
                buscar={async () => fazendas.flatMap((f) => f.talhoes.flatMap((t) => t.partes))}
              />
            )}
          </>
        }
      />
      <CorpoPagina>
        {vazia ? (
          <div className="rounded-xl2 border border-line bg-card shadow-card">
            <EstadoVazio
              titulo="A base Fazenda e Talhões está vazia"
              acao={
                pode && (
                  <Comando primario icone={<IconImportar size={16} />} onClick={() => setImportar(true)}>
                    Importar Relatório de Talhões
                  </Comando>
                )
              }
            >
              Importe o Relatório de Talhões I da safra (.xlsx): cada fazenda com os talhões e as partes, variedade, plantio e áreas. É dessa base que os
              apontamentos tiram a área dos talhões.
            </EstadoVazio>
          </div>
        ) : (
          <>
            <BarraFiltros>
              <label className="flex flex-col gap-1 text-[11.5px] text-muted">
                Safra
                <select value={safraAtiva ?? ""} onChange={(e) => setSafra(e.target.value)} className={FILTRO}>
                  {opcoes?.safras.map((s) => (
                    <option key={s.safra} value={String(s.safra)}>
                      {s.safra}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-[11.5px] text-muted">
                Buscar
                <input
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Fazenda, descrição, variedade ou nº do talhão"
                  className={`${FILTRO} w-[260px]`}
                />
              </label>
              <label className="flex flex-col gap-1 text-[11.5px] text-muted">
                Ocupação
                <select value={ocupacaoAtiva} onChange={(e) => setOcupacao(e.target.value)} className={`${FILTRO} max-w-[260px]`}>
                  <option value="">Todas</option>
                  <option value="producao">Área de produção</option>
                  <option value="fora">Fora da produção</option>
                  <option value="sem">Sem ocupação no cadastro</option>
                  {opcoes?.ocupacoes.map((o) => (
                    <option key={o.cod} value={o.cod}>
                      {o.cod} · {o.descricao}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-[11.5px] text-muted">
                Variedade
                <select value={variedadeAtiva} onChange={(e) => setVariedade(e.target.value)} className={`${FILTRO} max-w-[200px]`}>
                  <option value="">Todas</option>
                  {variedades.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <BotaoLimparFiltros ativo={algumFiltro} onLimpar={limparFiltros} />
            </BarraFiltros>

            {erro && <p className="mb-3 rounded-md border border-alert-500/40 bg-alert-50 px-3 py-2 text-[12.5px] text-alert-700">{erro}</p>}

            <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
              <Indicador rotulo="Fazendas" valor={int(totais.fazendas)} cor="azul" apoio={`${int(totais.talhoes)} talhões · ${int(totais.partes)} partes`} />
              <Indicador
                rotulo="Área dos talhões"
                valor={nf(totais.area)}
                unidade="ha"
                cor="azul"
                apoio={
                  !algumFiltro && info && Math.abs(totais.area - info.areaTalhoes) > 0.005
                    ? `No relatório: ${nf(info.areaTalhoes)} ha; talhões com Área Talhão 0 contam a soma das partes`
                    : "Área Talhão, uma vez por talhão"
                }
              />
              <Indicador
                rotulo="Área de produção"
                valor={nf(totais.producao)}
                unidade="ha"
                cor="verde"
                apoio={totais.area > 0 ? `${Math.round((totais.producao / totais.area) * 100)}% da área dos talhões` : undefined}
              />
              <Indicador rotulo="Fora da produção" valor={nf(totais.fora)} unidade="ha" cor="cinza" apoio="Carreador, APP, pátios e demais ocupações" />
              <Indicador rotulo="Soma das partes" valor={nf(totais.areaPartes)} unidade="ha" cor="cinza" apoio="Área Parte de todas as partes" />
              <Indicador
                rotulo="Partes ≠ área do talhão"
                valor={int(totais.divergentes)}
                cor="laranja"
                apoio="Talhões com várias partes cuja soma não bate"
                title="Nesses talhões a soma da Área Parte é diferente da Área Talhão; o apontamento usa a Área Talhão."
              />
            </div>

            <div className={`overflow-hidden rounded-xl2 border border-line bg-card shadow-card transition-opacity ${carregando ? "opacity-60" : ""}`}>
              <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2 text-[12px] text-muted">
                <span>
                  {int(totais.fazendas)} fazenda(s){algumFiltro ? " no filtro" : ""} · clique na fazenda para ver os talhões e as partes
                </span>
                {fazendas.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setAbertas(todasAbertas ? new Set() : new Set(fazendas.map((f) => f.propCod)))}
                    className="rounded-md px-2 py-1 font-medium text-[#2E5FA8] hover:bg-[#2E5FA8]/[0.06]"
                  >
                    {todasAbertas ? "Recolher todas" : "Expandir todas"}
                  </button>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[12.5px]" data-sem-ordenar>
                  <thead>
                    <tr className="border-b border-line bg-surface text-left text-muted">
                      <th className="w-6 px-2 py-2" />
                      <th className="px-3 py-2 text-right font-medium">Fazenda</th>
                      <th className="min-w-[220px] px-3 py-2 font-medium">Descrição Fazenda</th>
                      <th className="px-3 py-2 text-right font-medium">Talhões</th>
                      <th className="px-3 py-2 text-right font-medium">Partes</th>
                      <th className="px-3 py-2 text-right font-medium">Área talhões (ha)</th>
                      <th className="px-3 py-2 text-right font-medium">Área de produção (ha)</th>
                      <th className="px-3 py-2 text-right font-medium">Soma das partes (ha)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fazendas.map((f) => {
                      const ab = abertas.has(f.propCod);
                      return (
                        <Fragment key={f.propCod}>
                          <tr
                            className={`cursor-pointer border-t border-line/60 hover:bg-surface/60 ${ab ? "bg-[#2E5FA8]/[0.06]" : ""}`}
                            onClick={() => alternar(f.propCod)}
                          >
                            <td className="px-2 py-1.5 text-center text-muted">{ab ? "▾" : "▸"}</td>
                            <td className="px-3 py-1.5 text-right tabular font-medium text-ink">{f.propCod}</td>
                            <td className="px-3 py-1.5 text-ink">{f.propNm}</td>
                            <td className="px-3 py-1.5 text-right tabular text-ink">{int(f.talhoes.length)}</td>
                            <td className="px-3 py-1.5 text-right tabular text-ink">{int(f.nPartes)}</td>
                            <td className="px-3 py-1.5 text-right tabular text-ink">{nf(f.area)}</td>
                            <td className="px-3 py-1.5 text-right tabular text-ink">{nf(f.areaProducao)}</td>
                            <td className="px-3 py-1.5 text-right tabular text-muted">{nf(f.areaPartes)}</td>
                          </tr>
                          {ab && (
                            <tr className="border-t border-line/60 bg-surface/50">
                              <td />
                              <td colSpan={7} className="px-3 py-3">
                                <TalhoesDaFazenda fazenda={f} />
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                    {!carregando && fazendas.length === 0 && (
                      <tr>
                        <td colSpan={8} className="px-4 py-10 text-center text-muted">
                          Nenhum talhão no filtro.
                        </td>
                      </tr>
                    )}
                    {fazendas.length > 0 && (
                      <tr className="bg-navy-900 font-semibold text-white">
                        <td />
                        <td className="px-3 py-2" colSpan={2}>
                          Total
                        </td>
                        <td className="px-3 py-2 text-right tabular">{int(totais.talhoes)}</td>
                        <td className="px-3 py-2 text-right tabular">{int(totais.partes)}</td>
                        <td className="px-3 py-2 text-right tabular">{nf(totais.area)}</td>
                        <td className="px-3 py-2 text-right tabular">{nf(totais.producao)}</td>
                        <td className="px-3 py-2 text-right tabular">{nf(totais.areaPartes)}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            <p className="mt-2 text-[11.5px] leading-relaxed text-muted">
              Base de áreas dos apontamentos: a área do talhão é a Área Talhão do relatório, contada uma vez por talhão (quando ela vem 0, vale a soma das
              partes). A ocupação vem das faixas do cadastro Ocupação (Configurações › Cadastros); área de produção = ocupações do tipo &quot;Área do Local de
              Produção&quot;. Reimportar uma safra substitui a safra inteira.
            </p>
          </>
        )}
      </CorpoPagina>
      {importar && (
        <ImportarTalhoesModal
          onFechar={async (importada) => {
            setImportar(false);
            if (importada) {
              setSafra(String(importada));
              await carregarOpcoes();
            }
          }}
        />
      )}
    </Pagina>
  );
}

/** Talhões e partes de uma fazenda: a primeira parte de cada talhão traz o talhão, a ocupação e a área do talhão. */
function TalhoesDaFazenda({ fazenda }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-card">
      <table className="w-full text-[12px]" data-sem-ordenar>
        <thead>
          <tr className="whitespace-nowrap border-b border-line bg-surface text-left text-muted">
            <th className="px-2.5 py-1.5 text-right font-medium">Talhão</th>
            <th className="px-2.5 py-1.5 text-right font-medium">Bloco</th>
            <th className="px-2.5 py-1.5 font-medium">Ocupação</th>
            <th className="px-2.5 py-1.5 text-right font-medium">Área talhão (ha)</th>
            <th className="px-2.5 py-1.5 text-right font-medium">Parte</th>
            <th className="px-2.5 py-1.5 font-medium">Variedade</th>
            <th className="px-2.5 py-1.5 text-right font-medium">Estágio</th>
            <th className="px-2.5 py-1.5 font-medium">Ambiente</th>
            <th className="px-2.5 py-1.5 font-medium">Plantio</th>
            <th className="px-2.5 py-1.5 font-medium">Último corte</th>
            <th className="px-2.5 py-1.5 text-right font-medium">Área parte (ha)</th>
            <th className="px-2.5 py-1.5 font-medium">Finalidade</th>
            <th className="px-2.5 py-1.5 font-medium">Tipo corte</th>
            <th className="px-2.5 py-1.5 text-right font-medium">Produtiv.</th>
            <th className="px-2.5 py-1.5 text-right font-medium">Dist.</th>
            <th className="px-2.5 py-1.5 text-right font-medium">Esp.</th>
          </tr>
        </thead>
        <tbody>
          {fazenda.talhoes.map((t) =>
            t.partes.map((p, i) => (
              <tr key={`${t.tlh}|${p.parte}`} className={i === 0 ? "border-t border-line" : "border-t border-line/30"}>
                <td className="px-2.5 py-1 text-right tabular font-medium text-ink">{i === 0 ? t.tlh : ""}</td>
                <td className="px-2.5 py-1 text-right tabular text-muted">{i === 0 ? t.bloco : ""}</td>
                <td className="whitespace-nowrap px-2.5 py-1">
                  {i === 0 || p.oc?.cod !== t.oc?.cod ? (
                    !p.oc ? (
                      <span className="text-amber-700">Sem ocupação no cadastro</span>
                    ) : ehProducao(p.oc) ? (
                      <span className="text-muted" title={`${p.oc.descricao} · ${p.oc.tipo}`}>
                        {p.oc.cod}
                      </span>
                    ) : (
                      <span className="text-ink" title={p.oc.tipo}>
                        {p.oc.cod} · {p.oc.descricao}
                      </span>
                    )
                  ) : (
                    ""
                  )}
                </td>
                <td className="px-2.5 py-1 text-right tabular text-ink">
                  {i === 0 && (
                    <span
                      className={diverge(t) ? "font-medium text-[#C76A28]" : ""}
                      title={diverge(t) ? `Soma das partes: ${nf(t.somaPartes)} ha (diferente da área do talhão)` : undefined}
                    >
                      {nf(areaDoTalhao(t))}
                    </span>
                  )}
                </td>
                <td className="px-2.5 py-1 text-right tabular text-ink">{p.parte}</td>
                <td className="px-2.5 py-1 text-ink">{p.variedade}</td>
                <td className="px-2.5 py-1 text-right tabular text-ink">{p.estagio ?? ""}</td>
                <td className="px-2.5 py-1 text-muted">{p.ambiente}</td>
                <td className="whitespace-nowrap px-2.5 py-1 text-ink">{data(p.plantio) || "–"}</td>
                <td className="whitespace-nowrap px-2.5 py-1 text-ink">{data(p.ultCorte) || "–"}</td>
                <td className="px-2.5 py-1 text-right tabular text-ink">{nf(p.areaParte)}</td>
                <td className="px-2.5 py-1 text-ink">{p.finalidade}</td>
                <td className="px-2.5 py-1 text-ink">{p.tipoCorte}</td>
                <td className="px-2.5 py-1 text-right tabular text-muted">{p.produtividade ? nf(p.produtividade) : "–"}</td>
                <td className="px-2.5 py-1 text-right tabular text-muted">{p.dist ?? ""}</td>
                <td className="px-2.5 py-1 text-right tabular text-muted">{p.esp ? nf(p.esp, 1) : "–"}</td>
              </tr>
            )),
          )}
        </tbody>
      </table>
    </div>
  );
}

/** Importação em dois passos: confere o Relatório de Talhões contra a base (prévia) e só substitui a safra depois de confirmar. */
function ImportarTalhoesModal({ onFechar }) {
  const [arquivo, setArquivo] = useState(null);
  const [previa, setPrevia] = useState(null);
  const [feito, setFeito] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState(null);

  async function enviar(aplicar) {
    if (!arquivo) return;
    setEnviando(true);
    setErro(null);
    try {
      const form = new FormData();
      form.append("arquivo", arquivo);
      form.append("aplicar", aplicar ? "1" : "0");
      const res = await fetch("/api/talhoes/importar", { method: "POST", body: form });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "Não foi possível importar.");
      setPrevia(j);
      if (aplicar) setFeito(true);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível importar.");
    } finally {
      setEnviando(false);
    }
  }

  // no meio da conferência/gravação a janela não fecha (a safra seria gravada sem a tela recarregar)
  const fechar = () => {
    if (!enviando) onFechar(feito ? previa?.arquivo.safra : null);
  };
  const nada = previa && previa.base.existe && !previa.base.empAlterada && previa.novos + previa.alterados + previa.retirados === 0;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy-950/50 px-3">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-xl2 bg-card p-5 shadow-pop">
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-[15px] font-semibold text-ink">Importar Relatório de Talhões</h3>
          <button type="button" onClick={fechar} disabled={enviando} aria-label="Fechar" className="px-1 text-[20px] leading-none text-muted disabled:opacity-40">
            ×
          </button>
        </div>
        <p className="mb-4 text-[12.5px] leading-relaxed text-muted">
          Use o Relatório de Talhões I do sistema agrícola (.xlsx), de uma safra. A safra do arquivo substitui a safra inteira na base: talhões novos entram, os
          que mudaram são atualizados e os que não vierem no arquivo saem. As outras safras continuam como estão.
        </p>

        {!previa && (
          <label className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-line bg-surface px-4 py-6 text-center text-[12.5px] text-muted hover:border-brand-600">
            <span className="font-medium text-ink">{arquivo ? arquivo.name : "Escolher o arquivo"}</span>
            <span>{arquivo ? `${(arquivo.size / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} KB` : "Relatório de Talhões I (.xlsx)"}</span>
            <input type="file" accept=".xlsx" className="sr-only" onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} />
          </label>
        )}

        {previa && (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mb-3 text-[12px] text-muted">
              {previa.arquivo.nome} · safra <b className="text-ink">{previa.arquivo.safra}</b>
              {previa.arquivo.emp ? ` · empresa ${previa.arquivo.emp}` : ""} · {int(previa.arquivo.fazendas)} fazendas, {int(previa.arquivo.talhoes)} talhões e{" "}
              {int(previa.arquivo.partes)} partes · {nf(previa.arquivo.areaTalhoes, 3)} ha de talhões ({nf(previa.arquivo.areaPartes, 3)} ha nas partes)
            </div>
            <div className="mb-3 rounded-md border border-line bg-surface px-3 py-2 text-[12px] text-muted">
              {previa.base.existe
                ? `A safra ${previa.arquivo.safra} já está na base (${int(previa.base.talhoes)} talhões, ${nf(previa.base.areaTalhoes, 3)} ha; importada em ${previa.base.atualizadaEm}${previa.base.por ? ` por ${previa.base.por}` : ""}) e será substituída pelo arquivo.`
                : `A safra ${previa.arquivo.safra} ainda não está na base: entra inteira.`}
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Contagem rotulo="Talhões novos" valor={previa.novos} destaque={previa.novos > 0} />
              <Contagem rotulo={feito ? "Atualizados" : "Com alteração"} valor={previa.alterados} destaque={previa.alterados > 0} />
              <Contagem rotulo="Sem alteração" valor={previa.iguais} />
              <Contagem rotulo="Saem da base" valor={previa.retirados} destaque={previa.retirados > 0} />
            </div>

            {previa.exemplos.length > 0 && previa.base.existe && (
              <div className="mt-4">
                <div className="mb-1.5 text-[12.5px] font-medium text-ink">O que muda (até 40 talhões)</div>
                <div className="max-h-48 overflow-y-auto rounded-lg border border-line">
                  <table className="w-full text-[12px]">
                    <tbody>
                      {previa.exemplos.map((x) => (
                        <tr key={x.chave} className="border-t border-line/60 first:border-t-0">
                          <td className="w-28 whitespace-nowrap px-3 py-1.5 tabular font-medium text-ink">{x.chave}</td>
                          <td className="px-3 py-1.5 text-muted">{x.texto}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="mt-4">
              <div className="mb-1.5 text-[12.5px] font-medium text-ink">Área por ocupação</div>
              <div className="overflow-hidden rounded-lg border border-line">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="bg-surface text-left text-muted">
                      <th className="px-3 py-1.5 font-medium">Ocupação</th>
                      <th className="px-3 py-1.5 font-medium">Tipo de área</th>
                      <th className="px-3 py-1.5 text-right font-medium">Talhões</th>
                      <th className="px-3 py-1.5 text-right font-medium">Área (ha)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previa.porOcupacao.map((o) => (
                      <tr key={o.cod || "sem"} className="border-t border-line/60">
                        <td className={`px-3 py-1.5 ${o.cod ? "text-ink" : "text-amber-700"}`}>{o.cod ? `${o.cod} · ${o.descricao}` : o.descricao}</td>
                        <td className="px-3 py-1.5 text-muted">{o.tipo || "–"}</td>
                        <td className="px-3 py-1.5 text-right tabular text-ink">{int(o.talhoes)}</td>
                        <td className="px-3 py-1.5 text-right tabular text-ink">{nf(o.area, 3)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {previa.avisos.length > 0 && (
              <div className="mt-4">
                <div className="mb-1.5 text-[12.5px] font-medium text-ink">Avisos da conferência</div>
                <ul className="list-disc space-y-1 pl-5 text-[12px] text-amber-800">
                  {previa.avisos.map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                </ul>
              </div>
            )}

            {feito && (
              <p className="mt-4 rounded-md border border-good-500/40 bg-good-50 px-3 py-2 text-[12.5px] text-good-700">
                Safra {previa.arquivo.safra} gravada na base Fazenda e Talhões.
              </p>
            )}
            {!feito && nada && (
              <p className="mt-4 rounded-md border border-line bg-surface px-3 py-2 text-[12.5px] text-muted">
                Nada a gravar: a safra na base já está igual ao arquivo.
              </p>
            )}
          </div>
        )}

        {erro && <p className="mt-3 rounded-md border border-alert-500/40 bg-alert-50 px-3 py-2 text-[12.5px] text-alert-700">{erro}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={fechar}
            disabled={enviando}
            className="rounded-lg border border-line px-4 py-1.5 text-[12.5px] text-ink hover:bg-surface disabled:opacity-40"
          >
            {feito ? "Fechar" : "Cancelar"}
          </button>
          {!previa && (
            <button
              type="button"
              disabled={!arquivo || enviando}
              onClick={() => enviar(false)}
              className="rounded-lg bg-navy-900 px-4 py-1.5 text-[12.5px] font-medium text-white hover:bg-navy-800 disabled:opacity-40"
            >
              {enviando ? "Conferindo…" : "Conferir arquivo"}
            </button>
          )}
          {previa && !feito && !nada && (
            <button
              type="button"
              disabled={enviando}
              onClick={() => enviar(true)}
              className="rounded-lg bg-navy-900 px-4 py-1.5 text-[12.5px] font-medium text-white hover:bg-navy-800 disabled:opacity-40"
            >
              {enviando ? "Gravando…" : previa.base.existe ? `Substituir a safra ${previa.arquivo.safra}` : `Gravar a safra ${previa.arquivo.safra}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Contagem({ rotulo, valor, destaque }) {
  return (
    <div className={`rounded-lg border px-3 py-2 ${destaque ? "border-[#2E5FA8]/30 bg-[#2E5FA8]/[0.06]" : "border-line bg-surface"}`}>
      <div className="text-[11.5px] text-muted">{rotulo}</div>
      <div className="tabular text-[19px] font-semibold text-ink">{int(valor)}</div>
    </div>
  );
}
