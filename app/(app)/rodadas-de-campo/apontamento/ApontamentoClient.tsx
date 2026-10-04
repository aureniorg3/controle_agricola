"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { fmtDateBR, todayISO } from "@/lib/format";
import { podeEditar } from "@/lib/permissoes";
import { semanaDaData, type RodadaCad } from "@/lib/rodadas";
import type { PerfilUsuario } from "@/lib/types";

const INPUT =
  "w-full rounded-md border border-line bg-card px-2.5 py-1.5 text-[13px] text-ink focus:border-brand-600 focus:outline-none";
const ROTULO = "mb-1 block text-[11.5px] font-semibold text-muted";

type Cad = "regiao" | "fazendas" | "ocorrencias" | "presenca-infestacao" | "nivel-infestacao" | "prioridade";

interface Linha {
  oco: string;
  pre: string;
  niv: string;
  pri: string;
  tlh: string;
  rec: string;
  ati: string;
  exe: string;
}

const LINHA_VAZIA: Linha = { oco: "", pre: "", niv: "", pri: "", tlh: "", rec: "", ati: "", exe: "" };

/** Cor sugerida pela descrição do nível/prioridade (verde = baixo, âmbar = médio, vermelho = alto). */
function corPorDescricao(nm: string): string {
  const t = nm.toLowerCase();
  if (/alt|grave|urgent|cr[ií]tic|\b3\b/.test(t)) return "bg-alert-50 text-alert-700 border-alert-500/40";
  if (/m[eé]d|\b2\b/.test(t)) return "bg-amber-50 text-amber-700 border-amber-500/40";
  if (/baix|leve|\b1\b/.test(t)) return "bg-good-50 text-good-700 border-good-500/40";
  return "bg-surface text-ink border-line";
}

/** Resultado de uma consulta de código: nm = descrição; null = não cadastrado; vazio = o cadastro ainda não tem itens. */
type Consulta = { nm: string | null; vazio: boolean };

