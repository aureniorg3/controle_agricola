"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { IconAtualizar, IconBaixar } from "@/components/icons";
import { BarraFiltros, CabecalhoPagina, Comando, CorpoPagina, Indicador, Pagina } from "@/components/pagina";

import { ehBooleano, ehTexto, usarPersistido } from "@/lib/usar-persistido";
import BotaoLimparFiltros from "@/components/BotaoLimparFiltros";

const ROTULO_SEVERIDADE = { erro: "Erro", atencao: "Atenção", info: "Informação" };
const COR_SEVERIDADE = {
  erro: "border-alert-500/40 bg-alert-50 text-alert-700",
  atencao: "border-amber-500/40 bg-amber-50 text-amber-700",
  info: "border-brand-200 bg-brand-50 text-brand-800",
};
const ORDEM = { erro: 0, atencao: 1, info: 2 };

export default function ValidacoesClient() {
  const [dados, setDados] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(null);
  const [soDivergencias, setSoDivergencias] = usarPersistido("validacoes.soDivergencias", true, ehBooleano);
  const [modulo, setModulo] = usarPersistido("validacoes.modulo", "", ehTexto);
  const algumFiltroAtivo = soDivergencias !== true || modulo !== "";
  function limparFiltros() {
    setSoDivergencias(true);
    setModulo("");
  }
  const [abertas, setAbertas] = useState(new Set());

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

  function alternar(id) {
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
    const nomesUsados = new Set(["Resumo"]);
    for (const v of dados.verificacoes.filter((x) => x.total > 0)) {
      let nome =
        v.titulo
          .replace(/[\\/?*[\]:]/g, " ")
          .slice(0, 28)
          .trim() || v.id;
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
    <Pagina>
      <CabecalhoPagina
        titulo="Validações"
        categoria="Configurações"
        info={dados && <span>Verificado em {new Date(dados.executadoEm).toLocaleString("pt-BR")}</span>}
        comandos={
          <>
            <Comando primario icone={<IconAtualizar size={16} />} onClick={executar} disabled={carregando}>
              {carregando ? "Verificando…" : "Executar validações"}
            </Comando>
            <Comando icone={<IconBaixar size={16} />} onClick={exportar} disabled={!dados || carregando}>
              Exportar Excel
            </Comando>
          </>
        }
      />

      <CorpoPagina>
        <p className="mb-4 max-w-3xl text-[12.5px] leading-relaxed text-muted">
          Cruza os dados dos módulos (Colheita, Rodadas de Campo e cadastros) e lista o que não se encontra, com o que fazer para corrigir. Rode de novo depois
          de importar ou corrigir. A cada recurso novo do sistema, as verificações dele entram aqui.
        </p>

        {erro && <p className="mb-3 text-[12.5px] font-medium text-alert-600">{erro}</p>}

        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Resumo rotulo="Erros" valor={resumo.erros} cor="vermelho" />
          <Resumo rotulo="Atenção" valor={resumo.atencoes} cor="amarelo" />
          <Resumo rotulo="Informação" valor={resumo.infos} cor="azul" />
          <Resumo rotulo="Sem divergência" valor={resumo.ok} cor="verde" />
        </div>

        <BarraFiltros>
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
          <label className="flex cursor-pointer items-center gap-2 pb-1.5 text-[12.5px] text-ink">
            <input type="checkbox" checked={soDivergencias} onChange={(e) => setSoDivergencias(e.target.checked)} />
            Mostrar só o que tem divergência
          </label>
          <BotaoLimparFiltros ativo={algumFiltroAtivo} onLimpar={limparFiltros} />
        </BarraFiltros>

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
      </CorpoPagina>
    </Pagina>
  );
}

function Resumo({ rotulo, valor, cor }) {
  return <Indicador cor={cor} rotulo={rotulo} valor={valor} />;
}

function Cartao({ v, aberto, onAlternar }) {
  const ok = v.total === 0 && !v.erroExecucao;
  const sev = v.erroExecucao ? "erro" : v.severidade;
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
                      {typeof l[c] === "number" ? l[c].toLocaleString("pt-BR") : String(l[c] ?? "")}
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
