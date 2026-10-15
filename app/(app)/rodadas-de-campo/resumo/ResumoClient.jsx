"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Campo, ModalShell } from "@/components/ui";
import { IconImportar, IconTrocar } from "@/components/icons";
import { JanelaInfo } from "@/components/janela";
import { Abas, BarraFiltros, CabecalhoPagina, Comando, CorpoPagina, Indicador, Pagina, Painel, Selo } from "@/components/pagina";
import { BotaoExportar } from "@/app/(app)/acompanhamentos/os-agricola/comum";
import { fmtDateBR, fmtHa } from "@/lib/format";
import { podeEditar } from "@/lib/permissoes";

import { ehTexto, ehUmDe, usarPersistido } from "@/lib/usar-persistido";
import BotaoLimparFiltros from "@/components/BotaoLimparFiltros";

const FILTRO = "rounded-md border border-line bg-card px-2.5 py-1.5 text-[12.5px] text-ink focus:border-brand-600 focus:outline-none";

export default function ResumoClient({ perfil }) {
  const podeGravar = podeEditar(perfil);
  const [rod, setRod] = usarPersistido("rodadas.resumo.rod", "", ehTexto);
  const [reg, setReg] = usarPersistido("rodadas.resumo.reg", "", ehTexto);
  const [sem, setSem] = usarPersistido("rodadas.resumo.sem", "", ehTexto);
  const [ori, setOri] = usarPersistido("rodadas.resumo.origem", "", ehTexto);
  const [busca, setBusca] = usarPersistido("rodadas.resumo.busca", "", ehTexto);
  // data: todas | um dia | período (de/até)
  const [modoData, setModoData] = usarPersistido("rodadas.resumo.modoData", "", ehUmDe(["", "dia", "periodo"]));
  const [de, setDe] = usarPersistido("rodadas.resumo.de", "", ehTexto);
  const [ate, setAte] = usarPersistido("rodadas.resumo.ate", "", ehTexto);
  const [usr, setUsr] = usarPersistido("rodadas.resumo.usr", "", ehTexto);
  const [termo, setTermo] = useState("");
  const [pagina, setPagina] = useState(1);
  const algumFiltroAtivo = rod !== "" || reg !== "" || sem !== "" || ori !== "" || busca !== "" || modoData !== "" || de !== "" || ate !== "" || usr !== "";
  function limparFiltros() {
    setRod("");
    setReg("");
    setSem("");
    setOri("");
    setBusca("");
    setTermo("");
    setModoData("");
    setDe("");
    setAte("");
    setUsr("");
    setPagina(1);
  }
  const [linhas, setLinhas] = useState([]);
  const [total, setTotal] = useState(0);
  const [boletins, setBoletins] = useState(0);
  const [areaHa, setAreaHa] = useState(0);
  const [tamanho, setTamanho] = useState(100);
  const [opcoes, setOpcoes] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(null);
  const [importarAberto, setImportarAberto] = useState(false);
  const [padronizarAberto, setPadronizarAberto] = useState(false);
  /** janela (detalhe) do card aberta: boletins, linhas, area, rodadas */
  const [janela, setJanela] = useState(null);
  /** todas as linhas do filtro para as janelas dos cards: { chave, linhas, erro } (vale até o filtro ou a carga mudar) */
  const [detalhe, setDetalhe] = useState(null);
  /** chave da última busca do detalhe: só a resposta dela é gravada (mesmo com a janela fechada ou trocada no meio) */
  const pedidoDetalhe = useRef(null);
  /** cada carga da página conta uma: a janela aberta depois dela busca de novo, para bater com os cards */
  const [geracao, setGeracao] = useState(0);

  const carregar = useCallback(
    async (comOpcoes = false) => {
      setCarregando(true);
      setErro(null);
      try {
        const p = new URLSearchParams({ pg: String(pagina) });
        if (rod) p.set("rod", rod);
        if (reg) p.set("reg", reg);
        if (sem) p.set("sem", sem);
        if (ori) p.set("ori", ori);
        if (termo) p.set("q", termo);
        filtroData(p);
        if (usr) p.set("usr", usr);
        if (comOpcoes || !opcoes || !opcoes.usuarios) p.set("opcoes", "1");
        const res = await fetch(`/api/rodadas/resumo?${p}`, { cache: "no-store" });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Não foi possível carregar o resumo.");
        setLinhas(json.linhas);
        setTotal(json.total);
        setBoletins(json.boletins);
        setAreaHa(json.areaHa);
        setTamanho(json.tamanho);
        if (json.opcoes) setOpcoes(json.opcoes);
        setGeracao((g) => g + 1);
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Não foi possível carregar o resumo.");
      } finally {
        setCarregando(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pagina, rod, reg, sem, ori, termo, modoData, de, ate, usr],
  );

  function filtroData(p) {
    if (modoData === "dia" && de) {
      p.set("de", de);
      p.set("ate", de);
    } else if (modoData === "periodo") {
      if (de) p.set("de", de);
      if (ate) p.set("ate", ate);
    }
  }

  /** os filtros da página para pedir todas as linhas (sem paginar) */
  function parametrosTodos() {
    const p = new URLSearchParams({ todos: "1" });
    if (rod) p.set("rod", rod);
    if (reg) p.set("reg", reg);
    if (sem) p.set("sem", sem);
    if (ori) p.set("ori", ori);
    if (termo) p.set("q", termo);
    if (usr) p.set("usr", usr);
    filtroData(p);
    return p;
  }

  /** todas as linhas do filtro atual (para exportar) */
  async function todasAsLinhas() {
    const res = await fetch(`/api/rodadas/resumo?${parametrosTodos()}`, { cache: "no-store" });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? "Não foi possível exportar.");
    return json.linhas;
  }

  /**
   * Detalhe das janelas dos cards: todas as linhas do filtro e, na mesma busca, as opções (rodadas, regiões, semanas,
   * usuários). Assim o card Rodadas, o select de Rodada e a janela contam a mesma lista, mesmo com boletins de rodada
   * nova lançados pelo Apontamento ou pelo Lançamento Mobile depois que a tela abriu.
   */
  async function linhasEOpcoes() {
    const p = parametrosTodos();
    p.set("opcoes", "1");
    const res = await fetch(`/api/rodadas/resumo?${p}`, { cache: "no-store" });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? "Não foi possível carregar o detalhe.");
    return json;
  }

  useEffect(() => {
    carregar();
  }, [carregar]);

  useEffect(() => {
    const t = setTimeout(() => {
      setPagina(1);
      setTermo(busca);
    }, 350);
    return () => clearTimeout(t);
  }, [busca]);

  const totalPaginas = Math.max(1, Math.ceil(total / tamanho));
  const mudar = (fn) => {
    fn();
    setPagina(1);
  };

  // janelas dos cards: todas as linhas do filtro (a página só tem 100), buscadas ao abrir a primeira janela. Uma busca
  // por filtro: fechar ou trocar de janela durante a carga não a descarta (a resposta fica para a próxima janela); só
  // quando o filtro ou a carga mudam a resposta antiga é ignorada. Depois de um erro, abrir a janela tenta de novo.
  const chaveDetalhe = `${geracao}|${JSON.stringify([rod, reg, sem, ori, termo, modoData, de, ate, usr])}`;
  // filtro ou carga nova: a busca em andamento perde a vez (nem as linhas nem as opções antigas sobrescrevem as novas)
  useEffect(
    () => () => {
      pedidoDetalhe.current = null;
    },
    [chaveDetalhe],
  );
  useEffect(() => {
    if (!janela || (detalhe?.chave === chaveDetalhe && !detalhe.erro)) return;
    const chave = chaveDetalhe;
    pedidoDetalhe.current = chave;
    setDetalhe({ chave, linhas: null, erro: null });
    linhasEOpcoes()
      .then((json) => {
        if (pedidoDetalhe.current !== chave) return;
        setDetalhe({ chave, linhas: json.linhas, erro: null });
        if (json.opcoes) setOpcoes(json.opcoes);
      })
      .catch((e) => {
        if (pedidoDetalhe.current !== chave) return;
        setDetalhe({ chave, linhas: null, erro: e instanceof Error ? e.message : "Não foi possível carregar o detalhe." });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [janela, chaveDetalhe]);
  const linhasJanela = detalhe?.chave === chaveDetalhe ? detalhe.linhas : null;
  const totaisJanela = useMemo(() => totaisDe(linhasJanela ?? []), [linhasJanela]);

  /** clique numa rodada, semana, data, região, origem ou usuário dentro da janela: a página passa a filtrar por ele */
  function aplicarFiltro(tipo, v) {
    setJanela(null);
    mudar(() => {
      if (tipo === "rod") setRod(String(v));
      else if (tipo === "reg") setReg(String(v));
      else if (tipo === "sem") setSem(String(v));
      else if (tipo === "ori") setOri(v);
      else if (tipo === "usr") setUsr(v);
      else if (tipo === "dia") {
        setModoData("dia");
        setDe(v);
      }
    });
  }

  // subtítulo das janelas dos cards: os filtros que formaram os números
  const filtrosAtivos = [
    rod && `rodada ${rod}`,
    reg && `região ${reg}`,
    sem && `semana ${sem}`,
    ori && `origem ${ori === "apontamento" ? "Apontamento" : "Importação"}`,
    modoData === "dia" && de && `data ${fmtDateBR(de)}`,
    modoData === "periodo" &&
      (de || ate) &&
      (de && ate ? `de ${fmtDateBR(de)} a ${fmtDateBR(ate)}` : de ? `a partir de ${fmtDateBR(de)}` : `até ${fmtDateBR(ate)}`),
    usr && `lançado por ${usr}`,
    termo && `busca “${termo}”`,
  ].filter(Boolean);
  const baseJanela = {
    subtitulo: `Levantamento de campo · ${filtrosAtivos.length ? `filtro: ${filtrosAtivos.join(" · ")}` : "sem filtro"}`,
    linhas: linhasJanela,
    erro: detalhe?.chave === chaveDetalhe ? detalhe.erro : null,
    onFechar: () => setJanela(null),
    filtrar: aplicarFiltro,
  };
  const cards = [
    { k: "boletins", rotulo: "Boletins", valor: boletins.toLocaleString("pt-BR"), cor: "azul" },
    { k: "linhas", rotulo: "Linhas lançadas", valor: total.toLocaleString("pt-BR"), cor: "cinza" },
    { k: "area", rotulo: "Área (ha)", valor: fmtHa(areaHa), cor: "verde" },
    {
      k: "rodadas",
      rotulo: "Rodadas",
      valor: String(opcoes?.rodadas.length ?? 0),
      cor: "cinza",
      title: "Ver o detalhe · conta as rodadas com boletim lançado, sem os filtros da página",
    },
  ];

  return (
    <Pagina>
      <CabecalhoPagina
        titulo="Resumo"
        categoria="Rodadas de Campo"
        info={!podeGravar && <Selo>Somente leitura</Selo>}
        comandos={
          // os dois comandos são só de quem grava: sem eles, nada de barra vazia (nem traço solto depois do Voltar)
          podeGravar && (
            <>
              <Comando primario icone={<IconImportar size={16} />} onClick={() => setImportarAberto(true)}>
                Importar
              </Comando>
              <Comando icone={<IconTrocar size={16} />} onClick={() => setPadronizarAberto(true)}>
                Padronizar ocorrências
              </Comando>
            </>
          )
        }
      />

      <CorpoPagina>
        <BarraFiltros>
          <select value={rod} onChange={(e) => mudar(() => setRod(e.target.value))} className={FILTRO} aria-label="Rodada">
            <option value="">Todas as rodadas</option>
            {opcoes?.rodadas.map((r) => (
              <option key={r} value={r}>
                Rodada {r}
              </option>
            ))}
          </select>
          <select value={reg} onChange={(e) => mudar(() => setReg(e.target.value))} className={FILTRO} aria-label="Região">
            <option value="">Todas as regiões</option>
            {opcoes?.regioes.map((r) => (
              <option key={r} value={r}>
                Região {r}
              </option>
            ))}
          </select>
          <select value={sem} onChange={(e) => mudar(() => setSem(e.target.value))} className={FILTRO} aria-label="Semana">
            <option value="">Todas as semanas</option>
            {opcoes?.semanas.map((s) => (
              <option key={s} value={s}>
                Semana {s}
              </option>
            ))}
          </select>
          <select value={ori} onChange={(e) => mudar(() => setOri(e.target.value))} className={FILTRO} aria-label="Origem">
            <option value="">Todas as origens</option>
            <option value="apontamento">Apontamento</option>
            <option value="importacao">Importação</option>
          </select>
          <select value={modoData} onChange={(e) => mudar(() => setModoData(e.target.value))} className={FILTRO} aria-label="Data">
            <option value="">Todas as datas</option>
            <option value="dia">Data</option>
            <option value="periodo">Período</option>
          </select>
          {modoData === "dia" && (
            <input type="date" value={de} onChange={(e) => mudar(() => setDe(e.target.value))} className={FILTRO} aria-label="Data do boletim" />
          )}
          {modoData === "periodo" && (
            <>
              <input type="date" value={de} onChange={(e) => mudar(() => setDe(e.target.value))} className={FILTRO} aria-label="Data inicial" />
              <span className="pb-1.5 text-[12px] text-muted">até</span>
              <input type="date" value={ate} onChange={(e) => mudar(() => setAte(e.target.value))} className={FILTRO} aria-label="Data final" />
            </>
          )}
          <select value={usr} onChange={(e) => mudar(() => setUsr(e.target.value))} className={FILTRO} aria-label="Usuário">
            <option value="">Todos os usuários</option>
            {opcoes?.usuarios?.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar fazenda, ocorrência, boletim…"
            className={`${FILTRO} min-w-[240px]`}
          />
          <BotaoLimparFiltros ativo={algumFiltroAtivo} onLimpar={limparFiltros} />
        </BarraFiltros>

        {/* cada card abre a janela com o detalhe dos mesmos números (mesmos filtros) */}
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          {cards.map((c) => (
            <button
              key={c.k}
              type="button"
              onClick={() => setJanela(c.k)}
              className="min-w-0 rounded-xl2 text-left transition hover:-translate-y-px focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-500"
              title={c.title ?? "Ver o detalhe"}
            >
              <Indicador cor={c.cor} rotulo={c.rotulo} valor={c.valor} className="h-full" />
            </button>
          ))}
        </div>

        <Painel
          titulo="Levantamento de campo"
          semEspaco
          acoes={
            <BotaoExportar
              nome="Resumo Rodadas de Campo"
              buscar={todasAsLinhas}
              colunas={[
                { rotulo: "Boletim", valor: (l) => l.bol },
                { rotulo: "Rodada", valor: (l) => l.rod },
                { rotulo: "Data", valor: (l) => fmtDateBR(l.dt) },
                { rotulo: "Semana", valor: (l) => l.sem || "" },
                { rotulo: "Região", valor: (l) => l.reg },
                { rotulo: "Descrição da Região", valor: (l) => l.regNm },
                { rotulo: "Fazenda", valor: (l) => l.faz },
                { rotulo: "Descrição Fazenda", valor: (l) => l.fazNm },
                { rotulo: "Talhão", valor: (l) => l.tlh },
                { rotulo: "Área (ha)", valor: (l) => l.area },
                { rotulo: "Ocorrência", valor: (l) => l.ocorrencia },
                { rotulo: "Presença", valor: (l) => l.presenca },
                { rotulo: "Nível", valor: (l) => l.nivel },
                { rotulo: "Prioridade", valor: (l) => l.prioridade },
                { rotulo: "Recomendação / Diagnóstico", valor: (l) => l.rec },
                { rotulo: "Responsável", valor: (l) => l.resp },
                { rotulo: "Origem", valor: (l) => l.origem },
                { rotulo: "Lançado por", valor: (l) => l.lancadoPor },
                { rotulo: "Atividade", valor: (l) => l.atividade },
                { rotulo: "Executado", valor: (l) => l.executado },
              ]}
            />
          }
        >
          {erro && <p className="px-4 py-3 text-[12.5px] font-medium text-alert-600">{erro}</p>}

          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-line bg-navy-900 text-left text-white">
                  <th className="px-3 py-2 text-right font-semibold">Boletim</th>
                  <th className="px-3 py-2 text-right font-semibold">Rodada</th>
                  <th className="px-3 py-2 font-semibold">Data</th>
                  <th className="px-3 py-2 text-right font-semibold">Semana</th>
                  <th className="px-3 py-2 font-semibold">Região</th>
                  <th className="px-3 py-2 font-semibold">Fazenda</th>
                  <th className="px-3 py-2 font-semibold">Descrição Fazenda</th>
                  <th className="px-3 py-2 text-center font-semibold">Talhão</th>
                  <th className="px-3 py-2 text-right font-semibold">Área (ha)</th>
                  <th className="px-3 py-2 font-semibold">Ocorrência</th>
                  <th className="px-3 py-2 font-semibold">Presença</th>
                  <th className="px-3 py-2 font-semibold">Nível</th>
                  <th className="px-3 py-2 font-semibold">Prioridade</th>
                  <th className="px-3 py-2 font-semibold">Recomendação / Diagnóstico</th>
                  <th className="px-3 py-2 font-semibold">Responsável</th>
                  <th className="px-3 py-2 font-semibold">Origem</th>
                  <th className="px-3 py-2 font-semibold">Lançado por</th>
                  <th className="px-3 py-2 font-semibold">Atividade</th>
                  <th className="px-3 py-2 text-center font-semibold">Executado</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((l, i) => (
                  <tr key={`${l.bol}-${i}`} className={`border-b border-line/60 ${i % 2 === 1 ? "bg-surface" : "bg-card"}`}>
                    <td className="px-3 py-1 text-right tabular text-ink">{l.bol}</td>
                    <td className="px-3 py-1 text-right tabular text-ink">{l.rod}</td>
                    <td className="whitespace-nowrap px-3 py-1 text-ink">{fmtDateBR(l.dt)}</td>
                    <td className="px-3 py-1 text-right tabular text-ink">{l.sem || ""}</td>
                    <td className="whitespace-nowrap px-3 py-1 text-ink">{l.reg ? (l.regNm ? `${l.reg} · ${l.regNm}` : l.reg) : ""}</td>
                    <td className="px-3 py-1 tabular text-ink">{l.faz}</td>
                    <td className="px-3 py-1 text-ink">{l.fazNm}</td>
                    <td className="px-3 py-1 text-center text-ink">{l.tlh}</td>
                    <td className="px-3 py-1 text-right tabular text-ink">{l.area !== null ? fmtHa(l.area) : ""}</td>
                    <td className="min-w-[200px] px-3 py-1 text-ink">{l.ocorrencia}</td>
                    <td className="px-3 py-1 text-ink">{l.presenca}</td>
                    <td className="px-3 py-1 text-ink">{l.nivel}</td>
                    <td className="px-3 py-1 text-ink">{l.prioridade}</td>
                    <td className="min-w-[240px] px-3 py-1 text-ink">{l.rec}</td>
                    <td className="whitespace-nowrap px-3 py-1 text-ink">{l.resp}</td>
                    <td className="whitespace-nowrap px-3 py-1 text-ink">{l.origem}</td>
                    <td className="whitespace-nowrap px-3 py-1 text-ink">{l.lancadoPor}</td>
                    <td className="min-w-[160px] px-3 py-1 text-ink">{l.atividade}</td>
                    <td className="px-3 py-1 text-center text-ink">{l.executado}</td>
                  </tr>
                ))}
                {!carregando && linhas.length === 0 && (
                  <tr>
                    <td colSpan={19} className="px-4 py-10 text-center text-muted">
                      {podeGravar
                        ? 'Nenhum levantamento ainda. Use "Importar" para carregar a planilha ou lance pelo Apontamento.'
                        : "Nenhum levantamento ainda."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between border-t border-line bg-surface px-4 py-2 text-[12.5px] text-muted">
            <span>{carregando ? "Carregando…" : `Página ${pagina} de ${totalPaginas} · ${total.toLocaleString("pt-BR")} linha(s)`}</span>
            <span className="flex gap-1.5">
              <button
                type="button"
                disabled={pagina <= 1 || carregando}
                onClick={() => setPagina((p) => p - 1)}
                className="rounded-md border border-line bg-card px-2.5 py-1 font-semibold text-navy-800 disabled:opacity-40"
              >
                Anterior
              </button>
              <button
                type="button"
                disabled={pagina >= totalPaginas || carregando}
                onClick={() => setPagina((p) => p + 1)}
                className="rounded-md border border-line bg-card px-2.5 py-1 font-semibold text-navy-800 disabled:opacity-40"
              >
                Próxima
              </button>
            </span>
          </div>
        </Painel>
      </CorpoPagina>

      {janela === "boletins" && <JanelaBoletins base={baseJanela} totais={totaisJanela} />}
      {janela === "linhas" && <JanelaQuebras titulo="Linhas lançadas" foco="linhas" base={baseJanela} totais={totaisJanela} />}
      {janela === "area" && <JanelaQuebras titulo="Área (ha)" foco="area" base={baseJanela} totais={totaisJanela} />}
      {janela === "rodadas" && <JanelaRodadas base={baseJanela} totais={totaisJanela} rodadas={opcoes?.rodadas} />}
      {padronizarAberto && (
        <PadronizarModal
          onFechar={() => {
            setPadronizarAberto(false);
            carregar(true);
          }}
        />
      )}
      {importarAberto && (
        <ImportarModal
          onFechar={() => {
            setImportarAberto(false);
            carregar(true);
          }}
        />
      )}
    </Pagina>
  );
}

/* ---------- Janelas dos cards: o detalhe calculado das mesmas linhas filtradas que formam o card ---------- */

const int = (n) => (n ?? 0).toLocaleString("pt-BR");
const pct = (v, total) => (total > 0 ? Math.round((v / total) * 1000) / 10 : null);
const qtd = (n, um, varios) => `${int(n)} ${n === 1 ? um : varios}`;
const semArea = (l) => l.area === null || l.area === undefined;
const data = (iso) => (iso ? fmtDateBR(iso) : "");
const textoRegiao = (reg, nm) => (reg ? (nm ? `${reg} · ${nm}` : reg) : "");
const natural = new Intl.Collator("pt-BR", { numeric: true, sensitivity: "base" });
/** as tabelas das janelas mostram até tantas linhas; o Exportar leva todas e o total conta todas */
const LIMITE_JANELA = 1000;

/** os números dos cards, refeitos com todas as linhas do filtro (área: soma das linhas que têm área) */
function totaisDe(linhas) {
  const bols = new Set();
  let area = 0;
  let semAreaN = 0;
  for (const l of linhas) {
    bols.add(l.bol);
    if (semArea(l)) semAreaN++;
    else area += l.area;
  }
  return { boletins: bols.size, linhas: linhas.length, area, semArea: semAreaN };
}

/** Valor na tela: área em ha (2 casas), contagem, percentual (1 casa), código ou texto; total null = "–". */
function formatar(num, v) {
  if ((v === null || v === undefined) && (num === "ha" || num === "int" || num === "pct")) return "–";
  if (num === "int") return int(v);
  if (num === "pct") return `${v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
  if (num === "ha") return fmtHa(v);
  return v ?? "";
}
const DIREITA = new Set(["ha", "int", "pct", "cod"]);

/** Valor clicável dentro da janela (aplica um filtro da página ou abre o detalhe). */
function BotaoLink({ texto, dica, onClick }) {
  return (
    <button type="button" onClick={onClick} className="text-left text-[#2E5FA8] hover:underline" title={dica}>
      {texto}
    </button>
  );
}

/**
 * Tabela das janelas: cabeçalho, números à direita e linha de total (fica no fim ao ordenar pelo título da coluna).
 * Coluna: { rotulo, valor(l) (o que vai para a planilha), num ("ha", "int", "pct", "cod" = à direita), exibir(l) (o
 * que aparece, se diferente do valor), classe(l), total (null = "–"), soPlanilha (só na exportação) }.
 */
function TabelaJanela({ colunas, linhas, chave, vazio = "Nenhum levantamento no filtro.", rotuloTotal = "Total" }) {
  const vis = colunas.filter((c) => !c.soPlanilha);
  const inicioTotal = vis.findIndex((c) => c.total !== undefined);
  const lado = (c) => (DIREITA.has(c.num) ? "text-right tabular" : "");
  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="whitespace-nowrap border-b border-line bg-surface text-left text-muted">
            {vis.map((c) => (
              <th key={c.rotulo} className={`px-3 py-2 font-medium ${DIREITA.has(c.num) ? "text-right" : ""}`}>
                {c.rotulo}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {linhas.map((l, i) => (
            <tr key={chave(l, i)} className="border-t border-line/60 hover:bg-surface/60">
              {vis.map((c) => (
                <td key={c.rotulo} className={`px-3 py-1.5 ${lado(c)} ${c.classe?.(l) ?? "text-ink"}`}>
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
              <td colSpan={inicioTotal} className="whitespace-nowrap px-3 py-2">
                {rotuloTotal}
              </td>
              {vis.slice(inicioTotal).map((c) => (
                <td key={c.rotulo} className={`px-3 py-2 ${lado(c)}`}>
                  {c.total === undefined ? "" : formatar(c.num, c.total)}
                </td>
              ))}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function Nota({ children }) {
  return <p className="mb-3 text-[12px] leading-relaxed text-muted">{children}</p>;
}

/** Aviso de lista cortada na tela (o total e o Exportar contam todas). */
function Corte({ n, nome }) {
  if (n <= LIMITE_JANELA) return null;
  return (
    <p className="mt-2 text-[11.5px] text-muted">
      Mostrando {int(LIMITE_JANELA)} de {int(n)} {nome}; o total conta todos e o Exportar leva a lista inteira.
    </p>
  );
}

/** Botão de exportar uma tabela da janela (só o rótulo e o valor de cada coluna); sem linhas, nada. */
const exportarTabela = ({ nome, colunas, linhas }) =>
  linhas.length > 0 && (
    <BotaoExportar
      nome={`Resumo Rodadas de Campo - ${nome}`}
      colunas={colunas.map(({ rotulo, valor }) => ({ rotulo, valor }))}
      buscar={async () => linhas}
    />
  );

/** Moldura das janelas: filtros no subtítulo, exportar no topo; enquanto as linhas do filtro chegam, o aviso. */
function JanelaCard({ titulo, base, exportar, largura = "5xl", children }) {
  return (
    <JanelaInfo
      titulo={titulo}
      subtitulo={base.subtitulo}
      largura={largura}
      onFechar={base.onFechar}
      acoes={base.linhas && exportar ? exportarTabela(exportar) : undefined}
    >
      {base.erro ? (
        <p className="rounded-md border border-alert-500/40 bg-alert-50 px-3 py-2 text-[12.5px] text-alert-600">{base.erro}</p>
      ) : !base.linhas ? (
        <p className="py-8 text-center text-[12.5px] text-muted">Carregando o detalhe…</p>
      ) : (
        children
      )}
    </JanelaInfo>
  );
}

/** Card Boletins: um boletim por linha (linhas e área de cada um); clicar no número mostra as linhas (talhões) dele. */
function JanelaBoletins({ base, totais }) {
  const [aberto, setAberto] = useState(null);
  const lista = useMemo(() => {
    const m = new Map();
    for (const l of base.linhas ?? []) {
      let b = m.get(l.bol);
      if (!b) {
        b = { ...l, linhas: 0, semArea: 0, area: 0, itens: [] };
        m.set(l.bol, b);
      }
      b.linhas++;
      b.itens.push(l);
      if (semArea(l)) b.semArea++;
      else b.area += l.area;
    }
    return Array.from(m.values());
  }, [base.linhas]);
  const sel = aberto === null ? null : lista.find((b) => b.bol === aberto);

  if (sel) {
    const colunasItens = [
      { rotulo: "Talhão", num: "cod", valor: (l) => l.tlh, classe: () => "font-medium text-ink" },
      { rotulo: "Área (ha)", num: "ha", valor: (l) => l.area, total: sel.area },
      { rotulo: "Ocorrência", valor: (l) => l.ocorrencia, classe: () => "min-w-[180px] text-ink" },
      { rotulo: "Presença", valor: (l) => l.presenca },
      { rotulo: "Nível", valor: (l) => l.nivel },
      { rotulo: "Prioridade", valor: (l) => l.prioridade },
      { rotulo: "Recomendação / Diagnóstico", valor: (l) => l.rec, classe: () => "min-w-[220px] text-ink" },
      { rotulo: "Atividade", valor: (l) => l.atividade },
      { rotulo: "Executado", valor: (l) => l.executado },
    ];
    const ficha = [
      ["Rodada", sel.rod],
      ["Data", data(sel.dt)],
      ["Semana", sel.sem || "–"],
      ["Região", textoRegiao(sel.reg, sel.regNm) || "–"],
      ["Fazenda", sel.fazNm ? `${sel.faz} · ${sel.fazNm}` : sel.faz],
      ["Responsável", sel.resp || "–"],
      ["Origem", sel.origem],
      ["Lançado por", sel.lancadoPor || "–"],
    ];
    return (
      <JanelaCard titulo={`Boletim ${sel.bol}`} base={base} largura="6xl" exportar={{ nome: `Boletim ${sel.bol}`, colunas: colunasItens, linhas: sel.itens }}>
        <button
          type="button"
          onClick={() => setAberto(null)}
          className="mb-2 rounded-md px-2 py-1 text-[12.5px] font-medium text-[#2E5FA8] hover:bg-[#2E5FA8]/[0.06]"
        >
          ← Voltar aos boletins
        </button>
        <dl className="mb-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12px] sm:grid-cols-4">
          {ficha.map(([r, v]) => (
            <div key={r} className="min-w-0">
              <dt className="text-muted">{r}</dt>
              <dd className="truncate text-ink" title={String(v)}>
                {v}
              </dd>
            </div>
          ))}
        </dl>
        <TabelaJanela
          colunas={colunasItens}
          linhas={sel.itens}
          chave={(l, i) => `${l.tlh}|${i}`}
          rotuloTotal={`Total · ${qtd(sel.linhas, "linha", "linhas")}`}
          vazio="Nenhuma linha neste boletim."
        />
      </JanelaCard>
    );
  }

  const colunas = [
    {
      rotulo: "Boletim",
      num: "cod",
      valor: (b) => b.bol,
      exibir: (b) => <BotaoLink texto={b.bol} dica={`Ver as linhas do boletim ${b.bol}`} onClick={() => setAberto(b.bol)} />,
      classe: () => "font-medium",
    },
    { rotulo: "Rodada", num: "cod", valor: (b) => b.rod },
    { rotulo: "Data", valor: (b) => data(b.dt), classe: () => "whitespace-nowrap text-ink" },
    { rotulo: "Semana", num: "cod", valor: (b) => b.sem || "" },
    { rotulo: "Região", valor: (b) => b.reg, exibir: (b) => textoRegiao(b.reg, b.regNm), classe: () => "whitespace-nowrap text-ink" },
    { rotulo: "Descrição da Região", valor: (b) => b.regNm, soPlanilha: true },
    { rotulo: "Fazenda", num: "cod", valor: (b) => b.faz },
    { rotulo: "Descrição Fazenda", valor: (b) => b.fazNm },
    { rotulo: "Responsável", valor: (b) => b.resp, classe: () => "whitespace-nowrap text-ink" },
    { rotulo: "Origem", valor: (b) => b.origem },
    { rotulo: "Lançado por", valor: (b) => b.lancadoPor, classe: () => "whitespace-nowrap text-ink" },
    { rotulo: "Linhas", num: "int", valor: (b) => b.linhas, total: totais.linhas },
    { rotulo: "Área (ha)", num: "ha", valor: (b) => b.area, total: totais.area },
  ];
  return (
    <JanelaCard titulo="Boletins" base={base} largura="6xl" exportar={{ nome: "Boletins", colunas, linhas: lista }}>
      <Nota>
        {qtd(totais.boletins, "boletim", "boletins")} com {qtd(totais.linhas, "linha", "linhas")} e {fmtHa(totais.area)} ha. Cada boletim é uma rodada,
        data, região, semana e fazenda; clique no número do boletim para ver as linhas (talhões) dele.
      </Nota>
      <TabelaJanela
        colunas={colunas}
        linhas={lista.slice(0, LIMITE_JANELA)}
        chave={(b) => b.bol}
        rotuloTotal={`Total · ${qtd(totais.boletins, "boletim", "boletins")}`}
      />
      <Corte n={lista.length} nome="boletins" />
    </JanelaCard>
  );
}

const ORIGEM_FILTRO = { Apontamento: "apontamento", Importação: "importacao" };

/**
 * Quebras dos cards Linhas lançadas e Área: cada aba agrupa as linhas por um campo do boletim (rodada, semana, data,
 * região, fazenda, origem, lançado por) ou da linha (prioridade). `filtro`: clicar no valor aplica esse filtro na
 * página. `daLinha`: um boletim pode cair em mais de um grupo, então a coluna Boletins não tem total.
 */
const QUEBRAS = [
  { id: "rodada", label: "Por rodada", coluna: "Rodada", num: "cod", chave: (l) => l.rod ?? "", vazio: "Sem rodada", filtro: "rod" },
  { id: "semana", label: "Por semana", coluna: "Semana", num: "cod", chave: (l) => (l.sem > 0 ? l.sem : ""), vazio: "Sem semana", filtro: "sem" },
  { id: "data", label: "Por data", coluna: "Data", chave: (l) => l.dt ?? "", texto: (x) => data(x.chave), vazio: "Sem data", filtro: "dia" },
  {
    id: "regiao",
    label: "Por região",
    coluna: "Região",
    chave: (l) => l.reg ?? "",
    nm: (l) => l.regNm,
    colunaNm: { rotulo: "Descrição da Região", soPlanilha: true },
    texto: (x) => textoRegiao(x.chave, x.nm),
    vazio: "Sem região",
    filtro: "reg",
  },
  {
    id: "fazenda",
    label: "Por fazenda",
    coluna: "Fazenda",
    num: "cod",
    chave: (l) => l.faz ?? "",
    nm: (l) => l.fazNm,
    colunaNm: { rotulo: "Descrição Fazenda" },
    vazio: "Sem fazenda",
  },
  { id: "prioridade", label: "Por prioridade", coluna: "Prioridade", chave: (l) => l.prioridade ?? "", vazio: "Sem prioridade", daLinha: true, porValor: true },
  { id: "origem", label: "Por origem", coluna: "Origem", chave: (l) => l.origem ?? "", vazio: "Sem origem", filtro: "ori", porValor: true },
  { id: "usuario", label: "Por usuário", coluna: "Lançado por", chave: (l) => l.lancadoPor ?? "", vazio: "Sem usuário", filtro: "usr", porValor: true },
];

/** valor do filtro da página para a chave do grupo (origem: o rótulo da linha volta ao código do filtro) */
const valorFiltro = (q, k) => (q.filtro === "ori" ? ORIGEM_FILTRO[k] : k);

/**
 * Cards Linhas lançadas (foco "linhas") e Área (foco "area"): as linhas do filtro agrupadas pela aba escolhida, com
 * boletins, linhas e área; a soma de cada coluna bate com o card. Na Área, a fazenda e a região vêm da maior área.
 */
function JanelaQuebras({ titulo, foco, base, totais }) {
  const [aba, setAba] = useState(foco === "area" ? "fazenda" : "rodada");
  const q = QUEBRAS.find((x) => x.id === aba);
  const grupos = useMemo(() => {
    const m = new Map();
    for (const l of base.linhas ?? []) {
      const k = q.chave(l);
      let x = m.get(k);
      if (!x) {
        x = { chave: k, nm: q.nm?.(l) ?? "", bols: new Set(), linhas: 0, semArea: 0, area: 0 };
        m.set(k, x);
      }
      if (!x.nm && q.nm) x.nm = q.nm(l) ?? "";
      x.bols.add(l.bol);
      x.linhas++;
      if (semArea(l)) x.semArea++;
      else x.area += l.area;
    }
    const porValor = q.porValor || (foco === "area" && (q.id === "fazenda" || q.id === "regiao"));
    const met = foco === "area" ? "area" : "linhas";
    return Array.from(m.values())
      .map(({ bols, ...x }) => ({ ...x, boletins: bols.size }))
      .sort((a, b) => (a.chave === "") - (b.chave === "") || (porValor ? b[met] - a[met] : natural.compare(String(a.chave), String(b.chave))));
  }, [base.linhas, q, foco]);

  const colGrupo = {
    rotulo: q.coluna,
    num: q.num,
    valor: (x) => (x.chave === "" ? "" : q.id === "data" ? data(x.chave) : x.chave),
    exibir: (x) => {
      if (x.chave === "") return <span className="text-amber-700">{q.vazio}</span>;
      const txt = q.texto ? q.texto(x) : x.chave;
      if (!q.filtro) return txt;
      return (
        <BotaoLink texto={txt} dica={`Filtrar a página: ${q.coluna.toLowerCase()} ${txt}`} onClick={() => base.filtrar(q.filtro, valorFiltro(q, x.chave))} />
      );
    },
    classe: () => "whitespace-nowrap font-medium text-ink",
  };
  const colunas = [
    colGrupo,
    q.colunaNm && { ...q.colunaNm, valor: (x) => x.nm },
    { rotulo: "Boletins", num: "int", valor: (x) => x.boletins, total: q.daLinha ? null : totais.boletins },
    { rotulo: "Linhas", num: "int", valor: (x) => x.linhas, total: totais.linhas },
    foco === "linhas" && {
      rotulo: "% das linhas",
      num: "pct",
      valor: (x) => pct(x.linhas, totais.linhas),
      total: totais.linhas > 0 ? 100 : null,
      classe: () => "text-muted",
    },
    foco === "area" && {
      rotulo: "Linhas sem área",
      num: "int",
      valor: (x) => x.semArea,
      total: totais.semArea,
      classe: (x) => (x.semArea > 0 ? "text-amber-700" : "text-muted"),
    },
    { rotulo: "Área (ha)", num: "ha", valor: (x) => x.area, total: totais.area },
    foco === "area" && {
      rotulo: "% da área",
      num: "pct",
      valor: (x) => pct(x.area, totais.area),
      total: totais.area > 0 ? 100 : null,
      classe: () => "text-muted",
    },
  ].filter(Boolean);
  const nomeAba = q.label.replace(/^Por /, "");

  return (
    <JanelaCard titulo={titulo} base={base} largura="5xl" exportar={{ nome: `${titulo.replace(" (ha)", "")} por ${nomeAba}`, colunas, linhas: grupos }}>
      {foco === "linhas" ? (
        <Nota>
          {qtd(totais.linhas, "linha", "linhas")} em {qtd(totais.boletins, "boletim", "boletins")}: cada linha é um talhão lançado num boletim, com a
          ocorrência, a prioridade e a recomendação. Clique na rodada, semana, data, região, origem ou usuário para filtrar a página por ele.
        </Nota>
      ) : (
        <Nota>
          {fmtHa(totais.area)} ha em {qtd(totais.linhas, "linha", "linhas")}: a área soma a área de cada linha lançada, então um talhão levantado em mais
          de um boletim conta em cada um.
          {totais.semArea > 0 ? ` ${qtd(totais.semArea, "linha sem área não soma", "linhas sem área não somam")}.` : ""}
        </Nota>
      )}
      <Abas itens={QUEBRAS} ativo={aba} onChange={setAba} className="mb-3" />
      <TabelaJanela colunas={colunas} linhas={grupos.slice(0, LIMITE_JANELA)} chave={(x) => String(x.chave) || "sem"} />
      <Corte n={grupos.length} nome="grupos" />
      {q.daLinha && (
        <p className="mt-2 text-[11.5px] leading-relaxed text-muted">
          A prioridade é de cada linha: um boletim com linhas de prioridades diferentes conta em cada uma, por isso a coluna Boletins não tem total.
        </p>
      )}
    </JanelaCard>
  );
}

/**
 * Card Rodadas: as rodadas com boletim lançado (o card não segue os filtros) e, de cada uma, o que cai no filtro atual:
 * boletins, linhas, área, primeira e última data e semanas. Clicar na rodada filtra a página por ela.
 */
function JanelaRodadas({ base, totais, rodadas }) {
  const lista = useMemo(() => {
    const novo = (rod) => ({ rod, bols: new Set(), linhas: 0, area: 0, primeira: "", ultima: "", sems: new Set() });
    const m = new Map((rodadas ?? []).map((r) => [r, novo(r)]));
    for (const l of base.linhas ?? []) {
      let x = m.get(l.rod);
      if (!x) {
        x = novo(l.rod);
        m.set(l.rod, x);
      }
      x.bols.add(l.bol);
      x.linhas++;
      if (!semArea(l)) x.area += l.area;
      if (l.dt && (!x.primeira || l.dt < x.primeira)) x.primeira = l.dt;
      if (l.dt && l.dt > x.ultima) x.ultima = l.dt;
      if (l.sem > 0) x.sems.add(l.sem);
    }
    return Array.from(m.values())
      .map(({ bols, sems, ...x }) => ({
        ...x,
        boletins: bols.size,
        semanas: Array.from(sems)
          .sort((a, b) => a - b)
          .join(", "),
      }))
      .sort((a, b) => a.rod - b.rod);
  }, [rodadas, base.linhas]);
  const datas = lista.filter((x) => x.primeira);
  const primeira = datas.reduce((s, x) => (!s || x.primeira < s ? x.primeira : s), "");
  const ultima = datas.reduce((s, x) => (x.ultima > s ? x.ultima : s), "");
  const foraDoFiltro = lista.filter((x) => x.linhas === 0).length;
  const apagada = (x) => (x.linhas > 0 ? "text-ink" : "text-muted");

  const colunas = [
    {
      rotulo: "Rodada",
      num: "cod",
      valor: (x) => x.rod,
      exibir: (x) => <BotaoLink texto={x.rod} dica={`Filtrar a página pela rodada ${x.rod}`} onClick={() => base.filtrar("rod", x.rod)} />,
      classe: () => "font-medium",
    },
    { rotulo: "Boletins", num: "int", valor: (x) => x.boletins, total: totais.boletins, classe: apagada },
    { rotulo: "Linhas", num: "int", valor: (x) => x.linhas, total: totais.linhas, classe: apagada },
    { rotulo: "Área (ha)", num: "ha", valor: (x) => x.area, total: totais.area, classe: apagada },
    { rotulo: "Primeira data", valor: (x) => data(x.primeira), total: data(primeira), classe: apagada },
    { rotulo: "Última data", valor: (x) => data(x.ultima), total: data(ultima), classe: apagada },
    { rotulo: "Semanas", valor: (x) => x.semanas, total: "", classe: apagada },
  ];
  return (
    <JanelaCard titulo="Rodadas" base={base} largura="4xl" exportar={{ nome: "Rodadas", colunas, linhas: lista }}>
      <Nota>
        O card conta as rodadas com boletim lançado, sem os filtros da página ({qtd(lista.length, "rodada", "rodadas")}). As colunas mostram o que cai no
        filtro atual
        {foraDoFiltro > 0 ? ` (${qtd(foraDoFiltro, "rodada fica", "rodadas ficam")} sem linhas nele)` : ""}; clique na rodada para filtrar a página por
        ela.
      </Nota>
      <TabelaJanela
        colunas={colunas}
        linhas={lista}
        chave={(x) => x.rod}
        rotuloTotal={`Total · ${qtd(lista.length, "rodada", "rodadas")}`}
        vazio="Nenhuma rodada com boletim lançado."
      />
    </JanelaCard>
  );
}

/** Converte o texto livre das ocorrências importadas para os itens do Cadastro de Ocorrências (com prévia). */
function PadronizarModal({ onFechar }) {
  const [previa, setPrevia] = useState(null);
  const [erro, setErro] = useState(null);
  const [aplicando, setAplicando] = useState(false);
  const [feito, setFeito] = useState(null);

  useEffect(() => {
    fetch("/api/rodadas/padronizar-ocorrencias", { cache: "no-store" })
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => (ok ? setPrevia(j) : setErro(j.error ?? "Não foi possível montar a prévia.")))
      .catch(() => setErro("Não foi possível montar a prévia."));
  }, []);

  async function aplicar() {
    setAplicando(true);
    setErro(null);
    try {
      const res = await fetch("/api/rodadas/padronizar-ocorrencias", { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "Não foi possível padronizar.");
      setFeito({ linhas: j.linhas, textos: j.textos });
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível padronizar.");
    } finally {
      setAplicando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy-950/50 px-3">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-xl2 bg-card p-4 shadow-pop md:p-5">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-[15px] font-bold text-ink">Padronizar ocorrências importadas</h3>
          <button type="button" onClick={onFechar} aria-label="Fechar" className="px-1 text-[20px] leading-none text-muted">
            ×
          </button>
        </div>
        <p className="mb-3 text-[12.5px] leading-relaxed text-muted">
          Lê o texto de ocorrência das linhas importadas da planilha (ex.: "COLONIÃO E MAMONA") e marca os itens do Cadastro de Ocorrências (Colonião, Mamona).
          O que não for reconhecido vai para <b className="text-ink">Outros</b>. O texto original de cada linha é guardado e a conversão pode ser rodada de novo
          sem repetir o que já foi feito.
        </p>

        {erro && <p className="mb-2 text-[12.5px] font-medium text-alert-600">{erro}</p>}
        {!previa && !erro && <p className="text-[12.5px] text-muted">Analisando as ocorrências importadas…</p>}

        {feito && (
          <p className="mb-2 rounded-lg border border-good-500/30 bg-good-50 px-3 py-2 text-[12.5px] font-semibold text-good-700">
            Pronto: {feito.linhas.toLocaleString("pt-BR")} linha(s) padronizada(s) a partir de {feito.textos.toLocaleString("pt-BR")} texto(s) diferente(s).
          </p>
        )}

        {previa && !feito && (
          <div className="min-h-0 flex-1 overflow-y-auto">
            {previa.linhas === 0 ? (
              <p className="text-[12.5px] text-good-700">Nenhuma linha importada pendente: todas já estão padronizadas.</p>
            ) : (
              <>
                <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-5">
                  <Num rotulo="Linhas a padronizar" valor={previa.linhas} />
                  <Num rotulo="Tudo reconhecido" valor={previa.completas} />
                  <Num rotulo="Em parte (+ Outros)" valor={previa.parciais} />
                  <Num rotulo="Só em Outros" valor={previa.soOutros} />
                  <Num rotulo="Sem ocorrência" valor={previa.semOcorrencia} />
                </div>
                <p className="mb-1 text-[12px] font-semibold text-ink">Como ficariam os textos mais frequentes</p>
                <div className="overflow-x-auto rounded-md border border-line">
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr className="border-b border-line bg-navy-900 text-left text-white">
                        <th className="px-3 py-1.5 text-right font-semibold">Linhas</th>
                        <th className="px-3 py-1.5 font-semibold">Texto importado</th>
                        <th className="px-3 py-1.5 font-semibold">Itens do cadastro</th>
                        <th className="px-3 py-1.5 font-semibold">Outros</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previa.exemplos.map((x, i) => (
                        <tr key={i} className={`border-b border-line/60 align-top ${i % 2 === 1 ? "bg-surface" : "bg-card"}`}>
                          <td className="px-3 py-1 text-right tabular text-ink">{x.linhas}</td>
                          <td className="min-w-[200px] px-3 py-1 text-ink">{x.texto.length > 90 ? `${x.texto.slice(0, 90)}…` : x.texto}</td>
                          <td className="min-w-[200px] px-3 py-1 text-ink">{x.itens.length ? x.itens.join(", ") : <span className="text-muted">—</span>}</td>
                          <td className="px-3 py-1 text-ink">{x.outros}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {previa.sobras.length > 0 && (
                  <>
                    <p className="mb-1 mt-3 text-[12px] font-semibold text-ink">O que ficaria em Outros (candidatos a novos itens do cadastro)</p>
                    <p className="text-[12px] text-muted">{previa.sobras.map((x) => `${x.texto} (${x.linhas})`).join(" · ")}</p>
                  </>
                )}
              </>
            )}
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onFechar} className="rounded-lg border border-line px-4 py-2 text-[13px] font-semibold text-ink">
            {feito ? "Fechar" : "Cancelar"}
          </button>
          {previa && previa.linhas > 0 && !feito && (
            <button
              type="button"
              onClick={aplicar}
              disabled={aplicando}
              className="rounded-lg bg-navy-900 px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-50"
            >
              {aplicando ? "Padronizando…" : `Padronizar ${previa.linhas.toLocaleString("pt-BR")} linha(s)`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Num({ rotulo, valor }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2">
      <div className="text-[10.5px] font-semibold uppercase tracking-wide text-muted">{rotulo}</div>
      <div className="text-[17px] font-extrabold tabular text-navy-900">{valor.toLocaleString("pt-BR")}</div>
    </div>
  );
}

function ImportarModal({ onFechar }) {
  const [arquivos, setArquivos] = useState([]);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState(null);
  const [resultado, setResultado] = useState(null);

  async function enviar() {
    setEnviando(true);
    setErro(null);
    setResultado(null);
    try {
      const form = new FormData();
      arquivos.forEach((f) => form.append("arquivo", f));
      const res = await fetch("/api/rodadas/importar", { method: "POST", body: form });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Não foi possível importar.");
      setResultado(json);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível importar.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <ModalShell titulo="Importar levantamento de campo" onFechar={onFechar}>
      <p className="mb-4 text-[12.5px] leading-relaxed text-muted">
        Envie a planilha <b className="text-ink">Acompanhamento de Levantamento de Área</b> (aba Base_Campo, até 10 arquivos). A coluna{" "}
        <b className="text-ink">Status</b> é desconsiderada. As linhas são ordenadas por Rodada, Data, Região, Semana e Fazenda e cada combinação vira um
        boletim, numerado a partir do último + 1. Boletins já importados (mesma rodada, data, região, semana e fazenda) não são duplicados.
      </p>
      <Campo label="Planilha (.xlsx)">
        <input
          type="file"
          multiple
          accept=".xlsx,.xls"
          onChange={(e) => setArquivos(Array.from(e.target.files ?? []).slice(0, 10))}
          className="block w-full text-[12.5px] text-ink file:mr-3 file:rounded-md file:border-0 file:bg-navy-900 file:px-3 file:py-1.5 file:text-[12.5px] file:font-semibold file:text-white"
        />
      </Campo>
      {erro && <div className="mt-3 rounded-lg border border-alert-500/30 bg-alert-50 px-3 py-2 text-[12.5px] text-alert-600">{erro}</div>}
      {resultado && (
        <div className="mt-3 rounded-lg border border-good-500/30 bg-good-50 px-3 py-2 text-[12.5px] text-good-700">
          <p className="font-semibold">
            {resultado.lidas.toLocaleString("pt-BR")} linha(s) lida(s) · {resultado.boletins.toLocaleString("pt-BR")} boletim(ns) novo(s) ·{" "}
            {resultado.itens.toLocaleString("pt-BR")} linha(s) gravada(s).
          </p>
          {resultado.primeiroBoletim !== null && (
            <p>
              Boletins {resultado.primeiroBoletim} a {resultado.ultimoBoletim}.
            </p>
          )}
          {resultado.rodadasCriadas.length > 0 && <p>Rodadas criadas no cadastro: {resultado.rodadasCriadas.join(", ")}.</p>}
        </div>
      )}
      {resultado && resultado.avisos.length > 0 && (
        <div className="mt-3 max-h-[140px] overflow-y-auto rounded-lg border border-line bg-surface p-2.5 text-[12px] text-muted">
          <ul className="list-disc space-y-0.5 pl-4">
            {resultado.avisos.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={onFechar} className="rounded-lg border border-line px-4 py-2 text-[13px] font-semibold text-ink">
          {resultado ? "Fechar" : "Cancelar"}
        </button>
        <button
          type="button"
          disabled={arquivos.length === 0 || enviando}
          onClick={enviar}
          className="rounded-lg bg-navy-900 px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-40"
        >
          {enviando ? "Importando…" : "Importar"}
        </button>
      </div>
    </ModalShell>
  );
}
