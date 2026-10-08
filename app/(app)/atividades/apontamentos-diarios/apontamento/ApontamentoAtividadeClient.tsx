"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import BotaoLog from "@/components/BotaoLog";
import BotaoLimparFiltros from "@/components/BotaoLimparFiltros";
import {
  camposFaltando,
  chaveTalhao,
  ratearArea,
  REGRAS_PADRAO,
  round2,
  type ApontamentoDiario,
  type CampoApontamento,
  type ConsultaOS,
  type ModoArea,
  type OperacaoOS,
} from "@/lib/atividades";
import type { OpcoesApontamento } from "@/lib/db-atividades";
import { fmtDateBR, todayISO } from "@/lib/format";
import { addDays } from "@/lib/period";
import type { VerificacaoSemOS } from "@/lib/db-atividades";
import { podeEditar } from "@/lib/permissoes";
import type { PerfilUsuario } from "@/lib/types";

const INPUT = "w-full rounded-md border border-line bg-card px-2.5 py-1.5 text-[13px] text-ink disabled:opacity-60";
const ROTULO = "mb-1 block truncate text-[11.5px] font-medium text-muted";
const BOTAO = "rounded-lg border border-line bg-card px-3 py-1.5 text-[12.5px] font-medium text-navy-800 hover:bg-surface disabled:opacity-50";
const CELULA = "w-full rounded border border-line bg-card px-2 py-1 text-[12.5px] text-ink";

const nf = (n: number, c = 2) => n.toLocaleString("pt-BR", { minimumFractionDigits: c, maximumFractionDigits: c });
function numero(v: string): number {
  const t = v.trim();
  if (!t) return 0;
  return t.includes(",") ? Number(t.replace(/\./g, "").replace(",", ".")) : Number(t);
}
const texto = (n: number | null) => (n ? String(round2(n)).replace(".", ",") : "");
const corStatus = (s: string) => (/encerr/i.test(s) ? "bg-surface text-muted" : /liber/i.test(s) ? "bg-brand-50 text-brand-700" : "bg-good-50 text-good-600");

let seqLinha = 0;
const novaChave = () => `l${++seqLinha}`;

/** Linha da tabela de talhões quando não há O.S. (fazenda e talhão digitados). */
interface LinhaLivre {
  key: string;
  faz: string;
  fazNm: string;
  tlh: string;
  areaTlh: number | null;
  valor: string;
  marcado: boolean;
}
const linhaVazia = (faz = "", fazNm = ""): LinhaLivre => ({ key: novaChave(), faz, fazNm, tlh: "", areaTlh: null, valor: "", marcado: true });

interface Form {
  id?: number;
  boletim: string;
  dt: string;
  os: string;
  opCod: string;
  opDs: string;
  solicitante: string;
  etapaCod: string;
  tipoAplicacao: string;
  numEquipamentos: string;
  numPessoas: string;
  obs: string;
  eqp: string;
  vazaoRec: string;
  /** em branco = calculada (volume de calda ÷ área do dia) */
  vazaoUti: string;
  volCalda: string;
  modoArea: ModoArea;
  volume: string;
  /** com O.S.: área digitada por talhão (chave fazenda|talhão) e talhões marcados para o rateio */
  areas: Record<string, string>;
  marcados: Record<string, boolean>;
  /** sem O.S.: fazenda e talhão em tabela (pode haver mais de uma fazenda) */
  livres: LinhaLivre[];
}

/** a tabela começa com 8 linhas; Enter na área da última abre outra */
const LINHAS_INICIAIS = 8;
const linhasIniciais = () => Array.from({ length: LINHAS_INICIAIS }, () => linhaVazia());

const formVazio = (): Form => ({
  boletim: "", dt: todayISO(), os: "", opCod: "", opDs: "", solicitante: "", etapaCod: "", tipoAplicacao: "",
  numEquipamentos: "", numPessoas: "", obs: "", eqp: "", vazaoRec: "", vazaoUti: "", volCalda: "",
  modoArea: "talhao", volume: "", areas: {}, marcados: {}, livres: linhasIniciais(),
});

/** Linha calculada para a tabela (com ou sem O.S.). */
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
  area: number;
}

