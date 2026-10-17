"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { BotaoCartao, BotaoLink, JanelaCard, Nota, TabelaJanela, exportarTabela, int } from "@/app/(app)/acompanhamentos/insumos/janela-detalhe";
import { BotaoExportar, FILTRO, SeloPosicao } from "@/app/(app)/acompanhamentos/os-agricola/comum";
import SelecaoMultipla from "@/components/SelecaoMultipla";
import { IconAtualizar } from "@/components/icons";
import { Abas, BarraFiltros, CabecalhoPagina, Comando, CorpoPagina, EstadoVazio, Indicador, Pagina, Painel } from "@/components/pagina";
import { fmtDateBR } from "@/lib/format";
import { ehTexto, ehUmDe, usarPersistido } from "@/lib/usar-persistido";

/*
 * Atividades › Apontamentos Diários › Análise: o painel dos analistas (Analista II e Gravação) para cobrar as áreas
 * responsáveis. As O.S. em aberto da base de Ordem de Serviço Agr. com os apontamentos lançados nelas (tela, Lançamento
 * Mobile e bot do WhatsApp) e os alertas: O.S. para fechar, com a área total já informada, apontada acima da área, sem
 * apontamento e com o prazo vencido. Só leitura: o que se corrige, corrige-se no Apontamento ou no ERP.
 */

const ROTULO = "mb-1 block truncate text-[11.5px] font-medium text-muted";
const nf = (n, c = 2) => n.toLocaleString("pt-BR", { minimumFractionDigits: c, maximumFractionDigits: c });
const ha = (n) => (n ? nf(n) : "–");
const data = (iso) => (iso ? fmtDateBR(iso.slice(0, 10)) : "–");
const dias = (n) => (n === null || n === undefined ? "–" : n === 1 ? "1 dia" : `${int(n)} dias`);
const semAcento = (s) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
const ehLista = (v) => Array.isArray(v) && v.every((x) => typeof x === "string");

/** Quantas O.S. a lista mostra de cada vez. */
const PASSO = 100;
const SEM_AREA = "Sem área no cadastro";
const SEM_RESP = "Sem responsável";
const areaDe = (o) => o.area || SEM_AREA;
const respDe = (o) => o.respNm || SEM_RESP;

/** Os alertas, na ordem de gravidade (é a ordem dos cards e dos selos). */
const ORDEM = ["concluida", "areaTotal", "acima", "semApont", "vencida"];
function infoAlertas(diasSem) {
  return {
    concluida: {
      card: "Para fechar",
      selo: "Fechar no ERP",
      cor: "vermelho",
      texto: "O último status informado no apontamento é CONCLUÍDA e a O.S. continua em aberto na base: fechar a O.S. no ERP.",
    },
    areaTotal: {
      card: "Área total informada",
      selo: "Área total informada",
      cor: "laranja",
      texto: "Toda a área da O.S. já foi apontada e ela segue em andamento (aberta ou liberada): confirmar com a área responsável e fechar, ou corrigir o apontamento.",
    },
    acima: {
      card: "Acima da área da O.S.",
      selo: "Acima da área",
      cor: "vermelho",
      texto: "Talhões com mais área apontada que a área da O.S. (a recomendada; sem ela, a plantada): corrigir o apontamento ou a O.S.",
    },
    semApont: {
      card: "Sem apontamento",
      selo: "Sem apontamento",
      cor: "cinza",
      texto: `Em aberto há ${diasSem} dias ou mais sem nenhum apontamento lançado: cobrar o lançamento da área responsável.`,
    },
    vencida: {
      card: "Prazo vencido",
      selo: "Prazo vencido",
      cor: "amarelo",
      texto: "A previsão final da O.S. já passou e ainda há área a apontar.",
    },
  };
}
const CLASSE_SELO = {
  vermelho: "border-[#BE3132]/30 bg-[#F7DDDC] text-[#9E2526] dark:bg-[#BE3132]/20 dark:text-[#F08A78]",
  laranja: "border-[#D77B38]/30 bg-[#FBE7D6] text-[#A85A1F] dark:bg-[#D77B38]/20 dark:text-[#F0A066]",
  cinza: "border-line bg-surface text-[#5C6777] dark:text-muted",
  amarelo: "border-[#D9A21B]/40 bg-[#F5ECCC] text-[#7A5A08] dark:bg-[#D9A21B]/20 dark:text-amber-300",
};

function SeloAlerta({ a, o, info }) {
  const i = info[a];
  return (
    <span className={`inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium ${CLASSE_SELO[i.cor]}`} title={i.texto}>
      {a === "acima" ? `+${nf(o.acima)} ha acima` : i.selo}
    </span>
  );
}

