"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import BotaoLog from "@/components/BotaoLog";
import { chaveTalhao, ratearArea, round2, type ApontamentoDiario, type ConsultaOS, type ModoArea, type OperacaoOS } from "@/lib/atividades";
import type { OpcoesApontamento } from "@/lib/db-atividades";
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
const texto = (n: number | null) => (n ? String(round2(n)).replace(".", ",") : "");
const corStatus = (s: string) => (/encerr/i.test(s) ? "bg-surface text-muted" : /liber/i.test(s) ? "bg-brand-50 text-brand-700" : "bg-good-50 text-good-600");

interface Form {
  id?: number;
  boletim: string;
  dt: string;
  /** lançamento sem O.S.: fazenda, operação e talhões informados à mão */
  semOS: boolean;
  os: string;
  fazCod: string;
  opCod: string;
  opDs: string;
  solicitante: string;
  etapaCod: string;
  tipoAplicacao: string;
  numEquipamentos: string;
  numPessoas: string;
  obs: string;
  modoArea: ModoArea;
  volume: string;
  /** área digitada por talhão (chave fazenda|talhão) */
  areas: Record<string, string>;
  /** talhões marcados para o rateio */
  marcados: Record<string, boolean>;
  /** talhões incluídos à mão (sem O.S.) */
  extras: string[];
}

const formVazio = (semOS = false): Form => ({
  boletim: "", dt: todayISO(), semOS, os: "", fazCod: "", opCod: "", opDs: "", solicitante: "", etapaCod: "", tipoAplicacao: "",
  numEquipamentos: "", numPessoas: "", obs: "", modoArea: "talhao", volume: "", areas: {}, marcados: {}, extras: [],
});

/** Uma linha da tabela de talhões (com ou sem O.S.). */
interface Linha {
  k: string;
  propCod: string;
  propNm: string;
  tlh: string;
  areaTlh: number | null;
  areaRec: number | null;
  ja: number;
  saldo: number | null;
  valor: string;
  marcado: boolean;
  /** área do dia: a digitada, ou a do rateio */
  area: number;
}

