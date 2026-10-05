"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { IconBusca } from "@/components/icons";
import { fmtDateBR, fmtHa, todayISO } from "@/lib/format";
import { podeEditar } from "@/lib/permissoes";
import type { RodadaCad } from "@/lib/rodadas";
import type { PerfilUsuario } from "@/lib/types";

const INPUT_BASE =
  "rounded-md border border-line bg-card px-2.5 py-1.5 text-[13px] text-ink focus:border-brand-600 focus:outline-none disabled:bg-surface";
const INPUT = `w-full ${INPUT_BASE}`;
const SOMENTE_LEITURA = "w-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-[13px] text-ink";
const ROTULO = "mb-1 block text-[11.5px] font-semibold text-muted";
const BOTAO_BUSCA =
  "flex h-[32px] w-[30px] flex-shrink-0 items-center justify-center rounded-md border border-line bg-surface text-muted hover:bg-card hover:text-navy-800 disabled:opacity-40";
const LIMITE_REC = 150;

type Cad = "regiao" | "fazendas" | "ocorrencias" | "presenca-infestacao" | "nivel-infestacao" | "prioridade";
type Campo = "rod" | "sem" | "reg" | "faz" | "pre" | "niv" | "pri";

/** Cadastro consultado por cada campo com código */
const CAD_DO_CAMPO: Partial<Record<Campo, Cad>> = {
  reg: "regiao",
  faz: "fazendas",
  pre: "presenca-infestacao",
  niv: "nivel-infestacao",
  pri: "prioridade",
};
const TITULO_CAMPO: Record<Campo, string> = {
  rod: "Rodada",
  sem: "Semana",
  reg: "Região",
  faz: "Fazenda",
  pre: "Presença",
  niv: "Nível de Infestação",
  pri: "Prioridade",
};

/** Resultado de uma consulta de código: nm = descrição; null = não cadastrado; vazio = o cadastro ainda não tem itens. */
type Consulta = { nm: string | null; vazio: boolean };
interface Talhao {
  tlh: string;
  area: number | null;
}
interface ItemLista {
  cod: string;
  nm: string;
}

interface BoletimVisto {
  bol: number;
  rod: number;
  dt: string;
  sem: number;
  reg: string;
  resp: string;
  faz: string;
  ori: string;
  usr: string;
  itens: { oco: string; ocoTxt: string; pre: string; niv: string; pri: string; tlh: string; area: number | null; rec: string }[];
}
interface RegistroLog {
  id: number;
  bol: number;
  acao: string;
  usuario: string;
  em: string;
  resumo: string;
}

/** "2026-10-05T08:41:20" -> "05/10/2026 08:41:20" */
function fmtDataHora(iso: string): string {
  const [d, h] = iso.split("T");
  return `${fmtDateBR(d)} ${h ?? ""}`.trim();
}

/** Cor sugerida pela descrição do nível/prioridade (verde = baixo, âmbar = médio, vermelho = alto). */
function corPorDescricao(nm: string): string {
  const t = nm.toLowerCase();
  if (/alt|grave|urgent|cr[ií]tic|\b3\b/.test(t)) return "bg-alert-50 text-alert-700 border-alert-500/40";
  if (/m[eé]d|\b2\b/.test(t)) return "bg-amber-50 text-amber-700 border-amber-500/40";
  if (/baix|leve|\b1\b/.test(t)) return "bg-good-50 text-good-700 border-good-500/40";
  return "bg-surface text-ink border-line";
}

