"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import BotaoLimparFiltros from "@/components/BotaoLimparFiltros";
import { IconBaixar, IconImportar } from "@/components/icons";
import { Comando } from "@/components/pagina";
import SelecaoMultipla from "@/components/SelecaoMultipla";

import { exportarPlanilha } from "@/lib/exportar-planilha";

import { ehTexto, usarPersistido } from "@/lib/usar-persistido";

export const FILTRO = "rounded-md border border-line bg-card px-2.5 py-1.5 text-[12.5px] text-ink focus:border-brand-600 focus:outline-none";

/** Máximo de operações / de fazendas marcadas num filtro (o servidor corta no mesmo limite). */
export const MAX_ITENS_FILTRO = 300;

// op e faz: listas de códigos (vazia = todas); os demais, texto
const VAZIO = { de: "", ate: "", safra: "", posicao: "", resp: "", etapa: "", op: [], faz: [] };
const TEXTOS = ["de", "ate", "safra", "posicao", "resp", "etapa"];
// o filtro guardado antes das listas não tem op/faz; texto separado por vírgula também vale
const ehLista = (v) =>
  v === undefined || typeof v === "string" || (Array.isArray(v) && v.length <= MAX_ITENS_FILTRO && v.every((x) => typeof x === "string"));
const ehFiltros = (v) => !!v && typeof v === "object" && TEXTOS.every((k) => typeof v[k] === "string") && ehLista(v.op) && ehLista(v.faz);
const lista = (v) =>
  (Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : [])
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, MAX_ITENS_FILTRO);

/**
 * Filtros comuns ao Dashboard e às Ordens de Serviço (lembrados entre as duas telas). Devolve sempre o objeto completo,
 * com `op` e `faz` como listas, mesmo vindo de um filtro guardado antes delas.
 */
