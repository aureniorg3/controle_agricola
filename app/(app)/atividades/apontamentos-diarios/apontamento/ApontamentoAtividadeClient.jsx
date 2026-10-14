"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import BotaoLimparFiltros from "@/components/BotaoLimparFiltros";
import { IconAlerta, IconBusca, IconMais } from "@/components/icons";
import { CabecalhoPagina, Comando, CorpoPagina, Indicador, Pagina, Painel } from "@/components/pagina";
import { camposFaltando, chaveTalhao, ratearArea, REGRAS_PADRAO, round2 } from "@/lib/atividades";

import { fmtDateBR, todayISO } from "@/lib/format";
import { normTlh } from "@/lib/ocupacao";
import { addDays } from "@/lib/period";

import { podeEditar } from "@/lib/permissoes";

const INPUT = "w-full rounded-md border border-line bg-card px-2.5 py-1.5 text-[13px] text-ink disabled:opacity-60";
const ROTULO = "mb-1 block truncate text-[11.5px] font-medium text-muted";
const BOTAO = "rounded-lg border border-line bg-card px-3 py-1.5 text-[12.5px] font-medium text-navy-800 hover:bg-surface disabled:opacity-50";
const CELULA = "w-full rounded border border-line bg-card px-2 py-1 text-[12.5px] text-ink";

const nf = (n, c = 2) => n.toLocaleString("pt-BR", { minimumFractionDigits: c, maximumFractionDigits: c });
function numero(v) {
  const t = v.trim();
  if (!t) return 0;
  return t.includes(",") ? Number(t.replace(/\./g, "").replace(",", ".")) : Number(t);
}
const texto = (n) => (n ? String(round2(n)).replace(".", ",") : "");
const corStatus = (s) => (/encerr/i.test(s) ? "bg-surface text-muted" : /liber/i.test(s) ? "bg-brand-50 text-brand-700" : "bg-good-50 text-good-600");

let seqLinha = 0;
const novaChave = () => `l${++seqLinha}`;

/** o talhão digitado na lista da fazenda (base Fazenda e Talhões): "01" = "1" */
const talhaoDaFazenda = (f, tlh) => (f && String(tlh ?? "").trim() ? f.talhoes.find((t) => normTlh(t.tlh) === normTlh(tlh)) : undefined);

/** Linha da tabela de talhões quando não há O.S. (fazenda e talhão digitados). */
const linhaVazia = (faz = "", fazNm = "") => ({ key: novaChave(), faz, fazNm, tlh: "", areaTlh: null, valor: "", marcado: true });

/** a tabela começa com 8 linhas; Enter na área da última abre outra */
const LINHAS_INICIAIS = 8;
const linhasIniciais = () => Array.from({ length: LINHAS_INICIAIS }, () => linhaVazia());

const formVazio = () => ({
  boletim: "",
  dt: todayISO(),
  os: "",
  opCod: "",
  opDs: "",
  solicitante: "",
  etapaCod: "",
  tipoAplicacao: "",
  numEquipamentos: "",
  numPessoas: "",
  obs: "",
  eqp: "",
  vazaoRec: "",
  vazaoUti: "",
  volCalda: "",
  modoArea: "talhao",
  volume: "",
  areas: {},
  marcados: {},
  livres: linhasIniciais(),
});