/** Texto onde a busca procura: O.S., fazendas, operações, responsável, área e boletins. */
const textoBusca = (o) =>
  semAcento(
    [o.os, o.respNm, o.area, ...o.fazendas.flatMap((f) => [f.cod, f.nm]), ...o.ops.flatMap((x) => [x.cod, x.ds]), ...o.apontamentos.map((a) => a.boletim ?? "")].join(" "),
  );

/** Link para a lista do Apontamento já filtrada pela O.S., do 1º apontamento (ou da data da O.S.) até hoje. */
function linkApontamento(o, hoje) {
  const datas = [o.dtOs, ...o.apontamentos.map((a) => a.dt)].filter(Boolean).sort();
  const p = new URLSearchParams({ os: o.os, de: datas[0] ?? hoje, ate: hoje });
  return `/atividades/apontamentos-diarios/apontamento?${p}`;
}

/** Ordem da lista: mais alertas (e os mais graves) primeiro; depois a O.S. mais antiga. */
const peso = (o) => o.alertas.reduce((s, a) => s + 2 ** (ORDEM.length - ORDEM.indexOf(a)), 0);
const porPrioridade = (a, b) => peso(b) - peso(a) || (b.dias ?? 0) - (a.dias ?? 0) || Number(a.os) - Number(b.os);

