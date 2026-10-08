"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ResultadoValidacoes, ResultadoVerificacao, Severidade } from "@/lib/validacoes";
import { ehBooleano, ehDataIso, ehTexto, ehUmDe, usarPersistido } from "@/lib/usar-persistido";
import BotaoLimparFiltros from "@/components/BotaoLimparFiltros";

const ROTULO_SEVERIDADE: Record<Severidade, string> = { erro: "Erro", atencao: "Atenção", info: "Informação" };
const COR_SEVERIDADE: Record<Severidade, string> = {
  erro: "border-alert-500/40 bg-alert-50 text-alert-700",
  atencao: "border-amber-500/40 bg-amber-50 text-amber-700",
  info: "border-brand-200 bg-brand-50 text-brand-800",
};
const ORDEM: Record<Severidade, number> = { erro: 0, atencao: 1, info: 2 };

export default function ValidacoesClient() {
  const [dados, setDados] = useState<ResultadoValidacoes | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [soDivergencias, setSoDivergencias] = usarPersistido("validacoes.soDivergencias", true, ehBooleano);
  const [modulo, setModulo] = usarPersistido("validacoes.modulo", "", ehTexto);
  const algumFiltroAtivo = soDivergencias !== true || modulo !== "";
  function limparFiltros() {
    setSoDivergencias(true);
    setModulo("");
  }
  const [abertas, setAbertas] = useState<Set<string>>(new Set());

  const executar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const res = await fetch("/api/validacoes", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Não foi possível executar as validações.");
      setDados(json);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível executar as validações.");
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    executar();
  }, [executar]);

  const modulos = useMemo(() => Array.from(new Set(dados?.verificacoes.map((v) => v.modulo) ?? [])), [dados]);

  const resumo = useMemo(() => {
    const v = dados?.verificacoes ?? [];
    const com = v.filter((x) => x.total > 0 || x.erroExecucao);
    return {
      erros: com.filter((x) => x.severidade === "erro" || x.erroExecucao).length,
      atencoes: com.filter((x) => x.severidade === "atencao" && !x.erroExecucao).length,
      infos: com.filter((x) => x.severidade === "info" && !x.erroExecucao).length,
      ok: v.length - com.length,
    };
  }, [dados]);

  const lista = useMemo(() => {
    const v = (dados?.verificacoes ?? [])
      .filter((x) => (!modulo || x.modulo === modulo) && (!soDivergencias || x.total > 0 || x.erroExecucao))
      .sort((a, b) => Number(b.total > 0) - Number(a.total > 0) || ORDEM[a.severidade] - ORDEM[b.severidade]);
    return v;
  }, [dados, modulo, soDivergencias]);

  function alternar(id: string) {
    setAbertas((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function exportar() {
    if (!dados) return;
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    const linhasResumo = dados.verificacoes.map((v) => ({
      Módulo: v.modulo,
      Verificação: v.titulo,
      Gravidade: ROTULO_SEVERIDADE[v.severidade],
      Divergências: v.total,
      "O que significa": v.descricao,
      "O que fazer": v.acao,
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(linhasResumo), "Resumo");
    const nomesUsados = new Set<string>(["Resumo"]);
    for (const v of dados.verificacoes.filter((x) => x.total > 0)) {
      let nome = v.titulo.replace(/[\\/?*[\]:]/g, " ").slice(0, 28).trim() || v.id;
      let n = 2;
      while (nomesUsados.has(nome)) nome = `${nome.slice(0, 26)} ${n++}`;
      nomesUsados.add(nome);
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(v.linhas), nome);
    }
    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
    XLSX.writeFile(wb, `Validações do Sistema_${stamp}.xlsx`);
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <header className="flex flex-shrink-0 flex-wrap items-center gap-3 border-b border-line bg-card px-4 py-3 md:px-6">
        <nav className="min-w-0 flex-1 text-[13px] text-muted">
          <span className="text-[11px] uppercase tracking-wide">Configurações</span>
          <div className="truncate text-[15px] font-bold text-ink">Validações</div>
        </nav>
        <button
          type="button"
          onClick={exportar}
          disabled={!dados || carregando}
          className="rounded-lg border border-line bg-card px-3.5 py-1.5 text-[13px] font-semibold text-navy-800 shadow-card hover:bg-surface disabled:opacity-50"
        >
          Exportar Excel
        </button>
        <button
          type="button"
          onClick={executar}
          disabled={carregando}
          className="rounded-lg bg-navy-900 px-3.5 py-1.5 text-[13px] font-semibold text-white shadow-card hover:bg-navy-800 disabled:opacity-50"
        >
          {carregando ? "Verificando…" : "Executar validações"}
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4 md:px-6 md:py-5">
        <p className="mb-4 max-w-3xl text-[12.5px] leading-relaxed text-muted">
          Cruza os dados dos módulos (Colheita, Rodadas de Campo e cadastros) e lista o que não se encontra, com o que fazer
          para corrigir. Rode de novo depois de importar ou corrigir. A cada recurso novo do sistema, as verificações dele
          entram aqui.
        </p>

        {erro && <p className="mb-3 text-[12.5px] font-medium text-alert-600">{erro}</p>}

        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Resumo rotulo="Erros" valor={resumo.erros} cor="text-alert-700" />
          <Resumo rotulo="Atenção" valor={resumo.atencoes} cor="text-amber-700" />
          <Resumo rotulo="Informação" valor={resumo.infos} cor="text-brand-800" />
          <Resumo rotulo="Sem divergência" valor={resumo.ok} cor="text-good-700" />
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-3">
          <select
            value={modulo}
            onChange={(e) => setModulo(e.target.value)}
            className="rounded-md border border-line bg-card px-2.5 py-1.5 text-[12.5px] text-ink"
            aria-label="Módulo"
          >
            <option value="">Todos os módulos</option>
            {modulos.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-ink">
            <input type="checkbox" checked={soDivergencias} onChange={(e) => setSoDivergencias(e.target.checked)} />
            Mostrar só o que tem divergência
          </label>
          <BotaoLimparFiltros ativo={algumFiltroAtivo} onLimpar={limparFiltros} />
          {dados && (
            <span className="ml-auto text-[11.5px] text-muted">
              Verificado em {new Date(dados.executadoEm).toLocaleString("pt-BR")}
            </span>
          )}
        </div>

        {carregando && !dados && <p className="text-[12.5px] text-muted">Verificando o sistema…</p>}

        <div className="space-y-3">
          {lista.map((v) => (
            <Cartao key={v.id} v={v} aberto={abertas.has(v.id)} onAlternar={() => alternar(v.id)} />
          ))}
          {dados && lista.length === 0 && (
            <div className="rounded-xl2 border border-dashed border-line bg-card px-6 py-12 text-center text-[13px] text-good-700">
              Nenhuma divergência encontrada nos dados verificados.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Resumo({ rotulo, valor, cor }: { rotulo: string; valor: number; cor: string }) {
  return (
    <div className="rounded-xl2 border border-line bg-card px-4 py-3 shadow-card">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">{rotulo}</div>
      <div className={`mt-0.5 text-[22px] font-extrabold tabular ${cor}`}>{valor}</div>
    </div>
  );
}

function Cartao({ v, aberto, onAlternar }: { v: ResultadoVerificacao; aberto: boolean; onAlternar: () => void }) {
  const ok = v.total === 0 && !v.erroExecucao;
  const sev: Severidade = v.erroExecucao ? "erro" : v.severidade;
  return (
    <div className="overflow-hidden rounded-xl2 border border-line bg-card shadow-card">
      <button type="button" onClick={onAlternar} disabled={ok} className="flex w-full items-start gap-3 px-4 py-3 text-left disabled:cursor-default">
        <span
          className={`mt-0.5 flex-shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${
            ok ? "border-good-500/40 bg-good-50 text-good-700" : COR_SEVERIDADE[sev]
          }`}
        >
          {ok ? "OK" : ROTULO_SEVERIDADE[sev]}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-semibold text-ink">{v.titulo}</span>
          <span className="block text-[11px] uppercase tracking-wide text-muted">{v.modulo}</span>
        </span>
        {!ok && (
          <span className="flex-shrink-0 text-right">
            <span className="block text-[15px] font-extrabold tabular text-ink">{v.erroExecucao ? "!" : v.total.toLocaleString("pt-BR")}</span>
            <span className="block text-[11px] text-muted">{aberto ? "ocultar" : "ver"}</span>
          </span>
        )}
      </button>

      {!ok && (
        <div className="border-t border-line bg-surface px-4 py-2.5 text-[12.5px] leading-relaxed">
          <p className="text-ink">
            <b>O que é:</b> {v.descricao}
          </p>
          <p className="mt-1 text-ink">
            <b>O que fazer:</b> {v.acao}
          </p>
          {v.erroExecucao && <p className="mt-1 font-medium text-alert-600">Não foi possível executar esta verificação: {v.erroExecucao}</p>}
        </div>
      )}

      {aberto && v.linhas.length > 0 && (
        <div className="overflow-x-auto border-t border-line">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-line bg-navy-900 text-left text-white">
                {v.colunas.map((c) => (
                  <th key={c} className="whitespace-nowrap px-3 py-1.5 font-semibold">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {v.linhas.map((l, i) => (
                <tr key={i} className={`border-b border-line/60 ${i % 2 === 1 ? "bg-surface" : "bg-card"}`}>
                  {v.colunas.map((c) => (
                    <td key={c} className="px-3 py-1 text-ink">
                      {typeof l[c] === "number" ? (l[c] as number).toLocaleString("pt-BR") : String(l[c] ?? "")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {v.total > v.linhas.length && (
            <p className="border-t border-line bg-surface px-3 py-1.5 text-[11.5px] text-muted">
              Mostrando {v.linhas.length} de {v.total.toLocaleString("pt-BR")}. Exporte para o Excel para ver todas as linhas amostradas.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
