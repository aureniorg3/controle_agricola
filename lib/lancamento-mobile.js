/**
 * Regras (sem banco) do Lançamento Mobile (Atividades): o texto padrão para o grupo do WhatsApp (de uma O.S. ou de um
 * lançamento com várias), a marca que liga a mensagem ao boletim — ou aos boletins — lançado no sistema (o bot do
 * WhatsApp não lança de novo) e o modelo do texto pela classificação da operação. Usado pela tela (cliente) e pelo
 * servidor: não importa nada de banco aqui.
 */

/** Status da O.S. informado no campo (vai no texto; não muda a posição da O.S. na base). */
export const STATUS_OS = ["MANTER ABERTA", "CONCLUÍDA", "NÃO CONCLUÍDA"];

/** Unidade da calda / insumo: L (L/ha) ou kg (kg/ha). */
export const UNIDADES_CALDA = ["L", "kg"];

/** Modelos do texto: mecanizada (talhão sem "ha") e manual (talhão com "ha"). */
export const MODELOS = [
  { valor: "mecanizada", rotulo: "Mecanizada" },
  { valor: "manual", rotulo: "Manual" },
];

/** Matrícula ou código de quem lança: preenchido, até 30 caracteres e não só zeros (0 é "sem responsável" na O.S.). */
export function matriculaValida(m) {
  const s = String(m ?? "").trim();
  return s.length > 0 && s.length <= 30 && !/^0+$/.test(s);
}

const semAcento = (s) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

/** Modelo do texto pela Classificação de Operações do cadastro: MANUAL → manual; as demais (mecanizada, aérea…) → mecanizada. */
export function modeloDaClassificacao(classificacao) {
  return /\bMANUAL\b/.test(semAcento(classificacao).toUpperCase()) ? "manual" : "mecanizada";
}

// ---------------------------------------------------------------------------
// Números e datas no formato brasileiro
// ---------------------------------------------------------------------------

const ehNumero = (n) => typeof n === "number" && Number.isFinite(n);

/** Área com duas casas: 12,50 (vazio sem número). */
export const fmtArea = (n) => (ehNumero(n) ? n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "");

/** Calda, dose e volumes: até três casas, sem zeros sobrando (150; 1.500; 0,035). */
export const fmtNum = (n) => (ehNumero(n) ? n.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 3 }) : "");

/**
 * Número digitado: "12,5" ou "1.234,56" (vírgula decimal), "19.500" e "1.234.567" (ponto de milhar, como a calda vem
 * escrita no grupo: "Calda: 19.500 LTS") e "12.5" ou "0.500" (ponto decimal); vazio → null; inválido → NaN. Usado pela
 * tela e pelo servidor do Lançamento Mobile (a rota da tela Apontamento lê do jeito dela).
 */
export function lerNumero(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : NaN;
  const s = String(v ?? "").trim();
  if (!s) return null;
  const x = Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : /^[1-9]\d{0,2}(\.\d{3})+$/.test(s) ? s.replace(/\./g, "") : s);
  return Number.isFinite(x) ? x : NaN;
}

/** "2026-10-15" → "15/10/2026". */
const dataBR = (iso) => (/^\d{4}-\d{2}-\d{2}/.test(iso ?? "") ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "");

/** Talhão no texto: número com dois dígitos ("5" → "TL 05", "5A" → "TL 05A"); o resto como está. */
export function rotuloTalhao(tlh) {
  const t = String(tlh ?? "").trim();
  const m = /^0*(\d+)(.*)$/.exec(t);
  return m ? `TL ${m[1].padStart(2, "0")}${m[2]}` : `TL ${t}`;
}

// ---------------------------------------------------------------------------
// Marca do sistema (última linha do texto)
// ---------------------------------------------------------------------------

/** Nºs de boletim por extenso: "160", "160 e 161", "160, 161 e 162". */
export function listaDeBoletins(boletins) {
  const l = (boletins ?? []).filter((b) => b !== null && b !== undefined && b !== "").map(String);
  return l.length > 1 ? `${l.slice(0, -1).join(", ")} e ${l[l.length - 1]}` : (l[0] ?? "");
}

