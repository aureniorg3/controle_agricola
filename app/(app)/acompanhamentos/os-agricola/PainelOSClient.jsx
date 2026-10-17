"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { IconAlerta, IconCamadas, IconGrafico, IconOrdemServico, IconRelogio } from "@/components/icons";
import { JanelaInfo } from "@/components/janela";
import { Abas, BarraFiltros, CabecalhoPagina, CorpoPagina, Indicador, Pagina, Painel } from "@/components/pagina";
import { fmtDateBR } from "@/lib/format";
import { diasEntre, faixaDe, FAIXAS_PADRAO, nomePosicao, round2 } from "@/lib/os-agr";
import { podeEditar } from "@/lib/permissoes";
import { ehBooleano, ehTexto, usarPersistido } from "@/lib/usar-persistido";

import { Barra, Secao, Vazio, nf } from "@/app/(app)/painel/blocos";
import { BarraFiltrosOS, BotaoExportar, BotaoImportarOS, SeloPosicao, paramsDosFiltros, usarFiltrosOS, usarOpcoesOS } from "./comum";

const AZUL = "#2E5FA8";
const VERDE = "#5D9E48";
const LARANJA = "#D77B38";
const VERMELHO = "#BE3132";
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const pct = (a, b) => (b > 0 ? `${Math.round((a / b) * 100)}%` : "–");
const int = (n) => n.toLocaleString("pt-BR");
const data = (iso) => (iso ? fmtDateBR(iso) : "");

/** Lista de Ordens de Serviço (os filtros comuns às duas telas ficam lembrados entre elas). */
const ORDENS = "/acompanhamentos/os-agricola/ordens";

