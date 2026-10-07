"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import BotaoLog from "@/components/BotaoLog";
import { chaveTalhao, round2, type ApontamentoDiario, type ConsultaOS, type OperacaoOS } from "@/lib/atividades";
import { fmtDateBR, todayISO } from "@/lib/format";
import { addDays } from "@/lib/period";
import { podeEditar } from "@/lib/permissoes";
import type { PerfilUsuario } from "@/lib/types";

const INPUT = "w-full rounded-md border border-line bg-card px-2.5 py-1.5 text-[13px] text-ink disabled:opacity-60";
const LEITURA = "w-full rounded-md border border-line/70 bg-card/60 px-2.5 py-1.5 text-[13px] text-ink";
const ROTULO = "mb-1 block text-[11.5px] font-medium text-muted";
const BOTAO = "rounded-lg border border-line bg-card px-3 py-1.5 text-[12.5px] font-medium text-navy-800 hover:bg-surface disabled:opacity-50";

const nf = (n: number, c = 2) => n.toLocaleString("pt-BR", { minimumFractionDigits: c, maximumFractionDigits: c });
function numero(v: string): number {
  const t = v.trim();
  if (!t) return 0;
  return t.includes(",") ? Number(t.replace(/\./g, "").replace(",", ".")) : Number(t);
}
const texto = (n: number) => (n ? String(round2(n)).replace(".", ",") : "");
const corStatus = (s: string) => (/encerr/i.test(s) ? "bg-surface text-muted" : /liber/i.test(s) ? "bg-brand-50 text-brand-700" : "bg-good-50 text-good-600");

interface Form {
  id?: number;
  boletim: string;
  dt: string;
  os: string;
  opCod: string;
  solicitante: string;
  etapaCod: string;
  tipoAplicacao: string;
  numEquipamentos: string;
  numPessoas: string;
  obs: string;
  areas: Record<string, string>;
}

const formVazio = (): Form => ({ boletim: "", dt: todayISO(), os: "", opCod: "", solicitante: "", etapaCod: "", tipoAplicacao: "", numEquipamentos: "", numPessoas: "", obs: "", areas: {} });

