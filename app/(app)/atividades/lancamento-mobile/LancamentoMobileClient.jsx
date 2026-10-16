"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  IconAtualizar,
  IconCelular,
  IconCompartilhar,
  IconCopiar,
  IconEditar,
  IconExcluir,
  IconFechar,
  IconMais,
  IconSalvar,
  IconSetaBaixo,
  IconSetaDireita,
  IconTalhao,
} from "@/components/icons";
import { Aviso, JanelaConfirmar, JanelaInfo } from "@/components/janela";
import { CabecalhoPagina, CorpoPagina, Pagina, rolarCorpoParaOTopo, Selo } from "@/components/pagina";
import { round2 } from "@/lib/atividades";
import { fmtDateBR, todayISO } from "@/lib/format";
import { chaveBusca, fmtNum, lerNumero as lerNumeroComMilhar, listaDeBoletins, tipoDoCadastro } from "@/lib/lancamento-mobile";
import { normFaz, normTlh } from "@/lib/ocupacao";
import { addDays } from "@/lib/period";
import { podeEditar } from "@/lib/permissoes";
import { ehBooleano, ehUmDe, usarPersistido } from "@/lib/usar-persistido";

/*
 * Lançamento Mobile: o apontamento diário feito no campo, pelo celular, em quatro passos —
 *   1. quem está lançando (matrícula, código ou nome, com sugestões; lembrada no aparelho);
 *   2. as O.S. em aberto dessa pessoa, com o que falta fazer em cada operação e o último apontamento (o cartão fica
 *      verde com a O.S. toda apontada e amarelo com apontamento e ainda falta); tocar na O.S. abre a janela dela, com
 *      as operações para marcar (as marcadas entram juntas no lançamento) e os lançamentos já feitos nela;
 *   3. os talhões realizados (da O.S. ou incluídos de fora dela), com a área de cada um — com "Adicionar outra O.S.",
 *      o mesmo lançamento leva várias O.S./operações, cada uma num bloco com os talhões e o status dela;
 *   4. os dados do serviço (o cabeçalho, o mesmo para todas as O.S. do lançamento).
 * Ao gravar mostra o texto padrão para copiar e mandar no grupo do WhatsApp; a última linha do texto (a marca do
 * boletim, ou dos boletins: um por O.S.) faz o bot reconhecer que o apontamento já está no sistema. A tela Apontamento
 * continua sendo a de lançamento na plataforma: aqui só se lança, e só se edita o que foi lançado por esta tela com a
 * mesma matrícula — os lançamentos da O.S. feitos por outras pessoas, pela tela Apontamento ou pelo bot abrem só para
 * consulta.
 */

const API = "/api/atividades/lancamento-mobile";
const STATUS_PADRAO = ["MANTER ABERTA", "CONCLUÍDA", "NÃO CONCLUÍDA"];
const STATUS_INICIAL = "MANTER ABERTA";
const CHAVE_RASCUNHO = "ca_ui:lancMobile.rascunho";
const PASSOS = [
  { n: 1, rotulo: "Quem" },
  { n: 2, rotulo: "O.S." },
  { n: 3, rotulo: "Talhões" },
  { n: 4, rotulo: "Dados" },
];
/** Períodos de Meus lançamentos: os últimos 7, 15 e 30 dias ou todos (0). */
const PERIODOS_MEUS = [7, 15, 30, 0];
/** Máximo de O.S./operações num lançamento (o servidor recusa mais). */
const MAX_ORDENS = 20;
/** Origem de um lançamento da O.S. (como o servidor devolve). */
const ROTULO_ORIGEM = { mobile: "Lançamento Mobile", tela: "Tela Apontamento", bot: "Bot do WhatsApp", whatsapp: "WhatsApp" };

// cabeçalho do lançamento: o mesmo para todas as O.S. dele
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
  obs: "",
  modelo: "",
};
// uma O.S./operação do lançamento (um apontamento, com o seu boletim). chave: identifica o bloco na tela; id e boletim:
// o apontamento gravado (edição); marcas: área digitada de cada talhão da O.S. marcado ("propCod|tlh" → texto);
// extras: talhões de fora da O.S.; pendentes: talhões do boletim aberto para edição, encaixados quando os talhões da
// O.S. chegam; gravados: os talhões do boletim como estão gravados (para a O.S. tirada e posta de novo); statusOS: o
// status informado da O.S.
const ORDEM_VAZIA = {
  chave: "",
  id: null,
  boletim: null,
  os: "",
  opCod: "",
  statusOS: STATUS_INICIAL,
  marcas: {},
  extras: [],
  pendentes: null,
  gravados: null,
};
// id, ids e boletins: o lançamento aberto para editar (id = o primeiro apontamento dele; ids = todos, que o "Já apontado"
// não conta: a gravação reescreve ou exclui cada um); removidas: as O.S. dele (com o apontamento) tiradas nesta edição,
// que voltam com o boletim e os talhões se forem acrescentadas de novo
const LANC_VAZIO = { id: null, ids: [], boletins: [], ordens: [], removidas: [], servico: SERVICO_VAZIO };

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
/** objeto sem a chave `k` */
const sem = (m, k) => {
  const n = { ...m };
  delete n[k];
  return n;
};
/** "boletim nº 160" / "boletins nº 160 e 161" (e com maiúscula, para títulos) */
const rotBoletins = (l) => `${l.length > 1 ? "boletins" : "boletim"} nº ${listaDeBoletins(l)}`;
const tituloBoletins = (l) => `${l.length > 1 ? "Boletins" : "Boletim"} nº ${listaDeBoletins(l)}`;
/** "do boletim nº 160" / "dos boletins nº 160 e 161" */
const doBoletins = (l) => `${l.length > 1 ? "dos" : "do"} ${rotBoletins(l)}`;
/** "da O.S. 6052" / "das O.S. 6052, 6053" */
function rotuloDasOS(ordens) {
  const l = unicos(ordens.map((o) => o.os));
  return l.length > 1 ? `das O.S. ${l.join(", ")}` : `da O.S. ${l[0] ?? ""}`;
}
/**
 * Status da O.S. de um lançamento (as O.S. dele): um só quando é uma O.S. ou todas iguais; senão o de cada O.S.
 * ("6052 MANTER ABERTA · 6053 CONCLUÍDA").
 */
function statusResumo(ordens) {
  const porOS = new Map();
  for (const o of ordens) if (!porOS.get(o.os)) porOS.set(o.os, o.statusOS ?? "");
  const l = unicos([...porOS.values()]);
  if (l.length <= 1) return l[0] ?? "";
  return [...porOS]
    .filter(([, v]) => v)
    .map(([os, v]) => `${os} ${v}`)
    .join(" · ");
}

/** "TL 05" (talhão numérico com dois dígitos), "TL 2A"; vazio = só a fazenda */
function rotTalhao(tlh) {
  const t = String(tlh ?? "").trim();
  if (!t) return "Sem talhão";
  return /^\d+$/.test(t) ? `TL ${t.replace(/^0+(?=\d)/, "").padStart(2, "0")}` : `TL ${t.toUpperCase()}`;
}
/** último apontamento: "07/10 · boletim nº 160 · 3,20 ha" */
const textoUltimo = (u) => (u ? `${diaMes(u.dt)} · boletim nº ${u.boletim}${Number.isFinite(u.area) ? ` · ${nf(u.area)} ha` : ""}` : "");
/** "10 - Herbicida" (sem o traço quando falta um dos dois) */
const codDs = (cod, ds) => [String(cod ?? "").trim(), String(ds ?? "").trim()].filter(Boolean).join(" - ");

/**
 * Situação dos apontamentos de uma operação da O.S. (lista do passo 2): "nenhum" (sem apontamento), "andamento" (com
 * apontamento e ainda falta) ou "concluida" (com apontamento e falta 0).
 */
function estadoDaOperacao(op) {
  if (!((op.ja ?? 0) > 0.001 || op.ultimo)) return "nenhum";
  return (op.saldo ?? 0) > 0.001 ? "andamento" : "concluida";
}
/** A da O.S.: toda apontada (falta 0 em todas as operações), com algum apontamento e falta, ou sem nenhum. */
function estadoDaOS(ordem) {
  const ops = ordem.operacoes ?? [];
  if (!ops.some((op) => estadoDaOperacao(op) !== "nenhum")) return "nenhum";
  return ops.every((op) => !((op.saldo ?? 0) > 0.001)) ? "concluida" : "andamento";
}
/** Cores dos cartões e das linhas de operação (o verde e o amarelo claros do sistema; no tema escuro, globals.css). */
const COR_ESTADO = {
  nenhum: { fundo: "", borda: "border-line", rotulo: "Sem apontamento" },
  andamento: { fundo: "bg-amber-50", borda: "border-amber-500/60", rotulo: "Apontada, ainda com falta" },
  concluida: { fundo: "bg-good-50", borda: "border-good-500/50", rotulo: "Toda apontada" },
};

/** Texto que parece nome (e não matrícula): com espaço ou com três letras seguidas. */
const pareceNome = (s) => /\s/.test(String(s ?? "").trim()) || /[A-Za-zÀ-ÿ]{3,}/.test(String(s ?? ""));

/** Quem lançou um lançamento da O.S.: o apontador / informante (com a matrícula) ou, sem ele, o usuário. */
function quemLancou(a) {
  const nome = String(a.apontador ?? "").trim();
  const mat = String(a.apontadorMat ?? "").trim();
  if (nome) return `${nome}${mat ? ` (mat. ${mat})` : ""}`;
  return mat ? `Mat. ${mat}` : String(a.usr ?? "").trim();
}

/**
 * Tipos do cadastro que casam com o digitado (sem acento nem caixa): o código igual ou começando pelo digitado
 * primeiro, depois a descrição começando por ele e, por último, contendo.
 */
function filtrarTipos(tipos, q) {
  const k = chaveBusca(q);
  if (!k) return tipos;
  const kCod = k.replace(/^0+(?=\d)/, "");
  const nota = (t) => {
    const cod = String(t.cod ?? "")
      .trim()
      .replace(/^0+(?=\d)/, "")
      .toLowerCase();
    const ds = chaveBusca(t.ds);
    if (cod && cod === kCod) return 0;
    if (cod && /^\d+$/.test(k) && cod.startsWith(kCod)) return 1;
    if (ds.startsWith(k)) return 2;
    if (ds.includes(k)) return 3;
    // "52 - div" (o código e o começo do nome, como o campo mostra); só número é só pelo código
    if (!/^\d+$/.test(k) && chaveBusca(codDs(t.cod, t.ds)).includes(k)) return 3;
    return null;
  };
  return tipos
    .map((t) => ({ t, n: nota(t) }))
    .filter((x) => x.n !== null)
    .sort((a, b) => a.n - b.n)
    .map((x) => x.t);
}

let seqExtra = 0;
const novaChaveExtra = () => `x${++seqExtra}`;
let seqOrdem = 0;
const novaChaveOrdem = () => `o${++seqOrdem}`;
/**
 * Talhões de uma O.S. do lançamento buscados no servidor: pela O.S. e operação (na edição, o "Já apontado" não conta
 * nenhum apontamento do lançamento aberto — lanc.ids —, então vale para a O.S. tirada e posta de novo e para a trocada).
 * Os buscados são esquecidos a cada lançamento novo ou aberto (zerarLancamento).
 */
const chaveInfo = (o) => `${o.os}|${o.opCod}`;

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

/**
 * Padrões do cabeçalho que a O.S. dá, com os talhões dela (atividade = descrição da operação, solicitante = responsável
 * da O.S., etapa, tipo de aplicação e modelo da operação).
 */
function padroesDaInfo(info) {
  const o = info.operacao ?? {};
  return { atividade: o.ds ?? "", solicitante: info.resp ?? "", etapaCod: o.etapaCod ?? "", modelo: o.modelo ?? "", tipoAplicacao: o.tipoDs ?? "" };
}

/**
 * Padrões de uma O.S. no cabeçalho: só onde o campo está em branco ou ainda com o padrão da anterior (`anteriores`); os
 * preenchidos à mão ficam. Com `anteriores` vazio, só os em branco.
 */
function aplicarPadroes(s, anteriores, novos) {
  const r = { ...s };
  for (const [k, v] of Object.entries(novos)) if (!r[k] || r[k] === anteriores[k]) r[k] = v;
  return r;
}

/**
 * Talhões gravados no boletim → marcas da O.S. (mesmo código, ou "05" = "5" e "09411-1" = "9411") e, os que não
 * estão na O.S., incluídos como de fora dela.
 */
function encaixarTalhoes(ordem, gravados, daOS) {
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
  return { ...ordem, marcas, extras, pendentes: null };
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
    obs: a.obs ?? "",
    modelo: a.modelo === "mecanizada" || a.modelo === "manual" ? a.modelo : "",
  };
}

/** Cabeçalho do lançamento aberto para editar: o do primeiro boletim, com a calda gasta do lançamento (a soma do que foi rateado entre as O.S.). */
function servicoDoLancamento(grupo) {
  const s = servicoDoBoletim(grupo[0] ?? {});
  if (grupo.length > 1) {
    const caldas = grupo.map((x) => x.volCalda).filter((v) => Number.isFinite(v));
    s.volCalda = caldas.length ? paraCampo(Math.round(caldas.reduce((a, b) => a + b, 0) * 1e6) / 1e6) : "";
  }
  return s;
}

/** Rascunho guardado no aparelho que dá para continuar (o da primeira versão da tela, v1, tinha uma O.S. só). */
function rascunhoValido(r) {
  if (!r || !/^\d{4}-\d{2}-\d{2}$/.test(r.dt ?? "")) return false;
  if (r.v === 1) return !!(r.lanc?.os && r.lanc?.opCod);
  return r.v === 2 && Array.isArray(r.lanc?.ordens) && r.lanc.ordens.length > 0 && r.lanc.ordens.every((o) => o && o.os && o.opCod);
}

