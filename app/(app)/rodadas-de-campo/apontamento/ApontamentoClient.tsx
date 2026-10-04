"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { fmtDateBR, fmtHa, todayISO } from "@/lib/format";
import { podeEditar } from "@/lib/permissoes";
import { semanaDaData, type RodadaCad } from "@/lib/rodadas";
import type { PerfilUsuario } from "@/lib/types";

const INPUT =
  "w-full rounded-md border border-line bg-card px-2.5 py-1.5 text-[13px] text-ink focus:border-brand-600 focus:outline-none disabled:bg-surface";
const SOMENTE_LEITURA = "w-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-[13px] text-ink";
const ROTULO = "mb-1 block text-[11.5px] font-semibold text-muted";
const LIMITE_REC = 150;

type Cad = "regiao" | "fazendas" | "ocorrencias" | "presenca-infestacao" | "nivel-infestacao" | "prioridade";

/** Resultado de uma consulta de código: nm = descrição; null = não cadastrado; vazio = o cadastro ainda não tem itens. */
type Consulta = { nm: string | null; vazio: boolean };
interface Talhao {
  tlh: string;
  area: number | null;
}
interface OcorrenciaSel {
  cod: string;
  nm: string;
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
  const [dt, setDt] = useState(todayISO());
  const [rod, setRod] = useState("");
  const [reg, setReg] = useState("");
  const [faz, setFaz] = useState("");
  const [pre, setPre] = useState("");
  const [niv, setNiv] = useState("");
  const [pri, setPri] = useState("");
  const [ocorrencias, setOcorrencias] = useState<OcorrenciaSel[]>([]);
  const [ocoDigitada, setOcoDigitada] = useState("");
  const [ocoErro, setOcoErro] = useState<string | null>(null);
  const [listaAberta, setListaAberta] = useState(false);
  const [listaOco, setListaOco] = useState<OcorrenciaSel[] | null>(null);
  const [rec, setRec] = useState("");
  const [talhoes, setTalhoes] = useState<Talhao[]>([]);
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [talhoesDe, setTalhoesDe] = useState("");
  const [rodadas, setRodadas] = useState<RodadaCad[]>([]);
  const [consultas, setConsultas] = useState<Record<string, Consulta>>({});
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

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
      setListaOco(res.ok ? (j.itens as { cod: string; nm: string }[]) : []);
    } catch {
      setListaOco([]);
    }
  }

  function alternarOcorrencia(o: OcorrenciaSel) {
    setOcorrencias((l) => (l.some((x) => x.cod === o.cod) ? l.filter((x) => x.cod !== o.cod) : [...l, o]));
  }

  const rodadaSel = useMemo(() => rodadas.find((r) => String(r.rod) === rod.trim()), [rodadas, rod]);
  const semana = useMemo(() => (rodadaSel ? semanaDaData(rodadaSel.semanas, dt) : null), [rodadaSel, dt]);
  const semanaInfo = rodadaSel && semana ? rodadaSel.semanas.find((s) => s.sem === semana) : undefined;

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
      setReg("");
      setDt(todayISO());
    }
    setErro(null);
  }

  async function gravar() {
    if (salvando) return;
    setErro(null);
    setAviso(null);
    if (!rod.trim()) return setErro("Informe a rodada.");
    if (!rodadaSel) return setErro(`A rodada ${rod} não está cadastrada.`);
    if (semana === null) return setErro("A data está fora das semanas da rodada.");
    if (ocorrencias.length === 0) return setErro("Informe pelo menos uma ocorrência.");
    if (marcados.size === 0) return setErro("Marque pelo menos um talhão.");
    setSalvando(true);
    try {
      const res = await fetch("/api/rodadas/apontamento", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rod: Number(rod),
          dt,
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
      setAviso(`Boletim ${j.bol} gravado (semana ${j.sem}).`);
      limpar(true);
      await carregarBoletim();
      setTimeout(() => focar(3), 50); // volta para a Fazenda
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

  function codigoComDescricao(cad: Cad, valor: string, onChange: (v: string) => void, campo: string, pilula = false) {
    const c = descricao(cad, valor);
    return (
      <div className="flex items-center gap-2">
        <input
          value={valor}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => consultar(cad, valor)}
          onFocus={(e) => e.target.select()}
          data-nav
          data-cad={cad}
          data-campo={campo}
          disabled={!podeGravar}
          className={`${INPUT} w-[72px] flex-shrink-0 text-center`}
          aria-label={campo}
        />
        <span className="min-w-0 truncate text-[12.5px]">
          {valor.trim() && c ? (
            c.nm ? (
              pilula ? (
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
      </div>
    );
  }

  const regiaoNm = nomeDe("regiao", reg);
  const fazendaNm = nomeDe("fazendas", faz);

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <header className="flex flex-shrink-0 items-center gap-3 border-b border-line bg-card px-6 py-3">
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

      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div ref={formRef} onKeyDown={aoTeclar} className="space-y-4">
          <section className="rounded-xl2 border border-line bg-card p-4 shadow-card">
            <h2 className="mb-3 text-[14px] font-bold text-ink">Boletim de rodada de campo</h2>

            {/* Boletim · Data · Rodada · Semana */}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-[130px_170px_130px_1fr]">
              <div>
                <label className={ROTULO}>Boletim</label>
                <input value={boletim ?? ""} readOnly tabIndex={-1} className={`${SOMENTE_LEITURA} text-center font-bold`} aria-label="Boletim (automático)" />
              </div>
              <div>
                <label className={ROTULO}>Data</label>
                <input type="date" value={dt} onChange={(e) => setDt(e.target.value)} data-nav disabled={!podeGravar} className={INPUT} />
              </div>
              <div>
                <label className={ROTULO}>Rodada</label>
                <input
                  value={rod}
                  onChange={(e) => setRod(e.target.value)}
                  onFocus={(e) => e.target.select()}
                  data-nav
                  inputMode="numeric"
                  disabled={!podeGravar}
                  className={`${INPUT} text-center`}
                />
              </div>
              <div>
                <label className={ROTULO}>Semana</label>
                <div className="flex items-center gap-2">
                  <input value={semana ?? ""} readOnly tabIndex={-1} className={`${SOMENTE_LEITURA} w-[72px] text-center font-bold`} aria-label="Semana" />
                  <span className="min-w-0 truncate text-[12px]">
                    {rod.trim() === "" ? (
                      <span className="text-muted">Informe a rodada.</span>
                    ) : !rodadaSel ? (
                      <span className="font-semibold text-alert-600">Rodada {rod} não cadastrada.</span>
                    ) : semana === null ? (
                      <span className="font-semibold text-alert-600">Data fora do calendário da rodada.</span>
                    ) : (
                      semanaInfo && <span className="text-ink">{`${fmtDateBR(semanaInfo.ini)} a ${fmtDateBR(semanaInfo.fim)}`}</span>
                    )}
                  </span>
                </div>
              </div>
            </div>

            {/* Região · Desc. Região · Fazenda · Descrição Fazenda */}
            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-[100px_1fr_100px_1.4fr]">
              <div>
                <label className={ROTULO}>Região</label>
                <input
                  value={reg}
                  onChange={(e) => setReg(e.target.value)}
                  onBlur={() => consultar("regiao", reg)}
                  onFocus={(e) => e.target.select()}
                  data-nav
                  data-cad="regiao"
                  data-campo="reg"
                  disabled={!podeGravar}
                  className={`${INPUT} text-center`}
                />
              </div>
              <div>
                <label className={ROTULO}>Desc. Região</label>
                <input
                  value={regiaoNm || (reg.trim() && descricao("regiao", reg)?.vazio ? "(cadastro vazio)" : "")}
                  readOnly
                  tabIndex={-1}
                  className={SOMENTE_LEITURA}
                  aria-label="Descrição da região"
                />
              </div>
              <div>
                <label className={ROTULO}>Fazenda</label>
                <input
                  value={faz}
                  onChange={(e) => setFaz(e.target.value)}
                  onBlur={() => consultar("fazendas", faz)}
                  onFocus={(e) => e.target.select()}
                  data-nav
                  data-cad="fazendas"
                  data-campo="faz"
                  disabled={!podeGravar}
                  className={`${INPUT} text-center`}
                />
              </div>
              <div>
                <label className={ROTULO}>Descrição Fazenda</label>
                <input
                  value={fazendaNm || (faz.trim() && descricao("fazendas", faz)?.vazio ? "(cadastro vazio)" : "")}
                  readOnly
                  tabIndex={-1}
                  className={SOMENTE_LEITURA}
                  aria-label="Descrição da fazenda"
                />
              </div>
            </div>
            {faz.trim() && descricao("fazendas", faz) && !descricao("fazendas", faz)?.nm && !descricao("fazendas", faz)?.vazio && (
              <p className="mt-1 text-[12px] font-semibold text-alert-600">Fazenda {faz} não cadastrada.</p>
            )}
            {reg.trim() && descricao("regiao", reg) && !descricao("regiao", reg)?.nm && !descricao("regiao", reg)?.vazio && (
              <p className="mt-1 text-[12px] font-semibold text-alert-600">Região {reg} não cadastrada.</p>
            )}

            {/* Presença · Nível · Prioridade */}
            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
              <div>
                <label className={ROTULO}>Presença</label>
                {codigoComDescricao("presenca-infestacao", pre, setPre, "pre")}
              </div>
              <div>
                <label className={ROTULO}>Nível de Infestação</label>
                {codigoComDescricao("nivel-infestacao", niv, setNiv, "niv", true)}
              </div>
              <div>
                <label className={ROTULO}>Prioridade</label>
                {codigoComDescricao("prioridade", pri, setPri, "pri", true)}
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
                  className="min-w-[150px] flex-1 border-0 bg-transparent px-1 py-1 text-[13px] text-ink focus:outline-none"
                  aria-label="Ocorrência"
                />
                {podeGravar && (
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={abrirLista}
                    className="rounded-md border border-line bg-surface px-2.5 py-1 text-[12px] font-semibold text-navy-800 hover:bg-card"
                  >
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

          <section className="rounded-xl2 border border-line bg-card p-4 shadow-card">
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
                {salvando ? "Gravando…" : "Gravar (F2)"}
              </button>
              <button
                type="button"
                onClick={() => limpar(false)}
                disabled={!podeGravar}
                className="rounded-lg border border-line bg-card px-3.5 py-2 text-[13px] font-semibold text-navy-800 shadow-card hover:bg-surface disabled:opacity-50"
              >
                Limpar tudo
              </button>
            </div>
            <p className="mt-3 text-[11.5px] leading-relaxed text-muted">
              Enter ou Tab passa para o próximo campo. Digite só o código — a descrição vem do cadastro. Na ocorrência, digite
              o código e Enter para incluir cada uma (Backspace remove a última). Marque os talhões com a barra de espaço.
              Para gravar: F2, o botão Gravar ou Enter no último campo. O número do boletim é sempre o último + 1.
            </p>
          </section>
        </div>
      </div>

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