export default function ApontamentoAtividadeClient({ perfil, nomeUsuario }: { perfil: PerfilUsuario; nomeUsuario: string }) {
  const podeGravar = podeEditar(perfil);
  const [form, setForm] = useState<Form>(formVazio);
  const [osInfo, setOsInfo] = useState<ConsultaOS | null>(null);
  const [buscandoOS, setBuscandoOS] = useState(false);
  const [erroOS, setErroOS] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState<{ texto: string; erro: boolean } | null>(null);
  const [importar, setImportar] = useState(false);
  const [base, setBase] = useState<{ ordens: number; ultimaImportacao: string | null } | null>(null);
  const osRef = useRef<HTMLInputElement>(null);

  // lista
  const [de, setDe] = useState(addDays(todayISO(), -6));
  const [ate, setAte] = useState(todayISO());
  const [filtroOS, setFiltroOS] = useState("");
  const [filtroBoletim, setFiltroBoletim] = useState("");
  const [lista, setLista] = useState<ApontamentoDiario[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [aberto, setAberto] = useState<number | null>(null);

  const upd = (p: Partial<Form>) => setForm((f) => ({ ...f, ...p }));
  const op: OperacaoOS | null = osInfo?.operacoes.find((o) => o.cod === form.opCod) ?? null;

  const carregarBase = useCallback(async () => {
    try {
      const res = await fetch("/api/atividades/os", { cache: "no-store" });
      if (res.ok) setBase(await res.json());
    } catch {
      /* só informativo */
    }
  }, []);

  const carregarLista = useCallback(async () => {
    setCarregando(true);
    try {
      const p = new URLSearchParams({ de, ate, os: filtroOS.trim(), boletim: filtroBoletim.trim() });
      const res = await fetch(`/api/atividades/apontamentos?${p}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Não foi possível carregar os apontamentos.");
      setLista(json.apontamentos);
    } catch (e) {
      setMsg({ texto: e instanceof Error ? e.message : "Não foi possível carregar os apontamentos.", erro: true });
    } finally {
      setCarregando(false);
    }
  }, [de, ate, filtroOS, filtroBoletim]);

  /** sugere o próximo nº de boletim (pode ser trocado pelo do papel) */
  const sugerirBoletim = useCallback(async () => {
    try {
      const res = await fetch("/api/atividades/apontamentos?proximo=1", { cache: "no-store" });
      const json = await res.json();
      if (res.ok) setForm((f) => (f.id || f.boletim ? f : { ...f, boletim: String(json.boletim) }));
    } catch {
      /* digita à mão */
    }
  }, []);

  useEffect(() => {
    carregarBase();
    sugerirBoletim();
  }, [carregarBase, sugerirBoletim]);
  useEffect(() => {
    carregarLista();
  }, [carregarLista]);

  /** Busca a O.S. na base: traz operações, talhões e a área já apontada; aplica os padrões da operação. */
  async function buscarOS(os: string, manter?: Partial<Form>, excluirId?: number) {
    const c = os.trim();
    setErroOS(null);
    if (!c) {
      setOsInfo(null);
      return;
    }
    setBuscandoOS(true);
    try {
      const p = new URLSearchParams({ os: c });
      if (excluirId) p.set("excluir", String(excluirId));
      const res = await fetch(`/api/atividades/os?${p}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "O.S. não encontrada.");
      const info = json as ConsultaOS;
      setOsInfo(info);
      const primeira = manter?.opCod && info.operacoes.some((o) => o.cod === manter.opCod) ? info.operacoes.find((o) => o.cod === manter.opCod)! : info.operacoes[0];
      setForm((f) => ({
        ...f,
        os: info.os,
        opCod: primeira?.cod ?? "",
        etapaCod: manter?.etapaCod ?? primeira?.etapaCod ?? "",
        tipoAplicacao: manter?.tipoAplicacao ?? (primeira?.tipoDs || primeira?.tipoCod || f.tipoAplicacao),
        solicitante: manter?.solicitante ?? (f.solicitante || info.resp),
        areas: manter?.areas ?? {},
      }));
    } catch (e) {
      setOsInfo(null);
      setErroOS(e instanceof Error ? e.message : "O.S. não encontrada.");
    } finally {
      setBuscandoOS(false);
    }
  }

  function trocarOperacao(cod: string) {
    const o = osInfo?.operacoes.find((x) => x.cod === cod);
    upd({ opCod: cod, etapaCod: o?.etapaCod ?? "", tipoAplicacao: o?.tipoDs || o?.tipoCod || form.tipoAplicacao, areas: {} });
  }

  const linhas = useMemo(() => {
    if (!op) return [];
    const feitos = osInfo?.realizado[op.cod] ?? {};
    return op.talhoes.map((t) => {
      const k = chaveTalhao(t.propCod, t.tlh);
      const ja = feitos[k] ?? 0;
      const ref = t.areaRec ?? t.areaTlh ?? 0;
      return { t, k, ja, saldo: Math.max(0, round2(ref - ja)), valor: form.areas[k] ?? "" };
    });
  }, [op, osInfo, form.areas]);
  const totalDia = round2(linhas.reduce((a, l) => a + (numero(l.valor) || 0), 0));
  const fazendas = Array.from(new Set(linhas.map((l) => `${l.t.propCod} · ${l.t.propNm}`)));

  function limpar() {
    setForm(formVazio());
    setOsInfo(null);
    setErroOS(null);
    sugerirBoletim();
    setTimeout(() => osRef.current?.focus(), 0);
  }

  async function salvar() {
    setMsg(null);
    if (!osInfo || !op) return setMsg({ texto: "Busque a O.S. e escolha a operação.", erro: true });
    const invalido = linhas.find((l) => l.valor.trim() && (!Number.isFinite(numero(l.valor)) || numero(l.valor) < 0));
    if (invalido) return setMsg({ texto: `Área inválida no talhão ${invalido.t.propCod}-${invalido.t.tlh}.`, erro: true });
    setSalvando(true);
    try {
      const res = await fetch("/api/atividades/apontamentos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: form.id,
          boletim: Number(form.boletim || 0),
          dt: form.dt,
          os: form.os,
          opCod: form.opCod,
          solicitante: form.solicitante,
          etapaCod: form.etapaCod,
          tipoAplicacao: form.tipoAplicacao,
          numEquipamentos: Number(form.numEquipamentos || 0),
          numPessoas: Number(form.numPessoas || 0),
          obs: form.obs,
          talhoes: linhas.filter((l) => numero(l.valor) > 0).map((l) => ({ propCod: l.t.propCod, tlh: l.t.tlh, area: numero(l.valor) })),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Não foi possível salvar.");
      setMsg({ texto: form.id ? `Boletim nº ${form.boletim} alterado.` : `Boletim nº ${form.boletim} lançado: ${nf(totalDia)} ha na O.S. ${form.os}.`, erro: false });
      const dtLancada = form.dt;
      limpar();
      setForm((f) => ({ ...f, dt: dtLancada }));
      if (dtLancada < de || dtLancada > ate) {
        setDe(dtLancada);
        setAte(dtLancada > ate ? dtLancada : ate);
      } else await carregarLista();
    } catch (e) {
      setMsg({ texto: e instanceof Error ? e.message : "Não foi possível salvar.", erro: true });
    } finally {
      setSalvando(false);
    }
  }

  function editar(a: ApontamentoDiario) {
    setMsg(null);
    const areas = Object.fromEntries(a.talhoes.map((t) => [chaveTalhao(t.propCod, t.tlh), texto(t.area)]));
    const novo: Form = {
      id: a.id,
      boletim: a.boletim ? String(a.boletim) : "",
      dt: a.dt,
      os: a.os,
      opCod: a.opCod,
      solicitante: a.solicitante,
      etapaCod: a.etapaCod,
      tipoAplicacao: a.tipoAplicacao,
      numEquipamentos: String(a.numEquipamentos),
      numPessoas: String(a.numPessoas),
      obs: a.obs,
      areas,
    };
    setForm(novo);
    buscarOS(a.os, novo, a.id);
    window.scrollTo({ top: 0 });
  }

  async function excluir(a: ApontamentoDiario) {
    if (!window.confirm(`Excluir o boletim nº ${a.boletim ?? a.id} (O.S. ${a.os}, ${fmtDateBR(a.dt)})? A exclusão fica no log.`)) return;
    const res = await fetch("/api/atividades/apontamentos", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: a.id }) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return setMsg({ texto: json.error ?? "Não foi possível excluir.", erro: true });
    if (form.id === a.id) limpar();
    setMsg({ texto: `Boletim nº ${a.boletim ?? a.id} excluído.`, erro: false });
    carregarLista();
  }

  const totalLista = round2(lista.reduce((a, x) => a + x.areaTotal, 0));

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden" translate="no">
      <header className="flex flex-shrink-0 flex-wrap items-center gap-3 border-b border-line bg-card px-6 py-3">
        <nav className="min-w-0 flex-1 text-[13px] text-muted">
          <span className="text-[11px]">Atividades · Apontamentos Diários</span>
          <div className="truncate text-[15px] font-semibold text-ink">Apontamento</div>
        </nav>
        {base && (
          <span className="hidden text-[12px] text-muted sm:block">
            Base de O.S.: {base.ordens} O.S.{base.ultimaImportacao ? ` · atualizada em ${base.ultimaImportacao}` : ""}
          </span>
        )}
        {podeGravar && (
          <button type="button" onClick={() => setImportar(true)} className={BOTAO}>
            Atualizar base de O.S.
          </button>
        )}
        <BotaoLog titulo="Log dos Apontamentos Diários" filtro={{ modulo: "Atividades" }} />
      </header>

      <div className="flex-1 space-y-5 overflow-y-auto px-3 py-4 md:px-6 md:py-5">
        {msg && <p className={`rounded-md border px-3 py-2 text-[13px] ${msg.erro ? "border-alert-500/40 bg-alert-50 text-alert-700" : "border-good-500/40 bg-good-50 text-good-700"}`}>{msg.texto}</p>}

        {podeGravar && (
          <section className="caixa-form">
            <div className="caixa-form-topo">
              <div>
                <div className="caixa-form-titulo">{form.id ? "Editando o apontamento" : "Novo apontamento"}</div>
                {nomeUsuario && <div className="text-[11.5px] text-muted">Lançado por {nomeUsuario}</div>}
              </div>
              <label className="campo-boletim">
                Boletim nº
                <input value={form.boletim} onChange={(e) => upd({ boletim: e.target.value.replace(/\D/g, "").slice(0, 9) })} inputMode="numeric" aria-label="Número do boletim" />
              </label>
            </div>

            {/* Identificação */}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-[150px_170px_minmax(0,1fr)]">
              <div>
                <label className={ROTULO}>Data</label>
                <input type="date" value={form.dt} onChange={(e) => upd({ dt: e.target.value })} className={INPUT} />
              </div>
              <div>
                <label className={ROTULO}>Ordem de Serviço</label>
                <input
                  ref={osRef}
                  value={form.os}
                  onChange={(e) => {
                    upd({ os: e.target.value.replace(/\D/g, "") });
                    if (osInfo) setOsInfo(null);
                  }}
                  onBlur={() => form.os && !osInfo && buscarOS(form.os)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      buscarOS(form.os);
                    }
                  }}
                  inputMode="numeric"
                  placeholder="Nº da O.S."
                  className={`${INPUT} tabular`}
                  aria-label="Número da Ordem de Serviço"
                />
              </div>
              <div className="col-span-2 flex min-h-[38px] items-end md:col-span-1">
                {buscandoOS ? (
                  <span className="pb-2 text-[12.5px] text-muted">Buscando a O.S.…</span>
                ) : erroOS ? (
                  <span className="pb-2 text-[12.5px] text-amber-700">{erroOS}</span>
                ) : osInfo ? (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pb-1.5 text-[12.5px]">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${corStatus(osInfo.status)}`}>{osInfo.status || "—"}</span>
                    <span className="text-ink">{fazendas.join(" / ") || "—"}</span>
                    <span className="text-muted">
                      Safra {osInfo.safra || "—"}
                      {osInfo.dtLanc ? ` · emitida em ${fmtDateBR(osInfo.dtLanc)}` : ""}
                    </span>
                  </div>
                ) : (
                  <span className="pb-2 text-[12px] text-muted">Digite a O.S. e tecle Enter para trazer as operações e os talhões.</span>
                )}
              </div>
            </div>

            {/* Operação */}
            <div className="caixa-form-sub">Operação</div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <div className="col-span-2">
                <label className={ROTULO}>Operação</label>
                <select value={form.opCod} onChange={(e) => trocarOperacao(e.target.value)} disabled={!osInfo} className={INPUT}>
                  {!osInfo && <option value="">Busque a O.S.</option>}
                  {osInfo?.operacoes.map((o) => (
                    <option key={o.cod} value={o.cod}>
                      {o.cod} · {o.ds || "sem descrição"}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-span-2">
                <label className={ROTULO}>Solicitante</label>
                <input value={form.solicitante} onChange={(e) => upd({ solicitante: e.target.value })} className={INPUT} maxLength={80} />
              </div>
              <div className="col-span-2">
                <label className={ROTULO}>Etapa</label>
                <div className={LEITURA}>{op ? `${op.etapaCod}${op.etapaDs ? ` · ${op.etapaDs}` : ""}` || "—" : "—"}</div>
              </div>
              <div className="col-span-2">
                <label className={ROTULO}>Tipo de aplicação</label>
                <input list="tipos-apl" value={form.tipoAplicacao} onChange={(e) => upd({ tipoAplicacao: e.target.value })} className={INPUT} maxLength={60} />
                <datalist id="tipos-apl">
                  {(osInfo?.tiposConhecidos ?? []).map((t) => (
                    <option key={t} value={t} />
                  ))}
                </datalist>
              </div>
            </div>

            {/* Recursos */}
            <div className="caixa-form-sub">Recursos e área</div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-[150px_150px_180px_minmax(0,1fr)]">
              <div>
                <label className={ROTULO}>Nº de equipamentos</label>
                <input value={form.numEquipamentos} onChange={(e) => upd({ numEquipamentos: e.target.value.replace(/\D/g, "") })} inputMode="numeric" className={`${INPUT} text-right tabular`} />
              </div>
              <div>
                <label className={ROTULO}>Nº de pessoas</label>
                <input value={form.numPessoas} onChange={(e) => upd({ numPessoas: e.target.value.replace(/\D/g, "") })} inputMode="numeric" className={`${INPUT} text-right tabular`} />
              </div>
              <div>
                <label className={ROTULO}>Área realizada no dia</label>
                <div className={`${LEITURA} text-right font-semibold tabular`}>{nf(totalDia)} ha</div>
              </div>
              <div className="col-span-2 md:col-span-1">
                <label className={ROTULO}>Observação</label>
                <input value={form.obs} onChange={(e) => upd({ obs: e.target.value })} className={INPUT} maxLength={300} />
              </div>
            </div>

            {/* Talhões da O.S. */}
            <div className="caixa-form-sub flex flex-wrap items-center gap-3">
              <span>Talhões da O.S.{op ? ` · ${linhas.length}` : ""}</span>
              {op && linhas.length > 0 && (
                <span className="ml-auto flex gap-2 text-[12px] font-normal">
                  <button type="button" className={BOTAO} onClick={() => upd({ areas: Object.fromEntries(linhas.map((l) => [l.k, texto(l.saldo)])) })}>
                    Preencher com o saldo
                  </button>
                  <button type="button" className={BOTAO} onClick={() => upd({ areas: {} })}>
                    Limpar áreas
                  </button>
                </span>
              )}
            </div>
            {op ? (
              <div className="overflow-x-auto rounded-lg border border-line bg-card">
                <table className="w-full min-w-[640px] text-[12.5px]">
                  <thead>
                    <tr className="border-b border-line bg-surface text-left text-muted">
                      <th className="px-3 py-1.5 font-medium">Fazenda</th>
                      <th className="px-3 py-1.5 font-medium">Talhão</th>
                      <th className="px-3 py-1.5 text-right font-medium">Área talhão</th>
                      <th className="px-3 py-1.5 text-right font-medium">Área recomendada</th>
                      <th className="px-3 py-1.5 text-right font-medium">Já apontado</th>
                      <th className="px-3 py-1.5 text-right font-medium">Saldo</th>
                      <th className="w-[140px] px-3 py-1.5 text-right font-medium">Área realizada (ha)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {linhas.map((l) => {
                      const v = numero(l.valor);
                      const passa = v > 0 && v > l.saldo + 0.001;
                      return (
                        <tr key={l.k} className="border-t border-line/60">
                          <td className="px-3 py-1 text-muted">
                            {l.t.propCod} · {l.t.propNm}
                          </td>
                          <td className="px-3 py-1 tabular text-ink">{l.t.tlh}</td>
                          <td className="px-3 py-1 text-right tabular">{l.t.areaTlh !== null ? nf(l.t.areaTlh) : "—"}</td>
                          <td className="px-3 py-1 text-right tabular">{l.t.areaRec !== null ? nf(l.t.areaRec) : "—"}</td>
                          <td className="px-3 py-1 text-right tabular text-muted">{l.ja ? nf(l.ja) : "—"}</td>
                          <td className="px-3 py-1 text-right tabular">{nf(l.saldo)}</td>
                          <td className="px-2 py-0.5">
                            <input
                              value={l.valor}
                              onChange={(e) => upd({ areas: { ...form.areas, [l.k]: e.target.value } })}
                              inputMode="decimal"
                              className={`w-full rounded border px-2 py-1 text-right tabular ${passa ? "border-amber-500 bg-amber-50" : "border-line bg-card"}`}
                              aria-label={`Área realizada no talhão ${l.t.tlh}`}
                              title={passa ? "Passa do saldo da O.S. neste talhão" : undefined}
                            />
                          </td>
                        </tr>
                      );
                    })}
                    <tr className="border-t border-line bg-surface font-semibold">
                      <td className="px-3 py-1.5" colSpan={2}>
                        Total
                      </td>
                      <td className="px-3 py-1.5 text-right tabular">{nf(linhas.reduce((a, l) => a + (l.t.areaTlh ?? 0), 0))}</td>
                      <td className="px-3 py-1.5 text-right tabular">{nf(linhas.reduce((a, l) => a + (l.t.areaRec ?? 0), 0))}</td>
                      <td className="px-3 py-1.5 text-right tabular">{nf(linhas.reduce((a, l) => a + l.ja, 0))}</td>
                      <td className="px-3 py-1.5 text-right tabular">{nf(linhas.reduce((a, l) => a + l.saldo, 0))}</td>
                      <td className="px-3 py-1.5 text-right tabular">{nf(totalDia)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="rounded-lg border border-dashed border-line bg-card/50 px-4 py-5 text-center text-[12.5px] text-muted">Os talhões aparecem aqui depois de buscar a O.S.</p>
            )}
            <p className="mt-2 text-[11.5px] text-muted">Saldo = área recomendada na O.S. (ou a do talhão) menos o que já foi apontado. Área acima do saldo fica destacada, mas pode ser gravada; acima da área do talhão, não.</p>

            <div className="mt-4 flex flex-wrap justify-end gap-2">
              {(form.id || form.os) && (
                <button type="button" onClick={limpar} className={BOTAO}>
                  {form.id ? "Cancelar edição" : "Limpar"}
                </button>
              )}
              <button type="button" onClick={salvar} disabled={salvando || !op || totalDia <= 0 || !form.boletim} className="rounded-lg bg-navy-900 px-5 py-2 text-[13px] font-medium text-white hover:bg-navy-800 disabled:opacity-40">
                {salvando ? "Salvando…" : form.id ? "Salvar alteração" : "Lançar apontamento"}
              </button>
            </div>
          </section>
        )}

        {/* Lançados */}
        <section className="rounded-xl2 border border-line bg-card p-4 shadow-card">
          <div className="mb-3 flex flex-wrap items-end gap-3">
            <h2 className="mr-auto text-[14.5px] font-semibold text-ink">Apontamentos lançados</h2>
            <div>
              <label className={ROTULO}>De</label>
              <input type="date" value={de} onChange={(e) => e.target.value && setDe(e.target.value)} className={INPUT} />
            </div>
            <div>
              <label className={ROTULO}>Até</label>
              <input type="date" value={ate} onChange={(e) => e.target.value && setAte(e.target.value)} className={INPUT} />
            </div>
            <div className="w-[120px]">
              <label className={ROTULO}>Boletim</label>
              <input value={filtroBoletim} onChange={(e) => setFiltroBoletim(e.target.value.replace(/\D/g, ""))} className={INPUT} placeholder="Qualquer" />
            </div>
            <div className="w-[130px]">
              <label className={ROTULO}>O.S.</label>
              <input value={filtroOS} onChange={(e) => setFiltroOS(e.target.value.replace(/\D/g, ""))} className={INPUT} placeholder="Todas" />
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-[12.5px]">
              <thead>
                <tr className="border-b border-line bg-surface text-left text-muted">
                  <th className="px-3 py-1.5 font-medium">Boletim</th>
                  <th className="px-3 py-1.5 font-medium">Data</th>
                  <th className="px-3 py-1.5 font-medium">O.S.</th>
                  <th className="px-3 py-1.5 font-medium">Operação</th>
                  <th className="px-3 py-1.5 font-medium">Etapa</th>
                  <th className="px-3 py-1.5 font-medium">Tipo de aplicação</th>
                  <th className="px-3 py-1.5 font-medium">Solicitante</th>
                  <th className="px-3 py-1.5 text-right font-medium">Equip.</th>
                  <th className="px-3 py-1.5 text-right font-medium">Pessoas</th>
                  <th className="px-3 py-1.5 text-right font-medium">Área (ha)</th>
                  <th className="px-3 py-1.5 font-medium">Lançado por</th>
                  <th className="w-[110px]" />
                </tr>
              </thead>
              <tbody>
                {carregando && (
                  <tr>
                    <td colSpan={12} className="px-3 py-6 text-center text-muted">
                      Carregando…
                    </td>
                  </tr>
                )}
                {!carregando && lista.length === 0 && (
                  <tr>
                    <td colSpan={12} className="px-3 py-6 text-center text-muted">
                      Nenhum apontamento no período.
                    </td>
                  </tr>
                )}
                {lista.map((a) => (
                  <Fragment key={a.id}>
                    <tr className={`border-t border-line/60 ${form.id === a.id ? "bg-[#2E5FA8]/[0.08]" : ""}`}>
                      <td className="px-3 py-1.5 tabular font-medium text-ink">{a.boletim ?? "—"}</td>
                      <td className="px-3 py-1.5 tabular">{fmtDateBR(a.dt)}</td>
                      <td className="px-3 py-1.5 tabular font-medium text-ink">
                        <button type="button" className="hover:underline" onClick={() => setAberto(aberto === a.id ? null : a.id)} title="Ver talhões">
                          {a.os}
                        </button>
                      </td>
                      <td className="max-w-[240px] truncate px-3 py-1.5" title={a.opDs}>
                        {a.opCod} · {a.opDs}
                      </td>
                      <td className="max-w-[160px] truncate px-3 py-1.5 text-muted" title={a.etapaDs}>
                        {a.etapaDs || a.etapaCod || "—"}
                      </td>
                      <td className="px-3 py-1.5 text-muted">{a.tipoAplicacao || "—"}</td>
                      <td className="max-w-[160px] truncate px-3 py-1.5">{a.solicitante}</td>
                      <td className="px-3 py-1.5 text-right tabular">{a.numEquipamentos}</td>
                      <td className="px-3 py-1.5 text-right tabular">{a.numPessoas}</td>
                      <td className="px-3 py-1.5 text-right tabular font-medium">{nf(a.areaTotal)}</td>
                      <td className="px-3 py-1.5 text-[11.5px] text-muted">
                        {a.usr}
                        {a.atuUsr ? <div>alterado por {a.atuUsr}</div> : null}
                      </td>
                      <td className="px-2 py-1 text-right">
                        {podeGravar && (
                          <span className="flex justify-end gap-1.5">
                            <button type="button" className={BOTAO} onClick={() => editar(a)}>
                              Editar
                            </button>
                            <button type="button" className={`${BOTAO} px-2 text-alert-700`} onClick={() => excluir(a)} aria-label={`Excluir o apontamento ${a.id}`}>
                              ×
                            </button>
                          </span>
                        )}
                      </td>
                    </tr>
                    {aberto === a.id && (
                      <tr className="bg-surface/60">
                        <td colSpan={12} className="px-4 py-2 text-[12px] text-muted">
                          {a.talhoes.map((t) => `${t.propCod}-${t.tlh}: ${nf(t.area)} ha`).join(" · ")}
                          {a.obs ? ` · Obs.: ${a.obs}` : ""}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
                {lista.length > 0 && (
                  <tr className="border-t border-line bg-surface font-semibold">
                    <td colSpan={9} className="px-3 py-1.5">
                      {lista.length} apontamento(s)
                    </td>
                    <td className="px-3 py-1.5 text-right tabular">{nf(totalLista)}</td>
                    <td colSpan={2} />
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {importar && (
        <ImportarBaseOS
          onFechar={() => setImportar(false)}
          onConcluido={() => {
            carregarBase();
            if (form.os) buscarOS(form.os, form, form.id);
          }}
        />
      )}
    </div>
  );
}

function ImportarBaseOS({ onFechar, onConcluido }: { onFechar: () => void; onConcluido: () => void }) {
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [feito, setFeito] = useState<string | null>(null);

  async function enviar() {
    if (!arquivo) return;
    setOcupado(true);
    setErro(null);
    try {
      const f = new FormData();
      f.append("arquivo", arquivo);
      const res = await fetch("/api/atividades/os", { method: "POST", body: f });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Não foi possível importar.");
      setFeito(`${json.ordens} O.S. atualizadas (${json.linhas} linhas de talhão × operação)${json.substituidas ? `, ${json.substituidas} já existiam e foram substituídas` : ""}.`);
      onConcluido();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível importar.");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-xl2 bg-card p-5 shadow-pop">
        <h2 className="text-[15px] font-semibold text-ink">Atualizar base de O.S.</h2>
        <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
          Envie o Acompanhamento de O.S. (uma linha por O.S., talhão e operação). As O.S. do arquivo são substituídas pela versão nova; as demais continuam como
          estão.
        </p>
        {!feito && <input type="file" accept=".xlsx,.xls" onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} className="mt-3 block w-full text-[13px]" />}
        {feito && <p className="mt-3 rounded-md border border-good-500/40 bg-good-50 px-3 py-2 text-[12.5px] text-good-700">{feito}</p>}
        {erro && <p className="mt-3 rounded-md border border-alert-500/40 bg-alert-50 px-3 py-2 text-[12.5px] text-alert-700">{erro}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className={BOTAO} onClick={onFechar}>
            {feito ? "Fechar" : "Cancelar"}
          </button>
          {!feito && (
            <button type="button" onClick={enviar} disabled={!arquivo || ocupado} className="rounded-lg bg-navy-900 px-4 py-1.5 text-[12.5px] font-medium text-white disabled:opacity-40">
              {ocupado ? "Importando…" : "Importar"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
