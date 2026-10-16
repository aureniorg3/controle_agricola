"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import BotaoLimparFiltros from "@/components/BotaoLimparFiltros";
import { IconImportar } from "@/components/icons";
import { JanelaInfo } from "@/components/janela";
import { Abas, BarraFiltros, CabecalhoPagina, Comando, CorpoPagina, EstadoVazio, Indicador, Pagina } from "@/components/pagina";
import { fmtDateBR } from "@/lib/format";
import { podeAcessar } from "@/lib/menu";
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
/**
 * talhão com várias partes cuja soma não bate com a Área Talhão — sempre com todas as partes do talhão (`inteiro`), com
 * ou sem filtro: o filtro escolhe os talhões, mas não faz parecer divergente o talhão que entrou só com algumas partes
 */
const diverge = (t) => t.inteiro.partes.length > 1 && t.areaTlh > 0 && Math.abs(t.areaTlh - t.inteiro.somaPartes) > 0.005;
/**
 * Partes do mesmo talhão (de todas as partes dele, `inteiro`) com a mesma data de plantio, variedade, estágio de corte
 * e espaçamento: podem virar uma parte só no ERP (sistema agrícola). Parte sem variedade e sem plantio (carreador, APP…)
 * não entra. Devolve os grupos de 2 ou mais partes, na ordem da 1ª parte de cada um.
 */
function partesIguais(partes) {
  const grupos = new Map();
  for (const p of partes) {
    if (!String(p.variedade ?? "").trim() && !p.plantio) continue;
    const k = [p.plantio ?? "", String(p.variedade ?? "").trim().toUpperCase(), p.estagio ?? "", p.esp ?? ""].join("|");
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(p);
  }
  return [...grupos.values()].filter((g) => g.length > 1);
}
/** diferença em ha com sinal (+1,25 / -0,40); zero sem sinal */
const nfSinal = (n) => (Math.abs(n) > 0.005 ? `${n > 0 ? "+" : ""}${nf(n)}` : nf(0));
const qtd = (n, um, varios) => `${int(n)} ${n === 1 ? um : varios}`;
const DESTAQUE = "font-medium text-[#C76A28]";

/** Verificações da base Fazenda e Talhões na tela Validações (já com o módulo escolhido no filtro). */
const VALIDACOES = "/configuracoes/validacoes";
const VALIDACOES_FAZENDAS = `${VALIDACOES}?modulo=${encodeURIComponent("Fazenda e Talhões")}`;

/** Ocupação escolhida no filtro: "" todas; "producao" área de produção; "fora" as demais; ou o código de uma ocupação. */
function passaOcupacao(filtro, oc) {
  if (!filtro) return true;
  if (filtro === "producao") return ehProducao(oc);
  if (filtro === "fora") return !ehProducao(oc);
  if (filtro === "sem") return !oc;
  return oc?.cod === filtro;
}

/**
 * `acessos` (telas liberadas do usuário, opcional): sem ele não dá para saber no navegador se a tela Validações está
 * liberada, e o link para ela aparece sempre (podeAcessar com acessos nulo libera as telas que não são de administrador).
 */