/** Linha calculada para a tabela (com ou sem O.S.). */
export default function ApontamentoAtividadeClient({ perfil, nomeUsuario }) {
  const podeGravar = podeEditar(perfil);
  const [form, setForm] = useState(formVazio);
  const [osInfo, setOsInfo] = useState(null);
  const [buscandoOS, setBuscandoOS] = useState(false);
  const [erroOS, setErroOS] = useState(null);
  /** fazendas consultadas no Cadastro de Fazenda: código → descrição e talhões (null = não cadastrada) */
  const [fazendas, setFazendas] = useState({});
  const [incluirFaz, setIncluirFaz] = useState("");
  const [opcoes, setOpcoes] = useState(null);

  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState(null);
  const [base, setBase] = useState(null);
  const osRef = useRef(null);
  /** O.S. carregada no boletim aberto para edição (redigitar a mesma O.S. não mexe nos talhões de baixo) */
  const osDoBoletim = useRef("");
  /** como o boletim foi aberto (O.S., áreas e marcações), para voltar a ele depois de trocar a O.S. por engano */
  const boletimAberto = useRef(null);
  /** último nº de boletim procurado pelo campo do topo (a saída do campo logo depois do Enter não procura de novo) */
  const boletimProcurado = useRef("");
  /** só vale a resposta da última busca de boletim pelo número (fechar ou abrir outro descarta a anterior) */
  const seqBoletim = useRef(0);
  const formRef = useRef(null);
  const gravarRef = useRef(null);
  const [verificar, setVerificar] = useState(false);
  /** texto do campo Operação enquanto se digita (null = mostra "código · descrição") */
  const [opDigitado, setOpDigitado] = useState(null);

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
  const [lista, setLista] = useState([]);
  const [carregando, setCarregando] = useState(true);
  // janelas: formulário (novo/edição), detalhe de um apontamento e confirmação (excluir, descartar)
  const [formAberto, setFormAberto] = useState(false);
  const [detalhe, setDetalhe] = useState(null);
  const [confirmar, setConfirmar] = useState(null);
  /** atalho da lista: todos | conferir (do WhatsApp, a conferir) | whatsapp | semOS */
  const [rapido, setRapido] = useState("todos");

  const upd = (p) => setForm((f) => ({ ...f, ...p }));
  // campos obrigatórios (Parâmetros › Apontamento Diário): marcados com * na tela
  const regras = opcoes?.regras ?? REGRAS_PADRAO;
  const rot = (campo, texto) => (regras[campo] ? `${texto} *` : texto);
  const op = osInfo?.operacoes.find((o) => o.cod === form.opCod) ?? null;
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
  async function buscarOS(os, manter, excluirId) {
    const c = os.trim();
    seqOS.current++;
    setErroOS(null);
    if (!c) {
      setOsInfo(null);
      return;
    }
    setBuscandoOS(true);
    try {
      const p = new URLSearchParams({ os: c, dt: manter?.dt || form.dt });
      if (excluirId) p.set("excluir", String(excluirId));
      const res = await fetch(`/api/atividades/os?${p}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "O.S. não encontrada.");
      const info = json;
      setOsInfo(info);
      if (excluirId) osDoBoletim.current = info.os;
      const primeira =
        manter?.opCod && info.operacoes.some((o) => o.cod === manter.opCod) ? info.operacoes.find((o) => o.cod === manter.opCod) : info.operacoes[0];
      setForm((f) => ({
        ...f,
        os: info.os,
        opCod: primeira?.cod ?? "",
        opDs: primeira?.ds ?? "",
        etapaCod: manter?.etapaCod ?? primeira?.etapaCod ?? "",
        tipoAplicacao: manter?.tipoAplicacao ?? (primeira?.tipoDs || primeira?.tipoCod || f.tipoAplicacao),
        solicitante: manter?.solicitante ?? (f.solicitante || info.resp),
        areas: manter?.areas ?? {},
        // na edição de um rateio, só os talhões do apontamento ficam marcados; redigitando a mesma O.S., as marcações
        // ficam como estão (vazio = todos marcados)
        marcados: manter?.manterMarcados
          ? (manter.marcados ?? {})
          : manter?.marcados && Object.keys(manter.marcados).length > 0
            ? Object.fromEntries((primeira?.talhoes ?? []).map((t) => [chaveTalhao(t.propCod, t.tlh), !!manter.marcados[chaveTalhao(t.propCod, t.tlh)]]))
            : {},
      }));
    } catch (e) {
      setOsInfo(null);
      setErroOS(e instanceof Error ? e.message : "O.S. não encontrada.");
    } finally {
      setBuscandoOS(false);
    }
  }

  /**
   * A fazenda no Cadastro de Fazenda, com os talhões e a área de cada um na base Fazenda e Talhões da safra da data
   * `dt`. null = fora do cadastro; undefined = não deu para consultar (rede).
   */
  async function buscarFazenda(c, dt) {
    try {
      const r1 = await fetch(`/api/rodadas/apontamento?cad=fazendas&cod=${encodeURIComponent(c)}`, { cache: "no-store" });
      const j1 = await r1.json();
      if (!r1.ok || !j1.item) return null;
      const p = new URLSearchParams({ talhoes_faz: j1.item.cod });
      if (dt) p.set("dt", dt);
      const r2 = await fetch(`/api/rodadas/apontamento?${p}`, { cache: "no-store" });
      const j2 = await r2.json();
      // a data fica junto: a área dos talhões é a da safra dessa data
      return { nm: String(j1.item.nm), talhoes: r2.ok ? (j2.talhoes ?? []) : [], dt };
    } catch {
      return undefined;
    }
  }

  /** Consulta a fazenda (com os talhões da safra da data do apontamento) e guarda para as linhas da tabela. */
  async function consultarFazenda(cod) {
    const c = cod.trim();
    const guardada = fazendas[c];
    // fora do cadastro vale para qualquer data; os talhões, só para a data em que foram consultados
    if (!c || guardada === null || (guardada && guardada.dt === form.dt)) return guardada ?? null;
    const f = await buscarFazenda(c, form.dt);
    if (f === undefined) return null;
    setFazendas((m) => ({ ...m, [c]: f }));
    return f;
  }

  // consultas que demoram: só vale a resposta da última (troca de data, outra O.S., edição)
  const seqAreas = useRef(0);
  const seqOS = useRef(0);

  /** Sem O.S.: consulta de novo as fazendas da tabela na safra da data `dt` e refaz a área do talhão de cada linha. */
  async function atualizarAreasDasLinhas(dt, livres) {
    const seq = ++seqAreas.current;
    const codigos = Array.from(new Set(livres.map((l) => l.faz.trim()).filter(Boolean)));
    const novas = {};
    for (const c of codigos) {
      const f = await buscarFazenda(c, dt);
      if (f !== undefined) novas[c] = f;
    }
    if (seq !== seqAreas.current) return;
    // as fazendas consultadas em outra data saem do que está guardado; as consultadas nesta data durante a espera ficam
    setFazendas((m) => ({ ...Object.fromEntries(Object.entries(m).filter(([, f]) => f === null || f?.dt === dt)), ...novas }));
    setForm((x) =>
      x.dt !== dt
        ? x
        : {
            ...x,
            livres: x.livres.map((l) => {
              const f = novas[l.faz.trim()];
              return f ? { ...l, fazNm: f.nm, areaTlh: talhaoDaFazenda(f, l.tlh)?.area ?? null } : l;
            }),
          },
    );
  }

  /** Com O.S.: as áreas dos talhões da O.S. na safra da data `dt` (o que já foi digitado fica como está). */
  async function atualizarAreasDaOS(dt, os, id) {
    const seq = ++seqOS.current;
    try {
      const p = new URLSearchParams({ os, dt });
      if (id) p.set("excluir", String(id));
      const res = await fetch(`/api/atividades/os?${p}`, { cache: "no-store" });
      if (!res.ok) return;
      const info = await res.json();
      // resposta atrasada (outra data, outra O.S., limpar ou editar vieram depois) não vale
      if (seq !== seqOS.current) return;
      setOsInfo((atual) => (atual && atual.os === info.os ? info : atual));
    } catch {
      /* fica a área da data anterior até a próxima consulta */
    }
  }

  // trocou a data: a área dos talhões passa a ser a da safra da nova data (a edição já consulta com a data do apontamento)
  const dtAnterior = useRef(null);
  const pularTrocaDeData = useRef(false);
  useEffect(() => {
    const anterior = dtAnterior.current;
    dtAnterior.current = form.dt;
    if (anterior === null || anterior === form.dt) return;
    if (pularTrocaDeData.current) {
      pularTrocaDeData.current = false;
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.dt)) return;
    if (osInfo && form.os) atualizarAreasDaOS(form.dt, form.os, form.id);
    else atualizarAreasDasLinhas(form.dt, form.livres);
    // só a data dispara a troca
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.dt]);

  const updLivre = (key, p) => setForm((f) => ({ ...f, livres: f.livres.map((l) => (l.key === key ? { ...l, ...p } : l)) }));

  async function sairDaFazenda(l) {
    const f = await consultarFazenda(l.faz);
    // o talhão pode ter sido digitado enquanto a fazenda era consultada: vale o que está na linha agora
    setForm((x) => ({
      ...x,
      livres: x.livres.map((y) =>
        y.key === l.key && y.faz.trim() === l.faz.trim() ? { ...y, fazNm: f?.nm ?? "", areaTlh: talhaoDaFazenda(f, y.tlh)?.area ?? null } : y,
      ),
    }));
  }

  function trocarTalhao(l, tlh) {
    const f = fazendas[l.faz.trim()];
    updLivre(l.key, { tlh, areaTlh: talhaoDaFazenda(f, tlh)?.area ?? null });
  }

  /** Fim do formulário: foca o botão de gravar (Enter grava); se ainda falta algo, tenta gravar para mostrar o que falta. */
  function irParaGravar() {
    if (gravarRef.current && !gravarRef.current.disabled) gravarRef.current.focus();
    else salvar();
  }

  /** Próximo campo de lançamento (ordem da tela); no fim, o botão de gravar. */
  function focarProximo(atual) {
    const campos = Array.from(formRef.current?.querySelectorAll("[data-nav]") ?? []).filter((el) => !el.disabled && el.offsetParent !== null);
    const i = campos.indexOf(atual);
    const prox = i >= 0 ? campos[i + 1] : undefined;
    if (prox) {
      prox.focus();
      if (prox instanceof HTMLInputElement) prox.select();
    } else irParaGravar();
  }

  /** Enter muda de caixa (os campos da tabela têm regra própria). */
  function aoTeclarNoForm(e) {
    const alvo = e.target;
    if (e.key !== "Enter" || !alvo.hasAttribute("data-nav") || e.defaultPrevented) return;
    e.preventDefault();
    focarProximo(alvo);
  }

  /** Foca já se o campo existe (para não perder o que for digitado em seguida); linha recém-criada, depois de desenhar. */
  function focarCampo(seletor) {
    const focar = () => {
      const el = formRef.current?.querySelector(seletor);
      el?.focus();
      el?.select();
      return !!el;
    };
    if (!focar()) setTimeout(focar, 0);
  }

  /** Sem O.S.: Enter na área vai para a linha de baixo, já com a fazenda de cima (abre linha nova no fim). */
  function enterNaAreaLivre(e, key) {
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
  function enterNoTalhao(e, l) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    // talhão em branco: termina (talhão obrigatório ou linha vazia) ou segue para a área (fazenda sem talhão)
    if (!l.tlh.trim() && (regras.talhao || !l.faz.trim())) irParaGravar();
    else focarCampo(`[data-area="${l.key}"]`);
  }

  /** Com O.S.: Enter na área vai para a área do talhão de baixo; no último, para o botão de gravar. */
  function enterNaAreaOS(e, k) {
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
    if (f.talhoes.length === 0)
      return setMsg({
        texto: `A fazenda ${c} não tem talhões na base Fazenda e Talhões (nem no histórico de safras ou nas ordens de corte); inclua as linhas à mão.`,
        erro: true,
      });
    setForm((x) => {
      const ja = new Set(x.livres.filter((l) => l.faz.trim() === c).map((l) => normTlh(l.tlh)));
      const vazias = x.livres.filter((l) => l.faz.trim() || l.tlh.trim() || l.valor.trim());
      // talhões de ocupação (carreador, APP, pátio…) entram desmarcados: não recebem parte da área rateada sem marcar
      const novas = f.talhoes
        .filter((t) => !ja.has(normTlh(t.tlh)))
        .map((t) => ({ ...linhaVazia(c, f.nm), tlh: t.tlh, areaTlh: t.area, marcado: t.producao !== false }));
      const todas = [...vazias, ...novas];
      // sempre sobra linha em branco para continuar lançando
      const sobra = Math.max(1, LINHAS_INICIAIS - todas.length);
      return { ...x, livres: [...todas, ...Array.from({ length: sobra }, () => linhaVazia())] };
    });
    setIncluirFaz("");
  }

  function trocarOperacao(cod) {
    const o = osInfo?.operacoes.find((x) => x.cod === cod);
    upd({ opCod: cod, opDs: o?.ds ?? "", etapaCod: o?.etapaCod ?? "", tipoAplicacao: o?.tipoDs || o?.tipoCod || form.tipoAplicacao, areas: {}, marcados: {} });
  }

  /**
   * Sem O.S.: o campo de operação aceita "código · descrição" da lista ou o código digitado; a descrição vem do cadastro
   * Operações (o código vale com ou sem zeros à esquerda). O texto digitado fica como está até sair do campo.
   */
  function escolherOperacao(v) {
    setOpDigitado(v);
    const cod = v.split("·")[0].trim();
    const norm = (c) => c.trim().replace(/^0+(?=\d)/, "");
    const o = cod ? opcoes?.operacoes.find((x) => norm(x.cod) === norm(cod)) : undefined;
    upd({ opCod: o?.cod ?? cod, opDs: o?.ds ?? "", etapaCod: form.etapaCod || o?.etapaCod || "" });
  }

  const linhas = useMemo(() => {
    let base = [];
    if (comOS) {
      if (!op) return [];
      const feitos = osInfo?.realizado[op.cod] ?? {};
      base = op.talhoes.map((t) => {
        const k = chaveTalhao(t.propCod, t.tlh);
        const ja = feitos[k] ?? 0;
        const ref = t.areaRec ?? t.areaTlh ?? 0;
        return {
          k,
          propCod: t.propCod,
          propNm: t.propNm,
          tlh: t.tlh,
          areaTlh: t.areaTlh,
          areaRec: t.areaRec,
          naBase: t.naBase !== false,
          ja,
          saldo: Math.max(0, round2(ref - ja)),
          valor: form.areas[k] ?? "",
          marcado: form.marcados[k] !== false,
          area: 0,
        };
      });
    } else {
      base = form.livres.map((l) => ({
        k: l.key,
        propCod: l.faz.trim(),
        propNm: l.fazNm,
        tlh: l.tlh.trim(),
        areaTlh: l.areaTlh,
        areaRec: null,
        naBase: true,
        ja: 0,
        saldo: null,
        valor: l.valor,
        marcado: l.marcado,
        area: 0,
      }));
    }
    if (form.modoArea === "rateio") {
      const marc = base.filter((l) => l.marcado && (comOS || (l.propCod && (l.tlh || !regras.talhao))));
      const rat = ratearArea(
        numero(form.volume) || 0,
        marc.map((l) => l.areaRec ?? l.areaTlh),
      );
      marc.forEach((l, i) => (l.area = rat[i]));
    } else base.forEach((l) => (l.area = numero(l.valor) || 0));
    return base;
  }, [comOS, op, osInfo, form.areas, form.marcados, form.livres, form.modoArea, form.volume, regras.talhao]);
  const totalDia = round2(linhas.reduce((a, l) => a + l.area, 0));
  const fazendasOS = Array.from(new Set(linhas.map((l) => `${l.propCod} · ${l.propNm}`)));
  const rateio = form.modoArea === "rateio";

  /** Digitou a área do dia: ela é rateada entre os talhões marcados (vazio volta para a área por talhão). */
  function digitarAreaDia(v) {
    if (!v.trim()) return upd({ modoArea: "talhao", volume: "", areas: {}, livres: form.livres.map((l) => ({ ...l, valor: "" })) });
    upd({ modoArea: "rateio", volume: v });
  }

  /** Digitou num talhão: passa para a área por talhão, mantendo o que o rateio tinha distribuído nos outros. */
  function digitarAreaTalhao(k, v) {
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
    setOpDigitado(null);
    osDoBoletim.current = "";
    boletimAberto.current = null;
    boletimProcurado.current = "";
    seqBoletim.current++;
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
      !form.vazaoUti.trim() && vazaoCalculada !== null,
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
      const acima = Array.isArray(json.acimaDoTalhao) && json.acimaDoTalhao.length > 0
        ? ` Área acima da do talhão na base Fazenda e Talhões em ${json.acimaDoTalhao.join("; ")} — confira quando a base for atualizada.`
        : "";
      setMsg({ texto: (form.id ? `Boletim nº ${form.boletim} alterado.` : `Boletim nº ${form.boletim} lançado: ${nf(totalDia)} ha ${onde}.`) + acima, erro: false });
      const dtLancada = form.dt;
      if (form.id) setFormAberto(false);
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

  function editar(a) {
    setOpDigitado(null);
    setMsg(null);
    osDoBoletim.current = a.os ?? "";
    boletimProcurado.current = a.boletim ? String(a.boletim) : "";
    seqBoletim.current++;
    const semOS = !a.os;
    const areas = Object.fromEntries(a.talhoes.map((t) => [chaveTalhao(t.propCod, t.tlh), texto(t.area)]));
    const marcados = Object.fromEntries(a.talhoes.map((t) => [chaveTalhao(t.propCod, t.tlh), true]));
    const novo = {
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
            ...a.talhoes.map((t) => ({
              key: novaChave(),
              faz: t.propCod,
              fazNm: t.propNm,
              tlh: t.tlh,
              areaTlh: t.areaTlh,
              valor: texto(t.area),
              marcado: true,
            })),
            linhaVazia(a.talhoes[a.talhoes.length - 1]?.propCod ?? "", a.talhoes[a.talhoes.length - 1]?.propNm ?? ""),
          ]
        : linhasIniciais(),
    };
    boletimAberto.current = { os: a.os ?? "", areas, marcados, modoArea: novo.modoArea, volume: novo.volume };
    // a troca de data da edição não refaz as áreas de novo (a consulta abaixo já usa a data do apontamento)
    if (novo.dt !== form.dt) pularTrocaDeData.current = true;
    setForm(novo);
    setOsInfo(null);
    setErroOS(null);
    if (semOS) atualizarAreasDasLinhas(novo.dt, novo.livres);
    else buscarOS(a.os, novo, a.id);
    setDetalhe(null);
    setFormAberto(true);
  }

  /** O formulário tem algo digitado (que se perde ao abrir outro boletim)? */
  const formTemDados = () =>
    !!(
      form.os ||
      form.opCod ||
      form.solicitante.trim() ||
      form.livres.some((l) => l.faz.trim() || l.valor.trim()) ||
      Object.values(form.areas).some((v) => String(v ?? "").trim())
    );

  /**
   * Nº de boletim digitado no topo: se ele já está lançado, abre o boletim (cabeçalho, O.S., talhões e áreas) para
   * conferir ou editar. Nº que ainda não existe fica como o número do boletim novo. Devolve se abriu.
   */
  async function abrirBoletimPeloNumero(forcar = false) {
    const n = form.boletim.trim();
    if (!n || (!forcar && n === boletimProcurado.current)) return false;
    boletimProcurado.current = n;
    const seq = ++seqBoletim.current;
    try {
      const res = await fetch(`/api/atividades/apontamentos?bol=${encodeURIComponent(n)}`, { cache: "no-store" });
      if (seq !== seqBoletim.current) return false;
      if (!res.ok) {
        // falha de rede ou sessão: a próxima saída do campo tenta de novo
        if (res.status !== 404) boletimProcurado.current = "";
        return false;
      }
      const { apontamento: a } = await res.json();
      if (seq !== seqBoletim.current || !a || a.id === form.id) return false;
      const onde = `${a.os ? `O.S. ${a.os}` : "sem O.S."}, ${fmtDateBR(a.dt)}`;
      if ((form.id || formTemDados()) && !window.confirm(`O boletim nº ${n} já está lançado (${onde}). Abrir para conferir ou editar? O que foi digitado aqui e não foi gravado se perde.`)) {
        return false;
      }
      editar(a);
      setMsg({ texto: `Boletim nº ${n} (${onde}) aberto para edição.`, erro: false });
      return true;
    } catch {
      boletimProcurado.current = "";
      return false;
    }
  }

  /**
   * Busca a O.S. digitada. No boletim já lançado, a mesma O.S. não mexe nos talhões e áreas de baixo nem no cabeçalho
   * (solicitante, etapa, tipo de aplicação, operação); outra O.S. traz os talhões dela, mas o cabeçalho continua o do boletim.
   */
  function buscarOSDoCampo() {
    if (!form.os || osInfo) return;
    if (!form.id) return buscarOS(form.os);
    const semZeros = (s) => String(s ?? "").replace(/^0+(?=\d)/, "");
    // campo do cabeçalho em branco vem da O.S. (solicitante = responsável; etapa e tipo = os da operação); o preenchido fica
    const vazioVemDaOS = (v) => (String(v ?? "").trim() ? v : undefined);
    const cabecalho = {
      dt: form.dt,
      opCod: form.opCod,
      solicitante: vazioVemDaOS(form.solicitante),
      etapaCod: vazioVemDaOS(form.etapaCod),
      tipoAplicacao: vazioVemDaOS(form.tipoAplicacao),
    };
    // a mesma O.S. que está carregada: talhões, áreas e marcações ficam como estão
    if (semZeros(form.os) === semZeros(osDoBoletim.current)) return buscarOS(form.os, { ...form, ...cabecalho, manterMarcados: true }, form.id);
    // de volta à O.S. com que o boletim foi aberto (depois de trocar por engano): voltam as áreas e marcações dele
    const orig = boletimAberto.current;
    if (orig && semZeros(form.os) === semZeros(orig.os)) {
      upd({ modoArea: orig.modoArea, volume: orig.volume });
      return buscarOS(form.os, { ...cabecalho, areas: orig.areas, marcados: orig.marcados }, form.id);
    }
    // outra O.S.: os talhões dela, com o cabeçalho do boletim
    buscarOS(form.os, cabecalho, form.id);
  }

  /** Novo apontamento: formulário limpo na janela. */
  function novo() {
    setMsg(null);
    limpar();
    setFormAberto(true);
  }

  /** Fechar a janela do formulário: com algo digitado, pergunta antes de descartar. */
  function fecharForm() {
    const fechar = () => {
      setFormAberto(false);
      limpar();
    };
    const digitado = form.os || totalDia > 0 || form.livres.some((l) => l.faz || l.tlh);
    if (!digitado) return fechar();
    setConfirmar({
      titulo: form.id ? "Cancelar a edição?" : "Descartar o apontamento?",
      texto: form.id ? "As alterações feitas não serão gravadas." : "O que foi digitado será perdido.",
      botao: "Descartar",
      perigo: true,
      acao: fechar,
    });
  }

  /** Apontamento do WhatsApp conferido: o bot não mexe mais nele. */
  async function conferir(a) {
    const res = await fetch("/api/atividades/apontamentos", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: a.id, conferir: true }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return setMsg({ texto: json.error ?? "Não foi possível marcar como conferido.", erro: true });
    setMsg({ texto: `Boletim nº ${a.boletim ?? a.id} conferido.`, erro: false });
    setDetalhe((d) => (d && d.id === a.id ? { ...d, aConferir: false, atuUsr: nomeUsuario || "você" } : d));
    carregarLista();
  }

  function excluir(a) {
    const onde = a.os ? `O.S. ${a.os}` : "sem O.S.";
    setConfirmar({
      titulo: `Excluir o boletim nº ${a.boletim ?? a.id}?`,
      texto: `${onde} · ${fmtDateBR(a.dt)} · ${nf(a.areaTotal)} ha. A exclusão fica no Log de Alterações.`,
      botao: "Excluir",
      perigo: true,
      acao: () => excluirDeVez(a),
    });
  }

  async function excluirDeVez(a) {
    setDetalhe(null);
    const res = await fetch("/api/atividades/apontamentos", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: a.id }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return setMsg({ texto: json.error ?? "Não foi possível excluir.", erro: true });
    if (form.id === a.id) limpar();
    setMsg({ texto: `Boletim nº ${a.boletim ?? a.id} excluído.`, erro: false });
    carregarLista();
  }

  // F2: com a janela fechada abre um apontamento novo; aberta, grava
  const salvarRef = useRef(salvar);
  salvarRef.current = () => (formAberto ? salvar() : podeGravar && novo());
  // Esc fecha a janela de cima (confirmação, detalhe ou formulário)
  const escRef = useRef(null);
  escRef.current = () => (confirmar ? setConfirmar(null) : detalhe ? setDetalhe(null) : formAberto ? fecharForm() : null);
  useEffect(() => {
    const tecla = (e) => {
      if (e.key === "F2") {
        e.preventDefault();
        salvarRef.current();
      } else if (e.key === "Escape") escRef.current();
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, []);

  // vazão utilizada calculada: volume de calda ÷ área do dia (vale quando o campo fica em branco)
  const vazaoCalculada = numero(form.volCalda) > 0 && totalDia > 0 ? round2(numero(form.volCalda) / totalDia) : null;

  const totalLista = round2(lista.reduce((a, x) => a + x.areaTotal, 0));
  const qtdConferir = lista.filter((a) => a.aConferir).length;
  const qtdSemOS = lista.filter((a) => !a.os).length;
  // atalho escolhido nos cartões / botões acima da lista
  const visiveis =
    rapido === "conferir"
      ? lista.filter((a) => a.aConferir)
      : rapido === "whatsapp"
        ? lista.filter((a) => a.orig === "whatsapp")
        : rapido === "semOS"
          ? lista.filter((a) => !a.os)
          : lista;
  const totalVisiveis = round2(visiveis.reduce((a, x) => a + x.areaTotal, 0));
  const marcadosQtd = linhas.filter((l) => l.marcado && (comOS || (l.propCod && l.tlh))).length;
  const somaPeso = round2(linhas.filter((l) => l.marcado).reduce((a, l) => a + (l.areaRec ?? l.areaTlh ?? 0), 0));
  const podeSalvar = !salvando && !!form.boletim && totalDia > 0 && (!comOS || !!op);

  return (
    <Pagina translate="no">
      <CabecalhoPagina
        titulo="Apontamento"
        categoria="Atividades · Apontamentos Diários"
        info={
          base && (
            <span className="hidden sm:block">
              Base de O.S. (Ordem de Serviço Agr.): {base.ordens} O.S.{base.ultimaImportacao ? ` · atualizada em ${base.ultimaImportacao}` : ""}
            </span>
          )
        }
        comandos={
          <>
            {podeGravar && (
              <Comando primario icone={<IconMais size={16} />} onClick={novo} title="Novo apontamento (F2)">
                Novo apontamento
              </Comando>
            )}
            {podeGravar && (
              <Comando
                icone={<IconBusca size={16} />}
                onClick={() => setVerificar(true)}
                title="Procura O.S. aberta para os apontamentos lançados sem O.S. no período da lista"
              >
                Verificar O.S.
              </Comando>
            )}
          </>
        }
      />

      <CorpoPagina className="space-y-5">
        {msg && !formAberto && <Aviso msg={msg} onFechar={() => setMsg(null)} />}

        {/* Resumo do período da lista: os cartões filtram a lista */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            { k: "todos", rotulo: "Apontamentos no período", valor: lista.length, apoio: `${fmtDateBR(de)} a ${fmtDateBR(ate)}`, cor: "azul" },
            { k: "area", rotulo: "Área apontada", valor: nf(totalLista), unidade: "ha", apoio: "soma dos talhões", cor: "verde" },
            {
              k: "conferir",
              rotulo: "Do WhatsApp a conferir",
              valor: qtdConferir,
              apoio: qtdConferir ? "lançados pelo bot · clique para ver" : "nada pendente",
              cor: qtdConferir ? "laranja" : "cinza",
            },
            {
              k: "semOS",
              rotulo: "Sem O.S.",
              valor: qtdSemOS,
              apoio: qtdSemOS ? "clique para ver · Verificar O.S. procura a O.S." : "todos com O.S.",
              cor: qtdSemOS ? "amarelo" : "cinza",
            },
          ].map((c) => (
            <button
              key={c.k}
              type="button"
              onClick={() => setRapido(c.k === "area" ? "todos" : rapido === c.k ? "todos" : c.k)}
              className={`rounded-xl2 text-left transition hover:-translate-y-px focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-500 ${rapido === c.k && c.k !== "todos" ? "ring-2 ring-navy-500" : ""}`}
              title={c.k === "area" || c.k === "todos" ? "Mostrar todos" : `Mostrar só: ${c.rotulo.toLowerCase()}`}
            >
              <Indicador rotulo={c.rotulo} valor={c.valor} unidade={c.unidade} apoio={c.apoio} cor={c.cor} />
            </button>
          ))}
        </div>

        {podeGravar && formAberto && (
          <div
            className="fixed inset-0 z-40 overflow-y-auto bg-navy-950/50 px-3 py-4 sm:px-6 sm:py-8"
            role="dialog"
            aria-modal="true"
            aria-label={form.id ? "Editar apontamento" : "Novo apontamento"}
            onMouseDown={(e) => e.target === e.currentTarget && fecharForm()}
          >
          <div className="mx-auto max-w-6xl space-y-3">
          {msg && <Aviso msg={msg} onFechar={() => setMsg(null)} />}
          <section className="caixa-form shadow-pop" ref={formRef} onKeyDown={aoTeclarNoForm}>
            <div className="caixa-form-topo">
              <div>
                <div className="caixa-form-titulo">{form.id ? `Editando o boletim nº ${form.boletim || "—"}` : "Novo apontamento"}</div>
                {nomeUsuario && <div className="text-[11.5px] text-muted">{form.id ? "Alterado" : "Lançado"} por {nomeUsuario} · F2 grava · Esc fecha</div>}
              </div>
              <div className="flex items-center gap-2">
                <label className="campo-boletim">
                  Boletim nº
                  <input
                    value={form.boletim}
                    onChange={(e) => upd({ boletim: e.target.value.replace(/\D/g, "").slice(0, 9) })}
                    onBlur={() => abrirBoletimPeloNumero()}
                    onKeyDown={async (e) => {
                      if (e.key !== "Enter") return;
                      e.preventDefault();
                      e.stopPropagation();
                      // boletim já lançado abre para edição; número novo segue para a O.S. (o Enter procura sempre de novo)
                      if (!(await abrirBoletimPeloNumero(true))) osRef.current?.focus();
                    }}
                    inputMode="numeric"
                    aria-label="Número do boletim (digite um já lançado e tecle Enter para abrir)"
                    title="Digite o número de um boletim já lançado e tecle Enter para abrir"
                  />
                </label>
                <button
                  type="button"
                  onClick={fecharForm}
                  className="flex h-8 w-8 items-center justify-center rounded-md text-[20px] leading-none text-muted hover:bg-surface"
                  aria-label="Fechar"
                  title="Fechar (Esc)"
                >
                  ×
                </button>
              </div>
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
                  onBlur={() => buscarOSDoCampo()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      buscarOSDoCampo();
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
                  <span className="pb-2 text-[12px] text-muted">
                    Com O.S., tecle Enter para trazer as operações e os talhões. Sem O.S., informe a fazenda e os talhões na tabela abaixo.
                  </span>
                )}
              </div>
            </div>

            {/* Operação e recursos: cabeçalho compacto */}
            <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-6">
              <div className="col-span-2">
                <label className={ROTULO}>{rot("operacao", "Operação")}</label>
                {comOS ? (
                  <select data-nav value={form.opCod} onChange={(e) => trocarOperacao(e.target.value)} className={INPUT}>
                    {[...(osInfo?.operacoes ?? [])]
                      .sort((a, b) => a.cod.localeCompare(b.cod, undefined, { numeric: true }))
                      .map((o) => (
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
                      value={opDigitado ?? (form.opCod ? `${form.opCod}${form.opDs ? ` · ${form.opDs}` : ""}` : "")}
                      onChange={(e) => escolherOperacao(e.target.value)}
                      onBlur={() => setOpDigitado(null)}
                      placeholder="Código ou escolha da lista"
                      className={INPUT}
                      aria-label="Operação"
                    />
                    {opDigitado !== null && form.opCod && (
                      <div className={`mt-0.5 truncate text-[11px] ${form.opDs ? "text-good-600" : "text-alert-600"}`}>
                        {form.opDs ? form.opDs : "Código não encontrado no cadastro Operações"}
                      </div>
                    )}
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
                <input
                  data-nav
                  list="solicitantes-ap"
                  value={form.solicitante}
                  onChange={(e) => upd({ solicitante: e.target.value })}
                  className={INPUT}
                  maxLength={80}
                />
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
                <input
                  data-nav
                  list="tipos-apl"
                  value={form.tipoAplicacao}
                  onChange={(e) => upd({ tipoAplicacao: e.target.value })}
                  className={INPUT}
                  maxLength={60}
                />
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
                <input
                  data-nav
                  value={form.eqp}
                  onChange={(e) => upd({ eqp: e.target.value.toUpperCase().slice(0, 40) })}
                  placeholder="Código"
                  className={`${INPUT} tabular`}
                  aria-label="Código do equipamento"
                />
              </div>
              <div>
                <label className={ROTULO}>{rot("numEquipamentos", "Nº de equipamentos")}</label>
                <input
                  data-nav
                  value={form.numEquipamentos}
                  onChange={(e) => upd({ numEquipamentos: e.target.value.replace(/\D/g, "") })}
                  inputMode="numeric"
                  className={`${INPUT} text-right tabular`}
                />
              </div>
              <div>
                <label className={ROTULO}>{rot("numPessoas", "Nº de pessoas")}</label>
                <input
                  data-nav
                  value={form.numPessoas}
                  onChange={(e) => upd({ numPessoas: e.target.value.replace(/\D/g, "") })}
                  inputMode="numeric"
                  className={`${INPUT} text-right tabular`}
                />
              </div>
              <div>
                <label className={ROTULO}>{rot("vazaoRec", "Vazão Recom. (L/ha)")}</label>
                <input
                  data-nav
                  value={form.vazaoRec}
                  onChange={(e) => upd({ vazaoRec: e.target.value })}
                  inputMode="decimal"
                  className={`${INPUT} text-right tabular`}
                />
              </div>
              <div>
                <label className={ROTULO}>{rot("volCalda", "Volume de calda (L)")}</label>
                <input
                  data-nav
                  value={form.volCalda}
                  onChange={(e) => upd({ volCalda: e.target.value })}
                  inputMode="decimal"
                  className={`${INPUT} text-right tabular`}
                />
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
                <label className={ROTULO} title="Área realizada no dia">
                  Área realizada (ha)
                </label>
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
                    <button
                      type="button"
                      className={BOTAO}
                      onClick={() => upd({ modoArea: "talhao", volume: "", areas: Object.fromEntries(linhas.map((l) => [l.k, texto(l.saldo)])) })}
                    >
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
              <p className="rounded-lg border border-dashed border-line bg-card/50 px-4 py-5 text-center text-[12.5px] text-muted">
                Escolha a operação da O.S.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-line bg-card">
                <table className="w-full min-w-[720px] text-[12.5px]">
                  <thead>
                    <tr className="border-b border-line bg-surface text-left text-muted">
                      {rateio && <th className="w-9 px-3 py-1.5" />}
                      <th className="w-[120px] px-3 py-1.5 font-medium">Fazenda</th>
                      <th className="px-3 py-1.5 font-medium">Descrição Fazenda</th>
                      <th className="w-[110px] px-3 py-1.5 font-medium">{rot("talhao", "Talhão")}</th>
                      <th
                        className="px-3 py-1.5 text-right font-medium"
                        title={`Área do talhão na base Fazenda e Talhões${osInfo?.safraArea ? ` (safra ${osInfo.safraArea})` : ""} — Planejamento Agrícola`}
                      >
                        Área talhão
                      </th>
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
                      const livre = !comOS ? form.livres.find((x) => x.key === l.k) : null;
                      const cadFaz = livre ? fazendas[livre.faz.trim()] : undefined;
                      const tlhBase = livre ? talhaoDaFazenda(cadFaz, livre.tlh) : undefined;
                      return (
                        <tr key={l.k} className={`border-t border-line/60 ${rateio && !l.marcado ? "text-muted" : ""}`}>
                          {rateio && (
                            <td className="px-3 py-1">
                              <input
                                type="checkbox"
                                checked={l.marcado}
                                onChange={(e) =>
                                  comOS ? upd({ marcados: { ...form.marcados, [l.k]: e.target.checked } }) : updLivre(l.k, { marcado: e.target.checked })
                                }
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
                              <td className="px-3 py-1 text-muted">
                                {cadFaz === null ? <span className="text-amber-700">Não está no Cadastro de Fazenda</span> : livre.fazNm}
                                {tlhBase && tlhBase.producao === false && (
                                  <span className="ml-2 whitespace-nowrap rounded bg-surface px-1.5 py-0.5 text-[11px] text-muted" title="Ocupação do talhão (cadastro Ocupação)">
                                    {tlhBase.tlh} · {tlhBase.ocupacao}
                                  </span>
                                )}
                              </td>
                              <td className="px-2 py-0.5">
                                <input
                                  data-nav
                                  data-tlh={livre.key}
                                  title={cadFaz?.talhoes.length ? `Talhões da fazenda: ${cadFaz.talhoes.map((t) => (t.producao === false ? `${t.tlh} (${t.ocupacao})` : t.tlh)).join(", ")}` : undefined}
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
                          <td className="px-3 py-1 text-right tabular">
                            {l.areaTlh !== null ? nf(l.areaTlh) : "—"}
                            {!l.naBase && (
                              <span className="ml-0.5 text-amber-700" title="Talhão fora da base Fazenda e Talhões: vale a área plantada da O.S.">
                                *
                              </span>
                            )}
                          </td>
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
                              className={`w-full rounded border px-2 py-1 text-right tabular ${passaTalhao || passaSaldo ? "border-amber-500 bg-amber-50" : rateio ? "border-line bg-surface" : "border-line bg-card"}`}
                              aria-label={`Área realizada no talhão ${l.tlh}`}
                              title={
                                passaTalhao
                                  ? "Passa da área do talhão na base Fazenda e Talhões — pode gravar; a base é atualizada e importada depois"
                                  : passaSaldo
                                    ? "Passa do saldo da O.S. neste talhão"
                                    : rateio
                                      ? "Rateado da área do dia; digite para ajustar"
                                      : undefined
                              }
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
                ? "Área do talhão = base Fazenda e Talhões da safra da data (Planejamento Agrícola); * = talhão fora da base, com a área plantada da O.S. Saldo = área recomendada na O.S. (ou a do talhão) menos o que já foi apontado. Área acima do saldo ou da área do talhão fica destacada, mas pode ser gravada (a base é atualizada e importada depois)."
                : `Uma linha por talhão; pode haver mais de uma fazenda no mesmo apontamento${regras.talhao ? "" : " e a área pode ser lançada só com a fazenda, sem talhão"}. Enter na área passa para a linha de baixo já com a fazenda de cima; ${regras.talhao ? "talhão" : "área"} em branco + Enter termina e vai para Lançar. A fazenda tem de estar no Cadastro de Fazenda; os talhões e a área de cada um vêm da base Fazenda e Talhões da safra da data (Planejamento Agrícola).`}
              {" Digitando a área realizada no dia, ela é rateada entre os talhões marcados, proporcional à área de cada um."}
            </p>

            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button type="button" onClick={fecharForm} className={BOTAO}>
                {form.id ? "Cancelar edição" : "Fechar"}
              </button>
              {!form.id && (form.os || form.livres.some((l) => l.faz || l.tlh)) && (
                <button type="button" onClick={limpar} className={BOTAO}>
                  Limpar
                </button>
              )}
              <button
                ref={gravarRef}
                type="button"
                onClick={salvar}
                disabled={!podeSalvar}
                className="rounded-lg bg-navy-900 px-5 py-2 text-[13px] font-medium text-white hover:bg-navy-800 disabled:opacity-40"
              >
                {salvando ? "Salvando…" : form.id ? "Salvar alteração (F2)" : "Lançar apontamento (F2)"}
              </button>
            </div>
          </section>
          </div>
          </div>
        )}

        {/* Lançados */}
        <Painel titulo="Apontamentos lançados">
          <div className="mb-3 flex flex-wrap items-end gap-3">
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
            <div className="ml-auto flex flex-wrap gap-1.5" role="group" aria-label="Mostrar">
              {[
                ["todos", `Todos (${lista.length})`],
                ["conferir", `A conferir (${qtdConferir})`],
                ["whatsapp", `Do WhatsApp (${lista.filter((a) => a.orig === "whatsapp").length})`],
                ["semOS", `Sem O.S. (${qtdSemOS})`],
              ].map(([k, t]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setRapido(k)}
                  aria-pressed={rapido === k}
                  className={`rounded-full border px-3 py-1 text-[12px] font-medium ${rapido === k ? "border-navy-900 bg-navy-900 text-white" : "border-line bg-card text-navy-800 hover:bg-surface"}`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          <p className="mb-2 text-[11.5px] text-muted">Clique numa linha para ver o apontamento inteiro (talhões, calda, mensagem do WhatsApp).</p>
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
                {!carregando && visiveis.length === 0 && (
                  <tr>
                    <td colSpan={14} className="px-3 py-6 text-center text-muted">
                      {lista.length === 0 ? "Nenhum apontamento no período." : "Nenhum apontamento neste atalho."}
                      {lista.length === 0 && podeGravar && (
                        <button type="button" className={`${BOTAO} ml-2`} onClick={novo}>
                          Lançar um apontamento
                        </button>
                      )}
                    </td>
                  </tr>
                )}
                {visiveis.map((a) => {
                  const codigos = Array.from(new Set(a.talhoes.map((t) => t.propCod)));
                  const nomes = Array.from(new Set(a.talhoes.map((t) => t.propNm).filter(Boolean)));
                  return (
                    <Fragment key={a.id}>
                      <tr
                        className={`cursor-pointer border-t border-line/60 hover:bg-surface/70 ${a.aConferir ? "bg-amber-50/40" : ""}`}
                        onClick={() => setDetalhe(a)}
                        title="Ver o apontamento"
                      >
                        <td className="px-3 py-1.5 tabular font-medium text-ink">
                          <span className="flex items-center gap-1.5">
                            {a.boletim ?? "—"}
                            {a.orig === "whatsapp" && <SeloOrigem a={a} />}
                          </span>
                        </td>
                        <td className="px-3 py-1.5 tabular">{fmtDateBR(a.dt)}</td>
                        <td className="px-3 py-1.5 tabular font-medium text-ink">
                          {a.os || <span className="font-normal text-amber-700">Sem O.S.</span>}
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
                        <td
                          className="px-3 py-1.5 text-right tabular font-medium"
                          title={a.modoArea === "rateio" ? "Volume rateado entre os talhões" : undefined}
                        >
                          {nf(a.areaTotal)}
                          {a.modoArea === "rateio" && <span className="ml-1 text-[10.5px] font-normal text-muted">rat.</span>}
                        </td>
                        <td className="px-3 py-1.5 text-[11.5px] text-muted">
                          {a.usr}
                          {a.atuUsr ? <div>alterado por {a.atuUsr}</div> : null}
                        </td>
                        <td className="px-2 py-1 text-right" onClick={(e) => e.stopPropagation()}>
                          {podeGravar && (
                            <span className="flex justify-end gap-1.5">
                              {a.aConferir && (
                                <button type="button" className={`${BOTAO} text-good-600`} onClick={() => conferir(a)} title="Confere e tira da lista do WhatsApp a conferir">
                                  Conferido
                                </button>
                              )}
                              <button type="button" className={BOTAO} onClick={() => editar(a)}>
                                Editar
                              </button>
                              <button
                                type="button"
                                className={`${BOTAO} px-2 text-alert-700`}
                                onClick={() => excluir(a)}
                                aria-label={`Excluir o apontamento ${a.id}`}
                              >
                                ×
                              </button>
                            </span>
                          )}
                        </td>
                      </tr>
                    </Fragment>
                  );
                })}
                {visiveis.length > 0 && (
                  <tr className="border-t border-line bg-surface font-semibold">
                    <td colSpan={11} className="px-3 py-1.5">
                      {visiveis.length} apontamento(s)
                    </td>
                    <td className="px-3 py-1.5 text-right tabular">{nf(totalVisiveis)}</td>
                    <td colSpan={2} />
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Painel>
      </CorpoPagina>

      {detalhe && (
        <DetalheModal
          a={detalhe}
          podeGravar={podeGravar}
          onFechar={() => setDetalhe(null)}
          onEditar={() => editar(detalhe)}
          onExcluir={() => excluir(detalhe)}
          onConferir={() => conferir(detalhe)}
        />
      )}
      {confirmar && (
        <ConfirmarModal
          {...confirmar}
          onCancelar={() => setConfirmar(null)}
          onConfirmar={() => {
            const acao = confirmar.acao;
            setConfirmar(null);
            acao();
          }}
        />
      )}
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
    </Pagina>
  );
}

/** Apontamentos sem O.S. do período: procura a O.S. aberta da mesma operação e talhões, com campo para corrigir. */
function VerificarOSModal({ de, ate, onFechar }) {
  const [itens, setItens] = useState(null);
  const [os, setOs] = useState({});
  const [feitos, setFeitos] = useState({});
  const [erros, setErros] = useState({});
  const [ocupado, setOcupado] = useState(null);
  const [erro, setErro] = useState(null);

  useEffect(() => {
    fetch(`/api/atividades/apontamentos?verificar=1&de=${de}&ate=${ate}`, { cache: "no-store" })
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (!ok) return setErro(j.error ?? "Não foi possível verificar.");
        const lista = j.semOS;
        setItens(lista);
        setOs(Object.fromEntries(lista.map((x) => [x.id, x.candidatos[0]?.os ?? ""])));
      })
      .catch(() => setErro("Não foi possível verificar."));
  }, [de, ate]);

  async function vincular(id) {
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
      setFeitos((f) => ({
        ...f,
        [id]: j.foraDaOS?.length ? `Ligado à O.S. ${numero} (talhões fora da O.S.: ${j.foraDaOS.join(", ")})` : `Ligado à O.S. ${numero}`,
      }));
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
          Período de {fmtDateBR(de)} a {fmtDateBR(ate)} (o da lista de lançados). Para cada apontamento sem O.S., procura uma O.S. aberta com a mesma operação e
          os mesmos talhões. Confira o número, corrija se precisar e clique em Ligar.
        </p>
        {erro && <p className="rounded-md border border-alert-500/40 bg-alert-50 px-3 py-2 text-[12.5px] text-alert-700">{erro}</p>}
        {!itens && !erro && <p className="text-[12.5px] text-muted">Verificando…</p>}
        {itens && itens.length === 0 && (
          <p className="rounded-md border border-line bg-surface px-3 py-3 text-[12.5px] text-muted">Nenhum apontamento sem O.S. no período.</p>
        )}
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
                              <div className="text-[11.5px] text-muted">
                                Outras:{" "}
                                {x.candidatos
                                  .slice(1)
                                  .map((c) => `${c.os} (${c.talhoes})`)
                                  .join(", ")}
                              </div>
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

/** Mensagem de sucesso/erro com botão para fechar. */
function Aviso({ msg, onFechar }) {
  return (
    <div
      role={msg.erro ? "alert" : "status"}
      className={`flex items-start gap-2 rounded-md border px-3 py-2 text-[13px] ${msg.erro ? "border-alert-500/40 bg-alert-50 text-alert-600" : "border-good-500/40 bg-good-50 text-good-600"}`}
    >
      <span className="min-w-0 flex-1">{msg.texto}</span>
      <button type="button" onClick={onFechar} aria-label="Fechar a mensagem" className="px-1 leading-none opacity-70 hover:opacity-100">
        ×
      </button>
    </div>
  );
}

/** Selo da origem WhatsApp na lista: laranja enquanto o apontamento do bot não foi conferido. */
function SeloOrigem({ a }) {
  return a.aConferir ? (
    <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10.5px] font-semibold text-amber-800" title="Lançado pelo bot do WhatsApp; ainda não conferido">
      WhatsApp · a conferir
    </span>
  ) : (
    <span className="rounded-full bg-good-50 px-1.5 py-0.5 text-[10.5px] font-semibold text-good-600" title="Veio do WhatsApp">
      WhatsApp
    </span>
  );
}

/** Janela de confirmação (excluir, descartar o que foi digitado). */
function ConfirmarModal({ titulo, texto, botao = "Confirmar", perigo = false, onConfirmar, onCancelar }) {
  const ok = useRef(null);
  useEffect(() => ok.current?.focus(), []);
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-navy-950/50 px-4" onMouseDown={(e) => e.target === e.currentTarget && onCancelar()}>
      <div role="alertdialog" aria-modal="true" aria-label={titulo} className="w-full max-w-md rounded-xl2 bg-card p-5 shadow-pop">
        <h2 className="text-[15px] font-semibold text-ink">{titulo}</h2>
        {texto && <p className="mt-1.5 text-[13px] text-muted">{texto}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className={BOTAO} onClick={onCancelar}>
            Voltar
          </button>
          <button
            ref={ok}
            type="button"
            onClick={onConfirmar}
            className={`rounded-lg px-4 py-1.5 text-[12.5px] font-medium text-white ${perigo ? "bg-alert-600 hover:bg-alert-500" : "bg-navy-900 hover:bg-navy-800"}`}
          >
            {botao}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Um apontamento inteiro: dados, talhões, insumos, observação e a mensagem do WhatsApp de onde veio. */
function DetalheModal({ a, podeGravar, onFechar, onEditar, onExcluir, onConferir }) {
  const [verMsg, setVerMsg] = useState(a.aConferir);
  const campo = (rotulo, valor) => (
    <div className="min-w-0">
      <div className="text-[11px] font-medium text-muted">{rotulo}</div>
      <div className="truncate text-[13px] text-ink" title={typeof valor === "string" ? valor : undefined}>
        {valor === null || valor === undefined || valor === "" ? "—" : valor}
      </div>
    </div>
  );
  const fazendas = Array.from(new Set(a.talhoes.map((t) => t.propCod)));
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-navy-950/50 px-3 py-6" onMouseDown={(e) => e.target === e.currentTarget && onFechar()}>
      <div role="dialog" aria-modal="true" aria-label={`Boletim ${a.boletim ?? a.id}`} className="w-full max-w-3xl rounded-xl2 bg-card shadow-pop">
        <header className="flex items-start gap-3 border-b border-line px-5 py-3.5">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[16px] font-semibold text-ink">Boletim nº {a.boletim ?? "—"}</h2>
              {a.orig === "whatsapp" && <SeloOrigem a={a} />}
              {!a.os && <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10.5px] font-semibold text-amber-800">Sem O.S.</span>}
            </div>
            <div className="mt-0.5 text-[12.5px] text-muted">
              {fmtDateBR(a.dt)} · {a.os ? `O.S. ${a.os}` : "sem O.S."} · {a.opCod} {a.opDs}
            </div>
          </div>
          <button type="button" onClick={onFechar} aria-label="Fechar" title="Fechar (Esc)" className="flex h-8 w-8 items-center justify-center rounded-md text-[20px] leading-none text-muted hover:bg-surface">
            ×
          </button>
        </header>

        <div className="space-y-4 px-5 py-4">
          {a.aConferir && (
            <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800">
              <IconAlerta size={16} />
              <span>
                Lançado pelo bot a partir da mensagem do WhatsApp. Confira com a mensagem abaixo; ao editar ou marcar como conferido, o bot não altera mais este
                apontamento.
              </span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
            {campo("Área apontada", `${nf(a.areaTotal)} ha${a.modoArea === "rateio" ? " (rateada)" : ""}`)}
            {campo("Fazenda(s)", fazendas.join(", "))}
            {campo("Etapa", a.etapaDs || a.etapaCod)}
            {campo("Tipo de aplicação", a.tipoAplicacao)}
            {campo("Solicitante", a.solicitante)}
            {campo("Equipamento (frota)", a.eqp)}
            {campo("Nº de equipamentos", a.numEquipamentos)}
            {campo("Nº de pessoas", a.numPessoas)}
            {campo("Vazão recomendada", a.vazaoRec !== null ? `${nf(a.vazaoRec)} L/ha` : null)}
            {campo("Calda gasta", a.volCalda !== null ? `${nf(a.volCalda, 0)} L` : null)}
            {campo("Vazão utilizada", a.vazaoUti !== null ? `${nf(a.vazaoUti)} L/ha${a.vazaoAuto ? " (calculada)" : ""}` : null)}
            {campo("Lançado por", `${a.usr}${a.criEm ? ` · ${a.criEm}` : ""}`)}
          </div>

          <div>
            <div className="mb-1.5 text-[12px] font-semibold text-ink">Talhões</div>
            {a.talhoes.length === 0 ? (
              <p className="rounded-md border border-line bg-surface px-3 py-2 text-[12.5px] text-muted">Nenhum talhão com área.</p>
            ) : (
              <div className="overflow-hidden rounded-lg border border-line">
                <table className="w-full text-[12.5px]">
                  <thead className="bg-surface text-left text-muted">
                    <tr>
                      <th className="px-3 py-1.5 font-medium">Fazenda</th>
                      <th className="px-3 py-1.5 font-medium">Talhão</th>
                      <th className="px-3 py-1.5 text-right font-medium">Área do talhão</th>
                      <th className="px-3 py-1.5 text-right font-medium">Área apontada</th>
                    </tr>
                  </thead>
                  <tbody>
                    {a.talhoes.map((t, i) => (
                      <tr key={i} className="border-t border-line/60">
                        <td className="px-3 py-1.5">
                          {t.propCod}
                          {t.propNm && <span className="text-muted"> · {t.propNm}</span>}
                        </td>
                        <td className="px-3 py-1.5 tabular">{t.tlh || <span className="text-muted">sem talhão</span>}</td>
                        <td className="px-3 py-1.5 text-right tabular text-muted">{t.areaTlh !== null ? nf(t.areaTlh) : "—"}</td>
                        <td className="px-3 py-1.5 text-right tabular font-medium">{nf(t.area)}</td>
                      </tr>
                    ))}
                    <tr className="border-t border-line bg-surface font-semibold">
                      <td className="px-3 py-1.5" colSpan={3}>
                        Total
                      </td>
                      <td className="px-3 py-1.5 text-right tabular">{nf(a.areaTotal)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {a.insumos.length > 0 && (
            <div>
              <div className="mb-1.5 text-[12px] font-semibold text-ink">Insumos</div>
              <ul className="space-y-0.5 text-[12.5px]">
                {a.insumos.map((i, k) => (
                  <li key={k}>
                    {i.cod} {i.ds}
                    {i.qtd !== null && <span className="text-muted"> · {nf(i.qtd)} {i.um}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {a.obs && (
            <div>
              <div className="mb-1 text-[12px] font-semibold text-ink">Observação</div>
              <p className="whitespace-pre-wrap text-[12.5px] text-ink">{a.obs}</p>
            </div>
          )}

          {a.origMsg && (
            <div>
              <button type="button" onClick={() => setVerMsg(!verMsg)} className="text-[12px] font-semibold text-navy-800 hover:underline" aria-expanded={verMsg}>
                {verMsg ? "▾" : "▸"} Mensagem original do WhatsApp
              </button>
              {verMsg && (
                <pre className="mt-1.5 max-h-72 overflow-y-auto whitespace-pre-wrap rounded-lg border border-line bg-surface px-3 py-2 font-sans text-[12.5px] text-ink">
                  {a.origMsg}
                </pre>
              )}
            </div>
          )}
        </div>

        <footer className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-3">
          {a.atuUsr && (
            <span className="text-[11.5px] text-muted">
              Alterado por {a.atuUsr}
              {a.atuEm ? ` · ${a.atuEm}` : ""}
            </span>
          )}
          <div className="ml-auto flex flex-wrap gap-2">
            {podeGravar && (
              <button type="button" className={`${BOTAO} text-alert-600`} onClick={onExcluir}>
                Excluir
              </button>
            )}
            {podeGravar && a.aConferir && (
              <button type="button" className={`${BOTAO} text-good-600`} onClick={onConferir}>
                Marcar como conferido
              </button>
            )}
            {podeGravar && (
              <button type="button" className="rounded-lg bg-navy-900 px-4 py-1.5 text-[12.5px] font-medium text-white hover:bg-navy-800" onClick={onEditar}>
                Editar
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
