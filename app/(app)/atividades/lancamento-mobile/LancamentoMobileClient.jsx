"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  IconAtualizar,
  IconCelular,
  IconCompartilhar,
  IconCopiar,
  IconEditar,
  IconFechar,
  IconMais,
  IconSalvar,
  IconSetaDireita,
  IconTalhao,
} from "@/components/icons";
import { Aviso, JanelaConfirmar } from "@/components/janela";
import { CabecalhoPagina, CorpoPagina, Pagina, rolarCorpoParaOTopo, Selo } from "@/components/pagina";
import { round2 } from "@/lib/atividades";
import { fmtDateBR, todayISO } from "@/lib/format";
import { lerNumero as lerNumeroComMilhar } from "@/lib/lancamento-mobile";
import { normFaz, normTlh } from "@/lib/ocupacao";
import { addDays } from "@/lib/period";
import { podeEditar } from "@/lib/permissoes";
import { ehBooleano, usarPersistido } from "@/lib/usar-persistido";

/*
 * Lançamento Mobile: o apontamento diário feito no campo, pelo celular, em quatro passos —
 *   1. quem está lançando (matrícula ou código, lembrada no aparelho);
 *   2. as O.S. em aberto dessa pessoa, com o que falta fazer em cada operação e o último apontamento;
 *   3. os talhões realizados (da O.S. ou incluídos de fora dela), com a área de cada um;
 *   4. os dados do serviço.
 * Ao gravar mostra o texto padrão para copiar e mandar no grupo do WhatsApp; a última linha do texto (a marca do
 * boletim) faz o bot reconhecer que o apontamento já está no sistema. A tela Apontamento continua sendo a de
 * lançamento na plataforma: aqui só se lança, e só se edita o que foi lançado por esta tela.
 */

const API = "/api/atividades/lancamento-mobile";
const STATUS_PADRAO = ["MANTER ABERTA", "CONCLUÍDA", "NÃO CONCLUÍDA"];
const CHAVE_RASCUNHO = "ca_ui:lancMobile.rascunho";
const PASSOS = [
  { n: 1, rotulo: "Quem" },
  { n: 2, rotulo: "O.S." },
  { n: 3, rotulo: "Talhões" },
  { n: 4, rotulo: "Dados" },
];
const PERIODOS_MEUS = [7, 15, 30];

const SERVICO_VAZIO = {
  atividade: "",
  solicitante: "",
  etapaCod: "",
  tipoAplicacao: "",
  equipe: "",
  eqp: "",
  numEquipamentos: "",
  numPessoas: "",
  vazaoRec: "",
  volCalda: "",
  unCalda: "L",
  statusOS: "MANTER ABERTA",
  obs: "",
  modelo: "",
};
// marcas: área digitada de cada talhão da O.S. marcado ("propCod|tlh" → texto); extras: talhões de fora da O.S.;
// pendentes: talhões do boletim aberto para edição, encaixados quando os talhões da O.S. chegam
const LANC_VAZIO = { id: null, boletim: null, os: "", opCod: "", marcas: {}, extras: [], pendentes: null, servico: SERVICO_VAZIO };

// campos e botões para o dedo: 16px no campo (o iPhone não dá zoom) e altura de 44–48px
const CAMPO = "h-12 w-full rounded-lg border border-line bg-card px-3 text-[16px] text-ink placeholder:text-muted/70 disabled:opacity-60";
const ROTULO = "mb-1 block text-[13px] font-medium text-muted";
const BOTAO =
  "inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-line bg-card px-4 text-[14.5px] font-medium text-navy-800 hover:bg-surface disabled:pointer-events-none disabled:opacity-50";
const BOTAO_MENOR =
  "inline-flex h-10 flex-shrink-0 items-center justify-center gap-1.5 rounded-lg border border-line bg-card px-3 text-[13px] font-medium text-navy-800 hover:bg-surface disabled:pointer-events-none disabled:opacity-50";
const BOTAO_PRIMARIO =
  "inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-navy-900 px-5 text-[16px] font-semibold text-white hover:bg-navy-800 dark:bg-crv-acao dark:hover:bg-[#3A6DBA] disabled:pointer-events-none disabled:opacity-50";
const BOTAO_WHATSAPP =
  "inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-crv-verde px-5 text-[16px] font-semibold text-white hover:bg-[#24724A] disabled:pointer-events-none disabled:opacity-50";
const CARTAO = "rounded-xl2 border border-line bg-card shadow-card";
const TITULO_PASSO = "font-display text-[21px] font-semibold leading-tight text-ink focus:outline-none";

const nf = (n, c = 2) => (Number.isFinite(n) ? n.toLocaleString("pt-BR", { minimumFractionDigits: c, maximumFractionDigits: c }) : "—");
/**
 * Área digitada: "12,5" ou "1.234,50" (vírgula decimal) ou "12.5"; vazio = null; inválido = NaN. Na área do talhão o
 * ponto sozinho é decimal ("1.500" = 1,5 ha); a Calda/Dose e a Calda gasta usam lerNumeroComMilhar ("1.500" L = 1500).
 */
function lerNumero(v) {
  const t = String(v ?? "").trim();
  if (!t) return null;
  const x = t.includes(",") ? Number(t.replace(/\./g, "").replace(",", ".")) : Number(t);
  return Number.isFinite(x) ? x : NaN;
}
/** dose/calda gravada → campo ("0,035", "1500"): sem arredondar, para regravar o boletim sem mudar o valor */
const paraCampo = (n) =>
  n === null || n === undefined || !Number.isFinite(n) ? "" : n.toLocaleString("pt-BR", { maximumFractionDigits: 6, useGrouping: false });
const areaCampo = (n) => (Number.isFinite(n) && n > 0 ? nf(n) : "");
const soNumero = (v) => v.replace(/[^\d.,]/g, "").slice(0, 14);
const soDigitos = (v) => v.replace(/\D/g, "").slice(0, 4);
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
const diaMes = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "");
const chaveDe = (t) => `${t.propCod}|${t.tlh}`;
const mesmoTalhao = (a, b) => normFaz(a.propCod) === normFaz(b.propCod) && normTlh(a.tlh) === normTlh(b.tlh);
const idSeguro = (s) => String(s).replace(/[^\w-]/g, "_");
const mesmaMatricula = (a, b) => String(a ?? "").trim().replace(/^0+(?=\d)/, "") === String(b ?? "").trim().replace(/^0+(?=\d)/, "");
/** opções sem repetidas e sem vazias (chave das listas de sugestão) */
const unicos = (l) => Array.from(new Set((l ?? []).filter(Boolean)));
const rotModelo = (m) => (m === "mecanizada" ? "Mecanizada" : m === "manual" ? "Manual" : "");

/** "TL 05" (talhão numérico com dois dígitos), "TL 2A"; vazio = só a fazenda */
function rotTalhao(tlh) {
  const t = String(tlh ?? "").trim();
  if (!t) return "Sem talhão";
  return /^\d+$/.test(t) ? `TL ${t.replace(/^0+(?=\d)/, "").padStart(2, "0")}` : `TL ${t.toUpperCase()}`;
}
/** último apontamento: "07/10 · boletim nº 160 · 3,20 ha" */
const textoUltimo = (u) => (u ? `${diaMes(u.dt)} · boletim nº ${u.boletim}${Number.isFinite(u.area) ? ` · ${nf(u.area)} ha` : ""}` : "");

let seqExtra = 0;
const novaChaveExtra = () => `x${++seqExtra}`;

/** GET na rota do Lançamento Mobile; sem sinal vira uma mensagem clara (no campo a conexão cai). */
async function obter(params) {
  return chamar(`${API}?${new URLSearchParams(params)}`, { cache: "no-store" });
}
async function enviar(corpo) {
  return chamar(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo), cache: "no-store" });
}
async function chamar(url, init) {
  let res;
  try {
    res = await fetch(url, init);
  } catch {
    return { ok: false, status: 0, json: { error: "Sem conexão com o servidor. Confira o sinal do celular e tente de novo." } };
  }
  const json = await res.json().catch(() => ({}));
  if (res.status === 401 && !json.error) json.error = "Sessão expirada. Entre novamente.";
  return { ok: res.ok, status: res.status, json };
}

/** Copia o texto: a API do navegador só funciona em HTTPS; fora dela (teste pela rede local, navegador antigo), textarea + copy. */
async function copiarParaAreaDeTransferencia(texto) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(texto);
      return true;
    }
  } catch {
    /* sem permissão: tenta a alternativa */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = texto;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;top:0;left:-9999px;opacity:0;font-size:16px";
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, texto.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/** Seleciona o texto da caixa, para copiar à mão quando o navegador não deixa copiar sozinho. */
function selecionarConteudo(el) {
  try {
    const r = document.createRange();
    r.selectNodeContents(el);
    const s = window.getSelection();
    s?.removeAllRanges();
    s?.addRange(r);
  } catch {
    /* sem seleção: o texto continua à vista */
  }
}

/** Compartilhar do celular (escolhe o WhatsApp e o grupo); sem ele, abre o WhatsApp com o texto. Quem envia é sempre a pessoa. */
async function enviarNoWhatsapp(texto) {
  if (typeof navigator.share === "function") {
    try {
      await navigator.share({ text: texto });
      return;
    } catch (e) {
      if (e?.name === "AbortError") return;
    }
  }
  window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, "_blank", "noopener,noreferrer");
}

/** Copiar com retorno ("copiado" / "não deu"), que some sozinho. */
function usarCopia() {
  const [estado, setEstado] = useState(null);
  const t = useRef(null);
  useEffect(() => () => clearTimeout(t.current), []);
  const copiar = useCallback(async (texto, caixa) => {
    const ok = await copiarParaAreaDeTransferencia(texto);
    if (!ok && caixa) selecionarConteudo(caixa);
    setEstado(ok ? "ok" : "falhou");
    clearTimeout(t.current);
    t.current = setTimeout(() => setEstado(null), ok ? 3000 : 8000);
  }, []);
  return [estado, copiar];
}

const MSG_COPIA = {
  ok: "Texto copiado. Abra o grupo do WhatsApp e cole.",
  falhou: "O navegador não deixou copiar sozinho: o texto ficou selecionado — use Copiar do celular.",
};

function agruparPorFazenda(talhoes) {
  const m = new Map();
  for (const t of talhoes) {
    if (!m.has(t.propCod)) m.set(t.propCod, { propCod: t.propCod, propNm: t.propNm ?? "", talhoes: [] });
    m.get(t.propCod).talhoes.push(t);
  }
  return [...m.values()];
}

function totaisDaOS(talhoes) {
  return talhoes.reduce(
    (a, t) => ({ rec: a.rec + (t.areaRec ?? t.areaTlh ?? 0), ja: a.ja + (t.ja ?? 0), falta: a.falta + (t.saldo ?? 0) }),
    { rec: 0, ja: 0, falta: 0 },
  );
}

/** Em branco vêm da O.S. (atividade = descrição da operação, solicitante = responsável da O.S.); os preenchidos ficam. */
function completarDaOS(s, info) {
  const op = info.operacao ?? {};
  return {
    ...s,
    atividade: s.atividade || op.ds || "",
    solicitante: s.solicitante || info.resp || "",
    etapaCod: s.etapaCod || op.etapaCod || "",
    tipoAplicacao: s.tipoAplicacao || op.tipoDs || "",
    modelo: s.modelo || op.modelo || "",
  };
}

/**
 * Talhões gravados no boletim → marcas da O.S. (mesmo código, ou "05" = "5" e "09411-1" = "9411") e, os que não
 * estão na O.S., incluídos como de fora dela.
 */
function encaixarTalhoes(l, gravados, daOS) {
  const somas = {};
  const extras = [];
  for (const g of gravados ?? []) {
    const t = daOS.find((x) => x.propCod === g.propCod && x.tlh === g.tlh) ?? daOS.find((x) => mesmoTalhao(x, g));
    const area = Number(g.area) || 0;
    if (t) somas[chaveDe(t)] = (somas[chaveDe(t)] ?? 0) + area;
    else extras.push({ chave: novaChaveExtra(), propCod: g.propCod, propNm: g.propNm ?? "", tlh: g.tlh ?? "", area: areaCampo(area), areaTlh: g.areaTlh ?? null });
  }
  const marcas = {};
  for (const [k, v] of Object.entries(somas)) marcas[k] = areaCampo(round2(v));
  return { ...l, marcas, extras, pendentes: null };
}