export default function PainelOSClient({ perfil }) {
  const [f, setF] = usarFiltrosOS();
  const [versao, setVersao] = useState(0);
  const opcoes = usarOpcoesOS(versao);
  const [d, setD] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(null);
  /** janela (detalhe) da caixa aberta: total, aberto, encerradas, area, vencidas, prazo */
  const [janela, setJanela] = useState(null);
  const carga = usarOrdensDoFiltro(f, versao, !!janela);
  // filtros próprios da lista de Ordens de Serviço (guardados neste navegador, com as mesmas chaves de lá): os links das
  // janelas abrem a lista só com a faixa de dias ou só com o prazo vencido, sem a busca que tivesse ficado de antes
  const [, setFaixaOrdens] = usarPersistido("os-agr.ordens.faixa", "", ehTexto);
  const [, setVencidasOrdens] = usarPersistido("os-agr.ordens.atrasadas", false, ehBooleano);
  const [, setBuscaOrdens] = usarPersistido("os-agr.ordens.busca", "", ehTexto);

  useEffect(() => {
    let ativo = true;
    setCarregando(true);
    const p = paramsDosFiltros(f);
    p.set("painel", "1");
    fetch(`/api/os-agricola?${p}`, { cache: "no-store" })
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (!ativo) return;
        if (ok) {
          setD(j);
          setErro(null);
        } else setErro(j.error ?? "Não foi possível carregar o painel.");
      })
      .catch(() => ativo && setErro("Não foi possível carregar o painel."))
      .finally(() => ativo && setCarregando(false));
    return () => {
      ativo = false;
    };
  }, [f, versao]);

  const semBase = opcoes && opcoes.ordens === 0;
  const maxFaixa = Math.max(1, ...(d?.faixas.map((x) => x.ordens) ?? [0]));
  const emAberto = d ? d.abertas + d.liberadas : 0;
  /** `d` é do filtro atual: as janelas das caixas podem abrir */
  const pronto = !carregando && !erro;

  const cards = d && [
    { k: "total", cor: "azul", icone: <IconOrdemServico size={16} />, rotulo: "O.S. no filtro", valor: int(d.total), apoio: `${nf(d.areaRec)} ha recomendados` },
    {
      k: "aberto",
      cor: "laranja",
      icone: <IconCamadas size={16} />,
      rotulo: "Em aberto",
      valor: int(emAberto),
      apoio: `${int(d.abertas)} abertas · ${int(d.liberadas)} liberadas`,
    },
    { k: "encerradas", cor: "verde", icone: <IconGrafico size={16} />, rotulo: "Encerradas", valor: int(d.encerradas), apoio: `${pct(d.encerradas, d.total)} das O.S.` },
    {
      k: "area",
      cor: "verde",
      icone: <IconCamadas size={16} />,
      rotulo: "Área encerrada",
      valor: nf(d.areaRecEncerrada),
      unidade: "ha",
      apoio: `${pct(d.areaRecEncerrada, d.areaRec)} da área recomendada`,
    },
    {
      k: "vencidas",
      cor: "vermelho",
      icone: <IconAlerta size={16} />,
      rotulo: "Prazo vencido",
      valor: int(d.atrasadas),
      apoio: "Em aberto com o prazo (data da O.S. + 7 dias) antes de hoje",
    },
    {
      k: "prazo",
      cor: "cinza",
      icone: <IconRelogio size={16} />,
      rotulo: "Prazo médio",
      valor: d.mediaDiasEncerrar === null ? "–" : nf(d.mediaDiasEncerrar, 1),
      unidade: "dias",
      apoio: "Da data da O.S. ao encerramento",
    },
  ];

  // o que as janelas recebem da tela: filtros (subtítulo), dia da posição e as ações de filtrar / abrir a lista
  const base = d && {
    f,
    d,
    hoje: d.hoje,
    faixas: opcoes?.faixas?.length ? opcoes.faixas : FAIXAS_PADRAO,
    subtitulo: descreverFiltros(f, opcoes),
    onFechar: () => setJanela(null),
    // clique num item da janela: a tela passa a filtrar por ele (como nas tabelas do painel) e a janela fecha
    filtrar: (p) => {
      setF({ ...f, ...p });
      setJanela(null);
    },
    // antes de abrir a lista de Ordens de Serviço pela janela
    prepararOrdens: ({ faixa = "", vencidas = false } = {}) => {
      setFaixaOrdens(faixa);
      setVencidasOrdens(vencidas);
      setBuscaOrdens("");
    },
  };

  return (
    <Pagina>
      <CabecalhoPagina
        titulo="Dashboard"
        categoria="Ordem de Serviço Agr."
        info={opcoes?.ultimaImportacao && <span>Base atualizada em {opcoes.ultimaImportacao}</span>}
        comandos={podeEditar(perfil) && <BotaoImportarOS onImportado={() => setVersao((v) => v + 1)} />}
      />

      <CorpoPagina>
        <BarraFiltros>
          <BarraFiltrosOS f={f} setF={setF} opcoes={opcoes} />
        </BarraFiltros>

        {erro && <p className="mb-4 rounded-md border border-alert-500/40 bg-alert-50 px-3 py-2 text-[12.5px] text-alert-700">{erro}</p>}
        {semBase && <Vazio texto='A base de O.S. ainda está vazia. Use "Importar O.S." com o relatório OS - Ordem de Serviço (PDF) do ERP.' />}

        {d && !semBase && (
          <div className={`space-y-8 transition-opacity ${carregando ? "opacity-60" : ""}`}>
            {/* cada caixa abre a janela com as O.S. que formam o número (mesmos filtros); enquanto o painel recarrega, ou se
                ele não carregou, as caixas ainda são do filtro anterior e a janela (que busca pelo filtro atual) não abre */}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
              {cards.map((c) => (
                <button
                  key={c.k}
                  type="button"
                  onClick={() => pronto && setJanela(c.k)}
                  disabled={!pronto}
                  className="min-w-0 rounded-xl2 text-left transition enabled:hover:-translate-y-px disabled:cursor-default focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-500"
                  title={pronto ? "Ver o detalhe" : erro ? "O painel não carregou com o filtro atual" : "Atualizando o painel…"}
                >
                  <Indicador cor={c.cor} icone={c.icone} rotulo={c.rotulo} valor={c.valor} unidade={c.unidade} apoio={c.apoio} className="h-full" />
                </button>
              ))}
            </div>

            <div className="grid gap-4 lg:grid-cols-5">
              <Painel
                titulo="O.S. em aberto por faixa de dias"
                subtitulo={`Dias desde a data da O.S. até hoje (${fmtDateBR(d.hoje)})`}
                acoes={
                  <Link href="/acompanhamentos/os-agricola/faixas-dias" className="text-[12px] text-muted hover:text-ink">
                    Editar faixas
                  </Link>
                }
                className="lg:col-span-2"
              >
                {emAberto === 0 ? (
                  <Vazio texto="Nenhuma O.S. em aberto no filtro." />
                ) : (
                  <div className="space-y-3">
                    {d.faixas.map((x, i) => (
                      <Link
                        key={x.descricao}
                        href={`/acompanhamentos/os-agricola/ordens?faixa=${encodeURIComponent(x.descricao)}`}
                        className="group block rounded-md px-1 py-0.5 hover:bg-surface"
                      >
                        <div className="mb-1 flex items-baseline justify-between gap-3 text-[12.5px]">
                          <span className="text-ink group-hover:underline">{x.descricao}</span>
                          <span className="tabular text-ink">
                            {int(x.ordens)} <span className="text-[11px] text-muted">O.S. · {nf(x.areaRec)} ha</span>
                          </span>
                        </div>
                        <Barra valor={x.ordens / maxFaixa} cor={[VERDE, "#D9A21B", LARANJA, VERMELHO][Math.min(i, 3)]} altura={6} />
                      </Link>
                    ))}
                  </div>
                )}
              </Painel>
              <Painel
                titulo="Emitidas e encerradas por mês"
                subtitulo="Quantidade de O.S. pela data da O.S. e pela data de encerramento"
                className="lg:col-span-3"
              >
                <GraficoMeses meses={d.porMes.slice(-12)} />
              </Painel>
            </div>

            <Secao titulo="Por solicitante" subtitulo="Responsável da O.S., com a área do Cadastro Responsáveis">
              <div className="grid gap-4 2xl:grid-cols-3">
                <div className="min-w-0 2xl:col-span-2">
                  <TabelaGrupo linhas={d.porSolicitante} rotulo="Solicitante" comArea filtro={(l) => ({ resp: l.chave })} setF={(p) => setF({ ...f, ...p })} />
                </div>
                <Painel titulo="Por área" subtitulo="Somando os solicitantes de cada área">
                  <div className="space-y-3">
                    {d.porArea.map((a) => (
                      <div key={a.chave}>
                        <div className="mb-1 flex items-baseline justify-between gap-3 text-[12.5px]">
                          <span className="truncate text-ink">{a.nome}</span>
                          <span className="tabular flex-shrink-0 text-ink">
                            {int(a.ordens)} <span className="text-[11px] text-muted">O.S. · {pct(a.encerradas, a.ordens)} encerr.</span>
                          </span>
                        </div>
                        <Barra valor={a.ordens / Math.max(1, d.porArea[0]?.ordens ?? 1)} cor={AZUL} altura={5} />
                      </div>
                    ))}
                  </div>
                </Painel>
              </div>
            </Secao>

            <Secao titulo="Por operação" subtitulo="Operações agrícolas das O.S. (uma O.S. pode ter mais de uma)">
              <TabelaGrupo
                linhas={d.porOperacao}
                rotulo="Operação"
                mostrarCodigo
                limite={15}
                filtro={(l) => ({ op: [l.chave] })}
                setF={(p) => setF({ ...f, ...p })}
              />
            </Secao>

            <Secao titulo="Por etapa">
              <TabelaGrupo linhas={d.porEtapa} rotulo="Etapa" mostrarCodigo filtro={(l) => ({ etapa: l.chave })} setF={(p) => setF({ ...f, ...p })} />
            </Secao>

            <p className="text-[11.5px] text-muted">
              Clique numa caixa para ver as O.S. que formam o número. Em aberto = posição Aberta ou Liberada. Área = área recomendada total dos talhões da
              O.S. Prazo vencido = O.S. em aberto com o prazo (data da O.S. + 7 dias) anterior a hoje. Período e safra filtram pela data e pela safra da O.S. Operação e
              fazenda trazem só as O.S. com as operações e as fazendas escolhidas, e a área conta só os talhões delas.
            </p>
          </div>
        )}
      </CorpoPagina>
      {base && janela === "total" && <JanelaTotal carga={carga} base={base} />}
      {base && janela === "aberto" && <JanelaEmAberto carga={carga} base={base} />}
      {base && janela === "encerradas" && <JanelaEncerradas carga={carga} base={base} />}
      {base && janela === "area" && <JanelaAreaEncerrada carga={carga} base={base} />}
      {base && janela === "vencidas" && <JanelaVencidas carga={carga} base={base} />}
      {base && janela === "prazo" && <JanelaPrazo carga={carga} base={base} />}
    </Pagina>
  );
}