export default function AnaliseApontamentosClient() {
  const [dados, setDados] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(null);
  const [fArea, setFArea] = usarPersistido("analise-ap.area", [], ehLista);
  const [fResp, setFResp] = usarPersistido("analise-ap.resp", [], ehLista);
  const [fOp, setFOp] = usarPersistido("analise-ap.op", [], ehLista);
  const [fFaz, setFFaz] = usarPersistido("analise-ap.faz", [], ehLista);
  const [fAlerta, setFAlerta] = usarPersistido("analise-ap.alerta", "", ehTexto);
  const [agrupar, setAgrupar] = usarPersistido("analise-ap.agrupar", "area", ehUmDe(["area", "resp"]));
  const [busca, setBusca] = useState("");
  const [limite, setLimite] = useState(PASSO);
  const [aberta, setAberta] = useState(null);
  const [janela, setJanela] = useState(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const res = await fetch("/api/atividades/analise", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Não foi possível carregar a análise.");
      setDados(json);
      setErro(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível carregar a análise.");
    } finally {
      setCarregando(false);
    }
  }, []);
  useEffect(() => {
    carregar();
  }, [carregar]);

  const ordens = useMemo(() => dados?.ordens ?? [], [dados]);
  const hoje = dados?.hoje ?? "";
  const info = useMemo(() => infoAlertas(dados?.diasSemApontamento ?? 7), [dados]);

  // opções dos filtros (das O.S. em aberto)
  const opcoes = useMemo(() => {
    const areas = new Set();
    const resp = new Set();
    const ops = new Map();
    const faz = new Map();
    for (const o of ordens) {
      areas.add(areaDe(o));
      resp.add(respDe(o));
      for (const x of o.ops) if (!ops.has(x.cod)) ops.set(x.cod, x.ds);
      for (const f of o.fazendas) if (!faz.has(f.cod)) faz.set(f.cod, f.nm);
    }
    const nomes = (s) => [...s].sort((a, b) => a.localeCompare(b, "pt-BR")).map((n) => ({ cod: n, nome: n }));
    const codigos = (m) =>
      [...m].sort((a, b) => a[0].localeCompare(b[0], "pt-BR", { numeric: true })).map(([cod, nome]) => ({ cod, nome: nome || cod }));
    return { areas: nomes(areas), resp: nomes(resp), ops: codigos(ops), faz: codigos(faz) };
  }, [ordens]);

  // as O.S. nos filtros (sem o de alerta: é o que os cards e a tabela por área contam)
  const termo = semAcento(busca.trim());
  const base = useMemo(
    () =>
      ordens.filter(
        (o) =>
          (!fArea.length || fArea.includes(areaDe(o))) &&
          (!fResp.length || fResp.includes(respDe(o))) &&
          (!fOp.length || o.ops.some((x) => fOp.includes(x.cod))) &&
          (!fFaz.length || o.fazendas.some((f) => fFaz.includes(f.cod))) &&
          (!termo || textoBusca(o).includes(termo)),
      ),
    [ordens, fArea, fResp, fOp, fFaz, termo],
  );
  const lista = useMemo(
    () =>
      base
        .filter((o) => !fAlerta || (fAlerta === "com" ? o.alertas.length > 0 : fAlerta === "sem" ? o.alertas.length === 0 : o.alertas.includes(fAlerta)))
        .sort(porPrioridade),
    [base, fAlerta],
  );
  useEffect(() => setLimite(PASSO), [lista]);

  const resumo = useMemo(() => {
    const r = { n: base.length, rec: 0, apontado: 0, comAlerta: 0, acimaHa: 0 };
    for (const a of ORDEM) r[a] = 0;
    for (const o of base) {
      r.rec += o.rec;
      r.apontado += o.apontado;
      r.acimaHa += o.acima;
      if (o.alertas.length) r.comAlerta++;
      for (const a of o.alertas) r[a]++;
    }
    return r;
  }, [base]);

  // a cobrança: as O.S. somadas por área responsável (ou por responsável)
  const grupos = useMemo(() => {
    const m = new Map();
    for (const o of base) {
      const k = agrupar === "area" ? areaDe(o) : respDe(o);
      let g = m.get(k);
      if (!g) {
        g = { nome: k, area: areaDe(o), resp: new Set(), n: 0, rec: 0, apontado: 0, saldo: 0, comAlerta: 0 };
        for (const a of ORDEM) g[a] = 0;
        m.set(k, g);
      }
      g.resp.add(respDe(o));
      g.n++;
      g.rec += o.rec;
      g.apontado += o.apontado;
      g.saldo += o.saldo;
      if (o.alertas.length) g.comAlerta++;
      for (const a of o.alertas) g[a]++;
    }
    return [...m.values()]
      .map((g) => ({ ...g, nResp: g.resp.size, pct: g.rec > 0 ? Math.round((g.apontado / g.rec) * 1000) / 10 : null }))
      .sort((a, b) => b.comAlerta - a.comAlerta || b.n - a.n || a.nome.localeCompare(b.nome, "pt-BR"));
  }, [base, agrupar]);

  const filtrosAtivos = fArea.length || fResp.length || fOp.length || fFaz.length || fAlerta || busca;
  function limpar() {
    setFArea([]);
    setFResp([]);
    setFOp([]);
    setFFaz([]);
    setFAlerta("");
    setBusca("");
  }

  /** Da janela de um card (ou da tabela por área) para a O.S. na lista, aberta e à vista. */
  function irParaOS(o) {
    setJanela(null);
    setFAlerta("");
    setBusca(o.os);
    const k = `${o.emp}|${o.os}`;
    setAberta(k);
    setTimeout(() => document.querySelector(`[data-linha="${CSS.escape(k)}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 80);
  }
  function filtrarGrupo(g) {
    if (agrupar === "area") setFArea([g.nome]);
    else setFResp([g.nome]);
  }

  const colunasExportar = [
    { rotulo: "O.S.", valor: (o) => Number(o.os) || o.os },
    { rotulo: "Data da O.S.", valor: (o) => (o.dtOs ? fmtDateBR(o.dtOs) : "") },
    { rotulo: "Dias em aberto", valor: (o) => o.dias },
    { rotulo: "Previsão final", valor: (o) => (o.prevFim ? fmtDateBR(o.prevFim) : "") },
    { rotulo: "Posição", valor: (o) => (o.posicao === "L" ? "Liberada" : "Aberta") },
    { rotulo: "Operação", valor: (o) => o.ops.map((x) => `${x.cod} - ${x.ds}`).join(" | ") },
    { rotulo: "Fazenda", valor: (o) => o.fazendas.map((f) => (f.nm ? `${f.cod} - ${f.nm}` : f.cod)).join(" | ") },
    { rotulo: "Responsável", valor: (o) => o.respNm },
    { rotulo: "Área responsável", valor: (o) => o.area },
    { rotulo: "Área da O.S. (ha)", valor: (o) => o.rec },
    { rotulo: "Apontado (ha)", valor: (o) => o.apontado },
    { rotulo: "Saldo (ha)", valor: (o) => o.saldo },
    { rotulo: "% apontado", valor: (o) => o.pct },
    { rotulo: "Acima da área (ha)", valor: (o) => o.acima || "" },
    { rotulo: "Fora dos talhões da O.S. (ha)", valor: (o) => o.fora || "" },
    { rotulo: "Apontamentos", valor: (o) => o.apontamentos.length },
    { rotulo: "Último apontamento", valor: (o) => (o.ultimo ? fmtDateBR(o.ultimo.dt) : "") },
    { rotulo: "Último status informado", valor: (o) => (o.status ? `${o.status.status} em ${fmtDateBR(o.status.dt)}` : "") },
    { rotulo: "Alertas", valor: (o) => o.alertas.map((a) => info[a].selo).join(" | ") },
  ];

  const colunasGrupo = [
    agrupar === "area"
      ? {
          rotulo: "Área responsável",
          valor: (g) => g.nome,
          exibir: (g) => (
            <BotaoLink onClick={() => filtrarGrupo(g)} title="Filtrar a tela por esta área">
              {g.nome}
            </BotaoLink>
          ),
        }
      : {
          rotulo: "Responsável",
          valor: (g) => g.nome,
          exibir: (g) => (
            <BotaoLink onClick={() => filtrarGrupo(g)} title="Filtrar a tela por este responsável">
              {g.nome}
            </BotaoLink>
          ),
        },
    agrupar === "area"
      ? { rotulo: "Responsáveis", num: "int", valor: (g) => g.nResp }
      : { rotulo: "Área responsável", valor: (g) => g.area, classe: () => "text-muted" },
    { rotulo: "O.S. em aberto", num: "int", valor: (g) => g.n, total: resumo.n },
    { rotulo: "Área da O.S. (ha)", num: "dec", valor: (g) => g.rec, total: resumo.rec },
    { rotulo: "Apontado (ha)", num: "dec", valor: (g) => g.apontado, total: resumo.apontado },
    { rotulo: "% apontado", num: "pct", valor: (g) => g.pct, total: resumo.rec > 0 ? Math.round((resumo.apontado / resumo.rec) * 1000) / 10 : null },
    ...ORDEM.map((a) => ({
      rotulo: info[a].card,
      num: "int",
      valor: (g) => g[a],
      exibir: (g) => (g[a] ? int(g[a]) : "–"),
      classe: (g) => (g[a] ? "font-medium text-[#BE3132] dark:text-[#F08A78]" : "text-muted"),
      total: resumo[a],
    })),
    { rotulo: "O.S. com alerta", num: "int", valor: (g) => g.comAlerta, total: resumo.comAlerta, classe: (g) => (g.comAlerta ? "font-semibold text-ink" : "text-muted") },
  ];

  const cards = [
    { id: "todas", rotulo: "O.S. em aberto", valor: int(resumo.n), cor: "azul", apoio: `${nf(resumo.apontado)} de ${nf(resumo.rec)} ha apontados` },
    ...ORDEM.map((a) => ({
      id: a,
      rotulo: info[a].card,
      valor: int(resumo[a]),
      cor: info[a].cor,
      apoio:
        a === "acima"
          ? `${nf(resumo.acimaHa)} ha acima da área`
          : a === "concluida"
            ? "concluída no campo, aberta no ERP"
            : a === "areaTotal"
              ? "100% apontado, em andamento"
              : a === "semApont"
                ? `${dados?.diasSemApontamento ?? 7} dias ou mais sem lançamento`
                : "previsão final passou, com saldo",
    })),
  ];

  return (
    <Pagina>
      <CabecalhoPagina
        titulo="Análise dos Apontamentos"
        categoria="Atividades · Apontamentos Diários"
        comandos={
          <>
            <Comando icone={<IconAtualizar size={16} />} onClick={carregar} disabled={carregando}>
              Atualizar
            </Comando>
            <BotaoExportar nome="Analise dos Apontamentos" colunas={colunasExportar} buscar={async () => lista} />
          </>
        }
        info={hoje && <span>Situação em {fmtDateBR(hoje)}</span>}
      />

      <CorpoPagina>
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          {cards.map((c) => (
            <BotaoCartao
              key={c.id}
              onClick={() => setJanela(c.id)}
              title={c.id === "todas" ? "Ver as O.S. em aberto" : info[c.id].texto}
              className={fAlerta === c.id ? "ring-2 ring-navy-900 dark:ring-crv-acao" : ""}
            >
              <Indicador cor={c.cor} rotulo={c.rotulo} valor={c.valor} apoio={c.apoio} className="h-full" />
            </BotaoCartao>
          ))}
        </div>

        <BarraFiltros>
          <SelecaoMultipla
            rotulo="Área responsável"
            opcoes={dados ? opcoes.areas : null}
            valor={fArea}
            onChange={setFArea}
            singular="área"
            plural="áreas"
            soNome
            placeholder="Buscar área…"
            className={`${FILTRO} w-[200px]`}
          />
          <SelecaoMultipla
            rotulo="Responsável"
            opcoes={dados ? opcoes.resp : null}
            valor={fResp}
            onChange={setFResp}
            todos="Todos"
            singular="responsável"
            plural="responsáveis"
            soNome
            placeholder="Buscar nome…"
            className={`${FILTRO} w-[200px]`}
          />
          <SelecaoMultipla
            rotulo="Operação"
            opcoes={dados ? opcoes.ops : null}
            valor={fOp}
            onChange={setFOp}
            singular="operação"
            plural="operações"
            className={`${FILTRO} w-[210px]`}
          />
          <SelecaoMultipla
            rotulo="Fazenda"
            opcoes={dados ? opcoes.faz : null}
            valor={fFaz}
            onChange={setFFaz}
            singular="fazenda"
            plural="fazendas"
            className={`${FILTRO} w-[200px]`}
          />
          <div>
            <label className={ROTULO} htmlFor="analise-alerta">
              Alerta
            </label>
            <select id="analise-alerta" value={fAlerta} onChange={(e) => setFAlerta(e.target.value)} className={`${FILTRO} w-[180px]`}>
              <option value="">Todas as O.S.</option>
              <option value="com">Com algum alerta</option>
              <option value="sem">Sem alerta</option>
              {ORDEM.map((a) => (
                <option key={a} value={a}>
                  {info[a].card}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-[180px] flex-1">
            <label className={ROTULO} htmlFor="analise-busca">
              Buscar
            </label>
            <input
              id="analise-busca"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="O.S., fazenda, operação, boletim…"
              className={`${FILTRO} w-full`}
            />
          </div>
          {filtrosAtivos ? (
            <button type="button" onClick={limpar} className="pb-1.5 text-[12.5px] font-medium text-crv-acao hover:underline dark:text-[#8fb6f2]">
              Limpar filtros
            </button>
          ) : null}
        </BarraFiltros>

        {erro && <p className="mb-3 rounded-md border border-alert-500/40 bg-alert-50 px-3 py-2 text-[12.5px] text-alert-700">{erro}</p>}

        <Painel
          className="mb-4"
          semEspaco
          titulo={agrupar === "area" ? "Cobrança por área responsável" : "Cobrança por responsável"}
          subtitulo="O.S. em aberto e alertas de cada uma; clique no nome para filtrar a tela."
          acoes={
            <>
              <Abas
                itens={[
                  { id: "area", label: "Por área" },
                  { id: "resp", label: "Por responsável" },
                ]}
                ativo={agrupar}
                onChange={setAgrupar}
                className="border-b-0"
              />
              {exportarTabela(`Analise ${hoje}`, { nome: agrupar === "area" ? "Por area" : "Por responsavel", colunas: colunasGrupo, linhas: grupos })}
            </>
          }
        >
          <div className="p-3">
            <TabelaJanela
              colunas={colunasGrupo}
              linhas={grupos}
              chave={(g) => g.nome}
              vazio={carregando ? "Carregando…" : "Nenhuma O.S. em aberto no filtro."}
              rotuloTotal={`Total · ${int(grupos.length)} ${agrupar === "area" ? (grupos.length === 1 ? "área" : "áreas") : grupos.length === 1 ? "responsável" : "responsáveis"}`}
            />
          </div>
        </Painel>

        <Painel
          semEspaco
          titulo="O.S. em aberto"
          subtitulo={
            dados
              ? `${int(lista.length)} O.S.${fAlerta ? ` · ${fAlerta === "com" ? "com algum alerta" : fAlerta === "sem" ? "sem alerta" : info[fAlerta].card}` : ""} · as com mais alertas primeiro; clique numa O.S. para ver os apontamentos dela`
              : undefined
          }
        >
          <div className={`overflow-x-auto transition-opacity ${carregando ? "opacity-60" : ""}`}>
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="whitespace-nowrap border-b border-line bg-surface text-left text-muted">
                  <th className="w-6 px-2 py-2" />
                  <th className="px-3 py-2 text-right font-medium">O.S.</th>
                  <th className="px-3 py-2 font-medium">Data</th>
                  <th className="px-3 py-2 text-right font-medium">Em aberto</th>
                  <th className="px-3 py-2 font-medium">Previsão final</th>
                  <th className="px-3 py-2 font-medium">Posição</th>
                  <th className="min-w-[200px] px-3 py-2 font-medium">Operação</th>
                  <th className="min-w-[160px] px-3 py-2 font-medium">Fazenda</th>
                  <th className="px-3 py-2 font-medium">Responsável</th>
                  <th className="px-3 py-2 font-medium">Área resp.</th>
                  <th className="px-3 py-2 text-right font-medium">Área O.S. (ha)</th>
                  <th className="px-3 py-2 text-right font-medium">Apontado (ha)</th>
                  <th className="px-3 py-2 text-right font-medium">Saldo (ha)</th>
                  <th className="px-3 py-2 text-right font-medium">%</th>
                  <th className="px-3 py-2 font-medium">Último apontamento</th>
                  <th className="px-3 py-2 font-medium">Último status</th>
                  <th className="min-w-[150px] px-3 py-2 font-medium">Alertas</th>
                </tr>
              </thead>
              <tbody>
                {lista.slice(0, limite).map((o) => {
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
                        <td className="whitespace-nowrap px-3 py-1.5 text-right tabular text-ink">{dias(o.dias)}</td>
                        <td className={`whitespace-nowrap px-3 py-1.5 ${o.alertas.includes("vencida") ? "font-medium text-[#BE3132]" : "text-ink"}`}>{data(o.prevFim)}</td>
                        <td className="px-3 py-1.5">
                          <SeloPosicao p={o.posicao} />
                        </td>
                        <td className="px-3 py-1.5 text-ink">
                          {o.ops[0] && (
                            <>
                              <span className="tabular text-muted">{o.ops[0].cod} · </span>
                              {o.ops[0].ds}
                            </>
                          )}
                          {o.ops.length > 1 && <span className="ml-1 text-[11px] text-muted">+{o.ops.length - 1}</span>}
                        </td>
                        <td className="px-3 py-1.5 text-ink">
                          {o.fazendas[0] && (
                            <>
                              <span className="tabular text-muted">{o.fazendas[0].cod}</span>
                              {o.fazendas[0].nm ? ` · ${o.fazendas[0].nm}` : ""}
                            </>
                          )}
                          {o.fazendas.length > 1 && <span className="ml-1 text-[11px] text-muted">+{o.fazendas.length - 1}</span>}
                        </td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-ink">{o.respNm || "–"}</td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-muted">{o.area || "–"}</td>
                        <td className="px-3 py-1.5 text-right tabular text-ink">{ha(o.rec)}</td>
                        <td className={`px-3 py-1.5 text-right tabular ${o.acima > 0 ? "font-medium text-[#BE3132]" : "text-ink"}`}>{ha(o.apontado)}</td>
                        <td className="px-3 py-1.5 text-right tabular text-ink">{ha(o.saldo)}</td>
                        <td className="px-3 py-1.5 text-right tabular text-ink">{o.pct === null ? "–" : `${nf(o.pct, 1)}%`}</td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-ink">
                          {o.ultimo ? (
                            <>
                              {data(o.ultimo.dt)}
                              {o.ultimo.boletim ? <span className="text-muted"> · bol. {o.ultimo.boletim}</span> : null}
                            </>
                          ) : (
                            <span className="text-muted">nenhum</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-ink">
                          {o.status ? (
                            <span title={`Informado em ${data(o.status.dt)}${o.status.quem ? ` por ${o.status.quem}` : ""}`}>{o.status.status}</span>
                          ) : (
                            <span className="text-muted">–</span>
                          )}
                        </td>
                        <td className="px-3 py-1.5">
                          <div className="flex flex-wrap gap-1">
                            {o.alertas.length ? o.alertas.map((a) => <SeloAlerta key={a} a={a} o={o} info={info} />) : <span className="text-muted">–</span>}
                          </div>
                        </td>
                      </tr>
                      {ab && (
                        // acompanha a linha da O.S. quando a tabela é ordenada pelo título de uma coluna (OrdenarTabelas)
                        <tr data-detalhe-de={k} className="border-t border-line/60 bg-surface/50">
                          <td />
                          <td colSpan={16} className="px-3 py-3">
                            <DetalheOS o={o} hoje={hoje} info={info} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
                {!carregando && lista.length === 0 && (
                  <tr>
                    <td colSpan={17}>
                      {ordens.length === 0 ? (
                        <EstadoVazio titulo="Nenhuma O.S. em aberto na base">
                          A análise usa a base de Ordem de Serviço Agr. Importe o Relatório de Ordens de Serviço em Acompanhamentos › Ordem de Serviço Agr.
                        </EstadoVazio>
                      ) : (
                        <EstadoVazio titulo="Nenhuma O.S. no filtro">Mude os filtros ou use Limpar filtros.</EstadoVazio>
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {lista.length > limite && (
            <div className="flex items-center justify-between border-t border-line bg-surface px-4 py-2 text-[12.5px] text-muted">
              <span>
                Mostrando {int(limite)} de {int(lista.length)} O.S.
              </span>
              <button
                type="button"
                onClick={() => setLimite((l) => l + PASSO)}
                className="rounded-md border border-line bg-card px-2.5 py-1 font-medium text-navy-800 hover:bg-hover"
              >
                Mostrar mais {int(Math.min(PASSO, lista.length - limite))}
              </button>
            </div>
          )}
        </Painel>

        <p className="mt-3 text-[11.5px] leading-relaxed text-muted">
          O.S. em aberto: as aberta e liberada da base de Ordem de Serviço Agr. (as operações encerradas ficam de fora). Área da O.S.: a recomendada de cada
          talhão (sem ela, a plantada). Apontado: a área dos apontamentos da O.S. na mesma operação e nos talhões dela, de todas as origens (tela,
          Lançamento Mobile e bot do WhatsApp); área apontada em outro talhão ou em outra operação aparece no detalhe como &quot;fora dos talhões&quot; e não
          entra no saldo. A área responsável vem do{" "}
          <Link href="/acompanhamentos/os-agricola/responsaveis" className="font-medium text-crv-acao hover:underline dark:text-[#8fb6f2]">
            Cadastro de Responsáveis
          </Link>{" "}
          das O.S. Com operação ou fazenda no filtro, a O.S. aparece inteira (todas as operações dela).
        </p>
      </CorpoPagina>

      {janela && (
        <JanelaAlerta
          id={janela}
          ordens={janela === "todas" ? [...base].sort(porPrioridade) : base.filter((o) => o.alertas.includes(janela)).sort(porPrioridade)}
          info={info}
          hoje={hoje}
          ativo={janela === "todas" ? !fAlerta : fAlerta === janela}
          onFiltrar={() => {
            setFAlerta(janela === "todas" ? "" : janela);
            setJanela(null);
          }}
          onIr={irParaOS}
          onFechar={() => setJanela(null)}
        />
      )}
    </Pagina>
  );
}

/** Janela de um card: as O.S. do alerta (ou todas em aberto), com o que é preciso para a cobrança. */
function JanelaAlerta({ id, ordens, info, hoje, ativo, onFiltrar, onIr, onFechar }) {
  const titulo = id === "todas" ? "O.S. em aberto" : info[id].card;
  const soma = (c) => Math.round(ordens.reduce((s, o) => s + (o[c] ?? 0), 0) * 100) / 100;
  const colunas = [
    {
      rotulo: "O.S.",
      num: "cod",
      valor: (o) => Number(o.os) || o.os,
      exibir: (o) => (
        <BotaoLink onClick={() => onIr(o)} title="Ver a O.S. na lista, com os apontamentos">
          {o.os}
        </BotaoLink>
      ),
    },
    { rotulo: "Data", valor: (o) => (o.dtOs ? fmtDateBR(o.dtOs) : "") },
    { rotulo: "Em aberto", num: "int", valor: (o) => o.dias, exibir: (o) => dias(o.dias) },
    ...(id === "vencida" ? [{ rotulo: "Previsão final", valor: (o) => (o.prevFim ? fmtDateBR(o.prevFim) : ""), classe: () => "font-medium text-[#BE3132]" }] : []),
    { rotulo: "Responsável", valor: (o) => o.respNm || "–" },
    { rotulo: "Área resp.", valor: (o) => o.area || "–", classe: () => "text-muted" },
    { rotulo: "Operação", valor: (o) => o.ops.map((x) => `${x.cod} - ${x.ds}`).join(" | ") },
    { rotulo: "Fazenda", valor: (o) => o.fazendas.map((f) => (f.nm ? `${f.cod} - ${f.nm}` : f.cod)).join(" | ") },
    { rotulo: "Área O.S. (ha)", num: "dec", valor: (o) => o.rec, total: soma("rec") },
    { rotulo: "Apontado (ha)", num: "dec", valor: (o) => o.apontado, total: soma("apontado") },
    { rotulo: "Saldo (ha)", num: "dec", valor: (o) => o.saldo, total: soma("saldo") },
    ...(id === "acima"
      ? [{ rotulo: "Acima (ha)", num: "dec", valor: (o) => o.acima, total: soma("acima"), classe: () => "font-medium text-[#BE3132] dark:text-[#F08A78]" }]
      : []),
    ...(id === "concluida"
      ? [
          {
            rotulo: "Concluída informada em",
            valor: (o) => (o.status ? `${fmtDateBR(o.status.dt)}${o.status.boletim ? ` · bol. ${o.status.boletim}` : ""}${o.status.quem ? ` · ${o.status.quem}` : ""}` : ""),
          },
        ]
      : []),
    ...(id === "semApont" ? [] : [{ rotulo: "Último apontamento", valor: (o) => (o.ultimo ? fmtDateBR(o.ultimo.dt) : "nenhum") }]),
    ...(id === "todas" ? [{ rotulo: "Alertas", valor: (o) => o.alertas.map((a) => info[a].selo).join(" | "), exibir: (o) => o.alertas.map((a) => info[a].selo).join(" · ") || "–" }] : []),
  ];
  return (
    <JanelaCard
      titulo={titulo}
      subtitulo={`${int(ordens.length)} O.S. · situação em ${hoje ? fmtDateBR(hoje) : "–"} · nos filtros da tela`}
      prefixo={`Analise ${hoje}`}
      exportar={{ nome: titulo, colunas, linhas: ordens }}
      largura="6xl"
      onFechar={onFechar}
      rodape={
        !ativo && ordens.length > 0 ? (
          <button type="button" onClick={onFiltrar} className="rounded-lg border border-line bg-card px-3 py-1.5 text-[12.5px] font-medium text-navy-800 hover:bg-surface">
            {id === "todas" ? "Mostrar todas na lista" : "Mostrar só estas na lista"}
          </button>
        ) : null
      }
    >
      {id !== "todas" && <Nota>{info[id].texto}</Nota>}
      <TabelaJanela colunas={colunas} linhas={ordens} chave={(o) => `${o.emp}|${o.os}`} vazio="Nenhuma O.S. neste alerta." rotuloTotal={`Total · ${int(ordens.length)} O.S.`} />
    </JanelaCard>
  );
}

/** A O.S. aberta na lista: as operações (área, apontado, saldo, acima e fora dos talhões) e os apontamentos lançados nela. */
function DetalheOS({ o, hoje, info }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[12px] text-muted">
        {o.etapa && <span>Etapa: {o.etapa}</span>}
        {o.safra && <span>Safra: {o.safra}</span>}
        <span>Previsão final: {data(o.prevFim)}</span>
        <span>
          Último status informado:{" "}
          {o.status ? `${o.status.status} em ${data(o.status.dt)}${o.status.boletim ? ` (bol. ${o.status.boletim})` : ""}${o.status.quem ? `, por ${o.status.quem}` : ""}` : "nenhum"}
        </span>
        {o.fora > 0 && <span className="font-medium text-[#A85A1F] dark:text-[#F0A066]">{nf(o.fora)} ha apontados fora dos talhões ou das operações da O.S.</span>}
        <Link href={linkApontamento(o, hoje)} className="font-medium text-crv-acao hover:underline dark:text-[#8fb6f2]">
          Abrir no Apontamento
        </Link>
      </div>
      {o.alertas.length > 0 && (
        <ul className="space-y-0.5 text-[12px] text-ink">
          {o.alertas.map((a) => (
            <li key={a} className="flex items-start gap-2">
              <SeloAlerta a={a} o={o} info={info} />
              <span className="pt-0.5 text-muted">{info[a].texto}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="grid gap-3 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <table className="w-full self-start rounded-lg border border-line bg-card text-[12px]">
          <thead>
            <tr className="whitespace-nowrap border-b border-line text-left text-muted">
              <th className="px-3 py-1.5 font-medium">Operação</th>
              <th className="px-3 py-1.5 text-right font-medium">Área O.S. (ha)</th>
              <th className="px-3 py-1.5 text-right font-medium">Apontado (ha)</th>
              <th className="px-3 py-1.5 text-right font-medium">Saldo (ha)</th>
              <th className="px-3 py-1.5 text-right font-medium">Acima (ha)</th>
              <th className="px-3 py-1.5 text-right font-medium">Fora dos talhões (ha)</th>
            </tr>
          </thead>
          <tbody>
            {o.ops.map((x) => (
              <tr key={x.cod} className="border-t border-line/60">
                <td className="px-3 py-1 text-ink">
                  <span className="tabular text-muted">{x.cod} · </span>
                  {x.ds}
                </td>
                <td className="px-3 py-1 text-right tabular text-ink">{ha(x.rec)}</td>
                <td className="px-3 py-1 text-right tabular text-ink">{ha(x.apontado)}</td>
                <td className="px-3 py-1 text-right tabular text-ink">{ha(x.saldo)}</td>
                <td className={`px-3 py-1 text-right tabular ${x.acima ? "font-medium text-[#BE3132]" : "text-muted"}`}>{ha(x.acima)}</td>
                <td className={`px-3 py-1 text-right tabular ${x.fora ? "text-[#A85A1F] dark:text-[#F0A066]" : "text-muted"}`}>{ha(x.fora)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <table className="w-full self-start rounded-lg border border-line bg-card text-[12px]">
          <thead>
            <tr className="whitespace-nowrap border-b border-line text-left text-muted">
              <th className="px-3 py-1.5 text-right font-medium">Boletim</th>
              <th className="px-3 py-1.5 font-medium">Data</th>
              <th className="px-3 py-1.5 font-medium">Operação</th>
              <th className="px-3 py-1.5 text-right font-medium">Área (ha)</th>
              <th className="px-3 py-1.5 font-medium">Status informado</th>
              <th className="px-3 py-1.5 font-medium">Origem</th>
              <th className="px-3 py-1.5 font-medium">Apontador</th>
            </tr>
          </thead>
          <tbody>
            {o.apontamentos.map((a) => (
              <tr key={a.id} className="border-t border-line/60">
                <td className="px-3 py-1 text-right tabular text-ink">{a.boletim ?? "–"}</td>
                <td className="whitespace-nowrap px-3 py-1 text-ink">{data(a.dt)}</td>
                <td className="px-3 py-1 text-ink">
                  <span className="tabular text-muted">{a.opCod} · </span>
                  {a.opDs}
                </td>
                <td className="px-3 py-1 text-right tabular text-ink">{ha(a.area)}</td>
                <td className={`whitespace-nowrap px-3 py-1 ${a.status === "CONCLUÍDA" ? "font-medium text-good-700" : "text-ink"}`}>{a.status || "–"}</td>
                <td className="whitespace-nowrap px-3 py-1 text-ink">
                  {a.origem}
                  {a.conferido === false && <span className="ml-1 text-[11px] font-medium text-[#A85A1F] dark:text-[#F0A066]">a conferir</span>}
                </td>
                <td className="whitespace-nowrap px-3 py-1 text-ink">{a.quem || "–"}</td>
              </tr>
            ))}
            {o.apontamentos.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-4 text-center text-muted">
                  Nenhum apontamento lançado nesta O.S.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
