"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import BotaoLimparFiltros from "@/components/BotaoLimparFiltros";
import { IconBusca, IconMais } from "@/components/icons";
import JanelaFormulario, { Aviso, JanelaConfirmar, useAtalhoTela, useJanela } from "@/components/janela";
import { CabecalhoPagina, Comando, CorpoPagina, Pagina, Painel, Selo } from "@/components/pagina";
import { fmtDateBR, fmtHa, todayISO } from "@/lib/format";
import { addDays } from "@/lib/period";
import { podeEditar } from "@/lib/permissoes";
import { ehDataIso, usarPersistido } from "@/lib/usar-persistido";

const INPUT_BASE = "rounded-md border border-line bg-card px-2.5 py-1.5 text-[13px] text-ink focus:border-brand-600 focus:outline-none disabled:bg-surface";
const INPUT = `w-full ${INPUT_BASE}`;
const SOMENTE_LEITURA = "w-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-[13px] text-ink";
const ROTULO = "mb-1 block text-[11.5px] font-semibold text-muted";
const BOTAO_BUSCA =
  "flex h-[32px] w-[30px] flex-shrink-0 items-center justify-center rounded-md border border-line bg-surface text-muted hover:bg-card hover:text-navy-800 disabled:opacity-40";
// botões do rodapé da janela e da lista
const BOTAO_PRIMARIO = "rounded-lg bg-navy-900 px-4 py-2 text-[13px] font-semibold text-white shadow-card hover:bg-navy-800 disabled:opacity-50";
const BOTAO_SECUNDARIO =
  "rounded-lg border border-line bg-card px-3.5 py-2 text-[13px] font-semibold text-navy-800 shadow-card hover:bg-surface disabled:opacity-50";
const BOTAO_EXCLUIR =
  "rounded-lg border border-alert-500/50 bg-card px-3.5 py-2 text-[13px] font-semibold text-alert-700 shadow-card hover:bg-alert-50 disabled:opacity-50";
const BOTAO = "rounded-lg border border-line bg-card px-3 py-1.5 text-[12.5px] font-medium text-navy-800 hover:bg-surface disabled:opacity-50";
const LIMITE_REC = 150;

/** Cadastro consultado por cada campo com código */
const CAD_DO_CAMPO = {
  reg: "regiao",
  faz: "fazendas",
  pre: "presenca-infestacao",
  niv: "nivel-infestacao",
  pri: "prioridade",
};
const TITULO_CAMPO = {
  rod: "Rodada",
  sem: "Semana",
  reg: "Região",
  faz: "Fazenda",
  pre: "Presença",
  niv: "Nível de Infestação",
  pri: "Prioridade",
};

/** Resultado de uma consulta de código: nm = descrição; null = não cadastrado; vazio = o cadastro ainda não tem itens. */
/** Cor sugerida pela descrição do nível/prioridade (verde = baixo, âmbar = médio, vermelho = alto). */
function corPorDescricao(nm) {
  const t = nm.toLowerCase();
  if (/alt|grave|urgent|cr[ií]tic|\b3\b/.test(t)) return "bg-alert-50 text-alert-700 border-alert-500/40";
  if (/m[eé]d|\b2\b/.test(t)) return "bg-amber-50 text-amber-700 border-amber-500/40";
  if (/baix|leve|\b1\b/.test(t)) return "bg-good-50 text-good-700 border-good-500/40";
  return "bg-surface text-ink border-line";
}

/** "Retrato" do formulário: serve para saber se algo foi digitado ou alterado desde que a janela abriu. */
function retrato(v) {
  return JSON.stringify([v.rod, v.sem, v.reg, v.faz, v.pre, v.niv, v.pri, v.ocos, v.outrosAtivo, v.outrosTxt, v.rec, [...v.marcados].sort(), v.ocoDigitada]);
}
const CORPO_VAZIO = { faz: "", pre: "", niv: "", pri: "", ocos: [], outrosAtivo: false, outrosTxt: "", rec: "", marcados: [], ocoDigitada: "" };
const RETRATO_VAZIO = retrato({ rod: "", sem: "", reg: "", ...CORPO_VAZIO });

const nInt = (n) => n.toLocaleString("pt-BR");

