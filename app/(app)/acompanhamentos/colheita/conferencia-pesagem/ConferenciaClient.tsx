"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ModalShell } from "@/components/ui";
import {
  conferirLinhas,
  normalizarFrente,
  STATUS_CONFERENCIA_LABEL,
  type StatusConferencia,
} from "@/lib/conferencia";
import { fmtDateBR, fmtT } from "@/lib/format";
import { gerarConferenciaPdf, gerarConferenciaXlsx } from "@/lib/relatorio-conferencia";
import { podeEditar } from "@/lib/permissoes";
import type { ConferenciaLinha, EquiptoFrente, OrdemConferencia, PerfilUsuario } from "@/lib/types";
import { ehBooleano, ehDataIso, ehTexto, ehUmDe, usarPersistido } from "@/lib/usar-persistido";

const FILTRO =
  "rounded-md border border-line bg-card px-2.5 py-1.5 text-[12.5px] text-ink focus:border-brand-600 focus:outline-none";

const COR_STATUS: Record<StatusConferencia, string> = {
  ok: "bg-good-50 text-good-600",
  "frente-divergente": "bg-alert-50 text-alert-600",
  "ordem-outra-frente": "bg-amber-50 text-amber-600",
  "sem-ordem": "bg-amber-50 text-amber-600",
  "sem-cadastro": "bg-surface text-muted",
};