function TabelaGrupo({ linhas, rotulo, comArea, mostrarCodigo, limite, filtro, setF }) {
  const [todas, setTodas] = useState(false);
  const vis = limite && !todas ? linhas.slice(0, limite) : linhas;
  const tot = linhas.reduce(
    (a, l) => ({
      ordens: a.ordens + l.ordens,
      aberto: a.aberto + l.abertas + l.liberadas,
      enc: a.enc + l.encerradas,
      area: a.area + l.areaRec,
      atrasadas: a.atrasadas + l.atrasadas,
    }),
    { ordens: 0, aberto: 0, enc: 0, area: 0, atrasadas: 0 },
  );
  if (linhas.length === 0) return <Vazio texto="Nada no filtro." />;
  return (
    <div className="overflow-hidden rounded-xl2 border border-line bg-card shadow-card">
      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="border-b border-line bg-surface text-left text-muted">
              <th className="px-3 py-2 font-medium">{rotulo}</th>
              {comArea && <th className="px-3 py-2 font-medium">Área</th>}
              <th className="px-3 py-2 text-right font-medium">O.S.</th>
              <th className="px-3 py-2 text-right font-medium">Em aberto</th>
              <th className="px-3 py-2 text-right font-medium">Prev. vencida</th>
              <th className="px-3 py-2 text-right font-medium">Encerradas</th>
              <th className="min-w-[140px] px-3 py-2 font-medium">% encerrada</th>
              <th className="px-3 py-2 text-right font-medium">Área rec. (ha)</th>
              <th className="px-3 py-2 text-right font-medium">Prazo médio (dias)</th>
            </tr>
          </thead>
          <tbody>
            {vis.map((l) => {
              const p = l.ordens > 0 ? l.encerradas / l.ordens : 0;
              return (
                <tr key={l.chave || "-"} className="border-t border-line/60">
                  <td className="min-w-[200px] px-3 py-1.5 text-ink">
                    {filtro && setF && l.chave ? (
                      <button type="button" onClick={() => setF(filtro(l))} className="text-left hover:underline" title="Filtrar por este item">
                        {mostrarCodigo && l.chave ? <span className="tabular text-muted">{l.chave} · </span> : null}
                        {l.nome}
                      </button>
                    ) : (
                      <>
                        {mostrarCodigo && l.chave ? <span className="tabular text-muted">{l.chave} · </span> : null}
                        {l.nome}
                      </>
                    )}
                  </td>
                  {comArea && <td className="whitespace-nowrap px-3 py-1.5 text-muted">{l.area || "–"}</td>}
                  <td className="px-3 py-1.5 text-right tabular text-ink">{int(l.ordens)}</td>
                  <td className="px-3 py-1.5 text-right tabular text-ink">{l.abertas + l.liberadas ? int(l.abertas + l.liberadas) : "–"}</td>
                  <td className="px-3 py-1.5 text-right tabular" style={{ color: l.atrasadas ? VERMELHO : undefined }}>
                    {l.atrasadas ? int(l.atrasadas) : "–"}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular text-ink">{l.encerradas ? int(l.encerradas) : "–"}</td>
                  <td className="px-3 py-1.5">
                    <div className="flex items-center gap-2">
                      <div className="flex-1">
                        <Barra valor={p} cor={p >= 0.9 ? VERDE : p >= 0.6 ? "#D9A21B" : LARANJA} altura={5} />
                      </div>
                      <span className="w-9 text-right tabular text-[11.5px] text-muted">{pct(l.encerradas, l.ordens)}</span>
                    </div>
                  </td>
                  <td className="px-3 py-1.5 text-right tabular text-ink">{nf(l.areaRec)}</td>
                  <td className="px-3 py-1.5 text-right tabular text-ink">{l.mediaDias === null ? "–" : nf(l.mediaDias, 1)}</td>
                </tr>
              );
            })}
            <tr className="border-t border-line bg-surface font-semibold text-ink">
              <td className="px-3 py-1.5" colSpan={comArea ? 2 : 1}>
                Total
              </td>
              <td className="px-3 py-1.5 text-right tabular">{int(tot.ordens)}</td>
              <td className="px-3 py-1.5 text-right tabular">{int(tot.aberto)}</td>
              <td className="px-3 py-1.5 text-right tabular">{int(tot.atrasadas)}</td>
              <td className="px-3 py-1.5 text-right tabular">{int(tot.enc)}</td>
              <td className="px-3 py-1.5 tabular text-[11.5px] text-muted">{pct(tot.enc, tot.ordens)}</td>
              <td className="px-3 py-1.5 text-right tabular">{nf(tot.area)}</td>
              <td className="px-3 py-1.5" />
            </tr>
          </tbody>
        </table>
      </div>
      {limite && linhas.length > limite && (
        <button
          type="button"
          onClick={() => setTodas((t) => !t)}
          className="w-full border-t border-line px-3 py-2 text-[12px] text-muted hover:bg-surface hover:text-ink"
        >
          {todas ? "Mostrar só as 15 maiores" : `Mostrar todas (${linhas.length})`}
        </button>
      )}
    </div>
  );
}

function GraficoMeses({ meses }) {
  if (meses.length === 0) return <Vazio texto="Sem O.S. no filtro." />;
  const max = Math.max(1, ...meses.flatMap((m) => [m.emitidas, m.encerradas]));
  return (
    <div>
      <div className="flex h-44 items-end gap-2">
        {meses.map((m) => (
          <div key={m.mes} className="flex h-full min-w-0 flex-1 flex-col justify-end">
            <div className="flex flex-1 items-end justify-center gap-[3px]">
              {[
                [m.emitidas, AZUL, "emitidas"],
                [m.encerradas, VERDE, "encerradas"],
              ].map(([v, cor, nome]) => (
                <div key={nome} className="flex w-1/2 max-w-[18px] flex-col items-center justify-end" title={`${v} ${nome}`}>
                  <span className="mb-0.5 text-[10px] tabular text-muted">{Number(v) || ""}</span>
                  <div className="w-full rounded-t-[3px]" style={{ height: `${(Number(v) / max) * 120}px`, background: cor }} />
                </div>
              ))}
            </div>
            <div className="mt-1.5 border-t border-line pt-1 text-center text-[10.5px] text-muted">
              {MESES[Number(m.mes.slice(5, 7)) - 1]}/{m.mes.slice(2, 4)}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex gap-4 text-[11.5px] text-muted">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: AZUL }} />
          Emitidas
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: VERDE }} />
          Encerradas
        </span>
      </div>
    </div>
  );
}

/* ---------- Janelas das caixas: o detalhe calculado das mesmas O.S. do filtro que formam cada número ---------- */

const SEM_ORDENS = [];
/** Em aberto nas caixas: posição Aberta ou Liberada (o painel conta o resto como encerrada). */
const ehEmAberto = (o) => o.posicao === "A" || o.posicao === "L";
const somaArea = (ls) => round2(ls.reduce((a, o) => a + o.areaRec, 0));
const somaTalhoes = (ls) => ls.reduce((a, o) => a + o.nTlh, 0);
/** média de dias com uma casa, como no painel */
const media = (dias) => (dias.length ? Math.round((dias.reduce((a, b) => a + b, 0) / dias.length) * 10) / 10 : null);
const pct1 = (v, total) => (total > 0 ? Math.round((v / total) * 1000) / 10 : null);
const qtd = (n, um, varios) => `${int(n)} ${n === 1 ? um : varios}`;
/** solicitante como no painel: sem código (ou "0") = sem responsável */
const chaveResp = (o) => (o.respCod && o.respCod !== "0" ? o.respCod : "");
const ORDEM_POSICAO = { A: 0, L: 1, E: 2 };
const nomeMes = (m) => (m ? `${MESES[Number(m.slice(5, 7)) - 1]}/${m.slice(0, 4)}` : "Sem data de encerramento");

/**
 * Todas as O.S. do filtro, uma por O.S. (a mesma lista da tela Ordens de Serviço, `todos=1`, com os mesmos filtros do
 * painel): só carrega quando uma janela abre e fica guardada até o filtro mudar ou a base ser reimportada.
 */
function usarOrdensDoFiltro(f, versao, ativo) {
  const chave = JSON.stringify([f, versao]);
  const [estado, setEstado] = useState({ chave: null, ordens: null, erro: null });
  useEffect(() => {
    if (!ativo || (estado.chave === chave && estado.ordens)) return;
    let vivo = true;
    setEstado({ chave, ordens: null, erro: null });
    const p = paramsDosFiltros(f);
    p.set("todos", "1");
    fetch(`/api/os-agricola?${p}`, { cache: "no-store" })
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (!vivo) return;
        setEstado(ok ? { chave, ordens: j.ordens, erro: null } : { chave, ordens: null, erro: j.error ?? "Não foi possível carregar as O.S." });
      })
      .catch(() => vivo && setEstado({ chave, ordens: null, erro: "Não foi possível carregar as O.S." }));
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ativo, chave]);
  return estado.chave === chave ? estado : { chave, ordens: null, erro: null };
}