/**
 * Última linha do texto: liga a mensagem do grupo ao boletim (em itálico no WhatsApp). O lançamento com várias O.S.
 * (uma lista) tem um boletim por O.S.: "Boletins nº 160 e 161 · lançado no sistema".
 */
export const linhaDaMarca = (boletins) => {
  const l = Array.isArray(boletins) ? boletins : [boletins];
  return l.length > 1 ? `_Boletins nº ${listaDeBoletins(l)} · lançado no sistema_` : `_Boletim nº ${l[0] ?? ""} · lançado no sistema_`;
};

// caracteres invisíveis (marcas de direção, junção) e espaços especiais que o WhatsApp e o celular põem no texto
const INVISIVEIS = /[​-‏‪-‮⁠-⁩﻿]/g;
const ESPACOS = /[   ]/g;
// a linha começa com a marca (até 3 sinais antes, como um emoji): "boletim nº 160" ou, no lançamento com várias O.S.,
// "boletins nº 160 e 161" / "160, 161 e 162" (até 50 nºs). Depois dos espaços juntados, entre um nº e o seguinte há
// sempre um separador (vírgula, "e", "/", ";") e cada nº tem até 7 dígitos: nada aqui volta atrás mais que uns poucos
// caracteres por nº
const RE_MARCA =
  /^[^\S\n]*(?:[^\w\n]{0,3}[^\S\n]*)?bolet(?:im|ins)[^\S\n]*n(?:os|o|°|\.|ro)?[^\S\n]*[.:]?[^\S\n]*(\d{1,7}(?:[^\S\n]*(?:,|;|\/|e)[^\S\n]*\d{1,7}){0,49})[^\S\n]*[·•|\-–][^\S\n]*lancado no sistema\b/gm;

/**
 * Nºs dos boletins da marca "Boletim nº N · lançado no sistema" (uma O.S.) ou "Boletins nº N e M · lançado no
 * sistema" (várias O.S.), com ou sem negrito/itálico, "nº", "n°", "no", separador "·", "-" ou "|", emoji antes: a
 * lista (um nº só no formato de uma O.S.), da última marca se houver mais de uma. null sem marca. A frase no meio de
 * uma observação ("boletim 160 lançado no sistema ontem") não conta.
 */