export default function ApontamentoAtividadeClient({ perfil, nomeUsuario }: { perfil: PerfilUsuario; nomeUsuario: string }) {
  const podeGravar = podeEditar(perfil);
  const [form, setForm] = useState<Form>(formVazio);
  const [osInfo, setOsInfo] = useState<ConsultaOS | null>(null);
  const [buscandoOS, setBuscandoOS] = useState(false);
  const [erroOS, setErroOS] = useState<string | null>(null);
  /** fazendas consultadas no Cadastro de Fazenda: código → descrição e talhões (null = não cadastrada) */
  const [fazendas, setFazendas] = useState<Record<string, { nm: string; talhoes: { tlh: string; area: number | null }[] } | null>>({});
  const [incluirFaz, setIncluirFaz] = useState("");
  const [opcoes, setOpcoes] = useState<OpcoesApontamento | null>(null);

  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState<{ texto: string; erro: boolean } | null>(null);
  const [importar, setImportar] = useState(false);
  const [base, setBase] = useState<{ ordens: number; ultimaImportacao: string | null } | null>(null);
  const osRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLElement>(null);
  const gravarRef = useRef<HTMLButtonElement>(null);
  const [verificar, setVerificar] = useState(false);

  // lista
  const [de, setDe] = useState(addDays(todayISO(), -6));
  const [ate, setAte] = useState(todayISO());
  const [filtroOS, setFiltroOS] = useState("");
  const [filtroBoletim, setFiltroBoletim] = useState("");
  const algumFiltroAtivo = de !== addDays(todayISO(), -6) || ate !== todayISO() || filtroOS !== "" || filtroBoletim !== "";
  function limparFiltros() {
    setDe(addDays(todayISO(), -6));
    setAte(todayISO());
    setFiltroOS("");
    setFiltroBoletim("");
  }
  const [lista, setLista] = useState<ApontamentoDiario[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [aberto, setAberto] = useState<number | null>(null);

  const upd = (p: Partial<Form>) => setForm((f) => ({ ...f, ...p }));
  // campos obrigatórios (Parâmetros › Apontamento Diário): marcados com * na tela
  const regras = opcoes?.regras ?? REGRAS_PADRAO;
  const rot = (campo: CampoApontamento, texto: string) => (regras[campo] ? `${texto} *` : texto);
  const op: OperacaoOS | null = osInfo?.operacoes.find((o) => o.cod === form.opCod) ?? null;
  const comOS = !!osInfo;

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
    fetch("/api/atividades/apontamentos?opcoes=1", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => !j.error && setOpcoes(j))
      .catch(() => {});
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
        opDs: primeira?.ds ?? "",
        etapaCod: manter?.etapaCod ?? primeira?.etapaCod ?? "",
        tipoAplicacao: manter?.tipoAplicacao ?? (primeira?.tipoDs || primeira?.tipoCod || f.tipoAplicacao),
        solicitante: manter?.solicitante ?? (f.solicitante || info.resp),
        areas: manter?.areas ?? {},
        // na edição de um rateio, só os talhões do apontamento ficam marcados
        marcados: manter?.marcados
          ? Object.fromEntries((primeira?.talhoes ?? []).map((t) => [chaveTalhao(t.propCod, t.tlh), !!manter.marcados![chaveTalhao(t.propCod, t.tlh)]]))
          : {},
      }));
    } catch (e) {
      setOsInfo(null);
      setErroOS(e instanceof Error ? e.message : "O.S. não encontrada.");
    } finally {
      setBuscandoOS(false);
    }
  }

  /** Consulta a fazenda no Cadastro de Fazenda (com os talhões) e guarda para as linhas da tabela. */
  async function consultarFazenda(cod: string) {
    const c = cod.trim();
    if (!c || c in fazendas) return fazendas[c] ?? null;
    try {
      const r1 = await fetch(`/api/rodadas/apontamento?cad=fazendas&cod=${encodeURIComponent(c)}`, { cache: "no-store" });
      const j1 = await r1.json();
      if (!r1.ok || !j1.item) {
        setFazendas((m) => ({ ...m, [c]: null }));
        return null;
      }
      const r2 = await fetch(`/api/rodadas/apontamento?talhoes_faz=${encodeURIComponent(j1.item.cod)}`, { cache: "no-store" });
      const j2 = await r2.json();
      const f = { nm: String(j1.item.nm), talhoes: (r2.ok ? j2.talhoes ?? [] : []) as { tlh: string; area: number | null }[] };
      setFazendas((m) => ({ ...m, [c]: f }));
      return f;
    } catch {
      return null;
    }
  }

  const updLivre = (key: string, p: Partial<LinhaLivre>) => setForm((f) => ({ ...f, livres: f.livres.map((l) => (l.key === key ? { ...l, ...p } : l)) }));

  async function sairDaFazenda(l: LinhaLivre) {
    const f = await consultarFazenda(l.faz);
    updLivre(l.key, { fazNm: f?.nm ?? "", areaTlh: f?.talhoes.find((t) => t.tlh === l.tlh.trim())?.area ?? null });
  }

  function trocarTalhao(l: LinhaLivre, tlh: string) {
    const f = fazendas[l.faz.trim()];
    updLivre(l.key, { tlh, areaTlh: f?.talhoes.find((t) => t.tlh === tlh.trim())?.area ?? null });
  }

  /** Fim do formulário: foca o botão de gravar (Enter grava); se ainda falta algo, tenta gravar para mostrar o que falta. */
  function irParaGravar() {
    if (gravarRef.current && !gravarRef.current.disabled) gravarRef.current.focus();
    else salvar();
  }

  /** Próximo campo de lançamento (ordem da tela); no fim, o botão de gravar. */
  function focarProximo(atual: HTMLElement) {
    const campos = Array.from(formRef.current?.querySelectorAll<HTMLElement>("[data-nav]") ?? []).filter(
      (el) => !(el as HTMLInputElement).disabled && el.offsetParent !== null
    );
    const i = campos.indexOf(atual);
    const prox = i >= 0 ? campos[i + 1] : undefined;
    if (prox) {
      prox.focus();
      if (prox instanceof HTMLInputElement) prox.select();
    } else irParaGravar();
  }

  /** Enter muda de caixa (os campos da tabela têm regra própria). */
  function aoTeclarNoForm(e: React.KeyboardEvent<HTMLElement>) {
    const alvo = e.target as HTMLElement;
    if (e.key !== "Enter" || !alvo.hasAttribute("data-nav") || e.defaultPrevented) return;
    e.preventDefault();
    focarProximo(alvo);
  }

  /** Foca já se o campo existe (para não perder o que for digitado em seguida); linha recém-criada, depois de desenhar. */
  function focarCampo(seletor: string) {
    const focar = () => {
      const el = formRef.current?.querySelector<HTMLInputElement>(seletor);
      el?.focus();
      el?.select();
      return !!el;
    };
    if (!focar()) setTimeout(focar, 0);
  }

  /** Sem O.S.: Enter na área vai para a linha de baixo, já com a fazenda de cima (abre linha nova no fim). */
  function enterNaAreaLivre(e: React.KeyboardEvent<HTMLInputElement>, key: string) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const i = form.livres.findIndex((l) => l.key === key);
    const atual = form.livres[i];
    // área em branco: fim da tabela
    if (!atual.valor.trim() && form.modoArea !== "rateio") return irParaGravar();
    const prox = form.livres[i + 1];
    if (prox) {
      if (!prox.faz.trim() && atual.faz.trim()) updLivre(prox.key, { faz: atual.faz, fazNm: atual.fazNm, areaTlh: null });
      focarCampo(prox.faz.trim() || atual.faz.trim() ? `[data-tlh="${prox.key}"]` : `[data-faz="${prox.key}"]`);
    } else {
      const nova = linhaVazia(atual.faz, atual.fazNm);
      setForm((f) => ({ ...f, livres: [...f.livres, nova] }));
      focarCampo(atual.faz.trim() ? `[data-tlh="${nova.key}"]` : `[data-faz="${nova.key}"]`);
    }
  }

  /** Talhão em branco + Enter = terminou a tabela: vai para o botão de gravar. */
  function enterNoTalhao(e: React.KeyboardEvent<HTMLInputElement>, l: LinhaLivre) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    // talhão em branco: termina (talhão obrigatório ou linha vazia) ou segue para a área (fazenda sem talhão)
    if (!l.tlh.trim() && (regras.talhao || !l.faz.trim())) irParaGravar();
    else focarCampo(`[data-area="${l.key}"]`);
  }

  /** Com O.S.: Enter na área vai para a área do talhão de baixo; no último, para o botão de gravar. */
  function enterNaAreaOS(e: React.KeyboardEvent<HTMLInputElement>, k: string) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const i = linhas.findIndex((l) => l.k === k);
    const prox = linhas[i + 1];
    if (prox) focarCampo(`[data-area="${CSS.escape(prox.k)}"]`);
    else irParaGravar();
  }

  /** Inclui de uma vez todos os talhões da fazenda que ainda não estão na tabela. */
  async function incluirTalhoesDaFazenda() {
    const c = incluirFaz.trim();
    if (!c) return;
    const f = await consultarFazenda(c);
    if (!f) return setMsg({ texto: `A fazenda ${c} não está no Cadastro de Fazenda.`, erro: true });
    if (f.talhoes.length === 0) return setMsg({ texto: `A fazenda ${c} não tem talhões no histórico de safras nem nas ordens de corte; inclua as linhas à mão.`, erro: true });
    setForm((x) => {
      const ja = new Set(x.livres.filter((l) => l.faz.trim() === c).map((l) => l.tlh.trim()));
      const vazias = x.livres.filter((l) => l.faz.trim() || l.tlh.trim() || l.valor.trim());
      const novas = f.talhoes.filter((t) => !ja.has(t.tlh)).map((t) => ({ ...linhaVazia(c, f.nm), tlh: t.tlh, areaTlh: t.area }));
      const todas = [...vazias, ...novas];
      // sempre sobra linha em branco para continuar lançando
      const sobra = Math.max(1, LINHAS_INICIAIS - todas.length);
      return { ...x, livres: [...todas, ...Array.from({ length: sobra }, () => linhaVazia())] };
    });
    setIncluirFaz("");
  }

  function trocarOperacao(cod: string) {
    const o = osInfo?.operacoes.find((x) => x.cod === cod);
    upd({ opCod: cod, opDs: o?.ds ?? "", etapaCod: o?.etapaCod ?? "", tipoAplicacao: o?.tipoDs || o?.tipoCod || form.tipoAplicacao, areas: {}, marcados: {} });
  }

  /** Sem O.S.: o campo de operação aceita "código · descrição" da lista ou o código digitado. */
  function escolherOperacao(v: string) {
    const cod = v.split("·")[0].trim();
    const o = opcoes?.operacoes.find((x) => x.cod === cod);
    upd({ opCod: cod, opDs: o?.ds ?? "", etapaCod: form.etapaCod || o?.etapaCod || "" });
  }

  const linhas: Linha[] = useMemo(() => {
    let base: Linha[] = [];
    if (comOS) {
      if (!op) return [];
      const feitos = osInfo?.realizado[op.cod] ?? {};
      base = op.talhoes.map((t) => {
        const k = chaveTalhao(t.propCod, t.tlh);
        const ja = feitos[k] ?? 0;
        const ref = t.areaRec ?? t.areaTlh ?? 0;
        return {
          k, propCod: t.propCod, propNm: t.propNm, tlh: t.tlh, areaTlh: t.areaTlh, areaRec: t.areaRec, ja, saldo: Math.max(0, round2(ref - ja)),
          valor: form.areas[k] ?? "", marcado: form.marcados[k] !== false, area: 0,
        };
      });
    } else {
      base = form.livres.map((l) => ({
        k: l.key, propCod: l.faz.trim(), propNm: l.fazNm, tlh: l.tlh.trim(), areaTlh: l.areaTlh, areaRec: null, ja: 0, saldo: null,
        valor: l.valor, marcado: l.marcado, area: 0,
      }));
    }
    if (form.modoArea === "rateio") {
      const marc = base.filter((l) => l.marcado && (comOS || (l.propCod && (l.tlh || !regras.talhao))));
      const rat = ratearArea(numero(form.volume) || 0, marc.map((l) => l.areaRec ?? l.areaTlh));
      marc.forEach((l, i) => (l.area = rat[i]));
    } else base.forEach((l) => (l.area = numero(l.valor) || 0));
    return base;
  }, [comOS, op, osInfo, form.areas, form.marcados, form.livres, form.modoArea, form.volume, regras.talhao]);
  const totalDia = round2(linhas.reduce((a, l) => a + l.area, 0));
  const fazendasOS = Array.from(new Set(linhas.map((l) => `${l.propCod} · ${l.propNm}`)));
  const rateio = form.modoArea === "rateio";

  /** Digitou a área do dia: ela é rateada entre os talhões marcados (vazio volta para a área por talhão). */
  function digitarAreaDia(v: string) {
    if (!v.trim()) return upd({ modoArea: "talhao", volume: "", areas: {}, livres: form.livres.map((l) => ({ ...l, valor: "" })) });
    upd({ modoArea: "rateio", volume: v });
  }

  /** Digitou num talhão: passa para a área por talhão, mantendo o que o rateio tinha distribuído nos outros. */
  function digitarAreaTalhao(k: string, v: string) {
    const atual = new Map(linhas.map((l) => [l.k, form.modoArea === "rateio" ? texto(l.area) : l.valor]));
    atual.set(k, v);
    if (comOS) upd({ modoArea: "talhao", volume: "", areas: Object.fromEntries(atual) });
    else upd({ modoArea: "talhao", volume: "", livres: form.livres.map((l) => ({ ...l, valor: atual.get(l.key) ?? l.valor })) });
  }

  function limparAreas() {
    if (comOS) upd({ modoArea: "talhao", volume: "", areas: {} });
    else upd({ modoArea: "talhao", volume: "", livres: form.livres.map((l) => ({ ...l, valor: "" })) });
  }

  function limpar() {
    setForm(formVazio());
    setOsInfo(null);
    setErroOS(null);
    setIncluirFaz("");
    sugerirBoletim();
    setTimeout(() => osRef.current?.focus(), 0);
  }

  async function salvar() {
    if (!podeGravar || salvando) return;
    setMsg(null);
    if (form.os.trim() && !osInfo) return setMsg({ texto: "Tecle Enter na O.S. para trazer os talhões, ou apague o número para lançar sem O.S.", erro: true });
    if (regras.os && !comOS) return setMsg({ texto: "Informe a Ordem de Serviço (obrigatória nos Parâmetros).", erro: true });
    if (comOS && !form.opCod.trim()) return setMsg({ texto: "Escolha a operação.", erro: true });
    const falta = camposFaltando(
      {
        opCod: form.opCod,
        solicitante: form.solicitante,
        etapaCod: form.etapaCod,
        tipoAplicacao: form.tipoAplicacao,
        eqp: form.eqp,
        numEquipamentos: Number(form.numEquipamentos || 0),
        numPessoas: Number(form.numPessoas || 0),
        vazaoRec: form.vazaoRec.trim() ? numero(form.vazaoRec) : null,
        volCalda: form.volCalda.trim() ? numero(form.volCalda) : null,
        vazaoUti: form.vazaoUti.trim() ? numero(form.vazaoUti) : null,
        obs: form.obs,
      },
      regras,
      !form.vazaoUti.trim() && vazaoCalculada !== null
    );
    if (falta.length) return setMsg({ texto: `Preencha: ${falta.join(", ")}.`, erro: true });
    let enviados = rateio ? linhas.filter((l) => l.marcado && (comOS || (l.propCod && (l.tlh || !regras.talhao)))) : linhas.filter((l) => l.area > 0);
    if (!comOS) {
      enviados = enviados.filter((l) => l.propCod || l.tlh);
      const incompleta = enviados.find((l) => !l.propCod || (regras.talhao && !l.tlh));
      if (incompleta) return setMsg({ texto: regras.talhao ? "Há linha com fazenda ou talhão em branco." : "Há linha sem fazenda.", erro: true });
      const semCadastro = enviados.find((l) => fazendas[l.propCod] === null);
      if (semCadastro) return setMsg({ texto: `A fazenda ${semCadastro.propCod} não está no Cadastro de Fazenda.`, erro: true });
    }
    if (!rateio) {
      const invalido = linhas.find((l) => l.valor.trim() && (!Number.isFinite(numero(l.valor)) || numero(l.valor) < 0));
      if (invalido) return setMsg({ texto: `Área inválida no talhão ${invalido.propCod}-${invalido.tlh}.`, erro: true });
    }
    setSalvando(true);
    try {
      const res = await fetch("/api/atividades/apontamentos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: form.id,
          boletim: Number(form.boletim || 0),
          dt: form.dt,
          os: comOS ? form.os : "",
          opCod: form.opCod,
          opDs: form.opDs,
          solicitante: form.solicitante,
          etapaCod: form.etapaCod,
          tipoAplicacao: form.tipoAplicacao,
          numEquipamentos: Number(form.numEquipamentos || 0),
          numPessoas: Number(form.numPessoas || 0),
          obs: form.obs,
          eqp: form.eqp,
          vazaoRec: form.vazaoRec,
          vazaoUti: form.vazaoUti,
          volCalda: form.volCalda,
          modoArea: form.modoArea,
          volume: rateio ? numero(form.volume) : null,
          talhoes: enviados.map((l) => ({ propCod: l.propCod, tlh: l.tlh, area: l.area })),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Não foi possível salvar.");
      const onde = comOS ? `na O.S. ${form.os}` : "sem O.S.";
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
      os: a.os,
      opCod: a.opCod,
      opDs: a.opDs,
      solicitante: a.solicitante,
      etapaCod: a.etapaCod,
      tipoAplicacao: a.tipoAplicacao,
      numEquipamentos: String(a.numEquipamentos),
      numPessoas: String(a.numPessoas),
      obs: a.obs,
      eqp: a.eqp,
      vazaoRec: texto(a.vazaoRec),
      vazaoUti: a.vazaoAuto ? "" : texto(a.vazaoUti),
      volCalda: texto(a.volCalda),
      modoArea: a.modoArea,
      volume: a.modoArea === "rateio" ? texto(a.volume ?? a.areaTotal) : "",
      areas,
      marcados,
      livres: semOS
        ? [
            ...a.talhoes.map((t) => ({ key: novaChave(), faz: t.propCod, fazNm: t.propNm, tlh: t.tlh, areaTlh: t.areaTlh, valor: texto(t.area), marcado: true })),
            linhaVazia(a.talhoes[a.talhoes.length - 1]?.propCod ?? "", a.talhoes[a.talhoes.length - 1]?.propNm ?? ""),
          ]
        : linhasIniciais(),
    };
    setForm(novo);
    setOsInfo(null);
    setErroOS(null);
    if (semOS) for (const c of new Set(a.talhoes.map((t) => t.propCod))) consultarFazenda(c);
    else buscarOS(a.os, novo, a.id);
    window.scrollTo({ top: 0 });
  }

  async function excluir(a: ApontamentoDiario) {
    const onde = a.os ? `O.S. ${a.os}` : "sem O.S.";
    if (!window.confirm(`Excluir o boletim nº ${a.boletim ?? a.id} (${onde}, ${fmtDateBR(a.dt)})? A exclusão fica no log.`)) return;
    const res = await fetch("/api/atividades/apontamentos", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: a.id }) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return setMsg({ texto: json.error ?? "Não foi possível excluir.", erro: true });
    if (form.id === a.id) limpar();
    setMsg({ texto: `Boletim nº ${a.boletim ?? a.id} excluído.`, erro: false });
    carregarLista();
  }

  const salvarRef = useRef(salvar);
  salvarRef.current = salvar;
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "F2") {
        e.preventDefault();
        salvarRef.current();
      }
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, []);

  // vazão utilizada calculada: volume de calda ÷ área do dia (vale quando o campo fica em branco)
  const vazaoCalculada = numero(form.volCalda) > 0 && totalDia > 0 ? round2(numero(form.volCalda) / totalDia) : null;

  const totalLista = round2(lista.reduce((a, x) => a + x.areaTotal, 0));
  const marcadosQtd = linhas.filter((l) => l.marcado && (comOS || (l.propCod && l.tlh))).length;
  const somaPeso = round2(linhas.filter((l) => l.marcado).reduce((a, l) => a + ((l.areaRec ?? l.areaTlh) ?? 0), 0));
  const podeSalvar = !salvando && !!form.boletim && totalDia > 0 && (!comOS || !!op);

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
        {podeGravar && (
          <button type="button" onClick={() => setVerificar(true)} className={BOTAO} title="Procura O.S. aberta para os apontamentos lançados sem O.S. no período da lista">
            Verificar O.S.
          </button>
        )}
        <BotaoLog titulo="Log dos Apontamentos Diários" filtro={{ modulo: "Atividades" }} />
      </header>

      <div className="flex-1 space-y-5 overflow-y-auto px-3 py-4 md:px-6 md:py-5">
        {msg && <p className={`rounded-md border px-3 py-2 text-[13px] ${msg.erro ? "border-alert-500/40 bg-alert-50 text-alert-700" : "border-good-500/40 bg-good-50 text-good-700"}`}>{msg.texto}</p>}

        {podeGravar && (
          <section className="caixa-form" ref={formRef} onKeyDown={aoTeclarNoForm}>
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
                <input data-nav type="date" value={form.dt} onChange={(e) => upd({ dt: e.target.value })} className={INPUT} />
              </div>
              <div>
                <label className={ROTULO}>{rot("os", "Ordem de Serviço")}</label>
                <input
                  ref={osRef}
                  value={form.os}
                  onChange={(e) => {
                    upd({ os: e.target.value.replace(/\D/g, "") });
                    if (osInfo) setOsInfo(null);
                    setErroOS(null);
                  }}
                  onBlur={() => form.os && !osInfo && buscarOS(form.os)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      if (form.os && !osInfo) buscarOS(form.os);
                      focarProximo(e.currentTarget);
                    }
                  }}
                  data-nav
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
                  <span className="pb-2 text-[12.5px] text-amber-700">{erroOS} Apague o número para lançar sem O.S.</span>
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
                  <span className="pb-2 text-[12px] text-muted">Com O.S., tecle Enter para trazer as operações e os talhões. Sem O.S., informe a fazenda e os talhões na tabela abaixo.</span>
                )}
              </div>
            </div>

            {/* Operação e recursos: cabeçalho compacto */}
            <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-6">
              <div className="col-span-2">
                <label className={ROTULO}>{rot("operacao", "Operação")}</label>
                {comOS ? (
                  <select data-nav value={form.opCod} onChange={(e) => trocarOperacao(e.target.value)} className={INPUT}>
                    {osInfo?.operacoes.map((o) => (
                      <option key={o.cod} value={o.cod}>
                        {o.cod} · {o.ds || "sem descrição"}
                      </option>
                    ))}
                  </select>
                ) : (
                  <>
                    <input
                      data-nav
                      list="operacoes-ap"
                      value={form.opCod ? `${form.opCod}${form.opDs ? ` · ${form.opDs}` : ""}` : ""}
                      onChange={(e) => escolherOperacao(e.target.value)}
                      placeholder="Código ou escolha da lista"
                      className={INPUT}
                      aria-label="Operação"
                    />
                    <datalist id="operacoes-ap">
                      {opcoes?.operacoes.map((o) => (
                        <option key={o.cod} value={`${o.cod} · ${o.ds}`} />
                      ))}
                    </datalist>
                  </>
                )}
              </div>
              <div className="col-span-2">
                <label className={ROTULO}>{rot("solicitante", "Solicitante")}</label>
                <input data-nav list="solicitantes-ap" value={form.solicitante} onChange={(e) => upd({ solicitante: e.target.value })} className={INPUT} maxLength={80} />
                <datalist id="solicitantes-ap">
                  {(opcoes?.solicitantes ?? []).map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              </div>
              <div className="col-span-1">
                <label className={ROTULO}>{rot("etapa", "Etapa")}</label>
                <select data-nav value={form.etapaCod} onChange={(e) => upd({ etapaCod: e.target.value })} className={INPUT}>
                  <option value="">—</option>
                  {op?.etapaCod && !opcoes?.etapas.some((x) => x.cod === op.etapaCod) && (
                    <option value={op.etapaCod}>
                      {op.etapaCod} · {op.etapaDs}
                    </option>
                  )}
                  {opcoes?.etapas.map((x) => (
                    <option key={x.cod} value={x.cod}>
                      {x.cod} · {x.ds}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-span-1">
                <label className={ROTULO}>{rot("tipoAplicacao", "Tipo de aplicação")}</label>
                <input data-nav list="tipos-apl" value={form.tipoAplicacao} onChange={(e) => upd({ tipoAplicacao: e.target.value })} className={INPUT} maxLength={60} />
                <datalist id="tipos-apl">
                  {Array.from(new Set([...(osInfo?.tiposConhecidos ?? []), ...(opcoes?.tipos ?? [])])).map((t) => (
                    <option key={t} value={t} />
                  ))}
                </datalist>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-[repeat(7,minmax(0,1fr))_minmax(0,2fr)]">
              <div>
                <label className={ROTULO}>{rot("eqp", "Equipamento")}</label>
                <input data-nav value={form.eqp} onChange={(e) => upd({ eqp: e.target.value.toUpperCase().slice(0, 40) })} placeholder="Código" className={`${INPUT} tabular`} aria-label="Código do equipamento" />
              </div>
              <div>
                <label className={ROTULO}>{rot("numEquipamentos", "Nº de equipamentos")}</label>
                <input data-nav value={form.numEquipamentos} onChange={(e) => upd({ numEquipamentos: e.target.value.replace(/\D/g, "") })} inputMode="numeric" className={`${INPUT} text-right tabular`} />
              </div>
              <div>
                <label className={ROTULO}>{rot("numPessoas", "Nº de pessoas")}</label>
                <input data-nav value={form.numPessoas} onChange={(e) => upd({ numPessoas: e.target.value.replace(/\D/g, "") })} inputMode="numeric" className={`${INPUT} text-right tabular`} />
              </div>
              <div>
                <label className={ROTULO}>{rot("vazaoRec", "Vazão Recom. (L/ha)")}</label>
                <input data-nav value={form.vazaoRec} onChange={(e) => upd({ vazaoRec: e.target.value })} inputMode="decimal" className={`${INPUT} text-right tabular`} />
              </div>
              <div>
                <label className={ROTULO}>{rot("volCalda", "Volume de calda (L)")}</label>
                <input data-nav value={form.volCalda} onChange={(e) => upd({ volCalda: e.target.value })} inputMode="decimal" className={`${INPUT} text-right tabular`} />
              </div>
              <div>
                <label className={ROTULO}>{rot("vazaoUti", "Vazão utilizada (L/ha)")}</label>
                <input
                  data-nav
                  value={form.vazaoUti}
                  onChange={(e) => upd({ vazaoUti: e.target.value })}
                  inputMode="decimal"
                  placeholder={vazaoCalculada !== null ? `${nf(vazaoCalculada)} (auto)` : "calda ÷ área"}
                  className={`${INPUT} text-right tabular`}
                  title="Em branco, é calculada: volume de calda ÷ área realizada no dia"
                />
              </div>
              <div>
                <label className={ROTULO} title="Área realizada no dia">Área realizada (ha)</label>
                <input
                  data-nav
                  value={rateio ? form.volume : totalDia ? texto(totalDia) : ""}
                  onChange={(e) => digitarAreaDia(e.target.value)}
                  inputMode="decimal"
                  placeholder="0,00"
                  className={`${INPUT} text-right font-semibold tabular`}
                  aria-label="Área realizada no dia"
                  title="Digite a área do dia para ratear entre os talhões marcados, ou preencha talhão a talhão na tabela"
                />
              </div>
              <div className="col-span-2 md:col-span-1">
                <label className={ROTULO}>{rot("obs", "Observação")}</label>
                <input data-nav value={form.obs} onChange={(e) => upd({ obs: e.target.value })} className={INPUT} maxLength={300} />
              </div>
            </div>

            {/* Fazendas e talhões */}
            <div className="caixa-form-sub flex flex-wrap items-center gap-3">
              <span>
                {comOS ? "Talhões da O.S." : "Fazenda e talhões"} · {linhas.length}
              </span>
              {linhas.length > 0 && (
                <span className="ml-auto flex gap-2 text-[12px] font-normal">
                  {rateio && (
                    <>
                      <button
                        type="button"
                        className={BOTAO}
                        onClick={() =>
                          comOS
                            ? upd({ marcados: Object.fromEntries(linhas.map((l) => [l.k, true])) })
                            : upd({ livres: form.livres.map((l) => ({ ...l, marcado: true })) })
                        }
                      >
                        Marcar todos
                      </button>
                      <button
                        type="button"
                        className={BOTAO}
                        onClick={() =>
                          comOS
                            ? upd({ marcados: Object.fromEntries(linhas.map((l) => [l.k, false])) })
                            : upd({ livres: form.livres.map((l) => ({ ...l, marcado: false })) })
                        }
                      >
                        Desmarcar
                      </button>
                    </>
                  )}
                  {comOS && (
                    <button type="button" className={BOTAO} onClick={() => upd({ modoArea: "talhao", volume: "", areas: Object.fromEntries(linhas.map((l) => [l.k, texto(l.saldo)])) })}>
                      Preencher com o saldo
                    </button>
                  )}
                  <button type="button" className={BOTAO} onClick={limparAreas}>
                    Limpar áreas
                  </button>
                </span>
              )}
            </div>

            {rateio && (
              <p className="mb-2 rounded-md border border-[#2E5FA8]/25 bg-[#2E5FA8]/[0.06] px-3 py-1.5 text-[12px] text-ink">
                {marcadosQtd === 0
                  ? "Marque os talhões que recebem a área do dia."
                  : somaPeso > 0
                    ? `${form.volume} ha rateados entre ${marcadosQtd} talhão(ões) marcado(s), proporcional à ${comOS ? "área recomendada" : "área do talhão"} (${nf(somaPeso)} ha).`
                    : `${form.volume} ha rateados igualmente entre ${marcadosQtd} talhão(ões) marcado(s) (sem área cadastrada).`}{" "}
                Para ajustar um talhão, digite na tabela.
              </p>
            )}

            {comOS && !op ? (
              <p className="rounded-lg border border-dashed border-line bg-card/50 px-4 py-5 text-center text-[12.5px] text-muted">Escolha a operação da O.S.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-line bg-card">
                <table className="w-full min-w-[720px] text-[12.5px]">
                  <thead>
                    <tr className="border-b border-line bg-surface text-left text-muted">
                      {rateio && <th className="w-9 px-3 py-1.5" />}
                      <th className="w-[120px] px-3 py-1.5 font-medium">Fazenda</th>
                      <th className="px-3 py-1.5 font-medium">Descrição Fazenda</th>
                      <th className="w-[110px] px-3 py-1.5 font-medium">{rot("talhao", "Talhão")}</th>
                      <th className="px-3 py-1.5 text-right font-medium">Área talhão</th>
                      {comOS && (
                        <>
                          <th className="px-3 py-1.5 text-right font-medium">Área recomendada</th>
                          <th className="px-3 py-1.5 text-right font-medium">Já apontado</th>
                          <th className="px-3 py-1.5 text-right font-medium">Saldo</th>
                        </>
                      )}
                      <th className="w-[140px] px-3 py-1.5 text-right font-medium">Área realizada (ha)</th>
                      {!comOS && <th className="w-9" />}
                    </tr>
                  </thead>
                  <tbody>
                    {linhas.map((l) => {
                      const passaSaldo = l.saldo !== null && l.area > 0 && l.area > l.saldo + 0.001;
                      const passaTalhao = l.areaTlh !== null && l.area > l.areaTlh + 0.001;
                      const livre = !comOS ? form.livres.find((x) => x.key === l.k)! : null;
                      const cadFaz = livre ? fazendas[livre.faz.trim()] : undefined;
                      return (
                        <tr key={l.k} className={`border-t border-line/60 ${rateio && !l.marcado ? "text-muted" : ""}`}>
                          {rateio && (
                            <td className="px-3 py-1">
                              <input
                                type="checkbox"
                                checked={l.marcado}
                                onChange={(e) => (comOS ? upd({ marcados: { ...form.marcados, [l.k]: e.target.checked } }) : updLivre(l.k, { marcado: e.target.checked }))}
                                aria-label={`Ratear no talhão ${l.tlh}`}
                              />
                            </td>
                          )}
                          {livre ? (
                            <>
                              <td className="px-2 py-0.5">
                                <input
                                  data-nav
                                  data-faz={livre.key}
                                  value={livre.faz}
                                  onChange={(e) => updLivre(livre.key, { faz: e.target.value.replace(/[^\d-]/g, ""), fazNm: "", areaTlh: null })}
                                  onBlur={() => sairDaFazenda(livre)}
                                  inputMode="numeric"
                                  placeholder="Código"
                                  className={`${CELULA} tabular ${cadFaz === null ? "border-amber-500 bg-amber-50" : ""}`}
                                  aria-label="Código da fazenda"
                                />
                              </td>
                              <td className="px-3 py-1 text-muted">{cadFaz === null ? <span className="text-amber-700">Não está no Cadastro de Fazenda</span> : livre.fazNm}</td>
                              <td className="px-2 py-0.5">
                                <input
                                  data-nav
                                  data-tlh={livre.key}
                                  title={cadFaz?.talhoes.length ? `Talhões da fazenda: ${cadFaz.talhoes.map((t) => t.tlh).join(", ")}` : undefined}
                                  value={livre.tlh}
                                  onKeyDown={(e) => enterNoTalhao(e, livre)}
                                  onChange={(e) => trocarTalhao(livre, e.target.value.toUpperCase().slice(0, 12))}
                                  placeholder="Nº"
                                  className={`${CELULA} tabular`}
                                  aria-label="Talhão"
                                />
                              </td>
                            </>
                          ) : (
                            <>
                              <td className="px-3 py-1 tabular text-muted">{l.propCod}</td>
                              <td className="px-3 py-1 text-muted">{l.propNm}</td>
                              <td className="px-3 py-1 tabular text-ink">{l.tlh}</td>
                            </>
                          )}
                          <td className="px-3 py-1 text-right tabular">{l.areaTlh !== null ? nf(l.areaTlh) : "—"}</td>
                          {comOS && (
                            <>
                              <td className="px-3 py-1 text-right tabular">{l.areaRec !== null ? nf(l.areaRec) : "—"}</td>
                              <td className="px-3 py-1 text-right tabular text-muted">{l.ja ? nf(l.ja) : "—"}</td>
                              <td className="px-3 py-1 text-right tabular">{l.saldo !== null ? nf(l.saldo) : "—"}</td>
                            </>
                          )}
                          <td className="px-2 py-0.5">
                            <input
                              data-nav
                              data-area={l.k}
                              value={rateio ? (l.marcado && l.area ? texto(l.area) : "") : l.valor}
                              onKeyDown={(e) => (comOS ? enterNaAreaOS(e, l.k) : enterNaAreaLivre(e, l.k))}
                              onChange={(e) => digitarAreaTalhao(l.k, e.target.value)}
                              inputMode="decimal"
                              className={`w-full rounded border px-2 py-1 text-right tabular ${passaTalhao ? "border-alert-500 bg-alert-50" : passaSaldo ? "border-amber-500 bg-amber-50" : rateio ? "border-line bg-surface" : "border-line bg-card"}`}
                              aria-label={`Área realizada no talhão ${l.tlh}`}
                              title={passaTalhao ? "Passa da área do talhão" : passaSaldo ? "Passa do saldo da O.S. neste talhão" : rateio ? "Rateado da área do dia; digite para ajustar" : undefined}
                            />
                          </td>
                          {!comOS && (
                            <td className="px-1 py-0.5 text-center">
                              <button
                                type="button"
                                onClick={() => upd({ livres: form.livres.length > 1 ? form.livres.filter((x) => x.key !== l.k) : linhasIniciais() })}
                                tabIndex={-1}
                                className="rounded px-1.5 text-[15px] leading-none text-muted hover:bg-alert-50 hover:text-alert-700"
                                aria-label="Remover linha"
                                title="Remover linha"
                              >
                                ×
                              </button>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                    <tr className="border-t border-line bg-surface font-semibold">
                      <td className="px-3 py-1.5" colSpan={rateio ? 4 : 3}>
                        Total
                      </td>
                      <td className="px-3 py-1.5 text-right tabular">{nf(linhas.reduce((a, l) => a + (l.areaTlh ?? 0), 0))}</td>
                      {comOS && (
                        <>
                          <td className="px-3 py-1.5 text-right tabular">{nf(linhas.reduce((a, l) => a + (l.areaRec ?? 0), 0))}</td>
                          <td className="px-3 py-1.5 text-right tabular">{nf(linhas.reduce((a, l) => a + l.ja, 0))}</td>
                          <td className="px-3 py-1.5 text-right tabular">{nf(linhas.reduce((a, l) => a + (l.saldo ?? 0), 0))}</td>
                        </>
                      )}
                      <td className="px-3 py-1.5 text-right tabular">{nf(totalDia)}</td>
                      {!comOS && <td />}
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
            {!comOS && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  value={incluirFaz}
                  onChange={(e) => setIncluirFaz(e.target.value.replace(/[^\d-]/g, ""))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      incluirTalhoesDaFazenda();
                    }
                  }}
                  inputMode="numeric"
                  placeholder="Fazenda"
                  className="w-[110px] rounded-md border border-line bg-card px-2.5 py-1.5 text-[12.5px] text-ink"
                  aria-label="Fazenda para incluir todos os talhões"
                />
                <button type="button" className={BOTAO} onClick={incluirTalhoesDaFazenda} disabled={!incluirFaz.trim()}>
                  Incluir todos os talhões da fazenda
                </button>
              </div>
            )}
            <p className="mt-2 text-[11.5px] text-muted">
              {comOS
                ? "Saldo = área recomendada na O.S. (ou a do talhão) menos o que já foi apontado. Área acima do saldo fica destacada, mas pode ser gravada; acima da área do talhão, não."
                : `Uma linha por talhão; pode haver mais de uma fazenda no mesmo apontamento${regras.talhao ? "" : " e a área pode ser lançada só com a fazenda, sem talhão"}. Enter na área passa para a linha de baixo já com a fazenda de cima; ${regras.talhao ? "talhão" : "área"} em branco + Enter termina e vai para Lançar. A fazenda tem de estar no Cadastro de Fazenda; os talhões sugeridos vêm do histórico de safras (ou das ordens de corte).`}
              {" Digitando a área realizada no dia, ela é rateada entre os talhões marcados, proporcional à área de cada um."}
            </p>

            <div className="mt-4 flex flex-wrap justify-end gap-2">
              {(form.id || form.os || form.livres.some((l) => l.faz || l.tlh)) && (
                <button type="button" onClick={limpar} className={BOTAO}>
                  {form.id ? "Cancelar edição" : "Limpar"}
                </button>
              )}
              <button ref={gravarRef} type="button" onClick={salvar} disabled={!podeSalvar} className="rounded-lg bg-navy-900 px-5 py-2 text-[13px] font-medium text-white hover:bg-navy-800 disabled:opacity-40">
                {salvando ? "Salvando…" : form.id ? "Salvar alteração (F2)" : "Lançar apontamento (F2)"}
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
            <BotaoLimparFiltros ativo={algumFiltroAtivo} onLimpar={limparFiltros} />
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
                            {a.eqp && `Equipamento ${a.eqp} · `}
                            {a.vazaoRec !== null && `Vazão recomendada ${nf(a.vazaoRec)} L/ha · `}
                            {a.volCalda !== null && `Calda ${nf(a.volCalda)} L · `}
                            {a.vazaoUti !== null && `Vazão utilizada ${nf(a.vazaoUti)} L/ha${a.vazaoAuto ? " (calculada)" : ""} · `}
                            {a.modoArea === "rateio" && `Área de ${nf(a.volume ?? a.areaTotal)} ha rateada · `}
                            {a.insumos.length > 0 && `Insumos: ${a.insumos.map((i) => `${i.cod} ${i.ds}${i.qtd !== null ? ` ${nf(i.qtd)} ${i.um}` : ""}`).join(", ")} · `}
                            {a.talhoes.map((t) => `Fazenda ${t.propCod} talhão ${t.tlh}: ${nf(t.area)} ha`).join(" · ")}
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

      {verificar && (
        <VerificarOSModal
          de={de}
          ate={ate}
          onFechar={(mudou) => {
            setVerificar(false);
            if (mudou) carregarLista();
          }}
        />
      )}
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

/** Apontamentos sem O.S. do período: procura a O.S. aberta da mesma operação e talhões, com campo para corrigir. */
function VerificarOSModal({ de, ate, onFechar }: { de: string; ate: string; onFechar: (mudou: boolean) => void }) {
  const [itens, setItens] = useState<VerificacaoSemOS[] | null>(null);
  const [os, setOs] = useState<Record<number, string>>({});
  const [feitos, setFeitos] = useState<Record<number, string>>({});
  const [erros, setErros] = useState<Record<number, string>>({});
  const [ocupado, setOcupado] = useState<number | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/atividades/apontamentos?verificar=1&de=${de}&ate=${ate}`, { cache: "no-store" })
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (!ok) return setErro(j.error ?? "Não foi possível verificar.");
        const lista = j.semOS as VerificacaoSemOS[];
        setItens(lista);
        setOs(Object.fromEntries(lista.map((x) => [x.id, x.candidatos[0]?.os ?? ""])));
      })
      .catch(() => setErro("Não foi possível verificar."));
  }, [de, ate]);

  async function vincular(id: number) {
    const numero = (os[id] ?? "").trim();
    if (!numero) return;
    setOcupado(id);
    setErros((e) => ({ ...e, [id]: "" }));
    try {
      const res = await fetch("/api/atividades/apontamentos", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, os: numero }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "Não foi possível corrigir.");
      setFeitos((f) => ({ ...f, [id]: j.foraDaOS?.length ? `Ligado à O.S. ${numero} (talhões fora da O.S.: ${j.foraDaOS.join(", ")})` : `Ligado à O.S. ${numero}` }));
    } catch (e) {
      setErros((x) => ({ ...x, [id]: e instanceof Error ? e.message : "Não foi possível corrigir." }));
    } finally {
      setOcupado(null);
    }
  }

  const mudou = Object.keys(feitos).length > 0;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[90vh] w-full max-w-5xl flex-col rounded-xl2 bg-card p-5 shadow-pop">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold text-ink">Verificar O.S. dos apontamentos sem O.S.</h2>
          <button type="button" onClick={() => onFechar(mudou)} aria-label="Fechar" className="px-1 text-[20px] leading-none text-muted">
            ×
          </button>
        </div>
        <p className="mb-3 text-[12.5px] text-muted">
          Período de {fmtDateBR(de)} a {fmtDateBR(ate)} (o da lista de lançados). Para cada apontamento sem O.S., procura uma O.S. aberta com a mesma operação e os
          mesmos talhões. Confira o número, corrija se precisar e clique em Ligar.
        </p>
        {erro && <p className="rounded-md border border-alert-500/40 bg-alert-50 px-3 py-2 text-[12.5px] text-alert-700">{erro}</p>}
        {!itens && !erro && <p className="text-[12.5px] text-muted">Verificando…</p>}
        {itens && itens.length === 0 && <p className="rounded-md border border-line bg-surface px-3 py-3 text-[12.5px] text-muted">Nenhum apontamento sem O.S. no período.</p>}
        {itens && itens.length > 0 && (
          <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-line">
            <table className="w-full text-[12.5px]">
              <thead className="sticky top-0 bg-surface">
                <tr className="border-b border-line text-left text-muted">
                  <th className="px-3 py-1.5 font-medium">Boletim</th>
                  <th className="px-3 py-1.5 font-medium">Data</th>
                  <th className="px-3 py-1.5 font-medium">Fazenda</th>
                  <th className="px-3 py-1.5 font-medium">Operação</th>
                  <th className="px-3 py-1.5 text-right font-medium">Área (ha)</th>
                  <th className="px-3 py-1.5 font-medium">O.S. encontrada</th>
                  <th className="w-[200px] px-3 py-1.5 font-medium">Correção</th>
                </tr>
              </thead>
              <tbody>
                {itens.map((x) => {
                  const melhor = x.candidatos[0];
                  return (
                    <tr key={x.id} className="border-t border-line/60 align-top">
                      <td className="px-3 py-1.5 tabular font-medium text-ink">{x.boletim ?? `#${x.id}`}</td>
                      <td className="px-3 py-1.5 tabular">{fmtDateBR(x.dt)}</td>
                      <td className="max-w-[200px] px-3 py-1.5">{x.fazendas.join(" / ")}</td>
                      <td className="max-w-[220px] px-3 py-1.5">
                        {x.opCod} · {x.opDs}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular">{nf(x.area)}</td>
                      <td className="px-3 py-1.5">
                        {melhor ? (
                          <div>
                            <span className="font-medium text-ink">O.S. {melhor.os}</span>{" "}
                            <span className="text-muted">
                              · {melhor.talhoes} de {x.nTalhoes} talhão(ões) · {melhor.situacao}
                            </span>
                            {x.candidatos.length > 1 && (
                              <div className="text-[11.5px] text-muted">Outras: {x.candidatos.slice(1).map((c) => `${c.os} (${c.talhoes})`).join(", ")}</div>
                            )}
                          </div>
                        ) : (
                          <span className="text-amber-700">Realizado sem Ordem de Serviço</span>
                        )}
                      </td>
                      <td className="px-3 py-1.5">
                        {feitos[x.id] ? (
                          <span className="text-good-700">{feitos[x.id]}</span>
                        ) : (
                          <div className="flex gap-1.5">
                            <input
                              value={os[x.id] ?? ""}
                              onChange={(e) => setOs((o) => ({ ...o, [x.id]: e.target.value.replace(/\D/g, "") }))}
                              onKeyDown={(e) => e.key === "Enter" && vincular(x.id)}
                              placeholder="Nº da O.S."
                              inputMode="numeric"
                              className="w-[100px] rounded-md border border-line bg-card px-2 py-1 text-right tabular"
                              aria-label={`O.S. do boletim ${x.boletim ?? x.id}`}
                            />
                            <button type="button" className={BOTAO} disabled={!os[x.id] || ocupado === x.id} onClick={() => vincular(x.id)}>
                              {ocupado === x.id ? "…" : "Ligar"}
                            </button>
                          </div>
                        )}
                        {erros[x.id] && <div className="mt-1 text-[11.5px] text-alert-700">{erros[x.id]}</div>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="mt-4 flex justify-end">
          <button type="button" className={BOTAO} onClick={() => onFechar(mudou)}>
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