function servicoDoBoletim(a) {
  return {
    atividade: a.atividade ?? "",
    solicitante: a.solicitante ?? "",
    etapaCod: a.etapaCod ?? "",
    tipoAplicacao: a.tipoAplicacao ?? "",
    equipe: a.equipe ?? "",
    eqp: a.eqp ?? "",
    numEquipamentos: a.numEquipamentos ? String(a.numEquipamentos) : "",
    numPessoas: a.numPessoas ? String(a.numPessoas) : "",
    vazaoRec: paraCampo(a.vazaoRec),
    volCalda: paraCampo(a.volCalda),
    unCalda: a.unCalda === "kg" ? "kg" : "L",
    statusOS: a.statusOS ?? "",
    obs: a.obs ?? "",
    modelo: a.modelo === "mecanizada" || a.modelo === "manual" ? a.modelo : "",
  };
}

export default function LancamentoMobileClient({ perfil, nomeUsuario }) {
  const pode = podeEditar(perfil);
  const [aba, setAba] = useState("lancar");
  const [passo, setPasso] = useState(1);
  const [hoje, setHoje] = useState("");
  const [dt, setDt] = useState("");
  const [matricula, setMatricula] = usarPersistido("lancMobile.matricula", "", (v) => typeof v === "string" && v.length <= 20);
  const [soFalta, setSoFalta] = usarPersistido("lancMobile.soFalta", false, ehBooleano);
  const [matDigitada, setMatDigitada] = useState("");
  const [minhas, setMinhas] = useState(null); // { responsavel, ordens, mat, dt }
  const [buscandoOS, setBuscandoOS] = useState(false);
  const [erroMat, setErroMat] = useState(null);
  const [filtroOS, setFiltroOS] = useState("");
  const [opcoes, setOpcoes] = useState(null);
  const [lanc, setLanc] = useState(LANC_VAZIO);
  const [osInfo, setOsInfo] = useState(null);
  const [osInfoChave, setOsInfoChave] = useState("");
  const [carregandoTalhoes, setCarregandoTalhoes] = useState(false);
  const [erroTalhoes, setErroTalhoes] = useState(null);
  const [tentativa, setTentativa] = useState(0);
  const [msg, setMsg] = useState(null);
  const [gravando, setGravando] = useState(false);
  const [confirmacao, setConfirmacao] = useState(null); // avisos do servidor antes de gravar
  const [pergunta, setPergunta] = useState(null); // { titulo, texto, botao, perigo, acao }
  const [resultado, setResultado] = useState(null); // { id, boletim, texto, avisos, editado, os, op, area, dt }
  const [rascunho, setRascunho] = useState(null);
  const [diasMeus, setDiasMeus] = useState(7);
  const [meus, setMeus] = useState({ lista: null, carregando: false, erro: null });
  const [abrindo, setAbrindo] = useState(null); // boletim sendo carregado
  const [detalhe, setDetalhe] = useState(null); // { apontamento, texto }: boletim aberto em Meus lançamentos
  const [copia, copiar] = usarCopia();
  const seqOS = useRef(0);
  const seqTalhoes = useRef(0);
  const seqMeus = useRef(0);
  const iniciou = useRef(false);
  const padroes = useRef({});
  // data em que se estava lançando antes de abrir um boletim para editar (ou um rascunho de outro dia): o "Novo
  // lançamento" volta a ela, e não à data do boletim editado
  const dtAntesDeAbrir = useRef(null);
  const tituloPasso = useRef(null);
  const focarPasso = useRef(false);
  const caixaTexto = useRef(null);
  const cacheBol = useRef(new Map());

  const matAtual = minhas?.mat ?? "";
  const nomePessoa = minhas?.responsavel?.nome || minhas?.ordens?.find((o) => o.resp)?.resp || "";

  // data de hoje no aparelho (no servidor o fuso pode ser outro); opções dos campos; rascunho guardado
  useEffect(() => {
    const h = todayISO();
    setHoje(h);
    setDt((d) => d || h);
    obter({ opcoes: "1" }).then(({ ok, json }) => ok && setOpcoes(json));
    try {
      const r = JSON.parse(localStorage.getItem(CHAVE_RASCUNHO) ?? "null");
      if (r && r.v === 1 && r.lanc?.os && r.lanc?.opCod && /^\d{4}-\d{2}-\d{2}$/.test(r.dt ?? "")) setRascunho(r);
    } catch {
      /* sem armazenamento: sem rascunho */
    }
  }, []);

  const irPara = useCallback((n) => {
    focarPasso.current = true;
    setPasso(n);
  }, []);

  // ao trocar de passo (ou abrir o resultado), volta ao topo e leva o foco ao título (leitor de tela)
  useEffect(() => {
    if (!focarPasso.current) return;
    focarPasso.current = false;
    rolarCorpoParaOTopo(false);
    tituloPasso.current?.focus({ preventScroll: true });
  }, [passo, aba, resultado, detalhe]);

  /** O.S. em aberto da matrícula na data. `nova`: matrícula digitada agora (se não achar, some o que estava na tela). */
  const buscarOS = useCallback(async (mat, data, nova = false) => {
    const seq = ++seqOS.current;
    setBuscandoOS(true);
    setErroMat(null);
    const { ok, json } = await obter({ mat, dt: data });
    if (seq !== seqOS.current) return null;
    setBuscandoOS(false);
    if (!ok) {
      setErroMat(json.error ?? "Não foi possível buscar as O.S.");
      if (nova) setMinhas(null);
      else setMinhas((m) => (m && mesmaMatricula(m.mat, mat) ? { ...m, ordens: [], dt: data } : m));
      return null;
    }
    // a matrícula como está no cadastro ("0601448" digitado = "601448"): é ela que vai no lançamento e em Meus lançamentos
    const canonica = String(json.responsavel?.matricula ?? "").trim() || mat;
    const r = { responsavel: json.responsavel ?? null, ordens: Array.isArray(json.ordens) ? json.ordens : [], mat: canonica, dt: data };
    setMinhas(r);
    return r;
  }, []);

  // matrícula lembrada no aparelho: já busca as O.S. ao abrir a tela
  useEffect(() => {
    if (iniciou.current || !matricula || !dt) return;
    iniciou.current = true;
    setMatDigitada(matricula);
    buscarOS(matricula, dt, true).then((r) => {
      if (!r) return;
      setMatricula(r.mat);
      setMatDigitada(r.mat);
      setPasso((p) => (p === 1 ? 2 : p));
    });
  }, [matricula, dt, buscarOS]);

  // trocar a data refaz a busca das O.S. (o que falta e o último apontamento são até a data)
  useEffect(() => {
    if (!dt || !minhas?.mat || minhas.dt === dt) return;
    buscarOS(minhas.mat, dt);
  }, [dt]); // eslint-disable-line react-hooks/exhaustive-deps

  // talhões da O.S. escolhida (na edição, o "Já apontado" não conta o próprio boletim)
  const chaveDesejada = lanc.os && lanc.opCod && dt ? `${lanc.os}|${lanc.opCod}|${dt}|${lanc.id ?? ""}` : "";
  useEffect(() => {
    if (!chaveDesejada || chaveDesejada === osInfoChave) {
      // nada a buscar (voltou à O.S. já carregada, ou o lançamento foi limpo): a resposta de uma busca ainda em
      // andamento é de outra O.S./operação e não pode mais trocar os talhões nem os dados do serviço
      ++seqTalhoes.current;
      setCarregandoTalhoes(false);
      setErroTalhoes(null);
      return;
    }
    const seq = ++seqTalhoes.current;
    setCarregandoTalhoes(true);
    setErroTalhoes(null);
    const p = { os: lanc.os, op: lanc.opCod, dt };
    if (lanc.id) p.excluir = String(lanc.id);
    obter(p).then(({ ok, json }) => {
      if (seq !== seqTalhoes.current) return;
      setCarregandoTalhoes(false);
      if (!ok || !json.operacao) {
        setErroTalhoes(json.error ?? "Não foi possível carregar os talhões da O.S.");
        return;
      }
      const talhoes = Array.isArray(json.talhoes) ? json.talhoes : [];
      const info = { ...json, talhoes };
      // padrões desta operação (o que o completarDaOS põe nos campos em branco): ao trocar de operação, o campo que
      // ainda estiver com eles recebe os da nova — também no boletim aberto para editar e no rascunho
      const o = json.operacao;
      padroes.current = { atividade: o.ds ?? "", solicitante: json.resp ?? "", etapaCod: o.etapaCod ?? "", modelo: o.modelo ?? "", tipoAplicacao: o.tipoDs ?? "" };
      setOsInfo(info);
      setOsInfoChave(chaveDesejada);
      setLanc((l) => {
        const n = { ...l, servico: completarDaOS(l.servico, info) };
        return l.pendentes ? encaixarTalhoes(n, l.pendentes, talhoes) : n;
      });
    });
  }, [chaveDesejada, tentativa]); // eslint-disable-line react-hooks/exhaustive-deps

  // os talhões na tela são da O.S./operação escolhida (trocando só a data, os da data anterior ficam até chegar os novos)
  const osInfoValido = !!osInfo && osInfoChave.startsWith(`${lanc.os}|${lanc.opCod}|`) && !lanc.pendentes;
  const talhoesOS = useMemo(() => (osInfoValido ? osInfo.talhoes : []), [osInfoValido, osInfo]);
  const grupos = useMemo(() => agruparPorFazenda(talhoesOS), [talhoesOS]);

  // linhas que vão no lançamento: talhões da O.S. marcados + os de fora dela
  const linhas = useMemo(
    () => [
      ...talhoesOS.filter((t) => lanc.marcas[chaveDe(t)] !== undefined).map((t) => ({ propCod: t.propCod, tlh: t.tlh, texto: lanc.marcas[chaveDe(t)] })),
      ...lanc.extras.map((x) => ({ propCod: x.propCod, tlh: x.tlh, texto: x.area })),
    ],
    [talhoesOS, lanc.marcas, lanc.extras],
  );
  const total = round2(linhas.reduce((a, l) => a + (lerNumero(l.texto) > 0 ? lerNumero(l.texto) : 0), 0));
  const temNaoGravado = !resultado && !!lanc.os && (Object.keys(lanc.marcas).length > 0 || lanc.extras.length > 0);

  // rascunho no aparelho: se a aba do navegador for fechada (ou o celular a descartar), dá para continuar depois
  useEffect(() => {
    if (resultado || !lanc.os || !(lanc.id || Object.keys(lanc.marcas).length || lanc.extras.length)) return;
    try {
      localStorage.setItem(CHAVE_RASCUNHO, JSON.stringify({ v: 1, matricula: matAtual, dt, lanc, em: new Date().toISOString() }));
    } catch {
      /* cheio ou bloqueado: só não fica o rascunho */
    }
  }, [lanc, dt, resultado, matAtual]);

  const limparRascunho = useCallback(() => {
    setRascunho(null);
    try {
      localStorage.removeItem(CHAVE_RASCUNHO);
    } catch {
      /* nada a limpar */
    }
  }, []);

  const mostrarRascunho = !!rascunho && !lanc.os && !resultado && !!matAtual && rascunho.matricula === matAtual;

  function continuarRascunho() {
    const r = rascunho;
    setRascunho(null);
    padroes.current = {};
    if (dtAntesDeAbrir.current === null) dtAntesDeAbrir.current = dt;
    setDt(r.dt);
    setLanc({
      ...LANC_VAZIO,
      ...r.lanc,
      extras: (r.lanc.extras ?? []).map((x) => ({ ...x, chave: novaChaveExtra() })),
      servico: { ...SERVICO_VAZIO, ...r.lanc.servico },
    });
    irPara(3);
  }

  /** Ao largar a edição (ou o rascunho), volta à data em que se estava lançando antes de abri-lo. */
  function voltarDataAntesDeAbrir() {
    const d = dtAntesDeAbrir.current;
    dtAntesDeAbrir.current = null;
    if (d) setDt(d);
  }

  // ------------------------------------------------------------------ passo 1: quem está lançando

  async function buscarMatricula(e) {
    e?.preventDefault();
    const m = matDigitada.trim();
    if (!m) return setErroMat("Informe a matrícula ou o código.");
    iniciou.current = true;
    const outra = !!matAtual && !mesmaMatricula(matAtual, m);
    const fazer = async () => {
      const r = await buscarOS(m, dt || todayISO(), true);
      if (!r) return;
      setMatricula(r.mat);
      setMatDigitada(r.mat);
      if (outra) {
        setLanc(LANC_VAZIO);
        setResultado(null);
        padroes.current = {};
        // as O.S. da outra matrícula já vieram para a data da tela: é nela que se segue
        dtAntesDeAbrir.current = null;
      }
      irPara(2);
    };
    if (outra && temNaoGravado) {
      setPergunta({
        titulo: "Trocar a matrícula?",
        texto: `O lançamento da O.S. ${lanc.os} ainda não foi gravado e será descartado.`,
        botao: "Trocar",
        perigo: true,
        acao: fazer,
      });
    } else await fazer();
  }

  function trocarMatricula() {
    const fazer = () => {
      setMatricula("");
      setMatDigitada("");
      setMinhas(null);
      setErroMat(null);
      setLanc(LANC_VAZIO);
      setResultado(null);
      setMeus({ lista: null, carregando: false, erro: null });
      padroes.current = {};
      voltarDataAntesDeAbrir();
      setAba("lancar");
      irPara(1);
    };
    if (temNaoGravado) {
      setPergunta({
        titulo: "Trocar a matrícula?",
        texto: `O lançamento da O.S. ${lanc.os} ainda não foi gravado e será descartado.`,
        botao: "Trocar",
        perigo: true,
        acao: fazer,
      });
    } else fazer();
  }

  // ------------------------------------------------------------------ passo 2: O.S. e operação

  function escolherOperacao(ordem, op) {
    if (lanc.os === ordem.os && lanc.opCod === op.cod) return irPara(3);
    const fazer = () => {
      // padrões da O.S. nova só onde o campo está em branco ou ainda com o padrão da anterior
      const novos = { atividade: op.ds ?? "", solicitante: ordem.resp ?? "", etapaCod: op.etapaCod ?? "", modelo: op.modelo ?? "", tipoAplicacao: "" };
      // cópia dos padrões da anterior: o React pode calcular a função do setLanc só na próxima renderização, quando
      // padroes.current já é o da operação nova
      const anteriores = padroes.current;
      setLanc((l) => {
        const s = { ...l.servico };
        for (const [k, v] of Object.entries(novos)) if (!s[k] || s[k] === anteriores[k]) s[k] = v;
        return { ...l, os: ordem.os, opCod: op.cod, marcas: {}, extras: [], pendentes: null, servico: s };
      });
      padroes.current = novos;
      setRascunho(null);
      setMsg(null);
      irPara(3);
    };
    const n = Object.keys(lanc.marcas).length + lanc.extras.length;
    if (n > 0 && !resultado) {
      setPergunta({
        titulo: "Trocar a O.S. / operação?",
        texto: `${plural(n, "talhão marcado", "talhões marcados")} da O.S. ${lanc.os} (operação ${lanc.opCod}) ${n === 1 ? "será desmarcado" : "serão desmarcados"}.`,
        botao: "Trocar",
        acao: fazer,
      });
    } else fazer();
  }

  const ordensFiltradas = useMemo(() => {
    const lista = minhas?.ordens ?? [];
    const q = filtroOS.trim().toLowerCase();
    if (!q) return lista;
    return lista.filter(
      (o) =>
        String(o.os).toLowerCase().includes(q) ||
        (o.fazendas ?? []).some((f) => `${f.cod} ${f.nm ?? ""}`.toLowerCase().includes(q)) ||
        (o.operacoes ?? []).some((op) => `${op.cod} ${op.ds ?? ""}`.toLowerCase().includes(q)),
    );
  }, [minhas, filtroOS]);

  // ------------------------------------------------------------------ passo 3: talhões

  const marcar = useCallback((t, sim) => {
    setLanc((l) => {
      const marcas = { ...l.marcas };
      if (sim) marcas[chaveDe(t)] = areaCampo(t.saldo);
      else delete marcas[chaveDe(t)];
      return { ...l, marcas };
    });
  }, []);

  const marcarVarios = useCallback((lista, sim) => {
    setLanc((l) => {
      const marcas = { ...l.marcas };
      for (const t of lista) {
        if (sim && marcas[chaveDe(t)] === undefined) marcas[chaveDe(t)] = areaCampo(t.saldo);
        else if (!sim) delete marcas[chaveDe(t)];
      }
      return { ...l, marcas };
    });
  }, []);

  const mudarArea = useCallback((k, v) => setLanc((l) => ({ ...l, marcas: { ...l.marcas, [k]: v } })), []);
  const mudarAreaExtra = useCallback((chave, v) => setLanc((l) => ({ ...l, extras: l.extras.map((x) => (x.chave === chave ? { ...x, area: v } : x)) })), []);
  const removerExtra = useCallback((chave) => setLanc((l) => ({ ...l, extras: l.extras.filter((x) => x.chave !== chave) })), []);
  const incluirExtras = useCallback((itens) => {
    setLanc((l) => {
      const novos = itens.filter((x) => !l.extras.some((e) => mesmoTalhao(e, x)));
      return { ...l, extras: [...l.extras, ...novos.map((x) => ({ ...x, chave: novaChaveExtra() }))] };
    });
  }, []);

  // ------------------------------------------------------------------ passo 4: dados do serviço

  const upd = useCallback((p) => setLanc((l) => ({ ...l, servico: { ...l.servico, ...p } })), []);
  const s = lanc.servico;
  const op = osInfoValido ? osInfo.operacao : null;
  const faltaDepois = osInfoValido
    ? round2(
        talhoesOS.reduce((a, t) => {
          const v = lerNumero(lanc.marcas[chaveDe(t)]);
          return a + Math.max(0, (t.saldo ?? 0) - (v > 0 ? v : 0));
        }, 0),
      )
    : null;

  // ------------------------------------------------------------------ gravar

  async function gravar(confirmar = false) {
    setMsg(null);
    if (!pode) return setMsg({ texto: "Seu perfil é somente leitura: dá para consultar, mas não gravar.", erro: true });
    if (!matAtual) return irPara(1);
    if (!osInfoValido) return setMsg({ texto: "Escolha a O.S. e a operação e espere os talhões carregarem.", erro: true });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dt)) {
      irPara(4);
      return setMsg({ texto: "Informe a data da operação.", erro: true });
    }
    if (linhas.length === 0) {
      irPara(3);
      return setMsg({ texto: "Marque pelo menos um talhão realizado.", erro: true });
    }
    const ruim = linhas.find((l) => !(lerNumero(l.texto) > 0));
    if (ruim) {
      irPara(3);
      return setMsg({ texto: `Informe a área realizada do ${rotTalhao(ruim.tlh)} da fazenda ${ruim.propCod} (ou desmarque o talhão).`, erro: true });
    }
    // "1.500" na calda é milhar (o teclado do Android tem o ponto); "0.035" e "12.5" continuam decimais
    const vazao = lerNumeroComMilhar(s.vazaoRec);
    const calda = lerNumeroComMilhar(s.volCalda);
    if (Number.isNaN(vazao) || Number.isNaN(calda) || vazao < 0 || calda < 0) {
      irPara(4);
      return setMsg({ texto: "Confira a Calda/Dose recomendada e a Calda/Insumo gasto: número inválido.", erro: true });
    }
    if (s.modelo !== "mecanizada" && s.modelo !== "manual") {
      irPara(4);
      return setMsg({ texto: "Escolha o modelo do texto: Mecanizada ou Manual.", erro: true });
    }
    setGravando(true);
    const { ok, status, json } = await enviar({
      ...(lanc.id ? { id: lanc.id, boletim: lanc.boletim } : {}),
      dt,
      os: lanc.os,
      opCod: lanc.opCod,
      modelo: s.modelo,
      atividade: s.atividade.trim(),
      solicitante: s.solicitante.trim(),
      apontador: nomePessoa || nomeUsuario,
      matricula: matAtual,
      etapaCod: s.etapaCod,
      tipoAplicacao: s.tipoAplicacao.trim(),
      equipe: s.equipe.trim(),
      eqp: s.eqp.trim(),
      numEquipamentos: Number(s.numEquipamentos || 0),
      numPessoas: Number(s.numPessoas || 0),
      vazaoRec: vazao,
      volCalda: calda,
      unCalda: s.unCalda === "kg" ? "kg" : "L",
      statusOS: s.statusOS,
      obs: s.obs.trim(),
      talhoes: linhas.map((l) => ({ propCod: l.propCod, tlh: l.tlh, area: lerNumero(l.texto) })),
      confirmar,
    });
    if (status === 409 && json.precisaConfirmar) {
      setGravando(false);
      setConfirmacao({ error: json.error ?? "", avisos: Array.isArray(json.avisos) ? json.avisos : [] });
      return;
    }
    if (!ok) {
      setGravando(false);
      return setMsg({ texto: json.error ?? "Não foi possível gravar.", erro: true });
    }
    let texto = typeof json.texto === "string" ? json.texto : "";
    if (!texto && json.boletim) texto = (await obter({ bol: String(json.boletim) })).json?.texto ?? "";
    setGravando(false);
    cacheBol.current.delete(json.boletim);
    limparRascunho();
    setResultado({
      id: json.id,
      boletim: json.boletim,
      texto,
      avisos: Array.isArray(json.avisos) ? json.avisos : [],
      editado: !!lanc.id,
      os: lanc.os,
      op: op ? `${op.cod} - ${op.ds}` : lanc.opCod,
      area: total,
      dt,
    });
    focarPasso.current = true;
    // o que falta das O.S. muda com o lançamento
    buscarOS(matAtual, dt);
  }

  function novoLancamento() {
    limparRascunho();
    setResultado(null);
    setLanc(LANC_VAZIO);
    // a mesma O.S. de novo traz os talhões com o que acabou de ser lançado
    setOsInfo(null);
    setOsInfoChave("");
    setMsg(null);
    padroes.current = {};
    // mantém a data do lançamento; depois de editar um boletim (ou terminar um rascunho) de outro dia, volta à de antes
    voltarDataAntesDeAbrir();
    irPara(2);
  }

  // ------------------------------------------------------------------ meus lançamentos / edição

  const carregarMeus = useCallback(async () => {
    if (!matAtual || !hoje) return;
    const seq = ++seqMeus.current;
    setMeus((m) => ({ ...m, carregando: true, erro: null }));
    const { ok, json } = await obter({ meus: "1", mat: matAtual, de: addDays(hoje, -(diasMeus - 1)), ate: hoje });
    if (seq !== seqMeus.current) return;
    if (!ok) setMeus({ lista: null, carregando: false, erro: json.error ?? "Não foi possível carregar os lançamentos." });
    else setMeus({ lista: Array.isArray(json.apontamentos) ? json.apontamentos : [], carregando: false, erro: null });
  }, [matAtual, hoje, diasMeus]);

  useEffect(() => {
    if (aba === "meus") carregarMeus();
  }, [aba, carregarMeus]);

  /** Boletim com o texto do WhatsApp (o texto fica guardado nesta visita; `fresco` busca de novo, para editar). */
  async function carregarBoletim(bol, fresco = false) {
    if (!fresco && cacheBol.current.has(bol)) return cacheBol.current.get(bol);
    setAbrindo(bol);
    const { ok, json } = await obter({ bol: String(bol) });
    setAbrindo(null);
    if (!ok || !json.apontamento) {
      setMsg({ texto: json.error ?? `Não foi possível abrir o boletim nº ${bol}.`, erro: true });
      return null;
    }
    const r = { apontamento: json.apontamento, texto: typeof json.texto === "string" ? json.texto : "" };
    cacheBol.current.set(bol, r);
    return r;
  }

  async function editarBoletim(bol) {
    if (!pode) return;
    setMsg(null);
    const r = await carregarBoletim(bol, true);
    if (!r) return;
    const a = r.apontamento;
    const fazer = () => {
      limparRascunho();
      padroes.current = {};
      setResultado(null);
      setDetalhe(null);
      if (dtAntesDeAbrir.current === null) dtAntesDeAbrir.current = dt;
      setDt(a.dt);
      setLanc({ ...LANC_VAZIO, id: a.id, boletim: a.boletim, os: String(a.os ?? ""), opCod: String(a.opCod ?? ""), pendentes: a.talhoes ?? [], servico: servicoDoBoletim(a) });
      // força recarregar os talhões mesmo se for a mesma O.S. (agora sem contar este boletim) — e mesmo se for o
      // boletim que já está aberto: aí a chave da busca não muda e só a nova tentativa faz o efeito buscar de novo
      setOsInfoChave("");
      setErroTalhoes(null);
      setTentativa((n) => n + 1);
      setAba("lancar");
      irPara(3);
    };
    if (temNaoGravado) {
      const mesmo = lanc.id === a.id;
      setPergunta({
        titulo: mesmo ? "Abrir de novo o boletim?" : "Abrir outro lançamento?",
        texto: mesmo
          ? `As alterações do boletim nº ${lanc.boletim} que ainda não foram gravadas serão descartadas.`
          : `O lançamento da O.S. ${lanc.os} ainda não foi gravado e será descartado.`,
        botao: "Abrir para editar",
        perigo: true,
        acao: fazer,
      });
    } else fazer();
  }

  async function verTexto(item) {
    setMsg(null);
    const r = await carregarBoletim(item.boletim);
    if (!r) return;
    focarPasso.current = true;
    setDetalhe(r);
  }

  /** Copiar direto da lista; se o navegador não deixar (a busca do texto passou do tempo do toque), abre o texto. */
  async function copiarDaLista(item) {
    setMsg(null);
    const r = await carregarBoletim(item.boletim);
    if (!r) return;
    if (await copiarParaAreaDeTransferencia(r.texto)) setMsg({ texto: `Texto do boletim nº ${item.boletim} copiado. Abra o grupo do WhatsApp e cole.`, erro: false });
    else {
      focarPasso.current = true;
      setDetalhe(r);
    }
  }

  // ------------------------------------------------------------------ tela

  // texto do WhatsApp na tela (resultado da gravação ou boletim aberto em Meus lançamentos): rodapé com Copiar e Enviar
  const textoAberto = aba === "lancar" && resultado ? (resultado.texto ?? "") : aba === "meus" && detalhe ? (detalhe.texto ?? "") : null;
  const alcancavel = (n) => n === 1 || (n === 2 && !!minhas) || (n >= 3 && !!lanc.os && !!minhas);
  const escolhaDaLista = minhas?.ordens?.find((o) => o.os === lanc.os);
  const opDaLista = escolhaDaLista?.operacoes?.find((o) => o.cod === lanc.opCod);

  const info = (
    <>
      {!pode && <Selo title="Seu perfil pode consultar, mas não gravar">Somente leitura</Selo>}
      {matAtual && <Selo>{nomePessoa ? `${nomePessoa} · mat. ${matAtual}` : `Matrícula ${matAtual}`}</Selo>}
    </>
  );

  return (
    <Pagina>
      <div className="hidden md:block">
        <CabecalhoPagina titulo="Lançamento Mobile" info={info} />
      </div>
      <div className="flex-shrink-0 border-b border-line bg-card px-4 pt-2 md:border-b-0 md:bg-transparent md:px-6 md:pt-0">
        <div className="mx-auto w-full max-w-xl">
          <h1 className="sr-only md:hidden">Lançamento Mobile</h1>
          <div role="tablist" aria-label="Lançamento Mobile" className="grid grid-cols-2 gap-1 rounded-lg bg-surface p-1 md:border md:border-line">
            {[
              { id: "lancar", rotulo: "Lançar" },
              { id: "meus", rotulo: "Meus lançamentos" },
            ].map((a) => (
              <button
                key={a.id}
                type="button"
                role="tab"
                id={`lm-aba-${a.id}`}
                aria-selected={aba === a.id}
                aria-controls={`lm-painel-${a.id}`}
                onClick={() => {
                  if (a.id === aba && !detalhe) return;
                  focarPasso.current = true;
                  setDetalhe(null);
                  setAba(a.id);
                }}
                className={`h-10 rounded-md text-[14.5px] font-semibold ${aba === a.id ? "bg-card text-ink shadow-card" : "text-muted hover:text-ink"}`}
              >
                {a.rotulo}
              </button>
            ))}
          </div>
          {aba === "lancar" && !resultado && (
            <ol aria-label="Passos do lançamento" className="mt-2 grid grid-cols-4 gap-1 pb-2">
              {PASSOS.map((p) => {
                const atual = passo === p.n;
                const ok = alcancavel(p.n);
                const feito = ok && p.n < passo;
                return (
                  <li key={p.n}>
                    <button
                      type="button"
                      disabled={!ok}
                      aria-current={atual ? "step" : undefined}
                      onClick={() => irPara(p.n)}
                      className={`flex h-10 w-full items-center justify-center gap-1.5 rounded-lg text-[13px] font-medium disabled:opacity-45 ${
                        atual ? "bg-navy-900 text-white dark:bg-crv-acao" : feito ? "text-ink hover:bg-hover" : "text-muted hover:bg-hover"
                      }`}
                    >
                      <span
                        aria-hidden="true"
                        className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold ${
                          atual ? "bg-white/20" : feito ? "bg-good-50 text-good-600" : "border border-line"
                        }`}
                      >
                        {feito ? "✓" : p.n}
                      </span>
                      {p.rotulo}
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
          {aba === "meus" && <div className="pb-2" />}
          {msg && (
            <div className="pb-2">
              <Aviso msg={msg} onFechar={() => setMsg(null)} />
            </div>
          )}
        </div>
      </div>

      <CorpoPagina>
        <div
          role="tabpanel"
          id={`lm-painel-${aba}`}
          aria-labelledby={`lm-aba-${aba}`}
          className="mx-auto w-full max-w-xl space-y-3 pb-4 pt-2"
        >
          {aba === "meus" && detalhe ? (
            <VistaTexto
              tituloRef={tituloPasso}
              titulo={`Boletim nº ${detalhe.apontamento.boletim}`}
              linha={[
                fmtDateBR(detalhe.apontamento.dt),
                `O.S. ${detalhe.apontamento.os}`,
                `${detalhe.apontamento.opCod}${detalhe.apontamento.opDs ? ` - ${detalhe.apontamento.opDs}` : ""}`,
                Number.isFinite(detalhe.apontamento.areaTotal) ? `${nf(detalhe.apontamento.areaTotal)} ha` : "",
                detalhe.apontamento.statusOS ?? "",
              ]
                .filter(Boolean)
                .join(" · ")}
              boletim={detalhe.apontamento.boletim}
              texto={detalhe.texto}
              caixaRef={caixaTexto}
              acoes={
                <>
                  <button
                    type="button"
                    className={`${BOTAO} !h-12`}
                    onClick={() => {
                      focarPasso.current = true;
                      setDetalhe(null);
                    }}
                  >
                    Voltar à lista
                  </button>
                  <button
                    type="button"
                    className={`${BOTAO} !h-12`}
                    onClick={() => editarBoletim(detalhe.apontamento.boletim)}
                    disabled={!pode || abrindo !== null}
                  >
                    <IconEditar size={16} /> {abrindo === detalhe.apontamento.boletim ? "Abrindo…" : "Editar"}
                  </button>
                </>
              }
            />
          ) : aba === "meus" ? (
            <MeusLancamentos
              tituloRef={tituloPasso}
              mat={matAtual}
              nome={nomePessoa}
              pode={pode}
              dias={diasMeus}
              onDias={setDiasMeus}
              estado={meus}
              abrindo={abrindo}
              onRecarregar={carregarMeus}
              onCopiar={copiarDaLista}
              onVerTexto={verTexto}
              onEditar={(a) => editarBoletim(a.boletim)}
              onInformarMatricula={() => {
                setAba("lancar");
                irPara(1);
              }}
            />
          ) : resultado ? (
            <VistaTexto
              tituloRef={tituloPasso}
              titulo={`${resultado.editado ? "Alterado" : "Lançado"} — Boletim nº ${resultado.boletim}`}
              linha={`O.S. ${resultado.os} · ${resultado.op} · ${fmtDateBR(resultado.dt)} · ${nf(resultado.area)} ha`}
              sucesso
              avisos={resultado.avisos}
              boletim={resultado.boletim}
              texto={resultado.texto}
              caixaRef={caixaTexto}
              acoes={
                <>
                  <button
                    type="button"
                    className={`${BOTAO} !h-12 leading-tight`}
                    onClick={() => editarBoletim(resultado.boletim)}
                    disabled={!pode || abrindo !== null}
                  >
                    <IconEditar size={16} /> {abrindo === resultado.boletim ? "Abrindo…" : "Editar este lançamento"}
                  </button>
                  <button type="button" className={`${BOTAO} !h-12 leading-tight`} onClick={novoLancamento}>
                    <IconMais size={16} /> Novo lançamento
                  </button>
                </>
              }
            />
          ) : passo === 1 ? (
            <section aria-labelledby="lm-p1" className="space-y-3">
              <h2 id="lm-p1" ref={tituloPasso} tabIndex={-1} className={TITULO_PASSO}>
                Quem está lançando
              </h2>
              <form onSubmit={buscarMatricula} className="caixa-form space-y-3" noValidate>
                <div>
                  <label htmlFor="lm-mat" className={ROTULO}>
                    Matrícula ou código
                  </label>
                  <input
                    id="lm-mat"
                    value={matDigitada}
                    onChange={(e) => setMatDigitada(e.target.value.replace(/\s/g, "").slice(0, 20))}
                    inputMode="numeric"
                    autoComplete="off"
                    enterKeyHint="search"
                    placeholder="Ex.: 601448"
                    aria-describedby="lm-mat-dica"
                    className={`${CAMPO} text-[18px] font-semibold tabular`}
                  />
                  <p id="lm-mat-dica" className="mt-1 text-[12px] text-muted">
                    Fica lembrada neste aparelho. Aparecem só as O.S. em aberto que estão no seu nome.
                  </p>
                </div>
                <button type="submit" className={`${BOTAO_PRIMARIO} w-full`} disabled={buscandoOS}>
                  {buscandoOS ? "Buscando…" : "Buscar minhas O.S."}
                </button>
              </form>
              {erroMat && <Aviso msg={{ texto: erroMat, erro: true }} onFechar={() => setErroMat(null)} />}
              {minhas && !buscandoOS && (
                <div className={`${CARTAO} p-3`}>
                  <Pessoa nome={nomePessoa} mat={minhas.mat} area={minhas.responsavel?.area} />
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button type="button" className={BOTAO} onClick={trocarMatricula}>
                      Trocar matrícula
                    </button>
                    <button type="button" className={`${BOTAO_PRIMARIO} !h-11 !text-[14.5px]`} onClick={() => irPara(2)}>
                      Minhas O.S. ({minhas.ordens.length})
                    </button>
                  </div>
                </div>
              )}
              {mostrarRascunho && <BannerRascunho r={rascunho} onContinuar={continuarRascunho} onDescartar={limparRascunho} />}
            </section>
          ) : passo === 2 ? (
            <section aria-labelledby="lm-p2" className="space-y-3">
              <div className="flex items-center gap-2">
                <h2 id="lm-p2" ref={tituloPasso} tabIndex={-1} className={`${TITULO_PASSO} min-w-0 flex-1`}>
                  Minhas O.S. em aberto
                </h2>
                <button
                  type="button"
                  className={BOTAO_MENOR}
                  onClick={() => minhas && buscarOS(minhas.mat, dt)}
                  disabled={buscandoOS || !minhas}
                  aria-label="Atualizar as O.S."
                >
                  <IconAtualizar size={16} /> Atualizar
                </button>
              </div>
              {/* quem lança e a data do lançamento (o que falta e o último apontamento são até ela) */}
              <div className={`${CARTAO} divide-y divide-line`}>
                {minhas && (
                  <div className="flex items-center gap-3 p-3">
                    <div className="min-w-0 flex-1">
                      <Pessoa nome={nomePessoa} mat={minhas.mat} area={minhas.responsavel?.area} />
                    </div>
                    <button type="button" className={BOTAO_MENOR} onClick={trocarMatricula}>
                      Trocar
                    </button>
                  </div>
                )}
                <div className="flex items-center gap-3 p-3">
                  <label htmlFor="lm-dt" className="w-24 flex-shrink-0 text-[13px] font-medium leading-tight text-muted">
                    Data da operação
                  </label>
                  <input
                    id="lm-dt"
                    type="date"
                    value={dt}
                    max={hoje || undefined}
                    onChange={(e) => e.target.value && setDt(e.target.value)}
                    aria-describedby="lm-dt-dica"
                    className={`${CAMPO} min-w-0 flex-1`}
                  />
                  <span id="lm-dt-dica" className="sr-only">
                    O que falta fazer e o último apontamento são até esta data.
                  </span>
                </div>
              </div>
              {mostrarRascunho && <BannerRascunho r={rascunho} onContinuar={continuarRascunho} onDescartar={limparRascunho} />}
              {(minhas?.ordens.length ?? 0) > 3 && (
                <div>
                  <label htmlFor="lm-filtro" className="sr-only">
                    Filtrar as O.S.
                  </label>
                  <input
                    id="lm-filtro"
                    type="search"
                    value={filtroOS}
                    onChange={(e) => setFiltroOS(e.target.value)}
                    placeholder="Filtrar por O.S., fazenda ou operação"
                    autoComplete="off"
                    enterKeyHint="search"
                    className={CAMPO}
                  />
                </div>
              )}
              <div aria-live="polite" aria-busy={buscandoOS}>
                {buscandoOS && <p className="py-6 text-center text-[14px] text-muted">Buscando as O.S.…</p>}
                {!buscandoOS && erroMat && <Aviso msg={{ texto: erroMat, erro: true }} />}
                {!buscandoOS && minhas && minhas.ordens.length === 0 && !erroMat && (
                  <div className={`${CARTAO} px-4 py-8 text-center`}>
                    <p className="text-[15px] font-semibold text-ink">Nenhuma O.S. em aberto</p>
                    <p className="mx-auto mt-1 max-w-sm text-[13px] text-muted">
                      Não há O.S. em aberto no nome desta matrícula até {fmtDateBR(dt)}. Confira a data ou fale com o planejamento.
                    </p>
                  </div>
                )}
                {!buscandoOS && minhas && minhas.ordens.length > 0 && ordensFiltradas.length === 0 && (
                  <p className="py-6 text-center text-[13.5px] text-muted">Nenhuma O.S. com “{filtroOS}”.</p>
                )}
              </div>
              {!buscandoOS && (
                <div className="space-y-3">
                  {ordensFiltradas.map((o) => (
                    <CartaoOS key={o.os} ordem={o} escolhida={{ os: lanc.os, opCod: lanc.opCod }} onEscolher={escolherOperacao} />
                  ))}
                </div>
              )}
            </section>
          ) : passo === 3 ? (
            <section aria-labelledby="lm-p3" className="space-y-3">
              <h2 id="lm-p3" ref={tituloPasso} tabIndex={-1} className={TITULO_PASSO}>
                Talhões realizados
              </h2>
              <ResumoEscolha
                os={lanc.os}
                opCod={lanc.opCod}
                opDs={op?.ds ?? opDaLista?.ds ?? ""}
                situacao={osInfoValido ? osInfo.situacao : escolhaDaLista?.situacao}
                dt={dt}
                info={osInfoValido ? osInfo : null}
                talhoes={talhoesOS}
                onTrocar={() => irPara(2)}
              />
              {lanc.id && (
                <p className="rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-[13px] text-brand-700">
                  Editando o boletim nº {lanc.boletim}. O “Já apontado” e o “Falta” não contam este boletim.
                </p>
              )}
              {(carregandoTalhoes || lanc.pendentes) && !erroTalhoes && (
                <p className="py-6 text-center text-[14px] text-muted" aria-live="polite">
                  Carregando os talhões da O.S.…
                </p>
              )}
              {erroTalhoes && (
                <div className="space-y-2">
                  <Aviso msg={{ texto: erroTalhoes, erro: true }} />
                  <button type="button" className={`${BOTAO} w-full`} onClick={() => setTentativa((n) => n + 1)}>
                    <IconAtualizar size={16} /> Tentar de novo
                  </button>
                </div>
              )}
              {osInfoValido && (
                <>
                  <label className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-lg px-1 text-[14px] text-ink">
                    <input
                      type="checkbox"
                      checked={soFalta}
                      onChange={(e) => setSoFalta(e.target.checked)}
                      className="h-5 w-5 flex-shrink-0 accent-[#23396B] dark:accent-[#7FA8E8]"
                    />
                    Mostrar só os talhões que faltam fazer
                  </label>
                  {talhoesOS.length === 0 && (
                    <p className={`${CARTAO} px-4 py-6 text-center text-[13.5px] text-muted`}>Esta operação não tem talhões na O.S. Inclua abaixo os realizados.</p>
                  )}
                  {grupos.map((g) => (
                    <GrupoFazenda key={g.propCod} grupo={g} marcas={lanc.marcas} soFalta={soFalta} onMarcar={marcar} onArea={mudarArea} onMarcarVarios={marcarVarios} />
                  ))}
                  <ListaForaDaOS extras={lanc.extras} onArea={mudarAreaExtra} onRemover={removerExtra} />
                  <IncluirForaDaOS
                    dt={dt}
                    talhoesOS={talhoesOS}
                    marcas={lanc.marcas}
                    extras={lanc.extras}
                    onIncluir={incluirExtras}
                    onMarcarDaOS={marcarVarios}
                    onAreaDaOS={mudarArea}
                  />
                </>
              )}
            </section>
          ) : (
            <section aria-labelledby="lm-p4" className="space-y-3">
              <h2 id="lm-p4" ref={tituloPasso} tabIndex={-1} className={TITULO_PASSO}>
                Dados do serviço
              </h2>
              <ResumoEscolha
                os={lanc.os}
                opCod={lanc.opCod}
                opDs={op?.ds ?? opDaLista?.ds ?? ""}
                situacao={osInfoValido ? osInfo.situacao : escolhaDaLista?.situacao}
                dt={dt}
                onTrocar={() => irPara(2)}
                compacto
              />
              <DadosServico
                s={s}
                upd={upd}
                dt={dt}
                hoje={hoje}
                onDt={setDt}
                op={op}
                opcoes={opcoes}
                faltaDepois={faltaDepois}
                nTalhoes={linhas.length}
              />
              {!pode && <Aviso msg={{ texto: "Seu perfil é somente leitura: dá para conferir os dados, mas não gravar.", erro: true }} />}
            </section>
          )}
        </div>
      </CorpoPagina>

      {aba === "lancar" && !resultado && passo >= 3 && (
        <div className="print-hide flex-shrink-0 border-t border-line bg-card px-4 py-2.5 md:px-6">
          <div className="mx-auto flex w-full max-w-xl items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12px] leading-tight text-muted">Área total · {plural(linhas.length, "talhão", "talhões")}</div>
              <div className="font-display text-[25px] font-semibold leading-tight tabular text-ink">
                {nf(total)} <span className="font-sans text-[13px] font-normal text-muted">ha</span>
              </div>
            </div>
            {passo === 3 ? (
              <button type="button" className={BOTAO_PRIMARIO} onClick={() => irPara(4)} disabled={!osInfoValido}>
                Dados do serviço <IconSetaDireita size={18} />
              </button>
            ) : (
              <button type="button" className={BOTAO_PRIMARIO} onClick={() => gravar(false)} disabled={gravando || !pode || !osInfoValido}>
                <IconSalvar size={18} />
                {gravando ? "Gravando…" : lanc.id ? "Gravar alteração" : "Gravar"}
              </button>
            )}
          </div>
        </div>
      )}

      {textoAberto !== null && (
        <div className="print-hide flex-shrink-0 border-t border-line bg-card px-4 py-2.5 md:px-6">
          <div className="mx-auto w-full max-w-xl">
            <p
              aria-live="polite"
              className={`text-center text-[12.5px] font-medium leading-snug ${copia === "falhou" ? "text-amber-600" : "text-good-600"} ${copia ? "mb-1.5" : ""}`}
            >
              {copia ? MSG_COPIA[copia] : ""}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                className={`${BOTAO_PRIMARIO} !px-2 !text-[15px] leading-tight`}
                onClick={() => copiar(textoAberto, caixaTexto.current)}
                disabled={!textoAberto}
              >
                <span className="hidden min-[380px]:inline-flex" aria-hidden="true">
                  <IconCopiar size={18} />
                </span>
                {copia === "ok" ? "Copiado!" : "Copiar texto"}
              </button>
              <button
                type="button"
                className={`${BOTAO_WHATSAPP} !px-2 !text-[15px] leading-tight`}
                onClick={() => enviarNoWhatsapp(textoAberto)}
                disabled={!textoAberto}
              >
                <span className="hidden min-[380px]:inline-flex" aria-hidden="true">
                  <IconCompartilhar size={18} />
                </span>
                Enviar no WhatsApp
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmacao && (
        <JanelaConfirmar
          titulo="Avisos antes de gravar"
          texto={[confirmacao.error, ...confirmacao.avisos.map((a) => `• ${a.texto}`)].filter(Boolean).join("\n")}
          botao="Gravar assim mesmo"
          onCancelar={() => setConfirmacao(null)}
          onConfirmar={() => {
            setConfirmacao(null);
            gravar(true);
          }}
        />
      )}
      {pergunta && (
        <JanelaConfirmar
          titulo={pergunta.titulo}
          texto={pergunta.texto}
          botao={pergunta.botao}
          perigo={pergunta.perigo}
          onCancelar={() => setPergunta(null)}
          onConfirmar={() => {
            const f = pergunta.acao;
            setPergunta(null);
            f();
          }}
        />
      )}
    </Pagina>
  );
}

/* ---------------------------------------------------------------------------------------------------------------- */

function Pessoa({ nome, mat, area }) {
  const iniciais =
    String(nome || "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0])
      .join("")
      .toUpperCase() || "#";
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span aria-hidden="true" className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-navy-900 text-[14px] font-semibold text-white dark:bg-crv-acao">
        {iniciais}
      </span>
      <div className="min-w-0">
        <div className="truncate text-[15px] font-semibold text-ink">{nome || "Responsável sem nome no cadastro"}</div>
        <div className="truncate text-[12.5px] text-muted">
          Mat. {mat}
          {area ? ` · ${area}` : ""}
        </div>
      </div>
    </div>
  );
}

function BannerRascunho({ r, onContinuar, onDescartar }) {
  const n = Object.keys(r.lanc.marcas ?? {}).length + (r.lanc.extras ?? []).length;
  return (
    <div role="status" className="rounded-lg border border-amber-500/40 bg-amber-50 p-3 text-[13px] text-amber-600">
      <p className="font-semibold">Lançamento não gravado neste aparelho</p>
      <p className="mt-0.5">
        {r.lanc.id ? `Edição do boletim nº ${r.lanc.boletim}` : "Lançamento novo"} · O.S. {r.lanc.os} · operação {r.lanc.opCod} · {fmtDateBR(r.dt)}
        {n ? ` · ${plural(n, "talhão", "talhões")}` : ""}
      </p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button type="button" className={BOTAO} onClick={onDescartar}>
          Descartar
        </button>
        <button type="button" className={`${BOTAO_PRIMARIO} !h-11 !text-[14.5px]`} onClick={onContinuar}>
          Continuar
        </button>
      </div>
    </div>
  );
}

function SeloSituacao({ s }) {
  if (!s) return null;
  const cor = /liber/i.test(s) ? "bg-brand-50 text-brand-700" : /encerr/i.test(s) ? "bg-surface text-muted" : "bg-good-50 text-good-600";
  return <span className={`rounded-full px-2 py-0.5 text-[11.5px] font-semibold ${cor}`}>{s}</span>;
}

function CartaoOS({ ordem, escolhida, onEscolher }) {
  const pct = ordem.areaRec > 0 ? Math.min(100, Math.max(0, ((ordem.ja ?? 0) / ordem.areaRec) * 100)) : 0;
  const fazendas = ordem.fazendas ?? [];
  return (
    <article className={`${CARTAO} overflow-hidden`} aria-label={`O.S. ${ordem.os}`}>
      <div className="px-3.5 pb-2.5 pt-3">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h3 className="font-display text-[21px] font-semibold leading-tight text-ink">O.S. {ordem.os}</h3>
              <SeloSituacao s={ordem.situacao} />
            </div>
            <p className="mt-0.5 text-[12.5px] text-muted">
              {[ordem.dtOs && `Desde ${fmtDateBR(ordem.dtOs)}`, ordem.prevFim && `prev. fim ${fmtDateBR(ordem.prevFim)}`].filter(Boolean).join(" · ")}
            </p>
          </div>
          <div className="flex-shrink-0 text-right">
            <div className="text-[11.5px] text-muted">Falta</div>
            <div className="font-display text-[20px] font-semibold leading-tight tabular text-ink">
              {nf(ordem.saldo ?? 0)} <span className="font-sans text-[11.5px] font-normal text-muted">ha</span>
            </div>
          </div>
        </div>
        {fazendas.length > 0 && (
          <p className="mt-1 line-clamp-2 text-[13px] text-ink">{fazendas.map((f) => `${f.cod}${f.nm ? ` - ${f.nm}` : ""}`).join(" · ")}</p>
        )}
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface" aria-hidden="true">
          <div className="h-full rounded-full bg-crv-verde" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-1 text-[11.5px] text-muted tabular">
          {nf(ordem.ja ?? 0)}
          {ordem.areaRec > 0 ? ` de ${nf(ordem.areaRec)}` : ""} ha apontados
        </p>
      </div>
      <ul className="border-t border-line">
        {(ordem.operacoes ?? []).map((op) => {
          const sel = escolhida.os === ordem.os && escolhida.opCod === op.cod;
          return (
            <li key={op.cod} className="border-b border-line last:border-b-0">
              <button
                type="button"
                onClick={() => onEscolher(ordem, op)}
                aria-current={sel ? "true" : undefined}
                className={`flex min-h-[64px] w-full items-center gap-3 px-3.5 py-2.5 text-left hover:bg-hover ${sel ? "bg-[rgb(var(--form-fundo))]" : ""}`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-[14.5px] font-semibold leading-snug text-ink">
                    {op.cod} - {op.ds || "sem descrição"}
                  </span>
                  <span className="block text-[12.5px] text-muted">
                    {[op.etapaDs, plural(op.nTalhoes ?? 0, "talhão", "talhões"), rotModelo(op.modelo)].filter(Boolean).join(" · ")}
                  </span>
                  <span className="mt-0.5 block text-[12.5px] text-ink">
                    Falta <b className="font-semibold tabular">{nf(op.saldo ?? 0)} ha</b>
                    {op.areaRec > 0 ? ` de ${nf(op.areaRec)}` : ""}
                    {op.ultimo && <span className="text-muted"> · último {textoUltimo({ ...op.ultimo, area: undefined })}</span>}
                  </span>
                </span>
                {sel && <span className="sr-only">(escolhida)</span>}
                <IconSetaDireita size={18} className="flex-shrink-0 text-muted" />
              </button>
            </li>
          );
        })}
      </ul>
    </article>
  );
}

function Numero({ rotulo, valor, cor = "text-ink" }) {
  return (
    <div className="rounded-lg bg-surface px-2 py-1.5 text-center">
      <div className="text-[11.5px] text-muted">{rotulo}</div>
      <div className={`font-display text-[18px] font-semibold leading-tight tabular ${cor}`}>{valor}</div>
    </div>
  );
}

function ResumoEscolha({ os, opCod, opDs, situacao, dt, info, talhoes, onTrocar, compacto = false }) {
  const tot = info && talhoes ? totaisDaOS(talhoes) : null;
  const u = info?.ultimoApontamento;
  return (
    <div className={`${CARTAO} p-3`}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-display text-[19px] font-semibold leading-tight text-ink">O.S. {os}</span>
            <SeloSituacao s={situacao} />
            <span className="text-[12.5px] text-muted">{fmtDateBR(dt)}</span>
          </div>
          <div className="text-[14px] font-medium leading-snug text-ink">
            {opCod}
            {opDs ? ` - ${opDs}` : ""}
          </div>
          {!compacto && info?.operacao?.etapaDs && (
            <div className="text-[12.5px] text-muted">
              Etapa {info.operacao.etapaCod} - {info.operacao.etapaDs}
            </div>
          )}
        </div>
        <button type="button" className={BOTAO_MENOR} onClick={onTrocar}>
          Trocar
        </button>
      </div>
      {!compacto && tot && (
        <div className="mt-2 grid grid-cols-3 gap-2">
          <Numero rotulo="Área rec." valor={nf(tot.rec)} />
          <Numero rotulo="Já apontado" valor={nf(tot.ja)} />
          <Numero rotulo="Falta" valor={nf(tot.falta)} cor={tot.falta > 0 ? "text-ink" : "text-good-600"} />
        </div>
      )}
      {!compacto && u && (
        <p className="mt-2 text-[12px] text-muted">
          Último apontamento desta operação: {fmtDateBR(u.dt)} · boletim nº {u.boletim}
          {Number.isFinite(u.area) ? ` · ${nf(u.area)} ha` : ""}
        </p>
      )}
    </div>
  );
}

function CampoArea({ id, valor, onChange, alerta = false, rotuloAria }) {
  return (
    <div className="relative">
      <input
        id={id}
        value={valor}
        onChange={(e) => onChange(soNumero(e.target.value))}
        onFocus={(e) => e.target.select()}
        inputMode="decimal"
        autoComplete="off"
        enterKeyHint="done"
        aria-label={rotuloAria}
        aria-invalid={alerta || undefined}
        className={`${CAMPO} pr-10 text-right font-semibold tabular ${alerta ? "!border-amber-500 bg-amber-50" : ""}`}
      />
      <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[14px] text-muted">
        ha
      </span>
    </div>
  );
}

function GrupoFazenda({ grupo, marcas, soFalta, onMarcar, onArea, onMarcarVarios }) {
  const visiveis = grupo.talhoes.filter((t) => !soFalta || t.saldo > 0 || marcas[chaveDe(t)] !== undefined);
  // "Marcar todos" vale para os que faltam fazer (se nenhum falta, para todos)
  const aFazer = grupo.talhoes.filter((t) => t.saldo > 0);
  const alvo = aFazer.length ? aFazer : grupo.talhoes;
  const todos = alvo.every((t) => marcas[chaveDe(t)] !== undefined);
  const nMarc = grupo.talhoes.filter((t) => marcas[chaveDe(t)] !== undefined).length;
  const sub = round2(
    grupo.talhoes.reduce((a, t) => {
      const v = lerNumero(marcas[chaveDe(t)]);
      return a + (v > 0 ? v : 0);
    }, 0),
  );
  if (visiveis.length === 0) return null;
  const nome = `${grupo.propCod}${grupo.propNm ? ` - ${grupo.propNm}` : ""}`;
  return (
    <section className={`${CARTAO} overflow-hidden`} aria-label={`Fazenda ${nome}`}>
      <header className="flex items-center gap-2 border-b border-line px-3 py-2">
        <span className="flex flex-shrink-0 text-crv-verde" aria-hidden="true">
          <IconTalhao size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[14.5px] font-semibold text-ink">{nome}</h3>
          <div className="text-[12px] text-muted tabular">
            {nMarc} de {grupo.talhoes.length} marcados{nMarc ? ` · ${nf(sub)} ha` : ""}
          </div>
        </div>
        <button type="button" className={BOTAO_MENOR} onClick={() => onMarcarVarios(alvo, !todos)}>
          {todos ? "Desmarcar todos" : "Marcar todos"}
        </button>
      </header>
      <ul className="divide-y divide-line">
        {visiveis.map((t) => (
          <LinhaTalhao key={chaveDe(t)} t={t} valor={marcas[chaveDe(t)]} onMarcar={onMarcar} onArea={onArea} />
        ))}
      </ul>
    </section>
  );
}

function LinhaTalhao({ t, valor, onMarcar, onArea }) {
  const k = chaveDe(t);
  const id = `lm-t-${idSeguro(k)}`;
  const marcado = valor !== undefined;
  const v = marcado ? lerNumero(valor) : null;
  const ref = t.areaRec ?? t.areaTlh;
  const saldo = t.saldo ?? 0;
  const concluido = !(saldo > 0);
  const acima = marcado && v > 0 && v > saldo + 0.001;
  const invalido = marcado && String(valor).trim() !== "" && !(v > 0);
  return (
    <li className={marcado ? "bg-[rgb(var(--form-fundo))]" : ""}>
      <label htmlFor={id} className="flex min-h-[60px] cursor-pointer items-start gap-3 px-3 py-2.5">
        <input
          id={id}
          type="checkbox"
          checked={marcado}
          onChange={(e) => onMarcar(t, e.target.checked)}
          aria-label={`${rotTalhao(t.tlh)} da fazenda ${t.propCod}: falta ${nf(saldo)} ha`}
          className="mt-0.5 h-6 w-6 flex-shrink-0 cursor-pointer accent-[#23396B] dark:accent-[#7FA8E8]"
        />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className={`font-display text-[19px] font-semibold leading-tight ${concluido && !marcado ? "text-muted" : "text-ink"}`}>{rotTalhao(t.tlh)}</span>
            {concluido && <span className="rounded-full bg-good-50 px-2 py-px text-[11px] font-medium text-good-600">Concluído</span>}
            {t.naBase === false && <span className="text-[11px] text-muted">fora da base da safra</span>}
          </span>
          <span className="mt-1 grid grid-cols-3 gap-x-2 text-[12px] leading-tight">
            <span className="block">
              <span className="block text-muted" title={t.areaRec == null ? "A O.S. não tem área recomendada: área do talhão" : undefined}>
                Área rec.
              </span>
              <span className="block tabular text-ink">{ref == null ? "—" : nf(ref)}</span>
            </span>
            <span className="block">
              <span className="block text-muted">Já apont.</span>
              <span className="block tabular text-ink">{nf(t.ja ?? 0)}</span>
            </span>
            <span className="block">
              <span className="block text-muted">Falta</span>
              <span className={`block font-semibold tabular ${concluido ? "text-good-600" : "text-ink"}`}>{nf(saldo)}</span>
            </span>
          </span>
          {t.ultimo && <span className="mt-1 block text-[11.5px] text-muted">Último: {textoUltimo(t.ultimo)}</span>}
        </span>
      </label>
      {marcado && (
        <div className="px-3 pb-3 pl-12">
          <label htmlFor={`${id}-a`} className="mb-1 block text-[12.5px] font-medium text-ink">
            Área realizada
          </label>
          <CampoArea
            id={`${id}-a`}
            valor={valor}
            onChange={(x) => onArea(k, x)}
            alerta={acima || invalido}
            rotuloAria={`Área realizada do ${rotTalhao(t.tlh)} da fazenda ${t.propCod}`}
          />
          <div aria-live="polite">
            {acima && (
              <p className="mt-1 text-[12px] font-medium text-amber-600">
                Acima do que falta ({nf(saldo)} ha){concluido ? ": o talhão já está todo apontado" : ""}.
              </p>
            )}
            {invalido && <p className="mt-1 text-[12px] font-medium text-alert-600">Área inválida.</p>}
          </div>
        </div>
      )}
    </li>
  );
}

function ListaForaDaOS({ extras, onArea, onRemover }) {
  if (!extras.length) return null;
  return (
    <section className={`${CARTAO} overflow-hidden`} aria-label="Talhões fora da O.S.">
      <header className="border-b border-line px-3 py-2">
        <h3 className="text-[14.5px] font-semibold text-ink">Fora da O.S.</h3>
        <p className="text-[12px] text-muted">Incluídos neste lançamento; não entram no que falta da O.S.</p>
      </header>
      <ul className="divide-y divide-line">
        {extras.map((x) => {
          const v = lerNumero(x.area);
          const acima = x.areaTlh > 0 && v > x.areaTlh + 0.001;
          const invalido = String(x.area).trim() !== "" && !(v > 0);
          const id = `lm-x-${idSeguro(x.chave)}`;
          return (
            <li key={x.chave} className="bg-[rgb(var(--form-fundo))] px-3 py-2.5">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="font-display text-[19px] font-semibold leading-tight text-ink">
                    {rotTalhao(x.tlh)}{" "}
                    <span className="font-sans text-[13px] font-normal text-muted">
                      · {x.propCod}
                      {x.propNm ? ` - ${x.propNm}` : ""}
                    </span>
                  </div>
                  {x.areaTlh != null && <div className="text-[12px] text-muted">Área do talhão: {nf(x.areaTlh)} ha</div>}
                </div>
                <button
                  type="button"
                  onClick={() => onRemover(x.chave)}
                  className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg text-muted hover:bg-hover hover:text-ink"
                  aria-label={`Tirar o ${rotTalhao(x.tlh)} da fazenda ${x.propCod} do lançamento`}
                >
                  <IconFechar size={18} />
                </button>
              </div>
              <label htmlFor={id} className="mb-1 mt-2 block text-[12.5px] font-medium text-ink">
                Área realizada
              </label>
              <CampoArea
                id={id}
                valor={x.area}
                onChange={(a) => onArea(x.chave, a)}
                alerta={acima || invalido}
                rotuloAria={`Área realizada do ${rotTalhao(x.tlh)} da fazenda ${x.propCod} (fora da O.S.)`}
              />
              <div aria-live="polite">
                {acima && <p className="mt-1 text-[12px] font-medium text-amber-600">Acima da área do talhão ({nf(x.areaTlh)} ha).</p>}
                {invalido && <p className="mt-1 text-[12px] font-medium text-alert-600">Área inválida.</p>}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * Incluir fazenda/talhão que não está na O.S.: código da fazenda → talhões da base Fazenda e Talhões da safra da data
 * (ou o talhão digitado). Talhão que já está na O.S. é marcado lá em cima, não entra como "fora da O.S.".
 */
function IncluirForaDaOS({ dt, talhoesOS, marcas, extras, onIncluir, onMarcarDaOS, onAreaDaOS }) {
  const [aberto, setAberto] = useState(false);
  const [cod, setCod] = useState("");
  const [busca, setBusca] = useState(null); // { fazenda, talhoes }
  const [buscando, setBuscando] = useState(false);
  const [erro, setErro] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [escolhidos, setEscolhidos] = useState({});
  const [outroTlh, setOutroTlh] = useState("");
  const [outraArea, setOutraArea] = useState("");
  const campoCod = useRef(null);

  useEffect(() => {
    if (aberto) campoCod.current?.focus();
  }, [aberto]);

  async function buscar(e) {
    e.preventDefault();
    const c = cod.trim();
    setErro(null);
    setAviso(null);
    if (!c) return setErro("Informe o código da fazenda.");
    setBuscando(true);
    setBusca(null);
    setEscolhidos({});
    const { ok, json } = await obter({ fazenda: c, dt });
    setBuscando(false);
    if (!ok) return setErro(json.error ?? "Não foi possível buscar a fazenda.");
    if (!json.fazenda) return setErro(`A fazenda ${c} não está no Cadastro de Fazenda.`);
    setBusca({ fazenda: json.fazenda, talhoes: Array.isArray(json.talhoes) ? json.talhoes : [] });
  }

  const daOS = (tlh) => (busca ? talhoesOS.find((t) => mesmoTalhao(t, { propCod: busca.fazenda.cod, tlh })) : undefined);
  const jaIncluido = (tlh) => (busca ? extras.some((x) => mesmoTalhao(x, { propCod: busca.fazenda.cod, tlh })) : false);

  /** separa o que já está na O.S. (é marcado lá) do que entra como fora da O.S. */
  function incluir(itens) {
    const naOS = [];
    const fora = [];
    for (const it of itens) {
      const o = daOS(it.tlh);
      if (o) naOS.push(o);
      else if (!jaIncluido(it.tlh)) fora.push(it);
    }
    if (naOS.length) onMarcarDaOS(naOS.filter((o) => marcas[chaveDe(o)] === undefined), true);
    if (fora.length) onIncluir(fora);
    const partes = [];
    if (fora.length) partes.push(`${plural(fora.length, "talhão incluído", "talhões incluídos")} como fora da O.S.`);
    if (naOS.length) partes.push(`${naOS.map((o) => rotTalhao(o.tlh)).join(", ")} já ${naOS.length === 1 ? "está" : "estão"} na O.S.: marcado na lista acima`);
    const frase = partes.join("; ");
    setAviso(!frase ? "Nada novo para incluir." : frase.endsWith(".") ? frase : `${frase}.`);
    setEscolhidos({});
  }

  function incluirEscolhidos() {
    const f = busca.fazenda;
    incluir(
      busca.talhoes
        .filter((t) => escolhidos[t.tlh])
        .map((t) => ({ propCod: f.cod, propNm: f.nm ?? "", tlh: t.tlh, area: areaCampo(t.area), areaTlh: t.area ?? null })),
    );
  }

  function incluirOutro(e) {
    e.preventDefault();
    setErro(null);
    const tlh = outroTlh.trim().toUpperCase();
    const a = lerNumero(outraArea);
    if (outraArea.trim() && !(a > 0)) return setErro("Área inválida.");
    if (!tlh && !(a > 0)) return setErro("Sem talhão, informe a área da fazenda.");
    const f = busca.fazenda;
    const o = tlh ? daOS(tlh) : undefined;
    if (o && a > 0) {
      // talhão da O.S. digitado com a área: marca lá em cima com a área digitada
      onMarcarDaOS([o], true);
      onAreaDaOS(chaveDe(o), areaCampo(a));
      setAviso(`${rotTalhao(o.tlh)} já está na O.S.: marcado na lista acima com ${nf(a)} ha.`);
      setOutroTlh("");
      setOutraArea("");
      return;
    }
    const base = busca.talhoes.find((t) => normTlh(t.tlh) === normTlh(tlh));
    incluir([{ propCod: f.cod, propNm: f.nm ?? "", tlh: base?.tlh ?? tlh, area: a > 0 ? areaCampo(a) : areaCampo(base?.area), areaTlh: base?.area ?? null }]);
    setOutroTlh("");
    setOutraArea("");
  }

  function fechar() {
    setAberto(false);
    setBusca(null);
    setCod("");
    setErro(null);
    setAviso(null);
    setEscolhidos({});
  }

  if (!aberto) {
    return (
      <button type="button" className={`${BOTAO} w-full border-dashed`} onClick={() => setAberto(true)}>
        <IconMais size={18} /> Incluir fazenda/talhão fora da O.S.
      </button>
    );
  }

  const nEscolhidos = Object.values(escolhidos).filter(Boolean).length;
  return (
    <section className="caixa-form space-y-3" aria-labelledby="lm-fora-t">
      <div className="flex items-center gap-2">
        <h3 id="lm-fora-t" className="min-w-0 flex-1 text-[15px] font-semibold text-ink">
          Incluir fora da O.S.
        </h3>
        <button type="button" onClick={fechar} className="flex h-10 w-10 items-center justify-center rounded-lg text-muted hover:bg-surface" aria-label="Fechar a inclusão">
          <IconFechar size={18} />
        </button>
      </div>
      <form onSubmit={buscar} className="flex items-end gap-2" noValidate>
        <div className="min-w-0 flex-1">
          <label htmlFor="lm-faz" className={ROTULO}>
            Código da fazenda
          </label>
          <input
            id="lm-faz"
            ref={campoCod}
            value={cod}
            onChange={(e) => setCod(e.target.value.replace(/\s/g, "").slice(0, 12))}
            inputMode="numeric"
            autoComplete="off"
            enterKeyHint="search"
            placeholder="Ex.: 9411"
            className={`${CAMPO} tabular`}
          />
        </div>
        <button type="submit" className={`${BOTAO} !h-12`} disabled={buscando}>
          {buscando ? "Buscando…" : "Buscar"}
        </button>
      </form>
      <div aria-live="polite" className="space-y-2">
        {erro && <Aviso msg={{ texto: erro, erro: true }} onFechar={() => setErro(null)} />}
        {aviso && <Aviso msg={{ texto: aviso, erro: false }} onFechar={() => setAviso(null)} />}
      </div>
      {busca && (
        <>
          <p className="text-[14px] font-semibold text-ink">
            {busca.fazenda.cod}
            {busca.fazenda.nm ? ` - ${busca.fazenda.nm}` : ""}
          </p>
          {busca.talhoes.length > 0 ? (
            <fieldset>
              <legend className={ROTULO}>Talhões da fazenda (base da safra de {fmtDateBR(dt)})</legend>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {busca.talhoes.map((t) => {
                  const naOS = !!daOS(t.tlh);
                  const incluido = jaIncluido(t.tlh);
                  const marcado = !!escolhidos[t.tlh] || incluido;
                  return (
                    <label
                      key={t.tlh}
                      className={`flex min-h-[48px] cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 ${
                        marcado ? "border-[rgb(var(--form-acento))] bg-card" : "border-line bg-card"
                      } ${incluido ? "opacity-60" : ""}`}
                    >
                      <input
                        type="checkbox"
                        checked={marcado}
                        disabled={incluido}
                        onChange={(e) => setEscolhidos((m) => ({ ...m, [t.tlh]: e.target.checked }))}
                        className="h-5 w-5 flex-shrink-0 accent-[#23396B] dark:accent-[#7FA8E8]"
                      />
                      <span className="min-w-0 leading-tight">
                        <span className="block text-[14px] font-semibold text-ink">{rotTalhao(t.tlh)}</span>
                        <span className="block text-[11.5px] text-muted tabular">
                          {Number.isFinite(t.area) ? `${nf(t.area)} ha` : "sem área"}
                          {naOS ? " · na O.S." : incluido ? " · incluído" : ""}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
              <button type="button" className={`${BOTAO_PRIMARIO} mt-2 w-full !h-11 !text-[14.5px]`} disabled={!nEscolhidos} onClick={incluirEscolhidos}>
                Incluir {nEscolhidos ? plural(nEscolhidos, "talhão", "talhões") : "os marcados"}
              </button>
            </fieldset>
          ) : (
            <p className="text-[13px] text-muted">A fazenda não tem talhões na base da safra desta data. Digite o talhão abaixo.</p>
          )}
          <form onSubmit={incluirOutro} className="space-y-2 border-t border-[rgb(var(--form-borda))] pt-3" noValidate>
            <p className="text-[13px] font-medium text-ink">Talhão que não está na lista</p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="lm-outro-t" className={ROTULO}>
                  Talhão
                </label>
                <input
                  id="lm-outro-t"
                  value={outroTlh}
                  onChange={(e) => setOutroTlh(e.target.value.replace(/\s/g, "").slice(0, 8))}
                  autoComplete="off"
                  placeholder="Ex.: 07"
                  aria-describedby="lm-outro-dica"
                  className={`${CAMPO} tabular`}
                />
              </div>
              <div>
                <label htmlFor="lm-outro-a" className={ROTULO}>
                  Área realizada
                </label>
                <CampoArea id="lm-outro-a" valor={outraArea} onChange={setOutraArea} />
              </div>
            </div>
            <p id="lm-outro-dica" className="text-[12px] text-muted">
              Sem talhão, a área fica lançada só na fazenda.
            </p>
            <button type="submit" className={`${BOTAO} w-full`}>
              <IconMais size={16} /> Incluir
            </button>
          </form>
        </>
      )}
    </section>
  );
}

function Campo({ id, rotulo, dica, children, className = "" }) {
  return (
    <div className={className}>
      <label htmlFor={id} className={ROTULO}>
        {rotulo}
      </label>
      {children}
      {dica && <p className="mt-1 text-[12px] text-muted">{dica}</p>}
    </div>
  );
}

/** Escolha entre poucas opções em botões grandes (rádios por baixo, para teclado e leitor de tela). */
function Opcoes({ nome, legenda, valor, opcoes, onChange, colunas = 2, dica }) {
  return (
    <fieldset>
      <legend className={ROTULO}>{legenda}</legend>
      <div className={`grid gap-1.5 ${colunas === 3 ? "grid-cols-3" : "grid-cols-2"}`}>
        {opcoes.map((o) => {
          const on = valor === o.valor;
          return (
            <label key={o.valor} className="relative block cursor-pointer">
              <input type="radio" name={nome} value={o.valor} checked={on} onChange={() => onChange(o.valor)} className="peer sr-only" />
              <span
                className={`flex min-h-[48px] items-center justify-center rounded-lg border px-2 py-1.5 text-center text-[13px] font-semibold leading-tight peer-focus-visible:ring-2 peer-focus-visible:ring-[rgb(var(--form-acento))] ${
                  on ? "border-navy-900 bg-navy-900 text-white dark:border-crv-acao dark:bg-crv-acao" : "border-line bg-card text-ink hover:bg-hover"
                }`}
              >
                {o.rotulo}
              </span>
            </label>
          );
        })}
      </div>
      {dica && <p className="mt-1 text-[12px] text-muted">{dica}</p>}
    </fieldset>
  );
}

function DadosServico({ s, upd, dt, hoje, onDt, op, opcoes, faltaDepois, nTalhoes }) {
  const statusOS = opcoes?.statusOS?.length ? opcoes.statusOS : STATUS_PADRAO;
  // etapas do cadastro + a da operação (e a gravada) quando não estão nele
  const etapas = useMemo(() => {
    const l = [...(opcoes?.etapas ?? [])];
    if (op?.etapaCod && !l.some((x) => x.cod === op.etapaCod)) l.unshift({ cod: op.etapaCod, ds: op.etapaDs ?? "" });
    if (s.etapaCod && !l.some((x) => x.cod === s.etapaCod)) l.unshift({ cod: s.etapaCod, ds: "" });
    return l;
  }, [opcoes, op, s.etapaCod]);
  const tipos = useMemo(() => unicos([op?.tipoDs, ...(opcoes?.tipos ?? [])]), [opcoes, op]);
  const mec = s.modelo === "mecanizada";
  const un = s.unCalda === "kg" ? "kg" : "L";
  const recomendado = (sim) => (sim ? " (recomendado)" : "");
  return (
    <div className="caixa-form space-y-3.5">
      <Campo id="lm-dt4" rotulo="Data da operação">
        <input id="lm-dt4" type="date" value={dt} max={hoje || undefined} onChange={(e) => e.target.value && onDt(e.target.value)} className={CAMPO} />
      </Campo>
      <Campo id="lm-ativ" rotulo="Atividade" dica={op?.ds && s.atividade !== op.ds ? `Operação: ${op.ds}` : undefined}>
        <input id="lm-ativ" value={s.atividade} onChange={(e) => upd({ atividade: e.target.value.slice(0, 120) })} autoComplete="off" className={CAMPO} />
      </Campo>
      <Campo id="lm-solic" rotulo="Solicitante">
        <input
          id="lm-solic"
          list="lm-solicitantes"
          value={s.solicitante}
          onChange={(e) => upd({ solicitante: e.target.value.slice(0, 80) })}
          autoComplete="off"
          className={CAMPO}
        />
        <datalist id="lm-solicitantes">
          {unicos(opcoes?.solicitantes).map((x) => (
            <option key={x} value={x} />
          ))}
        </datalist>
      </Campo>
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
        <Campo id="lm-etapa" rotulo="Etapa">
          <select id="lm-etapa" value={s.etapaCod} onChange={(e) => upd({ etapaCod: e.target.value })} className={CAMPO}>
            <option value="">—</option>
            {etapas.map((x) => (
              <option key={x.cod} value={x.cod}>
                {x.cod}
                {x.ds ? ` - ${x.ds}` : ""}
              </option>
            ))}
          </select>
        </Campo>
        <Campo id="lm-tipo" rotulo="Tipo de aplicação">
          <input
            id="lm-tipo"
            list="lm-tipos"
            value={s.tipoAplicacao}
            onChange={(e) => upd({ tipoAplicacao: e.target.value.slice(0, 60) })}
            autoComplete="off"
            className={CAMPO}
          />
          <datalist id="lm-tipos">
            {tipos.map((x) => (
              <option key={x} value={x} />
            ))}
          </datalist>
        </Campo>
      </div>
      <Campo id="lm-equipe" rotulo={`Prestador / Equipe${recomendado(s.modelo === "manual")}`}>
        <input
          id="lm-equipe"
          list="lm-equipes"
          value={s.equipe}
          onChange={(e) => upd({ equipe: e.target.value.slice(0, 80) })}
          autoComplete="off"
          placeholder={mec ? "Ex.: Próprio, Alencar" : "Ex.: Turma Ituiutaba 2"}
          className={CAMPO}
        />
        <datalist id="lm-equipes">
          {unicos(opcoes?.equipes).map((x) => (
            <option key={x} value={x} />
          ))}
        </datalist>
      </Campo>
      <Campo id="lm-eqp" rotulo={`Equipamento (Frota)${recomendado(mec)}`}>
        <input
          id="lm-eqp"
          list="lm-equipamentos"
          value={s.eqp}
          onChange={(e) => upd({ eqp: e.target.value.toUpperCase().slice(0, 40) })}
          autoComplete="off"
          autoCapitalize="characters"
          placeholder="Código da frota"
          className={`${CAMPO} tabular`}
        />
        <datalist id="lm-equipamentos">
          {unicos(opcoes?.equipamentos).map((x) => (
            <option key={x} value={x} />
          ))}
        </datalist>
      </Campo>
      <div className="grid grid-cols-2 gap-3">
        <Campo id="lm-neqp" rotulo="Nº de equipamentos">
          <input
            id="lm-neqp"
            value={s.numEquipamentos}
            onChange={(e) => upd({ numEquipamentos: soDigitos(e.target.value) })}
            inputMode="numeric"
            autoComplete="off"
            className={`${CAMPO} text-right tabular`}
          />
        </Campo>
        <Campo id="lm-npes" rotulo="Nº de pessoas">
          <input
            id="lm-npes"
            value={s.numPessoas}
            onChange={(e) => upd({ numPessoas: soDigitos(e.target.value) })}
            inputMode="numeric"
            autoComplete="off"
            className={`${CAMPO} text-right tabular`}
          />
        </Campo>
        {s.modelo && (
          <p className="col-span-2 -mt-1.5 text-[12px] text-muted">
            {mec ? "Mecanizada: informe o Nº de equipamentos." : "Manual: informe o Nº de pessoas (e os tratores de apoio, se houver)."}
          </p>
        )}
      </div>
      <Opcoes
        nome="lm-un"
        legenda="Unidade da calda/insumo"
        valor={un}
        onChange={(v) => upd({ unCalda: v })}
        opcoes={[
          { valor: "L", rotulo: "Litros (L/ha · L)" },
          { valor: "kg", rotulo: "Quilos (kg/ha · kg)" },
        ]}
      />
      <div className="grid grid-cols-2 gap-3">
        <Campo id="lm-vazao" rotulo="Calda/Dose recom.">
          <div className="relative">
            <input
              id="lm-vazao"
              value={s.vazaoRec}
              onChange={(e) => upd({ vazaoRec: soNumero(e.target.value) })}
              inputMode="decimal"
              autoComplete="off"
              aria-describedby="lm-vazao-un"
              className={`${CAMPO} pr-14 text-right tabular`}
            />
            <span id="lm-vazao-un" className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[13px] text-muted">
              {un}/ha
            </span>
          </div>
        </Campo>
        <Campo id="lm-calda" rotulo="Calda/Insumo gasto">
          <div className="relative">
            <input
              id="lm-calda"
              value={s.volCalda}
              onChange={(e) => upd({ volCalda: soNumero(e.target.value) })}
              inputMode="decimal"
              autoComplete="off"
              aria-describedby="lm-calda-un"
              className={`${CAMPO} pr-10 text-right tabular`}
            />
            <span id="lm-calda-un" className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[13px] text-muted">
              {un}
            </span>
          </div>
        </Campo>
      </div>
      <Opcoes
        nome="lm-status"
        legenda="Status da O.S."
        valor={s.statusOS}
        onChange={(v) => upd({ statusOS: v })}
        colunas={3}
        opcoes={statusOS.map((x) => ({ valor: x, rotulo: x }))}
        dica={
          faltaDepois !== null && faltaDepois <= 0.001 && nTalhoes > 0 && !/^CONCLU/i.test(s.statusOS)
            ? "Com este lançamento não sobra área a fazer nesta operação. Se a O.S. terminou, marque CONCLUÍDA."
            : undefined
        }
      />
      <Campo id="lm-obs" rotulo="Observação">
        <textarea
          id="lm-obs"
          value={s.obs}
          onChange={(e) => upd({ obs: e.target.value.slice(0, 500) })}
          rows={3}
          className="w-full rounded-lg border border-line bg-card px-3 py-2.5 text-[16px] text-ink placeholder:text-muted/70"
        />
      </Campo>
      <Opcoes
        nome="lm-modelo"
        legenda="Modelo do texto do WhatsApp"
        valor={s.modelo}
        onChange={(v) => upd({ modelo: v })}
        opcoes={[
          { valor: "mecanizada", rotulo: "Mecanizada" },
          { valor: "manual", rotulo: "Manual" },
        ]}
        dica={
          op?.classificacao
            ? `Classificação da operação: ${op.classificacao}${op.modelo && op.modelo !== s.modelo ? ` (padrão: ${rotModelo(op.modelo)})` : ""}.`
            : "A operação não tem classificação no cadastro: escolha o modelo."
        }
      />
    </div>
  );
}

function CaixaTexto({ texto, caixaRef }) {
  return (
    <div
      ref={caixaRef}
      tabIndex={0}
      role="textbox"
      aria-readonly="true"
      aria-multiline="true"
      aria-label="Texto para o grupo do WhatsApp"
      className="select-text whitespace-pre-wrap break-words rounded-lg border border-line bg-surface px-3 py-2.5 font-mono text-[12px] leading-relaxed text-ink"
    >
      {texto || "(o servidor não devolveu o texto; abra o boletim em Meus lançamentos)"}
    </div>
  );
}

/** Texto do WhatsApp de um boletim (logo depois de gravar, ou aberto em Meus lançamentos); Copiar e Enviar ficam no rodapé. */
function VistaTexto({ tituloRef, titulo, linha, sucesso = false, avisos = [], boletim, texto, caixaRef, acoes }) {
  return (
    <section aria-labelledby="lm-texto-t" className="space-y-3">
      <div className={`${CARTAO} p-4`}>
        <div className="flex items-start gap-3">
          {sucesso && (
            <span aria-hidden="true" className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-good-50 text-good-600">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
            </span>
          )}
          <div className="min-w-0">
            <h2 id="lm-texto-t" ref={tituloRef} tabIndex={-1} className={TITULO_PASSO}>
              {titulo}
            </h2>
            {linha && <p className="mt-0.5 text-[13px] text-muted">{linha}</p>}
          </div>
        </div>
      </div>
      {avisos.length > 0 && (
        <div role="status" className="rounded-lg border border-amber-500/40 bg-amber-50 px-3 py-2 text-[13px] text-amber-600">
          <p className="font-semibold">Gravado com avisos:</p>
          <ul className="mt-0.5 list-disc space-y-0.5 pl-5">
            {avisos.map((a, i) => (
              <li key={i}>{a.texto}</li>
            ))}
          </ul>
        </div>
      )}
      <div>
        <p className={ROTULO}>Texto para o grupo do WhatsApp</p>
        <p className="mb-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-[12.5px] text-brand-700">
          A última linha (Boletim nº {boletim} · lançado no sistema) evita que o bot lance de novo — não apague.
        </p>
        <CaixaTexto texto={texto} caixaRef={caixaRef} />
      </div>
      {acoes && <div className="grid grid-cols-2 gap-2">{acoes}</div>}
    </section>
  );
}

function MeusLancamentos({ tituloRef, mat, nome, pode, dias, onDias, estado, abrindo, onRecarregar, onCopiar, onVerTexto, onEditar, onInformarMatricula }) {
  if (!mat) {
    return (
      <section aria-labelledby="lm-meus" className="space-y-3">
        <h2 id="lm-meus" ref={tituloRef} tabIndex={-1} className={TITULO_PASSO}>
          Meus lançamentos
        </h2>
        <div className={`${CARTAO} px-4 py-8 text-center`}>
          <span className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-surface text-muted" aria-hidden="true">
            <IconCelular size={20} />
          </span>
          <p className="text-[15px] font-semibold text-ink">Informe a sua matrícula</p>
          <p className="mx-auto mt-1 max-w-sm text-[13px] text-muted">Os lançamentos aparecem pela matrícula de quem lançou neste aparelho.</p>
          <button type="button" className={`${BOTAO_PRIMARIO} mt-4`} onClick={onInformarMatricula}>
            Informar matrícula
          </button>
        </div>
      </section>
    );
  }
  const lista = estado.lista;
  return (
    <section aria-labelledby="lm-meus" className="space-y-3">
      <div className="flex items-center gap-2">
        <h2 id="lm-meus" ref={tituloRef} tabIndex={-1} className={`${TITULO_PASSO} min-w-0 flex-1`}>
          Meus lançamentos
        </h2>
        <button type="button" className={BOTAO_MENOR} onClick={onRecarregar} disabled={estado.carregando} aria-label="Atualizar a lista">
          <IconAtualizar size={16} /> Atualizar
        </button>
      </div>
      <p className="text-[13px] text-muted">
        Lançados por esta tela com a matrícula {mat}
        {nome ? ` (${nome})` : ""}.
      </p>
      <div role="radiogroup" aria-label="Período" className="grid grid-cols-3 gap-1 rounded-lg bg-surface p-1">
        {PERIODOS_MEUS.map((d) => (
          <button
            key={d}
            type="button"
            role="radio"
            aria-checked={dias === d}
            onClick={() => onDias(d)}
            className={`h-10 rounded-md text-[13.5px] font-semibold ${dias === d ? "bg-card text-ink shadow-card" : "text-muted hover:text-ink"}`}
          >
            Últimos {d} dias
          </button>
        ))}
      </div>
      <div aria-live="polite" aria-busy={estado.carregando}>
        {estado.carregando && !lista && <p className="py-6 text-center text-[14px] text-muted">Carregando…</p>}
        {estado.erro && <Aviso msg={{ texto: estado.erro, erro: true }} />}
        {lista && lista.length === 0 && (
          <div className={`${CARTAO} px-4 py-8 text-center`}>
            <p className="text-[15px] font-semibold text-ink">Nenhum lançamento no período</p>
            <p className="mx-auto mt-1 max-w-sm text-[13px] text-muted">Os boletins gravados pelo Lançamento Mobile com esta matrícula aparecem aqui.</p>
          </div>
        )}
      </div>
      {lista && lista.length > 0 && (
        <ul className="space-y-2">
          {lista.map((a) => (
            <li key={a.id} className={`${CARTAO} p-3`}>
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-display text-[19px] font-semibold leading-tight text-ink">Boletim nº {a.boletim}</span>
                <span className="text-[12.5px] text-muted">{fmtDateBR(a.dt)}</span>
                {abrindo === a.boletim && <span className="text-[12px] text-muted">abrindo…</span>}
              </div>
              <p className="truncate text-[13.5px] text-ink">
                O.S. {a.os} · {a.opCod}
                {a.opDs ? ` - ${a.opDs}` : ""}
              </p>
              <p className="text-[12.5px] text-muted">
                <span className="tabular">{nf(a.areaTotal ?? 0)} ha</span>
                {a.statusOS ? ` · ${a.statusOS}` : ""}
              </p>
              <div className="mt-2 grid grid-cols-3 gap-2">
                <button type="button" className={`${BOTAO} !px-2`} onClick={() => onCopiar(a)} disabled={abrindo !== null}>
                  <IconCopiar size={16} /> Copiar
                </button>
                <button type="button" className={`${BOTAO} !px-2`} onClick={() => onVerTexto(a)} disabled={abrindo !== null}>
                  Ver texto
                </button>
                <button type="button" className={`${BOTAO} !px-2`} onClick={() => onEditar(a)} disabled={!pode || abrindo !== null}>
                  <IconEditar size={16} /> Editar
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
