"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Campo } from "@/components/ui";
import BotaoLog from "@/components/BotaoLog";
import { fmtDataHora } from "@/components/AuditoriaModal";
import { CabecalhoPagina, CorpoPagina, Pagina, Painel, rolarCorpoParaOTopo, Selo } from "@/components/pagina";
import { fmtDateBR } from "@/lib/format";
import { podeEditar, podeIncluirCadastro } from "@/lib/permissoes";
import { escolherSafraVigente } from "@/lib/safra-cadastro";
import type { PerfilUsuario, SafraCadastro, TipoSafra } from "@/lib/types";

const INPUT =
  "w-full rounded-md border border-line bg-card px-3 py-2 text-[13px] text-ink focus:border-brand-600 focus:outline-none";

const TIPO_LABEL: Record<TipoSafra, string> = { AGR: "AGR · Agrícola", IND: "IND · Industrial" };

function hojeIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const VAZIO = { tipo: "AGR" as TipoSafra, ano: "", anoInicio: "", anoFim: "", producaoInicio: "", producaoFim: "" };

export default function SafrasClient({
  safrasIniciais,
  perfil,
}: {
  safrasIniciais: SafraCadastro[];
  perfil: PerfilUsuario;
}) {
  const router = useRouter();
  const podeGravar = podeEditar(perfil);
  const podeIncluir = podeIncluirCadastro(perfil);
  const [form, setForm] = useState(VAZIO);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [filtroTipo, setFiltroTipo] = useState<"todos" | TipoSafra>("todos");

  const hoje = hojeIso();
  const vigente = useMemo(() => escolherSafraVigente(safrasIniciais, hoje), [safrasIniciais, hoje]);
  const linhas = useMemo(
    () =>
      safrasIniciais
        .filter((s) => filtroTipo === "todos" || s.tipo === filtroTipo)
        .sort((a, b) => b.ano - a.ano || a.tipo.localeCompare(b.tipo)),
    [safrasIniciais, filtroTipo]
  );

  function atualizar(parcial: Partial<typeof VAZIO>) {
    setForm((f) => ({ ...f, ...parcial }));
  }

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setSalvando(true);
    try {
      const res = await fetch("/api/safra-cadastro", {
        method: editandoId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editandoId ?? undefined, ...form, ano: Number(form.ano) }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Não foi possível salvar a safra.");
      setForm(VAZIO);
      setEditandoId(null);
      router.refresh();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível salvar a safra.");
    } finally {
      setSalvando(false);
    }
  }

  function editar(s: SafraCadastro) {
    setErro(null);
    setEditandoId(s.id);
    setForm({
      tipo: s.tipo,
      ano: String(s.ano),
      anoInicio: s.anoInicio,
      anoFim: s.anoFim,
      producaoInicio: s.producaoInicio,
      producaoFim: s.producaoFim,
    });
    rolarCorpoParaOTopo();
  }

  function cancelar() {
    setEditandoId(null);
    setForm(VAZIO);
    setErro(null);
  }

  async function excluir(s: SafraCadastro) {
    if (!window.confirm(`Excluir a safra ${s.tipo} ${s.ano}?`)) return;
    const res = await fetch("/api/safra-cadastro", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: s.id }),
    });
    if (res.ok) router.refresh();
    else window.alert("Não foi possível excluir a safra.");
  }

  return (
    <Pagina>
      <CabecalhoPagina
        titulo="Safras"
        categoria="Configurações · Cadastros"
        info={
          !podeGravar && (
            <Selo>Somente leitura</Selo>
          )
        }
        comandos={<BotaoLog titulo="Log do cadastro de safras" filtro={{ modulo: "Configurações", entidade: "Cadastro de Safras" }} />}
      />

      <CorpoPagina>
        {podeGravar && (podeIncluir || editandoId) && (
          <form onSubmit={salvar} className="mb-5">
            <Painel titulo={editandoId ? "Editar safra" : "Cadastrar safra"}>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr_1fr_1fr_1fr_1fr]">
                <Campo label="Tipo">
                  <select value={form.tipo} onChange={(e) => atualizar({ tipo: e.target.value as TipoSafra })} className={INPUT}>
                    <option value="AGR">AGR · Agrícola</option>
                    <option value="IND">IND · Industrial</option>
                  </select>
                </Campo>
                <Campo label="Ano">
                  <input
                    value={form.ano}
                    onChange={(e) => atualizar({ ano: e.target.value.replace(/\D/g, "").slice(0, 4) })}
                    inputMode="numeric"
                    placeholder="2026"
                    className={INPUT}
                  />
                </Campo>
                <Campo label="Ano · Data Início">
                  <input type="date" value={form.anoInicio} onChange={(e) => atualizar({ anoInicio: e.target.value })} className={INPUT} />
                </Campo>
                <Campo label="Ano · Data Final">
                  <input type="date" value={form.anoFim} onChange={(e) => atualizar({ anoFim: e.target.value })} className={INPUT} />
                </Campo>
                <Campo label="Produção · Data Início">
                  <input
                    type="date"
                    value={form.producaoInicio}
                    onChange={(e) => atualizar({ producaoInicio: e.target.value })}
                    className={INPUT}
                  />
                </Campo>
                <Campo label="Produção · Data Final">
                  <input
                    type="date"
                    value={form.producaoFim}
                    onChange={(e) => atualizar({ producaoFim: e.target.value })}
                    className={INPUT}
                  />
                </Campo>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <button
                  type="submit"
                  disabled={salvando}
                  className="rounded-lg bg-navy-900 px-4 py-2 text-[13px] font-semibold text-white shadow-card hover:bg-navy-800 disabled:opacity-50"
                >
                  {salvando ? "Salvando…" : editandoId ? "Salvar alteração" : "Cadastrar"}
                </button>
                {editandoId && (
                  <button
                    type="button"
                    onClick={cancelar}
                    className="rounded-lg border border-line bg-card px-4 py-2 text-[13px] font-semibold text-navy-800 shadow-card hover:bg-surface"
                  >
                    Cancelar
                  </button>
                )}
                {erro && <span className="text-[12.5px] font-medium text-alert-600">{erro}</span>}
              </div>
              <p className="mt-3 text-[12px] leading-relaxed text-muted">
                O período de <b className="text-ink">Produção</b> da safra vigente define as pesagens e entradas de cana
                usadas nos comparativos (Ordens de Corte): contam a partir da data de início da produção e até a data
                final. Havendo safras IND e AGR em produção ao mesmo tempo, vale a IND. Cada tipo + ano é único;
                cadastrar de novo o mesmo tipo e ano substitui as datas.
              </p>
            </Painel>
          </form>
        )}

        {safrasIniciais.length === 0 ? (
          <div className="rounded-xl2 border border-dashed border-line bg-card px-6 py-14 text-center text-muted">
            Nenhuma safra cadastrada ainda.
          </div>
        ) : (
          <Painel
            semEspaco
            titulo="Safras cadastradas"
            acoes={
              <>
                <select
                  value={filtroTipo}
                  onChange={(e) => setFiltroTipo(e.target.value as typeof filtroTipo)}
                  aria-label="Filtrar por tipo"
                  className="rounded-md border border-line bg-card px-2.5 py-1.5 text-[12.5px] text-ink focus:border-brand-600 focus:outline-none"
                >
                  <option value="todos">Todos os tipos</option>
                  <option value="AGR">AGR · Agrícola</option>
                  <option value="IND">IND · Industrial</option>
                </select>
                <span className="ml-1.5 text-[12px] text-muted">
                  {linhas.length} safra{linhas.length === 1 ? "" : "s"}
                </span>
              </>
            }
          >
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="border-b border-line bg-surface text-left text-muted">
                    <th className="px-4 py-2 font-semibold">Tipo</th>
                    <th className="px-3 py-2 font-semibold">Ano</th>
                    <th className="px-3 py-2 font-semibold">Ano · Início</th>
                    <th className="px-3 py-2 font-semibold">Ano · Final</th>
                    <th className="px-3 py-2 font-semibold">Produção · Início</th>
                    <th className="px-3 py-2 font-semibold">Produção · Final</th>
                    <th className="px-3 py-2 font-semibold">Status</th>
                    <th className="px-3 py-2 font-semibold">Lançado por</th>
                    <th className="px-3 py-2 font-semibold">Última alteração</th>
                    <th className="w-28 px-2 py-2 text-right font-semibold">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {linhas.map((s) => (
                    <tr key={s.id} className="border-b border-line last:border-0">
                      <td className="px-4 py-1.5 font-semibold text-ink">{TIPO_LABEL[s.tipo]}</td>
                      <td className="px-3 py-1.5 font-semibold text-ink">{s.ano}</td>
                      <td className="px-3 py-1.5 text-ink">{fmtDateBR(s.anoInicio)}</td>
                      <td className="px-3 py-1.5 text-ink">{fmtDateBR(s.anoFim)}</td>
                      <td className="px-3 py-1.5 text-ink">{fmtDateBR(s.producaoInicio)}</td>
                      <td className="px-3 py-1.5 text-ink">{fmtDateBR(s.producaoFim)}</td>
                      <td className="px-3 py-1.5">
                        {vigente?.id === s.id ? (
                          <span className="rounded-full bg-good-50 px-2 py-0.5 text-[10.5px] font-bold text-good-600">
                            Vigente
                          </span>
                        ) : s.producaoInicio > hoje ? (
                          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10.5px] font-bold text-amber-600">
                            Futura
                          </span>
                        ) : (
                          <span className="text-[11px] text-muted">Encerrada</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-muted">{s.lancadoPor || "—"}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-muted">{s.alteradoEm ? `${s.alteradoPor || "—"} · ${fmtDataHora(s.alteradoEm)}` : ""}</td>
                      <td className="px-2 py-1.5 text-right">
                        {podeGravar && (
                          <>
                            <button
                              type="button"
                              onClick={() => editar(s)}
                              aria-label="Editar safra"
                              className="mr-1 rounded px-1.5 py-0.5 text-[12px] font-semibold text-brand-700 hover:bg-brand-50"
                            >
                              Editar
                            </button>
                            <button
                              type="button"
                              onClick={() => excluir(s)}
                              aria-label="Excluir safra"
                              className="rounded px-1.5 text-[15px] leading-none text-muted hover:bg-alert-50 hover:text-alert-600"
                            >
                              ×
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Painel>
        )}
      </CorpoPagina>
    </Pagina>
  );
}