export default function ApontamentoAtividadeClient({ perfil, nomeUsuario }: { perfil: PerfilUsuario; nomeUsuario: string }) {
  const podeGravar = podeEditar(perfil);
  const [form, setForm] = useState<Form>(() => formVazio());
  const [osInfo, setOsInfo] = useState<ConsultaOS | null>(null);
  const [buscandoOS, setBuscandoOS] = useState(false);
  const [erroOS, setErroOS] = useState<string | null>(null);
  // sem O.S.
  const [fazenda, setFazenda] = useState<{ cod: string; nm: string; talhoes: { tlh: string; area: number | null }[] } | null>(null);
  const [erroFaz, setErroFaz] = useState<string | null>(null);
  const [buscandoFaz, setBuscandoFaz] = useState(false);
  const [novoTalhao, setNovoTalhao] = useState("");
  const [opcoes, setOpcoes] = useState<OpcoesApontamento | null>(null);

  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState<{ texto: string; erro: boolean } | null>(null);
  const [importar, setImportar] = useState(false);
  const [base, setBase] = useState<{ ordens: number; ultimaImportacao: string | null } | null>(null);
  const osRef = useRef<HTMLInputElement>(null);
  const fazRef = useRef<HTMLInputElement>(null);

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
  // listas do lançamento sem O.S. (operação, etapa, tipo, solicitante)
  useEffect(() => {
    if (!form.semOS || opcoes) return;
    fetch("/api/atividades/apontamentos?opcoes=1", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => !j.error && setOpcoes(j))
      .catch(() => {});
  }, [form.semOS, opcoes]);

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
        marcados: manter?.marcados ?? {},
      }));
    } catch (e) {
      setOsInfo(null);
      setErroOS(e instanceof Error ? e.message : "O.S. não encontrada.");
    } finally {
      setBuscandoOS(false);
    }
  }

  /** Sem O.S.: busca a fazenda no Cadastro de Fazenda e os talhões dela. */
  async function buscarFazenda(cod: string) {
    const c = cod.trim();
    setErroFaz(null);
    if (!c) {
      setFazenda(null);
      return;
    }
    setBuscandoFaz(true);
    try {
      const r1 = await fetch(`/api/rodadas/apontamento?cad=fazendas&cod=${encodeURIComponent(c)}`, { cache: "no-store" });
      const j1 = await r1.json();
      if (!r1.ok || !j1.item) throw new Error(`Fazenda ${c} não está no Cadastro de Fazenda.`);
      const r2 = await fetch(`/api/rodadas/apontamento?talhoes_faz=${encodeURIComponent(j1.item.cod)}`, { cache: "no-store" });
      const j2 = await r2.json();
      setFazenda({ cod: String(j1.item.cod).split("-")[0], nm: j1.item.nm, talhoes: r2.ok ? j2.talhoes ?? [] : [] });
    } catch (e) {
      setFazenda(null);
      setErroFaz(e instanceof Error ? e.message : "Fazenda não encontrada.");
    } finally {
      setBuscandoFaz(false);
    }
  }

  function trocarOperacao(cod: string) {
    const o = osInfo?.operacoes.find((x) => x.cod === cod);
    upd({ opCod: cod, etapaCod: o?.etapaCod ?? "", tipoAplicacao: o?.tipoDs || o?.tipoCod || form.tipoAplicacao, areas: {}, marcados: {} });
  }

  /** Sem O.S.: o campo de operação aceita "código · descrição" da lista ou o código digitado. */
  function escolherOperacao(v: string) {
    const cod = v.split("·")[0].trim();
    const o = opcoes?.operacoes.find((x) => x.cod === cod);
    upd({ opCod: cod, opDs: o?.ds ?? "", etapaCod: form.etapaCod || o?.etapaCod || "" });
  }

  function trocarModo(semOS: boolean) {
    if (semOS === form.semOS) return;
    setForm((f) => ({ ...formVazio(semOS), boletim: f.boletim, dt: f.dt, id: f.id }));
    setOsInfo(null);
    setErroOS(null);
    setFazenda(null);
    setErroFaz(null);
    setTimeout(() => (semOS ? fazRef : osRef).current?.focus(), 0);
  }

  const linhas: Linha[] = useMemo(() => {
    let base: Omit<Linha, "area" | "valor" | "marcado">[] = [];
    if (!form.semOS && op) {
      const feitos = osInfo?.realizado[op.cod] ?? {};
      base = op.talhoes.map((t) => {
        const k = chaveTalhao(t.propCod, t.tlh);
        const ja = feitos[k] ?? 0;
        const ref = t.areaRec ?? t.areaTlh ?? 0;
        return { k, propCod: t.propCod, propNm: t.propNm, tlh: t.tlh, areaTlh: t.areaTlh, areaRec: t.areaRec, ja, saldo: Math.max(0, round2(ref - ja)) };
      });
    } else if (form.semOS && fazenda) {
      const todos = [...fazenda.talhoes, ...form.extras.filter((x) => !fazenda.talhoes.some((t) => t.tlh === x)).map((tlh) => ({ tlh, area: null }))];
      base = todos.map((t) => ({ k: chaveTalhao(fazenda.cod, t.tlh), propCod: fazenda.cod, propNm: fazenda.nm, tlh: t.tlh, areaTlh: t.area, areaRec: null, ja: 0, saldo: null }));
    }
    const comValor = base.map((b) => ({ ...b, valor: form.areas[b.k] ?? "", marcado: !!form.marcados[b.k], area: 0 }));
    if (form.modoArea === "rateio") {
      const marc = comValor.filter((l) => l.marcado);
      const rat = ratearArea(numero(form.volume) || 0, marc.map((l) => (form.semOS ? l.areaTlh : l.areaRec ?? l.areaTlh)));
      marc.forEach((l, i) => (l.area = rat[i]));
    } else comValor.forEach((l) => (l.area = numero(l.valor) || 0));
    return comValor;
  }, [form.semOS, form.areas, form.marcados, form.extras, form.modoArea, form.volume, op, osInfo, fazenda]);
  const totalDia = round2(linhas.reduce((a, l) => a + l.area, 0));
  const fazendasOS = Array.from(new Set(linhas.map((l) => `${l.propCod} · ${l.propNm}`)));
  const prontoTalhoes = form.semOS ? !!fazenda : !!op;

  function limpar(semOS = form.semOS) {
    setForm(formVazio(semOS));
    setOsInfo(null);
    setErroOS(null);
    setFazenda(null);
    setErroFaz(null);
    sugerirBoletim();
    setTimeout(() => (semOS ? fazRef : osRef).current?.focus(), 0);
  }

  function incluirTalhao() {
    const t = novoTalhao.trim();
    if (!t || !fazenda) return;
    const k = chaveTalhao(fazenda.cod, t);
    setForm((f) => ({
      ...f,
      extras: fazenda.talhoes.some((x) => x.tlh === t) || f.extras.includes(t) ? f.extras : [...f.extras, t],
      marcados: f.modoArea === "rateio" ? { ...f.marcados, [k]: true } : f.marcados,
    }));
    setNovoTalhao("");
  }

  async function salvar() {
    setMsg(null);
    if (!form.semOS && (!osInfo || !op)) return setMsg({ texto: "Busque a O.S. e escolha a operação.", erro: true });
    if (form.semOS && !fazenda) return setMsg({ texto: "Informe a fazenda (código do Cadastro de Fazenda).", erro: true });
    if (form.modoArea === "talhao") {
      const invalido = linhas.find((l) => l.valor.trim() && (!Number.isFinite(numero(l.valor)) || numero(l.valor) < 0));
      if (invalido) return setMsg({ texto: `Área inválida no talhão ${invalido.propCod}-${invalido.tlh}.`, erro: true });
    }
    const enviados = form.modoArea === "rateio" ? linhas.filter((l) => l.marcado) : linhas.filter((l) => l.area > 0);
    setSalvando(true);
    try {
      const res = await fetch("/api/atividades/apontamentos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: form.id,
          boletim: Number(form.boletim || 0),
          dt: form.dt,
          semOS: form.semOS,
          os: form.os,
          fazCod: fazenda?.cod ?? "",
          opCod: form.opCod,
          opDs: form.opDs,
          solicitante: form.solicitante,
          etapaCod: form.etapaCod,
          tipoAplicacao: form.tipoAplicacao,
          numEquipamentos: Number(form.numEquipamentos || 0),
          numPessoas: Number(form.numPessoas || 0),
          obs: form.obs,
          modoArea: form.modoArea,
          volume: form.modoArea === "rateio" ? numero(form.volume) : null,
          talhoes: enviados.map((l) => ({ propCod: l.propCod, tlh: l.tlh, area: l.area })),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Não foi possível salvar.");
      const onde = form.semOS ? `na fazenda ${fazenda?.cod} (sem O.S.)` : `na O.S. ${form.os}`;
      setMsg({ texto: form.id ? `Boletim nº ${form.boletim} alterado.` : `Boletim nº ${form.boletim} lançado: ${nf(totalDia)} ha ${onde}.`, erro: false });
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
    const semOS = !a.os;
    const areas = Object.fromEntries(a.talhoes.map((t) => [chaveTalhao(t.propCod, t.tlh), texto(t.area)]));
    const marcados = Object.fromEntries(a.talhoes.map((t) => [chaveTalhao(t.propCod, t.tlh), true]));
    const novo: Form = {
      id: a.id,
      boletim: a.boletim ? String(a.boletim) : "",
      dt: a.dt,
      semOS,
      os: a.os,
      fazCod: semOS ? (a.talhoes[0]?.propCod ?? "") : "",
      opCod: a.opCod,
      opDs: a.opDs,
      solicitante: a.solicitante,
      etapaCod: a.etapaCod,
      tipoAplicacao: a.tipoAplicacao,
      numEquipamentos: String(a.numEquipamentos),
      numPessoas: String(a.numPessoas),
      obs: a.obs,
      modoArea: a.modoArea,
      volume: a.modoArea === "rateio" ? texto(a.volume ?? a.areaTotal) : "",
      areas,
      marcados,
      extras: semOS ? a.talhoes.map((t) => t.tlh) : [],
    };
    setForm(novo);
    setOsInfo(null);
    setFazenda(null);
    if (semOS) buscarFazenda(novo.fazCod);
    else buscarOS(a.os, novo, a.id);
    window.scrollTo({ top: 0 });
  }

  async function excluir(a: ApontamentoDiario) {
    const onde = a.os ? `O.S. ${a.os}` : `sem O.S., fazenda ${a.talhoes[0]?.propCod ?? ""}`;
    if (!window.confirm(`Excluir o boletim nº ${a.boletim ?? a.id} (${onde}, ${fmtDateBR(a.dt)})? A exclusão fica no log.`)) return;
    const res = await fetch("/api/atividades/apontamentos", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: a.id }) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return setMsg({ texto: json.error ?? "Não foi possível excluir.", erro: true });
    if (form.id === a.id) limpar();
    setMsg({ texto: `Boletim nº ${a.boletim ?? a.id} excluído.`, erro: false });
    carregarLista();
  }

  const totalLista = round2(lista.reduce((a, x) => a + x.areaTotal, 0));
  const rateio = form.modoArea === "rateio";
  const marcadosQtd = linhas.filter((l) => l.marcado).length;
  const somaPeso = round2(linhas.filter((l) => l.marcado).reduce((a, l) => a + ((form.semOS ? l.areaTlh : l.areaRec ?? l.areaTlh) ?? 0), 0));
  const podeSalvar = !salvando && !!form.boletim && totalDia > 0 && (form.semOS ? !!fazenda && !!form.opCod.trim() : !!op);

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

            {/* Com ou sem O.S. */}
            <div className="mb-3 inline-flex rounded-lg border border-line bg-card p-0.5" role="radiogroup" aria-label="Lançamento">
              {[
                [false, "Com O.S."],
                [true, "Sem O.S."],
              ].map(([v, r]) => (
                <button
                  key={String(v)}
                  type="button"
                  role="radio"
                  aria-checked={form.semOS === v}
                  onClick={() => trocarModo(v as boolean)}
                  disabled={!!form.id}
                  className={`rounded-md px-3.5 py-1 text-[12.5px] font-medium ${form.semOS === v ? "bg-navy-900 text-white" : "text-navy-800 hover:bg-surface"} disabled:cursor-not-allowed`}
                >
                  {r as string}
                </button>
              ))}
            </div>

            {/* Identificação */}
            {!form.semOS ? (
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
                      <span className="text-ink">{fazendasOS.join(" / ") || "—"}</span>
                      <span className="text-muted">
                        Safra {osInfo.safra || "—"}
                        {osInfo.dtLanc ? ` · emitida em ${fmtDateBR(osInfo.dtLanc)}` : ""}
                      </span>
                    </div>
                  ) : (
                    <span className="pb-2 text-[12px] text-muted">Digite a O.S. e tecle Enter para trazer as operações e os talhões. Sem O.S.? Use “Sem O.S.” acima.</span>
                  )}
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 md:grid-cols-[150px_150px_minmax(0,1fr)]">
                <div>
                  <label className={ROTULO}>Data</label>
                  <input type="date" value={form.dt} onChange={(e) => upd({ dt: e.target.value })} className={INPUT} />
                </div>
                <div>
                  <label className={ROTULO}>Fazenda</label>
                  <input
                    ref={fazRef}
                    value={form.fazCod}
                    onChange={(e) => {
                      upd({ fazCod: e.target.value.replace(/[^\d-]/g, ""), areas: {}, marcados: {}, extras: [] });
                      if (fazenda) setFazenda(null);
                    }}
                    onBlur={() => form.fazCod && !fazenda && buscarFazenda(form.fazCod)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        buscarFazenda(form.fazCod);
                      }
                    }}
                    inputMode="numeric"
                    placeholder="Código"
                    className={`${INPUT} tabular`}
                    aria-label="Código da fazenda"
                  />
                </div>
                <div className="col-span-2 md:col-span-1">
                  <label className={ROTULO}>Descrição Fazenda</label>
                  <div className={`${LEITURA} min-h-[34px] ${erroFaz ? "text-amber-700" : ""}`}>
                    {buscandoFaz ? "Buscando…" : erroFaz ? erroFaz : fazenda ? fazenda.nm : <span className="text-muted">Digite o código e tecle Enter</span>}
                  </div>
                </div>
              </div>
            )}

            {/* Operação */}
            <div className="caixa-form-sub">Operação</div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <div className="col-span-2">
                <label className={ROTULO}>Operação</label>
                {!form.semOS ? (
                  <select value={form.opCod} onChange={(e) => trocarOperacao(e.target.value)} disabled={!osInfo} className={INPUT}>
                    {!osInfo && <option value="">Busque a O.S.</option>}
                    {osInfo?.operacoes.map((o) => (
                      <option key={o.cod} value={o.cod}>
                        {o.cod} · {o.ds || "sem descrição"}
                      </option>
                    ))}
                  </select>
                ) : (
                  <>
                    <input
                      list="operacoes-sem-os"
                      value={form.opCod ? `${form.opCod}${form.opDs ? ` · ${form.opDs}` : ""}` : ""}
                      onChange={(e) => escolherOperacao(e.target.value)}
                      placeholder="Código ou escolha da lista"
                      className={INPUT}
                      aria-label="Operação"
                    />
                    <datalist id="operacoes-sem-os">
                      {opcoes?.operacoes.map((o) => (
                        <option key={o.cod} value={`${o.cod} · ${o.ds}`} />
                      ))}
                    </datalist>
                  </>
                )}
              </div>
              <div className="col-span-2">
                <label className={ROTULO}>Solicitante</label>
                <input list="solicitantes-ap" value={form.solicitante} onChange={(e) => upd({ solicitante: e.target.value })} className={INPUT} maxLength={80} />
                <datalist id="solicitantes-ap">
                  {(opcoes?.solicitantes ?? []).map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              </div>
              <div className="col-span-2">
                <label className={ROTULO}>Etapa</label>
                {!form.semOS ? (
                  <div className={LEITURA}>{op ? `${op.etapaCod}${op.etapaDs ? ` · ${op.etapaDs}` : ""}` || "—" : "—"}</div>
                ) : (
                  <select value={form.etapaCod} onChange={(e) => upd({ etapaCod: e.target.value })} className={INPUT}>
                    <option value="">—</option>
                    {opcoes?.etapas.map((x) => (
                      <option key={x.cod} value={x.cod}>
                        {x.cod} · {x.ds}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <div className="col-span-2">
                <label className={ROTULO}>Tipo de aplicação</label>
                <input list="tipos-apl" value={form.tipoAplicacao} onChange={(e) => upd({ tipoAplicacao: e.target.value })} className={INPUT} maxLength={60} />
                <datalist id="tipos-apl">
                  {(form.semOS ? (opcoes?.tipos ?? []) : (osInfo?.tiposConhecidos ?? [])).map((t) => (
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

            {/* Talhões */}
            <div className="caixa-form-sub flex flex-wrap items-center gap-3">
              <span>
                {form.semOS ? "Talhões da fazenda" : "Talhões da O.S."}
                {prontoTalhoes ? ` · ${linhas.length}` : ""}
              </span>
              {prontoTalhoes && (
                <div className="inline-flex rounded-lg border border-line bg-card p-0.5 text-[12px] font-normal" role="radiogroup" aria-label="Como informar a área">
                  {(
                    [
                      ["talhao", "Área por talhão"],
                      ["rateio", "Volume rateado"],
                    ] as const
                  ).map(([v, r]) => (
                    <button
                      key={v}
                      type="button"
                      role="radio"
                      aria-checked={form.modoArea === v}
                      onClick={() => upd({ modoArea: v })}
                      className={`rounded-md px-3 py-0.5 font-medium ${form.modoArea === v ? "bg-navy-900 text-white" : "text-navy-800 hover:bg-surface"}`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              )}
              {prontoTalhoes && linhas.length > 0 && (
                <span className="ml-auto flex gap-2 text-[12px] font-normal">
                  {rateio ? (
                    <>
                      <button type="button" className={BOTAO} onClick={() => upd({ marcados: Object.fromEntries(linhas.map((l) => [l.k, true])) })}>
                        Marcar todos
                      </button>
                      <button type="button" className={BOTAO} onClick={() => upd({ marcados: {} })}>
                        Desmarcar
                      </button>
                    </>
                  ) : (
                    <>
                      {!form.semOS && (
                        <button type="button" className={BOTAO} onClick={() => upd({ areas: Object.fromEntries(linhas.map((l) => [l.k, texto(l.saldo)])) })}>
                          Preencher com o saldo
                        </button>
                      )}
                      <button type="button" className={BOTAO} onClick={() => upd({ areas: {} })}>
                        Limpar áreas
                      </button>
                    </>
                  )}
                </span>
              )}
            </div>

            {prontoTalhoes && rateio && (
              <div className="mb-2 flex flex-wrap items-end gap-3">
                <div className="w-[160px]">
                  <label className={ROTULO}>Volume a ratear (ha)</label>
                  <input value={form.volume} onChange={(e) => upd({ volume: e.target.value })} inputMode="decimal" className={`${INPUT} text-right tabular`} aria-label="Volume a ratear" />
                </div>
                <p className="pb-1.5 text-[12px] text-muted">
                  {marcadosQtd === 0
                    ? "Marque os talhões que recebem o rateio."
                    : somaPeso > 0
                      ? `Rateado entre ${marcadosQtd} talhão(ões), proporcional à ${form.semOS ? "área do talhão" : "área recomendada"} (${nf(somaPeso)} ha).`
                      : `Rateado igualmente entre ${marcadosQtd} talhão(ões) (sem área cadastrada).`}
                </p>
              </div>
            )}

            {prontoTalhoes ? (
              <div className="overflow-x-auto rounded-lg border border-line bg-card">
                <table className="w-full min-w-[680px] text-[12.5px]">
                  <thead>
                    <tr className="border-b border-line bg-surface text-left text-muted">
                      {rateio && <th className="w-9 px-3 py-1.5" />}
                      <th className="px-3 py-1.5 font-medium">Fazenda</th>
                      <th className="px-3 py-1.5 font-medium">Descrição Fazenda</th>
                      <th className="px-3 py-1.5 font-medium">Talhão</th>
                      <th className="px-3 py-1.5 text-right font-medium">Área talhão</th>
                      {!form.semOS && (
                        <>
                          <th className="px-3 py-1.5 text-right font-medium">Área recomendada</th>
                          <th className="px-3 py-1.5 text-right font-medium">Já apontado</th>
                          <th className="px-3 py-1.5 text-right font-medium">Saldo</th>
                        </>
                      )}
                      <th className="w-[140px] px-3 py-1.5 text-right font-medium">{rateio ? "Rateio (ha)" : "Área realizada (ha)"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {linhas.map((l) => {
                      const passaSaldo = l.saldo !== null && l.area > 0 && l.area > l.saldo + 0.001;
                      const passaTalhao = l.areaTlh !== null && l.area > l.areaTlh + 0.001;
                      return (
                        <tr key={l.k} className={`border-t border-line/60 ${rateio && !l.marcado ? "text-muted" : ""}`}>
                          {rateio && (
                            <td className="px-3 py-1">
                              <input
                                type="checkbox"
                                checked={l.marcado}
                                onChange={(e) => upd({ marcados: { ...form.marcados, [l.k]: e.target.checked } })}
                                aria-label={`Ratear no talhão ${l.tlh}`}
                              />
                            </td>
                          )}
                          <td className="px-3 py-1 tabular text-muted">{l.propCod}</td>
                          <td className="px-3 py-1 text-muted">{l.propNm}</td>
                          <td className="px-3 py-1 tabular text-ink">{l.tlh}</td>
                          <td className="px-3 py-1 text-right tabular">{l.areaTlh !== null ? nf(l.areaTlh) : "—"}</td>
                          {!form.semOS && (
                            <>
                              <td className="px-3 py-1 text-right tabular">{l.areaRec !== null ? nf(l.areaRec) : "—"}</td>
                              <td className="px-3 py-1 text-right tabular text-muted">{l.ja ? nf(l.ja) : "—"}</td>
                              <td className="px-3 py-1 text-right tabular">{l.saldo !== null ? nf(l.saldo) : "—"}</td>
                            </>
                          )}
                          <td className="px-2 py-0.5">
                            {rateio ? (
                              <div className={`px-2 py-1 text-right tabular ${passaTalhao ? "font-medium text-alert-700" : passaSaldo ? "text-amber-700" : "text-ink"}`}>{l.marcado ? nf(l.area) : "—"}</div>
                            ) : (
                              <input
                                value={l.valor}
                                onChange={(e) => upd({ areas: { ...form.areas, [l.k]: e.target.value } })}
                                inputMode="decimal"
                                className={`w-full rounded border px-2 py-1 text-right tabular ${passaTalhao ? "border-alert-500 bg-alert-50" : passaSaldo ? "border-amber-500 bg-amber-50" : "border-line bg-card"}`}
                                aria-label={`Área realizada no talhão ${l.tlh}`}
                                title={passaTalhao ? "Passa da área do talhão" : passaSaldo ? "Passa do saldo da O.S. neste talhão" : undefined}
                              />
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {linhas.length === 0 && (
                      <tr>
                        <td colSpan={9} className="px-3 py-4 text-center text-muted">
                          Nenhum talhão cadastrado para esta fazenda. Inclua os talhões abaixo.
                        </td>
                      </tr>
                    )}
                    <tr className="border-t border-line bg-surface font-semibold">
                      <td className="px-3 py-1.5" colSpan={rateio ? 4 : 3}>
                        Total
                      </td>
                      <td className="px-3 py-1.5 text-right tabular">{nf(linhas.reduce((a, l) => a + (l.areaTlh ?? 0), 0))}</td>
                      {!form.semOS && (
                        <>
                          <td className="px-3 py-1.5 text-right tabular">{nf(linhas.reduce((a, l) => a + (l.areaRec ?? 0), 0))}</td>
                          <td className="px-3 py-1.5 text-right tabular">{nf(linhas.reduce((a, l) => a + l.ja, 0))}</td>
                          <td className="px-3 py-1.5 text-right tabular">{nf(linhas.reduce((a, l) => a + (l.saldo ?? 0), 0))}</td>
                        </>
                      )}
                      <td className="px-3 py-1.5 text-right tabular">{nf(totalDia)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="rounded-lg border border-dashed border-line bg-card/50 px-4 py-5 text-center text-[12.5px] text-muted">
                {form.semOS ? "Os talhões aparecem aqui depois de informar a fazenda." : "Os talhões aparecem aqui depois de buscar a O.S."}
              </p>
            )}
            {form.semOS && fazenda && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  value={novoTalhao}
                  onChange={(e) => setNovoTalhao(e.target.value.toUpperCase().slice(0, 12))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      incluirTalhao();
                    }
                  }}
                  placeholder="Nº do talhão"
                  className="w-[120px] rounded-md border border-line bg-card px-2.5 py-1.5 text-[12.5px] text-ink"
                  aria-label="Talhão a incluir"
                />
                <button type="button" className={BOTAO} onClick={incluirTalhao} disabled={!novoTalhao.trim()}>
                  Incluir talhão
                </button>
                <span className="text-[11.5px] text-muted">Para talhão que não está na lista da fazenda.</span>
              </div>
            )}
            <p className="mt-2 text-[11.5px] text-muted">
              {form.semOS
                ? "Os talhões da fazenda vêm do histórico de safras (ou das ordens de corte). No volume rateado, cada talhão marcado recebe a parte proporcional à sua área."
                : "Saldo = área recomendada na O.S. (ou a do talhão) menos o que já foi apontado. Área acima do saldo fica destacada, mas pode ser gravada; acima da área do talhão, não."}
            </p>

            <div className="mt-4 flex flex-wrap justify-end gap-2">
              {(form.id || form.os || form.fazCod) && (
                <button type="button" onClick={() => limpar()} className={BOTAO}>
                  {form.id ? "Cancelar edição" : "Limpar"}
                </button>
              )}
              <button type="button" onClick={salvar} disabled={!podeSalvar} className="rounded-lg bg-navy-900 px-5 py-2 text-[13px] font-medium text-white hover:bg-navy-800 disabled:opacity-40">
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
            <table className="w-full min-w-[1100px] text-[12.5px]">
              <thead>
                <tr className="border-b border-line bg-surface text-left text-muted">
                  <th className="px-3 py-1.5 font-medium">Boletim</th>
                  <th className="px-3 py-1.5 font-medium">Data</th>
                  <th className="px-3 py-1.5 font-medium">O.S.</th>
                  <th className="px-3 py-1.5 font-medium">Fazenda</th>
                  <th className="px-3 py-1.5 font-medium">Descrição Fazenda</th>
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
                    <td colSpan={14} className="px-3 py-6 text-center text-muted">
                      Carregando…
                    </td>
                  </tr>
                )}
                {!carregando && lista.length === 0 && (
                  <tr>
                    <td colSpan={14} className="px-3 py-6 text-center text-muted">
                      Nenhum apontamento no período.
                    </td>
                  </tr>
                )}
                {lista.map((a) => {
                  const codigos = Array.from(new Set(a.talhoes.map((t) => t.propCod)));
                  const nomes = Array.from(new Set(a.talhoes.map((t) => t.propNm).filter(Boolean)));
                  return (
                    <Fragment key={a.id}>
                      <tr className={`border-t border-line/60 ${form.id === a.id ? "bg-[#2E5FA8]/[0.08]" : ""}`}>
                        <td className="px-3 py-1.5 tabular font-medium text-ink">{a.boletim ?? "—"}</td>
                        <td className="px-3 py-1.5 tabular">{fmtDateBR(a.dt)}</td>
                        <td className="px-3 py-1.5 tabular font-medium text-ink">
                          <button type="button" className="hover:underline" onClick={() => setAberto(aberto === a.id ? null : a.id)} title="Ver talhões">
                            {a.os || <span className="font-normal text-muted">Sem O.S.</span>}
                          </button>
                        </td>
                        <td className="px-3 py-1.5 tabular">{codigos.join(", ")}</td>
                        <td className="max-w-[220px] truncate px-3 py-1.5" title={nomes.join(" / ")}>
                          {nomes.join(" / ")}
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
                        <td className="px-3 py-1.5 text-right tabular font-medium" title={a.modoArea === "rateio" ? "Volume rateado entre os talhões" : undefined}>
                          {nf(a.areaTotal)}
                          {a.modoArea === "rateio" && <span className="ml-1 text-[10.5px] font-normal text-muted">rat.</span>}
                        </td>
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
                          <td colSpan={14} className="px-4 py-2 text-[12px] text-muted">
                            {a.modoArea === "rateio" && `Volume de ${nf(a.volume ?? a.areaTotal)} ha rateado · `}
                            {a.talhoes.map((t) => `Talhão ${t.tlh}: ${nf(t.area)} ha`).join(" · ")}
                            {a.obs ? ` · Obs.: ${a.obs}` : ""}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
                {lista.length > 0 && (
                  <tr className="border-t border-line bg-surface font-semibold">
                    <td colSpan={11} className="px-3 py-1.5">
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