/** Subtítulo das janelas: os filtros da tela que formaram os números. */
function descreverFiltros(f, opcoes) {
  const nome = (lista, cod) => lista?.find((x) => x.cod === cod)?.nome;
  const comNome = (lista, cod) => (nome(lista, cod) ? `${cod} · ${nome(lista, cod)}` : cod);
  const partes = [
    f.de && f.ate
      ? `data da O.S. de ${fmtDateBR(f.de)} a ${fmtDateBR(f.ate)}`
      : f.de
        ? `data da O.S. a partir de ${fmtDateBR(f.de)}`
        : f.ate
          ? `data da O.S. até ${fmtDateBR(f.ate)}`
          : "",
    f.safra && `safra ${f.safra}`,
    f.posicao && `posição ${f.posicao === "aberto" ? "em aberto" : nomePosicao(f.posicao).toLowerCase()}`,
    f.resp && `solicitante ${nome(opcoes?.responsaveis, f.resp) ?? f.resp}`,
    f.etapa && `etapa ${comNome(opcoes?.etapas, f.etapa)}`,
    f.op.length === 1 ? `operação ${comNome(opcoes?.operacoes, f.op[0])}` : f.op.length > 1 ? `${int(f.op.length)} operações` : "",
    f.faz.length === 1 ? `fazenda ${comNome(opcoes?.fazendas, f.faz[0])}` : f.faz.length > 1 ? `${int(f.faz.length)} fazendas` : "",
  ].filter(Boolean);
  return partes.length ? `Filtro: ${partes.join(" · ")}` : "Sem filtro: todas as O.S. da base";
}

/** Valor na tela: área em ha (2 casas), contagem, percentual e dias (1 casa), código ou texto; vazio = "–". */
function formatar(num, v) {
  if (v === null || v === undefined || v === "") return "–";
  if (num === "int") return int(v);
  if (num === "pct") return `${nf(v, 1)}%`;
  if (num === "ha") return nf(v);
  if (num === "dias") return nf(v, 1);
  return v;
}

/**
 * Tabela das janelas: cabeçalho, números à direita e linha de total (fica no fim ao ordenar pelo título da coluna).
 * Coluna: { rotulo, valor(l) (o que vai para a planilha), num ("ha", "int", "pct", "dias", "cod" = à direita), exibir(l)
 * (o que aparece, se diferente do valor), classe(l), dica(l), total }. Com `limite`, mostra as primeiras linhas e um
 * botão para ver todas (o total e o Exportar contam sempre todas).
 */