export function usarFiltrosOS() {
  const [guardado, setF] = usarPersistido("os-agr.filtros", VAZIO, ehFiltros);
  // filtro antigo das Ordens de Serviço (uma operação só, guardado à parte): passa para a lista comum de operações
  const [opAntiga, setOpAntiga] = usarPersistido("os-agr.ordens.op", "", ehTexto);
  useEffect(() => {
    if (!opAntiga) return;
    setF((x) => ({ ...x, op: [...new Set([...lista(x.op), opAntiga])] }));
    setOpAntiga("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opAntiga]);
  const f = useMemo(() => ({ ...VAZIO, ...guardado, op: lista(guardado.op), faz: lista(guardado.faz) }), [guardado]);
  return [f, setF];
}

/** Parâmetros da API: as listas vão separadas por vírgula (op=14330,14340&faz=9411,9001). */
export function paramsDosFiltros(f) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) {
    if (Array.isArray(v)) {
      if (v.length) p.set(k, v.join(","));
    } else if (v) p.set(k, v);
  }
  return p;
}

export function usarOpcoesOS(recarregar) {
  const [opcoes, setOpcoes] = useState(null);
  useEffect(() => {
    let ativo = true;
    fetch("/api/os-agricola?opcoes=1", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => ativo && !j.error && setOpcoes(j))
      .catch(() => {});
    return () => {
      ativo = false;
    };
  }, [recarregar]);
  return opcoes;
}

/** Barra de filtros: período (data da O.S.), safra, posição, solicitante, etapa, operações e fazendas; `extra` entra no fim. */
export function BarraFiltrosOS({ f, setF, opcoes, extra, extraAtivo = false, limparExtra }) {
  const mudar = (p) => setF((x) => ({ ...x, ...p }));
  const algum = Object.values(f).some((v) => (Array.isArray(v) ? v.length > 0 : !!v)) || extraAtivo;
  return (
    <div className="flex flex-wrap items-end gap-2.5">
      <label className="flex flex-col gap-1 text-[11.5px] text-muted">
        Data da O.S. — de
        <input type="date" value={f.de} onChange={(e) => mudar({ de: e.target.value })} className={FILTRO} />
      </label>
      <label className="flex flex-col gap-1 text-[11.5px] text-muted">
        até
        <input type="date" value={f.ate} onChange={(e) => mudar({ ate: e.target.value })} className={FILTRO} />
      </label>
      <label className="flex flex-col gap-1 text-[11.5px] text-muted">
        Safra
        <select value={f.safra} onChange={(e) => mudar({ safra: e.target.value })} className={FILTRO}>
          <option value="">Todas</option>
          {opcoes?.safras.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-[11.5px] text-muted">
        Posição
        <select value={f.posicao} onChange={(e) => mudar({ posicao: e.target.value })} className={FILTRO}>
          <option value="">Todas</option>
          <option value="aberto">Em aberto (aberta ou liberada)</option>
          <option value="A">Aberta</option>
          <option value="L">Liberada</option>
          <option value="E">Encerrada</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-[11.5px] text-muted">
        Solicitante
        <select value={f.resp} onChange={(e) => mudar({ resp: e.target.value })} className={`${FILTRO} max-w-[230px]`}>
          <option value="">Todos</option>
          {opcoes?.responsaveis.map((r) => (
            <option key={r.cod} value={r.cod}>
              {r.nome}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-[11.5px] text-muted">
        Etapa
        <select value={f.etapa} onChange={(e) => mudar({ etapa: e.target.value })} className={`${FILTRO} max-w-[200px]`}>
          <option value="">Todas</option>
          {opcoes?.etapas.map((e) => (
            <option key={e.cod} value={e.cod}>
              {e.cod} · {e.nome}
            </option>
          ))}
        </select>
      </label>
      <SelecaoMultipla
        rotulo="Operação"
        opcoes={opcoes?.operacoes ?? null}
        valor={f.op}
        onChange={(op) => mudar({ op })}
        singular="operação"
        plural="operações"
        maximo={MAX_ITENS_FILTRO}
        className={`${FILTRO} w-[220px]`}
      />
      <SelecaoMultipla
        rotulo="Fazenda"
        opcoes={opcoes?.fazendas ?? null}
        valor={f.faz}
        onChange={(faz) => mudar({ faz })}
        singular="fazenda"
        plural="fazendas"
        maximo={MAX_ITENS_FILTRO}
        className={`${FILTRO} w-[200px]`}
      />
      {extra}
      <BotaoLimparFiltros
        ativo={algum}
        className="mb-0.5"
        onLimpar={() => {
          setF(VAZIO);
          limparExtra?.();
        }}
      />
    </div>
  );
}

export const corPosicao = (p) =>
  p === "E"
    ? "bg-good-50 text-good-700 border-good-500/30"
    : p === "L"
      ? "bg-[#2E5FA8]/10 text-[#2E5FA8] border-[#2E5FA8]/25"
      : "bg-[#D77B38]/10 text-[#B5602A] border-[#D77B38]/30";

export function SeloPosicao({ p }) {
  const nome = p === "E" ? "Encerrada" : p === "L" ? "Liberada" : p === "A" ? "Aberta" : p || "—";
  return <span className={`inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium ${corPosicao(p)}`}>{nome}</span>;
}

/** Botão com as duas opções de exportação (CSV e XLSX); `buscar` traz todas as linhas do filtro atual. */
export function BotaoExportar({ nome, colunas, buscar }) {
  // posição do menu na tela (fixa): assim ele não é cortado pela barra de comandos nem pelo painel
  const [aberto, setAberto] = useState(null);
  const [gerando, setGerando] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!aberto) return;
    const fechar = (e) => ref.current && !ref.current.contains(e.target) && setAberto(null);
    const fecharTudo = () => setAberto(null);
    document.addEventListener("mousedown", fechar);
    window.addEventListener("resize", fecharTudo);
    document.addEventListener("scroll", fecharTudo, true);
    return () => {
      document.removeEventListener("mousedown", fechar);
      window.removeEventListener("resize", fecharTudo);
      document.removeEventListener("scroll", fecharTudo, true);
    };
  }, [aberto]);
  async function gerar(formato) {
    setAberto(null);
    setGerando(true);
    try {
      await exportarPlanilha(nome, colunas, await buscar(), formato);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Não foi possível exportar.");
    } finally {
      setGerando(false);
    }
  }
  return (
    <div ref={ref} className="flex-shrink-0">
      <Comando
        icone={<IconBaixar size={16} />}
        disabled={gerando}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setAberto((a) => (a ? null : { top: r.bottom + 4, right: window.innerWidth - r.right }));
        }}
        aria-haspopup="menu"
        aria-expanded={!!aberto}
      >
        {gerando ? "Exportando…" : "Exportar"}
      </Comando>
      {aberto && (
        <div
          role="menu"
          className="fixed z-50 w-48 overflow-hidden rounded-lg border border-line bg-card py-1 shadow-pop"
          style={{ top: aberto.top, right: aberto.right }}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => gerar("xlsx")}
            className="block w-full px-3 py-1.5 text-left text-[12.5px] text-ink hover:bg-hover"
          >
            Planilha Excel (.xlsx)
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => gerar("csv")}
            className="block w-full px-3 py-1.5 text-left text-[12.5px] text-ink hover:bg-hover"
          >
            Texto separado (.csv)
          </button>
        </div>
      )}
    </div>
  );
}