/** Rascunho → lançamento na tela (chaves novas para os blocos e os talhões de fora da O.S.). */
function lancDoRascunho(r) {
  const l = r.lanc ?? {};
  const { statusOS, ...servico } = { ...SERVICO_VAZIO, ...(l.servico ?? {}) };
  const brutas =
    r.v === 1
      ? [{ id: l.id, boletim: l.boletim, os: l.os, opCod: l.opCod, statusOS: statusOS ?? STATUS_INICIAL, marcas: l.marcas, extras: l.extras, pendentes: l.pendentes }]
      : l.ordens;
  const ordemDoRascunho = (o) => ({
    ...ORDEM_VAZIA,
    chave: novaChaveOrdem(),
    id: o.id ?? null,
    boletim: o.boletim ?? null,
    os: String(o.os),
    opCod: String(o.opCod),
    statusOS: typeof o.statusOS === "string" ? o.statusOS : STATUS_INICIAL,
    marcas: o.marcas && typeof o.marcas === "object" ? o.marcas : {},
    extras: (Array.isArray(o.extras) ? o.extras : []).map((x) => ({ ...x, chave: novaChaveExtra() })),
    pendentes: Array.isArray(o.pendentes) ? o.pendentes : null,
    gravados: Array.isArray(o.gravados) ? o.gravados : null,
  });
  const ordens = brutas.slice(0, MAX_ORDENS).map(ordemDoRascunho);
  const removidas = (r.v === 2 && Array.isArray(l.removidas) ? l.removidas : []).filter((o) => o && o.id && o.os && o.opCod).map(ordemDoRascunho);
  const boletins = r.v === 1 ? (l.boletim ? [l.boletim] : []) : Array.isArray(l.boletins) ? l.boletins : [];
  // ids do lançamento aberto (o rascunho de antes deles: os das O.S. que estão nele)
  const ids =
    r.v === 2 && Array.isArray(l.ids) && l.ids.length
      ? l.ids.filter((x) => Number.isInteger(x) && x > 0)
      : [...ordens, ...removidas].map((o) => o.id).filter(Boolean);
  return { id: l.id ?? null, ids, boletins, ordens, removidas, servico };
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
  // talhões de cada O.S. do lançamento ("os|operação|id" → { dt, info } ou { dt, erro }) e as buscas em andamento (→ data)
  const [infos, setInfos] = useState({});
  const [carregandoInfo, setCarregandoInfo] = useState({});
  const [abertas, setAbertas] = useState({}); // blocos abertos no lançamento com várias O.S. (chave da O.S. → true)
  const [escolha, setEscolha] = useState(null); // passo 2: { modo: "adicionar" } ou { modo: "trocar", chave }
  const [msg, setMsg] = useState(null);
  const [gravando, setGravando] = useState(false);
  const [confirmacao, setConfirmacao] = useState(null); // avisos do servidor antes de gravar
  const [pergunta, setPergunta] = useState(null); // { titulo, texto, botao, perigo, acao }
  const [resultado, setResultado] = useState(null); // { id, boletins, texto, avisos, editado, ordens: [{ os, op }], area, dt }
  const [rascunho, setRascunho] = useState(null);
  const [diasMeus, setDiasMeus] = usarPersistido("lancMobile.diasMeus", 7, ehUmDe(PERIODOS_MEUS));
  // lista: os lançamentos carregados (páginas somadas); mais: há outra página
  const [meus, setMeus] = useState({ lista: null, carregando: false, carregandoMais: false, erro: null, mais: false });
  const [abrindo, setAbrindo] = useState(null); // boletim sendo carregado
  const [detalhe, setDetalhe] = useState(null); // { apontamento, apontamentos, texto }: lançamento aberto em Meus lançamentos
  const [janelaOS, setJanelaOS] = useState(null); // passo 2: { os, ordem } — a janela da O.S. aberta
  // lançamentos de cada O.S. (de qualquer origem): os → { carregando, lista, total, erro }
  const [historico, setHistorico] = useState({});
  const [consulta, setConsulta] = useState(null); // { id, resumo, carregando, dados, erro }: lançamento aberto só para consulta
  // tipo de aplicação digitado que não está no cadastro (o campo ficou em branco): o Gravar avisa uma vez antes de gravar sem ele
  const [tipoRecusado, setTipoRecusado] = useState(null);
  const [copia, copiar] = usarCopia();
  const seqOS = useRef(0);
  const seqInfo = useRef(0);
  const voando = useRef({}); // buscas de talhões em andamento: "os|operação|id" → { seq, dt }
  const seqMeus = useRef(0);
  const iniciou = useRef(false);
  const padroes = useRef({});
  const lancRef = useRef(lanc);
  // os talhões buscados como estão agora (as ações confirmadas numa janela leem daqui, e não do que havia no toque)
  const infosRef = useRef(infos);
  // data em que se estava lançando antes de abrir um boletim para editar (ou um rascunho de outro dia): o "Novo
  // lançamento" volta a ela, e não à data do boletim editado
  const dtAntesDeAbrir = useRef(null);
  const tituloPasso = useRef(null);
  const focarPasso = useRef(false);
  const caixaTexto = useRef(null);
  const cacheBol = useRef(new Map());
  // buscas dos lançamentos de cada O.S.: os → nº da busca (a resposta de uma busca que outra passou não vale)
  const buscaHist = useRef({});
  const seqHist = useRef(0);
  const seqConsulta = useRef(0);

  useEffect(() => {
    lancRef.current = lanc;
  }, [lanc]);
  useEffect(() => {
    infosRef.current = infos;
  }, [infos]);

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
      if (rascunhoValido(r)) setRascunho(r);
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

  // ------------------------------------------------------------------ talhões de cada O.S. do lançamento

  /** Esquece os talhões buscados (e as respostas ainda a caminho, que não valem mais). */
  const limparInfos = useCallback(() => {
    voando.current = {};
    setCarregandoInfo({});
    setInfos({});
  }, []);

  /** Talhões da O.S./operação na data (na edição, o "Já apontado" não conta os apontamentos `excluir`, os do lançamento aberto). */
  function buscarInfo(k, o, data, excluir) {
    const seq = ++seqInfo.current;
    voando.current[k] = { seq, dt: data };
    setCarregandoInfo((m) => ({ ...m, [k]: data }));
    const p = { os: o.os, op: o.opCod, dt: data };
    if (excluir.length) p.excluir = excluir.join(",");
    obter(p).then(({ ok, json }) => {
      // outra busca desta O.S. passou na frente (outra data) ou o lançamento foi limpo: a resposta não vale mais
      if (voando.current[k]?.seq !== seq) return;
      delete voando.current[k];
      setCarregandoInfo((m) => sem(m, k));
      if (!ok || !json.operacao) {
        // os talhões da data anterior (se havia) ficam à vista com o erro; o bloco recolhido abre para mostrar o erro
        setInfos((m) => ({ ...m, [k]: { ...m[k], dt: data, erro: json.error ?? "Não foi possível carregar os talhões da O.S." } }));
        const blocos = lancRef.current.ordens.filter((x) => chaveInfo(x) === k).map((x) => x.chave);
        if (blocos.length) setAbertas((a) => ({ ...a, ...Object.fromEntries(blocos.map((c) => [c, true])) }));
        return;
      }
      const talhoes = Array.isArray(json.talhoes) ? json.talhoes : [];
      const info = { ...json, talhoes };
      // padrões da 1ª O.S. do lançamento (o cabeçalho vem dela): o campo em branco ou ainda com os padrões que estavam
      // (os da lista do passo 2, os de outra O.S. que era a 1ª e saiu antes de os talhões desta chegarem) recebe os dela;
      // no boletim aberto para editar e no rascunho, só os em branco
      const primeira = lancRef.current.ordens[0];
      const ehPrimeira = !!primeira && chaveInfo(primeira) === k;
      const anteriores = padroes.current;
      const novos = padroesDaInfo(info);
      if (ehPrimeira) padroes.current = novos;
      setInfos((m) => ({ ...m, [k]: { dt: data, info } }));
      setLanc((l) => ({
        ...l,
        servico: ehPrimeira && l.ordens[0] && chaveInfo(l.ordens[0]) === k ? aplicarPadroes(l.servico, anteriores, novos) : l.servico,
        ordens: l.ordens.map((x) => (x.pendentes && chaveInfo(x) === k ? encaixarTalhoes(x, x.pendentes, talhoes) : x)),
      }));
    });
  }

  // busca os talhões das O.S. que ainda não têm os da data (trocando só a data, os da anterior ficam até chegar os novos)
  useEffect(() => {
    if (!dt) return;
    for (const o of lanc.ordens) {
      if (!o.os || !o.opCod) continue;
      const k = chaveInfo(o);
      if (infos[k]?.dt === dt || voando.current[k]?.dt === dt) continue;
      buscarInfo(k, o, dt, lanc.ids ?? []);
    }
  }, [lanc.ordens, lanc.ids, dt, infos]); // eslint-disable-line react-hooks/exhaustive-deps

  const varias = lanc.ordens.length > 1;
  // por O.S.: os talhões dela (valem depois de encaixados os do boletim aberto), as linhas que vão no lançamento
  // (talhões da O.S. marcados + os de fora dela), o total e o que falta fazer depois do lançamento
  const resumo = useMemo(
    () =>
      lanc.ordens.map((o) => {
        const e = infos[chaveInfo(o)];
        const info = e?.info && !o.pendentes ? e.info : null;
        const talhoesOS = info ? info.talhoes : [];
        const linhas = [
          ...talhoesOS.filter((t) => o.marcas[chaveDe(t)] !== undefined).map((t) => ({ propCod: t.propCod, tlh: t.tlh, texto: o.marcas[chaveDe(t)] })),
          ...o.extras.map((x) => ({ propCod: x.propCod, tlh: x.tlh, texto: x.area })),
        ];
        const total = round2(linhas.reduce((a, l) => a + (lerNumero(l.texto) > 0 ? lerNumero(l.texto) : 0), 0));
        const faltaDepois = info
          ? round2(
              talhoesOS.reduce((a, t) => {
                const v = lerNumero(o.marcas[chaveDe(t)]);
                return a + Math.max(0, (t.saldo ?? 0) - (v > 0 ? v : 0));
              }, 0),
            )
          : null;
        return { info, talhoesOS, linhas, total, faltaDepois, carregando: !!carregandoInfo[chaveInfo(o)], erro: e?.erro ?? null };
      }),
    [lanc.ordens, infos, carregandoInfo],
  );
  const total = round2(resumo.reduce((a, r) => a + r.total, 0));
  const nLinhas = resumo.reduce((a, r) => a + r.linhas.length, 0);
  const todasProntas = lanc.ordens.length > 0 && resumo.every((r) => !!r.info);
  const temNaoGravado = !resultado && (varias || lanc.ordens.some((o) => Object.keys(o.marcas).length > 0 || o.extras.length > 0));

  // rascunho no aparelho: se a aba do navegador for fechada (ou o celular a descartar), dá para continuar depois
  useEffect(() => {
    if (resultado || !lanc.ordens.length) return;
    if (!(lanc.id || lanc.ordens.length > 1 || lanc.ordens.some((o) => Object.keys(o.marcas).length || o.extras.length))) return;
    try {
      localStorage.setItem(CHAVE_RASCUNHO, JSON.stringify({ v: 2, matricula: matAtual, dt, lanc, em: new Date().toISOString() }));
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

  const mostrarRascunho = !!rascunho && !lanc.ordens.length && !resultado && !!matAtual && rascunho.matricula === matAtual;

  /** Volta ao lançamento vazio (sem O.S., talhões nem dados). */
  function zerarLancamento() {
    setLanc(LANC_VAZIO);
    limparInfos();
    setAbertas({});
    setEscolha(null);
    setTipoRecusado(null);
    padroes.current = {};
  }

  function continuarRascunho() {
    const r = rascunho;
    const l = lancDoRascunho(r);
    setRascunho(null);
    zerarLancamento();
    if (dtAntesDeAbrir.current === null) dtAntesDeAbrir.current = dt;
    setDt(r.dt);
    setLanc(l);
    // a última O.S. acrescentada fica aberta
    setAbertas(l.ordens.length ? { [l.ordens[l.ordens.length - 1].chave]: true } : {});
    irPara(3);
  }

  /** Ao largar a edição (ou o rascunho), volta à data em que se estava lançando antes de abri-lo. */
  function voltarDataAntesDeAbrir() {
    const d = dtAntesDeAbrir.current;
    dtAntesDeAbrir.current = null;
    if (d) setDt(d);
  }

  // ------------------------------------------------------------------ lançamentos da O.S. (de qualquer origem)

  /**
   * Lançamentos da O.S. (os mais recentes, de qualquer origem). Sem `fresco`, só busca a O.S. que ainda não foi buscada
   * (os blocos do passo 3 pedem ao aparecer); a janela da O.S. busca de novo a cada vez que abre.
   */
  const carregarHistorico = useCallback(async (os, fresco = false) => {
    if (!os || (!fresco && buscaHist.current[os])) return;
    const n = ++seqHist.current;
    buscaHist.current[os] = n;
    setHistorico((h) => ({ ...h, [os]: { lista: null, total: 0, ...h[os], carregando: true, erro: null } }));
    const { ok, json } = await obter({ lancamentosOS: os });
    // outra busca desta O.S. passou na frente (ou os lançamentos foram esquecidos): a resposta não vale mais
    if (buscaHist.current[os] !== n) return;
    setHistorico((h) => ({
      ...h,
      [os]: ok
        ? { carregando: false, erro: null, lista: Array.isArray(json.lancamentos) ? json.lancamentos : [], total: Number(json.total) || 0 }
        : { lista: null, total: 0, ...h[os], carregando: false, erro: json.error ?? "Não foi possível carregar os lançamentos da O.S." },
    }));
  }, []);

  /** Esquece os lançamentos das O.S. (depois de gravar): os blocos e a janela buscam de novo. */
  const esquecerHistorico = useCallback(() => {
    buscaHist.current = {};
    setHistorico({});
  }, []);

  /** Abre um lançamento da O.S. só para consultar (com o texto do WhatsApp, se for do Lançamento Mobile). */
  async function abrirConsulta(item) {
    const n = ++seqConsulta.current;
    setConsulta({ id: item.id, resumo: item, carregando: true, dados: null, erro: null });
    const { ok, json } = await obter({ apontamento: String(item.id) });
    if (n !== seqConsulta.current) return;
    const valido = ok && !!json.apontamento;
    setConsulta((c) =>
      c && c.id === item.id
        ? { ...c, carregando: false, dados: valido ? json : null, erro: valido ? null : (json.error ?? "Não foi possível abrir o lançamento.") }
        : c,
    );
  }

  function fecharConsulta() {
    seqConsulta.current++;
    setConsulta(null);
  }

  /**
   * "Editar" na consulta (lançamento do Lançamento Mobile com a mesma matrícula): abre como em Meus lançamentos e fecha
   * as janelas quando ele abre (desistindo na pergunta do lançamento não gravado, a consulta fica); sem carregar, fecha
   * para a mensagem aparecer.
   */
  async function editarDaConsulta(bol) {
    const fechar = () => {
      fecharConsulta();
      setJanelaOS(null);
    };
    if (!(await editarBoletim(bol, fechar))) fechar();
  }

  // ------------------------------------------------------------------ passo 1: quem está lançando

  /**
   * Busca as O.S. de quem lança: pela matrícula escolhida nas sugestões (`valor`) ou pelo digitado. Digitado um nome (ou
   * trecho dele), vale o único responsável que casa; com mais de um, pede para escolher na lista.
   */
  async function buscarMatricula(e, valor) {
    e?.preventDefault();
    let m = String(valor ?? matDigitada).trim();
    if (!m) return setErroMat("Informe a matrícula, o código ou o nome.");
    if (valor === undefined && pareceNome(m)) {
      setErroMat(null);
      const { ok, json } = await obter({ responsaveis: m });
      if (!ok) return setErroMat(json.error ?? "Não foi possível buscar os responsáveis.");
      const lista = Array.isArray(json.responsaveis) ? json.responsaveis : [];
      const iguais = lista.filter((r) => chaveBusca(r.nome) === chaveBusca(m));
      const um = lista.length === 1 ? lista[0] : iguais.length === 1 ? iguais[0] : null;
      if (um) {
        m = String(um.matricula).trim();
        setMatDigitada(m);
      } else if (lista.length > 1) {
        return setErroMat(`Mais de um responsável com “${m}”: toque no nome certo na lista de sugestões.`);
      } else if (/\s/.test(m)) {
        return setErroMat(`Nenhum responsável com “${m}” no nome ou no código.`);
      }
      // sem sugestão e sem espaço: pode ser um código com letras — busca como matrícula
    }
    iniciou.current = true;
    const outra = !!matAtual && !mesmaMatricula(matAtual, m);
    const fazer = async () => {
      const r = await buscarOS(m, dt || todayISO(), true);
      if (!r) return;
      setMatricula(r.mat);
      setMatDigitada(r.mat);
      if (outra) {
        zerarLancamento();
        setResultado(null);
        // as O.S. da outra matrícula já vieram para a data da tela: é nela que se segue
        dtAntesDeAbrir.current = null;
      }
      irPara(2);
    };
    if (outra && temNaoGravado) {
      setPergunta({
        titulo: "Trocar a matrícula?",
        texto: `O lançamento ${rotuloDasOS(lanc.ordens)} ainda não foi gravado e será descartado.`,
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
      zerarLancamento();
      setResultado(null);
      seqMeus.current++;
      setMeus({ lista: null, carregando: false, carregandoMais: false, erro: null, mais: false });
      voltarDataAntesDeAbrir();
      setAba("lancar");
      irPara(1);
    };
    if (temNaoGravado) {
      setPergunta({
        titulo: "Trocar a matrícula?",
        texto: `O lançamento ${rotuloDasOS(lanc.ordens)} ainda não foi gravado e será descartado.`,
        botao: "Trocar",
        perigo: true,
        acao: fazer,
      });
    } else fazer();
  }

  // ------------------------------------------------------------------ passo 2: O.S. e operação

  // o passo 2 acrescenta ao lançamento as operações marcadas na janela da O.S. (pelo menu dos passos também: a outra
  // operação da mesma O.S. entra sem tirar a que já está) ou, pelo "Trocar" de um bloco, escolhe a O.S./operação que
  // entra no lugar dela
  const alvoTroca = escolha?.modo === "trocar" ? (lanc.ordens.find((o) => o.chave === escolha.chave) ?? null) : null;
  const acrescentando = !alvoTroca;
  const noLancamento = useMemo(() => new Set(lanc.ordens.map((o) => `${o.os}|${o.opCod}`)), [lanc.ordens]);
  // os apontamentos do lançamento aberto para editar (marcados "em edição" nos lançamentos da O.S.)
  const emEdicao = useMemo(() => new Set(lanc.ids ?? []), [lanc.ids]);

  /** Janela da O.S. (passo 2): as operações para marcar e os lançamentos dela, buscados de novo a cada vez que abre. */
  function abrirJanelaOS(ordem) {
    setMsg(null);
    setJanelaOS({ os: ordem.os, ordem });
    carregarHistorico(ordem.os, true);
  }

  /**
   * Acrescenta ao lançamento as operações marcadas na janela da O.S., cada uma num bloco (com os talhões e o boletim
   * dela), como o "Adicionar outra O.S." uma a uma: a que já está no lançamento não entra de novo; a do lançamento aberto
   * que foi tirada nesta edição volta com o boletim e os talhões gravados nele; a 1ª do lançamento dá os padrões do
   * cabeçalho; as operações da mesma O.S. levam o mesmo status.
   */
  function acrescentarOperacoes(ordemLista, lista) {
    const l0 = lancRef.current;
    const mesma = (o, op) => o.os === ordemLista.os && o.opCod === op.cod;
    const novas = lista.filter((op, i) => !l0.ordens.some((o) => mesma(o, op)) && lista.findIndex((x) => x.cod === op.cod) === i);
    if (novas.length === 0) {
      if (!l0.ordens.length) return;
      setEscolha(null);
      return irPara(3);
    }
    if (l0.ordens.length + novas.length > MAX_ORDENS) return setMsg({ texto: `No máximo ${MAX_ORDENS} O.S. por lançamento.`, erro: true });
    const primeira = l0.ordens.length === 0;
    const voltas = novas.map((op) => (l0.removidas ?? []).find((x) => mesma(x, op)) ?? null);
    const statusDaOS = l0.ordens.find((o) => o.os === ordemLista.os)?.statusOS ?? voltas.find(Boolean)?.statusOS ?? STATUS_INICIAL;
    const emCache = (op) => infosRef.current[chaveInfo({ os: ordemLista.os, opCod: op.cod })]?.info ?? null;
    const blocos = novas.map((op, i) => {
      const chave = novaChaveOrdem();
      const volta = voltas[i];
      if (!volta) return { ...ORDEM_VAZIA, chave, os: ordemLista.os, opCod: op.cod, statusOS: statusDaOS };
      // volta com os talhões gravados no boletim (os marcados antes de tirar foram descartados); sem eles, como estava
      const base = { ...volta, chave, statusOS: statusDaOS };
      const comGravados = volta.gravados ? { ...base, marcas: {}, extras: [], pendentes: volta.gravados } : base;
      const cache = emCache(op);
      return comGravados.pendentes && cache ? encaixarTalhoes(comGravados, comGravados.pendentes, cache.talhoes) : comGravados;
    });
    // padrões do cabeçalho: os da 1ª operação quando o lançamento estava vazio (dos talhões já buscados ou da lista,
    // até os talhões chegarem), só onde o campo está em branco ou ainda com o padrão anterior
    const cache0 = primeira ? emCache(novas[0]) : null;
    const novos = !primeira
      ? null
      : cache0
        ? padroesDaInfo(cache0)
        : { atividade: novas[0].ds ?? "", solicitante: ordemLista.resp ?? "", etapaCod: novas[0].etapaCod ?? "", modelo: novas[0].modelo ?? "", tipoAplicacao: "" };
    const anteriores = padroes.current;
    const idsVolta = new Set(voltas.filter(Boolean).map((v) => v.id));
    setLanc((l) => ({
      ...l,
      ordens: [...l.ordens, ...blocos],
      removidas: (l.removidas ?? []).filter((x) => !idsVolta.has(x.id)),
      servico: novos ? aplicarPadroes(l.servico, anteriores, novos) : l.servico,
    }));
    if (novos) padroes.current = novos;
    // a 1ª acrescentada fica aberta e as outras recolhidas
    setAbertas({ [blocos[0].chave]: true });
    setEscolha(null);
    setRascunho(null);
    const vol = voltas.filter(Boolean);
    setMsg(
      vol.length
        ? {
            texto: vol
              .map(
                (v) =>
                  `A O.S. ${v.os} (operação ${v.opCod}) voltou ao lançamento com o boletim nº ${v.boletim}${v.gravados ? " e os talhões gravados nele" : ""}: ele não será mais excluído.`,
              )
              .join("\n"),
            erro: false,
          }
        : null,
    );
    irPara(3);
  }

  function lancarDaJanela(ordemLista, ops) {
    setJanelaOS(null);
    acrescentarOperacoes(ordemLista, ops);
  }

  function escolherDaJanela(ordemLista, op) {
    setJanelaOS(null);
    escolherOperacao(ordemLista, op);
  }

  function escolherOperacao(ordemLista, op) {
    const alvo = alvoTroca;
    const mesma = (o) => o.os === ordemLista.os && o.opCod === op.cod;
    if (alvo && mesma(alvo)) {
      setEscolha(null);
      setAbertas((a) => ({ ...a, [alvo.chave]: true }));
      return irPara(3);
    }
    // a mesma O.S. com a mesma operação não entra duas vezes no lançamento (com outra operação, pode): abre a que já está
    const repetida = lanc.ordens.find((o) => o !== alvo && mesma(o));
    if (repetida) {
      setEscolha(null);
      setAbertas((a) => ({ ...a, [repetida.chave]: true }));
      setMsg({ texto: `A O.S. ${ordemLista.os} com a operação ${op.cod} já está neste lançamento.`, erro: true });
      return irPara(3);
    }
    if (!alvo && lanc.ordens.length >= MAX_ORDENS) return setMsg({ texto: `No máximo ${MAX_ORDENS} O.S. por lançamento.`, erro: true });
    // só a 1ª O.S. dá os padrões do cabeçalho
    const primeira = alvo ? lanc.ordens[0]?.chave === alvo.chave : lanc.ordens.length === 0;
    // a O.S. que já está no lançamento com outra operação leva o mesmo status
    const statusDaOS = lanc.ordens.find((o) => o !== alvo && o.os === ordemLista.os)?.statusOS;
    const chave = alvo?.chave ?? novaChaveOrdem();
    const fazer = () => {
      // talhões desta O.S./operação já buscados (voltando a ela): os padrões vêm deles, como quando chegam (buscarInfo);
      // senão, os da lista do passo 2 até os talhões chegarem
      const emCache = infosRef.current[chaveInfo({ os: ordemLista.os, opCod: op.cod })]?.info ?? null;
      // padrões da O.S. nova só onde o campo está em branco ou ainda com o padrão da anterior
      const novos = emCache
        ? padroesDaInfo(emCache)
        : { atividade: op.ds ?? "", solicitante: ordemLista.resp ?? "", etapaCod: op.etapaCod ?? "", modelo: op.modelo ?? "", tipoAplicacao: "" };
      // cópia dos padrões da anterior: o React pode calcular a função do setLanc só na próxima renderização, quando
      // padroes.current já é o da operação nova
      const anteriores = padroes.current;
      // a O.S./operação do lançamento aberto que foi tirada nesta edição volta com o apontamento (o boletim) e os talhões
      // gravados nele; o bloco que já tem apontamento (trocando) fica com o dele
      const volta = alvo?.id ? null : ((lancRef.current.removidas ?? []).find((x) => mesma(x)) ?? null);
      setLanc((l) => {
        const antiga = l.ordens.find((o) => o.chave === chave);
        let nova;
        if (volta) {
          const base = { ...volta, chave, statusOS: statusDaOS ?? volta.statusOS ?? STATUS_INICIAL };
          // os talhões gravados no boletim (os marcados antes de tirar foram descartados); sem eles, como estava
          const comGravados = volta.gravados ? { ...base, marcas: {}, extras: [], pendentes: volta.gravados } : base;
          nova = comGravados.pendentes && emCache ? encaixarTalhoes(comGravados, comGravados.pendentes, emCache.talhoes) : comGravados;
        } else {
          // trocando, o apontamento (na edição) e o status ficam; os talhões marcados (e os gravados, de outra O.S.) saem
          nova = {
            ...(antiga ?? ORDEM_VAZIA),
            chave,
            os: ordemLista.os,
            opCod: op.cod,
            marcas: {},
            extras: [],
            pendentes: null,
            gravados: null,
            statusOS: statusDaOS ?? antiga?.statusOS ?? STATUS_INICIAL,
          };
        }
        return {
          ...l,
          ordens: antiga ? l.ordens.map((o) => (o.chave === chave ? nova : o)) : [...l.ordens, nova],
          removidas: volta ? (l.removidas ?? []).filter((x) => x.id !== volta.id) : l.removidas,
          servico: primeira ? aplicarPadroes(l.servico, anteriores, novos) : l.servico,
        };
      });
      if (primeira) padroes.current = novos;
      // a O.S. acrescentada fica aberta e as outras recolhidas
      setAbertas((a) => (alvo ? { ...a, [chave]: true } : { [chave]: true }));
      setEscolha(null);
      setRascunho(null);
      setMsg(
        volta
          ? {
              texto: `A O.S. ${volta.os} (operação ${volta.opCod}) voltou ao lançamento com o boletim nº ${volta.boletim}${volta.gravados ? " e os talhões gravados nele" : ""}: ele não será mais excluído.`,
              erro: false,
            }
          : null,
      );
      irPara(3);
    };
    const n = alvo ? Object.keys(alvo.marcas).length + alvo.extras.length : 0;
    if (n > 0 && !resultado) {
      setPergunta({
        titulo: "Trocar a O.S. / operação?",
        texto: `${plural(n, "talhão marcado", "talhões marcados")} da O.S. ${alvo.os} (operação ${alvo.opCod}) ${n === 1 ? "será desmarcado" : "serão desmarcados"}.`,
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

  // ------------------------------------------------------------------ passo 3: talhões de cada O.S.

  /** Muda uma O.S. do lançamento (talhões marcados, áreas, fora da O.S.). */
  const mudarOrdem = useCallback((chave, f) => setLanc((l) => ({ ...l, ordens: l.ordens.map((o) => (o.chave === chave ? f(o) : o)) })), []);
  /** Status da O.S.: vale para todas as operações dela no lançamento. */
  const mudarStatus = useCallback(
    (chave, v) =>
      setLanc((l) => {
        const os = l.ordens.find((o) => o.chave === chave)?.os;
        return { ...l, ordens: l.ordens.map((o) => (o.os === os ? { ...o, statusOS: v } : o)) };
      }),
    [],
  );
  const alternarBloco = useCallback((chave) => setAbertas((a) => ({ ...a, [chave]: !a[chave] })), []);
  // busca de novo (os talhões que já estavam à vista ficam até chegar os novos)
  const tentarDeNovo = useCallback((o) => setInfos((m) => ({ ...m, [chaveInfo(o)]: { ...m[chaveInfo(o)], dt: null, erro: null } })), []);

  function trocarOrdem(chave) {
    setEscolha({ modo: "trocar", chave });
    setMsg(null);
    irPara(2);
  }

  function adicionarOS() {
    setEscolha({ modo: "adicionar" });
    setMsg(null);
    irPara(2);
  }

  function removerOrdem(chave) {
    const o = lanc.ordens.find((x) => x.chave === chave);
    if (!o) return;
    const fazer = () => {
      const atuais = lancRef.current.ordens;
      // saindo a 1ª O.S., o cabeçalho passa a ter os padrões da seguinte (onde ainda estava com os da que saiu); sem os
      // talhões dela ainda (carregando, erro), os padrões entram quando eles chegarem (buscarInfo)
      const seguinte = atuais[0]?.chave === chave ? atuais[1] : null;
      const infoSeguinte = seguinte ? infosRef.current[chaveInfo(seguinte)]?.info : null;
      const novos = infoSeguinte ? padroesDaInfo(infoSeguinte) : null;
      const anteriores = padroes.current;
      setLanc((l) => {
        const saiu = l.ordens.find((x) => x.chave === chave);
        return {
          ...l,
          ordens: l.ordens.filter((x) => x.chave !== chave),
          // a O.S. com o apontamento do lançamento aberto fica guardada (como estava) para voltar com o boletim
          removidas: saiu?.id ? [...(l.removidas ?? []).filter((x) => x.id !== saiu.id), saiu] : (l.removidas ?? []),
          servico: novos ? aplicarPadroes(l.servico, anteriores, novos) : l.servico,
        };
      });
      if (novos) padroes.current = novos;
      setAbertas((a) => sem(a, chave));
      setMsg(null);
    };
    const n = Object.keys(o.marcas).length + o.extras.length;
    if (n > 0 || o.id) {
      setPergunta({
        titulo: "Tirar a O.S. do lançamento?",
        texto: [
          `O.S. ${o.os} (operação ${o.opCod})${n ? `: ${plural(n, "talhão marcado", "talhões marcados")} ${n === 1 ? "será descartado" : "serão descartados"}` : ""}.`,
          o.id
            ? `O boletim nº ${o.boletim} será excluído ao gravar a alteração (se a O.S. com a operação ${o.opCod} voltar ao lançamento antes disso, volta com o boletim e os talhões dele).`
            : "",
        ]
          .filter(Boolean)
          .join("\n"),
        botao: "Tirar",
        perigo: true,
        acao: fazer,
      });
    } else fazer();
  }

  // ------------------------------------------------------------------ passo 4: dados do serviço

  const upd = useCallback((p) => setLanc((l) => ({ ...l, servico: { ...l.servico, ...p } })), []);
  const s = lanc.servico;
  const ops = useMemo(() => resumo.map((r) => r.info?.operacao).filter(Boolean), [resumo]);
  const statusOpcoes = opcoes?.statusOS?.length ? opcoes.statusOS : STATUS_PADRAO;
  // status por O.S. (a O.S. com mais de uma operação no lançamento tem um só) e o que falta nela depois do lançamento
  const statusPorOS = useMemo(() => {
    const m = new Map();
    lanc.ordens.forEach((o, i) => {
      const r = resumo[i];
      let x = m.get(o.os);
      if (!x) {
        x = { os: o.os, chave: o.chave, valor: o.statusOS, falta: 0, prontas: true, nTalhoes: 0, nOps: 0 };
        m.set(o.os, x);
      }
      if (r.faltaDepois === null) x.prontas = false;
      else x.falta = round2(x.falta + r.faltaDepois);
      x.nTalhoes += r.linhas.length;
      x.nOps += 1;
    });
    return [...m.values()].map((x) => ({ ...x, falta: x.prontas ? x.falta : null }));
  }, [lanc.ordens, resumo]);

  // ------------------------------------------------------------------ gravar

  /**
   * O.S. do lançamento cujos talhões ainda não chegaram (carregando ou com erro): o aviso diz qual e por quê, e o bloco
   * dela abre (com erro, volta aos talhões, onde está o "Tentar de novo"). false: todas prontas.
   */
  function avisarSemTalhoes() {
    const i = resumo.findIndex((r) => !r.info);
    if (i < 0) return false;
    const o = lanc.ordens[i];
    const qual = varias ? `da O.S. ${o.os} (operação ${o.opCod})` : "da O.S.";
    setAbertas((a) => ({ ...a, [o.chave]: true }));
    if (resumo[i].erro) {
      if (passo !== 3) irPara(3);
      setMsg({ texto: `Os talhões ${qual} não carregaram: toque em “Tentar de novo”${varias ? " no bloco dela" : ""}.`, erro: true });
    } else setMsg({ texto: `Espere os talhões ${qual} carregarem.`, erro: true });
    return true;
  }

  async function gravar(confirmar = false) {
    setMsg(null);
    if (!pode) return setMsg({ texto: "Seu perfil é somente leitura: dá para consultar, mas não gravar.", erro: true });
    if (!matAtual) return irPara(1);
    if (!lanc.ordens.length) return setMsg({ texto: "Escolha a O.S. e a operação e espere os talhões carregarem.", erro: true });
    if (avisarSemTalhoes()) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dt)) {
      irPara(4);
      return setMsg({ texto: "Informe a data da operação.", erro: true });
    }
    // com várias O.S., o erro diz qual e abre o bloco dela
    for (const [i, o] of lanc.ordens.entries()) {
      const { linhas } = resumo[i];
      const naOS = varias ? ` da O.S. ${o.os} (operação ${o.opCod})` : "";
      if (linhas.length === 0) {
        setAbertas((a) => ({ ...a, [o.chave]: true }));
        irPara(3);
        return setMsg({ texto: `Marque pelo menos um talhão realizado${naOS}.`, erro: true });
      }
      const ruim = linhas.find((l) => !(lerNumero(l.texto) > 0));
      if (ruim) {
        setAbertas((a) => ({ ...a, [o.chave]: true }));
        irPara(3);
        return setMsg({ texto: `Informe a área realizada do ${rotTalhao(ruim.tlh)} da fazenda ${ruim.propCod}${naOS} (ou desmarque o talhão).`, erro: true });
      }
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
    // o tipo digitado agora há pouco não estava no cadastro (o campo ficou em branco): avisa uma vez antes de gravar sem ele
    if (tipoRecusado && !String(s.tipoAplicacao ?? "").trim()) {
      setTipoRecusado(null);
      irPara(4);
      return setMsg({
        texto: `O tipo de aplicação “${tipoRecusado}” não está no cadastro Tipo Aplicação e o campo ficou em branco. Escolha um tipo da lista (ou toque em Gravar de novo para gravar sem ele).`,
        erro: true,
      });
    }
    // solicitante, etapa e tipo de aplicação: com várias O.S., o do cabeçalho mudado à mão vale para todas e, sem
    // mudança, cada O.S. leva o dela (o responsável da O.S., a etapa e o tipo da operação)
    const aMao = (k) => !!String(s[k] ?? "").trim() && s[k] !== padroes.current[k];
    const ordens = lanc.ordens.map((o, i) => {
      const info = resumo[i].info;
      const opi = info.operacao ?? {};
      return {
        ...(o.id ? { id: o.id } : {}),
        os: o.os,
        opCod: o.opCod,
        statusOS: o.statusOS,
        solicitante: (varias && !aMao("solicitante") ? info.resp || s.solicitante : s.solicitante).trim(),
        etapaCod: varias && !aMao("etapaCod") ? opi.etapaCod || s.etapaCod : s.etapaCod,
        tipoAplicacao: (varias && !aMao("tipoAplicacao") ? opi.tipoDs || s.tipoAplicacao : s.tipoAplicacao).trim(),
        talhoes: resumo[i].linhas.map((l) => ({ propCod: l.propCod, tlh: l.tlh, area: lerNumero(l.texto) })),
      };
    });
    setGravando(true);
    const { ok, status, json } = await enviar({
      // edição: o lançamento aberto e os boletins que ele tinha ao abrir (o servidor não exclui o que entrou depois)
      ...(lanc.id ? { id: lanc.id, boletins: lanc.boletins } : {}),
      dt,
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
      // calda/insumo gasto do lançamento: o servidor rateia entre as O.S. pela área
      volCalda: calda,
      unCalda: s.unCalda === "kg" ? "kg" : "L",
      obs: s.obs.trim(),
      ordens,
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
    const boletins = Array.isArray(json.boletins) && json.boletins.length ? json.boletins : json.boletim ? [json.boletim] : [];
    let texto = typeof json.texto === "string" ? json.texto : "";
    if (!texto && boletins[0]) texto = (await obter({ bol: String(boletins[0]) })).json?.texto ?? "";
    setGravando(false);
    for (const b of [...boletins, ...lanc.boletins]) cacheBol.current.delete(b);
    limparRascunho();
    setResultado({
      id: json.id,
      boletins,
      texto,
      avisos: Array.isArray(json.avisos) ? json.avisos : [],
      editado: !!lanc.id,
      ordens: lanc.ordens.map((o, i) => {
        const opi = resumo[i].info?.operacao;
        return { os: o.os, op: opi ? `${opi.cod} - ${opi.ds}` : o.opCod };
      }),
      area: total,
      dt,
    });
    focarPasso.current = true;
    // o que falta das O.S. e os lançamentos delas mudam com o lançamento
    buscarOS(matAtual, dt);
    esquecerHistorico();
  }

  function novoLancamento() {
    limparRascunho();
    setResultado(null);
    // a mesma O.S. de novo traz os talhões com o que acabou de ser lançado
    zerarLancamento();
    setMsg(null);
    // mantém a data do lançamento; depois de editar um boletim (ou terminar um rascunho) de outro dia, volta à de antes
    voltarDataAntesDeAbrir();
    irPara(2);
  }

  // ------------------------------------------------------------------ meus lançamentos / edição

  /** Consulta de Meus lançamentos no período escolhido (Todos: sem datas), a partir de `offset` lançamentos. */
  const paramsMeus = useCallback(
    (offset) => ({
      meus: "1",
      mat: matAtual,
      ...(diasMeus > 0 ? { de: addDays(hoje, -(diasMeus - 1)), ate: hoje } : {}),
      ...(offset > 0 ? { offset: String(offset) } : {}),
    }),
    [matAtual, hoje, diasMeus],
  );

  /** Primeira página de Meus lançamentos (trocar o período ou atualizar recomeça a lista). */
  const carregarMeus = useCallback(async () => {
    if (!matAtual || !hoje) return;
    const seq = ++seqMeus.current;
    setMeus((m) => ({ ...m, carregando: true, carregandoMais: false, erro: null }));
    const { ok, json } = await obter(paramsMeus(0));
    if (seq !== seqMeus.current) return;
    if (!ok) setMeus({ lista: null, carregando: false, carregandoMais: false, erro: json.error ?? "Não foi possível carregar os lançamentos.", mais: false });
    else setMeus({ lista: Array.isArray(json.apontamentos) ? json.apontamentos : [], carregando: false, carregandoMais: false, erro: null, mais: !!json.mais });
  }, [matAtual, hoje, paramsMeus]);

  /** Próxima página: soma à lista (sem repetir o lançamento que já está nela, se a lista andou entre as páginas). */
  async function carregarMaisMeus() {
    const lista = meus.lista;
    if (!lista || !meus.mais || meus.carregando || meus.carregandoMais) return;
    // não conta uma busca nova: atualizar ou trocar o período no meio passa na frente desta
    const seq = seqMeus.current;
    setMeus((m) => ({ ...m, carregandoMais: true, erro: null }));
    const { ok, json } = await obter(paramsMeus(lista.length));
    if (seq !== seqMeus.current) return;
    if (!ok) return setMeus((m) => ({ ...m, carregandoMais: false, erro: json.error ?? "Não foi possível carregar mais lançamentos." }));
    const novos = Array.isArray(json.apontamentos) ? json.apontamentos : [];
    setMeus((m) => {
      const ja = new Set((m.lista ?? []).map((a) => a.id));
      return { ...m, carregandoMais: false, lista: [...(m.lista ?? []), ...novos.filter((a) => !ja.has(a.id))], mais: !!json.mais };
    });
  }

  useEffect(() => {
    if (aba === "meus") carregarMeus();
  }, [aba, carregarMeus]);

  /**
   * Lançamento do boletim com o texto do WhatsApp (o texto fica guardado nesta visita; `fresco` busca de novo, para
   * editar). Com várias O.S., vêm todos os apontamentos dele, de qualquer um dos boletins.
   */
  async function carregarBoletim(bol, fresco = false) {
    if (!fresco && cacheBol.current.has(bol)) return cacheBol.current.get(bol);
    setAbrindo(bol);
    const { ok, json } = await obter({ bol: String(bol) });
    setAbrindo(null);
    if (!ok || !json.apontamento) {
      setMsg({ texto: json.error ?? `Não foi possível abrir o boletim nº ${bol}.`, erro: true });
      return null;
    }
    const apontamentos = Array.isArray(json.apontamentos) && json.apontamentos.length ? json.apontamentos : [json.apontamento];
    const r = { apontamento: apontamentos[0], apontamentos, texto: typeof json.texto === "string" ? json.texto : "" };
    for (const a of apontamentos) cacheBol.current.set(a.boletim, r);
    cacheBol.current.set(bol, r);
    return r;
  }

  /**
   * Abre o lançamento do boletim para editar (o "Já apontado" sem contar os boletins dele). `aoAbrir`: chamado quando ele
   * abre de fato (depois da pergunta, se houver lançamento não gravado). false: o boletim não carregou (a mensagem diz).
   */
  async function editarBoletim(bol, aoAbrir) {
    if (!pode) return false;
    setMsg(null);
    const r = await carregarBoletim(bol, true);
    if (!r) return false;
    const grupo = r.apontamentos;
    const a = grupo[0];
    const fazer = () => {
      aoAbrir?.();
      limparRascunho();
      setResultado(null);
      setDetalhe(null);
      if (dtAntesDeAbrir.current === null) dtAntesDeAbrir.current = dt;
      setDt(a.dt);
      // recarrega os talhões mesmo se for a mesma O.S. (agora sem contar o boletim) — e mesmo se for o lançamento que já
      // está aberto
      zerarLancamento();
      const ordens = grupo.map((x) => ({
        ...ORDEM_VAZIA,
        chave: novaChaveOrdem(),
        id: x.id,
        boletim: x.boletim,
        os: String(x.os ?? ""),
        opCod: String(x.opCod ?? ""),
        statusOS: x.statusOS ?? "",
        pendentes: x.talhoes ?? [],
        gravados: x.talhoes ?? [],
      }));
      setLanc({
        ...LANC_VAZIO,
        id: a.id,
        ids: grupo.map((x) => x.id),
        boletins: grupo.map((x) => x.boletim),
        ordens,
        servico: servicoDoLancamento(grupo),
      });
      setAbertas(ordens.length ? { [ordens[0].chave]: true } : {});
      setAba("lancar");
      irPara(3);
    };
    if (temNaoGravado) {
      const mesmo = lanc.id !== null && grupo.some((x) => x.id === lanc.id);
      setPergunta({
        titulo: mesmo ? (lanc.boletins.length > 1 ? "Abrir de novo o lançamento?" : "Abrir de novo o boletim?") : "Abrir outro lançamento?",
        texto: mesmo
          ? `As alterações ${doBoletins(lanc.boletins)} que ainda não foram gravadas serão descartadas.`
          : `O lançamento ${rotuloDasOS(lanc.ordens)} ainda não foi gravado e será descartado.`,
        botao: "Abrir para editar",
        perigo: true,
        acao: fazer,
      });
    } else fazer();
    return true;
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
    const boletins = r.apontamentos.map((x) => x.boletim);
    if (await copiarParaAreaDeTransferencia(r.texto)) setMsg({ texto: `Texto ${doBoletins(boletins)} copiado. Abra o grupo do WhatsApp e cole.`, erro: false });
    else {
      focarPasso.current = true;
      setDetalhe(r);
    }
  }

  // ------------------------------------------------------------------ tela

  // texto do WhatsApp na tela (resultado da gravação ou lançamento aberto em Meus lançamentos): rodapé com Copiar e Enviar
  const textoAberto = aba === "lancar" && resultado ? (resultado.texto ?? "") : aba === "meus" && detalhe ? (detalhe.texto ?? "") : null;
  const alcancavel = (n) => n === 1 || (n === 2 && !!minhas) || (n >= 3 && lanc.ordens.length > 0 && !!minhas);
  /** Situação da O.S. e descrição da operação como vieram na lista do passo 2 (até os talhões chegarem). */
  const daLista = (o) => {
    const x = minhas?.ordens?.find((y) => y.os === o.os);
    return { situacao: x?.situacao, opDs: x?.operacoes?.find((y) => y.cod === o.opCod)?.ds ?? "" };
  };
  const infoDe = (o) => infos[chaveInfo(o)]?.info ?? null;
  const dsDe = (o) => infoDe(o)?.operacao?.ds ?? daLista(o).opDs;
  const situacaoDe = (o) => infoDe(o)?.situacao ?? daLista(o).situacao;
  const doDetalhe = detalhe?.apontamentos ?? [];
  const boletinsResultado = resultado?.boletins ?? [];

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
                      onClick={() => {
                        // pelo menu, o passo 2 acrescenta (o "Trocar" de um bloco é que troca a O.S. dele)
                        if (p.n === 2) setEscolha(null);
                        irPara(p.n);
                      }}
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
              titulo={tituloBoletins(doDetalhe.map((x) => x.boletim))}
              linha={[
                fmtDateBR(detalhe.apontamento.dt),
                `O.S. ${unicos(doDetalhe.map((x) => x.os)).join(", ")}`,
                unicos(doDetalhe.map((x) => `${x.opCod}${x.opDs ? ` - ${x.opDs}` : ""}`)).join(", "),
                `${nf(round2(doDetalhe.reduce((a, x) => a + (Number.isFinite(x.areaTotal) ? x.areaTotal : 0), 0)))} ha`,
                statusResumo(doDetalhe),
              ]
                .filter(Boolean)
                .join(" · ")}
              boletins={doDetalhe.map((x) => x.boletim)}
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
              onMais={carregarMaisMeus}
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
              titulo={`${resultado.editado ? "Alterado" : "Lançado"} — ${tituloBoletins(boletinsResultado)}`}
              linha={`${resultado.ordens.map((o) => `O.S. ${o.os} · ${o.op}`).join("; ")} · ${fmtDateBR(resultado.dt)} · ${nf(resultado.area)} ha`}
              sucesso
              avisos={resultado.avisos}
              boletins={boletinsResultado}
              texto={resultado.texto}
              caixaRef={caixaTexto}
              acoes={
                <>
                  <button
                    type="button"
                    className={`${BOTAO} !h-12 leading-tight`}
                    onClick={() => editarBoletim(boletinsResultado[0])}
                    disabled={!pode || abrindo !== null || !boletinsResultado.length}
                  >
                    <IconEditar size={16} /> {abrindo !== null && abrindo === boletinsResultado[0] ? "Abrindo…" : "Editar este lançamento"}
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
                <CampoQuem
                  id="lm-mat"
                  valor={matDigitada}
                  onValor={setMatDigitada}
                  onEscolher={(r) => {
                    const m = String(r.matricula ?? "").trim();
                    setMatDigitada(m);
                    buscarMatricula(null, m);
                  }}
                />
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
              {/* acrescentando outra O.S. (ou trocando a de um bloco, com várias): o que já está no lançamento */}
              {lanc.ordens.length > 0 && (acrescentando || varias) && (
                <div role="status" className="rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-[13px] text-brand-700">
                  <p className="font-semibold">
                    {alvoTroca ? `Trocar a O.S. ${alvoTroca.os} (operação ${alvoTroca.opCod})` : "Acrescentar outra O.S. ao lançamento"}
                  </p>
                  <p className="mt-0.5">
                    {alvoTroca
                      ? "Toque na O.S. e escolha a operação que entra no lugar dela."
                      : `Já no lançamento: ${lanc.ordens.map((o) => `O.S. ${o.os} · ${o.opCod}`).join("; ")}. Toque na O.S. e marque as operações: pode ser outra O.S. ou outra operação da mesma.`}
                  </p>
                  <button
                    type="button"
                    className={`${BOTAO_MENOR} mt-2`}
                    onClick={() => {
                      setEscolha(null);
                      irPara(3);
                    }}
                  >
                    Voltar aos talhões
                  </button>
                </div>
              )}
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
              {!buscandoOS && ordensFiltradas.length > 0 && (
                <div className="space-y-3">
                  <LegendaCores />
                  {ordensFiltradas.map((o) => (
                    <CartaoOS key={o.os} ordem={o} noLancamento={noLancamento} selo={varias || (acrescentando && lanc.ordens.length > 0)} onAbrir={abrirJanelaOS} />
                  ))}
                </div>
              )}
            </section>
          ) : passo === 3 ? (
            <section aria-labelledby="lm-p3" className="space-y-3">
              <h2 id="lm-p3" ref={tituloPasso} tabIndex={-1} className={TITULO_PASSO}>
                Talhões realizados
              </h2>
              {lanc.id && (
                <p className="rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-[13px] text-brand-700">
                  Editando {lanc.boletins.length > 1 ? "os" : "o"} {rotBoletins(lanc.boletins)}. O “Já apontado” e o “Falta” não contam{" "}
                  {lanc.boletins.length > 1 ? "estes boletins" : "este boletim"}.
                </p>
              )}
              {varias && resumo.some((r) => r.info) && <CaixaSoFalta checked={soFalta} onChange={setSoFalta} />}
              {lanc.ordens.map((o, i) => (
                <BlocoOrdem
                  key={o.chave}
                  ordem={o}
                  r={resumo[i]}
                  dt={dt}
                  unica={!varias}
                  aberto={!!abertas[o.chave]}
                  soFalta={soFalta}
                  onSoFalta={setSoFalta}
                  opDs={dsDe(o)}
                  situacao={situacaoDe(o)}
                  statusOpcoes={statusOpcoes}
                  onAlternar={alternarBloco}
                  onRemover={removerOrdem}
                  onTrocar={trocarOrdem}
                  onMudar={mudarOrdem}
                  onTentar={tentarDeNovo}
                  onStatus={mudarStatus}
                  hist={historico[o.os]}
                  emEdicao={emEdicao}
                  onHistorico={carregarHistorico}
                  onAbrirLancamento={abrirConsulta}
                />
              ))}
              {lanc.ordens.length > 0 && lanc.ordens.length < MAX_ORDENS && (
                <div>
                  <button type="button" className={`${BOTAO} w-full border-dashed`} onClick={adicionarOS}>
                    <IconMais size={18} /> Adicionar outra O.S.
                  </button>
                  {!varias && (
                    <p className="mt-1 text-center text-[12px] text-muted">
                      Outra O.S. (ou outra operação desta) no mesmo lançamento: o mesmo cabeçalho, um boletim para cada.
                    </p>
                  )}
                </div>
              )}
            </section>
          ) : (
            <section aria-labelledby="lm-p4" className="space-y-3">
              <h2 id="lm-p4" ref={tituloPasso} tabIndex={-1} className={TITULO_PASSO}>
                Dados do serviço
              </h2>
              {varias ? (
                <ResumoLancamento ordens={lanc.ordens} resumo={resumo} dsDe={dsDe} dt={dt} onTalhoes={() => irPara(3)} />
              ) : lanc.ordens[0] ? (
                <ResumoEscolha
                  os={lanc.ordens[0].os}
                  opCod={lanc.ordens[0].opCod}
                  opDs={dsDe(lanc.ordens[0])}
                  situacao={situacaoDe(lanc.ordens[0])}
                  dt={dt}
                  onTrocar={() => trocarOrdem(lanc.ordens[0].chave)}
                  compacto
                />
              ) : null}
              <DadosServico
                s={s}
                upd={upd}
                dt={dt}
                hoje={hoje}
                onDt={setDt}
                ops={ops}
                opcoes={opcoes}
                varias={varias}
                statusPorOS={statusPorOS}
                statusOpcoes={statusOpcoes}
                onStatus={mudarStatus}
                onTipoRecusado={setTipoRecusado}
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
              <div className="truncate text-[12px] leading-tight text-muted">
                Área total · {varias ? `${contarOSOperacoes(lanc.ordens)} · ` : ""}
                {plural(nLinhas, "talhão", "talhões")}
              </div>
              <div className="font-display text-[25px] font-semibold leading-tight tabular text-ink">
                {nf(total)} <span className="font-sans text-[13px] font-normal text-muted">ha</span>
              </div>
            </div>
            {/* sem os talhões de alguma O.S. (carregando, erro), o toque diz qual e abre o bloco dela */}
            {passo === 3 ? (
              <button
                type="button"
                className={`${BOTAO_PRIMARIO} ${todasProntas ? "" : "opacity-60"}`}
                onClick={() => avisarSemTalhoes() || irPara(4)}
                aria-disabled={!todasProntas || undefined}
              >
                Dados do serviço <IconSetaDireita size={18} />
              </button>
            ) : (
              <button
                type="button"
                className={`${BOTAO_PRIMARIO} ${todasProntas ? "" : "opacity-60"}`}
                onClick={() => gravar(false)}
                disabled={gravando || !pode}
                aria-disabled={!todasProntas || undefined}
              >
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

      {janelaOS && (
        <JanelaOS
          key={janelaOS.os}
          ordem={minhas?.ordens?.find((o) => o.os === janelaOS.os) ?? janelaOS.ordem}
          trocar={alvoTroca}
          noLancamento={noLancamento}
          nNoLancamento={lanc.ordens.length}
          hist={historico[janelaOS.os]}
          emEdicao={emEdicao}
          onLancar={lancarDaJanela}
          onEscolher={escolherDaJanela}
          onAbrirLancamento={abrirConsulta}
          onRecarregarHist={carregarHistorico}
          onFechar={() => setJanelaOS(null)}
        />
      )}
      {consulta && (
        <JanelaConsulta consulta={consulta} matAtual={matAtual} pode={pode} abrindo={abrindo} onEditar={editarDaConsulta} onFechar={fecharConsulta} />
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
  const l = r.lanc ?? {};
  // o rascunho da primeira versão da tela (v1) tinha uma O.S. só
  const ordens = r.v === 1 ? [{ os: l.os, opCod: l.opCod, marcas: l.marcas, extras: l.extras }] : (l.ordens ?? []);
  const boletins = r.v === 1 ? [l.boletim] : (l.boletins ?? []);
  const n = ordens.reduce((a, o) => a + Object.keys(o.marcas ?? {}).length + (o.extras ?? []).length, 0);
  return (
    <div role="status" className="rounded-lg border border-amber-500/40 bg-amber-50 p-3 text-[13px] text-amber-600">
      <p className="font-semibold">Lançamento não gravado neste aparelho</p>
      <p className="mt-0.5">
        {l.id ? `Edição ${doBoletins(boletins)}` : "Lançamento novo"} · {ordens.map((o) => `O.S. ${o.os} · operação ${o.opCod}`).join("; ")} ·{" "}
        {fmtDateBR(r.dt)}
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

function SeloConcluida() {
  return <span className="rounded-full border border-good-500/40 bg-good-50 px-2 py-px text-[11px] font-semibold text-good-600">Concluída</span>;
}

function SeloNoLancamento({ children = "no lançamento" }) {
  return <span className="inline-block rounded-full bg-brand-50 px-1.5 py-px align-middle text-[11px] font-semibold text-brand-700">{children}</span>;
}

/** Legenda das cores dos cartões de O.S. e das linhas de operação. */
function LegendaCores() {
  return (
    <div className="space-y-0.5">
      <p className="text-[12.5px] text-muted">Toque na O.S. para marcar as operações e ver os lançamentos dela.</p>
      <ul aria-label="Cores das O.S." className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-muted">
        {["nenhum", "andamento", "concluida"].map((e) => (
          <li key={e} className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className={`h-3 w-3 rounded-[3px] border ${COR_ESTADO[e].borda} ${COR_ESTADO[e].fundo || "bg-card"}`} />
            {COR_ESTADO[e].rotulo}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Uma operação da O.S. (no cartão e na janela): código e descrição, etapa, talhões, modelo, o que falta de quanto e o
 * último apontamento. `selos`: o que vai ao lado do nome ("no lançamento", Concluída).
 */
function TextoOperacao({ op, selos, comAreaUltimo = false }) {
  return (
    <span className="min-w-0 flex-1">
      <span className="block text-[14.5px] font-semibold leading-snug text-ink">
        {op.cod} - {op.ds || "sem descrição"}
        {selos && <span className="ml-1.5 inline-flex flex-wrap gap-1 align-middle">{selos}</span>}
      </span>
      <span className="block text-[12.5px] text-muted">
        {[op.etapaDs, plural(op.nTalhoes ?? 0, "talhão", "talhões"), rotModelo(op.modelo)].filter(Boolean).join(" · ")}
      </span>
      <span className="mt-0.5 block text-[12.5px] text-ink">
        Falta <b className="font-semibold tabular">{nf(op.saldo ?? 0)} ha</b>
        {op.areaRec > 0 ? ` de ${nf(op.areaRec)}` : ""}
        {op.ultimo && <span className="text-muted"> · último {textoUltimo(comAreaUltimo ? op.ultimo : { ...op.ultimo, area: undefined })}</span>}
      </span>
    </span>
  );
}

/**
 * O.S. em aberto com as operações dela, na cor da situação (verde: toda apontada; amarelo: com apontamento e ainda
 * falta). O cartão inteiro abre a janela da O.S. (o botão do número cobre o cartão); as operações que já estão no
 * lançamento ficam indicadas (`selo`: com o selo "no lançamento").
 */
function CartaoOS({ ordem, noLancamento, selo, onAbrir }) {
  const pct = ordem.areaRec > 0 ? Math.min(100, Math.max(0, ((ordem.ja ?? 0) / ordem.areaRec) * 100)) : 0;
  const fazendas = ordem.fazendas ?? [];
  const ops = ordem.operacoes ?? [];
  const estado = estadoDaOS(ordem);
  const cor = COR_ESTADO[estado];
  const nNoLanc = ops.filter((op) => noLancamento.has(`${ordem.os}|${op.cod}`)).length;
  const rotulo = [
    `O.S. ${ordem.os}`,
    ordem.situacao,
    `falta ${nf(ordem.saldo ?? 0)} ha`,
    plural(ops.length, "operação", "operações"),
    cor.rotulo.toLowerCase(),
    nNoLanc ? `${nNoLanc} no lançamento` : "",
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <article
      className={`relative overflow-hidden rounded-xl2 border bg-card shadow-card focus-within:ring-2 focus-within:ring-[rgb(var(--form-acento))] hover:border-[rgb(var(--form-acento))] ${cor.borda}`}
    >
      <div className={`px-3.5 pb-2.5 pt-3 ${cor.fundo}`}>
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h3 className="font-display text-[21px] font-semibold leading-tight text-ink">
                <button
                  type="button"
                  onClick={() => onAbrir(ordem)}
                  aria-haspopup="dialog"
                  aria-label={`${rotulo}. Abrir a O.S.`}
                  className="text-left after:absolute after:inset-0 after:content-[''] focus-visible:outline-none"
                >
                  O.S. {ordem.os}
                </button>
              </h3>
              <SeloSituacao s={ordem.situacao} />
              {estado === "concluida" && <SeloConcluida />}
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
      {/* as operações (na cor de cada uma): o toque em qualquer parte do cartão abre a janela da O.S. */}
      <ul className="border-t border-line">
        {ops.map((op) => {
          const sel = noLancamento.has(`${ordem.os}|${op.cod}`);
          const est = estadoDaOperacao(op);
          return (
            <li key={op.cod} className={`flex min-h-[60px] items-center gap-3 border-b border-line px-3.5 py-2.5 ${COR_ESTADO[est].fundo}`}>
              <TextoOperacao
                op={op}
                selos={
                  (sel && selo) || est === "concluida" ? (
                    <>
                      {sel && selo && <SeloNoLancamento />}
                      {est === "concluida" && <SeloConcluida />}
                    </>
                  ) : null
                }
              />
            </li>
          );
        })}
      </ul>
      <div aria-hidden="true" className="flex min-h-[44px] items-center justify-between gap-2 px-3.5 py-2 text-[13px] font-medium text-brand-700">
        <span>Abrir a O.S. · {plural(ops.length, "operação", "operações")} e lançamentos</span>
        <IconSetaDireita size={18} className="flex-shrink-0" />
      </div>
    </article>
  );
}

/**
 * Janela da O.S. (passo 2): o resumo, as operações dela em caixas de marcar (já marcadas as que têm o que fazer; as que
 * estão no lançamento, marcadas e travadas) e os lançamentos já feitos nela. "Lançar as marcadas" acrescenta todas ao
 * lançamento de uma vez. Trocando a O.S. de um bloco (`trocar`: o bloco), cada operação é um botão: a tocada entra no
 * lugar dele.
 */
function JanelaOS({ ordem, trocar, noLancamento, nNoLancamento, hist, emEdicao, onLancar, onEscolher, onAbrirLancamento, onRecarregarHist, onFechar }) {
  const ops = ordem.operacoes ?? [];
  const noLanc = (op) => noLancamento.has(`${ordem.os}|${op.cod}`);
  const [marcadas, setMarcadas] = useState(() => Object.fromEntries(ops.filter((op) => !noLanc(op) && (op.saldo ?? 0) > 0.001).map((op) => [op.cod, true])));
  const livres = ops.filter((op) => !noLanc(op));
  const escolhidas = livres.filter((op) => marcadas[op.cod]);
  const cabem = Math.max(0, MAX_ORDENS - nNoLancamento);
  const passou = escolhidas.length > cabem;
  const todas = livres.length > 0 && livres.every((op) => marcadas[op.cod]);
  const fazendas = ordem.fazendas ?? [];
  const idBase = `lm-jos-${idSeguro(ordem.os)}`;
  const botaoLancar =
    escolhidas.length > 1 ? `Lançar as ${escolhidas.length} marcadas` : escolhidas.length === 1 ? "Lançar a marcada" : "Lançar as marcadas";
  return (
    <JanelaInfo
      titulo={`O.S. ${ordem.os}`}
      subtitulo={[ordem.situacao, ordem.dtOs && `desde ${fmtDateBR(ordem.dtOs)}`, ordem.prevFim && `prev. fim ${fmtDateBR(ordem.prevFim)}`, ordem.resp]
        .filter(Boolean)
        .join(" · ")}
      largura="lg"
      onFechar={onFechar}
      rodape={
        <>
          <button type="button" className={`${BOTAO} !h-12`} onClick={onFechar}>
            Fechar
          </button>
          {!trocar && (
            <button
              type="button"
              className={`${BOTAO_PRIMARIO} min-w-0 flex-1 sm:flex-none`}
              disabled={escolhidas.length === 0 || passou}
              onClick={() => onLancar(ordem, escolhidas)}
            >
              {botaoLancar}
              <IconSetaDireita size={18} />
            </button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <div className="grid grid-cols-3 gap-2">
            <Numero rotulo="Área rec." valor={nf(ordem.areaRec ?? 0)} />
            <Numero rotulo="Já apontado" valor={nf(ordem.ja ?? 0)} />
            <Numero rotulo="Falta" valor={nf(ordem.saldo ?? 0)} cor={(ordem.saldo ?? 0) > 0.001 ? "text-ink" : "text-good-600"} />
          </div>
          {fazendas.length > 0 && (
            <p className="mt-2 text-[13px] text-ink">{fazendas.map((f) => `${f.cod}${f.nm ? ` - ${f.nm}` : ""}`).join(" · ")}</p>
          )}
        </div>

        {trocar ? (
          <section aria-labelledby={`${idBase}-ops`} className="space-y-2">
            <div>
              <h3 id={`${idBase}-ops`} className="text-[14.5px] font-semibold text-ink">
                Escolha a operação
              </h3>
              <p className="text-[12.5px] text-muted">
                Entra no lugar da O.S. {trocar.os} (operação {trocar.opCod}) no lançamento.
              </p>
            </div>
            <ul className="overflow-hidden rounded-lg border border-line bg-card">
              {ops.map((op) => {
                const est = estadoDaOperacao(op);
                const atual = trocar.os === ordem.os && trocar.opCod === op.cod;
                return (
                  <li key={op.cod} className="border-b border-line last:border-b-0">
                    <button
                      type="button"
                      onClick={() => onEscolher(ordem, op)}
                      className={`flex min-h-[64px] w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-hover ${COR_ESTADO[est].fundo}`}
                    >
                      <TextoOperacao
                        op={op}
                        comAreaUltimo
                        selos={
                          <>
                            {atual ? <SeloNoLancamento>a trocar</SeloNoLancamento> : noLanc(op) && <SeloNoLancamento />}
                            {est === "concluida" && <SeloConcluida />}
                          </>
                        }
                      />
                      <IconSetaDireita size={18} className="flex-shrink-0 text-muted" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : (
          <fieldset className="space-y-2">
            <legend className="sr-only">Operações da O.S. {ordem.os}: marque as que vai lançar</legend>
            <div className="flex items-center gap-2">
              <p aria-hidden="true" className="min-w-0 flex-1 text-[14.5px] font-semibold text-ink">
                Operações da O.S. <span className="font-normal text-muted">· marque as que vai lançar</span>
              </p>
              {livres.length > 1 && (
                <button
                  type="button"
                  className={BOTAO_MENOR}
                  onClick={() => setMarcadas(todas ? {} : Object.fromEntries(livres.map((op) => [op.cod, true])))}
                >
                  {todas ? "Desmarcar todas" : "Marcar todas"}
                </button>
              )}
            </div>
            <ul className="overflow-hidden rounded-lg border border-line bg-card">
              {ops.map((op) => {
                const est = estadoDaOperacao(op);
                const ja = noLanc(op);
                const id = `${idBase}-op-${idSeguro(op.cod)}`;
                return (
                  <li key={op.cod} className={`border-b border-line last:border-b-0 ${COR_ESTADO[est].fundo}`}>
                    <label htmlFor={id} className={`flex min-h-[64px] items-start gap-3 px-3 py-2.5 ${ja ? "" : "cursor-pointer"}`}>
                      <input
                        id={id}
                        type="checkbox"
                        checked={ja || !!marcadas[op.cod]}
                        disabled={ja}
                        onChange={(e) => setMarcadas((m) => ({ ...m, [op.cod]: e.target.checked }))}
                        className="mt-0.5 h-6 w-6 flex-shrink-0 cursor-pointer accent-[#23396B] disabled:cursor-default dark:accent-[#7FA8E8]"
                      />
                      <TextoOperacao
                        op={op}
                        comAreaUltimo
                        selos={
                          ja || est === "concluida" ? (
                            <>
                              {ja && <SeloNoLancamento>já no lançamento</SeloNoLancamento>}
                              {est === "concluida" && <SeloConcluida />}
                            </>
                          ) : null
                        }
                      />
                    </label>
                  </li>
                );
              })}
            </ul>
            <div aria-live="polite">
              {passou && (
                <p className="text-[12.5px] font-medium text-alert-600">
                  No máximo {MAX_ORDENS} O.S./operações por lançamento: {nNoLancamento ? `já há ${nNoLancamento}; ` : ""}
                  desmarque {plural(escolhidas.length - cabem, "operação", "operações")}.
                </p>
              )}
            </div>
            {ops.length > 0 && livres.length === 0 ? (
              <p className="text-[12px] text-muted">Todas as operações desta O.S. já estão no lançamento.</p>
            ) : (
              nNoLancamento > 0 &&
              !passou && <p className="text-[12px] text-muted">As marcadas entram no lançamento que está aberto, cada uma com os talhões e o boletim dela.</p>
            )}
            {ops.length === 0 && <p className="text-[13px] text-muted">Esta O.S. não tem operação em aberto.</p>}
          </fieldset>
        )}

        <LancamentosDaOS idBase={`${idBase}-l`} os={ordem.os} hist={hist} emEdicao={emEdicao} onAbrir={onAbrirLancamento} onRecarregar={onRecarregarHist} />
      </div>
    </JanelaInfo>
  );
}

/** Selo da origem de um lançamento da O.S. */
function SeloOrigem({ origem }) {
  const cor = origem === "mobile" ? "bg-brand-50 text-brand-700" : origem === "bot" || origem === "whatsapp" ? "bg-good-50 text-good-600" : "bg-surface text-muted";
  return <span className={`whitespace-nowrap rounded-full px-1.5 py-px text-[11px] font-semibold ${cor}`}>{ROTULO_ORIGEM[origem] ?? "Tela Apontamento"}</span>;
}

/**
 * Lançamentos da O.S. (de qualquer origem: Lançamento Mobile, tela Apontamento, bot do WhatsApp), os mais recentes
 * primeiro: data, boletim, operação, área, quem lançou e a origem. Tocar abre o lançamento só para consulta.
 * `recolhivel` (passo 3): começa recolhido, com o resumo (quantos e o último) no botão. Busca ao aparecer, se ainda não
 * foi buscado (`onRecarregar(os)`; `onRecarregar(os, true)` busca de novo).
 */
function LancamentosDaOS({ idBase, os, hist, emEdicao, onAbrir, onRecarregar, recolhivel = false }) {
  const [aberto, setAberto] = useState(!recolhivel);
  useEffect(() => {
    if (!hist) onRecarregar(os);
  }, [hist, os, onRecarregar]);
  const lista = hist?.lista ?? null;
  const total = hist?.total ?? 0;
  const ult = lista?.[0];
  const resumo =
    hist?.carregando && !lista
      ? "carregando…"
      : hist?.erro && !lista
        ? "não carregaram"
        : lista
          ? lista.length
            ? `${total} · último ${diaMes(ult.dt)}${quemLancou(ult) ? ` por ${quemLancou(ult)}` : ""}`
            : "nenhum ainda"
          : "";
  const idLista = `${idBase}-lista`;

  const corpo = (
    <>
      <div aria-live="polite" aria-busy={!!hist?.carregando}>
        {hist?.carregando && !lista && <p className="py-3 text-center text-[13px] text-muted">Carregando os lançamentos da O.S.…</p>}
        {hist?.erro && (
          <div className="space-y-2">
            <Aviso msg={{ texto: hist.erro, erro: true }} />
            <button type="button" className={`${BOTAO} w-full`} onClick={() => onRecarregar(os, true)}>
              <IconAtualizar size={16} /> Tentar de novo
            </button>
          </div>
        )}
        {lista && lista.length === 0 && <p className="py-2 text-[13px] text-muted">Nenhum lançamento nesta O.S. ainda.</p>}
      </div>
      {lista && lista.length > 0 && (
        <ul className="overflow-hidden rounded-lg border border-line bg-card">
          {lista.map((a) => {
            const quem = quemLancou(a);
            return (
              <li key={a.id} className="border-b border-line last:border-b-0">
                <button
                  type="button"
                  onClick={() => onAbrir(a)}
                  aria-haspopup="dialog"
                  className="flex min-h-[56px] w-full items-center gap-2 px-3 py-2 text-left hover:bg-hover"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="text-[13.5px] font-semibold text-ink">
                        {fmtDateBR(a.dt)} · {a.boletim ? `Boletim nº ${a.boletim}` : `Apontamento #${a.id}`}
                      </span>
                      <SeloOrigem origem={a.origem} />
                      {emEdicao?.has(a.id) && <SeloNoLancamento>em edição</SeloNoLancamento>}
                      {a.aConferir && <span className="rounded-full bg-amber-50 px-1.5 py-px text-[11px] font-semibold text-amber-600">a conferir</span>}
                    </span>
                    <span className="block truncate text-[13px] text-ink">
                      {codDs(a.opCod, a.opDs)} · <span className="tabular">{nf(a.area ?? 0)} ha</span>
                      {a.statusOS ? <span className="text-muted"> · {a.statusOS}</span> : null}
                    </span>
                    <span className="block truncate text-[12px] text-muted">
                      {quem ? `Lançado por ${quem}` : "Sem apontador"}
                      {a.usr && a.usr !== a.apontador ? ` · usuário ${a.usr}` : ""}
                    </span>
                  </span>
                  <IconSetaDireita size={16} className="flex-shrink-0 text-muted" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {lista && total > lista.length && (
        <p className="text-[12px] text-muted">
          Mostrando os {lista.length} mais recentes de {total}.
        </p>
      )}
    </>
  );

  if (recolhivel) {
    return (
      <section className={`${CARTAO} overflow-hidden`} aria-label={`Lançamentos da O.S. ${os}`}>
        <div className="flex items-stretch">
          <button
            type="button"
            onClick={() => setAberto((x) => !x)}
            aria-expanded={aberto}
            aria-controls={aberto ? idLista : undefined}
            className="flex min-h-[48px] min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left hover:bg-hover"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-semibold text-ink">Lançamentos desta O.S.</span>
              <span className="block truncate text-[12px] text-muted">{resumo}</span>
            </span>
            <IconSetaBaixo size={18} className={`flex-shrink-0 text-muted transition-transform ${aberto ? "rotate-180" : ""}`} />
          </button>
          {aberto && (
            <button
              type="button"
              onClick={() => onRecarregar(os, true)}
              disabled={!!hist?.carregando}
              aria-label="Atualizar os lançamentos da O.S."
              className="flex w-12 flex-shrink-0 items-center justify-center border-l border-line text-muted hover:bg-hover disabled:opacity-50"
            >
              <IconAtualizar size={16} />
            </button>
          )}
        </div>
        {aberto && (
          <div id={idLista} className="space-y-2 border-t border-line p-2.5">
            {corpo}
          </div>
        )}
      </section>
    );
  }
  return (
    <section aria-labelledby={`${idBase}-t`} className="space-y-2">
      <div className="flex items-center gap-2">
        <h3 id={`${idBase}-t`} className="min-w-0 flex-1 text-[14.5px] font-semibold text-ink">
          Lançamentos desta O.S.{total ? <span className="font-normal text-muted"> · {total}</span> : null}
        </h3>
        <button type="button" className={BOTAO_MENOR} onClick={() => onRecarregar(os, true)} disabled={!!hist?.carregando} aria-label="Atualizar os lançamentos da O.S.">
          <IconAtualizar size={16} />
        </button>
      </div>
      {corpo}
    </section>
  );
}

/** Um dado do lançamento na consulta (vazio: "—"). */
function Dado({ rotulo, children, largo = false }) {
  const vazio = children === null || children === undefined || children === "" || children === false;
  return (
    <div className={largo ? "sm:col-span-2" : ""}>
      <dt className="text-[11.5px] text-muted">{rotulo}</dt>
      <dd className="break-words text-[13.5px] text-ink">{vazio ? "—" : children}</dd>
    </div>
  );
}

/**
 * Lançamento aberto só para consulta (dos lançamentos da O.S.): o cabeçalho, os talhões e as áreas, os insumos, o
 * status, a observação, quem lançou e quando e, no do Lançamento Mobile, o lançamento com várias O.S. e o texto do
 * WhatsApp (com Copiar). Sem editar — só o do Lançamento Mobile com a mesma matrícula de quem está lançando tem
 * "Editar", que abre como em Meus lançamentos.
 */
function JanelaConsulta({ consulta, matAtual, pode, abrindo, onEditar, onFechar }) {
  const [copia, copiar] = usarCopia();
  const caixa = useRef(null);
  const d = consulta.dados;
  const a = d?.apontamento ?? null;
  const r = consulta.resumo ?? {};
  const grupo = Array.isArray(d?.apontamentos) ? d.apontamentos : [];
  const doMobile = a?.orig === "mobile";
  const mesmaPessoa = doMobile && !!matAtual && mesmaMatricula(a.apontadorMat, matAtual);
  const podeEditarEste = !!a && doMobile && mesmaPessoa && pode && !!a.boletim;
  const bol = a?.boletim ?? r.boletim;
  const titulo = bol ? `Boletim nº ${bol}` : `Apontamento #${a?.id ?? r.id ?? ""}`;
  const un = a?.unCalda === "kg" ? "kg" : "L";
  const porque = !a
    ? ""
    : !doMobile
      ? `Lançado ${a.origem === "tela" ? "na tela Apontamento" : "pelo WhatsApp"}: aqui é só para consulta.`
      : !mesmaPessoa
        ? "Lançado com outra matrícula: só para consulta."
        : !pode
          ? "Seu perfil é somente leitura: só para consulta."
          : "";
  return (
    <JanelaInfo
      titulo={titulo}
      subtitulo={[fmtDateBR(a?.dt ?? r.dt), (a?.os ?? r.os) ? `O.S. ${a?.os ?? r.os}` : "", ROTULO_ORIGEM[a?.origem ?? r.origem] ?? ""].filter(Boolean).join(" · ")}
      largura="lg"
      onFechar={onFechar}
      rodape={
        <>
          {podeEditarEste && (
            <button type="button" className={`${BOTAO} !h-12`} onClick={() => onEditar(a.boletim)} disabled={abrindo !== null}>
              <IconEditar size={16} /> {abrindo === a.boletim ? "Abrindo…" : "Editar"}
            </button>
          )}
          <button type="button" className={`${BOTAO_PRIMARIO} min-w-0 flex-1 sm:flex-none`} onClick={onFechar}>
            Fechar
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div aria-live="polite" aria-busy={!!consulta.carregando}>
          {consulta.carregando && <p className="py-6 text-center text-[14px] text-muted">Carregando o lançamento…</p>}
          {consulta.erro && <Aviso msg={{ texto: consulta.erro, erro: true }} />}
        </div>
        {a && (
          <>
            {porque && <p className="rounded-lg border border-line bg-surface px-3 py-2 text-[12.5px] text-muted">{porque}</p>}
            <dl className="grid grid-cols-1 gap-x-4 gap-y-2.5 sm:grid-cols-2">
              <Dado rotulo="Data da operação">{fmtDateBR(a.dt)}</Dado>
              <Dado rotulo="O.S.">{a.os || "sem O.S."}</Dado>
              <Dado rotulo="Operação" largo>
                {codDs(a.opCod, a.opDs)}
              </Dado>
              <Dado rotulo="Etapa">{codDs(a.etapaCod, a.etapaDs)}</Dado>
              <Dado rotulo="Tipo de aplicação">{a.tipoAplicacao}</Dado>
              {a.atividade && <Dado rotulo="Atividade">{a.atividade}</Dado>}
              <Dado rotulo="Solicitante">{a.solicitante}</Dado>
              <Dado rotulo="Apontador / informante">
                {[a.apontador, a.apontadorMat && `mat. ${a.apontadorMat}`].filter(Boolean).join(" · ")}
              </Dado>
              <Dado rotulo="Prestador / equipe">{a.equipe}</Dado>
              <Dado rotulo="Equipamento (frota)">{a.eqp}</Dado>
              <Dado rotulo="Nº de equipamentos">{a.numEquipamentos > 0 ? String(a.numEquipamentos) : ""}</Dado>
              <Dado rotulo="Nº de pessoas">{a.numPessoas > 0 ? String(a.numPessoas) : ""}</Dado>
              <Dado rotulo="Calda/Dose recomendada">{Number.isFinite(a.vazaoRec) ? `${fmtNum(a.vazaoRec)} ${un}/ha` : ""}</Dado>
              <Dado rotulo="Vazão utilizada">{Number.isFinite(a.vazaoUti) ? `${fmtNum(a.vazaoUti)} ${un}/ha${a.vazaoAuto ? " (calculada)" : ""}` : ""}</Dado>
              <Dado rotulo="Calda/Insumo gasto">{Number.isFinite(a.volCalda) ? `${fmtNum(a.volCalda)} ${un}` : ""}</Dado>
              <Dado rotulo="Status da O.S.">{a.statusOS}</Dado>
              <Dado rotulo="Origem">{ROTULO_ORIGEM[a.origem] ?? ""}</Dado>
              <Dado rotulo="Lançado por">{[a.usr, a.criEm && `em ${a.criEm}`].filter(Boolean).join(" ")}</Dado>
              {a.atuUsr && <Dado rotulo="Alterado por">{[a.atuUsr, a.atuEm && `em ${a.atuEm}`].filter(Boolean).join(" ")}</Dado>}
              {a.confEm && <Dado rotulo="Conferido por">{[a.confUsr, `em ${a.confEm}`].filter(Boolean).join(" ")}</Dado>}
            </dl>

            <section aria-label="Talhões e áreas" className="space-y-1.5">
              <h3 className="text-[14px] font-semibold text-ink">
                Talhões · <span className="tabular">{nf(a.areaTotal ?? 0)} ha</span>
              </h3>
              {(a.talhoes ?? []).length === 0 ? (
                <p className="text-[13px] text-muted">Sem talhões.</p>
              ) : (
                <ul className="overflow-hidden rounded-lg border border-line bg-card">
                  {agruparPorFazenda(a.talhoes ?? []).map((g) => (
                    <li key={g.propCod} className="border-b border-line px-3 py-2 last:border-b-0">
                      <div className="text-[13px] font-semibold text-ink">
                        {g.propCod}
                        {g.propNm ? ` - ${g.propNm}` : ""}
                      </div>
                      <ul className="mt-0.5 grid grid-cols-2 gap-x-3 text-[13px] sm:grid-cols-3">
                        {g.talhoes.map((t) => (
                          <li key={`${t.propCod}|${t.tlh}`} className="flex justify-between gap-2 tabular">
                            <span className="text-muted">{rotTalhao(t.tlh)}</span>
                            <span className="text-ink">{nf(t.area ?? 0)} ha</span>
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {(a.insumos ?? []).length > 0 && (
              <section aria-label="Insumos" className="space-y-1.5">
                <h3 className="text-[14px] font-semibold text-ink">Insumos</h3>
                <ul className="space-y-0.5 text-[13px] text-ink">
                  {a.insumos.map((i, k) => (
                    <li key={`${i.cod}-${k}`}>
                      {codDs(i.cod, i.ds)}
                      <span className="text-muted">
                        {Number.isFinite(i.dose) ? ` · dose ${fmtNum(i.dose)}` : ""}
                        {Number.isFinite(i.qtd) ? ` · ${fmtNum(i.qtd)} ${i.um ?? ""}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {a.obs && (
              <section aria-label="Observação" className="space-y-1">
                <h3 className="text-[14px] font-semibold text-ink">Observação</h3>
                <p className="whitespace-pre-wrap break-words text-[13px] text-ink">{a.obs}</p>
              </section>
            )}

            {grupo.length > 1 && (
              <section aria-label="Lançamento com várias O.S." className="space-y-1">
                <h3 className="text-[14px] font-semibold text-ink">
                  Lançamento com {grupo.length} O.S. · {rotBoletins(grupo.map((x) => x.boletim))}
                </h3>
                <ul className="space-y-0.5 text-[13px]">
                  {grupo.map((x) => (
                    <li key={x.id} className={x.id === a.id ? "font-semibold text-ink" : "text-ink"}>
                      O.S. {x.os} · {codDs(x.opCod, x.opDs)} · <span className="tabular">{nf(x.areaTotal ?? 0)} ha</span>
                      {x.boletim ? <span className="text-muted"> · boletim nº {x.boletim}</span> : null}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {doMobile && d.texto && (
              <section aria-label="Texto do WhatsApp" className="space-y-2">
                <div className="flex items-center gap-2">
                  <h3 className="min-w-0 flex-1 text-[14px] font-semibold text-ink">Texto do WhatsApp</h3>
                  <button type="button" className={BOTAO_MENOR} onClick={() => copiar(d.texto, caixa.current)}>
                    <IconCopiar size={16} /> {copia === "ok" ? "Copiado!" : "Copiar"}
                  </button>
                </div>
                <p aria-live="polite" className={`text-[12px] font-medium ${copia === "falhou" ? "text-amber-600" : "text-good-600"}`}>
                  {copia ? MSG_COPIA[copia] : ""}
                </p>
                <CaixaTexto texto={d.texto} caixaRef={caixa} />
              </section>
            )}

            {a.origMsg && (
              <details className="rounded-lg border border-line">
                <summary className="flex min-h-[44px] cursor-pointer items-center px-3 text-[13px] font-medium text-ink">Mensagem original do WhatsApp</summary>
                <p className="whitespace-pre-wrap break-words border-t border-line px-3 py-2 font-mono text-[12px] text-ink">{a.origMsg}</p>
              </details>
            )}
          </>
        )}
      </div>
    </JanelaInfo>
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

/** "2 O.S." ou, com mais operações que O.S., "1 O.S. · 3 operações" (cada bloco é uma O.S. + operação). */
function contarOSOperacoes(ordens) {
  const nOS = new Set(ordens.map((o) => String(o.os ?? ""))).size;
  return nOS === ordens.length ? `${nOS} O.S.` : `${nOS} O.S. · ${ordens.length} operações`;
}

/** Passo 4 do lançamento com várias O.S.: as O.S./operações com a área de cada uma e o caminho de volta aos talhões. */
function ResumoLancamento({ ordens, resumo, dsDe, dt, onTalhoes }) {
  return (
    <div className={`${CARTAO} p-3`}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="font-display text-[19px] font-semibold leading-tight text-ink">{contarOSOperacoes(ordens)} no lançamento</span>
            <span className="text-[12.5px] text-muted">{fmtDateBR(dt)}</span>
          </div>
          <div className="text-[12.5px] text-muted">O mesmo cabeçalho para todas; cada uma ganha o seu boletim.</div>
        </div>
        <button type="button" className={BOTAO_MENOR} onClick={onTalhoes}>
          Talhões
        </button>
      </div>
      <ul className="mt-2 divide-y divide-line border-t border-line">
        {ordens.map((o, i) => {
          const ds = dsDe(o);
          return (
            <li key={o.chave} className="flex items-baseline gap-2 py-1.5 text-[13px]">
              <span className="min-w-0 flex-1 truncate text-ink">
                <b className="font-semibold">O.S. {o.os}</b> · {o.opCod}
                {ds ? ` - ${ds}` : ""}
              </span>
              <span className="flex-shrink-0 tabular text-muted">{nf(resumo[i]?.total ?? 0)} ha</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function CaixaSoFalta({ checked, onChange }) {
  return (
    <label className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-lg px-1 text-[14px] text-ink">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-5 w-5 flex-shrink-0 accent-[#23396B] dark:accent-[#7FA8E8]"
      />
      Mostrar só os talhões que faltam fazer
    </label>
  );
}

/**
 * Uma O.S./operação do lançamento: o resumo (com Trocar), os talhões dela por fazenda e os de fora da O.S. Com várias
 * O.S. no lançamento, fica num bloco que abre e fecha (com a área e o status no cabeçalho), tem o status da O.S. e o
 * botão de tirar a O.S. do lançamento; com uma só (`unica`), fica como sempre foi. Logo abaixo do resumo, os
 * lançamentos já feitos na O.S. (`hist`, de qualquer origem; recolhidos, abrem só para consulta).
 */
function BlocoOrdem({
  ordem,
  r,
  dt,
  unica,
  aberto,
  soFalta,
  onSoFalta,
  opDs,
  situacao,
  statusOpcoes,
  onAlternar,
  onRemover,
  onTrocar,
  onMudar,
  onTentar,
  onStatus,
  hist,
  emEdicao,
  onHistorico,
  onAbrirLancamento,
}) {
  const ch = ordem.chave;
  const marcar = useCallback(
    (t, sim) =>
      onMudar(ch, (o) => {
        const marcas = { ...o.marcas };
        if (sim) marcas[chaveDe(t)] = areaCampo(t.saldo);
        else delete marcas[chaveDe(t)];
        return { ...o, marcas };
      }),
    [ch, onMudar],
  );
  const marcarVarios = useCallback(
    (lista, sim) =>
      onMudar(ch, (o) => {
        const marcas = { ...o.marcas };
        for (const t of lista) {
          if (sim && marcas[chaveDe(t)] === undefined) marcas[chaveDe(t)] = areaCampo(t.saldo);
          else if (!sim) delete marcas[chaveDe(t)];
        }
        return { ...o, marcas };
      }),
    [ch, onMudar],
  );
  const mudarArea = useCallback((k, v) => onMudar(ch, (o) => ({ ...o, marcas: { ...o.marcas, [k]: v } })), [ch, onMudar]);
  const mudarAreaExtra = useCallback(
    (chave, v) => onMudar(ch, (o) => ({ ...o, extras: o.extras.map((x) => (x.chave === chave ? { ...x, area: v } : x)) })),
    [ch, onMudar],
  );
  const removerExtra = useCallback((chave) => onMudar(ch, (o) => ({ ...o, extras: o.extras.filter((x) => x.chave !== chave) })), [ch, onMudar]);
  const incluirExtras = useCallback(
    (itens) =>
      onMudar(ch, (o) => {
        const novos = itens.filter((x) => !o.extras.some((e) => mesmoTalhao(e, x)));
        return { ...o, extras: [...o.extras, ...novos.map((x) => ({ ...x, chave: novaChaveExtra() }))] };
      }),
    [ch, onMudar],
  );
  const info = r.info;
  const talhoesOS = r.talhoesOS;
  const grupos = useMemo(() => agruparPorFazenda(talhoesOS), [talhoesOS]);
  const idBloco = `lm-b-${idSeguro(ch)}`;
  const nome = `O.S. ${ordem.os} · operação ${ordem.opCod}`;

  const conteudo = (
    <>
      <ResumoEscolha
        os={ordem.os}
        opCod={ordem.opCod}
        opDs={opDs}
        situacao={situacao}
        dt={dt}
        info={info}
        talhoes={talhoesOS}
        onTrocar={() => onTrocar(ch)}
      />
      <LancamentosDaOS
        idBase={`${idBloco}-hist`}
        os={ordem.os}
        hist={hist}
        emEdicao={emEdicao}
        onAbrir={onAbrirLancamento}
        onRecarregar={onHistorico}
        recolhivel
      />
      {(r.carregando || ordem.pendentes) && !r.erro && (
        <p className="py-6 text-center text-[14px] text-muted" aria-live="polite">
          Carregando os talhões da O.S.…
        </p>
      )}
      {r.erro && (
        <div className="space-y-2">
          <Aviso msg={{ texto: r.erro, erro: true }} />
          <button type="button" className={`${BOTAO} w-full`} onClick={() => onTentar(ordem)}>
            <IconAtualizar size={16} /> Tentar de novo
          </button>
        </div>
      )}
      {info && (
        <>
          {unica && <CaixaSoFalta checked={soFalta} onChange={onSoFalta} />}
          {talhoesOS.length === 0 && (
            <p className={`${CARTAO} px-4 py-6 text-center text-[13.5px] text-muted`}>Esta operação não tem talhões na O.S. Inclua abaixo os realizados.</p>
          )}
          {grupos.map((g) => (
            <GrupoFazenda
              key={g.propCod}
              prefixo={ch}
              grupo={g}
              marcas={ordem.marcas}
              soFalta={soFalta}
              onMarcar={marcar}
              onArea={mudarArea}
              onMarcarVarios={marcarVarios}
            />
          ))}
          <ListaForaDaOS extras={ordem.extras} onArea={mudarAreaExtra} onRemover={removerExtra} />
          <IncluirForaDaOS
            idBase={idBloco}
            dt={dt}
            talhoesOS={talhoesOS}
            marcas={ordem.marcas}
            extras={ordem.extras}
            onIncluir={incluirExtras}
            onMarcarDaOS={marcarVarios}
            onAreaDaOS={mudarArea}
          />
          {!unica && (
            <div className={`${CARTAO} p-3`}>
              <Opcoes
                nome={`${idBloco}-status`}
                legenda={`Status da O.S. ${ordem.os}`}
                valor={ordem.statusOS}
                onChange={(v) => onStatus(ch, v)}
                colunas={3}
                opcoes={statusOpcoes.map((x) => ({ valor: x, rotulo: x }))}
              />
            </div>
          )}
        </>
      )}
    </>
  );
  if (unica) return conteudo;

  return (
    <section aria-label={nome} className="space-y-2.5">
      <div className={`${CARTAO} flex items-stretch overflow-hidden`}>
        <button
          type="button"
          onClick={() => onAlternar(ch)}
          aria-expanded={aberto}
          aria-controls={aberto ? idBloco : undefined}
          className="flex min-h-[64px] min-w-0 flex-1 items-center gap-3 px-3.5 py-2.5 text-left hover:bg-hover"
        >
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-display text-[19px] font-semibold leading-tight text-ink">O.S. {ordem.os}</span>
              {ordem.boletim && <span className="text-[12px] text-muted">boletim nº {ordem.boletim}</span>}
            </span>
            <span className="block truncate text-[13.5px] font-medium text-ink">
              {ordem.opCod}
              {opDs ? ` - ${opDs}` : ""}
            </span>
            {/* sem os talhões ainda (recolhido), o cabeçalho diz que estão carregando ou que deu erro, e não "0 talhões" */}
            <span className={`block text-[12.5px] tabular ${!r.info && r.erro ? "font-medium text-alert-600" : "text-muted"}`}>
              {r.info ? `${plural(r.linhas.length, "talhão", "talhões")} · ${nf(r.total)} ha` : r.erro ? "Os talhões não carregaram" : "Carregando os talhões…"}
              {ordem.statusOS ? ` · ${ordem.statusOS}` : ""}
            </span>
          </span>
          <IconSetaBaixo size={18} className={`flex-shrink-0 text-muted transition-transform ${aberto ? "rotate-180" : ""}`} />
        </button>
        <button
          type="button"
          onClick={() => onRemover(ch)}
          className="flex w-12 flex-shrink-0 items-center justify-center border-l border-line text-muted hover:bg-hover hover:text-alert-600"
          aria-label={`Tirar a ${nome} do lançamento`}
        >
          <IconExcluir size={18} />
        </button>
      </div>
      {aberto && (
        <div id={idBloco} className="space-y-3 border-l-2 border-[rgb(var(--form-acento))] pl-2.5">
          {conteudo}
        </div>
      )}
    </section>
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

function GrupoFazenda({ prefixo, grupo, marcas, soFalta, onMarcar, onArea, onMarcarVarios }) {
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
          <LinhaTalhao key={chaveDe(t)} prefixo={prefixo} t={t} valor={marcas[chaveDe(t)]} onMarcar={onMarcar} onArea={onArea} />
        ))}
      </ul>
    </section>
  );
}

function LinhaTalhao({ prefixo, t, valor, onMarcar, onArea }) {
  const k = chaveDe(t);
  // o mesmo talhão pode estar em duas O.S./operações do lançamento: o id leva a O.S. (o bloco)
  const id = `lm-t-${idSeguro(`${prefixo}-${k}`)}`;
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
function IncluirForaDaOS({ idBase, dt, talhoesOS, marcas, extras, onIncluir, onMarcarDaOS, onAreaDaOS }) {
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
    <section className="caixa-form space-y-3" aria-labelledby={`${idBase}-fora-t`}>
      <div className="flex items-center gap-2">
        <h3 id={`${idBase}-fora-t`} className="min-w-0 flex-1 text-[15px] font-semibold text-ink">
          Incluir fora da O.S.
        </h3>
        <button type="button" onClick={fechar} className="flex h-10 w-10 items-center justify-center rounded-lg text-muted hover:bg-surface" aria-label="Fechar a inclusão">
          <IconFechar size={18} />
        </button>
      </div>
      <form onSubmit={buscar} className="flex items-end gap-2" noValidate>
        <div className="min-w-0 flex-1">
          <label htmlFor={`${idBase}-faz`} className={ROTULO}>
            Código da fazenda
          </label>
          <input
            id={`${idBase}-faz`}
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
                <label htmlFor={`${idBase}-outro-t`} className={ROTULO}>
                  Talhão
                </label>
                <input
                  id={`${idBase}-outro-t`}
                  value={outroTlh}
                  onChange={(e) => setOutroTlh(e.target.value.replace(/\s/g, "").slice(0, 8))}
                  autoComplete="off"
                  placeholder="Ex.: 07"
                  aria-describedby={`${idBase}-outro-dica`}
                  className={`${CAMPO} tabular`}
                />
              </div>
              <div>
                <label htmlFor={`${idBase}-outro-a`} className={ROTULO}>
                  Área realizada
                </label>
                <CampoArea id={`${idBase}-outro-a`} valor={outraArea} onChange={setOutraArea} />
              </div>
            </div>
            <p id={`${idBase}-outro-dica`} className="text-[12px] text-muted">
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

/**
 * Cabeçalho do lançamento (o mesmo para todas as O.S.) e o status de cada O.S. `ops`: as operações do lançamento (a
 * primeira dá as dicas); `statusPorOS`: { os, chave, valor, falta, nTalhoes, nOps } de cada O.S.
 */
function DadosServico({ s, upd, dt, hoje, onDt, ops, opcoes, varias, statusPorOS, statusOpcoes, onStatus, onTipoRecusado }) {
  const op = ops[0] ?? null;
  // etapas do cadastro + as das operações (e a gravada) quando não estão nele
  const etapas = useMemo(() => {
    const l = [...(opcoes?.etapas ?? [])];
    for (const o of ops) if (o.etapaCod && !l.some((x) => x.cod === o.etapaCod)) l.unshift({ cod: o.etapaCod, ds: o.etapaDs ?? "" });
    if (s.etapaCod && !l.some((x) => x.cod === s.etapaCod)) l.unshift({ cod: s.etapaCod, ds: "" });
    return l;
  }, [opcoes, ops, s.etapaCod]);
  // tipos de aplicação: só os do cadastro Tipo Aplicação ativos ({ cod, ds }; null enquanto as listas não chegam)
  const tipos = useMemo(
    () => (Array.isArray(opcoes?.tipos) ? opcoes.tipos.map((t) => (typeof t === "string" ? { cod: "", ds: t } : t)).filter((t) => t && t.ds) : null),
    [opcoes],
  );
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
      <Campo id="lm-solic" rotulo="Solicitante" dica={varias ? "Sem mudar, cada O.S. leva o responsável dela." : undefined}>
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
        <CampoTipoAplicacao id="lm-tipo" valor={s.tipoAplicacao} tipos={tipos} onChange={(v) => upd({ tipoAplicacao: v })} onRecusado={onTipoRecusado} />
        {varias && <p className="-mt-2 text-[12px] text-muted sm:col-span-2">Etapa e tipo de aplicação: sem mudar, cada O.S. leva os da operação dela.</p>}
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
        {varias && (
          <p className="col-span-2 -mt-1.5 text-[12px] text-muted">
            A dose vale para todas as O.S.; a calda/insumo gasto é a do lançamento todo, dividida entre as O.S. pela área.
          </p>
        )}
      </div>
      {/* status de cada O.S. (a O.S. com mais de uma operação no lançamento tem um só) */}
      {statusPorOS.map((x) => (
        <Opcoes
          key={x.os}
          nome={`lm-status-${idSeguro(x.os)}`}
          legenda={varias ? `Status da O.S. ${x.os}` : "Status da O.S."}
          valor={x.valor}
          onChange={(v) => onStatus(x.chave, v)}
          colunas={3}
          opcoes={statusOpcoes.map((v) => ({ valor: v, rotulo: v }))}
          dica={
            x.falta !== null && x.falta <= 0.001 && x.nTalhoes > 0 && !/^CONCLU/i.test(x.valor)
              ? `Com este lançamento não sobra área a fazer ${x.nOps > 1 ? "nas operações desta O.S." : "nesta operação"}. Se a O.S. terminou, marque CONCLUÍDA.`
              : undefined
          }
        />
      ))}
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

/**
 * Texto do WhatsApp de um lançamento (logo depois de gravar, ou aberto em Meus lançamentos), com o boletim ou os
 * boletins dele; Copiar e Enviar ficam no rodapé.
 */
function VistaTexto({ tituloRef, titulo, linha, sucesso = false, avisos = [], boletins = [], texto, caixaRef, acoes }) {
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
          A última linha ({tituloBoletins(boletins)} · lançado no sistema) evita que o bot lance de novo — não apague.
        </p>
        <CaixaTexto texto={texto} caixaRef={caixaRef} />
      </div>
      {acoes && <div className="grid grid-cols-2 gap-2">{acoes}</div>}
    </section>
  );
}

/**
 * Histórico de quem lança: os lançamentos feitos por esta tela com a matrícula, nos últimos 7, 15 ou 30 dias ou todos,
 * uma página por vez ("Carregar mais").
 */
function MeusLancamentos({ tituloRef, mat, nome, pode, dias, onDias, estado, abrindo, onRecarregar, onMais, onCopiar, onVerTexto, onEditar, onInformarMatricula }) {
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
        {nome ? ` (${nome})` : ""}
        {dias > 0 ? `, nos últimos ${dias} dias` : ", desde o primeiro"}.
      </p>
      <div role="radiogroup" aria-label="Período" className="grid grid-cols-4 gap-1 rounded-lg bg-surface p-1">
        {PERIODOS_MEUS.map((d) => (
          <button
            key={d}
            type="button"
            role="radio"
            aria-checked={dias === d}
            aria-label={d > 0 ? `Últimos ${d} dias` : "Todos os lançamentos"}
            onClick={() => onDias(d)}
            className={`h-10 rounded-md text-[13.5px] font-semibold ${dias === d ? "bg-card text-ink shadow-card" : "text-muted hover:text-ink"}`}
          >
            {d > 0 ? `${d} dias` : "Todos"}
          </button>
        ))}
      </div>
      <div aria-live="polite" aria-busy={estado.carregando}>
        {estado.carregando && !lista && <p className="py-6 text-center text-[14px] text-muted">Carregando…</p>}
        {estado.erro && <Aviso msg={{ texto: estado.erro, erro: true }} />}
        {lista && lista.length === 0 && (
          <div className={`${CARTAO} px-4 py-8 text-center`}>
            <p className="text-[15px] font-semibold text-ink">{dias > 0 ? "Nenhum lançamento no período" : "Nenhum lançamento"}</p>
            <p className="mx-auto mt-1 max-w-sm text-[13px] text-muted">
              Os boletins gravados pelo Lançamento Mobile com esta matrícula aparecem aqui.{dias > 0 ? " Para ver os mais antigos, escolha Todos." : ""}
            </p>
          </div>
        )}
      </div>
      {lista && lista.length > 0 && (
        <ul className="space-y-2">
          {lista.map((a) => {
            // o lançamento com várias O.S. é um item: os boletins e as O.S. dele
            const ordens = Array.isArray(a.ordens) && a.ordens.length ? a.ordens : [{ id: a.id, os: a.os, opCod: a.opCod, opDs: a.opDs, statusOS: a.statusOS }];
            const boletins = Array.isArray(a.boletins) && a.boletins.length ? a.boletins : [a.boletim];
            const status = statusResumo(ordens);
            return (
              <li key={a.id} className={`${CARTAO} p-3`}>
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-display text-[19px] font-semibold leading-tight text-ink">{tituloBoletins(boletins)}</span>
                  <span className="text-[12.5px] text-muted">{fmtDateBR(a.dt)}</span>
                  {abrindo === a.boletim && <span className="text-[12px] text-muted">abrindo…</span>}
                </div>
                {ordens.map((o, i) => (
                  <p key={o.id ?? i} className="truncate text-[13.5px] text-ink">
                    O.S. {o.os} · {o.opCod}
                    {o.opDs ? ` - ${o.opDs}` : ""}
                    {ordens.length > 1 && Number.isFinite(o.area) && <span className="tabular text-muted"> · {nf(o.area)} ha</span>}
                  </p>
                ))}
                <p className="text-[12.5px] text-muted">
                  <span className="tabular">
                    {ordens.length > 1 ? "Total " : ""}
                    {nf(a.areaTotal ?? 0)} ha
                  </span>
                  {status ? ` · ${status}` : ""}
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
            );
          })}
        </ul>
      )}
      {lista && lista.length > 0 && (
        <div className="space-y-1 text-center">
          <p className="text-[12px] text-muted">
            {plural(lista.length, "lançamento", "lançamentos")}
            {estado.mais ? " — há mais" : ""}
          </p>
          {estado.mais && (
            <button type="button" className={`${BOTAO} w-full`} onClick={onMais} disabled={estado.carregando || estado.carregandoMais}>
              {estado.carregandoMais ? "Carregando…" : "Carregar mais"}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * Lista de sugestões de um campo com busca (role listbox, do padrão combobox): cada opção com 48px para o dedo; o toque
 * não tira o foco do campo (escolhe sem fechar o teclado antes). `children(item)`: o conteúdo de cada opção.
 */
function ListaOpcoes({ id, rotulo, itens, ativo, chave, onEscolher, children }) {
  useEffect(() => {
    if (ativo >= 0) document.getElementById(`${id}-${ativo}`)?.scrollIntoView({ block: "nearest" });
  }, [id, ativo]);
  return (
    <ul
      id={id}
      role="listbox"
      aria-label={rotulo}
      onMouseDown={(e) => e.preventDefault()}
      className="mt-1 max-h-72 overflow-y-auto overscroll-contain rounded-lg border border-line bg-card shadow-pop"
    >
      {itens.map((it, i) => (
        <li
          key={chave(it)}
          id={`${id}-${i}`}
          role="option"
          aria-selected={i === ativo}
          onClick={() => onEscolher(it)}
          className={`flex min-h-[48px] cursor-pointer flex-col justify-center border-b border-line px-3 py-1.5 last:border-b-0 ${i === ativo ? "bg-hover" : "hover:bg-hover"}`}
        >
          {children(it)}
        </li>
      ))}
    </ul>
  );
}

/** Setas, Enter e Esc de um campo com sugestões (`n`: quantas há; `escolher(i)`; `fechar()`). */
function teclasDaLista(e, { aberta, n, ativo, setAtivo, setAberta, escolher, fechar }) {
  if (e.key === "ArrowDown" && n > 0) {
    e.preventDefault();
    setAberta(true);
    setAtivo(aberta ? (ativo + 1) % n : 0);
  } else if (e.key === "ArrowUp" && n > 0) {
    e.preventDefault();
    setAberta(true);
    setAtivo(aberta && ativo > 0 ? ativo - 1 : n - 1);
  } else if (e.key === "Enter" && aberta && ativo >= 0 && ativo < n) {
    e.preventDefault();
    escolher(ativo);
  } else if (e.key === "Escape" && aberta) {
    e.preventDefault();
    fechar();
  }
}

/**
 * Quem está lançando: um campo só para a matrícula (código) ou o nome, com as sugestões dos responsáveis que solicitam
 * O.S. enquanto digita (cadastro Responsáveis ativo + os das O.S.; sem acento nem caixa). Escolher a sugestão já busca as
 * O.S. dela (`onEscolher`); digitar a matrícula e Buscar continua valendo (o formulário de quem usa).
 */
function CampoQuem({ id, valor, onValor, onEscolher }) {
  const [termo, setTermo] = useState(null); // o digitado a buscar (null: nada a buscar)
  const [lista, setLista] = useState([]);
  const [aberta, setAberta] = useState(false);
  const [ativo, setAtivo] = useState(-1);
  const [buscando, setBuscando] = useState(false);
  const seq = useRef(0);
  const idLista = `${id}-sugestoes`;

  // sugestões um instante depois de parar de digitar; a resposta de uma busca que outra passou não vale
  useEffect(() => {
    const t = String(termo ?? "").trim();
    const n = ++seq.current;
    if (t.length < 2) {
      setLista([]);
      setBuscando(false);
      return undefined;
    }
    setBuscando(true);
    const h = setTimeout(async () => {
      const { ok, json } = await obter({ responsaveis: t });
      if (n !== seq.current) return;
      setBuscando(false);
      setLista(ok && Array.isArray(json.responsaveis) ? json.responsaveis : []);
      setAtivo(-1);
    }, 250);
    return () => clearTimeout(h);
  }, [termo]);

  function escolher(r) {
    seq.current++;
    setTermo(null);
    setLista([]);
    setAberta(false);
    setAtivo(-1);
    setBuscando(false);
    onEscolher(r);
  }

  const mostrar = aberta && lista.length > 0;
  const semNada = aberta && !buscando && String(termo ?? "").trim().length >= 2 && lista.length === 0;
  return (
    <div>
      <label htmlFor={id} className={ROTULO}>
        Matrícula, código ou nome
      </label>
      <input
        id={id}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={mostrar}
        aria-controls={mostrar ? idLista : undefined}
        aria-activedescendant={mostrar && ativo >= 0 ? `${idLista}-${ativo}` : undefined}
        aria-describedby={`${id}-dica`}
        value={valor}
        onChange={(e) => {
          const v = e.target.value.slice(0, 60);
          onValor(v);
          setTermo(v);
          setAberta(true);
          setAtivo(-1);
        }}
        onKeyDown={(e) =>
          teclasDaLista(e, {
            aberta: mostrar,
            n: lista.length,
            ativo,
            setAtivo,
            setAberta,
            escolher: (i) => escolher(lista[i]),
            fechar: () => setAberta(false),
          })
        }
        onFocus={() => lista.length > 0 && setAberta(true)}
        onBlur={() => setAberta(false)}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="none"
        spellCheck={false}
        enterKeyHint="search"
        placeholder="Ex.: 601448 ou Maria"
        className={`${CAMPO} text-[18px] font-semibold`}
      />
      {mostrar && (
        <ListaOpcoes id={idLista} rotulo="Responsáveis encontrados" itens={lista} ativo={ativo} chave={(r) => r.matricula} onEscolher={escolher}>
          {(r) => (
            <>
              <span className="block truncate text-[14.5px] font-semibold text-ink">{r.nome || "Sem nome no cadastro"}</span>
              <span className="block truncate text-[12.5px] text-muted tabular">
                Mat. {r.matricula}
                {r.area ? ` · ${r.area}` : ""}
              </span>
            </>
          )}
        </ListaOpcoes>
      )}
      <p id={`${id}-dica`} aria-live="polite" className="mt-1 text-[12px] text-muted">
        {aberta && buscando
          ? "Buscando os responsáveis…"
          : semNada
            ? "Nenhum responsável com esse código ou nome. Confira ou digite a matrícula e toque em Buscar."
            : "Digite a matrícula ou parte do nome e escolha na lista. Fica lembrada neste aparelho; aparecem só as O.S. em aberto no nome escolhido."}
      </p>
    </div>
  );
}

/**
 * Tipo de aplicação só do cadastro Tipo Aplicação (os ativos): digita o código ou parte do texto e escolhe na lista
 * (grava a descrição, como a tela Apontamento). Texto que não casa com nenhum tipo, ao sair do campo, avisa e deixa o
 * campo em branco. O tipo gravado num lançamento antigo que não está no cadastro continua (só sai se for trocado).
 */
function CampoTipoAplicacao({ id, valor, tipos, onChange, onRecusado }) {
  const [texto, setTexto] = useState(null); // o digitado (null: mostra o escolhido)
  const [aberta, setAberta] = useState(false);
  const [ativo, setAtivo] = useState(-1);
  const [aviso, setAviso] = useState(null);
  const carregado = Array.isArray(tipos);
  const lista = useMemo(() => (Array.isArray(tipos) ? tipos : []), [tipos]);
  const atual = valor ? tipoDoCadastro(lista, valor) : null;
  const exibido = atual ? codDs(atual.cod, atual.ds) : (valor ?? "");
  const fora = !!valor && carregado && !atual;
  const filtrados = useMemo(() => filtrarTipos(lista, texto ?? ""), [lista, texto]);
  const idLista = `${id}-lista`;
  const mostrar = aberta && filtrados.length > 0;
  const semCadastro = carregado && lista.length === 0;

  // o tipo preenchido de outro jeito (padrão da O.S., lançamento aberto para editar) tira o aviso do digitado antes
  useEffect(() => {
    if (!valor) return;
    setAviso(null);
    onRecusado?.(null);
  }, [valor, onRecusado]);

  function escolher(t) {
    onChange(t.ds);
    setTexto(null);
    setAberta(false);
    setAtivo(-1);
    setAviso(null);
    onRecusado?.(null);
  }

  /**
   * Ao sair do campo: o digitado vira o tipo do cadastro que casa com ele (ou o único da lista filtrada); sem nenhum,
   * avisa e deixa em branco (`onRecusado`: o Gravar logo em seguida avisa também, em vez de gravar sem o tipo).
   */
  function sair() {
    setAberta(false);
    setAtivo(-1);
    if (texto === null) return;
    const t = texto.trim();
    setTexto(null);
    if (!t) {
      if (valor) onChange("");
      onRecusado?.(null);
      return;
    }
    // o que estava no campo, sem mudar (inclusive o tipo antigo fora do cadastro)
    if (chaveBusca(t) === chaveBusca(exibido) || chaveBusca(t) === chaveBusca(valor)) return;
    const achado = tipoDoCadastro(lista, t) ?? (filtrados.length === 1 ? filtrados[0] : null);
    if (achado) return escolher(achado);
    onChange("");
    onRecusado?.(t);
    setAviso(
      filtrados.length > 1
        ? `Mais de um tipo com “${t}”: o campo ficou em branco. Escolha o tipo na lista.`
        : `“${t}” não está no cadastro Tipo Aplicação: o campo ficou em branco. Digite o código ou o nome e escolha na lista.`,
    );
  }

  const dica = aviso
    ? null
    : !carregado
      ? "Carregando o cadastro Tipo Aplicação…"
      : semCadastro
        ? "O cadastro Tipo Aplicação não tem tipos ativos."
        : fora
          ? `“${valor}” não está no cadastro (lançamento antigo): fica como está se não for trocado.`
          : aberta && texto && !filtrados.length
            ? "Nenhum tipo com esse código ou nome."
            : "Digite o código ou parte do nome e escolha na lista.";
  return (
    <div>
      <label htmlFor={id} className={ROTULO}>
        Tipo de aplicação
      </label>
      <input
        id={id}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={mostrar}
        aria-controls={mostrar ? idLista : undefined}
        aria-activedescendant={mostrar && ativo >= 0 ? `${idLista}-${ativo}` : undefined}
        aria-describedby={`${id}-dica`}
        aria-invalid={aviso ? true : undefined}
        value={texto ?? exibido}
        disabled={!carregado || (semCadastro && !valor)}
        placeholder={carregado ? "Código ou nome do tipo" : "Carregando…"}
        onChange={(e) => {
          setTexto(e.target.value.slice(0, 80));
          setAberta(true);
          setAtivo(-1);
          setAviso(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !(mostrar && ativo >= 0) && filtrados.length === 1 && texto) {
            e.preventDefault();
            return escolher(filtrados[0]);
          }
          teclasDaLista(e, {
            aberta: mostrar,
            n: filtrados.length,
            ativo,
            setAtivo,
            setAberta,
            escolher: (i) => escolher(filtrados[i]),
            // Esc desiste do digitado: volta ao que estava
            fechar: () => {
              setAberta(false);
              setTexto(null);
            },
          });
        }}
        onFocus={(e) => {
          e.target.select();
          setAberta(true);
        }}
        onBlur={sair}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="done"
        className={`${CAMPO} ${aviso ? "!border-alert-500" : ""}`}
      />
      {mostrar && (
        <ListaOpcoes id={idLista} rotulo="Tipos de aplicação do cadastro" itens={filtrados} ativo={ativo} chave={(t) => `${t.cod}|${t.ds}`} onEscolher={escolher}>
          {(t) => (
            <span className={`block text-[14px] leading-snug ${atual && atual.ds === t.ds && atual.cod === t.cod ? "font-semibold text-ink" : "text-ink"}`}>
              {t.cod ? <span className="tabular text-muted">{t.cod} · </span> : null}
              {t.ds}
            </span>
          )}
        </ListaOpcoes>
      )}
      <p id={`${id}-dica`} aria-live="polite" className={`mt-1 text-[12px] ${aviso ? "font-medium text-alert-600" : fora ? "text-amber-600" : "text-muted"}`}>
        {aviso ?? dica}
      </p>
    </div>
  );
}
