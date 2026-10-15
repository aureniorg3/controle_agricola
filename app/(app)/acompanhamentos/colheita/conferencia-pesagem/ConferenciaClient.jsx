"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ModalShell } from "@/components/ui";
import { IconBaixar, IconImportar, IconImprimir } from "@/components/icons";
import { Abas, BarraFiltros, CabecalhoPagina, Comando, CorpoPagina, Indicador, Pagina, Painel, Selo } from "@/components/pagina";
import { conferirLinhas, normalizarFrente, STATUS_CONFERENCIA_LABEL } from "@/lib/conferencia";
import { fmtDateBR, fmtT } from "@/lib/format";
import { gerarConferenciaPdf, gerarConferenciaXlsx } from "@/lib/relatorio-conferencia";
import { podeEditar } from "@/lib/permissoes";

import { ehTexto, usarPersistido } from "@/lib/usar-persistido";
import BotaoLimparFiltros from "@/components/BotaoLimparFiltros";
import { BotaoCartao, BotaoLink, CLASSE_LINK_RODAPE, exportarTabela, int, JanelaCard, Nota, pct, qtd, r2, r3, Secao, TabelaJanela } from "../janela-detalhe";

const FILTRO = "rounded-md border border-line bg-card px-2.5 py-1.5 text-[12.5px] text-ink focus:border-brand-600 focus:outline-none";

const COR_STATUS = {
  ok: "bg-good-50 text-good-600",
  "frente-divergente": "bg-alert-50 text-alert-600",
  "ordem-outra-frente": "bg-amber-50 text-amber-600",
  "sem-ordem": "bg-amber-50 text-amber-600",
  "sem-cadastro": "bg-surface text-muted",
};

/** Busca da lista (termo já em minúsculas): texto contido no equipamento, na descrição, na fazenda (nome ou código) ou na ordem. */
function casaBusca(l, termo) {
  return (
    !termo ||
    l.eqp.toLowerCase().includes(termo) ||
    l.eqpNome.toLowerCase().includes(termo) ||
    l.fazendaNomeExibido.toLowerCase().includes(termo) ||
    l.fazendaCodigo.includes(termo) ||
    (l.ordemNumero ?? "").includes(termo)
  );
}