export function BotaoImportarOS({ onImportado }) {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <Comando primario icone={<IconImportar size={16} />} onClick={() => setAberto(true)}>
        Importar O.S.
      </Comando>
      {aberto && (
        <ImportarOSModal
          onFechar={(importou) => {
            setAberto(false);
            if (importou) onImportado();
          }}
        />
      )}
    </>
  );
}

/** Carrega o pdf.js só quando for ler um PDF (rodando aqui mesmo, sem o arquivo de worker separado). */
async function carregarPdfjs() {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.min.mjs");
  if (!globalThis.pdfjsWorker) globalThis.pdfjsWorker = await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs");
  return pdfjs;
}

/** O JSON da leitura compactado (gzip) quando o navegador sabe compactar. */
async function corpoCompactado(texto) {
  if (typeof CompressionStream === "undefined") return { body: texto, tipo: "application/json" };
  const fluxo = new Blob([texto]).stream().pipeThrough(new CompressionStream("gzip"));
  return { body: await new Response(fluxo).blob(), tipo: "application/gzip" };
}

const int = (n) => (n ?? 0).toLocaleString("pt-BR");
const dataBR = (iso) => (iso ? iso.split("-").reverse().join("/") : "–");

/**
 * Importação do relatório "OS - Ordem de Serviço" (PDF do ERP) em dois passos: o arquivo é lido aqui no navegador
 * (página a página, com a barra de progresso), conferido contra a base (prévia) e só gravado depois de confirmar.
 */
