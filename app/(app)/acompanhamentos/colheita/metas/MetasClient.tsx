"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Campo, ModalShell } from "@/components/ui";
import BotaoLog from "@/components/BotaoLog";
import { fmtDataHora } from "@/components/AuditoriaModal";
import { IconImportar } from "@/components/icons";
import { CabecalhoPagina, Comando, CorpoPagina, Pagina, Painel, rolarCorpoParaOTopo, Selo } from "@/components/pagina";
import { fmtDateBR, fmtT, todayISO } from "@/lib/format";
import { metaDoDia } from "@/lib/period";
import { podeEditar } from "@/lib/permissoes";
import type { AtividadeFrente, MetaFrente, PerfilUsuario } from "@/lib/types";
import { ehBooleano, ehDataIso, ehTexto, ehUmDe, usarPersistido } from "@/lib/usar-persistido";
import BotaoLimparFiltros from "@/components/BotaoLimparFiltros";

const INPUT =
  "w-full rounded-md border border-line bg-card px-3 py-2 text-[13px] text-ink focus:border-brand-600 focus:outline-none";

export default function MetasClient({
  metasIniciais,
  frentes,
  perfil,
}: {
  metasIniciais: MetaFrente[];
  frentes: string[];
  perfil: PerfilUsuario;
}) {
  const router = useRouter();
  const podeGravar = podeEditar(perfil);
  const [frente, setFrente] = useState(frentes[0] ?? "");
  const [meta, setMeta] = useState("");
  const [vigencia, setVigencia] = useState(todayISO());
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [filtroFrente, setFiltroFrente] = usarPersistido("metas.frente", "todas", ehTexto);
  const algumFiltroAtivo = filtroFrente !== "todas";
  function limparFiltros() {
    setFiltroFrente("todas");
  }
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [importarAberto, setImportarAberto] = useState(false);

  const todasFrentes = useMemo(
    () => Array.from(new Set([...frentes, ...metasIniciais.map((m) => m.frente)])).sort((a, b) => a.localeCompare(b)),
    [frentes, metasIniciais]
  );
  const hoje = todayISO();

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    const valor = Number(meta.replace(/\./g, "").replace(",", "."));
    if (!frente) return setErro("Escolha a frente.");
    if (meta.trim() === "" || !Number.isFinite(valor) || valor < 0) {
      return setErro("Informe a meta em toneladas por dia.");
    }
    setSalvando(true);
    try {
      const res = await fetch("/api/metas", {
        method: editandoId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editandoId ?? undefined, frente, metaDiaT: valor, vigencia }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Não foi possível salvar a meta.");
      setMeta("");
      setEditandoId(null);
      router.refresh();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível salvar a meta.");
    } finally {
      setSalvando(false);
    }
  }

  function editar(m: MetaFrente) {
    setErro(null);
    setEditandoId(m.id);
    setFrente(m.frente);
    setMeta(String(m.metaDiaT).replace(".", ","));
    setVigencia(m.vigencia);
    rolarCorpoParaOTopo();
  }

  function cancelarEdicao() {
    setEditandoId(null);
    setMeta("");
    setVigencia(todayISO());
    setErro(null);
  }

  async function excluir(m: MetaFrente) {
    const texto = `Excluir a meta de ${fmtT(m.metaDiaT)} t/dia da ${m.frente} (a partir de ${fmtDateBR(m.vigencia)})?`;
    if (!window.confirm(texto)) return;
    const res = await fetch("/api/metas", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: m.id }),
    });
    if (res.ok) router.refresh();
    else window.alert("Não foi possível excluir a meta.");
  }

  const frentesComMeta = useMemo(
    () => Array.from(new Set(metasIniciais.map((m) => m.frente))).sort((a, b) => a.localeCompare(b)),
    [metasIniciais]
  );

  const linhas = useMemo(
    () =>
      metasIniciais
        .filter((m) => filtroFrente === "todas" || m.frente === filtroFrente)
        .sort((a, b) => a.frente.localeCompare(b.frente) || b.vigencia.localeCompare(a.vigencia)),
    [metasIniciais, filtroFrente]
  );

  function situacao(m: MetaFrente): "vigente" | "futura" | "anterior" {
    if (m.vigencia > hoje) return "futura";
    const vigenteHoje = metaDoDia(metasIniciais, m.frente, hoje);
    const maisRecente = metasIniciais
      .filter((x) => x.frente === m.frente && x.vigencia <= hoje)
      .reduce((a, b) => (b.vigencia > a.vigencia ? b : a), m);
    return maisRecente.id === m.id && vigenteHoje === m.metaDiaT ? "vigente" : "anterior";
  }

  return (
    <Pagina>
      <CabecalhoPagina
        titulo="Metas"
        categoria="Acompanhamentos · Colheita"
        info={
          !podeGravar && (
            <Selo>Somente leitura</Selo>
          )
        }
        comandos={
          <>
            {podeGravar && (
              <Comando primario icone={<IconImportar size={16} />} onClick={() => setImportarAberto(true)}>
                Importar
              </Comando>
            )}
            <BotaoLog titulo="Log das metas" rotulo="Log das metas" filtro={{ modulo: "Colheita", entidade: "Meta" }} />
            <BotaoLog titulo="Log da atividade das frentes" rotulo="Log da atividade" filtro={{ modulo: "Colheita", entidade: "Atividade da frente" }} />
          </>
        }
      />

      <CorpoPagina>
        {podeGravar && (
          <Painel titulo={editandoId ? "Editar meta" : "Cadastrar meta"} className="mb-5">
            <form onSubmit={salvar}>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-[1.2fr_1fr_1fr_auto] md:items-end">
                <Campo label="Frente">
                  <select value={frente} onChange={(e) => setFrente(e.target.value)} className={INPUT}>
                    {todasFrentes.length === 0 && <option value="">Nenhuma frente importada ainda</option>}
                    {todasFrentes.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                </Campo>
                <Campo label="Meta (t/dia)">
                  <input
                    value={meta}
                    onChange={(e) => setMeta(e.target.value)}
                    inputMode="decimal"
                    placeholder="Ex.: 1.500,00"
                    className={INPUT}
                  />
                </Campo>
                <Campo label="Data (vigência)">
                  <input type="date" value={vigencia} onChange={(e) => setVigencia(e.target.value)} className={INPUT} />
                </Campo>
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={salvando || !frente}
                    className="rounded-lg bg-navy-900 px-4 py-2 text-[13px] font-semibold text-white shadow-card hover:bg-navy-800 disabled:opacity-50"
                  >
                    {salvando ? "Salvando…" : editandoId ? "Salvar alteração" : "Cadastrar"}
                  </button>
                  {editandoId && (
                    <button
                      type="button"
                      onClick={cancelarEdicao}
                      className="rounded-lg border border-line bg-card px-4 py-2 text-[13px] font-semibold text-navy-800 shadow-card hover:bg-surface"
                    >
                      Cancelar
                    </button>
                  )}
                </div>
              </div>
              {erro && <p className="mt-2 text-[12.5px] font-medium text-alert-600">{erro}</p>}
              <p className="mt-3 text-[12px] leading-relaxed text-muted">
                A meta é diária (toneladas por dia) e vale da data informada em diante, até uma nova meta da mesma frente.
                Os dias anteriores continuam com a meta antiga (e, antes da primeira meta, ficam sem meta). Cadastrar de
                novo na mesma data substitui o valor; use "Editar" na lista para corrigir uma meta já lançada. Semana, mês e safra somam a meta de cada dia, contando só a partir da primeira entrada de cana da frente em Ordens de Corte.
              </p>
            </form>
          </Painel>
        )}

        {metasIniciais.length === 0 ? (
          <div className="rounded-xl2 border border-dashed border-line bg-card px-6 py-14 text-center text-muted">
            Nenhuma meta cadastrada ainda.
          </div>
        ) : (
          <Painel
            titulo="Metas cadastradas"
            semEspaco
            acoes={
              <>
                <select
                  value={filtroFrente}
                  onChange={(e) => setFiltroFrente(e.target.value)}
                  className="rounded-md border border-line bg-card px-2.5 py-1.5 text-[12.5px] text-ink focus:border-brand-600 focus:outline-none"
                  aria-label="Filtrar por frente"
                >
                  <option value="todas">Todas as frentes</option>
                  {frentesComMeta.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
                <BotaoLimparFiltros ativo={algumFiltroAtivo} onLimpar={limparFiltros} />
                <span className="ml-1.5 text-[12px] text-muted">
                  {linhas.length} meta{linhas.length === 1 ? "" : "s"}
                </span>
              </>
            }
          >
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="border-b border-line bg-surface text-left text-muted">
                    <th className="px-4 py-2 font-semibold">Frente</th>
                    <th className="px-3 py-2 font-semibold">Data</th>
                    <th className="px-3 py-2 text-right font-semibold">Meta (t/dia)</th>
                    <th className="px-3 py-2 font-semibold">Status</th>
                    <th className="px-3 py-2 font-semibold">Lançado por</th>
                    <th className="px-3 py-2 font-semibold">Última alteração</th>
                    <th className="w-24 px-2 py-2 text-right font-semibold">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {linhas.map((m) => {
                    const sit = situacao(m);
                    return (
                      <tr key={m.id} className="border-b border-line last:border-0">
                        <td className="px-4 py-1.5 font-semibold text-ink">{m.frente}</td>
                        <td className="px-3 py-1.5 text-ink">{fmtDateBR(m.vigencia)}</td>
                        <td className="px-3 py-1.5 text-right font-semibold tabular text-ink">{fmtT(m.metaDiaT)}</td>
                        <td className="px-3 py-1.5">
                          {sit === "vigente" && (
                            <span className="rounded-full bg-good-50 px-2 py-0.5 text-[10.5px] font-bold text-good-600">
                              Vigente
                            </span>
                          )}
                          {sit === "futura" && (
                            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10.5px] font-bold text-amber-600">
                              Futura
                            </span>
                          )}
                          {sit === "anterior" && <span className="text-[11px] text-muted">Substituída</span>}
                        </td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-muted">{m.lancadoPor || "—"}</td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-muted">{m.alteradoEm ? `${m.alteradoPor || "—"} · ${fmtDataHora(m.alteradoEm)}` : ""}</td>
                        <td className="px-2 py-1.5 text-right">
                          {podeGravar && (
                            <button
                              type="button"
                              onClick={() => editar(m)}
                              aria-label="Editar meta"
                              className="mr-1 rounded px-1.5 py-0.5 text-[12px] font-semibold text-brand-700 hover:bg-brand-50"
                            >
                              Editar
                            </button>
                          )}
                          {podeGravar && (
                            <button
                              type="button"
                              onClick={() => excluir(m)}
                              aria-label="Excluir meta"
                              className="rounded px-1.5 text-[15px] leading-none text-muted hover:bg-alert-50 hover:text-alert-600"
                            >
                              ×
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Painel>
        )}

        <AtividadeFrentes frentes={todasFrentes} podeGravar={podeGravar} onAlterado={() => router.refresh()} />
      </CorpoPagina>
      {importarAberto && (
        <ImportarMetasModal
          onFechar={() => setImportarAberto(false)}
          onImportado={() => router.refresh()}
        />
      )}
    </Pagina>
  );
}

interface ResultadoMetasUI {
  lidas: number;
  novas: number;
  atualizadas: number;
  avisos: string[];
}

function ImportarMetasModal({ onFechar, onImportado }: { onFechar: () => void; onImportado: () => void }) {
  const [arquivos, setArquivos] = useState<File[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ResultadoMetasUI | null>(null);

  async function enviar() {
    if (arquivos.length === 0) return;
    setEnviando(true);
    setErro(null);
    setResultado(null);
    try {
      const form = new FormData();
      arquivos.forEach((f) => form.append("arquivo", f));
      const res = await fetch("/api/metas/importar", { method: "POST", body: form });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Não foi possível importar as metas.");
      setResultado(json);
      onImportado();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível importar as metas.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <ModalShell titulo="Importar metas por frente" onFechar={onFechar}>
      <p className="mb-4 text-[12.5px] leading-relaxed text-muted">
        Envie uma planilha (até 10 arquivos) com as colunas <b className="text-ink">Frente</b>,{" "}
        <b className="text-ink">Meta (t/dia)</b> e <b className="text-ink">Data</b> — uma linha para cada mudança de
        meta. A meta vale da data em diante, até a próxima da mesma frente. Se a frente já tem meta na mesma data, o
        valor é atualizado; as demais metas ficam como estão.
      </p>
      <Campo label="Planilha de metas (.xlsx)">
        <input
          type="file"
          multiple
          accept=".xlsx,.xls"
          onChange={(e) => setArquivos(Array.from(e.target.files ?? []).slice(0, 10))}
          className="block w-full text-[12.5px] text-ink file:mr-3 file:rounded-md file:border-0 file:bg-navy-900 file:px-3 file:py-1.5 file:text-[12.5px] file:font-semibold file:text-white"
        />
      </Campo>

      {erro && (
        <div className="mt-3 rounded-lg border border-alert-500/30 bg-alert-50 px-3 py-2 text-[12.5px] text-alert-600">
          {erro}
        </div>
      )}
      {resultado && (
        <div className="mt-3 rounded-lg border border-good-500/30 bg-good-50 px-3 py-2 text-[12.5px] text-good-700">
          <p className="font-semibold">
            {resultado.lidas} meta(s) lida(s) · {resultado.novas} nova(s), {resultado.atualizadas} atualizada(s).
          </p>
        </div>
      )}
      {resultado && resultado.avisos.length > 0 && (
        <div className="mt-3 max-h-[140px] overflow-y-auto rounded-lg border border-line bg-surface p-2.5 text-[12px] text-muted">
          <p className="mb-1 font-semibold text-ink">Avisos ({resultado.avisos.length}):</p>
          <ul className="list-disc space-y-0.5 pl-4">
            {resultado.avisos.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-5 flex justify-end gap-2">
        <button
          type="button"
          onClick={onFechar}
          className="rounded-lg border border-line px-4 py-2 text-[13px] font-semibold text-ink"
        >
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

/**
 * Início e fim de atividade de cada frente: a meta da frente só conta nos dias em que ela está em atividade (sem fim =
 * ativa). Vale para todos os relatórios que comparam a entrega de cana com a meta.
 */
function AtividadeFrentes({ frentes, podeGravar, onAlterado }: { frentes: string[]; podeGravar: boolean; onAlterado: () => void }) {
  const [lista, setLista] = useState<AtividadeFrente[] | null>(null);
  const [edicao, setEdicao] = useState<Record<string, { inicio: string; fim: string }>>({});
  const [salvando, setSalvando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const hoje = todayISO();

  useEffect(() => {
    fetch("/api/metas/atividade", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setLista(j.atividades ?? []))
      .catch(() => setLista([]));
  }, []);

  const doCadastro = (f: string) => lista?.find((a) => a.frente === f);
  const valor = (f: string) => edicao[f] ?? { inicio: doCadastro(f)?.inicio ?? "", fim: doCadastro(f)?.fim ?? "" };
  const mudou = (f: string) => {
    const v = valor(f);
    return v.inicio !== (doCadastro(f)?.inicio ?? "") || v.fim !== (doCadastro(f)?.fim ?? "");
  };
  const nomes = Array.from(new Set([...frentes, ...(lista ?? []).map((a) => a.frente)])).sort((a, b) => a.localeCompare(b));

  async function salvar(f: string) {
    const v = valor(f);
    setSalvando(f);
    setErro(null);
    try {
      const res = await fetch("/api/metas/atividade", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ frente: f, inicio: v.inicio || null, fim: v.fim || null }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error);
      setLista(j.atividades);
      setEdicao((e) => {
        const n = { ...e };
        delete n[f];
        return n;
      });
      onAlterado();
    } catch (e) {
      setErro(e instanceof Error && e.message ? e.message : "Não foi possível salvar.");
    } finally {
      setSalvando(null);
    }
  }

  const situacao = (f: string) => {
    const a = doCadastro(f);
    if (!a || (!a.inicio && !a.fim)) return <span className="text-[11px] text-muted">Sem período (sempre ativa)</span>;
    if (a.inicio && a.inicio > hoje) return <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10.5px] font-bold text-amber-600">Começa em {fmtDateBR(a.inicio)}</span>;
    if (a.fim && a.fim < hoje) return <span className="rounded-full bg-alert-50 px-2 py-0.5 text-[10.5px] font-bold text-alert-600">Parada desde {fmtDateBR(a.fim)}</span>;
    return <span className="rounded-full bg-good-50 px-2 py-0.5 text-[10.5px] font-bold text-good-600">Ativa{a.fim ? ` até ${fmtDateBR(a.fim)}` : ""}</span>;
  };

  return (
    <Painel
      titulo="Atividade das frentes"
      subtitulo={
        <>
          A meta da frente só conta entre o início e o fim da atividade; sem fim, a frente está ativa. Frente parada não soma meta em nenhum relatório
          (Ordens de Corte, resumo diário, painel e PDF).
        </>
      }
      semEspaco
      className="mt-5"
    >
      {erro && <p className="px-4 py-2 text-[12.5px] font-medium text-alert-600">{erro}</p>}
      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="border-b border-line bg-surface text-left text-muted">
              <th className="px-4 py-2 font-semibold">Frente</th>
              <th className="px-3 py-2 font-semibold">Início Ativ.</th>
              <th className="px-3 py-2 font-semibold">Fim Ativ.</th>
              <th className="px-3 py-2 font-semibold">Situação</th>
              <th className="px-3 py-2 font-semibold">Última alteração</th>
              <th className="w-24 px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {lista === null && (
              <tr>
                <td colSpan={6} className="px-4 py-4 text-center text-muted">
                  Carregando…
                </td>
              </tr>
            )}
            {lista !== null &&
              nomes.map((f) => {
                const v = valor(f);
                const a = doCadastro(f);
                return (
                  <tr key={f} className="border-b border-line last:border-0">
                    <td className="px-4 py-1.5 font-semibold text-ink">{f}</td>
                    <td className="px-3 py-1.5">
                      <input
                        type="date"
                        value={v.inicio}
                        disabled={!podeGravar}
                        onChange={(e) => setEdicao((x) => ({ ...x, [f]: { ...v, inicio: e.target.value } }))}
                        className="rounded-md border border-line bg-card px-2 py-1 text-[12.5px] text-ink focus:border-brand-600 focus:outline-none disabled:bg-surface"
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <input
                        type="date"
                        value={v.fim}
                        disabled={!podeGravar}
                        onChange={(e) => setEdicao((x) => ({ ...x, [f]: { ...v, fim: e.target.value } }))}
                        className="rounded-md border border-line bg-card px-2 py-1 text-[12.5px] text-ink focus:border-brand-600 focus:outline-none disabled:bg-surface"
                      />
                    </td>
                    <td className="px-3 py-1.5">{situacao(f)}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-muted">{a?.alteradoEm ? `${a.alteradoPor || "—"} · ${fmtDataHora(a.alteradoEm)}` : ""}</td>
                    <td className="px-2 py-1.5 text-right">
                      {podeGravar && mudou(f) && (
                        <button
                          type="button"
                          onClick={() => salvar(f)}
                          disabled={salvando === f}
                          className="rounded bg-navy-900 px-2.5 py-1 text-[12px] font-semibold text-white hover:bg-navy-800 disabled:opacity-50"
                        >
                          {salvando === f ? "Salvando…" : "Salvar"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
    </Painel>
  );
}