export default function ConferenciaClient({ linhas, equiptos, ordens, perfil, nomeUsuario }) {
  const podeGravar = podeEditar(perfil);
  const [importarAberto, setImportarAberto] = useState(false);
  const [exportando, setExportando] = useState(null);
  // correções lançadas nesta sessão (valem na hora, antes da página recarregar)
  const [correcoes, setCorrecoes] = useState({});

  const conferidas = useMemo(() => conferirLinhas(linhas, equiptos, ordens), [linhas, equiptos, ordens]);

  // abre na data mais recente importada; apagar a data tira o limite
  const ultimaData = useMemo(() => linhas.reduce((m, l) => (l.data > m ? l.data : m), ""), [linhas]);
  const [de, setDe] = useState(ultimaData);
  const [ate, setAte] = useState(ultimaData);
  const [frenteFiltro, setFrenteFiltro] = usarPersistido("conferencia.frente", "todas", ehTexto);
  const [statusFiltro, setStatusFiltro] = usarPersistido("conferencia.status", "todos", ehTexto);
  const [busca, setBusca] = usarPersistido("conferencia.busca", "", ehTexto);
  const algumFiltroAtivo = de !== ultimaData || ate !== ultimaData || frenteFiltro !== "todas" || statusFiltro !== "todos" || busca !== "";
  function limparFiltros() {
    setDe(ultimaData);
    setAte(ultimaData);
    setFrenteFiltro("todas");
    setStatusFiltro("todos");
    setBusca("");
  }

  const frentes = useMemo(
    () => Array.from(new Set(conferidas.flatMap((l) => [l.frente, l.frenteCadastro].filter((f) => !!f)))).sort((a, b) => a.localeCompare(b)),
    [conferidas],
  );

  const frentesDisponiveis = useMemo(
    () => Array.from(new Set([...frentes, ...ordens.map((o) => o.frente), ...equiptos.map((e) => e.frente)])).sort((a, b) => a.localeCompare(b)),
    [frentes, ordens, equiptos],
  );

  // período, frente e status (sem a busca): a lista sai daqui e as janelas conferem nela o que a busca por um código traria
  const semBusca = useMemo(
    () =>
      conferidas
        .filter((l) => (!de || l.data >= de) && (!ate || l.data <= ate))
        .filter(
          (l) =>
            frenteFiltro === "todas" ||
            normalizarFrente(l.frente) === normalizarFrente(frenteFiltro) ||
            (l.frenteCadastro !== null && normalizarFrente(l.frenteCadastro) === normalizarFrente(frenteFiltro)),
        )
        .filter((l) => (statusFiltro === "todos" ? true : statusFiltro === "divergencias" ? l.conferencia !== "ok" : l.conferencia === statusFiltro)),
    [conferidas, de, ate, frenteFiltro, statusFiltro],
  );

  const filtradas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return semBusca
      .filter((l) => casaBusca(l, termo))
      .sort(
        (a, b) => a.data.localeCompare(b.data) || a.eqp.localeCompare(b.eqp, undefined, { numeric: true }) || a.fazendaCodigo.localeCompare(b.fazendaCodigo),
      );
  }, [semBusca, busca]);

  /**
   * A busca procura o texto contido (equipamento, fazenda e ordem são todos códigos numéricos: "101" também traz o 1010,
   * a fazenda 1015 e a ordem 2101). O código da janela só vira link de busca quando, no período, frente e status da
   * lista, a busca por ele traz só as linhas daquele equipamento (campo "eqp") ou daquela fazenda ("fazendaCodigo").
   */
  const buscaSo = useMemo(() => {
    const cache = new Map();
    return (campo, codigo) => {
      const k = `${campo}|${codigo}`;
      if (!cache.has(k)) {
        const termo = String(codigo ?? "").trim().toLowerCase();
        cache.set(k, termo !== "" && semBusca.every((l) => !casaBusca(l, termo) || l[campo] === codigo));
      }
      return cache.get(k);
    };
  }, [semBusca]);

  const chaveLinha = (l) => `${l.data}|${l.eqp}|${l.frente}|${l.fazendaCodigo}`;
  const correcaoDe = (l) => correcoes[chaveLinha(l)] ?? l.frenteCorrecao ?? "";

  async function lancarCorrecao(l, frenteCorreta) {
    const chave = chaveLinha(l);
    const anterior = correcoes[chave];
    setCorrecoes((c) => ({ ...c, [chave]: frenteCorreta }));
    const res = await fetch("/api/conferencia/correcao", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        data: l.data,
        eqp: l.eqp,
        frente: l.frente,
        fazendaCodigo: l.fazendaCodigo,
        frenteCorreta,
      }),
    });
    if (!res.ok) {
      setCorrecoes((c) => {
        const novo = { ...c };
        if (anterior === undefined) delete novo[chave];
        else novo[chave] = anterior;
        return novo;
      });
      const json = await res.json().catch(() => ({}));
      window.alert(json.error ?? "Não foi possível salvar a correção.");
    }
  }

  const filtrosTexto = useMemo(() => {
    const partes = [];
    if (de || ate) partes.push(`Período ${de ? fmtDateBR(de) : "início"} a ${ate ? fmtDateBR(ate) : "hoje"}`);
    if (frenteFiltro !== "todas") partes.push(`Frente: ${frenteFiltro}`);
    if (statusFiltro !== "todos") {
      partes.push(`Status: ${statusFiltro === "divergencias" ? "só o que precisa conferir" : STATUS_CONFERENCIA_LABEL[statusFiltro]}`);
    }
    if (busca.trim()) partes.push(`Busca: ${busca.trim()}`);
    return partes.join(" · ");
  }, [de, ate, frenteFiltro, statusFiltro, busca]);

  async function exportar(tipo) {
    setExportando(tipo);
    try {
      const dados = {
        linhas: filtradas.map((l) => ({ ...l, frenteCorrecao: correcaoDe(l) || null })),
        filtrosTexto,
        nomeUsuario,
      };
      if (tipo === "pdf") await gerarConferenciaPdf(dados);
      else await gerarConferenciaXlsx(dados);
    } finally {
      setExportando(null);
    }
  }

  const totais = useMemo(() => {
    const equipamentos = new Set(filtradas.map((l) => l.eqp));
    return {
      toneladas: filtradas.reduce((s, l) => s + l.toneladas, 0),
      equipamentos: equipamentos.size,
      divergencias: filtradas.filter((l) => l.conferencia !== "ok").length,
    };
  }, [filtradas]);

  /** janela (detalhe) do card aberta: toneladas, equipamentos, conferir */
  const [janela, setJanela] = useState(null);
  const periodo = de && de === ate ? fmtDateBR(de) : de || ate ? `${de ? fmtDateBR(de) : "início"} a ${ate ? fmtDateBR(ate) : "hoje"}` : "todas as datas";
  const baseJanela = {
    // as janelas usam as linhas já filtradas da lista: o subtítulo mostra os mesmos filtros da impressão
    subtitulo: filtrosTexto || "Todos os registros importados",
    // nome do arquivo exportado sem barras (vira também o nome da aba da planilha)
    prefixo: `Conferência de Pesagem ${periodo.replace(/\//g, "-")}`,
    onFechar: () => setJanela(null),
    // link de busca do equipamento/fazenda só quando a busca pelo código traz só ele (a busca ativa é trocada)
    buscaSo,
    buscaAtual: busca.trim(),
    // clique numa linha da janela: aplica o filtro na lista e fecha a janela
    filtrar: {
      frente: (f) => {
        setFrenteFiltro(f);
        setJanela(null);
      },
      busca: (texto) => {
        setBusca(texto);
        setJanela(null);
      },
      dia: (d) => {
        setDe(d);
        setAte(d);
        setJanela(null);
      },
      status: (s) => {
        setStatusFiltro(s);
        setJanela(null);
      },
    },
  };

  return (
    <Pagina className="print-scroll">
      {/* o cabeçalho da tela não sai na impressão (a impressão tem o título próprio, logo abaixo) */}
      <div className="flex-shrink-0 print:hidden">
        <CabecalhoPagina
          titulo="Conferência de Pesagem"
          categoria="Acompanhamentos · Colheita"
          info={!podeGravar && <Selo>Somente leitura</Selo>}
          comandos={
            // sem permissão e sem linhas não há comando: a barra fica só com o Voltar (ou não aparece)
            (podeGravar || linhas.length > 0) && (
              <>
                {podeGravar && (
                  <Comando primario icone={<IconImportar size={16} />} onClick={() => setImportarAberto(true)}>
                    Importar arquivos
                  </Comando>
                )}
                {linhas.length > 0 && (
                  <>
                    <Comando icone={<IconImprimir size={16} />} onClick={() => window.print()}>
                      Imprimir
                    </Comando>
                    <Comando icone={<IconBaixar size={16} />} disabled={exportando !== null} onClick={() => exportar("pdf")}>
                      {exportando === "pdf" ? "Gerando…" : "PDF"}
                    </Comando>
                    <Comando icone={<IconBaixar size={16} />} disabled={exportando !== null} onClick={() => exportar("xlsx")}>
                      {exportando === "xlsx" ? "Gerando…" : "Excel"}
                    </Comando>
                  </>
                )}
              </>
            )
          }
        />
      </div>

      <CorpoPagina className="print-scroll">
        <div className="mb-3 hidden print:block">
          <div className="text-[16px] font-bold text-ink">Conferência de Pesagem — CRV Industrial</div>
          {/* a hora da impressão muda entre o servidor e o navegador: sem aviso de diferença */}
          <div className="text-[11px] text-muted" suppressHydrationWarning>
            {filtrosTexto || "Todos os registros importados"} · Gerado por {nomeUsuario} em {new Date().toLocaleString("pt-BR")}
          </div>
        </div>

        {linhas.length > 0 && (
          <BarraFiltros className="print:hidden">
            <label className="flex flex-col gap-1 text-[11.5px] text-muted">
              De
              <input type="date" value={de} onChange={(e) => setDe(e.target.value)} className={FILTRO} />
            </label>
            <label className="flex flex-col gap-1 text-[11.5px] text-muted">
              Até
              <input type="date" value={ate} onChange={(e) => setAte(e.target.value)} className={FILTRO} />
            </label>
            <select value={frenteFiltro} onChange={(e) => setFrenteFiltro(e.target.value)} aria-label="Filtrar por frente" className={FILTRO}>
              <option value="todas">Todas as frentes</option>
              {frentes.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
            <select value={statusFiltro} onChange={(e) => setStatusFiltro(e.target.value)} aria-label="Filtrar por status" className={FILTRO}>
              <option value="todos">Todos os status</option>
              <option value="divergencias">Só o que precisa conferir</option>
              {Object.keys(STATUS_CONFERENCIA_LABEL).map((s) => (
                <option key={s} value={s}>
                  {STATUS_CONFERENCIA_LABEL[s]}
                </option>
              ))}
            </select>
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar equipamento, fazenda, ordem…"
              className={`${FILTRO} min-w-[220px]`}
            />
            <BotaoLimparFiltros ativo={algumFiltroAtivo} onLimpar={limparFiltros} />
          </BarraFiltros>
        )}

        {/* cada card abre a janela com o detalhe do número (as mesmas linhas filtradas da lista) */}
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <BotaoCartao onClick={() => setJanela("toneladas")}>
            <Indicador cor="azul" rotulo="Toneladas (t)" valor={fmtT(totais.toneladas)} className="h-full" />
          </BotaoCartao>
          <BotaoCartao onClick={() => setJanela("equipamentos")}>
            <Indicador cor="cinza" rotulo="Equipamentos" valor={totais.equipamentos} className="h-full" />
          </BotaoCartao>
          <BotaoCartao onClick={() => setJanela("conferir")}>
            <Indicador cor={totais.divergencias > 0 ? "vermelho" : "verde"} rotulo="Linhas a conferir" valor={totais.divergencias} className="h-full" />
          </BotaoCartao>
        </div>

        {linhas.length === 0 ? (
          <div className="rounded-xl2 border border-dashed border-line bg-card px-6 py-14 text-center text-muted">
            Nenhum arquivo importado ainda.{" "}
            {podeGravar ? (
              <button type="button" onClick={() => setImportarAberto(true)} className="font-semibold text-brand-700">
                Importar arquivos
              </button>
            ) : (
              "Peça para um usuário com nível Gravação ou Administrador importar os arquivos."
            )}
          </div>
        ) : (
          <Painel
            titulo="Conferência"
            acoes={
              <span className="text-[12px] text-muted">
                {filtradas.length} linha{filtradas.length === 1 ? "" : "s"}
              </span>
            }
            semEspaco
            className="print:[&>header]:hidden"
          >
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="border-b border-line bg-surface text-left text-muted">
                    <th className="px-4 py-2 font-semibold">Data</th>
                    <th className="px-3 py-2 font-semibold">Equipamento</th>
                    <th className="px-3 py-2 font-semibold">Descrição</th>
                    <th className="px-3 py-2 font-semibold">Frente (Relatório)</th>
                    <th className="px-3 py-2 font-semibold">Frente (Cadastro)</th>
                    <th className="px-3 py-2 font-semibold">Fazenda</th>
                    <th className="px-3 py-2 font-semibold">Descrição Fazenda</th>
                    <th className="px-3 py-2 font-semibold">Ordem</th>
                    <th className="px-3 py-2 font-semibold">Frente (Ordem)</th>
                    <th className="px-3 py-2 font-semibold">Status Ordem</th>
                    <th className="px-3 py-2 text-right font-semibold">Toneladas (t)</th>
                    <th className="px-3 py-2 font-semibold">Status</th>
                    <th className="bg-brand-50/60 px-3 py-2 font-semibold">
                      Equipamento
                      <div className="font-normal normal-case text-muted/70">correção</div>
                    </th>
                    <th className="bg-brand-50/60 px-4 py-2 font-semibold">
                      Frente
                      <div className="font-normal normal-case text-muted/70">correção (sistema origem)</div>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtradas.map((l) => (
                    <tr key={`${l.data}|${l.eqp}|${l.frente}|${l.fazendaCodigo}`} className="border-b border-line last:border-0">
                      <td className="px-4 py-1.5 text-ink">{fmtDateBR(l.data)}</td>
                      <td className="px-3 py-1.5 font-semibold text-ink">{l.eqp}</td>
                      <td className="px-3 py-1.5 text-muted">{l.eqpNome}</td>
                      <td className="px-3 py-1.5 text-ink">{l.frente}</td>
                      <td className="px-3 py-1.5 text-ink">{l.frenteCadastro ?? "—"}</td>
                      <td className="px-3 py-1.5 tabular text-ink">{l.fazendaCodigo}</td>
                      <td className="px-3 py-1.5 text-ink">{l.fazendaNomeExibido}</td>
                      <td className="px-3 py-1.5 text-ink">{l.ordemNumero ?? "—"}</td>
                      <td className="px-3 py-1.5 text-ink">{l.ordemFrente ?? "—"}</td>
                      <td className="px-3 py-1.5 text-muted">{l.ordemStatus ?? "—"}</td>
                      <td className="px-3 py-1.5 text-right font-semibold tabular text-ink">{fmtT(l.toneladas)}</td>
                      <td className="px-3 py-1.5">
                        <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold ${COR_STATUS[l.conferencia]}`}>
                          {STATUS_CONFERENCIA_LABEL[l.conferencia]}
                        </span>
                      </td>
                      <td className="bg-brand-50/30 px-3 py-1.5 font-semibold text-ink">{correcaoDe(l) ? l.eqp : ""}</td>
                      <td className="bg-brand-50/30 px-4 py-1.5">
                        {podeGravar ? (
                          <select
                            value={correcaoDe(l)}
                            onChange={(e) => lancarCorrecao(l, e.target.value)}
                            aria-label="Frente correta"
                            className="w-full min-w-[150px] rounded-md border border-line bg-card px-2 py-1 text-[12px] text-ink focus:border-brand-600 focus:outline-none print:hidden"
                          >
                            <option value="">—</option>
                            {frentesDisponiveis.map((f) => (
                              <option key={f} value={f}>
                                {f}
                              </option>
                            ))}
                          </select>
                        ) : null}
                        <span className={`${podeGravar ? "hidden print:inline" : ""} text-ink`}>{correcaoDe(l)}</span>
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-surface font-bold text-ink">
                    <td className="px-4 py-1.5" colSpan={10}>
                      Total geral
                    </td>
                    <td className="px-3 py-1.5 text-right tabular">{fmtT(totais.toneladas)}</td>
                    <td className="px-3 py-1.5" colSpan={3} />
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="border-t border-line bg-surface px-4 py-2 text-[11.5px] leading-relaxed text-muted">
              Ordem: entre as ordens da fazenda, usa a da mesma frente do cadastro do equipamento — a aberta mais recente ou, se não houver aberta, a encerrada
              mais recente. &quot;Frente divergente&quot;: o relatório colocou o equipamento numa frente diferente do cadastro (Equipto Frente) na data.
            </p>
          </Painel>
        )}
      </CorpoPagina>

      {importarAberto && <ImportarModal onFechar={() => setImportarAberto(false)} />}
      {janela === "toneladas" && <JanelaToneladas linhas={filtradas} totais={totais} base={baseJanela} />}
      {janela === "equipamentos" && <JanelaEquipamentos linhas={filtradas} totais={totais} base={baseJanela} />}
      {janela === "conferir" && (
        <JanelaConferir linhas={filtradas} totais={totais} base={baseJanela} correcaoDe={correcaoDe} statusFiltro={statusFiltro} />
      )}
    </Pagina>
  );
}

/* ---------- Janelas dos cards: o detalhe calculado das mesmas linhas filtradas que formam o card ---------- */

const MUTED = () => "text-muted";
const FORTE = () => "font-semibold text-ink";
const porToneladas = (a, b) => b.toneladas - a.toneladas || String(a.rotulo).localeCompare(String(b.rotulo), undefined, { numeric: true });
const juntar = (conjunto) => Array.from(conjunto).sort((a, b) => a.localeCompare(b)).join(", ");
const distintos = (linhas, valor) => new Set(linhas.map(valor)).size;

/**
 * Soma as linhas da conferência por uma chave: linhas, toneladas, linhas a conferir e os equipamentos, fazendas, dias e
 * frentes (do relatório e do cadastro) distintos. `rotulo` vem da primeira linha do grupo.
 */
function agrupar(linhas, chaveDe, rotuloDe = chaveDe) {
  const mapa = new Map();
  for (const l of linhas) {
    const k = chaveDe(l);
    const x = mapa.get(k) ?? {
      chave: k,
      rotulo: rotuloDe(l),
      linhas: 0,
      toneladas: 0,
      conferir: 0,
      eqps: new Set(),
      fazendas: new Set(),
      dias: new Set(),
      frentes: new Set(),
      frentesCad: new Set(),
    };
    x.linhas += 1;
    x.toneladas += l.toneladas;
    if (l.conferencia !== "ok") x.conferir += 1;
    x.eqps.add(l.eqp);
    x.fazendas.add(l.fazendaCodigo);
    x.dias.add(l.data);
    x.frentes.add(l.frente);
    if (l.frenteCadastro) x.frentesCad.add(l.frenteCadastro);
    mapa.set(k, x);
  }
  return Array.from(mapa.values());
}

/**
 * Código da janela que busca na lista (equipamento ou fazenda): link só quando a busca por ele, no período, frente e
 * status da lista, traz só as linhas dele (`base.buscaSo`); senão fica texto, com o motivo no title. A busca da lista
 * é um campo só: o clique troca a busca que estiver ativa (o title avisa).
 */
function LinkBusca({ base, campo, codigo, oque, children }) {
  if (!codigo) return children;
  if (!base.buscaSo(campo, codigo)) {
    return (
      <span title={`A busca da lista procura o texto contido em equipamento, fazenda e ordem: "${codigo}" também traria outras linhas`}>{children}</span>
    );
  }
  const troca = base.buscaAtual && base.buscaAtual !== codigo ? ` (troca a busca atual "${base.buscaAtual}")` : "";
  return (
    <BotaoLink onClick={() => base.filtrar.busca(codigo)} title={`Buscar ${oque} ${codigo} na lista${troca}`}>
      {children}
    </BotaoLink>
  );
}

const ABAS_TONELADAS = [
  { id: "frente", label: "Por frente", nome: "frente" },
  { id: "fazenda", label: "Por fazenda", nome: "fazenda" },
  { id: "dia", label: "Por dia", nome: "dia" },
];

/**
 * Card Toneladas: as toneladas da lista por frente do relatório, por fazenda e por dia. Clicar na frente ou no dia
 * aplica o filtro na lista; na fazenda, busca o código dela (só quando a busca não traz outras linhas, ver LinkBusca).
 */
function JanelaToneladas({ linhas, totais, base }) {
  const [aba, setAba] = useState("frente");
  const quebras = useMemo(
    () => ({
      // frentes escritas com espaço ou maiúsculas diferentes são a mesma (como no filtro da lista)
      frente: agrupar(linhas, (l) => normalizarFrente(l.frente), (l) => l.frente).sort(porToneladas),
      fazenda: agrupar(linhas, (l) => l.fazendaCodigo, (l) => l.fazendaNomeExibido).sort(porToneladas),
      dia: agrupar(linhas, (l) => l.data).sort((a, b) => a.chave.localeCompare(b.chave)),
    }),
    [linhas],
  );
  const nFazendas = useMemo(() => distintos(linhas, (l) => l.fazendaCodigo), [linhas]);
  const atual = ABAS_TONELADAS.find((a) => a.id === aba);
  const colLinhas = { rotulo: "Linhas", num: "int", valor: (x) => x.linhas, total: linhas.length };
  const colEqp = { rotulo: "Equipamentos", num: "int", valor: (x) => x.eqps.size, total: totais.equipamentos };
  const colFaz = { rotulo: "Fazendas", num: "int", valor: (x) => x.fazendas.size, total: nFazendas };
  const colTon = { rotulo: "Toneladas (t)", num: "t", valor: (x) => r3(x.toneladas), total: totais.toneladas, classe: FORTE };
  const colPct = {
    rotulo: "% das toneladas",
    num: "pct",
    valor: (x) => r2(pct(x.toneladas, totais.toneladas)),
    total: totais.toneladas > 0 ? 100 : null,
    classe: MUTED,
  };
  const colunas = {
    frente: [
      {
        rotulo: "Frente (Relatório)",
        valor: (x) => x.rotulo,
        exibir: (x) => (
          <BotaoLink
            onClick={() => base.filtrar.frente(x.rotulo)}
            title={`Filtrar a lista pela frente ${x.rotulo} (o filtro também traz os equipamentos cadastrados nela)`}
          >
            {x.rotulo}
          </BotaoLink>
        ),
      },
      colLinhas,
      colEqp,
      colFaz,
      colTon,
      colPct,
    ],
    fazenda: [
      { rotulo: "Fazenda", valor: (x) => x.chave, classe: () => "font-medium tabular text-ink" },
      {
        rotulo: "Descrição Fazenda",
        valor: (x) => x.rotulo,
        exibir: (x) => (
          <LinkBusca base={base} campo="fazendaCodigo" codigo={x.chave} oque="a fazenda">
            {x.rotulo || x.chave}
          </LinkBusca>
        ),
      },
      colLinhas,
      colEqp,
      colTon,
      colPct,
    ],
    dia: [
      {
        rotulo: "Data",
        valor: (x) => fmtDateBR(x.chave),
        exibir: (x) => (
          <BotaoLink onClick={() => base.filtrar.dia(x.chave)} title={`Mostrar na lista só o dia ${fmtDateBR(x.chave)}`}>
            {fmtDateBR(x.chave)}
          </BotaoLink>
        ),
      },
      colLinhas,
      colEqp,
      colFaz,
      colTon,
      colPct,
    ],
  }[aba];
  return (
    <JanelaCard
      titulo="Toneladas (t)"
      subtitulo={base.subtitulo}
      prefixo={base.prefixo}
      largura="4xl"
      exportar={{ nome: `Toneladas por ${atual.nome}`, colunas, linhas: quebras[aba] }}
      onFechar={base.onFechar}
    >
      <Nota>
        {qtd(linhas.length, "linha", "linhas")} da lista, {fmtT(totais.toneladas)} t. No total, cada equipamento e cada fazenda contam uma vez. Clique na
        frente ou no dia para filtrar a lista e na fazenda para buscá-la (só quando a busca pelo código dela não traz outras linhas).
      </Nota>
      <Abas itens={ABAS_TONELADAS} ativo={aba} onChange={setAba} className="mb-3" />
      <TabelaJanela colunas={colunas} linhas={quebras[aba]} chave={(x) => x.chave} vazio="Nenhuma linha no filtro." />
    </JanelaCard>
  );
}

/**
 * Card Equipamentos: um equipamento por linha, com as frentes, os dias, as fazendas e as toneladas no filtro. Clicar no
 * código busca o equipamento na lista (só quando a busca não traz outras linhas, ver LinkBusca).
 */
function JanelaEquipamentos({ linhas, totais, base }) {
  const eqps = useMemo(() => agrupar(linhas, (l) => l.eqp, (l) => l.eqpNome).sort(porToneladas), [linhas]);
  const nDias = useMemo(() => distintos(linhas, (l) => l.data), [linhas]);
  const nFazendas = useMemo(() => distintos(linhas, (l) => l.fazendaCodigo), [linhas]);
  const colunas = [
    {
      rotulo: "Equipamento",
      valor: (x) => x.chave,
      exibir: (x) => (
        <LinkBusca base={base} campo="eqp" codigo={x.chave} oque="o equipamento">
          {x.chave}
        </LinkBusca>
      ),
      classe: FORTE,
    },
    { rotulo: "Descrição", valor: (x) => x.rotulo, classe: MUTED },
    { rotulo: "Frente (Relatório)", valor: (x) => juntar(x.frentes) },
    { rotulo: "Frente (Cadastro)", valor: (x) => juntar(x.frentesCad) },
    { rotulo: "Dias", num: "int", valor: (x) => x.dias.size, total: nDias },
    { rotulo: "Fazendas", num: "int", valor: (x) => x.fazendas.size, total: nFazendas },
    { rotulo: "Linhas", num: "int", valor: (x) => x.linhas, total: linhas.length },
    { rotulo: "Toneladas (t)", num: "t", valor: (x) => r3(x.toneladas), total: totais.toneladas, classe: FORTE },
    {
      rotulo: "Linhas a conferir",
      num: "int",
      valor: (x) => x.conferir,
      total: totais.divergencias,
      classe: (x) => (x.conferir > 0 ? "font-semibold text-alert-600" : "text-muted"),
    },
  ];
  return (
    <JanelaCard
      titulo="Equipamentos"
      subtitulo={base.subtitulo}
      prefixo={base.prefixo}
      largura="6xl"
      exportar={{ nome: "Equipamentos", colunas, linhas: eqps }}
      onFechar={base.onFechar}
    >
      <Nota>
        {qtd(totais.equipamentos, "equipamento", "equipamentos")} nas {int(linhas.length)} linhas da lista. No total, cada dia e cada fazenda contam uma
        vez. Clique no equipamento para buscá-lo na lista; fica sem link o código cuja busca também traria outros equipamentos, fazendas ou ordens.
      </Nota>
      <TabelaJanela
        colunas={colunas}
        linhas={eqps}
        chave={(x) => x.chave}
        vazio="Nenhum equipamento no filtro."
        rotuloTotal={`Total · ${qtd(totais.equipamentos, "equipamento", "equipamentos")}`}
      />
    </JanelaCard>
  );
}

const ORDEM_STATUS = Object.keys(STATUS_CONFERENCIA_LABEL);

function SeloStatus({ status }) {
  return <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold ${COR_STATUS[status]}`}>{STATUS_CONFERENCIA_LABEL[status]}</span>;
}

/**
 * Card Linhas a conferir: as linhas da lista com status diferente de OK, resumidas por status e uma a uma. Clicar no
 * status filtra a lista por ele; o rodapé filtra "só o que precisa conferir".
 */
function JanelaConferir({ linhas, totais, base, correcaoDe, statusFiltro }) {
  const aConferir = useMemo(() => linhas.filter((l) => l.conferencia !== "ok"), [linhas]);
  const porStatus = useMemo(
    () => agrupar(aConferir, (l) => l.conferencia).sort((a, b) => ORDEM_STATUS.indexOf(a.chave) - ORDEM_STATUS.indexOf(b.chave)),
    [aConferir],
  );
  const toneladas = aConferir.reduce((s, l) => s + l.toneladas, 0);
  const colunasStatus = [
    {
      rotulo: "Status",
      valor: (x) => STATUS_CONFERENCIA_LABEL[x.chave],
      exibir: (x) => (
        <button type="button" onClick={() => base.filtrar.status(x.chave)} title="Filtrar a lista por este status" className="hover:underline">
          <SeloStatus status={x.chave} />
        </button>
      ),
    },
    { rotulo: "Linhas", num: "int", valor: (x) => x.linhas, total: totais.divergencias, classe: FORTE },
    { rotulo: "Equipamentos", num: "int", valor: (x) => x.eqps.size, total: distintos(aConferir, (l) => l.eqp) },
    { rotulo: "Fazendas", num: "int", valor: (x) => x.fazendas.size, total: distintos(aConferir, (l) => l.fazendaCodigo) },
    { rotulo: "Toneladas (t)", num: "t", valor: (x) => r3(x.toneladas), total: toneladas },
  ];
  const colunasLinhas = [
    { rotulo: "Data", valor: (l) => fmtDateBR(l.data) },
    { rotulo: "Equipamento", valor: (l) => l.eqp, classe: FORTE },
    { rotulo: "Descrição", valor: (l) => l.eqpNome, classe: MUTED },
    { rotulo: "Frente (Relatório)", valor: (l) => l.frente },
    { rotulo: "Frente (Cadastro)", valor: (l) => l.frenteCadastro },
    { rotulo: "Fazenda", valor: (l) => l.fazendaCodigo, classe: () => "tabular text-ink" },
    { rotulo: "Descrição Fazenda", valor: (l) => l.fazendaNomeExibido },
    { rotulo: "Ordem", valor: (l) => l.ordemNumero },
    { rotulo: "Frente (Ordem)", valor: (l) => l.ordemFrente },
    { rotulo: "Status Ordem", valor: (l) => l.ordemStatus, classe: MUTED },
    { rotulo: "Toneladas (t)", num: "t", valor: (l) => r3(l.toneladas), total: toneladas, classe: FORTE },
    { rotulo: "Status", valor: (l) => STATUS_CONFERENCIA_LABEL[l.conferencia], exibir: (l) => <SeloStatus status={l.conferencia} /> },
    { rotulo: "Frente (correção)", valor: (l) => correcaoDe(l) },
  ];
  return (
    <JanelaCard
      titulo="Linhas a conferir"
      subtitulo={base.subtitulo}
      prefixo={base.prefixo}
      largura="6xl"
      exportar={{ nome: "Linhas a conferir por status", colunas: colunasStatus, linhas: porStatus }}
      onFechar={base.onFechar}
      rodape={
        statusFiltro === "todos" && totais.divergencias > 0 ? (
          <button type="button" onClick={() => base.filtrar.status("divergencias")} className={CLASSE_LINK_RODAPE}>
            Mostrar na lista só o que precisa conferir
          </button>
        ) : undefined
      }
    >
      <Nota>
        Linhas da lista com status diferente de OK: frente divergente (o relatório pôs o equipamento numa frente diferente do cadastro), ordem de outra
        frente, sem ordem de corte na fazenda ou equipamento sem cadastro no Equipto Frente na data. Clique no status para filtrar a lista por ele.
      </Nota>
      <TabelaJanela colunas={colunasStatus} linhas={porStatus} chave={(x) => x.chave} vazio="Nenhuma linha a conferir no filtro." />
      {aConferir.length > 0 && (
        <Secao
          titulo={`Linhas a conferir · ${int(aConferir.length)}`}
          acoes={exportarTabela(base.prefixo, { nome: "Linhas a conferir", colunas: colunasLinhas, linhas: aConferir })}
        >
          <TabelaJanela
            colunas={colunasLinhas}
            linhas={aConferir}
            chave={(l) => `${l.data}|${l.eqp}|${l.frente}|${l.fazendaCodigo}`}
            rotuloTotal={`Total · ${qtd(aConferir.length, "linha", "linhas")}`}
          />
        </Secao>
      )}
    </JanelaCard>
  );
}

const MAX_SLOTS = 10;

function ImportarModal({ onFechar }) {
  const router = useRouter();
  const [slots, setSlots] = useState([{ arquivo: null, data: "" }]);
  const [enviando, setEnviando] = useState(false);
  const [resultados, setResultados] = useState(null);
  const [erro, setErro] = useState(null);

  function atualizar(i, parcial) {
    setSlots((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...parcial } : s)));
  }

  const preenchidos = slots.filter((s) => s.arquivo);
  const pronto = preenchidos.length > 0 && preenchidos.every((s) => s.data);

  async function enviar() {
    setEnviando(true);
    setErro(null);
    setResultados(null);
    try {
      const form = new FormData();
      slots.forEach((s, i) => {
        if (s.arquivo) {
          form.append(`arquivo_${i}`, s.arquivo);
          form.append(`data_${i}`, s.data);
        }
      });
      const res = await fetch("/api/conferencia/importar", { method: "POST", body: form });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErro(json.error ?? "Não foi possível importar os arquivos.");
        return;
      }
      setResultados(json.resultados);
      router.refresh();
    } catch {
      setErro("Não foi possível enviar os arquivos. Verifique a conexão e tente novamente.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <ModalShell titulo="Importar Conferência de Pesagem" onFechar={onFechar}>
      <p className="mb-4 text-[12.5px] leading-relaxed text-muted">
        Envie de <b className="text-ink">1 a {MAX_SLOTS} arquivos</b> do relatório &quot;Frentes por Especialidade - Cana Moagem&quot; e informe a{" "}
        <b className="text-ink">data de cada arquivo</b>. Importar uma data que já existe substitui os dados daquele dia.
      </p>

      <div className="space-y-2.5">
        {slots.map((s, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface p-2.5">
            <span className="text-[12px] font-semibold text-muted">{i + 1}.</span>
            <input
              type="file"
              accept=".xlsx,.xls"
              onChange={(e) => atualizar(i, { arquivo: e.target.files?.[0] ?? null })}
              className="min-w-0 flex-1 text-[12.5px] text-ink file:mr-3 file:rounded-md file:border-0 file:bg-navy-900 file:px-3 file:py-1.5 file:text-[12.5px] file:font-semibold file:text-white"
            />
            <input
              type="date"
              value={s.data}
              onChange={(e) => atualizar(i, { data: e.target.value })}
              aria-label={`Data do arquivo ${i + 1}`}
              className={FILTRO}
            />
            {slots.length > 1 && (
              <button
                type="button"
                onClick={() => setSlots((prev) => prev.filter((_, idx) => idx !== i))}
                aria-label="Remover arquivo"
                className="rounded px-1.5 text-[16px] leading-none text-muted hover:bg-alert-50 hover:text-alert-600"
              >
                ×
              </button>
            )}
          </div>
        ))}
      </div>

      {slots.length < MAX_SLOTS && (
        <button
          type="button"
          onClick={() => setSlots((prev) => [...prev, { arquivo: null, data: "" }])}
          className="mt-2.5 text-[12.5px] font-semibold text-brand-700"
        >
          + Adicionar outro arquivo ({slots.length}/{MAX_SLOTS})
        </button>
      )}

      {erro && <div className="mt-3 rounded-lg border border-alert-500/30 bg-alert-50 px-3 py-2 text-[12.5px] text-alert-600">{erro}</div>}

      {resultados && (
        <div className="mt-3 space-y-1.5">
          {resultados.map((r, i) => (
            <div
              key={i}
              className={`rounded-lg border px-3 py-2 text-[12.5px] ${
                r.ok ? "border-good-500/30 bg-good-50 text-good-600" : "border-alert-500/30 bg-alert-50 text-alert-600"
              }`}
            >
              <p className="font-semibold">
                {r.nome} {r.data && `· ${fmtDateBR(r.data)}`}
              </p>
              {r.ok ? (
                <p>
                  {r.linhas} linha(s) · {fmtT(r.toneladas)} t importadas.
                </p>
              ) : (
                <p>{r.erro}</p>
              )}
              {r.avisos.map((a, j) => (
                <p key={j} className="text-amber-600">
                  {a}
                </p>
              ))}
            </div>
          ))}
        </div>
      )}

      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={onFechar} className="rounded-lg border border-line px-4 py-2 text-[13px] font-semibold text-ink">
          {resultados ? "Fechar" : "Cancelar"}
        </button>
        <button
          type="button"
          disabled={!pronto || enviando}
          onClick={enviar}
          className="rounded-lg bg-navy-900 px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-40"
        >
          {enviando ? "Importando…" : "Importar"}
        </button>
      </div>
    </ModalShell>
  );
}
