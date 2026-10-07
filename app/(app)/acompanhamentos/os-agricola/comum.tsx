"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { IconImportar } from "@/components/icons";
import type { OpcoesOS } from "@/lib/db-os-agr";
import { exportarPlanilha, type ColunaExportacao, type FormatoExportacao } from "@/lib/exportar-planilha";
import type { PreviaImportacaoOS } from "@/lib/os-agr";
import { usarPersistido } from "@/lib/usar-persistido";

export const FILTRO =
  "rounded-md border border-line bg-card px-2.5 py-1.5 text-[12.5px] text-ink focus:border-brand-600 focus:outline-none";

export interface FiltrosOS {
  de: string;
  ate: string;
  safra: string;
  posicao: string;
  resp: string;
  etapa: string;
}
const VAZIO: FiltrosOS = { de: "", ate: "", safra: "", posicao: "", resp: "", etapa: "" };
const ehFiltros = (v: unknown): v is FiltrosOS =>
  !!v && typeof v === "object" && Object.keys(VAZIO).every((k) => typeof (v as Record<string, unknown>)[k] === "string");

/** Filtros comuns ao Dashboard e às Ordens de Serviço (lembrados entre as duas telas). */
export function usarFiltrosOS() {
  return usarPersistido<FiltrosOS>("os-agr.filtros", VAZIO, ehFiltros);
}

export function paramsDosFiltros(f: FiltrosOS): URLSearchParams {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v) p.set(k, v);
  return p;
}

export function usarOpcoesOS(recarregar: number) {
  const [opcoes, setOpcoes] = useState<OpcoesOS | null>(null);
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

/** Barra de filtros: período (data da O.S.), safra, posição, solicitante e etapa; `extra` entra no fim. */
export function BarraFiltrosOS({ f, setF, opcoes, extra }: { f: FiltrosOS; setF: (f: FiltrosOS) => void; opcoes: OpcoesOS | null; extra?: ReactNode }) {
  const mudar = (p: Partial<FiltrosOS>) => setF({ ...f, ...p });
  const algum = Object.values(f).some(Boolean);
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
      {extra}
      {algum && (
        <button type="button" onClick={() => setF(VAZIO)} className="px-1 pb-1.5 text-[12px] text-muted underline-offset-2 hover:text-ink hover:underline">
          Limpar filtros
        </button>
      )}
    </div>
  );
}

export const corPosicao = (p: string) =>
  p === "E" ? "bg-good-50 text-good-700 border-good-500/30" : p === "L" ? "bg-[#2E5FA8]/10 text-[#2E5FA8] border-[#2E5FA8]/25" : "bg-[#D77B38]/10 text-[#B5602A] border-[#D77B38]/30";

export function SeloPosicao({ p }: { p: string }) {
  const nome = p === "E" ? "Encerrada" : p === "L" ? "Liberada" : p === "A" ? "Aberta" : p || "—";
  return <span className={`inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium ${corPosicao(p)}`}>{nome}</span>;
}

/** Botão com as duas opções de exportação (CSV e XLSX); `buscar` traz todas as linhas do filtro atual. */
export function BotaoExportar<T>({ nome, colunas, buscar }: { nome: string; colunas: ColunaExportacao<T>[]; buscar: () => Promise<T[]> }) {
  const [aberto, setAberto] = useState(false);
  const [gerando, setGerando] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!aberto) return;
    const fechar = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setAberto(false);
    document.addEventListener("mousedown", fechar);
    return () => document.removeEventListener("mousedown", fechar);
  }, [aberto]);
  async function gerar(formato: FormatoExportacao) {
    setAberto(false);
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
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={gerando}
        onClick={() => setAberto((a) => !a)}
        className="rounded-lg border border-line bg-card px-3.5 py-1.5 text-[13px] font-medium text-navy-800 shadow-card hover:bg-surface disabled:opacity-50"
        aria-haspopup="menu"
        aria-expanded={aberto}
      >
        {gerando ? "Exportando…" : "Exportar"}
      </button>
      {aberto && (
        <div role="menu" className="absolute right-0 z-30 mt-1 w-44 overflow-hidden rounded-lg border border-line bg-card py-1 shadow-pop">
          <button type="button" role="menuitem" onClick={() => gerar("xlsx")} className="block w-full px-3 py-1.5 text-left text-[12.5px] text-ink hover:bg-surface">
            Planilha Excel (.xlsx)
          </button>
          <button type="button" role="menuitem" onClick={() => gerar("csv")} className="block w-full px-3 py-1.5 text-left text-[12.5px] text-ink hover:bg-surface">
            Texto separado (.csv)
          </button>
        </div>
      )}
    </div>
  );
}