export default function ApontamentoClient({ perfil }: { perfil: PerfilUsuario }) {
  const podeGravar = podeEditar(perfil);
  const formRef = useRef<HTMLDivElement>(null);

  const [boletim, setBoletim] = useState<number | null>(null);
  const [rod, setRod] = useState("");
  const [dt, setDt] = useState(todayISO());
  const [reg, setReg] = useState("");
  const [resp, setResp] = useState("");
  const [faz, setFaz] = useState("");
  const [linhas, setLinhas] = useState<Linha[]>([{ ...LINHA_VAZIA }]);
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
    return Array.from(formRef.current?.querySelectorAll<HTMLInputElement>("[data-nav]") ?? []);
  }
  function focar(i: number) {
    const el = navegaveis()[i];
    if (el) {
      el.focus();
      el.select?.();
    }
  }

  // consulta um código no cadastro (e guarda, para mostrar a descrição ao lado)
  async function consultar(cad: Cad, cod: string) {
    const valor = cod.trim();
    if (!valor) return;
    if (cad === "regiao") preencherResponsavel(valor);
    const chave = `${cad}|${valor}`;
    try {
      const res = await fetch(`/api/rodadas/apontamento?cad=${cad}&cod=${encodeURIComponent(valor)}`, { cache: "no-store" });
      const j = await res.json();
      if (res.ok) setConsultas((c) => ({ ...c, [chave]: { nm: j.item?.nm ?? null, vazio: !j.cadastroComItens } }));
    } catch {
      /* a gravação confere de novo no servidor */
    }
  }

  // ao informar a região, traz o responsável cadastrado (continua editável)
  async function preencherResponsavel(regiao: string) {
    try {
      const res = await fetch(`/api/rodadas/apontamento?resp_regiao=${encodeURIComponent(regiao)}`, { cache: "no-store" });
      const j = await res.json();
      if (res.ok && j.responsavel?.nm) setResp(j.responsavel.nm);
    } catch {
      /* o servidor completa o responsável ao gravar */
    }
  }

  const rodadaSel = useMemo(() => rodadas.find((r) => String(r.rod) === rod.trim()), [rodadas, rod]);
  const semana = useMemo(() => (rodadaSel ? semanaDaData(rodadaSel.semanas, dt) : null), [rodadaSel, dt]);
  const semanaInfo = rodadaSel && semana ? rodadaSel.semanas.find((s) => s.sem === semana) : undefined;

  function atualizarLinha(i: number, campo: keyof Linha, valor: string) {
    setLinhas((ls) => ls.map((l, idx) => (idx === i ? { ...l, [campo]: valor } : l)));
  }

  function limpar(manterCabecalho: boolean) {
    setLinhas([{ ...LINHA_VAZIA }]);
    setFaz("");
    if (!manterCabecalho) {
      setRod("");
      setReg("");
      setResp("");
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
    setSalvando(true);
    try {
      const res = await fetch("/api/rodadas/apontamento", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rod: Number(rod), dt, reg, resp, faz, itens: linhas }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "Não foi possível gravar o boletim.");
      setAviso(`Boletim ${j.bol} gravado (semana ${j.sem}).`);
      limpar(true);
      await carregarBoletim();
      setTimeout(() => focar(4), 50); // volta para a Fazenda
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
    if (e.key !== "Enter" || !alvo.dataset?.nav) return;
    e.preventDefault();

    // consulta o código que acabou de ser digitado
    if (alvo.dataset.cad) consultar(alvo.dataset.cad as Cad, alvo.value);

    const linha = alvo.dataset.linha !== undefined ? Number(alvo.dataset.linha) : -1;
    // Enter numa Ocorrência vazia de uma linha nova: encerra o lançamento e grava
    if (alvo.dataset.campo === "oco" && alvo.value.trim() === "" && linha > 0) {
      gravar();
      return;
    }
    const navs = navegaveis();
    const i = navs.indexOf(alvo);
    if (i < navs.length - 1) {
      focar(i + 1);
      return;
    }
    // último campo da última linha: abre uma nova linha se esta tiver ocorrência; senão grava
    if (linhas[linhas.length - 1].oco.trim()) {
      setLinhas((ls) => [...ls, { ...LINHA_VAZIA }]);
      setTimeout(() => focar(navs.length), 30);
    } else {
      gravar();
    }
  }

  const desc = (cad: Cad, cod: string) => {
    const valor = cod.trim();
    if (!valor) return null;
    const c = consultas[`${cad}|${valor}`];
    if (!c) return null;
    if (c.nm) {
      return cad === "nivel-infestacao" || cad === "prioridade" ? (
        <span className={`rounded-full border px-2 py-0.5 text-[11.5px] font-semibold ${corPorDescricao(c.nm)}`}>{c.nm}</span>
      ) : (
        <span className="text-ink">{c.nm}</span>
      );
    }
    return c.vazio ? (
      <span className="text-muted">cadastro vazio</span>
    ) : (
      <span className="font-semibold text-alert-600">não cadastrado</span>
    );
  };

  // função de render (não componente): não remonta a cada tecla, então o foco do campo se mantém
  function campoCod({ cad, valor, onChange, linha, campo }: { cad: Cad; valor: string; onChange: (v: string) => void; linha: number; campo: string }) {
    return (
      <div className="flex items-center gap-2">
        <input
          value={valor}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => consultar(cad, valor)}
          onFocus={(e) => e.target.select()}
          data-nav
          data-cad={cad}
          data-linha={linha}
          data-campo={campo}
          disabled={!podeGravar}
          className={`${INPUT} w-[72px] flex-shrink-0 text-center`}
          aria-label={campo}
        />
        <span className="min-w-0 truncate text-[12px]">{desc(cad, valor)}</span>
      </div>
    );
  }

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
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <h2 className="text-[14px] font-bold text-ink">Identificação</h2>
            <span className="rounded-full bg-brand-50 px-3 py-0.5 text-[12px] font-bold text-brand-800">
              Boletim {boletim ?? "…"} (automático)
            </span>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-[110px_160px_1fr_1fr_1.4fr]">
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
              <label className={ROTULO}>Data</label>
              <input type="date" value={dt} onChange={(e) => setDt(e.target.value)} data-nav disabled={!podeGravar} className={INPUT} />
            </div>
            <div>
              <label className={ROTULO}>Região</label>
              {campoCod({ cad: "regiao", valor: reg, onChange: setReg, linha: -1, campo: "reg", })}
            </div>
            <div>
              <label className={ROTULO}>Responsável</label>
              <input
                value={resp}
                onChange={(e) => setResp(e.target.value)}
                onFocus={(e) => e.target.select()}
                data-nav
                disabled={!podeGravar}
                className={INPUT}
              />
            </div>
            <div>
              <label className={ROTULO}>Fazenda</label>
              {campoCod({ cad: "fazendas", valor: faz, onChange: setFaz, linha: -1, campo: "faz", })}
            </div>
          </div>

          <p className="mt-2 text-[12px]">
            {rod.trim() === "" ? (
              <span className="text-muted">Informe a rodada para ver a semana.</span>
            ) : !rodadaSel ? (
              <span className="font-semibold text-alert-600">Rodada {rod} não cadastrada (Cadastro de Rodadas).</span>
            ) : semana === null ? (
              <span className="font-semibold text-alert-600">
                A data está fora do calendário da rodada ({fmtDateBR(rodadaSel.ini)} a{" "}
                {fmtDateBR(rodadaSel.semanas[rodadaSel.semanas.length - 1]?.fim ?? rodadaSel.ini)}).
              </span>
            ) : (
              <span className="text-ink">
                <b>Semana {semana}</b>
                {semanaInfo && ` · ${fmtDateBR(semanaInfo.ini)} a ${fmtDateBR(semanaInfo.fim)}`}
              </span>
            )}
          </p>
        </section>

        <section className="rounded-xl2 border border-line bg-card p-4 shadow-card">
          <h2 className="text-[14px] font-bold text-ink">Ocorrências observadas</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[1300px] text-[12.5px]">
              <thead>
                <tr className="border-b border-line bg-navy-900 text-left text-white">
                  <th className="w-8 px-2 py-2 text-right font-semibold">#</th>
                  <th className="px-2 py-2 font-semibold">Ocorrência</th>
                  <th className="px-2 py-2 font-semibold">Presença</th>
                  <th className="px-2 py-2 font-semibold">Nível</th>
                  <th className="px-2 py-2 font-semibold">Prioridade</th>
                  <th className="w-36 px-2 py-2 font-semibold">Talhão(es)</th>
                  <th className="px-2 py-2 font-semibold">Recomendação / Diagnóstico</th>
                  <th className="px-2 py-2 font-semibold">Atividade corretiva</th>
                  <th className="w-28 px-2 py-2 font-semibold">Executado</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((l, i) => (
                  <tr key={i} className="border-b border-line/60 align-top">
                    <td className="px-2 py-1.5 text-right tabular text-muted">{i + 1}</td>
                    <td className="min-w-[200px] px-2 py-1.5">
                      {campoCod({ cad: "ocorrencias", valor: l.oco, onChange: (v) => atualizarLinha(i, "oco", v), linha: i, campo: "oco", })}
                    </td>
                    <td className="min-w-[150px] px-2 py-1.5">
                      {campoCod({ cad: "presenca-infestacao", valor: l.pre, onChange: (v) => atualizarLinha(i, "pre", v), linha: i, campo: "pre", })}
                    </td>
                    <td className="min-w-[150px] px-2 py-1.5">
                      {campoCod({ cad: "nivel-infestacao", valor: l.niv, onChange: (v) => atualizarLinha(i, "niv", v), linha: i, campo: "niv", })}
                    </td>
                    <td className="min-w-[150px] px-2 py-1.5">
                      {campoCod({ cad: "prioridade", valor: l.pri, onChange: (v) => atualizarLinha(i, "pri", v), linha: i, campo: "pri", })}
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        value={l.tlh}
                        onChange={(e) => atualizarLinha(i, "tlh", e.target.value)}
                        onFocus={(e) => e.target.select()}
                        data-nav
                        data-linha={i}
                        data-campo="tlh"
                        disabled={!podeGravar}
                        placeholder="Ex.: 1, 2, 5"
                        className={INPUT}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        value={l.rec}
                        onChange={(e) => atualizarLinha(i, "rec", e.target.value)}
                        onFocus={(e) => e.target.select()}
                        data-nav
                        data-linha={i}
                        data-campo="rec"
                        disabled={!podeGravar}
                        className={INPUT}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        value={l.ati}
                        onChange={(e) => atualizarLinha(i, "ati", e.target.value)}
                        onFocus={(e) => e.target.select()}
                        data-nav
                        data-linha={i}
                        data-campo="ati"
                        disabled={!podeGravar}
                        placeholder="Ex.: Folha larga - drone"
                        className={INPUT}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="flex items-center gap-2">
                        <input
                          value={l.exe}
                          onChange={(e) => atualizarLinha(i, "exe", e.target.value)}
                          onBlur={() => {
                            const t = l.exe.trim().toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                            if (["S", "SIM", "1"].includes(t)) atualizarLinha(i, "exe", "SIM");
                            else if (["N", "NAO", "2"].includes(t)) atualizarLinha(i, "exe", "NÃO");
                          }}
                          onFocus={(e) => e.target.select()}
                          data-nav
                          data-linha={i}
                          data-campo="exe"
                          disabled={!podeGravar}
                          placeholder="S / N"
                          maxLength={3}
                          className={`${INPUT} w-[64px] text-center`}
                          aria-label="Executado"
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

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
              onClick={() => setLinhas((ls) => [...ls, { ...LINHA_VAZIA }])}
              disabled={!podeGravar}
              className="rounded-lg border border-line bg-card px-3.5 py-2 text-[13px] font-semibold text-navy-800 shadow-card hover:bg-surface disabled:opacity-50"
            >
              + Linha
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
            Enter ou Tab passa para o próximo campo. Digite só o código — a descrição vem do cadastro (Executado: S ou N). Para gravar: F2, o
            botão Gravar, ou Enter numa Ocorrência vazia de uma linha nova. Enter no último campo abre uma nova linha. O
            número do boletim é sempre o último + 1.
          </p>
        </section>
        </div>
      </div>
    </div>
  );
}