function ImportarOSModal({ onFechar }) {
  const [arquivo, setArquivo] = useState(null);
  const [lido, setLido] = useState(null);
  const [progresso, setProgresso] = useState(null);
  const [previa, setPrevia] = useState(null);
  const [remover, setRemover] = useState(false);
  const [feito, setFeito] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState(null);

  async function enviar(dados, aplicar) {
    const { body, tipo } = await corpoCompactado(JSON.stringify({ ...dados, aplicar, removerAusentes: aplicar && remover }));
    const res = await fetch("/api/os-agricola/importar", { method: "POST", headers: { "Content-Type": tipo }, body });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error ?? "Não foi possível importar.");
    return j;
  }

  async function lerEConferir() {
    if (!arquivo) return;
    setEnviando(true);
    setErro(null);
    try {
      const pdfjs = await carregarPdfjs();
      const { lerOSPdf } = await import("@/lib/ler-os-pdf");
      const tarefa = pdfjs.getDocument({ data: new Uint8Array(await arquivo.arrayBuffer()), disableFontFace: true, isEvalSupported: false });
      const doc = await tarefa.promise;
      setProgresso({ pagina: 0, total: doc.numPages });
      const r = await lerOSPdf(doc, (pagina, total) => {
        // a barra anda a cada 25 páginas, com uma pausa para a tela desenhar (a leitura roda aqui mesmo)
        if (pagina % 25 === 0 || pagina === total) {
          setProgresso({ pagina, total });
          return new Promise((r) => setTimeout(r, 0));
        }
      });
      tarefa.destroy().catch(() => {});
      if (r.ordens.length === 0) throw new Error("Nenhuma O.S. encontrada no arquivo. Use o relatório OS - Ordem de Serviço (PDF) do ERP.");
      const dados = { arquivo: arquivo.name, geradoEm: r.geradoEm, paginas: r.paginas, avisos: r.avisos, ordens: r.ordens };
      setLido(dados);
      setPrevia(await enviar(dados, false));
      setProgresso(null);
    } catch (e) {
      setProgresso(null);
      setErro(e instanceof Error ? e.message : "Não foi possível ler o arquivo.");
    } finally {
      setEnviando(false);
    }
  }

  async function gravar() {
    setEnviando(true);
    setErro(null);
    try {
      setPrevia(await enviar(lido, true));
      setFeito(true);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível importar.");
    } finally {
      setEnviando(false);
    }
  }

  const ausentes = previa?.ausentes ?? 0;
  const aGravar = previa ? previa.novas + previa.alteradas : 0;
  const nada = previa && aGravar === 0 && !(remover && ausentes);
  const botaoGravar = [aGravar ? `Gravar ${int(aGravar)} O.S.` : "", remover && ausentes ? `tirar ${int(ausentes)} da base` : ""]
    .filter(Boolean)
    .join(" e ")
    .replace(/^t/, "T");
  const enc = previa?.encerramento;
  const mud = previa?.mudancas;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy-950/50 px-3">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl2 bg-card p-5 shadow-pop">
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-[15px] font-semibold text-ink">Importar base de O.S.</h3>
          <button type="button" onClick={() => onFechar(feito)} aria-label="Fechar" className="px-1 text-[20px] leading-none text-muted">
            ×
          </button>
        </div>
        <p className="mb-4 text-[12.5px] leading-relaxed text-muted">
          Use o relatório OS - Ordem de Serviço do ERP (PDF). O arquivo é lido aqui no navegador e cada O.S. é comparada com a base: as novas entram, as que
          mudaram (situação, talhões, áreas, insumos…) são substituídas — o conteúdo anterior fica guardado — e as iguais ficam como estão. O encerramento é a
          data em que a leitura identifica a O.S. encerrada (a emissão do relatório) e o prazo é sempre a data da O.S. + 7 dias. O que o relatório não traz
          (centro de custo, previsão antiga do ERP, encerramento já gravado) continua na O.S.
        </p>

        {!previa && !progresso && (
          <label className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-line bg-surface px-4 py-6 text-center text-[12.5px] text-muted hover:border-brand-600">
            <span className="font-medium text-ink">{arquivo ? arquivo.name : "Escolher o arquivo"}</span>
            <span>
              {arquivo ? `${(arquivo.size / 1024 / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB` : "Relatório OS - Ordem de Serviço (.pdf)"}
            </span>
            <input
              type="file"
              accept=".pdf,application/pdf"
              className="sr-only"
              onChange={(e) => {
                setArquivo(e.target.files?.[0] ?? null);
                setErro(null);
              }}
            />
          </label>
        )}

        {progresso && (
          <div className="rounded-lg border border-line bg-surface px-4 py-4" role="status" aria-live="polite">
            <div className="mb-2 flex items-baseline justify-between text-[12.5px]">
              <span className="font-medium text-ink">{progresso.pagina < progresso.total ? "Lendo o relatório" : "Conferindo com a base…"}</span>
              <span className="tabular text-muted">
                página {int(progresso.pagina)} de {int(progresso.total)}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-line/70">
              <div
                className="h-full rounded-full bg-[#2E5FA8] transition-[width]"
                style={{ width: `${progresso.total ? Math.round((progresso.pagina / progresso.total) * 100) : 0}%` }}
              />
            </div>
          </div>
        )}

        {previa && (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mb-3 text-[12px] leading-relaxed text-muted">
              {previa.arquivo.nome} · {int(previa.arquivo.ordens)} O.S., {int(previa.arquivo.talhoes)} talhões, {int(previa.arquivo.insumos)} linhas de insumos (
              {int(previa.arquivo.produtos)} produtos) · Data da O.S. de {previa.arquivo.periodo} · relatório emitido em {dataBR(previa.arquivo.geradoEm)}
              {previa.arquivo.paginas ? ` · ${int(previa.arquivo.paginas)} páginas` : ""}
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              <Contagem rotulo="Novas" valor={previa.novas} destaque={previa.novas > 0} />
              <Contagem rotulo={feito ? "Substituídas" : "Com alteração"} valor={previa.alteradas} destaque={previa.alteradas > 0} />
              <Contagem rotulo="Sem alteração" valor={previa.iguais} />
              <Contagem rotulo={feito ? "Tiradas da base" : "Não vieram (no período)"} valor={feito ? previa.removidas : ausentes} alerta={ausentes > 0} />
              <Contagem rotulo="Só na base (fora do período)" valor={previa.foraDoArquivo} />
            </div>

            {enc && enc.identificadas + enc.mantidas + enc.semData + enc.reabertas > 0 && (
              <div className="mt-3 rounded-md border border-line bg-surface px-3 py-2 text-[12.5px] text-ink">
                <div className="mb-0.5 font-medium">Encerramento</div>
                <ul className="flex flex-wrap gap-x-4 gap-y-0.5 text-muted">
                  {enc.identificadas > 0 && (
                    <li>
                      <b className="font-semibold text-ink">{int(enc.identificadas)}</b> encerrada(s) nesta leitura · data {dataBR(previa.arquivo.geradoEm)}
                    </li>
                  )}
                  {enc.mantidas > 0 && (
                    <li>
                      <b className="font-semibold text-ink">{int(enc.mantidas)}</b> já encerrada(s): mantêm a data da base
                    </li>
                  )}
                  {enc.semData > 0 && (
                    <li title="O.S. que entram na base já encerradas e são anteriores à última importação: a data em que encerraram não é conhecida">
                      <b className="font-semibold text-ink">{int(enc.semData)}</b> entram já encerradas, sem data conhecida
                    </li>
                  )}
                  {enc.reabertas > 0 && (
                    <li>
                      <b className="font-semibold text-ink">{int(enc.reabertas)}</b> reaberta(s): ficam sem data de encerramento
                    </li>
                  )}
                </ul>
              </div>
            )}

            {previa.arquivo.avisos?.length > 0 && (
              <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800">
                <div className="mb-0.5 font-medium">Avisos da leitura</div>
                <ul className="list-disc pl-4">
                  {previa.arquivo.avisos.map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ul>
              </div>
            )}
            {previa.arquivo.descartadas > 0 && (
              <p className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800">
                {int(previa.arquivo.descartadas)} O.S. do arquivo sem talhões ou sem operação não foram consideradas.
              </p>
            )}

            {ausentes > 0 && (
              <div className="mt-4">
                <div className="mb-1.5 text-[12.5px] font-medium text-ink">
                  O.S. da base com a data no período do arquivo que não vieram nele ({int(ausentes)})
                </div>
                {!feito && (
                  <label className="mb-2 flex items-start gap-2 rounded-md border border-line bg-surface px-3 py-2 text-[12.5px] text-ink">
                    <input type="checkbox" className="mt-0.5" checked={remover} onChange={(e) => setRemover(e.target.checked)} />
                    <span>
                      Tirar estas O.S. da base (canceladas no ERP). Sem marcar, elas continuam como estão. O conteúdo delas fica guardado no histórico
                      {previa.boletinsAusentes > 0
                        ? ` e os ${int(previa.boletinsAusentes)} boletins lançados nelas ficam, com a linha em vermelho na tela Apontamento (O.S. fora da base).`
                        : "."}
                    </span>
                  </label>
                )}
                <div className="max-h-56 overflow-y-auto rounded-lg border border-line">
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr className="bg-surface text-left text-muted">
                        <th className="px-3 py-1.5 font-medium">O.S.</th>
                        <th className="px-3 py-1.5 font-medium">Data da OS</th>
                        <th className="px-3 py-1.5 font-medium">Fazendas</th>
                        <th className="px-3 py-1.5 font-medium">Situação</th>
                        <th className="px-3 py-1.5 text-right font-medium">Operações</th>
                        <th className="px-3 py-1.5 text-right font-medium">Boletins</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previa.listaAusentes.map((x) => (
                        <tr key={x.os} className={`border-t border-line/60 ${x.boletins ? "bg-alert-50/60" : ""}`}>
                          <td className="px-3 py-1.5 tabular font-medium text-ink">{x.os}</td>
                          <td className="px-3 py-1.5 tabular">{dataBR(x.dt)}</td>
                          <td className="max-w-[180px] truncate px-3 py-1.5" title={x.fazendas}>
                            {x.fazendas || "–"}
                          </td>
                          <td className="px-3 py-1.5 text-muted">{x.posicao || "–"}</td>
                          <td className="px-3 py-1.5 text-right tabular">{x.operacoes}</td>
                          <td className={`px-3 py-1.5 text-right tabular ${x.boletins ? "font-semibold text-alert-700" : "text-muted"}`}>{x.boletins || "–"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {ausentes > previa.listaAusentes.length && (
                  <p className="mt-1 text-[11.5px] text-muted">
                    Mostrando {previa.listaAusentes.length} de {int(ausentes)}.
                  </p>
                )}
              </div>
            )}

            {previa.alteradas > 0 && mud && (
              <div className="mt-4">
                <div className="mb-1.5 text-[12.5px] font-medium text-ink">O que mudou nas O.S. com alteração</div>
                <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted">
                  <li>Situação: {int(mud.posicao)}</li>
                  <li>Encerradas: {int(mud.encerradas)}</li>
                  {mud.reabertas > 0 && <li>Reabertas: {int(mud.reabertas)}</li>}
                  <li>Talhões: {int(mud.talhoes)}</li>
                  <li>Áreas: {int(mud.areas)}</li>
                  <li>Insumos: {int(mud.insumos)}</li>
                  {mud.conversao > 0 && <li>Passam da planilha para o PDF: {int(mud.conversao)}</li>}
                  <li>Outras informações: {int(mud.outros)}</li>
                </ul>
                <div className="max-h-56 overflow-y-auto rounded-lg border border-line">
                  <table className="w-full text-[12px]">
                    <tbody>
                      {previa.exemplos.map((x) => (
                        <tr key={x.os} className="border-t border-line/60 first:border-t-0">
                          <td className="w-20 px-3 py-1.5 tabular font-medium text-ink">{x.os}</td>
                          <td className="px-3 py-1.5 text-muted">{x.texto}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {previa.alteradas > previa.exemplos.length && (
                  <p className="mt-1 text-[11.5px] text-muted">
                    Mostrando {previa.exemplos.length} de {int(previa.alteradas)}.
                  </p>
                )}
              </div>
            )}
            {feito && <p className="mt-4 rounded-md border border-good-500/40 bg-good-50 px-3 py-2 text-[12.5px] text-good-700">Base de O.S. atualizada.</p>}
            {!feito && nada && (
              <p className="mt-4 rounded-md border border-line bg-surface px-3 py-2 text-[12.5px] text-muted">Nada a gravar: a base já está igual ao arquivo.</p>
            )}
          </div>
        )}

        {erro && <p className="mt-3 rounded-md border border-alert-500/40 bg-alert-50 px-3 py-2 text-[12.5px] text-alert-700">{erro}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => onFechar(feito)}
            disabled={enviando && !previa}
            className="rounded-lg border border-line px-4 py-1.5 text-[12.5px] text-ink hover:bg-surface disabled:opacity-40"
          >
            {feito ? "Fechar" : "Cancelar"}
          </button>
          {!previa && (
            <button
              type="button"
              disabled={!arquivo || enviando}
              onClick={lerEConferir}
              className="rounded-lg bg-navy-900 px-4 py-1.5 text-[12.5px] font-medium text-white hover:bg-navy-800 disabled:opacity-40"
            >
              {enviando ? "Lendo…" : "Ler e conferir"}
            </button>
          )}
          {previa && !feito && !nada && (
            <button
              type="button"
              disabled={enviando}
              onClick={gravar}
              className="rounded-lg bg-navy-900 px-4 py-1.5 text-[12.5px] font-medium text-white hover:bg-navy-800 disabled:opacity-40"
            >
              {enviando ? "Gravando…" : botaoGravar}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Contagem({ rotulo, valor, destaque, alerta = false }) {
  return (
    <div
      className={`rounded-lg border px-3 py-2 ${alerta ? "border-alert-500/40 bg-alert-50" : destaque ? "border-[#2E5FA8]/30 bg-[#2E5FA8]/[0.06]" : "border-line bg-surface"}`}
    >
      <div className="text-[11.5px] text-muted">{rotulo}</div>
      <div className={`tabular text-[19px] font-semibold ${alerta ? "text-alert-700" : "text-ink"}`}>{valor.toLocaleString("pt-BR")}</div>
    </div>
  );
}