export function BotaoImportarOS({ onImportado }: { onImportado: () => void }) {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="flex items-center gap-1.5 rounded-lg border border-line bg-card px-3.5 py-1.5 text-[13px] font-medium text-navy-800 shadow-card hover:bg-surface"
      >
        <IconImportar size={14} />
        Importar O.S.
      </button>
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

/** Importação em dois passos: confere o arquivo contra a base (prévia) e só grava depois de confirmar. */
function ImportarOSModal({ onFechar }: { onFechar: (importou: boolean) => void }) {
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [previa, setPrevia] = useState<PreviaImportacaoOS | null>(null);
  const [feito, setFeito] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function enviar(aplicar: boolean) {
    if (!arquivo) return;
    setEnviando(true);
    setErro(null);
    try {
      const form = new FormData();
      form.append("arquivo", arquivo);
      form.append("aplicar", aplicar ? "1" : "0");
      const res = await fetch("/api/os-agricola/importar", { method: "POST", body: form });
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

  const nada = previa && previa.novas + previa.alteradas === 0;
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
          Use o Relatório de Ordens de Serviço das Etapas (.xlsx). Cada O.S. do arquivo é comparada com a base: as novas entram, as que mudaram
          (posição, encerramento, talhões, áreas…) são substituídas e as iguais ficam como estão. O.S. que não vierem no arquivo continuam na base.
        </p>

        {!previa && (
          <label className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-line bg-surface px-4 py-6 text-center text-[12.5px] text-muted hover:border-brand-600">
            <span className="font-medium text-ink">{arquivo ? arquivo.name : "Escolher o arquivo"}</span>
            <span>{arquivo ? `${(arquivo.size / 1024 / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB` : "Relatório de Ordens de Serviço (.xlsx)"}</span>
            <input type="file" accept=".xlsx" className="sr-only" onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} />
          </label>
        )}

        {previa && (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mb-3 text-[12px] text-muted">
              {arquivo?.name} · {previa.arquivo.ordens.toLocaleString("pt-BR")} O.S. em {previa.arquivo.linhas.toLocaleString("pt-BR")} linhas
              {previa.arquivo.periodo ? ` · período ${previa.arquivo.periodo}` : ""}
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Contagem rotulo="Novas" valor={previa.novas} destaque={previa.novas > 0} />
              <Contagem rotulo={feito ? "Substituídas" : "Com alteração"} valor={previa.alteradas} destaque={previa.alteradas > 0} />
              <Contagem rotulo="Sem alteração" valor={previa.iguais} />
              <Contagem rotulo="Só na base" valor={previa.foraDoArquivo} />
            </div>
            {previa.alteradas > 0 && (
              <div className="mt-4">
                <div className="mb-1.5 text-[12.5px] font-medium text-ink">O que mudou nas O.S. com alteração</div>
                <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted">
                  <li>Posição: {previa.mudancas.posicao}</li>
                  <li>Encerradas: {previa.mudancas.encerradas}</li>
                  <li>Talhões: {previa.mudancas.talhoes}</li>
                  <li>Áreas: {previa.mudancas.areas}</li>
                  <li>Outras informações: {previa.mudancas.outros}</li>
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
                {previa.alteradas > previa.exemplos.length && <p className="mt-1 text-[11.5px] text-muted">Mostrando {previa.exemplos.length} de {previa.alteradas}.</p>}
              </div>
            )}
            {feito && <p className="mt-4 rounded-md border border-good-500/40 bg-good-50 px-3 py-2 text-[12.5px] text-good-700">Base de O.S. atualizada.</p>}
            {!feito && nada && <p className="mt-4 rounded-md border border-line bg-surface px-3 py-2 text-[12.5px] text-muted">Nada a gravar: a base já está igual ao arquivo.</p>}
          </div>
        )}

        {erro && <p className="mt-3 rounded-md border border-alert-500/40 bg-alert-50 px-3 py-2 text-[12.5px] text-alert-700">{erro}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={() => onFechar(feito)} className="rounded-lg border border-line px-4 py-1.5 text-[12.5px] text-ink hover:bg-surface">
            {feito ? "Fechar" : "Cancelar"}
          </button>
          {!previa && (
            <button type="button" disabled={!arquivo || enviando} onClick={() => enviar(false)} className="rounded-lg bg-navy-900 px-4 py-1.5 text-[12.5px] font-medium text-white hover:bg-navy-800 disabled:opacity-40">
              {enviando ? "Conferindo…" : "Conferir arquivo"}
            </button>
          )}
          {previa && !feito && !nada && (
            <button type="button" disabled={enviando} onClick={() => enviar(true)} className="rounded-lg bg-navy-900 px-4 py-1.5 text-[12.5px] font-medium text-white hover:bg-navy-800 disabled:opacity-40">
              {enviando ? "Gravando…" : `Gravar ${previa.novas + previa.alteradas} O.S.`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Contagem({ rotulo, valor, destaque }: { rotulo: string; valor: number; destaque?: boolean }) {
  return (
    <div className={`rounded-lg border px-3 py-2 ${destaque ? "border-[#2E5FA8]/30 bg-[#2E5FA8]/[0.06]" : "border-line bg-surface"}`}>
      <div className="text-[11.5px] text-muted">{rotulo}</div>
      <div className="tabular text-[19px] font-semibold text-ink">{valor.toLocaleString("pt-BR")}</div>
    </div>
  );
}