export default function ApontamentoClient({ perfil }: { perfil: PerfilUsuario }) {
  const podeGravar = podeEditar(perfil);
  const formRef = useRef<HTMLDivElement>(null);

  const [boletim, setBoletim] = useState<number | null>(null);
  // a data é a do lançamento no sistema (hoje); a semana é informada depois da rodada
  const [dt, setDt] = useState(todayISO());
  const [rod, setRod] = useState("");
  const [sem, setSem] = useState("");
  const [reg, setReg] = useState("");
  const [faz, setFaz] = useState("");
  const [pre, setPre] = useState("");
  const [niv, setNiv] = useState("");
  const [pri, setPri] = useState("");
  const [ocorrencias, setOcorrencias] = useState<ItemLista[]>([]);
  const [ocoDigitada, setOcoDigitada] = useState("");
  const [ocoErro, setOcoErro] = useState<string | null>(null);
  const [listaAberta, setListaAberta] = useState(false);
  const [listaOco, setListaOco] = useState<ItemLista[] | null>(null);
  const [seletor, setSeletor] = useState<Campo | null>(null);
  const [rec, setRec] = useState("");
  const [talhoes, setTalhoes] = useState<Talhao[]>([]);
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [talhoesDe, setTalhoesDe] = useState("");
  const [rodadas, setRodadas] = useState<RodadaCad[]>([]);
  const [consultas, setConsultas] = useState<Record<string, Consulta>>({});
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  // boletim já lançado: buscado para alterar ou excluir
  const [buscaBol, setBuscaBol] = useState("");
  const [editando, setEditando] = useState<{ bol: number; usr: string } | null>(null);
  const [importadoVisto, setImportadoVisto] = useState<BoletimVisto | null>(null);
  const [logAberto, setLogAberto] = useState<{ bol?: number } | null>(null);

  const carregarBoletim = useCallback(async () => {
    const res = await fetch("/api/rodadas/apontamento", { cache: "no-store" });
    if (res.ok) setBoletim((await res.json()).boletim);
  }, []);

  useEffect(() => {
    carregarBoletim();
    fetch("/api/rodadas/cadastro", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setRodadas(j.rodadas ?? []))
      .catch(() => undefined);
    setTimeout(() => focar(0), 50);
  }, [carregarBoletim]);

  function navegaveis(): HTMLInputElement[] {
    return Array.from(formRef.current?.querySelectorAll<HTMLInputElement>("[data-nav]:not(:disabled)") ?? []);
  }
  function focar(i: number) {
    const el = navegaveis()[i];
    if (el) {
      el.focus();
      el.select?.();
    }
  }
  /** foca o campo seguinte ao de nome `campo` (depois de escolher no seletor) */
  function focarDepoisDe(campo: string) {
    setTimeout(() => {
      const navs = navegaveis();
      const i = navs.findIndex((n) => n.dataset.campo === campo);
      if (i >= 0) focar(Math.min(i + 1, navs.length - 1));
    }, 60);
  }

  async function chamar(cad: Cad, cod: string): Promise<{ cadastroComItens: boolean; item: { cod: string; nm: string } | null } | null> {
    try {
      const res = await fetch(`/api/rodadas/apontamento?cad=${cad}&cod=${encodeURIComponent(cod)}`, { cache: "no-store" });
      return res.ok ? await res.json() : null;
    } catch {
      return null;
    }
  }

  // consulta um código no cadastro e guarda, para mostrar a descrição ao lado
  async function consultar(cad: Cad, cod: string) {
    const valor = cod.trim();
    if (!valor) return;
    const j = await chamar(cad, valor);
    if (j) setConsultas((c) => ({ ...c, [`${cad}|${valor}`]: { nm: j.item?.nm ?? null, vazio: !j.cadastroComItens } }));
    if (cad === "fazendas") carregarTalhoes(valor);
  }

  async function carregarTalhoes(codigo: string) {
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

  const descricao = (cad: Cad, cod: string): Consulta | null => consultas[`${cad}|${cod.trim()}`] ?? null;
  const nomeDe = (cad: Cad, cod: string) => descricao(cad, cod)?.nm ?? "";

  const valorDoCampo: Record<Campo, string> = { rod, sem, reg, faz, pre, niv, pri };
  const gravarCampo: Record<Campo, (v: string) => void> = {
    rod: setRod,
    sem: setSem,
    reg: setReg,
    faz: setFaz,
    pre: setPre,
    niv: setNiv,
    pri: setPri,
  };

  async function adicionarOcorrencia(texto: string) {
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

  async function abrirLista() {
    setListaAberta(true);
    if (listaOco) return;
    try {
      const res = await fetch("/api/rodadas/apontamento?lista=ocorrencias", { cache: "no-store" });
      const j = await res.json();
      setListaOco(res.ok ? (j.itens as ItemLista[]) : []);
    } catch {
      setListaOco([]);
    }
  }

  function alternarOcorrencia(o: ItemLista) {
    setOcorrencias((l) => (l.some((x) => x.cod === o.cod) ? l.filter((x) => x.cod !== o.cod) : [...l, o]));
  }

  const rodadaSel = useMemo(() => rodadas.find((r) => String(r.rod) === rod.trim()), [rodadas, rod]);
  const semanaInfo = rodadaSel ? rodadaSel.semanas.find((s) => String(s.sem) === sem.trim()) : undefined;

  // itens do seletor "ver e escolher" de cada campo
  async function buscarNoSeletor(campo: Campo, q: string): Promise<ItemLista[]> {
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
      return res.ok ? (j.itens as { cod: string; nm: string }[]).map((i) => ({ cod: i.cod, nm: i.nm })) : [];
    } catch {
      return [];
    }
  }

  function escolherNoSeletor(campo: Campo, item: ItemLista) {
    gravarCampo[campo](item.cod);
    const cad = CAD_DO_CAMPO[campo];
    if (cad) {
      setConsultas((c) => ({ ...c, [`${cad}|${item.cod}`]: { nm: item.nm, vazio: false } }));
      if (cad === "fazendas") carregarTalhoes(item.cod);
    }
    setSeletor(null);
    focarDepoisDe(campo);
  }

  const areaMarcada = useMemo(
    () => talhoes.filter((t) => marcados.has(t.tlh)).reduce((s, t) => s + (t.area ?? 0), 0),
    [talhoes, marcados]
  );
  const todosMarcados = talhoes.length > 0 && marcados.size === talhoes.length;

  function alternarTalhao(t: string) {
    setMarcados((m) => {
      const n = new Set(m);
      if (n.has(t)) n.delete(t);
      else n.add(t);
      return n;
    });
  }

  /** consulta o código só para mostrar a descrição (sem recarregar talhões) */
  async function registrarConsulta(cad: Cad, cod: string) {
    const valor = cod.trim();
    if (!valor) return;
    const j = await chamar(cad, valor);
    if (j) setConsultas((c) => ({ ...c, [`${cad}|${valor}`]: { nm: j.item?.nm ?? null, vazio: !j.cadastroComItens } }));
  }

  /** Busca um boletim lançado pelo número e o abre para alterar (os importados só podem ser vistos e excluídos). */
  async function buscarBoletim() {
    setErro(null);
    setAviso(null);
    const n = Number(buscaBol.trim());
    if (!Number.isInteger(n) || n <= 0) return setErro("Informe o número do boletim.");
    const res = await fetch(`/api/rodadas/apontamento?boletim=${n}`, { cache: "no-store" });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return setErro(j.error ?? "Boletim não encontrado.");
    const b = j.boletim as BoletimVisto;
    limpar(false);
    if (b.ori !== "apontamento") {
      setEditando(null);
      setImportadoVisto(b);
      return;
    }
    setImportadoVisto(null);
    const primeiro = b.itens[0];
    setEditando({ bol: b.bol, usr: b.usr });
    setDt(b.dt);
    setRod(String(b.rod));
    setSem(String(b.sem));
    setReg(b.reg);
    setFaz(b.faz);
    setPre(primeiro?.pre ?? "");
    setNiv(primeiro?.niv ?? "");
    setPri(primeiro?.pri ?? "");
    setRec(primeiro?.rec ?? "");
    const codigos = (primeiro?.oco ?? "").split(",").map((c) => c.trim()).filter(Boolean);
    const sel: ItemLista[] = [];
    for (const cod of codigos) {
      const r = await chamar("ocorrencias", cod);
      sel.push({ cod: r?.item?.cod ?? cod, nm: r?.item?.nm ?? "" });
    }
    setOcorrencias(sel);
    // talhões da fazenda e, marcados, os do boletim
    const base = b.faz.split("-")[0];
    let lista: Talhao[] = [];
    try {
      const r = await fetch(`/api/rodadas/apontamento?talhoes_faz=${encodeURIComponent(base)}`, { cache: "no-store" });
      const jj = await r.json();
      if (r.ok) lista = jj.talhoes ?? [];
    } catch {
      /* usa só os talhões do boletim */
    }
    for (const it of b.itens) if (!lista.some((t) => t.tlh === it.tlh)) lista.push({ tlh: it.tlh, area: it.area });
    setTalhoes(lista);
    setMarcados(new Set(b.itens.map((i) => i.tlh)));
    setTalhoesDe(base);
    await Promise.all([
      registrarConsulta("regiao", b.reg),
      registrarConsulta("fazendas", b.faz),
      registrarConsulta("presenca-infestacao", primeiro?.pre ?? ""),
      registrarConsulta("nivel-infestacao", primeiro?.niv ?? ""),
      registrarConsulta("prioridade", primeiro?.pri ?? ""),
    ]);
  }

  function sairDoBoletim() {
    limpar(false);
    setDt(todayISO());
    setEditando(null);
    setImportadoVisto(null);
    setBuscaBol("");
  }

  async function excluirBoletimAberto(bol: number) {
    if (!window.confirm(`Excluir o boletim ${bol}? A exclusão fica registrada no log com data, hora e usuário.`)) return;
    setErro(null);
    const res = await fetch("/api/rodadas/apontamento", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bol }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return setErro(j.error ?? "Não foi possível excluir o boletim.");
    sairDoBoletim();
    setAviso(`Boletim ${bol} excluído.`);
    await carregarBoletim();
  }

  function limpar(manterCabecalho: boolean) {
    setFaz("");
    setPre("");
    setNiv("");
    setPri("");
    setOcorrencias([]);
    setOcoDigitada("");
    setOcoErro(null);
    setRec("");
    setTalhoes([]);
    setMarcados(new Set());
    setTalhoesDe("");
    if (!manterCabecalho) {
      setRod("");
      setSem("");
      setReg("");
    }
    setErro(null);
  }

  async function gravar() {
    if (salvando) return;
    setErro(null);
    setAviso(null);
    if (!rod.trim()) return setErro("Informe a rodada.");
    if (!rodadaSel) return setErro(`A rodada ${rod} não está cadastrada.`);
    if (!sem.trim()) return setErro("Informe a semana.");
    if (!semanaInfo) return setErro(`A semana ${sem} não existe na rodada ${rod}.`);
    if (ocorrencias.length === 0) return setErro("Informe pelo menos uma ocorrência.");
    if (marcados.size === 0) return setErro("Marque pelo menos um talhão.");
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
          rec,
          talhoes: talhoes.filter((t) => marcados.has(t.tlh)),
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "Não foi possível gravar o boletim.");
      if (editando) {
        sairDoBoletim();
        setAviso(`Boletim ${j.bol} alterado (semana ${j.sem}). A alteração ficou registrada no log.`);
        await carregarBoletim();
        setTimeout(() => focar(0), 50);
      } else {
        setAviso(`Boletim ${j.bol} gravado (semana ${j.sem}).`);
        limpar(true);
        await carregarBoletim();
        setTimeout(() => focarDepoisDe("reg"), 50); // volta para a Fazenda
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível gravar o boletim.");
    } finally {
      setSalvando(false);
    }
  }

  function aoTeclar(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "F2") {
      e.preventDefault();
      gravar();
      return;
    }
    const alvo = e.target as HTMLInputElement;
    if (!alvo.dataset?.nav) return;

    // F4: abre a lista para ver e escolher (padrão de ERP)
    if (e.key === "F4") {
      e.preventDefault();
      if (alvo.dataset.campo === "oco") abrirLista();
      else if (alvo.dataset.campo && alvo.dataset.campo in TITULO_CAMPO) setSeletor(alvo.dataset.campo as Campo);
      return;
    }

    // Backspace no campo de ocorrência vazio remove a última escolhida
    if (e.key === "Backspace" && alvo.dataset.campo === "oco" && alvo.value === "") {
      setOcorrencias((l) => l.slice(0, -1));
      return;
    }
    if (e.key !== "Enter") return;
    e.preventDefault();

    if (alvo.dataset.cad && alvo.dataset.campo !== "oco") consultar(alvo.dataset.cad as Cad, alvo.value);

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
  function campoCodigo(campo: Campo, largura: string, extra?: { cad?: Cad; pilula?: boolean; descricaoAoLado?: boolean }) {
    const cad = extra?.cad ?? CAD_DO_CAMPO[campo];
    const valor = valorDoCampo[campo];
    const c = cad ? descricao(cad, valor) : null;
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <input
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

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <header className="flex flex-shrink-0 items-center gap-3 border-b border-line bg-card px-4 py-3 md:px-6">
        <nav className="min-w-0 flex-1 text-[13px] text-muted">
          <span className="text-[11px] uppercase tracking-wide">Rodadas de Campo</span>
          <div className="truncate text-[15px] font-bold text-ink">Apontamento</div>
        </nav>
        {!podeGravar && (
          <div className="rounded-full border border-line bg-surface px-3 py-1.5 text-[12px] font-semibold text-muted">
            Somente leitura
          </div>
        )}
      </header>

      <div className="flex-1 overflow-y-auto px-3 py-4 md:px-6 md:py-5">
        <section className="mb-4 rounded-xl2 border border-line bg-card p-3 shadow-card md:p-4">
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className={ROTULO}>Buscar boletim lançado</label>
              <div className="flex items-center gap-1.5">
                <input
                  value={buscaBol}
                  onChange={(e) => setBuscaBol(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      buscarBoletim();
                    }
                  }}
                  inputMode="numeric"
                  placeholder="Nº do boletim"
                  className={`${INPUT_BASE} w-[150px]`}
                  aria-label="Número do boletim a buscar"
                />
                <button
                  type="button"
                  onClick={buscarBoletim}
                  className="flex items-center gap-1.5 rounded-md border border-line bg-surface px-3 py-1.5 text-[12.5px] font-semibold text-navy-800 hover:bg-card"
                >
                  <IconBusca size={13} />
                  Buscar
                </button>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setLogAberto({})}
              className="rounded-md border border-line bg-surface px-3 py-1.5 text-[12.5px] font-semibold text-navy-800 hover:bg-card"
            >
              Log de alterações
            </button>
          </div>
          {editando && (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-700">
              <span className="font-semibold">
                Editando o boletim {editando.bol} · lançado por {editando.usr || "—"} em {fmtDateBR(dt)}.
              </span>
              <button type="button" onClick={() => setLogAberto({ bol: editando.bol })} className="ml-auto font-semibold underline">
                Ver log deste boletim
              </button>
            </div>
          )}
          {importadoVisto && (
            <div className="mt-3 rounded-lg border border-line bg-surface px-3 py-2.5 text-[12.5px] text-ink">
              <p className="font-semibold">
                Boletim {importadoVisto.bol} — veio da importação da planilha (não pode ser alterado aqui, só excluído).
              </p>
              <p className="mt-1 text-muted">
                Rodada {importadoVisto.rod}, semana {importadoVisto.sem}, região {importadoVisto.reg || "—"}, fazenda {importadoVisto.faz},{" "}
                {importadoVisto.itens.length} linha(s) de talhão, responsável {importadoVisto.resp || "—"}.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => excluirBoletimAberto(importadoVisto.bol)}
                  disabled={!podeGravar}
                  className="rounded-md border border-alert-500/50 bg-card px-3 py-1.5 text-[12.5px] font-semibold text-alert-700 hover:bg-alert-50 disabled:opacity-50"
                >
                  Excluir boletim
                </button>
                <button type="button" onClick={() => setLogAberto({ bol: importadoVisto.bol })} className="rounded-md border border-line bg-card px-3 py-1.5 text-[12.5px] font-semibold text-navy-800 hover:bg-surface">
                  Ver log
                </button>
                <button type="button" onClick={sairDoBoletim} className="rounded-md border border-line bg-card px-3 py-1.5 text-[12.5px] font-semibold text-navy-800 hover:bg-surface">
                  Fechar
                </button>
              </div>
            </div>
          )}
        </section>

        <div ref={formRef} onKeyDown={aoTeclar} className="space-y-4">
          <section className="rounded-xl2 border border-line bg-card p-3 shadow-card md:p-4">
            <h2 className="mb-3 text-[14px] font-bold text-ink">Boletim de rodada de campo</h2>

            {/* Linha 1: Boletim · Data · Rodada · Semana · Região · Desc. Região */}
            <div className="grid grid-cols-6 gap-3 lg:grid-cols-[96px_132px_132px_112px_132px_minmax(0,1fr)]">
              <div className="col-span-3 lg:col-span-1">
                <label className={ROTULO}>Boletim</label>
                <input value={editando?.bol ?? boletim ?? ""} readOnly tabIndex={-1} className={`${SOMENTE_LEITURA} text-center font-bold`} aria-label="Boletim (automático)" />
              </div>
              <div className="col-span-3 lg:col-span-1">
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
              <div className="col-span-6 lg:col-span-1">
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

            {/* Linha 2: Fazenda · Descrição · Presença · Nível · Prioridade */}
            <div className="mt-2 grid grid-cols-3 gap-3 lg:grid-cols-[132px_minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
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

            {/* Ocorrência (uma ou mais) */}
            <div className="mt-3">
              <label className={ROTULO}>Ocorrência (uma ou mais — digite o código e Enter)</label>
              <div className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-card px-2 py-1.5">
                {ocorrencias.map((o) => (
                  <span key={o.cod} className="flex items-center gap-1 rounded-full border border-brand-200 bg-brand-50 px-2.5 py-0.5 text-[12px] font-semibold text-brand-800">
                    {o.cod}
                    {o.nm ? ` · ${o.nm}` : ""}
                    {podeGravar && (
                      <button
                        type="button"
                        tabIndex={-1}
                        onClick={() => alternarOcorrencia(o)}
                        aria-label={`Remover ${o.nm || o.cod}`}
                        className="ml-0.5 text-[14px] leading-none text-brand-700 hover:text-alert-600"
                      >
                        ×
                      </button>
                    )}
                  </span>
                ))}
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
                  placeholder={ocorrencias.length ? "Outro código…" : "Código da ocorrência"}
                  className="min-w-[130px] flex-1 border-0 bg-transparent px-1 py-1 text-[13px] text-ink focus:outline-none"
                  aria-label="Ocorrência"
                />
                {podeGravar && (
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={abrirLista}
                    className="flex items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 py-1 text-[12px] font-semibold text-navy-800 hover:bg-card"
                    title="Ver e escolher (F4)"
                  >
                    <IconBusca size={13} />
                    Escolher da lista
                  </button>
                )}
              </div>
              {ocoErro && <p className="mt-1 text-[12px] font-semibold text-alert-600">{ocoErro}</p>}
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
          </section>

          <section className="rounded-xl2 border border-line bg-card p-3 shadow-card md:p-4">
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <h2 className="text-[14px] font-bold text-ink">
                Talhões{fazendaNm ? ` · ${faz.trim().split("-")[0]} ${fazendaNm}` : ""}
              </h2>
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
                  ? "Nenhum talhão encontrado para esta fazenda. Importe o cadastro de talhões da safra (Histórico de Safras) para listá-los aqui."
                  : "Informe a fazenda para listar os talhões."}
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
                {talhoes.map((t) => {
                  const on = marcados.has(t.tlh);
                  return (
                    <label
                      key={t.tlh}
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

            {erro && <p className="mt-3 text-[12.5px] font-medium text-alert-600">{erro}</p>}
            {aviso && <p className="mt-3 text-[12.5px] font-semibold text-good-700">{aviso}</p>}

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={gravar}
                disabled={!podeGravar || salvando}
                className="rounded-lg bg-navy-900 px-4 py-2 text-[13px] font-semibold text-white shadow-card hover:bg-navy-800 disabled:opacity-50"
              >
                {salvando ? "Gravando…" : editando ? "Gravar alterações (F2)" : "Gravar (F2)"}
              </button>
              {editando && (
                <>
                  <button
                    type="button"
                    onClick={sairDoBoletim}
                    className="rounded-lg border border-line bg-card px-3.5 py-2 text-[13px] font-semibold text-navy-800 shadow-card hover:bg-surface"
                  >
                    Cancelar edição
                  </button>
                  <button
                    type="button"
                    onClick={() => excluirBoletimAberto(editando.bol)}
                    disabled={!podeGravar}
                    className="rounded-lg border border-alert-500/50 bg-card px-3.5 py-2 text-[13px] font-semibold text-alert-700 shadow-card hover:bg-alert-50 disabled:opacity-50"
                  >
                    Excluir boletim
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => (editando ? sairDoBoletim() : limpar(false))}
                disabled={!podeGravar}
                className="rounded-lg border border-line bg-card px-3.5 py-2 text-[13px] font-semibold text-navy-800 shadow-card hover:bg-surface disabled:opacity-50"
              >
                Limpar tudo
              </button>
            </div>
            <p className="mt-3 text-[11.5px] leading-relaxed text-muted">
              Enter ou Tab passa para o próximo campo. Digite só o código — a descrição vem do cadastro — ou use a lupa (ou F4)
              para ver a lista e escolher. Na ocorrência, digite o código e Enter para incluir cada uma (Backspace remove a
              última). Marque os talhões com a barra de espaço. Para gravar: F2, o botão Gravar ou Enter no último campo. O
              número do boletim é sempre o último + 1.
            </p>
          </section>
        </div>
      </div>

      {logAberto && <LogModal bol={logAberto.bol} onFechar={() => setLogAberto(null)} />}

      {seletor && (
        <Seletor
          titulo={TITULO_CAMPO[seletor]}
          buscar={(q) => buscarNoSeletor(seletor, q)}
          onEscolher={(item) => escolherNoSeletor(seletor, item)}
          onFechar={() => setSeletor(null)}
        />
      )}

      {listaAberta && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy-950/50 px-4">
          <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-xl2 bg-card p-5 shadow-pop">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-[15px] font-bold text-ink">Ocorrências</h3>
              <button type="button" onClick={() => setListaAberta(false)} aria-label="Fechar" className="text-[18px] leading-none text-muted">
                ×
              </button>
            </div>
            {listaOco === null ? (
              <p className="text-[12.5px] text-muted">Carregando…</p>
            ) : listaOco.length === 0 ? (
              <p className="text-[12.5px] text-muted">Nenhuma ocorrência cadastrada. Use o Cadastro de Ocorrências.</p>
            ) : (
              <ul className="space-y-0.5">
                {listaOco.map((o) => {
                  const on = ocorrencias.some((x) => x.cod === o.cod);
                  return (
                    <li key={o.cod}>
                      <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] hover:bg-surface">
                        <input type="checkbox" checked={on} onChange={() => alternarOcorrencia(o)} />
                        <span className="w-9 flex-shrink-0 font-semibold tabular text-muted">{o.cod}</span>
                        <span className="text-ink">{o.nm}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="mt-4 flex justify-end">
              <button type="button" onClick={() => setListaAberta(false)} className="rounded-lg bg-navy-900 px-4 py-2 text-[13px] font-semibold text-white">
                Concluir ({ocorrencias.length})
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Log de inclusões, alterações e exclusões: data, hora e usuário de cada ação. */
function LogModal({ bol, onFechar }: { bol?: number; onFechar: () => void }) {
  const [linhas, setLinhas] = useState<RegistroLog[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/rodadas/apontamento?log=1${bol ? `&bol=${bol}` : ""}`, { cache: "no-store" })
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => (ok ? setLinhas(j.log) : setErro(j.error ?? "Não foi possível carregar o log.")))
      .catch(() => setErro("Não foi possível carregar o log."));
  }, [bol]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy-950/50 px-3">
      <div className="flex max-h-[88vh] w-full max-w-4xl flex-col rounded-xl2 bg-card p-4 shadow-pop md:p-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-[15px] font-bold text-ink">{bol ? `Log do boletim ${bol}` : "Log de alterações dos boletins (últimos 200)"}</h3>
          <button type="button" onClick={onFechar} aria-label="Fechar" className="px-1 text-[20px] leading-none text-muted">
            ×
          </button>
        </div>
        <div className="min-h-[120px] flex-1 overflow-auto rounded-md border border-line">
          {erro ? (
            <p className="px-3 py-4 text-[12.5px] text-alert-600">{erro}</p>
          ) : linhas === null ? (
            <p className="px-3 py-4 text-[12.5px] text-muted">Carregando…</p>
          ) : linhas.length === 0 ? (
            <p className="px-3 py-4 text-[12.5px] text-muted">Nenhum registro no log.</p>
          ) : (
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-line bg-navy-900 text-left text-white">
                  <th className="whitespace-nowrap px-3 py-2 font-semibold">Data e hora</th>
                  <th className="px-3 py-2 font-semibold">Ação</th>
                  <th className="px-3 py-2 font-semibold">Usuário</th>
                  <th className="px-3 py-2 text-right font-semibold">Boletim</th>
                  <th className="px-3 py-2 font-semibold">Detalhes</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((l, i) => (
                  <tr key={l.id} className={`border-b border-line/60 align-top ${i % 2 === 1 ? "bg-surface" : "bg-card"}`}>
                    <td className="whitespace-nowrap px-3 py-1.5 text-ink">{fmtDataHora(l.em)}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 font-semibold text-ink">{l.acao}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-ink">{l.usuario}</td>
                    <td className="px-3 py-1.5 text-right tabular text-ink">{l.bol}</td>
                    <td className="min-w-[260px] px-3 py-1.5 text-muted">{l.resumo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="mt-3 flex justify-end">
          <button type="button" onClick={onFechar} className="rounded-lg bg-navy-900 px-4 py-2 text-[13px] font-semibold text-white">
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}

/** "Ver e escolher": lista com filtro (código ou descrição); ↑ ↓ e Enter escolhem, Esc fecha. */
function Seletor({
  titulo,
  buscar,
  onEscolher,
  onFechar,
}: {
  titulo: string;
  buscar: (q: string) => Promise<ItemLista[]>;
  onEscolher: (item: ItemLista) => void;
  onFechar: () => void;
}) {
  const [q, setQ] = useState("");
  const [itens, setItens] = useState<ItemLista[] | null>(null);
  const [ativo, setAtivo] = useState(0);
  const buscarRef = useRef(buscar);
  buscarRef.current = buscar;

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
      q ? 250 : 0
    );
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [q]);

  function aoTeclar(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      onFechar();
    } else if (e.key === "ArrowDown") {
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

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-navy-950/50 sm:items-center sm:px-4" onKeyDown={aoTeclar}>
      <div className="flex max-h-[85vh] w-full max-w-md flex-col rounded-t-xl2 bg-card p-4 shadow-pop sm:rounded-xl2 sm:p-5">
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
    </div>
  );
}