export default function FazendasTalhoesClient({ perfil, acessos = null }) {
  const pode = podeEditar(perfil);
  const veValidacoes = podeAcessar(VALIDACOES, perfil, acessos);
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
  /** janela (detalhe) do card aberta: fazendas, area, producao, fora, partes, divergentes */
  const [janela, setJanela] = useState(null);

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

  /** cada talhão com todas as partes, sem filtro (fazenda|talhão): a divergência das partes é do talhão inteiro */
  const talhoesInteiros = useMemo(() => {
    const m = new Map();
    for (const l of linhas) {
      const k = `${l.propCod}|${l.tlh}${l.letra}`;
      let t = m.get(k);
      if (!t) {
        t = { somaPartes: 0, partes: [] };
        m.set(k, t);
      }
      t.somaPartes += l.areaParte ?? 0;
      t.partes.push(l);
    }
    return m;
  }, [linhas]);

  // a busca igual ao código de uma fazenda (o clique na fazenda das janelas põe o código nela) mostra só aquela fazenda;
  // como trecho de texto, "9001" traria também as partes da variedade CTC9001 das outras fazendas
  const termoBusca = minusculo(busca.trim());
  const buscaFazenda = useMemo(
    () => (termoBusca ? (linhas.find((l) => minusculo(l.propCod) === termoBusca)?.propCod ?? null) : null),
    [linhas, termoBusca],
  );

  /** partes que passam nos filtros, agrupadas em fazenda → talhão (o talhão mostra todas as partes dele que passam) */
  const fazendas = useMemo(() => {
    const m = new Map();
    for (const l of linhas) {
      const oc = ocPorCod.get(l.ocupacao) ?? null;
      if (!passaOcupacao(ocupacaoAtiva, oc)) continue;
      if (variedadeAtiva && l.variedade !== variedadeAtiva) continue;
      if (buscaFazenda) {
        if (l.propCod !== buscaFazenda) continue;
      } else if (
        termoBusca &&
        !minusculo(`${l.propCod} ${l.propNm} ${l.variedade}`).includes(termoBusca) &&
        termoBusca !== minusculo(`${l.tlh}${l.letra}`)
      )
        continue;
      let f = m.get(l.propCod);
      if (!f) {
        f = { propCod: l.propCod, propNm: l.propNm, talhoes: new Map() };
        m.set(l.propCod, f);
      }
      const k = `${l.tlh}${l.letra}`;
      let t = f.talhoes.get(k);
      if (!t) {
        t = { tlh: k, bloco: l.bloco, areaTlh: l.areaTlh ?? 0, somaPartes: 0, partes: [], oc, inteiro: talhoesInteiros.get(`${l.propCod}|${k}`) };
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
  }, [linhas, talhoesInteiros, ocPorCod, ocupacaoAtiva, variedadeAtiva, termoBusca, buscaFazenda]);

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
      // talhões com partes iguais (podem ser agrupadas no ERP) e quantos grupos
      agrupar: talhoes.filter((t) => partesIguais(t.inteiro.partes).length > 0).length,
      gruposAgrupar: talhoes.reduce((n, t) => n + partesIguais(t.inteiro.partes).length, 0),
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

  // subtítulo das janelas dos cards: a safra e os filtros que formaram os números
  const filtrosAtivos = [
    busca.trim() && (buscaFazenda ? `fazenda ${buscaFazenda}` : `busca “${busca.trim()}”`),
    ocupacaoAtiva &&
      `ocupação ${
        { producao: "Área de produção", fora: "Fora da produção", sem: "Sem ocupação no cadastro" }[ocupacaoAtiva] ??
        `${ocupacaoAtiva} · ${ocPorCod.get(ocupacaoAtiva)?.descricao ?? ""}`
      }`,
    variedadeAtiva && `variedade ${variedadeAtiva}`,
  ].filter(Boolean);
  const baseJanela = {
    safra: safraAtiva ?? "",
    subtitulo: `Safra ${safraAtiva ?? "–"} · ${filtrosAtivos.length ? `filtro: ${filtrosAtivos.join(" · ")}` : "sem filtro"}`,
    veValidacoes,
    onFechar: () => setJanela(null),
    // clique numa fazenda dentro da janela: a página passa a mostrar só ela (busca = código exato, ver buscaFazenda), já aberta
    onFazenda: (cod) => {
      setBusca(String(cod));
      setAbertas((a) => new Set(a).add(cod));
      setJanela(null);
    },
  };
  const cards = [
    { k: "fazendas", rotulo: "Fazendas", valor: int(totais.fazendas), cor: "azul", apoio: `${int(totais.talhoes)} talhões · ${int(totais.partes)} partes` },
    {
      k: "area",
      rotulo: "Área dos talhões",
      valor: nf(totais.area),
      unidade: "ha",
      cor: "azul",
      apoio:
        !algumFiltro && info && Math.abs(totais.area - info.areaTalhoes) > 0.005
          ? `No relatório: ${nf(info.areaTalhoes)} ha; talhões com Área Talhão 0 contam a soma das partes`
          : "Área Talhão, uma vez por talhão",
    },
    {
      k: "producao",
      rotulo: "Área de produção",
      valor: nf(totais.producao),
      unidade: "ha",
      cor: "verde",
      apoio: totais.area > 0 ? `${Math.round((totais.producao / totais.area) * 100)}% da área dos talhões` : undefined,
    },
    { k: "fora", rotulo: "Fora da produção", valor: nf(totais.fora), unidade: "ha", cor: "cinza", apoio: "Carreador, APP, pátios e demais ocupações" },
    { k: "partes", rotulo: "Soma das partes", valor: nf(totais.areaPartes), unidade: "ha", cor: "cinza", apoio: "Área Parte de todas as partes" },
    {
      k: "divergentes",
      rotulo: "Partes ≠ área do talhão",
      valor: int(totais.divergentes),
      cor: "laranja",
      apoio: "Talhões com várias partes cuja soma não bate",
      title: "Ver o detalhe · nesses talhões a soma da Área Parte é diferente da Área Talhão; o apontamento usa a Área Talhão.",
    },
    {
      k: "agrupar",
      rotulo: "Partes para agrupar",
      valor: int(totais.agrupar),
      cor: totais.agrupar > 0 ? "laranja" : "cinza",
      apoio: "Talhões com partes iguais: plantio, variedade, estágio e espaçamento",
      title: "Ver o detalhe · essas partes têm os mesmos dados e podem ser agrupadas numa parte só no ERP.",
    },
  ];

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
                  title="O código exato de uma fazenda mostra só ela"
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

            {/* cada card abre a janela com o detalhe dos mesmos números (mesmos filtros) */}
            <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
              {cards.map((c) => (
                <button
                  key={c.k}
                  type="button"
                  onClick={() => setJanela(c.k)}
                  className="min-w-0 rounded-xl2 text-left transition hover:-translate-y-px focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-500"
                  title={c.title ?? "Ver o detalhe"}
                >
                  <Indicador rotulo={c.rotulo} valor={c.valor} unidade={c.unidade} cor={c.cor} apoio={c.apoio} className="h-full" />
                </button>
              ))}
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
      {janela === "fazendas" && <JanelaFazendas fazendas={fazendas} totais={totais} base={baseJanela} />}
      {janela === "area" && <JanelaAreaTalhoes fazendas={fazendas} totais={totais} info={algumFiltro ? null : info} base={baseJanela} />}
      {janela === "producao" && <JanelaProducao fazendas={fazendas} totais={totais} base={baseJanela} />}
      {janela === "fora" && <JanelaForaProducao fazendas={fazendas} totais={totais} base={baseJanela} />}
      {janela === "partes" && <JanelaSomaPartes fazendas={fazendas} totais={totais} base={baseJanela} />}
      {janela === "divergentes" && <JanelaDivergentes fazendas={fazendas} totais={totais} algumFiltro={algumFiltro} base={baseJanela} />}
      {janela === "agrupar" && <JanelaAgrupar fazendas={fazendas} totais={totais} algumFiltro={algumFiltro} base={baseJanela} />}
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

/* ---------- Janelas dos cards: o detalhe calculado das mesmas fazendas filtradas que formam o card ---------- */

/** Valor na tela: área em ha (2 casas), contagem, percentual (1 casa), código ou texto. */
function formatar(num, v) {
  if (num === "int") return int(v);
  if (num === "pct") return v === null || v === undefined ? "–" : `${nf(v, 1)}%`;
  if (num === "ha") return nf(v);
  return v ?? "";
}
const pct = (v, total) => (total > 0 ? Math.round((v / total) * 1000) / 10 : null);
/** linha de fazenda ou de talhão ({ f, t }): a fazenda dela */
const faz = (l) => l.f ?? l;
const ordemPorArea = (a, b) => b.area - a.area;

function BotaoFazenda({ f, onFazenda }) {
  return (
    <button
      type="button"
      onClick={() => onFazenda(f.propCod)}
      className="text-left text-[#2E5FA8] hover:underline"
      title={`Mostrar na página só a fazenda ${f.propCod}`}
    >
      {f.propNm || f.propCod}
    </button>
  );
}
const colCodigo = { rotulo: "Código", num: "cod", valor: (l) => faz(l).propCod, classe: () => "font-medium text-ink" };
const colFazenda = (onFazenda) => ({ rotulo: "Fazenda", valor: (l) => faz(l).propNm, exibir: (l) => <BotaoFazenda f={faz(l)} onFazenda={onFazenda} /> });

/**
 * Tabela das janelas: cabeçalho, números à direita e linha de total (fica no fim ao ordenar pelo título da coluna).
 * Coluna: { rotulo, valor(l) (o que vai para a planilha), num ("ha", "int", "pct", "cod" = à direita), exibir(l) (o
 * que aparece, se diferente do valor), classe(l), dica(l), total, soPlanilha (só na exportação) }.
 */
function TabelaJanela({ colunas, linhas, chave, vazio = "Nenhum talhão no filtro." }) {
  const vis = colunas.filter((c) => !c.soPlanilha);
  const inicioTotal = vis.findIndex((c) => c.total !== undefined);
  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="whitespace-nowrap border-b border-line bg-surface text-left text-muted">
            {vis.map((c) => (
              <th key={c.rotulo} className={`px-3 py-2 font-medium ${c.num ? "text-right" : ""}`}>
                {c.rotulo}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => (
            <tr key={chave(l)} className="border-t border-line/60 hover:bg-surface/60">
              {vis.map((c) => (
                <td key={c.rotulo} className={`px-3 py-1.5 ${c.num ? "text-right tabular" : ""} ${c.classe?.(l) ?? "text-ink"}`} title={c.dica?.(l)}>
                  {c.exibir ? c.exibir(l) : formatar(c.num, c.valor(l))}
                </td>
              ))}
            </tr>
          ))}
          {linhas.length === 0 && (
            <tr>
              <td colSpan={vis.length} className="px-4 py-8 text-center text-muted">
                {vazio}
              </td>
            </tr>
          )}
          {linhas.length > 0 && inicioTotal > 0 && (
            <tr className="bg-navy-900 font-semibold text-white">
              <td colSpan={inicioTotal} className="px-3 py-2">
                Total
              </td>
              {vis.slice(inicioTotal).map((c) => (
                <td key={c.rotulo} className={`px-3 py-2 ${c.num ? "text-right tabular" : ""}`}>
                  {c.total === undefined ? "" : c.exibirTotal ? c.exibirTotal(c.total) : formatar(c.num, c.total)}
                </td>
              ))}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function Nota({ children, aviso = false }) {
  return (
    <p
      className={`mb-3 text-[12px] leading-relaxed ${aviso ? "rounded-md border border-amber-500/40 bg-amber-50 px-3 py-2 text-amber-800" : "text-muted"}`}
    >
      {children}
    </p>
  );
}

function Secao({ titulo, acoes, children }) {
  return (
    <div className="mt-5">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="text-[12.5px] font-medium text-ink">{titulo}</div>
        {acoes}
      </div>
      {children}
    </div>
  );
}

/** Botão de exportar uma tabela da janela (só o rótulo e o valor de cada coluna); sem linhas, nada. */
const exportarTabela = (safra, { nome, colunas, linhas }) =>
  linhas.length > 0 && (
    <BotaoExportar
      nome={`Fazenda e Talhões ${safra} - ${nome}`}
      colunas={colunas.map(({ rotulo, valor }) => ({ rotulo, valor }))}
      buscar={async () => linhas}
    />
  );

/**
 * Moldura das janelas: safra e filtros no subtítulo, exportar a tabela principal no topo e, nas que mostram
 * inconsistências da base, o link para a tela Validações (módulo Fazenda e Talhões) no rodapé.
 */
function JanelaCard({ titulo, base, exportar, inconsistencias = false, largura = "5xl", children }) {
  return (
    <JanelaInfo
      titulo={titulo}
      subtitulo={base.subtitulo}
      largura={largura}
      onFechar={base.onFechar}
      acoes={exportar && exportarTabela(base.safra, exportar)}
      rodape={
        inconsistencias && base.veValidacoes ? (
          <>
            <span className="mr-auto text-[11.5px] text-muted">Validações confere a base inteira, sem os filtros desta tela.</span>
            <Link href={VALIDACOES_FAZENDAS} className="rounded-md px-2 py-1 text-[12.5px] font-medium text-[#2E5FA8] hover:bg-[#2E5FA8]/[0.06]">
              Ver as inconsistências em Validações
            </Link>
          </>
        ) : undefined
      }
    >
      {children}
    </JanelaInfo>
  );
}

/** Card Fazendas: uma linha por fazenda com talhões, partes e as áreas dos outros cards. */
function JanelaFazendas({ fazendas, totais, base }) {
  const colunas = [
    colCodigo,
    colFazenda(base.onFazenda),
    { rotulo: "Talhões", num: "int", valor: (f) => f.talhoes.length, total: totais.talhoes },
    { rotulo: "Partes", num: "int", valor: (f) => f.nPartes, total: totais.partes },
    { rotulo: "Área dos talhões (ha)", num: "ha", valor: (f) => f.area, total: totais.area },
    { rotulo: "Área de produção (ha)", num: "ha", valor: (f) => f.areaProducao, total: totais.producao },
    { rotulo: "Fora da produção (ha)", num: "ha", valor: (f) => r3(f.area - f.areaProducao), total: totais.fora },
    { rotulo: "Soma das partes (ha)", num: "ha", valor: (f) => f.areaPartes, total: totais.areaPartes, classe: () => "text-muted" },
  ];
  return (
    <JanelaCard titulo="Fazendas" base={base} largura="6xl" exportar={{ nome: "Fazendas", colunas, linhas: fazendas }}>
      <Nota>
        {qtd(totais.fazendas, "fazenda", "fazendas")} com {qtd(totais.talhoes, "talhão", "talhões")} e {qtd(totais.partes, "parte", "partes")}. Clique no
        nome da fazenda para ver só ela na página.
      </Nota>
      <TabelaJanela colunas={colunas} linhas={fazendas} chave={(f) => f.propCod} />
    </JanelaCard>
  );
}

/** Card Área dos talhões: a área por fazenda e os talhões com Área Talhão 0 (que contam a soma das partes). */
function JanelaAreaTalhoes({ fazendas, totais, info, base }) {
  const porFazenda = useMemo(() => [...fazendas].sort(ordemPorArea), [fazendas]);
  const zerados = useMemo(
    () => fazendas.flatMap((f) => f.talhoes.filter((t) => !(t.areaTlh > 0)).map((t) => ({ f, t, area: areaDoTalhao(t) }))),
    [fazendas],
  );
  const somaZerados = r3(zerados.reduce((s, z) => s + z.area, 0));
  // sem filtro, a área daqui x a do relatório importado (que soma só a Área Talhão)
  const difRelatorio = info ? r3(totais.area - info.areaTalhoes) : 0;
  const colunas = [
    colCodigo,
    colFazenda(base.onFazenda),
    { rotulo: "Talhões", num: "int", valor: (f) => f.talhoes.length, total: totais.talhoes },
    { rotulo: "Área dos talhões (ha)", num: "ha", valor: (f) => f.area, total: totais.area },
    { rotulo: "% do total", num: "pct", valor: (f) => pct(f.area, totais.area), total: totais.area > 0 ? 100 : null, classe: () => "text-muted" },
  ];
  const colunasZerados = [
    colCodigo,
    colFazenda(base.onFazenda),
    { rotulo: "Talhão", num: "cod", valor: (z) => z.t.tlh, classe: () => "font-medium text-ink" },
    { rotulo: "Bloco", num: "cod", valor: (z) => z.t.bloco, classe: () => "text-muted" },
    { rotulo: "Partes", num: "int", valor: (z) => z.t.partes.length, total: zerados.reduce((s, z) => s + z.t.partes.length, 0) },
    { rotulo: "Área considerada = soma das partes (ha)", num: "ha", valor: (z) => z.area, total: somaZerados },
  ];
  return (
    <JanelaCard
      titulo="Área dos talhões"
      base={base}
      inconsistencias
      exportar={{ nome: "Área dos talhões por fazenda", colunas, linhas: porFazenda }}
    >
      <Nota>
        Cada talhão conta uma vez, com a Área Talhão do relatório; quando ela vem 0, vale a soma das partes (a mesma regra dos apontamentos).
      </Nota>
      {Math.abs(difRelatorio) > 0.005 && (
        <Nota aviso>
          O relatório importado soma {nf(info.areaTalhoes)} ha de Área Talhão; aqui são {nf(totais.area)} ha ({nfSinal(difRelatorio)} ha) porque os talhões
          com Área Talhão 0 contam a soma das partes ({qtd(zerados.length, "talhão", "talhões")}, {nf(somaZerados)} ha, na lista abaixo).
        </Nota>
      )}
      <TabelaJanela colunas={colunas} linhas={porFazenda} chave={(f) => f.propCod} />
      <Secao
        titulo={`Talhões com Área Talhão 0 (contam a soma das partes) · ${int(zerados.length)}`}
        acoes={exportarTabela(base.safra, { nome: "Talhões com Área Talhão 0", colunas: colunasZerados, linhas: zerados })}
      >
        <TabelaJanela
          colunas={colunasZerados}
          linhas={zerados}
          chave={(z) => `${z.f.propCod}|${z.t.tlh}`}
          vazio="Nenhum talhão com Área Talhão 0 no filtro."
        />
      </Secao>
    </JanelaCard>
  );
}

const ABAS_PRODUCAO = [
  { id: "ocupacao", label: "Por ocupação", nome: "ocupação" },
  { id: "variedade", label: "Por variedade", nome: "variedade" },
  { id: "estagio", label: "Por estágio de corte", nome: "estágio de corte" },
];

/**
 * Card Área de produção: por ocupação de produção (talhão inteiro, pela ocupação do talhão), por variedade e por
 * estágio de corte. Talhão com partes diferentes divide a área entre elas na proporção da Área Parte, para o total
 * bater com o card.
 */
function JanelaProducao({ fazendas, totais, base }) {
  const [aba, setAba] = useState("ocupacao");
  const quebras = useMemo(() => {
    const m = { ocupacao: new Map(), variedade: new Map(), estagio: new Map() };
    const somar = (mapa, chave, novo, area, talhoes, partes) => {
      const x = mapa.get(chave) ?? { chave, ...novo, talhoes: 0, partes: 0, area: 0 };
      x.area += area;
      x.talhoes += talhoes;
      x.partes += partes;
      mapa.set(chave, x);
    };
    for (const f of fazendas)
      for (const t of f.talhoes) {
        if (!ehProducao(t.oc)) continue;
        const area = areaDoTalhao(t);
        somar(m.ocupacao, t.oc.cod, { rotulo: `${t.oc.cod} · ${t.oc.descricao}` }, area, 1, t.partes.length);
        for (const p of t.partes) {
          const fatia = t.somaPartes > 0 ? (area * (p.areaParte ?? 0)) / t.somaPartes : area / t.partes.length;
          somar(m.variedade, p.variedade || "", { rotulo: p.variedade || "Sem variedade" }, fatia, 0, 1);
          const e = p.estagio ?? "";
          somar(m.estagio, String(e), { rotulo: e === "" ? "Sem estágio" : String(e), ordem: e === "" ? Infinity : Number(e) }, fatia, 0, 1);
        }
      }
    const lista = (mapa) => Array.from(mapa.values()).map((x) => ({ ...x, area: r3(x.area) }));
    return {
      ocupacao: lista(m.ocupacao).sort(ordemPorArea),
      variedade: lista(m.variedade).sort((a, b) => (!a.chave) - (!b.chave) || ordemPorArea(a, b)),
      estagio: lista(m.estagio).sort((a, b) => a.ordem - b.ordem),
    };
  }, [fazendas]);
  const nProducao = quebras.ocupacao.reduce((s, x) => s + x.talhoes, 0);
  const pProducao = quebras.ocupacao.reduce((s, x) => s + x.partes, 0);
  const atual = ABAS_PRODUCAO.find((a) => a.id === aba);
  const colArea = { rotulo: "Área (ha)", num: "ha", valor: (x) => x.area, total: totais.producao };
  const colPct = {
    rotulo: "% da produção",
    num: "pct",
    valor: (x) => pct(x.area, totais.producao),
    total: totais.producao > 0 ? 100 : null,
    classe: () => "text-muted",
  };
  const semValor = (x) => (!x.chave ? "text-amber-700" : "text-ink");
  const colunas = {
    ocupacao: [
      { rotulo: "Ocupação", valor: (x) => x.rotulo },
      { rotulo: "Talhões", num: "int", valor: (x) => x.talhoes, total: nProducao },
      { rotulo: "Partes", num: "int", valor: (x) => x.partes, total: pProducao },
      colArea,
      colPct,
    ],
    variedade: [
      { rotulo: "Variedade", valor: (x) => x.rotulo, classe: semValor },
      { rotulo: "Partes", num: "int", valor: (x) => x.partes, total: pProducao },
      colArea,
      colPct,
    ],
    estagio: [
      { rotulo: "Estágio de Corte", num: "cod", valor: (x) => (x.chave ? Number(x.chave) : x.rotulo), classe: semValor },
      { rotulo: "Partes", num: "int", valor: (x) => x.partes, total: pProducao },
      colArea,
      colPct,
    ],
  }[aba];
  return (
    <JanelaCard
      titulo="Área de produção"
      base={base}
      largura="4xl"
      exportar={{ nome: `Área de produção por ${atual.nome}`, colunas, linhas: quebras[aba] }}
    >
      <Nota>
        Talhões cuja ocupação é do tipo &quot;Área do Local de Produção&quot; no cadastro Ocupação: {qtd(nProducao, "talhão", "talhões")},{" "}
        {nf(totais.producao)} ha
        {totais.area > 0 ? ` (${nf(pct(totais.producao, totais.area), 1)}% da área dos talhões)` : ""}.
      </Nota>
      <Abas itens={ABAS_PRODUCAO} ativo={aba} onChange={setAba} className="mb-3" />
      <TabelaJanela colunas={colunas} linhas={quebras[aba]} chave={(x) => x.chave || "sem"} vazio="Nenhum talhão de produção no filtro." />
      {aba !== "ocupacao" && (
        <p className="mt-2 text-[11.5px] leading-relaxed text-muted">
          Talhão com partes de {aba === "variedade" ? "variedades" : "estágios"} diferentes: a área do talhão é dividida entre as partes na proporção da
          Área Parte, para o total bater com a área de produção.
        </p>
      )}
    </JanelaCard>
  );
}

/** Card Fora da produção: área por ocupação (as sem ocupação no cadastro à parte) e a lista dos talhões. */
function JanelaForaProducao({ fazendas, totais, base }) {
  const { porOcupacao, talhoes } = useMemo(() => {
    const m = new Map();
    const talhoes = [];
    for (const f of fazendas)
      for (const t of f.talhoes) {
        if (ehProducao(t.oc)) continue;
        const area = areaDoTalhao(t);
        const k = t.oc?.cod ?? "";
        const x = m.get(k) ?? { chave: k, oc: t.oc, talhoes: 0, area: 0 };
        x.talhoes += 1;
        x.area += area;
        m.set(k, x);
        talhoes.push({ f, t, area });
      }
    const porOcupacao = Array.from(m.values())
      .map((x) => ({ ...x, area: r3(x.area) }))
      .sort((a, b) => (!a.oc) - (!b.oc) || ordemPorArea(a, b));
    return { porOcupacao, talhoes };
  }, [fazendas]);
  const sem = porOcupacao.find((x) => !x.oc);
  const descOc = (oc) => (oc ? `${oc.cod} · ${oc.descricao}` : "Sem ocupação no cadastro");
  const semOc = (x) => (!(x.oc ?? x.t?.oc) ? "text-amber-700" : "text-ink");
  const colunasOc = [
    { rotulo: "Ocupação", valor: (x) => descOc(x.oc), classe: semOc },
    { rotulo: "Tipo de área", valor: (x) => x.oc?.tipo || "–", classe: () => "text-muted" },
    { rotulo: "Talhões", num: "int", valor: (x) => x.talhoes, total: talhoes.length },
    { rotulo: "Área (ha)", num: "ha", valor: (x) => x.area, total: totais.fora },
  ];
  const colunasTalhoes = [
    colCodigo,
    colFazenda(base.onFazenda),
    { rotulo: "Talhão", num: "cod", valor: (z) => z.t.tlh, classe: () => "font-medium text-ink" },
    { rotulo: "Bloco", num: "cod", valor: (z) => z.t.bloco, classe: () => "text-muted" },
    { rotulo: "Ocupação", valor: (z) => descOc(z.t.oc), classe: semOc, dica: (z) => z.t.oc?.tipo },
    { rotulo: "Tipo de área", valor: (z) => z.t.oc?.tipo ?? "", soPlanilha: true },
    { rotulo: "Área (ha)", num: "ha", valor: (z) => z.area, total: totais.fora },
  ];
  return (
    <JanelaCard
      titulo="Fora da produção"
      base={base}
      inconsistencias
      exportar={{ nome: "Fora da produção - talhões", colunas: colunasTalhoes, linhas: talhoes }}
    >
      <Nota>
        Talhões cuja ocupação não é do tipo &quot;Área do Local de Produção&quot; (carreador, APP, pátios e demais), contados pela área do talhão.
      </Nota>
      {sem && (
        <Nota aviso>
          {qtd(sem.talhoes, "talhão", "talhões")} ({nf(sem.area)} ha) sem ocupação no cadastro: o nº do talhão (ou da parte) não cai em nenhuma faixa do
          cadastro Ocupação (Configurações › Cadastros) e a área fica fora da produção.
        </Nota>
      )}
      <TabelaJanela colunas={colunasOc} linhas={porOcupacao} chave={(x) => x.chave || "sem"} vazio="Nenhum talhão fora da produção no filtro." />
      <Secao titulo={`Talhões fora da produção · ${int(talhoes.length)}`}>
        <TabelaJanela
          colunas={colunasTalhoes}
          linhas={talhoes}
          chave={(z) => `${z.f.propCod}|${z.t.tlh}`}
          vazio="Nenhum talhão fora da produção no filtro."
        />
      </Secao>
    </JanelaCard>
  );
}

/** área de cada parte, para a dica e a planilha (1: 10,50 · 2: 3,20) */
const areasDasPartes = (partes) => partes.map((p) => `${p.parte}: ${nf(p.areaParte)}`).join(" · ");
/**
 * por que a soma das partes do talhão (as do filtro) não bate com a área dele: "varias" (talhão de várias partes, o do
 * card Partes ≠ área do talhão), "uma" (parte única com a Área Parte diferente da Área Talhão, fora daquele card) ou
 * "filtro" (passaram só algumas partes: a Área Talhão conta inteira; a soma, só das partes que passam)
 */
const motivoDif = (t) => (t.partes.length < t.inteiro.partes.length ? "filtro" : t.inteiro.partes.length > 1 ? "varias" : "uma");

/**
 * Card Soma das partes: por fazenda, a área dos talhões, a soma das partes e a diferença (as com diferença primeiro), e
 * os talhões que formam a diferença, com qualquer nº de partes (os de uma parte só não entram no card Partes ≠).
 */
function JanelaSomaPartes({ fazendas, totais, base }) {
  const linhas = useMemo(
    () =>
      fazendas
        .map((f, i) => ({ ...f, i, dif: r3(f.areaPartes - f.area) }))
        .sort((a, b) => Math.abs(b.dif) - Math.abs(a.dif) || a.i - b.i),
    [fazendas],
  );
  const talhoes = useMemo(
    () =>
      fazendas
        .flatMap((f) =>
          f.talhoes.map((t) => {
            const area = areaDoTalhao(t);
            return { f, t, area, dif: r3(t.somaPartes - area), motivo: motivoDif(t) };
          }),
        )
        .filter((z) => Math.abs(z.dif) > 0.005)
        .sort((a, b) => Math.abs(b.dif) - Math.abs(a.dif)),
    [fazendas],
  );
  const comDif = linhas.filter((l) => Math.abs(l.dif) > 0.005).length;
  const difTotal = r3(totais.areaPartes - totais.area);
  const corDif = (v) => (Math.abs(v) > 0.005 ? DESTAQUE : "text-muted");
  const conta = { varias: 0, uma: 0, filtro: 0 };
  for (const z of talhoes) conta[z.motivo] += 1;
  const origens = [
    conta.varias > 0 && `${qtd(conta.varias, "talhão", "talhões")} de várias partes (também no card Partes ≠ área do talhão)`,
    conta.uma > 0 &&
      `${qtd(conta.uma, "talhão", "talhões")} de uma parte só, com a Área Parte diferente da Área Talhão (fora do card Partes ≠ área do talhão, que olha só os talhões com várias partes)`,
    conta.filtro > 0 &&
      `${qtd(conta.filtro, "talhão que entra", "talhões que entram")} no filtro só com algumas partes (a Área Talhão conta inteira; a soma, só das partes que passam)`,
  ].filter(Boolean);
  const somaT = (fn) => r3(talhoes.reduce((s, z) => s + fn(z), 0));
  const situacao = (z) =>
    z.motivo === "filtro"
      ? `Só ${z.t.partes.length} de ${z.t.inteiro.partes.length} partes no filtro${diverge(z.t) ? " · partes ≠ Área Talhão" : ""}`
      : z.motivo === "varias"
        ? "Várias partes ≠ Área Talhão"
        : "Parte única ≠ Área Talhão";
  const colunas = [
    colCodigo,
    colFazenda(base.onFazenda),
    { rotulo: "Talhões", num: "int", valor: (f) => f.talhoes.length, total: totais.talhoes },
    { rotulo: "Área dos talhões (ha)", num: "ha", valor: (f) => f.area, total: totais.area },
    { rotulo: "Soma das partes (ha)", num: "ha", valor: (f) => f.areaPartes, total: totais.areaPartes },
    {
      rotulo: "Diferença (ha)",
      num: "ha",
      valor: (f) => f.dif,
      exibir: (f) => nfSinal(f.dif),
      classe: (f) => corDif(f.dif),
      total: difTotal,
      exibirTotal: nfSinal,
    },
  ];
  const colunasTalhoes = [
    colCodigo,
    colFazenda(base.onFazenda),
    { rotulo: "Talhão", num: "cod", valor: (z) => z.t.tlh, classe: () => "font-medium text-ink" },
    { rotulo: "Bloco", num: "cod", valor: (z) => z.t.bloco, classe: () => "text-muted" },
    {
      rotulo: "Partes",
      num: "int",
      valor: (z) => z.t.partes.length,
      total: talhoes.reduce((s, z) => s + z.t.partes.length, 0),
      dica: (z) => `Área de cada parte (ha): ${areasDasPartes(z.t.partes)}`,
    },
    { rotulo: "Área das partes (ha)", valor: (z) => areasDasPartes(z.t.partes), soPlanilha: true },
    { rotulo: "Área do talhão (ha)", num: "ha", valor: (z) => z.area, total: somaT((z) => z.area) },
    { rotulo: "Soma das partes (ha)", num: "ha", valor: (z) => r3(z.t.somaPartes), total: somaT((z) => z.t.somaPartes) },
    {
      rotulo: "Diferença (ha)",
      num: "ha",
      valor: (z) => z.dif,
      exibir: (z) => nfSinal(z.dif),
      classe: () => DESTAQUE,
      total: somaT((z) => z.dif),
      exibirTotal: nfSinal,
    },
    { rotulo: "Situação", valor: situacao, classe: (z) => (z.motivo === "filtro" ? "text-muted" : "text-ink") },
  ];
  return (
    <JanelaCard
      titulo="Soma das partes"
      base={base}
      largura="6xl"
      inconsistencias
      exportar={{ nome: "Soma das partes por fazenda", colunas, linhas }}
    >
      {comDif === 0 ? (
        <Nota>Diferença = soma da Área Parte − área dos talhões. Nenhuma fazenda com diferença.</Nota>
      ) : (
        <Nota>
          Diferença = soma da Área Parte − área dos talhões. {qtd(comDif, "fazenda tem", "fazendas têm")} diferença (no topo da lista). Ela vem dos
          talhões em que a soma das partes não bate com a área do talhão{origens.length > 0 ? `, listados abaixo: ${origens.join("; ")}` : ""}.
        </Nota>
      )}
      <TabelaJanela colunas={colunas} linhas={linhas} chave={(f) => f.propCod} />
      <Secao
        titulo={`Talhões que formam a diferença · ${int(talhoes.length)}`}
        acoes={exportarTabela(base.safra, { nome: "Soma das partes - talhões com diferença", colunas: colunasTalhoes, linhas: talhoes })}
      >
        <TabelaJanela
          colunas={colunasTalhoes}
          linhas={talhoes}
          chave={(z) => `${z.f.propCod}|${z.t.tlh}`}
          vazio="Nenhum talhão com diferença no filtro."
        />
      </Secao>
    </JanelaCard>
  );
}

/**
 * Card Partes ≠ área do talhão: os talhões com mais de uma parte cuja soma não bate com a Área Talhão. A conta é sempre
 * com todas as partes do talhão (`inteiro`), como na verificação de Validações; o filtro só escolhe os talhões.
 */
function JanelaDivergentes({ fazendas, totais, algumFiltro, base }) {
  const linhas = useMemo(
    () =>
      fazendas
        .flatMap((f) => f.talhoes.filter(diverge).map((t) => ({ f, t, dif: r3(t.inteiro.somaPartes - t.areaTlh) })))
        .sort((a, b) => Math.abs(b.dif) - Math.abs(a.dif)),
    [fazendas],
  );
  const soma = (fn) => r3(linhas.reduce((s, z) => s + fn(z), 0));
  const colunas = [
    colCodigo,
    colFazenda(base.onFazenda),
    { rotulo: "Talhão", num: "cod", valor: (z) => z.t.tlh, classe: () => "font-medium text-ink" },
    { rotulo: "Bloco", num: "cod", valor: (z) => z.t.bloco, classe: () => "text-muted" },
    {
      rotulo: "Partes",
      num: "int",
      valor: (z) => z.t.inteiro.partes.length,
      total: linhas.reduce((s, z) => s + z.t.inteiro.partes.length, 0),
      dica: (z) =>
        `Área de cada parte (ha): ${areasDasPartes(z.t.inteiro.partes)}${
          z.t.partes.length < z.t.inteiro.partes.length ? ` · no filtro: ${z.t.partes.map((p) => p.parte).join(", ")}` : ""
        }`,
    },
    { rotulo: "Área das partes (ha)", valor: (z) => areasDasPartes(z.t.inteiro.partes), soPlanilha: true },
    { rotulo: "Área Talhão (ha)", num: "ha", valor: (z) => z.t.areaTlh, total: soma((z) => z.t.areaTlh) },
    { rotulo: "Soma das partes (ha)", num: "ha", valor: (z) => r3(z.t.inteiro.somaPartes), total: soma((z) => z.t.inteiro.somaPartes) },
    {
      rotulo: "Diferença (ha)",
      num: "ha",
      valor: (z) => z.dif,
      exibir: (z) => nfSinal(z.dif),
      classe: () => DESTAQUE,
      total: soma((z) => z.dif),
      exibirTotal: nfSinal,
    },
  ];
  return (
    <JanelaCard
      titulo="Partes ≠ área do talhão"
      base={base}
      largura="6xl"
      inconsistencias
      exportar={{ nome: "Partes diferentes da área do talhão", colunas, linhas }}
    >
      {totais.divergentes > 0 ? (
        <Nota>
          {qtd(totais.divergentes, "talhão", "talhões")} com mais de uma parte em que a soma da Área Parte é diferente da Área Talhão (as maiores
          diferenças primeiro; passe o mouse em Partes para ver a área de cada uma).
          {algumFiltro
            ? " Com filtro, entram os talhões que têm alguma parte no filtro, mas a conta é com todas as partes do talhão (como em Validações)."
            : ""}{" "}
          O apontamento usa a Área Talhão; para corrigir, acerte as áreas no sistema agrícola e reimporte o Relatório de Talhões.
        </Nota>
      ) : (
        <Nota>Nenhum talhão com partes cuja soma é diferente da Área Talhão.</Nota>
      )}
      <TabelaJanela colunas={colunas} linhas={linhas} chave={(z) => `${z.f.propCod}|${z.t.tlh}`} vazio="Nenhum talhão com diferença no filtro." />
    </JanelaCard>
  );
}

/**
 * Card Partes para agrupar: os talhões com duas ou mais partes com a mesma data de plantio, variedade, estágio de corte
 * e espaçamento — uma linha por grupo de partes iguais (um talhão pode ter mais de um grupo). Sempre com todas as
 * partes do talhão (`inteiro`), como em Validações; o filtro só escolhe os talhões.
 */
function JanelaAgrupar({ fazendas, totais, algumFiltro, base }) {
  const linhas = useMemo(
    () =>
      fazendas.flatMap((f) =>
        f.talhoes.flatMap((t) =>
          partesIguais(t.inteiro.partes).map((g) => ({ f, t, g, area: r3(g.reduce((s, p) => s + (p.areaParte ?? 0), 0)) })),
        ),
      ),
    [fazendas],
  );
  const colunas = [
    colCodigo,
    colFazenda(base.onFazenda),
    { rotulo: "Talhão", num: "cod", valor: (z) => z.t.tlh, classe: () => "font-medium text-ink" },
    { rotulo: "Bloco", num: "cod", valor: (z) => z.t.bloco, classe: () => "text-muted" },
    { rotulo: "Partes iguais", valor: (z) => z.g.map((p) => p.parte).join(", "), classe: () => DESTAQUE },
    { rotulo: "Qtd. partes", num: "int", valor: (z) => z.g.length, total: linhas.reduce((s, z) => s + z.g.length, 0) },
    { rotulo: "Partes do talhão", num: "int", valor: (z) => z.t.inteiro.partes.length, classe: () => "text-muted" },
    { rotulo: "Data de plantio", valor: (z) => data(z.g[0].plantio) || "–" },
    { rotulo: "Variedade", valor: (z) => z.g[0].variedade || "–" },
    { rotulo: "Estágio de corte", num: "cod", valor: (z) => z.g[0].estagio ?? "–" },
    { rotulo: "Espaçamento", num: "cod", valor: (z) => (z.g[0].esp ? nf(z.g[0].esp, 1) : "–") },
    {
      rotulo: "Área das partes (ha)",
      num: "ha",
      valor: (z) => z.area,
      total: r3(linhas.reduce((s, z) => s + z.area, 0)),
      dica: (z) => `Área de cada parte (ha): ${areasDasPartes(z.g)}`,
    },
  ];
  return (
    <JanelaCard
      titulo="Partes para agrupar"
      base={base}
      largura="6xl"
      inconsistencias
      exportar={{ nome: "Partes para agrupar no ERP", colunas, linhas }}
    >
      {totais.agrupar > 0 ? (
        <Nota>
          {qtd(totais.agrupar, "talhão", "talhões")} com partes que têm a mesma data de plantio, variedade, estágio de corte e espaçamento (
          {qtd(totais.gruposAgrupar, "grupo", "grupos")} de partes iguais): elas podem ser agrupadas numa parte só no ERP (sistema agrícola); depois,
          reimporte o Relatório de Talhões. Partes sem variedade e sem plantio (carreador, APP…) não entram.
          {algumFiltro ? " Com filtro, entram os talhões que têm alguma parte no filtro, mas a comparação é com todas as partes do talhão." : ""}
        </Nota>
      ) : (
        <Nota>Nenhum talhão com partes iguais (mesma data de plantio, variedade, estágio de corte e espaçamento).</Nota>
      )}
      <TabelaJanela
        colunas={colunas}
        linhas={linhas}
        chave={(z) => `${z.f.propCod}|${z.t.tlh}|${z.g.map((p) => p.parte).join(",")}`}
        vazio="Nenhum talhão com partes iguais no filtro."
      />
    </JanelaCard>
  );
}

/** Talhões e partes de uma fazenda: a primeira parte de cada talhão traz o talhão, a ocupação e a área do talhão. */
function TalhoesDaFazenda({ fazenda }) {
  // parte → as outras partes iguais a ela no talhão (para a marca "agrupar")
  const iguaisPorTalhao = useMemo(() => {
    const m = new Map();
    for (const t of fazenda.talhoes) {
      const porParte = new Map();
      for (const g of partesIguais(t.inteiro.partes)) {
        for (const p of g) porParte.set(p.parte, g.filter((x) => x.parte !== p.parte).map((x) => x.parte));
      }
      m.set(t.tlh, porParte);
    }
    return m;
  }, [fazenda]);
  const iguais = (t) => iguaisPorTalhao.get(t.tlh) ?? new Map();
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
                      title={
                        diverge(t)
                          ? `Soma das ${t.inteiro.partes.length} partes do talhão: ${nf(t.inteiro.somaPartes)} ha (diferente da área do talhão)`
                          : undefined
                      }
                    >
                      {nf(areaDoTalhao(t))}
                    </span>
                  )}
                </td>
                <td className="whitespace-nowrap px-2.5 py-1 text-right tabular text-ink">
                  {iguais(t).has(p.parte) && (
                    <span
                      className="mr-1 rounded bg-amber-50 px-1 text-[10.5px] font-semibold text-amber-700"
                      title={`Mesma data de plantio, variedade, estágio de corte e espaçamento que a(s) parte(s) ${iguais(t)
                        .get(p.parte)
                        .join(", ")}: pode ser agrupada no ERP`}
                    >
                      agrupar
                    </span>
                  )}
                  {p.parte}
                </td>
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