export default function ConferenciaClient({
  linhas,
  equiptos,
  ordens,
  perfil,
  nomeUsuario,
}: {
  linhas: ConferenciaLinha[];
  equiptos: EquiptoFrente[];
  ordens: OrdemConferencia[];
  perfil: PerfilUsuario;
  nomeUsuario: string;
}) {
  const podeGravar = podeEditar(perfil);
  const [importarAberto, setImportarAberto] = useState(false);
  const [exportando, setExportando] = useState<"pdf" | "xlsx" | null>(null);
  // correções lançadas nesta sessão (valem na hora, antes da página recarregar)
  const [correcoes, setCorrecoes] = useState<Record<string, string>>({});

  const conferidas = useMemo(() => conferirLinhas(linhas, equiptos, ordens), [linhas, equiptos, ordens]);

  // abre na data mais recente importada; apagar a data tira o limite
  const ultimaData = useMemo(() => linhas.reduce((m, l) => (l.data > m ? l.data : m), ""), [linhas]);
  const [de, setDe] = useState(ultimaData);
  const [ate, setAte] = useState(ultimaData);
  const [frenteFiltro, setFrenteFiltro] = usarPersistido("conferencia.frente", "todas", ehTexto);
  const [statusFiltro, setStatusFiltro] = usarPersistido<"todos" | "divergencias" | StatusConferencia>("conferencia.status", "todos", ehTexto as (v: unknown) => v is "todos" | "divergencias" | StatusConferencia);
  const [busca, setBusca] = usarPersistido("conferencia.busca", "", ehTexto);

  const frentes = useMemo(
    () =>
      Array.from(
        new Set(conferidas.flatMap((l) => [l.frente, l.frenteCadastro].filter((f): f is string => !!f)))
      ).sort((a, b) => a.localeCompare(b)),
    [conferidas]
  );

  const frentesDisponiveis = useMemo(
    () =>
      Array.from(new Set([...frentes, ...ordens.map((o) => o.frente), ...equiptos.map((e) => e.frente)])).sort((a, b) =>
        a.localeCompare(b)
      ),
    [frentes, ordens, equiptos]
  );

  const filtradas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return conferidas
      .filter((l) => (!de || l.data >= de) && (!ate || l.data <= ate))
      .filter(
        (l) =>
          frenteFiltro === "todas" ||
          normalizarFrente(l.frente) === normalizarFrente(frenteFiltro) ||
          (l.frenteCadastro !== null && normalizarFrente(l.frenteCadastro) === normalizarFrente(frenteFiltro))
      )
      .filter((l) =>
        statusFiltro === "todos" ? true : statusFiltro === "divergencias" ? l.conferencia !== "ok" : l.conferencia === statusFiltro
      )
      .filter(
        (l) =>
          !termo ||
          l.eqp.toLowerCase().includes(termo) ||
          l.eqpNome.toLowerCase().includes(termo) ||
          l.fazendaNomeExibido.toLowerCase().includes(termo) ||
          l.fazendaCodigo.includes(termo) ||
          (l.ordemNumero ?? "").includes(termo)
      )
      .sort(
        (a, b) =>
          a.data.localeCompare(b.data) ||
          a.eqp.localeCompare(b.eqp, undefined, { numeric: true }) ||
          a.fazendaCodigo.localeCompare(b.fazendaCodigo)
      );
  }, [conferidas, de, ate, frenteFiltro, statusFiltro, busca]);

  const chaveLinha = (l: { data: string; eqp: string; frente: string; fazendaCodigo: string }) =>
    `${l.data}|${l.eqp}|${l.frente}|${l.fazendaCodigo}`;
  const correcaoDe = (l: ConferenciaLinha & { frenteCorrecao?: string | null }) =>
    correcoes[chaveLinha(l)] ?? l.frenteCorrecao ?? "";

  async function lancarCorrecao(l: ConferenciaLinha, frenteCorreta: string) {
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
    const partes: string[] = [];
    if (de || ate) partes.push(`Período ${de ? fmtDateBR(de) : "início"} a ${ate ? fmtDateBR(ate) : "hoje"}`);
    if (frenteFiltro !== "todas") partes.push(`Frente: ${frenteFiltro}`);
    if (statusFiltro !== "todos") {
      partes.push(
        `Status: ${statusFiltro === "divergencias" ? "só o que precisa conferir" : STATUS_CONFERENCIA_LABEL[statusFiltro]}`
      );
    }
    if (busca.trim()) partes.push(`Busca: ${busca.trim()}`);
    return partes.join(" · ");
  }, [de, ate, frenteFiltro, statusFiltro, busca]);

  async function exportar(tipo: "pdf" | "xlsx") {
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

  return (
    <div className="print-scroll flex min-w-0 flex-1 flex-col overflow-hidden">
      <header className="flex flex-shrink-0 items-center gap-3 border-b border-line bg-card px-6 py-3 print:hidden">
        <nav className="min-w-0 flex-1 text-[13px] text-muted">
          <span className="text-[11px] uppercase tracking-wide">Acompanhamentos · Colheita</span>
          <div className="truncate text-[15px] font-bold text-ink">Conferência de Pesagem</div>
        </nav>
        {!podeGravar && (
          <div className="rounded-full border border-line bg-surface px-3 py-1.5 text-[12px] font-semibold text-muted">
            Somente leitura
          </div>
        )}
        {linhas.length > 0 && (
          <div className="flex items-center gap-1.5 print:hidden">
            <button
              type="button"
              onClick={() => window.print()}
              className="rounded-lg border border-line bg-card px-3 py-2 text-[13px] font-semibold text-navy-800 shadow-card hover:bg-surface"
            >
              Imprimir
            </button>
            <button
              type="button"
              disabled={exportando !== null}
              onClick={() => exportar("pdf")}
              className="rounded-lg border border-line bg-card px-3 py-2 text-[13px] font-semibold text-navy-800 shadow-card hover:bg-surface disabled:opacity-50"
            >
              {exportando === "pdf" ? "Gerando…" : "PDF"}
            </button>
            <button
              type="button"
              disabled={exportando !== null}
              onClick={() => exportar("xlsx")}
              className="rounded-lg border border-line bg-card px-3 py-2 text-[13px] font-semibold text-navy-800 shadow-card hover:bg-surface disabled:opacity-50"
            >
              {exportando === "xlsx" ? "Gerando…" : "Excel"}
            </button>
          </div>
        )}
        {podeGravar && (
          <button
            type="button"
            onClick={() => setImportarAberto(true)}
            className="rounded-lg bg-navy-900 px-3.5 py-2 text-[13px] font-semibold text-white shadow-card hover:bg-navy-800 print:hidden"
          >
            Importar arquivos
          </button>
        )}
      </header>

      <div className="print-scroll flex-1 overflow-y-auto px-6 py-5">
        <div className="mb-3 hidden print:block">
          <div className="text-[16px] font-bold text-ink">Conferência de Pesagem — CRV Industrial</div>
          <div className="text-[11px] text-muted">
            {filtrosTexto || "Todos os registros importados"} · Gerado por {nomeUsuario} em{" "}
            {new Date().toLocaleString("pt-BR")}
          </div>
        </div>
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-xl2 border border-line bg-card px-4 py-3 shadow-card">
            <div className="text-[11.5px] font-semibold text-muted">Toneladas (t)</div>
            <div className="text-[20px] font-bold text-ink">{fmtT(totais.toneladas)}</div>
          </div>
          <div className="rounded-xl2 border border-line bg-card px-4 py-3 shadow-card">
            <div className="text-[11.5px] font-semibold text-muted">Equipamentos</div>
            <div className="text-[20px] font-bold text-ink">{totais.equipamentos}</div>
          </div>
          <div className="rounded-xl2 border border-line bg-card px-4 py-3 shadow-card">
            <div className="text-[11.5px] font-semibold text-muted">Linhas a conferir</div>
            <div className={`text-[20px] font-bold ${totais.divergencias > 0 ? "text-alert-600" : "text-good-600"}`}>
              {totais.divergencias}
            </div>
          </div>
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
          <div className="overflow-hidden rounded-xl2 border border-line bg-card shadow-card">
            <div className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-4 py-2.5 print:hidden">
              <h2 className="text-[14px] font-bold text-ink">Conferência</h2>
              <label className="flex items-center gap-1.5 text-[12px] text-muted">
                De
                <input type="date" value={de} onChange={(e) => setDe(e.target.value)} className={FILTRO} />
              </label>
              <label className="flex items-center gap-1.5 text-[12px] text-muted">
                Até
                <input type="date" value={ate} onChange={(e) => setAte(e.target.value)} className={FILTRO} />
              </label>
              <select
                value={frenteFiltro}
                onChange={(e) => setFrenteFiltro(e.target.value)}
                aria-label="Filtrar por frente"
                className={FILTRO}
              >
                <option value="todas">Todas as frentes</option>
                {frentes.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
              <select
                value={statusFiltro}
                onChange={(e) => setStatusFiltro(e.target.value as typeof statusFiltro)}
                aria-label="Filtrar por status"
                className={FILTRO}
              >
                <option value="todos">Todos os status</option>
                <option value="divergencias">Só o que precisa conferir</option>
                {(Object.keys(STATUS_CONFERENCIA_LABEL) as StatusConferencia[]).map((s) => (
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
              <span className="ml-auto text-[12px] text-muted">
                {filtradas.length} linha{filtradas.length === 1 ? "" : "s"}
              </span>
            </div>
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
                      <td className="px-3 py-1.5 text-ink">
                        {l.fazendaCodigo} - {l.fazendaNomeExibido}
                      </td>
                      <td className="px-3 py-1.5 text-ink">{l.ordemNumero ?? "—"}</td>
                      <td className="px-3 py-1.5 text-ink">{l.ordemFrente ?? "—"}</td>
                      <td className="px-3 py-1.5 text-muted">{l.ordemStatus ?? "—"}</td>
                      <td className="px-3 py-1.5 text-right font-semibold tabular text-ink">{fmtT(l.toneladas)}</td>
                      <td className="px-3 py-1.5">
                        <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold ${COR_STATUS[l.conferencia]}`}>
                          {STATUS_CONFERENCIA_LABEL[l.conferencia]}
                        </span>
                      </td>
                      <td className="bg-brand-50/30 px-3 py-1.5 font-semibold text-ink">
                        {correcaoDe(l) ? l.eqp : ""}
                      </td>
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
                    <td className="px-4 py-1.5" colSpan={9}>
                      Total geral
                    </td>
                    <td className="px-3 py-1.5 text-right tabular">{fmtT(totais.toneladas)}</td>
                    <td className="px-3 py-1.5" colSpan={3} />
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="border-t border-line bg-surface px-4 py-2 text-[11.5px] leading-relaxed text-muted">
              Ordem: entre as ordens da fazenda, usa a da mesma frente do cadastro do equipamento — a aberta mais
              recente ou, se não houver aberta, a encerrada mais recente. &quot;Frente divergente&quot;: o relatório
              colocou o equipamento numa frente diferente do cadastro (Equipto Frente) na data.
            </p>
          </div>
        )}
      </div>

      {importarAberto && <ImportarModal onFechar={() => setImportarAberto(false)} />}
    </div>
  );
}

interface Slot {
  arquivo: File | null;
  data: string;
}

interface ResultadoArquivo {
  nome: string;
  data: string;
  ok: boolean;
  linhas: number;
  toneladas: number;
  avisos: string[];
  erro?: string;
}

const MAX_SLOTS = 10;

function ImportarModal({ onFechar }: { onFechar: () => void }) {
  const router = useRouter();
  const [slots, setSlots] = useState<Slot[]>([{ arquivo: null, data: "" }]);
  const [enviando, setEnviando] = useState(false);
  const [resultados, setResultados] = useState<ResultadoArquivo[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  function atualizar(i: number, parcial: Partial<Slot>) {
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
        Envie de <b className="text-ink">1 a {MAX_SLOTS} arquivos</b> do relatório &quot;Frentes por Especialidade - Cana
        Moagem&quot; e informe a <b className="text-ink">data de cada arquivo</b>. Importar uma data que já existe
        substitui os dados daquele dia.
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

      {erro && (
        <div className="mt-3 rounded-lg border border-alert-500/30 bg-alert-50 px-3 py-2 text-[12.5px] text-alert-600">
          {erro}
        </div>
      )}

      {resultados && (
        <div className="mt-3 space-y-1.5">
          {resultados.map((r, i) => (
            <div
              key={i}
              className={`rounded-lg border px-3 py-2 text-[12.5px] ${
                r.ok
                  ? "border-good-500/30 bg-good-50 text-good-600"
                  : "border-alert-500/30 bg-alert-50 text-alert-600"
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
        <button
          type="button"
          onClick={onFechar}
          className="rounded-lg border border-line px-4 py-2 text-[13px] font-semibold text-ink"
        >
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