export function marcaDoSistema(texto) {
  const t = String(texto ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(INVISIVEIS, "")
    .replace(ESPACOS, " ")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[*_~`]/g, "")
    .replace(/[^\S\n]+/g, " ")
    .toLowerCase();
  let ultima = null;
  for (const m of t.matchAll(RE_MARCA)) ultima = m[1];
  if (ultima === null) return null;
  const nums = [...new Set(ultima.match(/\d+/g).map(Number))].filter((n) => n > 0);
  return nums.length ? nums : null;
}

// ---------------------------------------------------------------------------
// Texto padrão para o grupo do WhatsApp
// ---------------------------------------------------------------------------

/** Valor numa linha só (quebras e espaços repetidos viram um espaço). */
const umaLinha = (v) =>
  String(v ?? "")
    .replace(/\s+/g, " ")
    .trim();
const campo = (rotulo, valor) => {
  const v = umaLinha(valor);
  return v ? `${rotulo}: ${v}` : `${rotulo}:`;
};
const codDs = (cod, ds) => [umaLinha(cod), umaLinha(ds)].filter(Boolean).join(" - ");

/** Fazendas do apontamento na ordem dos talhões, cada uma com os seus talhões e o total. */
function fazendasDoApontamento(talhoes) {
  const m = new Map();
  for (const t of talhoes ?? []) {
    if (!(t.area > 0)) continue;
    const k = String(t.propCod ?? "").trim();
    let f = m.get(k);
    if (!f) {
      f = { cod: k, nm: "", talhoes: [], total: 0 };
      m.set(k, f);
    }
    if (!f.nm && t.propNm) f.nm = t.propNm;
    f.talhoes.push(t);
    f.total += t.area;
  }
  return [...m.values()];
}

/** Bloco de uma fazenda: "Fazenda:", um TL por linha (mecanizada sem "ha", manual com) e o total. */
const blocoFazenda = (f, ha) =>
  [
    campo("Fazenda", codDs(f.cod, f.nm)),
    ...f.talhoes.map((t) => `${String(t.tlh ?? "").trim() ? rotuloTalhao(t.tlh) : "Área"} = ${fmtArea(t.area)}${ha}`),
    `Total Fazenda: ${fmtArea(f.total)} ha`,
  ].join("\n");

const modeloDoTexto = (modelo, a) => (modelo === "manual" || modelo === "mecanizada" ? modelo : a.modelo === "manual" ? "manual" : "mecanizada");
const r2 = (n) => Math.round(n * 100) / 100;

/**
 * Texto do apontamento gravado (como obterApontamento devolve) no modelo padrão do grupo: cabeçalho, um bloco por
 * fazenda (TL nn = área; "Área = …" para a fazenda lançada sem talhão), totais, calda e status, e a marca do boletim na
 * última linha. Mecanizada: área do talhão sem "ha"; manual: com "ha". Campo vazio fica só com o rótulo.
 * Com a lista dos apontamentos de um lançamento com várias O.S. (um por O.S./operação, mesmo cabeçalho), o texto é um
 * só: ver textoDeVariasOS. Lista de um apontamento só = o texto de uma O.S.
 */
export function montarTextoWhatsapp(apontamento, { modelo } = {}) {
  const lista = (Array.isArray(apontamento) ? apontamento : [apontamento]).filter(Boolean);
  if (lista.length > 1) return textoDeVariasOS(lista, modelo);
  const a = lista[0] ?? {};
  const m = modeloDoTexto(modelo, a);
  const ha = m === "manual" ? " ha" : "";
  const un = a.unCalda === "kg" ? "kg" : "L";
  const blocos = [
    [
      campo("Atividade", a.atividade),
      campo("Data da Operação", dataBR(a.dt)),
      campo("O.S.", a.os),
      campo("Operação", codDs(a.opCod, a.opDs)),
      campo("Solicitante", a.solicitante),
      campo("Etapa", codDs(a.etapaCod, a.etapaDs)),
      campo("Tipo de Aplicação", a.tipoAplicacao),
      campo("Prestador / Equipe", a.equipe),
      campo("Equipamento (Frota)", a.eqp),
      campo("Nº de Equipamentos", a.numEquipamentos > 0 ? String(a.numEquipamentos) : ""),
      campo("Nº de Pessoas", a.numPessoas > 0 ? String(a.numPessoas) : ""),
    ].join("\n"),
  ];
  let total = 0;
  for (const f of fazendasDoApontamento(a.talhoes)) {
    total += f.total;
    blocos.push(blocoFazenda(f, ha));
  }
  blocos.push(
    [
      `Área Total Realizada: ${fmtArea(r2(total))} ha`,
      campo("Calda/Dose Recomendada", a.vazaoRec > 0 ? `${fmtNum(a.vazaoRec)} ${un}/ha` : ""),
      campo("Calda/Insumo Gasto", a.volCalda > 0 ? `${fmtNum(a.volCalda)} ${un}` : ""),
      campo("Status da O.S.", a.statusOS),
      campo("Observação", a.obs),
    ].join("\n"),
  );
  blocos.push(linhaDaMarca(a.boletim));
  return blocos.join("\n\n");
}

/**
 * Status da O.S. no texto com várias O.S.: o de cada O.S. ("6052 MANTER ABERTA · 6053 CONCLUÍDA"; a O.S. que entra com
 * mais de uma operação vale pelo primeiro status preenchido) ou, com uma O.S. só (outras operações dela), só o status.
 */
function statusDasOS(lista) {
  const porOS = new Map();
  for (const x of lista) {
    const os = umaLinha(x.os);
    const s = umaLinha(x.statusOS);
    if (!porOS.get(os)) porOS.set(os, s);
  }
  if (porOS.size === 1) return [...porOS.values()][0];
  return [...porOS]
    .filter(([, s]) => s)
    .map(([os, s]) => `${os} ${s}`)
    .join(" · ");
}

/**
 * Texto do lançamento com várias O.S. (os apontamentos dele na ordem dos boletins): o cabeçalho de sempre com as O.S. e
 * as operações listadas (solicitante, etapa e tipo também, quando mudam de uma O.S. para outra; o mesmo valor vai uma
 * vez); para cada O.S., a linha "O.S. 6052 · cód - operação", os blocos das fazendas dela e "Total O.S. 6052"; depois a
 * área total, a dose (a mesma em todas), a calda gasta do lançamento (a soma do que foi rateado entre as O.S.), o
 * status de cada O.S. e a marca com todos os boletins.
 */
function textoDeVariasOS(lista, modelo) {
  const a = lista[0];
  const ha = modeloDoTexto(modelo, a) === "manual" ? " ha" : "";
  const un = a.unCalda === "kg" ? "kg" : "L";
  const varios = (f) => [...new Set(lista.map((x) => umaLinha(f(x))).filter(Boolean))].join(", ");
  const blocos = [
    [
      campo("Atividade", varios((x) => x.atividade)),
      campo("Data da Operação", dataBR(a.dt)),
      campo("O.S.", varios((x) => x.os)),
      campo("Operação", varios((x) => codDs(x.opCod, x.opDs))),
      campo("Solicitante", varios((x) => x.solicitante)),
      campo("Etapa", varios((x) => codDs(x.etapaCod, x.etapaDs))),
      campo("Tipo de Aplicação", varios((x) => x.tipoAplicacao)),
      campo("Prestador / Equipe", a.equipe),
      campo("Equipamento (Frota)", a.eqp),
      campo("Nº de Equipamentos", a.numEquipamentos > 0 ? String(a.numEquipamentos) : ""),
      campo("Nº de Pessoas", a.numPessoas > 0 ? String(a.numPessoas) : ""),
    ].join("\n"),
  ];
  // a mesma O.S. com outra operação: o total leva a operação para não repetir "Total O.S. 6052"
  const vezes = new Map();
  for (const x of lista) vezes.set(umaLinha(x.os), (vezes.get(umaLinha(x.os)) ?? 0) + 1);
  let total = 0;
  for (const x of lista) {
    const os = umaLinha(x.os);
    const titulo = `O.S. ${os} · ${codDs(x.opCod, x.opDs)}`;
    const fazendas = fazendasDoApontamento(x.talhoes);
    let totalOS = 0;
    fazendas.forEach((f, i) => {
      totalOS += f.total;
      blocos.push(i === 0 ? `${titulo}\n${blocoFazenda(f, ha)}` : blocoFazenda(f, ha));
    });
    if (fazendas.length === 0) blocos.push(titulo);
    total += totalOS;
    blocos.push(`Total O.S. ${os}${vezes.get(os) > 1 ? ` · ${umaLinha(x.opCod)}` : ""}: ${fmtArea(r2(totalOS))} ha`);
  }
  const calda = lista.reduce((s, x) => s + (x.volCalda > 0 ? x.volCalda : 0), 0);
  blocos.push(
    [
      `Área Total Realizada: ${fmtArea(r2(total))} ha`,
      campo("Calda/Dose Recomendada", a.vazaoRec > 0 ? `${fmtNum(a.vazaoRec)} ${un}/ha` : ""),
      campo("Calda/Insumo Gasto", calda > 0 ? `${fmtNum(Math.round(calda * 1000) / 1000)} ${un}` : ""),
      campo("Status da O.S.", statusDasOS(lista)),
      campo("Observação", a.obs),
    ].join("\n"),
  );
  blocos.push(linhaDaMarca(lista.map((x) => x.boletim)));
  return blocos.join("\n\n");
}