/** data lembrada no navegador que existe no calendário (2026-02-30 não): a inválida volta ao padrão */
function dataDoCalendario(v) {
  if (!ehDataIso(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

export default function ApontamentoClient({ perfil }) {
  const podeGravar = podeEditar(perfil);
  const formRef = useRef(null);
  const rodRef = useRef(null);
  const avisoRef = useRef(null);
  /** só vale a resposta da última abertura de boletim (fechar, "Novo" ou abrir outro descarta a anterior) */
  const seqBoletim = useRef(0);
  /** como o formulário estava ao abrir (ou depois de gravar): fechar sem ter mudado nada não pergunta */
  const original = useRef(RETRATO_VAZIO);
  /** trava contra gravar duas vezes seguidas (F2 repetido) e contra gravar enquanto exclui */
  const gravando = useRef(false);
  /** nº do boletim aberto na janela agora (vazio sem janela ou no boletim novo) */
  const bolNaJanela = useRef(null);

  const [boletim, setBoletim] = useState(null);
  // a data é a do lançamento no sistema (hoje); a semana é informada depois da rodada
  const [dt, setDt] = useState(todayISO());
  const [rod, setRod] = useState("");
  const [sem, setSem] = useState("");
  const [reg, setReg] = useState("");
  const [faz, setFaz] = useState("");
  const [pre, setPre] = useState("");
  const [niv, setNiv] = useState("");
  const [pri, setPri] = useState("");
  const [ocorrencias, setOcorrencias] = useState([]);
  const [ocoDigitada, setOcoDigitada] = useState("");
  const [ocoErro, setOcoErro] = useState(null);
  const [listaOco, setListaOco] = useState(null);
  const [outrosAtivo, setOutrosAtivo] = useState(false);
  const [outrosTxt, setOutrosTxt] = useState("");
  const [seletor, setSeletor] = useState(null);
  const [rec, setRec] = useState("");
  const [talhoes, setTalhoes] = useState([]);
  const [marcados, setMarcados] = useState(new Set());
  const [talhoesDe, setTalhoesDe] = useState("");
  const [rodadas, setRodadas] = useState([]);
  const [consultas, setConsultas] = useState({});
  const [salvando, setSalvando] = useState(false);
  const [excluindo, setExcluindo] = useState(false);
  // mensagem de retorno: dentro da janela enquanto ela está aberta; na página depois de fechar
  const [msg, setMsg] = useState(null);
  // boletim já lançado: aberto para alterar ou excluir (o importado só para ver e excluir)
  const [editando, setEditando] = useState(null);
  const [importadoVisto, setImportadoVisto] = useState(null);
  // janelas: formulário (novo, edição ou boletim importado) e confirmação (descartar, excluir)
  const [formAberto, setFormAberto] = useState(false);
  const [confirmar, setConfirmar] = useState(null);
  /** nº do boletim que está sendo aberto (carregando) */
  const [abrindo, setAbrindo] = useState(null);

  // lista dos lançados: em branco = padrão (últimos 7 dias até hoje); a data escolhida fica lembrada neste navegador
  const hoje = todayISO();
  const [de, setDe] = usarPersistido("rodadas.apontamento.de", "", (v) => v === "" || dataDoCalendario(v));
  const [ate, setAte] = usarPersistido("rodadas.apontamento.ate", "", (v) => v === "" || dataDoCalendario(v));
  const deLista = de || addDays(hoje, -6);
  const ateLista = ate || hoje;
  const [filtroBol, setFiltroBol] = useState("");
  const algumFiltroAtivo = de !== "" || ate !== "" || filtroBol !== "";
  function limparFiltros() {
    setDe("");
    setAte("");
    setFiltroBol("");
  }
  const [lista, setLista] = useState([]);
  const [totalLista, setTotalLista] = useState(0);
  const [carregando, setCarregando] = useState(true);
  const [erroLista, setErroLista] = useState(null);
  const seqLista = useRef(0);

  const carregarBoletim = useCallback(async () => {
    const res = await fetch("/api/rodadas/apontamento", { cache: "no-store" });
    if (res.ok) setBoletim((await res.json()).boletim);
  }, []);

  useEffect(() => {
    carregarListaOcorrencias();
    carregarBoletim();
    fetch("/api/rodadas/cadastro", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setRodadas(j.rodadas ?? []))
      .catch(() => undefined);
  }, [carregarBoletim]);

  const carregarLista = useCallback(async () => {
    const seq = ++seqLista.current;
    setCarregando(true);
    setErroLista(null);
    try {
      const p = new URLSearchParams({ boletins: "1", de: deLista, ate: ateLista });
      if (filtroBol.trim()) p.set("bol", filtroBol.trim());
      const res = await fetch(`/api/rodadas/apontamento?${p}`, { cache: "no-store" });
      const j = await res.json().catch(() => ({}));
      if (seq !== seqLista.current) return;
      if (!res.ok) throw new Error(j.error ?? "Não foi possível carregar os boletins.");
      setLista(j.boletins ?? []);
      setTotalLista(j.total ?? 0);
    } catch (e) {
      if (seq !== seqLista.current) return;
      setLista([]);
      setTotalLista(0);
      setErroLista(e instanceof Error ? e.message : "Não foi possível carregar os boletins.");
    } finally {
      if (seq === seqLista.current) setCarregando(false);
    }
  }, [deLista, ateLista, filtroBol]);
  /** carregarLista com os filtros de agora: a recarga depois de gravar ou excluir (que espera o servidor) usa esta */
  const listaRef = useRef(carregarLista);
  listaRef.current = carregarLista;

  // recarrega a lista quando o filtro muda (espera a digitação parar)
  useEffect(() => {
    const t = setTimeout(carregarLista, 250);
    return () => clearTimeout(t);
  }, [carregarLista]);

  // mensagem nova com a janela aberta: rola até ela (o formulário pode ser comprido, com muitos talhões)
  useEffect(() => {
    if (formAberto && msg) avisoRef.current?.scrollIntoView({ block: "nearest" });
  }, [msg, formAberto]);

  function navegaveis() {
    return Array.from(formRef.current?.querySelectorAll("[data-nav]:not(:disabled)") ?? []);
  }
  function focar(i) {
    const el = navegaveis()[i];
    if (el) {
      el.focus();
      el.select?.();
    }
  }
  /** foca o campo seguinte ao de nome `campo` (depois de escolher no seletor) */
  function focarDepoisDe(campo) {
    setTimeout(() => {
      const navs = navegaveis();
      const i = navs.findIndex((n) => n.dataset.campo === campo);
      if (i >= 0) focar(Math.min(i + 1, navs.length - 1));
    }, 60);
  }
  /** volta o foco ao campo de nome `campo` (ao fechar o seletor sem escolher) */
  function focarCampo(campo) {
    setTimeout(() => formRef.current?.querySelector(`[data-campo="${campo}"]`)?.focus(), 0);
  }

  async function chamar(cad, cod) {
    try {
      const res = await fetch(`/api/rodadas/apontamento?cad=${cad}&cod=${encodeURIComponent(cod)}`, { cache: "no-store" });
      return res.ok ? await res.json() : null;
    } catch {
      return null;
    }
  }

  // consulta um código no cadastro e guarda, para mostrar a descrição ao lado
  async function consultar(cad, cod) {
    const valor = cod.trim();
    if (!valor) return;
    const j = await chamar(cad, valor);
    if (j) setConsultas((c) => ({ ...c, [`${cad}|${valor}`]: { nm: j.item?.nm ?? null, vazio: !j.cadastroComItens } }));
    if (cad === "fazendas") carregarTalhoes(valor);
  }

  async function carregarTalhoes(codigo) {
    const base = codigo.trim().split("-")[0];
    if (!base || base === talhoesDe) return;
    try {
      const res = await fetch(`/api/rodadas/apontamento?talhoes_faz=${encodeURIComponent(base)}`, { cache: "no-store" });
      const j = await res.json();
      if (res.ok) {
        setTalhoes(j.talhoes ?? []);
        setMarcados(new Set());
        setTalhoesDe(base);
      }
    } catch {
      /* sem a lista não dá para marcar talhões */
    }
  }

  const descricao = (cad, cod) => consultas[`${cad}|${cod.trim()}`] ?? null;
  const nomeDe = (cad, cod) => descricao(cad, cod)?.nm ?? "";

  const valorDoCampo = { rod, sem, reg, faz, pre, niv, pri };
  const gravarCampo = {
    rod: setRod,
    sem: setSem,
    reg: setReg,
    faz: setFaz,
    pre: setPre,
    niv: setNiv,
    pri: setPri,
  };

  async function adicionarOcorrencia(texto) {
    const valor = texto.trim();
    if (!valor) return;
    setOcoErro(null);
    const j = await chamar("ocorrencias", valor);
    if (!j) return setOcoErro("Não foi possível consultar o cadastro.");
    if (!j.item) {
      if (j.cadastroComItens) return setOcoErro(`Ocorrência ${valor} não cadastrada.`);
      setOcorrencias((l) => (l.some((o) => o.cod === valor) ? l : [...l, { cod: valor, nm: "" }]));
    } else {
      const item = j.item;
      setOcorrencias((l) => (l.some((o) => o.cod === item.cod) ? l : [...l, { cod: item.cod, nm: item.nm }]));
    }
    setOcoDigitada("");
  }

  async function carregarListaOcorrencias() {
    try {
      const res = await fetch("/api/rodadas/apontamento?lista=ocorrencias", { cache: "no-store" });
      const j = await res.json();
      setListaOco(res.ok ? j.itens : []);
    } catch {
      setListaOco([]);
    }
  }

  function alternarOcorrencia(o) {
    setOcorrencias((l) => (l.some((x) => x.cod === o.cod) ? l.filter((x) => x.cod !== o.cod) : [...l, o]));
  }

  const rodadaSel = useMemo(() => rodadas.find((r) => String(r.rod) === rod.trim()), [rodadas, rod]);
  const semanaInfo = rodadaSel ? rodadaSel.semanas.find((s) => String(s.sem) === sem.trim()) : undefined;

  // itens do seletor "ver e escolher" de cada campo
  async function buscarNoSeletor(campo, q) {
    const termo = q.trim().toLowerCase();
    if (campo === "rod") {
      return rodadas
        .filter((r) => !termo || String(r.rod).includes(termo))
        .map((r) => ({ cod: String(r.rod), nm: `${fmtDateBR(r.ini)} a ${fmtDateBR(r.semanas[r.semanas.length - 1]?.fim ?? r.ini)}` }));
    }
    if (campo === "sem") {
      return (rodadaSel?.semanas ?? [])
        .filter((s) => !termo || String(s.sem).includes(termo))
        .map((s) => ({ cod: String(s.sem), nm: `${fmtDateBR(s.ini)} a ${fmtDateBR(s.fim)}` }));
    }
    const cad = CAD_DO_CAMPO[campo];
    if (!cad) return [];
    try {
      const res = await fetch(`/api/cadastros/${cad}?q=${encodeURIComponent(q.trim())}&pg=1`, { cache: "no-store" });
      const j = await res.json();
      return res.ok ? j.itens.map((i) => ({ cod: i.cod, nm: i.nm })) : [];
    } catch {
      return [];
    }
  }

  function escolherNoSeletor(campo, item) {
    gravarCampo[campo](item.cod);
    const cad = CAD_DO_CAMPO[campo];
    if (cad) {
      setConsultas((c) => ({ ...c, [`${cad}|${item.cod}`]: { nm: item.nm, vazio: false } }));
      if (cad === "fazendas") carregarTalhoes(item.cod);
    }
    setSeletor(null);
    focarDepoisDe(campo);
  }

  const areaMarcada = useMemo(() => talhoes.filter((t) => marcados.has(t.tlh)).reduce((s, t) => s + (t.area ?? 0), 0), [talhoes, marcados]);
  const todosMarcados = talhoes.length > 0 && marcados.size === talhoes.length;

  function alternarTalhao(t) {
    setMarcados((m) => {
      const n = new Set(m);
      if (n.has(t)) n.delete(t);
      else n.add(t);
      return n;
    });
  }

  /** consulta o código só para mostrar a descrição (sem recarregar talhões) */
  async function registrarConsulta(cad, cod) {
    const valor = cod.trim();
    if (!valor) return;
    const j = await chamar(cad, valor);
    if (j) setConsultas((c) => ({ ...c, [`${cad}|${valor}`]: { nm: j.item?.nm ?? null, vazio: !j.cadastroComItens } }));
  }

  /** Abre um boletim lançado na janela: o do Apontamento para alterar; o importado só para ver e excluir. */
  async function abrirBoletim(numero) {
    setMsg(null);
    const n = Number(String(numero).trim());
    if (!Number.isInteger(n) || n <= 0) return setMsg({ texto: "Informe o número do boletim.", erro: true });
    const seq = ++seqBoletim.current;
    setAbrindo(n);
    try {
      const res = await fetch(`/api/rodadas/apontamento?boletim=${n}`, { cache: "no-store" });
      const j = await res.json().catch(() => ({}));
      if (seq !== seqBoletim.current) return;
      if (!res.ok) return setMsg({ texto: j.error ?? "Boletim não encontrado.", erro: true });
      const b = j.boletim;
      if (b.ori !== "apontamento") {
        registrarConsulta("regiao", b.reg);
        registrarConsulta("fazendas", b.faz);
        limpar(false);
        setEditando(null);
        setImportadoVisto(b);
        setFormAberto(true);
        return;
      }
      const primeiro = b.itens[0];
      const codigos = (primeiro?.oco ?? "")
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean);
      const base = b.faz.split("-")[0];
      // ocorrências, talhões da fazenda e descrições dos códigos, tudo ao mesmo tempo
      const [sel, tlhs] = await Promise.all([
        Promise.all(
          codigos.map(async (cod) => {
            const r = await chamar("ocorrencias", cod);
            return { cod: r?.item?.cod ?? cod, nm: r?.item?.nm ?? "" };
          }),
        ),
        (async () => {
          try {
            const r = await fetch(`/api/rodadas/apontamento?talhoes_faz=${encodeURIComponent(base)}`, { cache: "no-store" });
            const jj = await r.json();
            return r.ok ? (jj.talhoes ?? []) : [];
          } catch {
            return []; // usa só os talhões do boletim
          }
        })(),
        registrarConsulta("regiao", b.reg),
        registrarConsulta("fazendas", b.faz),
        registrarConsulta("presenca-infestacao", primeiro?.pre ?? ""),
        registrarConsulta("nivel-infestacao", primeiro?.niv ?? ""),
        registrarConsulta("prioridade", primeiro?.pri ?? ""),
      ]);
      if (seq !== seqBoletim.current) return;
      // talhões da fazenda e, marcados, os do boletim
      for (const it of b.itens) if (!tlhs.some((t) => t.tlh === it.tlh)) tlhs.push({ tlh: it.tlh, area: it.area });
      const v = {
        rod: String(b.rod),
        sem: String(b.sem),
        reg: b.reg,
        faz: b.faz,
        pre: primeiro?.pre ?? "",
        niv: primeiro?.niv ?? "",
        pri: primeiro?.pri ?? "",
        ocos: sel.map((o) => o.cod),
        outrosAtivo: !!primeiro?.ocoTxt,
        outrosTxt: primeiro?.ocoTxt ?? "",
        rec: primeiro?.rec ?? "",
        marcados: b.itens.map((i) => i.tlh),
        ocoDigitada: "",
      };
      limpar(false);
      setImportadoVisto(null);
      setEditando({ bol: b.bol, usr: b.usr });
      setDt(b.dt);
      setRod(v.rod);
      setSem(v.sem);
      setReg(v.reg);
      setFaz(v.faz);
      setPre(v.pre);
      setNiv(v.niv);
      setPri(v.pri);
      setRec(v.rec);
      setOcorrencias(sel);
      setOutrosAtivo(v.outrosAtivo);
      setOutrosTxt(v.outrosTxt);
      setTalhoes(tlhs);
      setMarcados(new Set(v.marcados));
      setTalhoesDe(base);
      original.current = retrato(v);
      setFormAberto(true);
    } catch {
      if (seq === seqBoletim.current) setMsg({ texto: "Não foi possível abrir o boletim.", erro: true });
    } finally {
      if (seq === seqBoletim.current) setAbrindo(null);
    }
  }

  function sairDoBoletim() {
    limpar(false);
    setDt(todayISO());
    setEditando(null);
    setImportadoVisto(null);
  }

  /** Novo boletim: formulário limpo na janela (o foco vai para a Rodada). */
  function novo() {
    seqBoletim.current++;
    setAbrindo(null);
    setMsg(null);
    sairDoBoletim();
    original.current = RETRATO_VAZIO;
    carregarBoletim();
    setFormAberto(true);
  }

  // retrato do que está na tela agora
  const retratoAtual = retrato({ rod, sem, reg, faz, pre, niv, pri, ocos: ocorrencias.map((o) => o.cod), outrosAtivo, outrosTxt, rec, marcados, ocoDigitada });
  const temAlgo = retratoAtual !== RETRATO_VAZIO;
  bolNaJanela.current = formAberto ? (editando?.bol ?? importadoVisto?.bol ?? null) : null;

  /** Fechar a janela: com algo digitado ou alterado, pergunta antes de descartar. */
  function fecharForm() {
    const fechar = () => {
      seqBoletim.current++;
      setFormAberto(false);
      sairDoBoletim();
    };
    if (importadoVisto || !podeGravar) return fechar();
    // edição: mudou algo no boletim aberto; novo: digitou algo além do cabeçalho que ficou do boletim gravado
    const alterado = editando ? original.current !== null && retratoAtual !== original.current : temAlgo && retratoAtual !== original.current;
    if (!alterado) return fechar();
    setConfirmar({
      titulo: editando ? "Cancelar a edição?" : "Descartar o boletim?",
      texto: editando ? "As alterações feitas não serão gravadas." : "O que foi digitado será perdido.",
      botao: "Descartar",
      perigo: true,
      acao: fechar,
    });
  }

  /** Pede confirmação e exclui o boletim (da lista ou aberto na janela). */
  function excluir(b) {
    // um boletim que ainda está abrindo (clique na linha antes do Excluir) não abre mais depois, por baixo da confirmação
    seqBoletim.current++;
    setAbrindo(null);
    setConfirmar({
      titulo: `Excluir o boletim nº ${b.bol}?`,
      texto: `Rodada ${b.rod}, semana ${b.sem || "—"}, fazenda ${b.faz || "—"}, ${fmtDateBR(b.dt)}.\nA exclusão fica registrada no Log de Alterações, com data, hora e usuário.`,
      botao: "Excluir",
      perigo: true,
      acao: () => excluirDeVez(b.bol),
    });
  }

  async function excluirDeVez(bol) {
    if (gravando.current) return;
    // enquanto exclui, a janela não fecha nem grava
    gravando.current = true;
    setExcluindo(true);
    setMsg(null);
    try {
      const res = await fetch("/api/rodadas/apontamento", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bol }),
      }).catch(() => null);
      const j = res ? await res.json().catch(() => ({})) : {};
      if (!res?.ok) return setMsg({ texto: j.error ?? "Não foi possível excluir o boletim.", erro: true });
      // o boletim excluído está aberto na janela agora: fecha (outro boletim aberto depois fica como está)
      if (bolNaJanela.current === bol) {
        seqBoletim.current++;
        setFormAberto(false);
        sairDoBoletim();
      }
      setMsg({ texto: `Boletim ${bol} excluído.`, erro: false });
      carregarBoletim();
      listaRef.current(); // com o filtro de agora (ele pode ter mudado enquanto excluía)
    } finally {
      gravando.current = false;
      setExcluindo(false);
    }
  }

  function limpar(manterCabecalho) {
    setFaz("");
    setPre("");
    setNiv("");
    setPri("");
    setOcorrencias([]);
    setOcoDigitada("");
    setOcoErro(null);
    setOutrosAtivo(false);
    setOutrosTxt("");
    setRec("");
    setTalhoes([]);
    setMarcados(new Set());
    setTalhoesDe("");
    if (!manterCabecalho) {
      setRod("");
      setSem("");
      setReg("");
    }
    // tira a mensagem de erro; a de boletim gravado fica
    setMsg((m) => (m?.erro ? null : m));
  }

  async function gravar() {
    if (salvando || gravando.current || !podeGravar || importadoVisto) return;
    setMsg(null);
    const erro = (texto) => setMsg({ texto, erro: true });
    if (!rod.trim()) return erro("Informe a rodada.");
    if (!rodadaSel) return erro(`A rodada ${rod} não está cadastrada.`);
    if (!sem.trim()) return erro("Informe a semana.");
    if (!semanaInfo) return erro(`A semana ${sem} não existe na rodada ${rod}.`);
    if (ocorrencias.length === 0 && !(outrosAtivo && outrosTxt.trim())) return erro("Marque pelo menos uma ocorrência (ou use Outros e descreva).");
    if (outrosAtivo && !outrosTxt.trim()) return erro("Descreva a ocorrência em Outros ou desmarque a opção.");
    if (marcados.size === 0) return erro("Marque pelo menos um talhão.");
    gravando.current = true;
    setSalvando(true);
    try {
      const res = await fetch("/api/rodadas/apontamento", {
        method: editando ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bol: editando?.bol,
          rod: Number(rod),
          dt,
          sem: Number(sem),
          reg,
          faz,
          pre,
          niv,
          pri,
          ocos: ocorrencias.map((o) => o.cod),
          outros: outrosAtivo ? outrosTxt.trim() : "",
          rec,
          talhoes: talhoes.filter((t) => marcados.has(t.tlh)),
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "Não foi possível gravar o boletim.");
      if (editando) {
        // edição gravada: fecha a janela e a mensagem fica na página
        seqBoletim.current++;
        setFormAberto(false);
        sairDoBoletim();
        setMsg({ texto: `Boletim ${j.bol} alterado (semana ${j.sem}). A alteração ficou registrada no Log de Alterações.`, erro: false });
        await carregarBoletim();
        listaRef.current(); // com o filtro de agora (a janela já fechou e ele pode ter mudado)
      } else {
        // boletim novo: a janela fica aberta para o próximo, com a rodada, a semana e a região
        setMsg({ texto: `Boletim ${j.bol} gravado (semana ${j.sem}).`, erro: false });
        limpar(true);
        original.current = retrato({ rod, sem, reg, ...CORPO_VAZIO });
        await carregarBoletim();
        setTimeout(() => focarDepoisDe("reg"), 50); // volta para a Fazenda
        // o boletim novo aparece na lista: se a data dele está fora do período, o período vai até ela
        if (dt > ateLista) setAte(dt);
        else if (dt < deLista) setDe(dt);
        else listaRef.current();
      }
    } catch (e) {
      setMsg({ texto: e instanceof Error ? e.message : "Não foi possível gravar o boletim.", erro: true });
    } finally {
      gravando.current = false;
      setSalvando(false);
    }
  }

  // F2 sem janela aberta: boletim novo (com a janela aberta, F2 grava; Esc fecha a janela de cima)
  useAtalhoTela("F2", novo, podeGravar);

  /** Teclas dentro da janela do formulário: F4 abre a lista do campo, Enter passa para o próximo campo. */
  function aoTeclar(e) {
    const alvo = e.target;
    if (!alvo.dataset?.nav) return;

    // F4: abre a lista para ver e escolher (padrão de ERP)
    if (e.key === "F4") {
      e.preventDefault();
      if (alvo.dataset.campo && alvo.dataset.campo in TITULO_CAMPO) setSeletor(alvo.dataset.campo);
      return;
    }

    // Backspace no campo de ocorrência vazio remove a última escolhida
    if (e.key === "Backspace" && alvo.dataset.campo === "oco" && alvo.value === "") {
      setOcorrencias((l) => l.slice(0, -1));
      return;
    }
    if (e.key !== "Enter") return;
    e.preventDefault();

    if (alvo.dataset.cad && alvo.dataset.campo !== "oco") consultar(alvo.dataset.cad, alvo.value);

    // Ocorrência: Enter com código adiciona; vazio segue para o próximo campo
    if (alvo.dataset.campo === "oco" && alvo.value.trim() !== "") {
      adicionarOcorrencia(alvo.value);
      return;
    }
    const navs = navegaveis();
    const i = navs.indexOf(alvo);
    if (i < navs.length - 1) focar(i + 1);
    else gravar(); // Enter no último campo grava
  }

  /** Campo de código com botão de busca (e F4). `largura` é a largura do código. */
  function campoCodigo(campo, largura, extra) {
    const cad = extra?.cad ?? CAD_DO_CAMPO[campo];
    const valor = valorDoCampo[campo];
    const c = cad ? descricao(cad, valor) : null;
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <input
          ref={campo === "rod" ? rodRef : undefined}
          value={valor}
          onChange={(e) => gravarCampo[campo](e.target.value)}
          onBlur={() => cad && consultar(cad, valor)}
          onFocus={(e) => e.target.select()}
          data-nav
          data-cad={cad}
          data-campo={campo}
          inputMode={campo === "rod" || campo === "sem" ? "numeric" : undefined}
          disabled={!podeGravar}
          className={`${INPUT_BASE} ${largura} flex-shrink-0 text-center`}
          aria-label={TITULO_CAMPO[campo]}
        />
        <button
          type="button"
          tabIndex={-1}
          disabled={!podeGravar}
          onClick={() => setSeletor(campo)}
          className={BOTAO_BUSCA}
          aria-label={`Escolher ${TITULO_CAMPO[campo]} (F4)`}
          title="Ver e escolher (F4)"
        >
          <IconBusca size={14} />
        </button>
        {extra?.descricaoAoLado && (
          <span className="min-w-0 basis-full truncate text-[12.5px] lg:basis-auto">
            {valor.trim() && c ? (
              c.nm ? (
                extra.pilula ? (
                  <span className={`rounded-full border px-2 py-0.5 text-[11.5px] font-semibold ${corPorDescricao(c.nm)}`}>{c.nm}</span>
                ) : (
                  <span className="text-ink">{c.nm}</span>
                )
              ) : c.vazio ? (
                <span className="text-muted">cadastro vazio</span>
              ) : (
                <span className="font-semibold text-alert-600">não cadastrado</span>
              )
            ) : null}
          </span>
        )}
      </div>
    );
  }

  const regiaoNm = nomeDe("regiao", reg);
  const fazendaNm = nomeDe("fazendas", faz);
  /** ocorrências de uma linha do boletim importado: nomes do cadastro e o texto de Outros */
  const ocorrenciasDaLinha = (it) =>
    [
      ...(it.oco ?? "")
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean)
        .map((c) => listaOco?.find((o) => o.cod === c)?.nm ?? c),
      it.ocoTxt,
    ]
      .filter(Boolean)
      .join(", ");

  const numeroNaJanela = importadoVisto?.bol ?? editando?.bol ?? boletim ?? "";
  const tituloJanela = importadoVisto
    ? `Boletim nº ${importadoVisto.bol} (importado)`
    : editando
      ? podeGravar
        ? `Editando o boletim nº ${editando.bol}`
        : `Boletim nº ${editando.bol}`
      : "Novo boletim de rodada";
  const subtituloJanela = importadoVisto
    ? "Veio da importação da planilha: não pode ser alterado aqui, só excluído · Esc fecha"
    : editando
      ? `Lançado por ${editando.usr || "—"} em ${fmtDateBR(dt)} · ${podeGravar ? "F2 grava · Esc fecha" : "somente leitura · Esc fecha"}`
      : "O número é o último boletim + 1 · F2 grava · Esc fecha";
  const somaTalhoes = lista.reduce((s, b) => s + b.talhoes, 0);

  return (
    <Pagina>
      <CabecalhoPagina
        titulo="Apontamento"
        categoria="Rodadas de Campo"
        info={!podeGravar && <Selo>Somente leitura</Selo>}
        comandos={
          podeGravar && (
            <Comando primario icone={<IconMais size={16} />} onClick={novo} title="Novo boletim (F2)">
              Novo boletim
            </Comando>
          )
        }
      />

      <CorpoPagina className="space-y-4">
        {msg && !formAberto && <Aviso msg={msg} onFechar={() => setMsg(null)} />}

        {/* Lançados */}
        <Painel titulo="Boletins lançados">
          <div className="mb-3 flex flex-wrap items-end gap-3">
            <div>
              <label className={ROTULO} htmlFor="rod-ap-de">
                De
              </label>
              <input id="rod-ap-de" type="date" value={deLista} onChange={(e) => e.target.value && setDe(e.target.value)} className={INPUT_BASE} />
            </div>
            <div>
              <label className={ROTULO} htmlFor="rod-ap-ate">
                Até
              </label>
              <input id="rod-ap-ate" type="date" value={ateLista} onChange={(e) => e.target.value && setAte(e.target.value)} className={INPUT_BASE} />
            </div>
            <div className="w-[130px]">
              <label className={ROTULO} htmlFor="rod-ap-bol">
                Boletim nº
              </label>
              <input
                id="rod-ap-bol"
                value={filtroBol}
                onChange={(e) => setFiltroBol(e.target.value.replace(/\D/g, "").slice(0, 9))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && filtroBol.trim()) {
                    e.preventDefault();
                    abrirBoletim(filtroBol);
                  }
                }}
                inputMode="numeric"
                placeholder="Qualquer"
                className={INPUT}
                title="Filtra a lista (em qualquer data); Enter abre o boletim"
              />
            </div>
            <BotaoLimparFiltros ativo={algumFiltroAtivo} onLimpar={limparFiltros} />
            {abrindo && <span className="pb-2 text-[12px] text-muted">Abrindo o boletim {abrindo}…</span>}
          </div>
          <p className="mb-2 text-[11.5px] text-muted">
            Clique numa linha para abrir o boletim. O nº em Boletim nº filtra a lista em qualquer data; Enter abre o boletim.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1060px] text-[12.5px]">
              <thead>
                <tr className="border-b border-line bg-surface text-left text-muted">
                  <th className="px-3 py-1.5 font-medium">Boletim</th>
                  <th className="px-3 py-1.5 font-medium">Data</th>
                  <th className="px-3 py-1.5 text-right font-medium">Rodada</th>
                  <th className="px-3 py-1.5 text-right font-medium">Semana</th>
                  <th className="px-3 py-1.5 font-medium">Região</th>
                  <th className="px-3 py-1.5 font-medium">Fazenda</th>
                  <th className="px-3 py-1.5 font-medium">Ocorrências</th>
                  <th className="px-3 py-1.5 text-right font-medium">Nº de talhões</th>
                  <th className="px-3 py-1.5 font-medium">Origem</th>
                  <th className="px-3 py-1.5 font-medium">Lançado por</th>
                  <th className="w-[140px]" />
                </tr>
              </thead>
              <tbody className={carregando && lista.length > 0 ? "opacity-60" : undefined}>
                {carregando && lista.length === 0 && (
                  <tr>
                    <td colSpan={11} className="px-3 py-6 text-center text-muted">
                      Carregando…
                    </td>
                  </tr>
                )}
                {!carregando && erroLista && (
                  <tr>
                    <td colSpan={11} className="px-3 py-6 text-center font-medium text-alert-600">
                      {erroLista}
                    </td>
                  </tr>
                )}
                {!carregando && !erroLista && lista.length === 0 && (
                  <tr>
                    <td colSpan={11} className="px-3 py-6 text-center text-muted">
                      {filtroBol.trim() ? `Boletim ${filtroBol} não encontrado.` : "Nenhum boletim no período."}
                      {podeGravar && !filtroBol.trim() && (
                        <button type="button" className={`${BOTAO} ml-2`} onClick={novo}>
                          Lançar um boletim
                        </button>
                      )}
                    </td>
                  </tr>
                )}
                {lista.map((b) => {
                  const importado = b.ori !== "apontamento";
                  return (
                    <tr
                      key={b.bol}
                      className={`cursor-pointer border-t border-line/60 hover:bg-surface/70 ${abrindo === b.bol ? "opacity-60" : ""}`}
                      onClick={() => abrirBoletim(b.bol)}
                      title={importado || !podeGravar ? "Ver o boletim" : "Abrir o boletim para editar"}
                    >
                      <td className="px-3 py-1.5 tabular font-medium text-ink">{b.bol}</td>
                      <td className="px-3 py-1.5 tabular">{fmtDateBR(b.dt)}</td>
                      <td className="px-3 py-1.5 text-right tabular">{b.rod}</td>
                      <td className="px-3 py-1.5 text-right tabular">{b.sem || "—"}</td>
                      <td className="max-w-[180px] truncate px-3 py-1.5" title={b.regNm || undefined}>
                        {b.reg || "—"}
                        {b.regNm && <span className="text-muted"> · {b.regNm}</span>}
                      </td>
                      <td className="max-w-[220px] truncate px-3 py-1.5" title={b.fazNm || undefined}>
                        {b.faz || "—"}
                        {b.fazNm && <span className="text-muted"> · {b.fazNm}</span>}
                      </td>
                      <td className="max-w-[280px] truncate px-3 py-1.5" title={b.ocorrencias || undefined}>
                        {b.ocorrencias || "—"}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular" title={typeof b.area === "number" ? `${fmtHa(b.area)} ha` : undefined}>
                        {b.talhoes}
                      </td>
                      <td className="px-3 py-1.5">
                        <span
                          className={`rounded-full px-1.5 py-0.5 text-[10.5px] font-semibold ${importado ? "bg-surface text-muted" : "bg-brand-50 text-brand-700"}`}
                          title={importado ? "Veio da importação da planilha" : "Lançado nesta tela"}
                        >
                          {importado ? "Importado" : "Digitado"}
                        </span>
                      </td>
                      <td className="max-w-[160px] truncate px-3 py-1.5 text-[11.5px] text-muted">{b.usr || "—"}</td>
                      <td className="px-2 py-1 text-right" onClick={(e) => e.stopPropagation()}>
                        <span className="flex justify-end gap-1.5">
                          <button type="button" className={BOTAO} onClick={() => abrirBoletim(b.bol)}>
                            {importado || !podeGravar ? "Ver" : "Editar"}
                          </button>
                          {podeGravar && (
                            <button type="button" className={`${BOTAO} text-alert-700`} onClick={() => excluir(b)} disabled={excluindo}>
                              Excluir
                            </button>
                          )}
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {lista.length > 0 && (
                  <tr className="border-t border-line bg-surface font-semibold">
                    <td colSpan={7} className="px-3 py-1.5">
                      {nInt(lista.length)} boletim(ns)
                      {totalLista > lista.length && (
                        <span className="font-normal text-muted">
                          {" "}
                          · mostrando os {nInt(lista.length)} mais recentes de {nInt(totalLista)}; diminua o período para ver os outros
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular">{nInt(somaTalhoes)}</td>
                    <td colSpan={3} />
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Painel>
      </CorpoPagina>

      <JanelaFormulario
        aberto={formAberto}
        rotulo={importadoVisto ? "Boletim importado" : editando ? "Editar boletim" : "Novo boletim"}
        titulo={tituloJanela}
        subtitulo={subtituloJanela}
        aviso={
          msg && (
            <div ref={avisoRef}>
              <Aviso msg={msg} onFechar={() => setMsg(null)} />
            </div>
          )
        }
        onFechar={fecharForm}
        onGravar={podeGravar && !importadoVisto ? gravar : undefined}
        ocupado={salvando || excluindo}
        corpoRef={formRef}
        // sem poder gravar (ou no importado) a Rodada fica bloqueada: o foco vai para o nº do boletim no topo
        focoInicial={podeGravar && !importadoVisto ? rodRef : undefined}
        onKeyDown={importadoVisto ? undefined : aoTeclar}
        topoDireita={
          <label className="campo-boletim">
            Boletim nº
            <input value={numeroNaJanela} readOnly tabIndex={-1} aria-label="Número do boletim (automático)" />
          </label>
        }
        rodape={
          importadoVisto ? (
            <>
              {podeGravar && (
                <button type="button" onClick={() => excluir(importadoVisto)} disabled={excluindo} className={`${BOTAO_EXCLUIR} mr-auto`}>
                  {excluindo ? "Excluindo…" : "Excluir boletim"}
                </button>
              )}
              <button type="button" onClick={fecharForm} disabled={excluindo} className={BOTAO_SECUNDARIO}>
                Fechar
              </button>
            </>
          ) : (
            <>
              {editando && podeGravar && (
                <button
                  type="button"
                  onClick={() => excluir({ bol: editando.bol, rod, sem, faz, dt })}
                  disabled={salvando || excluindo}
                  className={`${BOTAO_EXCLUIR} mr-auto`}
                >
                  {excluindo ? "Excluindo…" : "Excluir boletim"}
                </button>
              )}
              <button type="button" onClick={fecharForm} disabled={salvando || excluindo} className={BOTAO_SECUNDARIO}>
                {editando && podeGravar ? "Cancelar edição" : "Fechar"}
              </button>
              {!editando && podeGravar && temAlgo && (
                <button
                  type="button"
                  onClick={() => {
                    limpar(false);
                    focarCampo("rod");
                  }}
                  disabled={salvando}
                  className={BOTAO_SECUNDARIO}
                >
                  Limpar
                </button>
              )}
              {podeGravar && (
                <button type="button" onClick={gravar} disabled={salvando || excluindo} className={BOTAO_PRIMARIO}>
                  {salvando ? "Gravando…" : editando ? "Salvar alteração (F2)" : "Lançar boletim (F2)"}
                </button>
              )}
            </>
          )
        }
      >
        {importadoVisto ? (
          <>
            {/* Boletim importado: só para ver (e excluir) */}
            <div className="caixa-form-sub">Rodada e região</div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {[
                ["Data", fmtDateBR(importadoVisto.dt)],
                ["Rodada", importadoVisto.rod],
                ["Semana", importadoVisto.sem || "—"],
                ["Região", [importadoVisto.reg, nomeDe("regiao", importadoVisto.reg)].filter(Boolean).join(" · ") || "—"],
                ["Fazenda", [importadoVisto.faz, nomeDe("fazendas", importadoVisto.faz)].filter(Boolean).join(" · ") || "—"],
                ["Responsável", importadoVisto.resp || "—"],
              ].map(([rotulo, valor]) => (
                <div key={rotulo} className="min-w-0">
                  <div className={ROTULO}>{rotulo}</div>
                  <div className={`${SOMENTE_LEITURA} truncate`} title={String(valor)}>
                    {valor}
                  </div>
                </div>
              ))}
            </div>
            <div className="caixa-form-sub">Talhões · {importadoVisto.itens.length} linha(s)</div>
            <div className="overflow-x-auto rounded-md border border-line bg-card">
              <table className="w-full min-w-[640px] text-[12.5px]">
                <thead>
                  <tr className="border-b border-line bg-surface text-left text-muted">
                    <th className="px-3 py-1.5 font-medium">Talhão</th>
                    <th className="px-3 py-1.5 text-right font-medium">Área (ha)</th>
                    <th className="px-3 py-1.5 font-medium">Ocorrência</th>
                    <th className="px-3 py-1.5 font-medium">Recomendação / Diagnóstico</th>
                  </tr>
                </thead>
                <tbody>
                  {importadoVisto.itens.map((it, i) => (
                    <tr key={i} className="border-t border-line/60 align-top">
                      <td className="px-3 py-1.5 font-semibold">{it.tlh || "—"}</td>
                      <td className="px-3 py-1.5 text-right tabular">{typeof it.area === "number" ? fmtHa(it.area) : "—"}</td>
                      <td className="px-3 py-1.5">{ocorrenciasDaLinha(it) || "—"}</td>
                      <td className="px-3 py-1.5 text-muted">{it.rec || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <>
            {/* Rodada e região: Data · Rodada · Semana · Região · Desc. Região */}
            <div className="caixa-form-sub">Rodada e região</div>
            <div className="grid grid-cols-6 gap-3 lg:grid-cols-[132px_132px_112px_132px_minmax(0,1fr)]">
              <div className="col-span-2 lg:col-span-1">
                <label className={ROTULO}>Data (lançamento)</label>
                <input type="date" value={dt} readOnly tabIndex={-1} className={SOMENTE_LEITURA} aria-label="Data do lançamento (automática)" />
              </div>
              <div className="col-span-2 lg:col-span-1">
                <label className={ROTULO}>Rodada</label>
                {campoCodigo("rod", "w-[60px]")}
              </div>
              <div className="col-span-2 lg:col-span-1">
                <label className={ROTULO}>Semana</label>
                {campoCodigo("sem", "w-[48px]")}
              </div>
              <div className="col-span-2 lg:col-span-1">
                <label className={ROTULO}>Região</label>
                {campoCodigo("reg", "w-[60px]")}
              </div>
              <div className="col-span-4 lg:col-span-1">
                <label className={ROTULO}>Desc. Região</label>
                <input
                  value={regiaoNm || (reg.trim() && descricao("regiao", reg)?.vazio ? "(cadastro vazio)" : "")}
                  readOnly
                  tabIndex={-1}
                  className={SOMENTE_LEITURA}
                  aria-label="Descrição da região"
                />
              </div>
            </div>
            <p className="mt-1.5 min-h-[16px] text-[12px]">
              {rod.trim() === "" ? (
                <span className="text-muted">Informe a rodada e depois a semana.</span>
              ) : !rodadaSel ? (
                <span className="font-semibold text-alert-600">Rodada {rod} não cadastrada.</span>
              ) : sem.trim() === "" ? (
                <span className="text-muted">Informe a semana (1 a {rodadaSel.semanas.length}).</span>
              ) : !semanaInfo ? (
                <span className="font-semibold text-alert-600">Semana {sem} não existe nesta rodada.</span>
              ) : (
                <span className="text-ink">
                  <b>Semana {sem}</b> · {fmtDateBR(semanaInfo.ini)} a {fmtDateBR(semanaInfo.fim)}
                </span>
              )}
              {reg.trim() && descricao("regiao", reg) && !descricao("regiao", reg)?.nm && !descricao("regiao", reg)?.vazio && (
                <span className="ml-3 font-semibold text-alert-600">Região {reg} não cadastrada.</span>
              )}
            </p>

            {/* Fazenda e infestação: Fazenda · Descrição · Presença · Nível · Prioridade */}
            <div className="caixa-form-sub">Fazenda e infestação</div>
            <div className="grid grid-cols-3 gap-3 lg:grid-cols-[132px_minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
              <div className="col-span-1">
                <label className={ROTULO}>Fazenda</label>
                {campoCodigo("faz", "w-[58px] lg:w-[72px]")}
              </div>
              <div className="col-span-2 lg:col-span-1">
                <label className={ROTULO}>Descrição Fazenda</label>
                <input
                  value={fazendaNm || (faz.trim() && descricao("fazendas", faz)?.vazio ? "(cadastro vazio)" : "")}
                  readOnly
                  tabIndex={-1}
                  className={SOMENTE_LEITURA}
                  aria-label="Descrição da fazenda"
                />
                {faz.trim() && descricao("fazendas", faz) && !descricao("fazendas", faz)?.nm && !descricao("fazendas", faz)?.vazio && (
                  <p className="mt-1 text-[12px] font-semibold text-alert-600">Fazenda {faz} não cadastrada.</p>
                )}
              </div>
              <div>
                <label className={ROTULO}>Presença</label>
                {campoCodigo("pre", "w-[44px]", { descricaoAoLado: true })}
              </div>
              <div>
                <label className={ROTULO}>
                  Nível<span className="hidden lg:inline"> de Infestação</span>
                </label>
                {campoCodigo("niv", "w-[44px]", { descricaoAoLado: true, pilula: true })}
              </div>
              <div>
                <label className={ROTULO}>Prioridade</label>
                {campoCodigo("pri", "w-[44px]", { descricaoAoLado: true, pilula: true })}
              </div>
            </div>

            {/* Ocorrência: todas na tela, em colunas; marque as que se aplicam */}
            <div className="caixa-form-sub">Ocorrências e recomendação</div>
            <div>
              <div className="mb-1 flex flex-wrap items-end justify-between gap-2">
                <label className={ROTULO}>Ocorrência (marque uma ou mais)</label>
                <div className="mb-1 flex items-center gap-1.5">
                  <span className="text-[11px] text-muted">Atalho — código + Enter:</span>
                  <input
                    value={ocoDigitada}
                    onChange={(e) => {
                      setOcoDigitada(e.target.value);
                      setOcoErro(null);
                    }}
                    onFocus={(e) => e.target.select()}
                    data-nav
                    data-campo="oco"
                    disabled={!podeGravar}
                    className={`${INPUT_BASE} w-[72px] text-center`}
                    aria-label="Ocorrência (código)"
                  />
                </div>
              </div>
              {ocoErro && <p className="mb-1 text-[12px] font-semibold text-alert-600">{ocoErro}</p>}
              <div className="rounded-md border border-line bg-card p-2.5">
                {listaOco === null ? (
                  <p className="text-[12.5px] text-muted">Carregando ocorrências…</p>
                ) : listaOco.length === 0 ? (
                  <p className="text-[12.5px] text-muted">Nenhuma ocorrência cadastrada (Rodadas de Campo → Cadastro de Ocorrências). Use Outros.</p>
                ) : (
                  <div className="grid grid-cols-1 gap-x-4 gap-y-0.5 sm:grid-cols-2 lg:grid-cols-4">
                    {listaOco.map((o) => {
                      const on = ocorrencias.some((x) => x.cod === o.cod);
                      return (
                        <label
                          key={o.cod}
                          className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-[12.5px] ${
                            on ? "bg-brand-50 font-semibold text-brand-800" : "text-ink hover:bg-surface"
                          }`}
                        >
                          <input type="checkbox" tabIndex={-1} checked={on} disabled={!podeGravar} onChange={() => alternarOcorrencia(o)} />
                          <span className="w-7 flex-shrink-0 tabular text-muted">{o.cod}</span>
                          <span className="min-w-0 truncate">{o.nm}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-line pt-2">
                  <label
                    className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-[12.5px] ${
                      outrosAtivo ? "bg-brand-50 font-semibold text-brand-800" : "text-ink hover:bg-surface"
                    }`}
                  >
                    <input type="checkbox" tabIndex={-1} checked={outrosAtivo} disabled={!podeGravar} onChange={() => setOutrosAtivo((v) => !v)} />
                    Outros
                  </label>
                  <input
                    value={outrosTxt}
                    onChange={(e) => setOutrosTxt(e.target.value.slice(0, 100))}
                    onFocus={(e) => e.target.select()}
                    maxLength={100}
                    data-nav={outrosAtivo ? true : undefined}
                    data-campo="outros"
                    disabled={!podeGravar || !outrosAtivo}
                    placeholder="Descreva a ocorrência (até 100 caracteres)"
                    className={`${INPUT_BASE} min-w-[220px] flex-1 disabled:opacity-50`}
                    aria-label="Outros — descrição da ocorrência"
                  />
                  {outrosAtivo && <span className="text-[11px] tabular text-muted">{outrosTxt.length}/100</span>}
                </div>
              </div>
            </div>

            {/* Recomendação / Diagnóstico */}
            <div className="mt-3">
              <div className="flex items-end justify-between">
                <label className={ROTULO}>Recomendação / Diagnóstico</label>
                <span className={`mb-1 text-[11px] tabular ${rec.length >= LIMITE_REC ? "font-semibold text-alert-600" : "text-muted"}`}>
                  {rec.length}/{LIMITE_REC}
                </span>
              </div>
              <input
                value={rec}
                onChange={(e) => setRec(e.target.value.slice(0, LIMITE_REC))}
                onFocus={(e) => e.target.select()}
                maxLength={LIMITE_REC}
                data-nav
                data-campo="rec"
                disabled={!podeGravar}
                className={INPUT}
              />
            </div>

            <div className="caixa-form-sub flex flex-wrap items-center gap-3">
              <h3 className="text-[12.5px] font-semibold">Talhões{fazendaNm ? ` · ${faz.trim().split("-")[0]} ${fazendaNm}` : ""}</h3>
              {talhoes.length > 0 && (
                <>
                  <label className="flex cursor-pointer items-center gap-2 rounded-md border border-line bg-surface px-2.5 py-1 text-[12.5px] font-semibold text-navy-800">
                    <input
                      type="checkbox"
                      data-nav
                      checked={todosMarcados}
                      disabled={!podeGravar}
                      onChange={() => setMarcados(todosMarcados ? new Set() : new Set(talhoes.map((t) => t.tlh)))}
                    />
                    Marcar todos
                  </label>
                  <span className="text-[12px] text-muted">
                    {marcados.size} de {talhoes.length} marcado(s) · {fmtHa(areaMarcada)} ha
                  </span>
                </>
              )}
            </div>

            {talhoes.length === 0 ? (
              <p className="text-[12.5px] text-muted">
                {faz.trim()
                  ? "Nenhum talhão encontrado para esta fazenda. Importe o Relatório de Talhões da safra em Planejamento Agrícola › Fazenda e Talhões para listá-los aqui."
                  : "Informe a fazenda para listar os talhões."}
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
                {talhoes.map((t) => {
                  const on = marcados.has(t.tlh);
                  return (
                    <label
                      key={t.tlh}
                      title={t.producao === false ? t.ocupacao : undefined}
                      className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 text-[12.5px] ${
                        on ? "border-brand-600 bg-brand-50 text-brand-800" : "border-line bg-card text-ink hover:bg-surface"
                      }`}
                    >
                      <input type="checkbox" data-nav checked={on} disabled={!podeGravar} onChange={() => alternarTalhao(t.tlh)} />
                      <span className="font-semibold">{t.tlh}</span>
                      <span className="ml-auto text-[11px] tabular text-muted">{t.area !== null ? `${fmtHa(t.area)} ha` : ""}</span>
                    </label>
                  );
                })}
              </div>
            )}

            <p className="mt-3 text-[11.5px] leading-relaxed text-muted">
              Enter ou Tab passa para o próximo campo. Digite só o código — a descrição vem do cadastro — ou use a lupa (ou F4) para ver a lista e escolher. As
              ocorrências ficam todas na tela: clique nas que se aplicam (ou digite o código + Enter no atalho); use Outros para descrever uma que não está na
              lista. Marque os talhões com a barra de espaço. Para gravar: F2, o botão Lançar boletim ou Enter no último campo. Esc fecha a janela. O número
              do boletim é sempre o último + 1.
            </p>
          </>
        )}
      </JanelaFormulario>

      {seletor && (
        <Seletor
          titulo={TITULO_CAMPO[seletor]}
          buscar={(q) => buscarNoSeletor(seletor, q)}
          onEscolher={(item) => escolherNoSeletor(seletor, item)}
          onFechar={() => {
            const campo = seletor;
            setSeletor(null);
            focarCampo(campo);
          }}
        />
      )}
      {confirmar && (
        <JanelaConfirmar
          {...confirmar}
          onCancelar={() => setConfirmar(null)}
          onConfirmar={() => {
            const acao = confirmar.acao;
            setConfirmar(null);
            acao();
          }}
        />
      )}
    </Pagina>
  );
}

/**
 * "Ver e escolher": lista com filtro (código ou descrição); ↑ ↓ e Enter escolhem, Esc fecha. Abre por cima da janela
 * do formulário (portal no fim da página) e o Esc fecha só ela.
 */
function Seletor({ titulo, buscar, onEscolher, onFechar }) {
  const [q, setQ] = useState("");
  const [itens, setItens] = useState(null);
  const [ativo, setAtivo] = useState(0);
  const buscarRef = useRef(buscar);
  buscarRef.current = buscar;
  useJanela(true, { onEsc: onFechar });

  useEffect(() => {
    let vivo = true;
    const t = setTimeout(
      async () => {
        const r = await buscarRef.current(q);
        if (vivo) {
          setItens(r);
          setAtivo(0);
        }
      },
      q ? 250 : 0,
    );
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [q]);

  function aoTeclar(e) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setAtivo((a) => Math.min(a + 1, (itens?.length ?? 1) - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setAtivo((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      const item = itens?.[ativo];
      if (item) onEscolher(item);
    }
  }

  return createPortal(
    <div translate="no" className="fixed inset-0 z-[55] flex items-end justify-center bg-navy-950/50 sm:items-center sm:px-4" onKeyDown={aoTeclar}>
      <div role="dialog" aria-modal="true" aria-label={`Escolher ${titulo}`} className="flex max-h-[85vh] w-full max-w-md flex-col rounded-t-xl2 bg-card p-4 shadow-pop sm:rounded-xl2 sm:p-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-[15px] font-bold text-ink">Escolher · {titulo}</h3>
          <button type="button" onClick={onFechar} aria-label="Fechar" className="px-1 text-[20px] leading-none text-muted">
            ×
          </button>
        </div>
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filtrar por código ou descrição…"
          className={INPUT}
          aria-label="Filtrar"
        />
        <div className="mt-2 min-h-[120px] flex-1 overflow-y-auto rounded-md border border-line">
          {itens === null ? (
            <p className="px-3 py-4 text-[12.5px] text-muted">Carregando…</p>
          ) : itens.length === 0 ? (
            <p className="px-3 py-4 text-[12.5px] text-muted">Nenhum item encontrado.</p>
          ) : (
            <ul>
              {itens.map((it, i) => (
                <li key={it.cod}>
                  <button
                    type="button"
                    onClick={() => onEscolher(it)}
                    onMouseEnter={() => setAtivo(i)}
                    className={`flex w-full items-center gap-3 px-3 py-2 text-left text-[13px] ${
                      i === ativo ? "bg-brand-50 text-brand-800" : "text-ink hover:bg-surface"
                    }`}
                  >
                    <span className="w-14 flex-shrink-0 font-semibold tabular">{it.cod}</span>
                    <span className="min-w-0 truncate">{it.nm}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <p className="mt-2 text-[11px] text-muted">↑ ↓ para percorrer · Enter escolhe · Esc fecha</p>
      </div>
    </div>,
    document.body,
  );
}