function TabelaJanela({ colunas, linhas, chave, vazio = "Nenhuma O.S. no filtro.", rotuloTotal = "Total", limite }) {
  const [todas, setTodas] = useState(false);
  const inicioTotal = colunas.findIndex((c) => c.total !== undefined);
  const corta = !!limite && linhas.length > limite;
  const mostradas = corta && !todas ? linhas.slice(0, limite) : linhas;
  return (
    <div className="overflow-hidden rounded-lg border border-line">
      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="whitespace-nowrap border-b border-line bg-surface text-left text-muted">
              {colunas.map((c) => (
                <th key={c.rotulo} className={`px-3 py-2 font-medium ${c.num ? "text-right" : ""}`}>
                  {c.rotulo}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {mostradas.map((l) => (
              <tr key={chave(l)} className="border-t border-line/60 hover:bg-surface/60">
                {colunas.map((c) => (
                  <td key={c.rotulo} className={`px-3 py-1.5 ${c.num ? "text-right tabular" : ""} ${c.classe?.(l) ?? "text-ink"}`} title={c.dica?.(l)}>
                    {c.exibir ? c.exibir(l) : formatar(c.num, c.valor(l))}
                  </td>
                ))}
              </tr>
            ))}
            {linhas.length === 0 && (
              <tr>
                <td colSpan={colunas.length} className="px-4 py-8 text-center text-muted">
                  {vazio}
                </td>
              </tr>
            )}
            {linhas.length > 0 && inicioTotal > 0 && (
              <tr className="bg-navy-900 font-semibold text-white">
                <td colSpan={inicioTotal} className="whitespace-nowrap px-3 py-2">
                  {rotuloTotal}
                </td>
                {colunas.slice(inicioTotal).map((c) => (
                  <td key={c.rotulo} className={`px-3 py-2 ${c.num ? "text-right tabular" : ""}`}>
                    {c.total === undefined ? "" : formatar(c.num, c.total)}
                  </td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {corta && (
        <button
          type="button"
          onClick={() => setTodas((t) => !t)}
          className="w-full border-t border-line px-3 py-2 text-[12px] text-muted hover:bg-surface hover:text-ink"
        >
          {todas
            ? `Mostrar só as ${int(limite)} primeiras`
            : `Mostrando ${int(limite)} de ${int(linhas.length)} · mostrar todas (o total e o Exportar já contam todas)`}
        </button>
      )}
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

function SecaoJanela({ titulo, children }) {
  return (
    <div className="mt-5">
      <div className="mb-1.5 text-[12.5px] font-medium text-ink">{titulo}</div>
      {children}
    </div>
  );
}

/** Item da janela que aplica o filtro na tela (como os itens das tabelas do painel). */
function BotaoFiltro({ onClick, title = "Filtrar a tela por este item", children }) {
  return (
    <button type="button" onClick={onClick} className="text-left text-[#2E5FA8] hover:underline" title={title}>
      {children}
    </button>
  );
}

const ACAO_RODAPE = "rounded-md px-2 py-1 text-[12.5px] font-medium text-[#2E5FA8] hover:bg-[#2E5FA8]/[0.06]";

/**
 * Link para a lista de Ordens de Serviço: mesmos filtros comuns e, lá, só a faixa de dias ou só o prazo vencido.
 * Faixa, prazo vencido e busca limpa vão para os filtros guardados da lista no clique (também com Ctrl) e no clique do
 * meio. A faixa vai ainda no endereço (?faixa=, como nas faixas do painel), para valer também pelo "Abrir em nova aba" do
 * botão direito; lá o endereço põe a posição em "em aberto", o que só equivale às O.S. da janela com a tela em Todas ou Em
 * aberto (em Aberta ou Liberada ampliaria para as duas, e a faixa fica só no clique).
 */
function LinkOrdens({ base, faixa, vencidas, className = ACAO_RODAPE, title, children }) {
  const pelaUrl = faixa && (base.f.posicao === "" || base.f.posicao === "aberto");
  const preparar = () => base.prepararOrdens({ faixa, vencidas });
  return (
    <Link
      href={pelaUrl ? `${ORDENS}?faixa=${encodeURIComponent(faixa)}` : ORDENS}
      onClick={preparar}
      onAuxClick={(e) => e.button === 1 && preparar()}
      className={className}
      title={title}
    >
      {children}
    </Link>
  );
}

/**
 * Botão do rodapé que filtra a tela pela posição. Nada (a janela fica sem rodapé) se a tela já filtra por ela ou por uma
 * parte dela (`jaAtende`: em Aberta ou Liberada a tela já é só em aberto, e o botão ampliaria o filtro em vez de restringir).
 */
const filtrarPosicao = (base, posicao, texto, jaAtende = [posicao]) =>
  jaAtende.includes(base.f.posicao) ? null : (
    <button type="button" onClick={() => base.filtrar({ posicao })} className={ACAO_RODAPE}>
      {texto}
    </button>
  );

/** Botão de exportar uma tabela da janela (só o rótulo e o valor de cada coluna); sem linhas, nada. */
const exportarTabela = ({ nome, colunas, linhas }) =>
  linhas.length > 0 && (
    <BotaoExportar nome={`Dashboard OS - ${nome}`} colunas={colunas.map(({ rotulo, valor }) => ({ rotulo, valor }))} buscar={async () => linhas} />
  );

/** As mesmas colunas da exportação da tela Ordens de Serviço (`extra` entra depois do prazo). */
const colunasPlanilhaOS = (extra = []) => [
  { rotulo: "O.S.", valor: (o) => Number(o.os) || o.os },
  { rotulo: "Data da O.S.", valor: (o) => data(o.dtOs) },
  { rotulo: "Prazo (data da O.S. + 7 dias)", valor: (o) => data(o.prevFim) },
  ...extra,
  { rotulo: "Encerramento", valor: (o) => data(o.dtEnc) },
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
  { rotulo: "Área recomendada (ha)", valor: (o) => o.areaRec },
  { rotulo: "Safra", valor: (o) => o.safra },
  { rotulo: "Lançada por", valor: (o) => o.usrOs },
];

/** Primeiro item (operação ou fazenda) e "+n" com os demais na dica. */
function PrimeiroMais({ itens }) {
  if (itens.length === 0) return "–";
  return (
    <>
      {itens[0]}
      {itens.length > 1 && (
        <span className="ml-1 text-[11px] text-muted" title={itens.slice(1).join("\n")}>
          +{itens.length - 1}
        </span>
      )}
    </>
  );
}

/** Colunas da lista de O.S. na janela; `semEncerramento` nas listas só de O.S. em aberto; `extra` depois do prazo. */
function colunasListaOS(ordens, { semEncerramento = false, extra = [] } = {}) {
  return [
    { rotulo: "O.S.", num: "cod", valor: (o) => o.os, classe: () => "font-medium text-ink" },
    { rotulo: "Data", valor: (o) => data(o.dtOs), classe: () => "whitespace-nowrap text-ink" },
    { rotulo: "Posição", valor: (o) => nomePosicao(o.posicao), exibir: (o) => <SeloPosicao p={o.posicao} /> },
    { rotulo: "Dias", num: "int", valor: (o) => o.dias, dica: (o) => o.faixa || undefined },
    {
      rotulo: "Prazo",
      valor: (o) => data(o.prevFim),
      classe: (o) => `whitespace-nowrap ${o.atrasada ? "font-medium text-[#BE3132]" : "text-ink"}`,
    },
    ...extra,
    ...(semEncerramento ? [] : [{ rotulo: "Encerramento", valor: (o) => data(o.dtEnc), classe: () => "whitespace-nowrap text-ink" }]),
    {
      rotulo: "Operação",
      valor: (o) => o.operacoes.map((x) => `${x.cod} · ${x.ds}`).join(" | "),
      exibir: (o) => <PrimeiroMais itens={o.operacoes.map((x) => `${x.cod} · ${x.ds}`)} />,
      classe: () => "min-w-[200px] text-ink",
    },
    { rotulo: "Solicitante", valor: (o) => o.respNm, classe: () => "whitespace-nowrap text-ink" },
    { rotulo: "Fazenda", valor: (o) => o.fazendas.join(" | "), exibir: (o) => <PrimeiroMais itens={o.fazendas} />, classe: () => "min-w-[160px] text-ink" },
    { rotulo: "Talhões", num: "int", valor: (o) => o.nTlh, total: somaTalhoes(ordens) },
    { rotulo: "Área rec. (ha)", num: "ha", valor: (o) => o.areaRec, total: somaArea(ordens) },
  ];
}

/** Lista das O.S. de uma janela (as primeiras 300 na tela; o total e o Exportar contam todas). */
function ListaOS({ titulo, ordens, colunas }) {
  return (
    <SecaoJanela titulo={`${titulo} · ${int(ordens.length)}`}>
      <TabelaJanela colunas={colunas} linhas={ordens} chave={(o) => `${o.emp}|${o.os}`} limite={300} rotuloTotal={`Total · ${int(ordens.length)} O.S.`} />
    </SecaoJanela>
  );
}

/**
 * Moldura das janelas: filtros no subtítulo, exportar a lista (ou a tabela principal) no topo e as ações no rodapé.
 * Enquanto as O.S. do filtro carregam, a janela já abre com o aviso.
 */
function JanelaCard({ titulo, base, carga, exportar, rodape, largura = "6xl", children }) {
  return (
    <JanelaInfo
      titulo={titulo}
      subtitulo={base.subtitulo}
      largura={largura}
      onFechar={base.onFechar}
      acoes={carga.ordens && exportar ? exportarTabela(exportar) : null}
      rodape={carga.ordens ? rodape : undefined}
    >
      {carga.ordens ? (
        children
      ) : carga.erro ? (
        <p className="rounded-md border border-alert-500/40 bg-alert-50 px-3 py-2 text-[12.5px] text-alert-700">{carga.erro}</p>
      ) : (
        <p className="py-8 text-center text-[12.5px] text-muted">Carregando as O.S. do filtro…</p>
      )}
    </JanelaInfo>
  );
}

/** Caixa O.S. no filtro: as O.S. por posição e a lista de todas. */
function JanelaTotal({ carga, base }) {
  const ordens = carga.ordens ?? SEM_ORDENS;
  const porPosicao = useMemo(() => {
    const m = new Map();
    for (const o of ordens) {
      if (!m.has(o.posicao)) m.set(o.posicao, []);
      m.get(o.posicao).push(o);
    }
    return [...m]
      .map(([chave, ls]) => ({ chave, ordens: ls.length, talhoes: somaTalhoes(ls), areaRec: somaArea(ls) }))
      .sort((a, b) => (ORDEM_POSICAO[a.chave] ?? 9) - (ORDEM_POSICAO[b.chave] ?? 9));
  }, [ordens]);
  const colunas = [
    {
      rotulo: "Posição",
      valor: (x) => nomePosicao(x.chave),
      exibir: (x) =>
        ["A", "L", "E"].includes(x.chave) ? (
          <BotaoFiltro onClick={() => base.filtrar({ posicao: x.chave })} title="Filtrar a tela por esta posição">
            {nomePosicao(x.chave)}
          </BotaoFiltro>
        ) : (
          nomePosicao(x.chave)
        ),
    },
    { rotulo: "O.S.", num: "int", valor: (x) => x.ordens, total: ordens.length },
    { rotulo: "% das O.S.", num: "pct", valor: (x) => pct1(x.ordens, ordens.length), total: ordens.length ? 100 : null, classe: () => "text-muted" },
    { rotulo: "Talhões", num: "int", valor: (x) => x.talhoes, total: somaTalhoes(ordens) },
    { rotulo: "Área rec. (ha)", num: "ha", valor: (x) => x.areaRec, total: somaArea(ordens) },
  ];
  return (
    <JanelaCard
      titulo="O.S. no filtro"
      base={base}
      carga={carga}
      exportar={{ nome: "O.S. no filtro", colunas: colunasPlanilhaOS(), linhas: ordens }}
      rodape={
        <>
          <span className="mr-auto text-[11.5px] text-muted">Na lista de Ordens de Serviço dá para abrir os talhões de cada O.S.</span>
          <LinkOrdens base={base}>Ver em Ordens de Serviço</LinkOrdens>
        </>
      }
    >
      <Nota>
        {qtd(ordens.length, "O.S.", "O.S.")} com {qtd(somaTalhoes(ordens), "talhão", "talhões")} e {nf(somaArea(ordens))} ha recomendados. Clique numa
        posição para filtrar a tela por ela.
      </Nota>
      <TabelaJanela colunas={colunas} linhas={porPosicao} chave={(x) => x.chave || "sem"} />
      <ListaOS titulo="O.S. no filtro" ordens={ordens} colunas={colunasListaOS(ordens)} />
    </JanelaCard>
  );
}

/** Caixa Em aberto: as O.S. abertas e liberadas por faixa de dias (como o painel) e a lista, das mais antigas. */
function JanelaEmAberto({ carga, base }) {
  const ordens = carga.ordens ?? SEM_ORDENS;
  const { abertas, porFaixa } = useMemo(() => {
    const abertas = ordens.filter(ehEmAberto).sort((a, b) => (b.dias ?? -1) - (a.dias ?? -1));
    const m = new Map(base.d.faixas.map((x) => [x.descricao, []]));
    for (const o of abertas) {
      const k = o.faixa || "";
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(o);
    }
    const porFaixa = [...m].map(([chave, ls]) => ({
      chave,
      ordens: ls.length,
      A: ls.filter((o) => o.posicao === "A").length,
      L: ls.filter((o) => o.posicao === "L").length,
      vencidas: ls.filter((o) => o.atrasada).length,
      areaRec: somaArea(ls),
    }));
    return { abertas, porFaixa };
  }, [ordens, base.d.faixas]);
  const conta = (p) => abertas.filter((o) => o.posicao === p).length;
  const colunas = [
    {
      rotulo: "Faixa de dias",
      valor: (x) => x.chave || "Sem faixa de dias",
      exibir: (x) =>
        x.chave && x.ordens > 0 ? (
          <LinkOrdens base={base} faixa={x.chave} className="text-[#2E5FA8] hover:underline" title="Ver as O.S. desta faixa em Ordens de Serviço">
            {x.chave}
          </LinkOrdens>
        ) : (
          x.chave || "Sem faixa de dias"
        ),
      classe: (x) => (x.chave ? "text-ink" : "text-amber-700"),
      dica: (x) => (x.chave ? undefined : "O.S. sem a data da O.S. ou com os dias fora das faixas cadastradas"),
    },
    { rotulo: "O.S.", num: "int", valor: (x) => x.ordens, total: abertas.length },
    { rotulo: "Abertas", num: "int", valor: (x) => x.A, total: conta("A") },
    { rotulo: "Liberadas", num: "int", valor: (x) => x.L, total: conta("L") },
    {
      rotulo: "Prev. vencida",
      num: "int",
      valor: (x) => x.vencidas,
      total: abertas.filter((o) => o.atrasada).length,
      classe: (x) => (x.vencidas ? "text-[#BE3132]" : "text-ink"),
    },
    { rotulo: "Área rec. (ha)", num: "ha", valor: (x) => x.areaRec, total: somaArea(abertas) },
  ];
  return (
    <JanelaCard
      titulo="Em aberto"
      base={base}
      carga={carga}
      exportar={{ nome: "Em aberto", colunas: colunasPlanilhaOS(), linhas: abertas }}
      rodape={filtrarPosicao(base, "aberto", "Filtrar a tela: só as O.S. em aberto", ["aberto", "A", "L"])}
    >
      <Nota>
        O.S. com a posição Aberta ou Liberada: {qtd(conta("A"), "aberta", "abertas")} e {qtd(conta("L"), "liberada", "liberadas")}, com{" "}
        {nf(somaArea(abertas))} ha recomendados. Dias desde a data da O.S. até hoje ({fmtDateBR(base.hoje)}). Clique numa faixa para ver as O.S. dela em
        Ordens de Serviço.
      </Nota>
      <TabelaJanela colunas={colunas} linhas={abertas.length ? porFaixa : []} chave={(x) => x.chave || "sem"} vazio="Nenhuma O.S. em aberto no filtro." />
      <ListaOS titulo="O.S. em aberto, das mais antigas" ordens={abertas} colunas={colunasListaOS(abertas, { semEncerramento: true })} />
    </JanelaCard>
  );
}

/** Caixa Encerradas: as O.S. por mês de encerramento, com o prazo médio, e a lista, das encerradas por último. */
function JanelaEncerradas({ carga, base }) {
  const ordens = carga.ordens ?? SEM_ORDENS;
  const { encerradas, porMes } = useMemo(() => {
    const encerradas = ordens.filter((o) => !ehEmAberto(o)).sort((a, b) => (b.dtEnc ?? "").localeCompare(a.dtEnc ?? ""));
    const m = new Map();
    for (const o of encerradas) {
      const k = o.dtEnc ? o.dtEnc.slice(0, 7) : "";
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(o);
    }
    const porMes = [...m]
      .map(([chave, ls]) => ({
        chave,
        ordens: ls.length,
        areaRec: somaArea(ls),
        prazo: media(ls.filter((o) => o.posicao === "E" && o.dias !== null).map((o) => o.dias)),
      }))
      .sort((a, b) => (!a.chave) - (!b.chave) || b.chave.localeCompare(a.chave));
    return { encerradas, porMes };
  }, [ordens]);
  const colunas = [
    { rotulo: "Mês de encerramento", valor: (x) => nomeMes(x.chave), classe: (x) => (x.chave ? "text-ink" : "text-amber-700") },
    { rotulo: "O.S.", num: "int", valor: (x) => x.ordens, total: encerradas.length },
    { rotulo: "% das encerradas", num: "pct", valor: (x) => pct1(x.ordens, encerradas.length), total: encerradas.length ? 100 : null, classe: () => "text-muted" },
    { rotulo: "Área rec. (ha)", num: "ha", valor: (x) => x.areaRec, total: somaArea(encerradas) },
    {
      rotulo: "Prazo médio (dias)",
      num: "dias",
      valor: (x) => x.prazo,
      total: media(encerradas.filter((o) => o.posicao === "E" && o.dias !== null).map((o) => o.dias)),
    },
  ];
  return (
    <JanelaCard
      titulo="Encerradas"
      base={base}
      carga={carga}
      exportar={{ nome: "Encerradas", colunas: colunasPlanilhaOS(), linhas: encerradas }}
      rodape={filtrarPosicao(base, "E", "Filtrar a tela: só as O.S. encerradas")}
    >
      <Nota>
        {qtd(encerradas.length, "O.S. encerrada", "O.S. encerradas")} de {qtd(ordens.length, "O.S.", "O.S.")} no filtro ({formatar("pct", pct1(encerradas.length, ordens.length))}),
        por mês da data de encerramento. Prazo médio = dias da data da O.S. ao encerramento.
      </Nota>
      <TabelaJanela colunas={colunas} linhas={porMes} chave={(x) => x.chave || "sem"} vazio="Nenhuma O.S. encerrada no filtro." />
      <ListaOS titulo="O.S. encerradas, das mais recentes" ordens={encerradas} colunas={colunasListaOS(encerradas)} />
    </JanelaCard>
  );
}

const ABAS_AREA = [
  { id: "op", label: "Por operação", nome: "operação" },
  { id: "etapa", label: "Por etapa", nome: "etapa" },
  { id: "resp", label: "Por solicitante", nome: "solicitante" },
];

/**
 * Caixa Área encerrada: a área recomendada e a encerrada (O.S. com posição Encerrada) por operação, etapa e solicitante.
 * Uma O.S. com mais de uma operação entra em cada uma com a área dela: a soma bate com a caixa.
 */
function JanelaAreaEncerrada({ carga, base }) {
  const [aba, setAba] = useState("op");
  const ordens = carga.ordens ?? SEM_ORDENS;
  const { d } = base;
  const grupos = useMemo(() => {
    // nomes como nas tabelas do painel (solicitante com o nome do Cadastro Responsáveis quando a O.S. não traz)
    const nomes = {
      op: new Map(d.porOperacao.map((x) => [x.chave, x.nome])),
      etapa: new Map(d.porEtapa.map((x) => [x.chave, x.nome])),
      resp: new Map(d.porSolicitante.map((x) => [x.chave, x.nome])),
    };
    const m = { op: new Map(), etapa: new Map(), resp: new Map() };
    const somar = (tipo, chave, nome, area, o) => {
      const x = m[tipo].get(chave) ?? { chave, nome: nomes[tipo].get(chave) ?? nome, areaRec: 0, areaEnc: 0, osEnc: 0 };
      x.areaRec += area;
      if (o.posicao === "E") {
        x.areaEnc += area;
        x.osEnc++;
      }
      m[tipo].set(chave, x);
    };
    for (const o of ordens) {
      for (const op of o.operacoes) somar("op", op.cod, op.ds || op.cod, op.areaRec, o);
      somar("etapa", o.etapaCod, o.etapaDs || o.etapaCod || "Sem etapa", o.areaRec, o);
      somar("resp", chaveResp(o), o.respNm || "Sem responsável", o.areaRec, o);
    }
    const lista = (mapa) =>
      [...mapa.values()]
        .map((x) => ({ ...x, areaRec: round2(x.areaRec), areaEnc: round2(x.areaEnc) }))
        .sort((a, b) => b.areaEnc - a.areaEnc || b.areaRec - a.areaRec);
    return { op: lista(m.op), etapa: lista(m.etapa), resp: lista(m.resp) };
  }, [ordens, d]);
  const encerradas = ordens.filter((o) => o.posicao === "E");
  const areaRec = somaArea(ordens);
  const areaEnc = somaArea(encerradas);
  const atual = ABAS_AREA.find((a) => a.id === aba);
  const comCodigo = aba !== "resp";
  const rotuloItem = (x) => (comCodigo && x.chave ? `${x.chave} · ${x.nome}` : x.nome);
  const filtroItem = (x) => (aba === "op" ? { op: [x.chave] } : aba === "etapa" ? { etapa: x.chave } : { resp: x.chave });
  const colunas = [
    {
      rotulo: atual.nome[0].toUpperCase() + atual.nome.slice(1),
      valor: rotuloItem,
      exibir: (x) =>
        x.chave ? (
          <BotaoFiltro onClick={() => base.filtrar(filtroItem(x))} title={`Filtrar a tela por ${aba === "resp" ? "este" : "esta"} ${atual.nome}`}>
            {comCodigo && <span className="tabular text-muted">{x.chave} · </span>}
            {x.nome}
          </BotaoFiltro>
        ) : (
          x.nome
        ),
      classe: () => "min-w-[220px] text-ink",
    },
    // uma O.S. pode ter mais de uma operação: por operação a contagem não soma o total
    { rotulo: "O.S. encerradas", num: "int", valor: (x) => x.osEnc, total: aba === "op" ? undefined : encerradas.length },
    { rotulo: "Área rec. (ha)", num: "ha", valor: (x) => x.areaRec, total: areaRec },
    { rotulo: "Área encerrada (ha)", num: "ha", valor: (x) => x.areaEnc, total: areaEnc, classe: () => "font-medium text-ink" },
    { rotulo: "Área em aberto (ha)", num: "ha", valor: (x) => round2(x.areaRec - x.areaEnc), total: round2(areaRec - areaEnc), classe: () => "text-muted" },
    { rotulo: "% encerrada", num: "pct", valor: (x) => pct1(x.areaEnc, x.areaRec), total: pct1(areaEnc, areaRec) },
  ];
  return (
    <JanelaCard
      titulo="Área encerrada"
      base={base}
      carga={carga}
      largura="5xl"
      exportar={{ nome: `Área encerrada por ${atual.nome}`, colunas, linhas: grupos[aba] }}
    >
      <Nota>
        Área recomendada das O.S. com a posição Encerrada: {nf(areaEnc)} ha de {nf(areaRec)} ha no filtro ({formatar("pct", pct1(areaEnc, areaRec))}).
        {aba === "op" ? " Uma O.S. com mais de uma operação entra em cada uma, com a área dela." : ""} Clique num item para filtrar a tela por ele.
      </Nota>
      <Abas itens={ABAS_AREA} ativo={aba} onChange={setAba} className="mb-3" />
      <TabelaJanela colunas={colunas} linhas={grupos[aba]} chave={(x) => x.chave || "sem"} />
    </JanelaCard>
  );
}

/** Caixa Prazo vencido: as O.S. em aberto com o prazo (data da O.S. + 7 dias) antes de hoje, por solicitante e das mais atrasadas. */
function JanelaVencidas({ carga, base }) {
  const ordens = carga.ordens ?? SEM_ORDENS;
  const { d, hoje } = base;
  const { vencidas, porResp } = useMemo(() => {
    const vencidas = ordens
      .filter((o) => o.atrasada)
      .map((o) => ({ ...o, atraso: diasEntre(o.prevFim, hoje) }))
      .sort((a, b) => b.atraso - a.atraso);
    const nomes = new Map(d.porSolicitante.map((x) => [x.chave, x.nome]));
    const m = new Map();
    for (const o of vencidas) {
      const k = chaveResp(o);
      if (!m.has(k)) m.set(k, { chave: k, nome: nomes.get(k) ?? (o.respNm || "Sem responsável"), lista: [] });
      m.get(k).lista.push(o);
    }
    const porResp = [...m.values()]
      .map(({ lista, ...x }) => ({ ...x, ordens: lista.length, areaRec: somaArea(lista), maior: Math.max(...lista.map((o) => o.atraso)) }))
      .sort((a, b) => b.ordens - a.ordens || b.maior - a.maior);
    return { vencidas, porResp };
  }, [ordens, d, hoje]);
  const colAtraso = {
    rotulo: "Dias de atraso",
    num: "int",
    valor: (o) => o.atraso,
    classe: () => "font-medium text-[#BE3132]",
    dica: () => "Dias desde o prazo até hoje",
  };
  const colunas = [
    {
      rotulo: "Solicitante",
      valor: (x) => x.nome,
      exibir: (x) => (x.chave ? <BotaoFiltro onClick={() => base.filtrar({ resp: x.chave })}>{x.nome}</BotaoFiltro> : x.nome),
      classe: () => "min-w-[220px] text-ink",
    },
    { rotulo: "O.S.", num: "int", valor: (x) => x.ordens, total: vencidas.length },
    { rotulo: "Área rec. (ha)", num: "ha", valor: (x) => x.areaRec, total: somaArea(vencidas) },
    { rotulo: "Maior atraso (dias)", num: "int", valor: (x) => x.maior, total: vencidas.length ? vencidas[0].atraso : null },
  ];
  return (
    <JanelaCard
      titulo="Prazo vencido"
      base={base}
      carga={carga}
      exportar={{ nome: "Prazo vencido", colunas: colunasPlanilhaOS([{ rotulo: "Dias de atraso", valor: (o) => o.atraso }]), linhas: vencidas }}
      rodape={
        <LinkOrdens base={base} vencidas>
          Ver em Ordens de Serviço (só prazo vencido)
        </LinkOrdens>
      }
    >
      <Nota>
        O.S. em aberto (aberta ou liberada) com o prazo (data da O.S. + 7 dias) anterior a hoje ({fmtDateBR(hoje)}). Atraso = dias desde o prazo. Clique num
        solicitante para filtrar a tela por ele.
      </Nota>
      <TabelaJanela colunas={colunas} linhas={porResp} chave={(x) => x.chave || "sem"} vazio="Nenhuma O.S. com o prazo vencido no filtro." />
      <ListaOS
        titulo="O.S. com o prazo vencido, das mais atrasadas"
        ordens={vencidas}
        colunas={colunasListaOS(vencidas, { semEncerramento: true, extra: [colAtraso] })}
      />
    </JanelaCard>
  );
}

/** Caixa Prazo médio: as O.S. encerradas com as duas datas, distribuídas pelas faixas de dias, e a lista, das mais demoradas. */
function JanelaPrazo({ carga, base }) {
  const ordens = carga.ordens ?? SEM_ORDENS;
  const { faixas } = base;
  const { consideradas, semData, porFaixa } = useMemo(() => {
    const enc = ordens.filter((o) => o.posicao === "E");
    const consideradas = enc.filter((o) => o.dias !== null).sort((a, b) => b.dias - a.dias);
    const m = new Map(faixas.map((x) => [x.descricao, []]));
    for (const o of consideradas) {
      const k = faixaDe(o.dias, faixas)?.descricao ?? "";
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(o);
    }
    const porFaixa = [...m].map(([chave, ls]) => ({ chave, ordens: ls.length, prazo: media(ls.map((o) => o.dias)), areaRec: somaArea(ls) }));
    return { consideradas, semData: enc.length - consideradas.length, porFaixa };
  }, [ordens, faixas]);
  const prazo = media(consideradas.map((o) => o.dias));
  const colunas = [
    { rotulo: "Prazo (faixa de dias)", valor: (x) => x.chave || "Fora das faixas", classe: (x) => (x.chave ? "text-ink" : "text-amber-700") },
    { rotulo: "O.S.", num: "int", valor: (x) => x.ordens, total: consideradas.length },
    { rotulo: "% das O.S.", num: "pct", valor: (x) => pct1(x.ordens, consideradas.length), total: consideradas.length ? 100 : null, classe: () => "text-muted" },
    { rotulo: "Área rec. (ha)", num: "ha", valor: (x) => x.areaRec, total: somaArea(consideradas) },
    { rotulo: "Prazo médio (dias)", num: "dias", valor: (x) => x.prazo, total: prazo, classe: () => "font-medium text-ink" },
  ];
  return (
    <JanelaCard
      titulo="Prazo médio"
      base={base}
      carga={carga}
      exportar={{ nome: "Prazo médio", colunas: colunasPlanilhaOS(), linhas: consideradas }}
      rodape={filtrarPosicao(base, "E", "Filtrar a tela: só as O.S. encerradas")}
    >
      <Nota>
        Média dos dias entre a data da O.S. e o encerramento: {prazo === null ? "–" : `${nf(prazo, 1)} dias`}, nas{" "}
        {qtd(consideradas.length, "O.S. encerrada", "O.S. encerradas")} com as duas datas. As faixas são as do cadastro Faixas Dias.
      </Nota>
      {semData > 0 && (
        <Nota aviso>
          {qtd(semData, "O.S. encerrada", "O.S. encerradas")} sem a data da O.S. ou sem a data de encerramento {semData === 1 ? "fica" : "ficam"} fora da média.
        </Nota>
      )}
      <TabelaJanela
        colunas={colunas}
        linhas={consideradas.length ? porFaixa : []}
        chave={(x) => x.chave || "sem"}
        vazio="Nenhuma O.S. encerrada com as duas datas no filtro."
      />
      <ListaOS titulo="O.S. encerradas, das mais demoradas" ordens={consideradas} colunas={colunasListaOS(consideradas)} />
    </JanelaCard>
  );
}
