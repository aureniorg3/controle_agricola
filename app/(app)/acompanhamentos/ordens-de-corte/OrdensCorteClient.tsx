"use client";

import { Fragment, FormEvent, useEffect, useMemo, useState, type ReactNode } from "react";
import { HistoricoTchOrdem, MetaFrente, OrdemCorte, PerfilUsuario, Periodo, StatusOrdem, TalhaoOrdem } from "@/lib/types";
import {
  addDays,
  calcAcumSafraT,
  calcAreaColhidaHa,
  calcAreaTotalHa,
  calcOrdemMetrics,
  calcTalhaoDiaAnterior,
  calcTalhaoDiaAtualAte6h,
  calcTalhaoEntradaPeriodo,
  endOfMonth,
  endOfWeekMonday,
  LinhaResumoDetalhado,
  mesAnteriorRange,
  quinzenaRange,
  resumoDetalhadoPorOrdemFazenda,
  resumoDiarioMes,
  mediaDiariaPorPeriodo,
  resumoPorFrente,
  type ResumoMensal,
  startOfMonth,
  startOfWeekMonday,
} from "@/lib/period";
import { fmtDateBR, fmtHa, fmtT, fmtTch, rotuloMesAbrev, todayISO } from "@/lib/format";
import { gerarRelatorioCompletoPdf } from "@/lib/relatorio-pdf";
import { Campo, ModalShell } from "@/components/ui";
import { aplicarAreaColhidaDia, aplicarCorteERateio, HORAS_CORTE, rotuloHoraCorte, type HoraCorte } from "@/lib/rateio";
import AreaColhidaTab from "./AreaColhidaTab";
import {
  IconCaminhaoCana,
  IconColhedora,
  IconFechar,
  IconImportar,
  IconImprimir,
  IconMeta,
  IconOrdemCorte,
  IconOrdemEncerrada,
  IconRelogio,
  IconSetaDireita,
  IconTalhao,
  IconTch,
} from "@/components/icons";
import { ehAdmin, podeEditar } from "@/lib/permissoes";
import { ehBooleano, ehDataIso, ehTexto, ehUmDe, usarPersistido } from "@/lib/usar-persistido";

const PERIODOS: { key: Periodo; label: string }[] = [
  { key: "dia", label: "Dia" },
  { key: "semana", label: "Semana" },
  { key: "mes", label: "Mês" },
  { key: "safra", label: "Safra" },
];

function ultimaDataComMovimento(ordens: OrdemCorte[]): string {
  let max = "";
  for (const o of ordens) for (const e of o.entradas) if (e.data > max) max = e.data;
  return max || todayISO();
}

/** Acima desta diferença (em %) entre o TCH realizado (ton entregue ÷ área
 * medida) e o estimado, Gravação e Administrador recebem um aviso. */
const LIMITE_DIVERGENCIA_TCH_PCT = 20;

/** Meta do período + % atingido, embaixo do valor realizado. */
function MetaLinha({ real, meta }: { real: number; meta: number }) {
  if (!(meta > 0)) return null;
  const pct = (real / meta) * 100;
  const cor = pct >= 100 ? "text-good-600" : pct >= 80 ? "text-amber-600" : "text-alert-600";
  return (
    <div className="mt-0.5 text-[10.5px] font-medium leading-tight text-muted">
      Meta {fmtT(meta)} · <span className={`font-bold ${cor}`}>{pct.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%</span>
    </div>
  );
}

/** Escolhe quais frentes aparecem e em que ordem (setas), em toda a tela e no PDF. */
function FrentesSeletor({
  frentes,
  visiveis,
  onAlternar,
  onMover,
  onTodas,
  onRestaurar,
}: {
  frentes: string[];
  visiveis: Set<string>;
  onAlternar: (f: string) => void;
  onMover: (f: string, delta: -1 | 1) => void;
  onTodas: () => void;
  onRestaurar: () => void;
}) {
  const [aberto, setAberto] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setAberto((a) => !a)}
        aria-expanded={aberto}
        className="rounded-lg border border-line bg-card px-3 py-1.5 text-[13px] font-medium text-ink shadow-card hover:bg-surface"
      >
        Frentes · {visiveis.size}/{frentes.length}
      </button>
      {aberto && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setAberto(false)} aria-hidden="true" />
          <div className="absolute left-0 top-full z-40 mt-1.5 w-[300px] rounded-xl2 border border-line bg-card p-2 shadow-pop">
            <p className="px-1.5 pb-1.5 text-[11.5px] text-muted">
              Marque as frentes que aparecem e use as setas para mudar a ordem.
            </p>
            <ul className="max-h-[320px] overflow-y-auto">
              {frentes.map((f, i) => (
                <li key={f} className="flex items-center gap-1.5 rounded-md px-1.5 py-1 hover:bg-surface">
                  <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-[12.5px] text-ink">
                    <input type="checkbox" checked={visiveis.has(f)} onChange={() => onAlternar(f)} />
                    <span className="truncate">{f}</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => onMover(f, -1)}
                    disabled={i === 0}
                    aria-label={`Subir ${f}`}
                    className="rounded px-1.5 text-[13px] text-muted hover:bg-line disabled:opacity-30"
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    onClick={() => onMover(f, 1)}
                    disabled={i === frentes.length - 1}
                    aria-label={`Descer ${f}`}
                    className="rounded px-1.5 text-[13px] text-muted hover:bg-line disabled:opacity-30"
                  >
                    ▼
                  </button>
                </li>
              ))}
            </ul>
            <div className="mt-1.5 flex justify-between border-t border-line px-1.5 pt-2 text-[12px] font-semibold text-brand-700">
              <button type="button" onClick={onTodas}>
                Mostrar todas
              </button>
              <button type="button" onClick={onRestaurar}>
                Restaurar ordem
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** Rodapé do card: TCH realizado das duas safras anteriores e TCH estimado da
 * safra atual (do histórico importado, cruzando fazenda + talhão da ordem),
 * comparados com o TCH geral realizado agora. */
function TchComparativo({
  areaOrdemHa,
  tchGeralAtual,
  safraAtual,
  safrasAnteriores,
  historico,
  divergenciaPct,
}: {
  areaOrdemHa: number;
  tchGeralAtual: number;
  safraAtual: number;
  safrasAnteriores: number[];
  historico?: HistoricoTchOrdem["porOrdem"][string];
  divergenciaPct?: number;
}) {
  if (safrasAnteriores.length === 0 && !historico) return null;
  const real = (safra: number) => historico?.find((h) => h.safra === safra)?.tchReal ?? null;
  const est = historico?.find((h) => h.safra === safraAtual)?.tchEst ?? null;
  const anterior = safrasAnteriores.length > 0 ? real(safrasAnteriores[0]) : null;
  const variacao = anterior && anterior > 0 && tchGeralAtual > 0 ? ((tchGeralAtual - anterior) / anterior) * 100 : null;

  const amarelo = { backgroundColor: "rgb(255, 255, 232)" };
  const linha = "flex items-center justify-between px-3 py-1";
  return (
    <div className="mt-auto pt-3">
      <div className="overflow-hidden rounded-lg border border-line text-[11.5px]">
        <div className={`${linha} bg-good-50`}>
          <span className="text-ink">Área Liberada (Ordem)</span>
          <span className="tabular text-ink">{fmtHa(areaOrdemHa)}</span>
        </div>
        {[...safrasAnteriores].reverse().map((safra) => (
          <div key={safra} className={linha} style={amarelo}>
            <span className="text-ink">TCH Realizado Safra {safra}</span>
            <span className="tabular text-ink">{real(safra) !== null ? fmtTch(real(safra)!) : ""}</span>
          </div>
        ))}
        <div className={linha} style={amarelo}>
          <span className="text-ink">TCH Estimado {safraAtual}</span>
          <span className="tabular text-ink">{est !== null ? fmtTch(est) : ""}</span>
        </div>
        {divergenciaPct !== undefined && (
          <div className={`${linha} bg-amber-50 text-amber-700`}>
            <span>⚠ TCH real (ton ÷ área medida) vs. estimado</span>
            <span className="tabular">
              {divergenciaPct >= 0 ? "▲" : "▼"} {Math.abs(divergenciaPct).toFixed(0)}%
            </span>
          </div>
        )}
        <div className={`${linha} bg-amber-50`}>
          <span className="text-ink">TCH Médio Realizado</span>
          <span className="flex items-center gap-2">
            {variacao !== null && (
              <span className={`text-[10.5px] ${variacao >= 0 ? "text-good-600" : "text-alert-600"}`}>
                {variacao >= 0 ? "▲" : "▼"} {Math.abs(variacao).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%
              </span>
            )}
            <span className="tabular text-ink">{fmtTch(tchGeralAtual)}</span>
          </span>
        </div>
      </div>
    </div>
  );
}

function periodoTexto(period: Periodo, referencia: string, safraLabel: string): string {
  if (period === "dia") return `Dia ${fmtDateBR(referencia)}`;
  if (period === "semana")
    return `Semana de ${fmtDateBR(startOfWeekMonday(referencia))} a ${fmtDateBR(endOfWeekMonday(referencia))}`;
  if (period === "mes")
    return `Mês de ${rotuloMesAbrev(referencia)} (${fmtDateBR(startOfMonth(referencia))} a ${fmtDateBR(
      endOfMonth(referencia)
    )})`;
  return `Safra ${safraLabel} · acumulado`;
}

export default function OrdensCorteClient({
  initialOrdens,
  initialOrdensVisiveis,
  metas,
  historicoTch,
  producao,
  perfil,
  nomeUsuario,
}: {
  initialOrdens: OrdemCorte[];
  initialOrdensVisiveis: string[];
  metas: MetaFrente[];
  historicoTch: HistoricoTchOrdem;
  /** período de produção da safra vigente (Cadastros > Safras); limita as entradas de cana */
  producao: { inicio: string; fim: string; rotulo: string } | null;
  perfil: PerfilUsuario;
  nomeUsuario: string;
}) {
  const podeGravar = podeEditar(perfil);
  const [ordensBrutas, setOrdens] = useState<OrdemCorte[]>(initialOrdens);
  const [referencia, setReferencia] = usarPersistido<string>(
    "ordens.referencia",
    () =>
    ultimaDataComMovimento(
      producao
        ? initialOrdens.map((o) => ({
            ...o,
            entradas: o.entradas.filter((e) => e.data >= producao.inicio && e.data <= producao.fim),
          }))
        : initialOrdens
    )
    ,
    ehDataIso
  );
  // horário de corte do "dia atual": 06:00, 12:00, 18:00 ou 00:00 (dia completo)
  const [horaCorte, setHoraCorte] = usarPersistido<HoraCorte>("ordens.horaCorte", 6, ehUmDe([6, 12, 18, 24] as const));
  const rotuloHora = rotuloHoraCorte(horaCorte);
  const cortesIntermediarios = useMemo(
    () => ordensBrutas.some((o) => o.entradas.some((e) => e.toneladasAte12h > 0 || e.toneladasAte18h > 0)),
    [ordensBrutas]
  );
  // só contam as pesagens dentro do período de produção da safra vigente; no
  // dia da referência vale o horário de corte e as entradas ainda sem talhão
  // são rateadas pelo TCH estimado x área dos talhões
  const ordens = useMemo(
    () =>
      (producao
        ? ordensBrutas.map((o) => ({
            ...o,
            entradas: o.entradas.filter((e) => e.data >= producao.inicio && e.data <= producao.fim),
          }))
        : ordensBrutas
      )
        .map((o) => aplicarAreaColhidaDia(o, referencia))
        .map((o) => aplicarCorteERateio(o, referencia, horaCorte, historicoTch.estPorTalhao?.[o.numero])),
    [ordensBrutas, producao, referencia, horaCorte, historicoTch]
  );
  const [ordensVisiveis, setOrdensVisiveis] = useState<Set<string>>(() => new Set(initialOrdensVisiveis));
  const [inserirNumero, setInserirNumero] = useState("");
  const [inserirErro, setInserirErro] = useState<string | null>(null);
  const [inserindo, setInserindo] = useState(false);
  const [period, setPeriod] = usarPersistido<Periodo>("ordens.periodo", "dia", ehUmDe(["dia", "semana", "mes", "safra"] as const));
  // frentes mostradas e a ordem delas (salvo neste navegador)
  const [frentesCfg, setFrentesCfg] = useState<{ ordem: string[]; ocultas: string[] }>({ ordem: [], ocultas: [] });
  const [frentesCfgCarregada, setFrentesCfgCarregada] = useState(false);
  const [statusFiltro, setStatusFiltro] = usarPersistido<"todas" | StatusOrdem>("ordens.status", "todas", ehUmDe(["todas", "Aberta", "Encerrada"] as const));
  const [busca, setBusca] = usarPersistido("ordens.busca", "", ehTexto);
  const [importarAberto, setImportarAberto] = useState(false);
  const [aba, setAba] = usarPersistido<"painel" | "apontamento">("ordens.aba", "painel", ehUmDe(["painel", "apontamento"] as const));
  const [ordemApontamento, setOrdemApontamento] = useState<string | null>(null);
  const [ultimaSincronizacao, setUltimaSincronizacao] = useState<string | null>(null);
  const [colapsadas, setColapsadas] = useState<Set<string>>(new Set());
  const [gerandoPdf, setGerandoPdf] = useState(false);

  function atualizarOrdemLocal(atualizada: OrdemCorte) {
    setOrdens((prev) => prev.map((o) => (o.numero === atualizada.numero ? atualizada : o)));
  }

  useEffect(() => {
    setUltimaSincronizacao(new Date().toISOString());
    try {
      const salvo = localStorage.getItem("ca_frentes_cfg");
      if (salvo) {
        const j = JSON.parse(salvo);
        setFrentesCfg({
          ordem: Array.isArray(j.ordem) ? j.ordem.filter((x: unknown) => typeof x === "string") : [],
          ocultas: Array.isArray(j.ocultas) ? j.ocultas.filter((x: unknown) => typeof x === "string") : [],
        });
      }
    } catch {
      /* sem acesso ao armazenamento do navegador: segue com a ordem padrão */
    }
    setFrentesCfgCarregada(true);
  }, []);

  useEffect(() => {
    if (!frentesCfgCarregada) return;
    try {
      localStorage.setItem("ca_frentes_cfg", JSON.stringify(frentesCfg));
    } catch {
      /* ignora */
    }
  }, [frentesCfg, frentesCfgCarregada]);

  // `resetarData`: depois de importar, volta para o último dia com movimento; nos demais casos mantém a data escolhida
  async function refetch(resetarData = false) {
    const res = await fetch("/api/ordens-corte", { cache: "no-store" });
    const data = await res.json();
    setOrdens(data.ordens);
    setOrdensVisiveis(new Set<string>(data.ordensVisiveis ?? []));
    if (resetarData)
    setReferencia(
      ultimaDataComMovimento(
        producao
          ? (data.ordens as OrdemCorte[]).map((o) => ({
              ...o,
              entradas: o.entradas.filter((e) => e.data >= producao.inicio && e.data <= producao.fim),
            }))
          : data.ordens
      )
    );
    setUltimaSincronizacao(new Date().toISOString());
  }

  async function inserirOrdem(e: FormEvent) {
    e.preventDefault();
    const numero = inserirNumero.trim();
    if (!numero) return;
    setInserindo(true);
    setInserirErro(null);
    try {
      const res = await fetch("/api/ordens-corte/visiveis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ numero }),
      });
      const data = await res.json();
      if (!res.ok) {
        setInserirErro(data?.error ?? "Não foi possível inserir a ordem.");
        return;
      }
      setOrdensVisiveis((prev) => new Set(prev).add(numero));
      setInserirNumero("");
    } catch {
      setInserirErro("Não foi possível enviar a solicitação. Verifique a conexão.");
    } finally {
      setInserindo(false);
    }
  }

  async function removerOrdem(numero: string) {
    setOrdensVisiveis((prev) => {
      const next = new Set(prev);
      next.delete(numero);
      return next;
    });
    await fetch("/api/ordens-corte/visiveis", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ numero }),
    });
  }

  const frentesTodas = useMemo(() => Array.from(new Set(ordens.map((o) => o.frente))).sort(), [ordens]);
  const frentesOrdenadas = useMemo(() => {
    const conhecidas = frentesCfg.ordem.filter((f) => frentesTodas.includes(f));
    return [...conhecidas, ...frentesTodas.filter((f) => !conhecidas.includes(f))];
  }, [frentesCfg.ordem, frentesTodas]);
  const frentesVisiveis = useMemo(
    () => new Set(frentesOrdenadas.filter((f) => !frentesCfg.ocultas.includes(f))),
    [frentesOrdenadas, frentesCfg.ocultas]
  );
  const posicaoFrente = (f: string) => {
    const i = frentesOrdenadas.indexOf(f);
    return i === -1 ? 9999 : i;
  };
  function alternarFrente(f: string) {
    setFrentesCfg((c) => ({
      ordem: frentesOrdenadas,
      ocultas: c.ocultas.includes(f) ? c.ocultas.filter((x) => x !== f) : [...c.ocultas, f],
    }));
  }
  function moverFrente(f: string, delta: -1 | 1) {
    const lista = [...frentesOrdenadas];
    const i = lista.indexOf(f);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= lista.length) return;
    [lista[i], lista[j]] = [lista[j], lista[i]];
    setFrentesCfg((c) => ({ ...c, ordem: lista }));
  }
  function mostrarTodasFrentes() {
    setFrentesCfg((c) => ({ ...c, ocultas: [] }));
  }
  function restaurarOrdemFrentes() {
    setFrentesCfg({ ordem: [], ocultas: [] });
  }

  // Cards automáticos: toda ordem aberta; a encerrada só enquanto teve entrada de cana no dia atual ou no dia anterior
  // (relativos à data escolhida). Sem entrada nesses dois dias, o card da ordem encerrada some.
  const ordensAuto = useMemo(() => {
    const diaAnterior = addDays(referencia, -1);
    const set = new Set<string>();
    for (const o of ordens) {
      if (o.status === "Aberta") set.add(o.numero);
      else if (o.entradas.some((e) => (e.data === referencia || e.data === diaAnterior) && e.toneladas > 0)) set.add(o.numero);
    }
    return set;
  }, [ordens, referencia]);

  // + as que o usuário inseriu à mão para ver algum detalhe (Inserir Ordem)
  const ordensDisponiveis = useMemo(
    () =>
      ordens
        .filter((o) => !ordensAuto.has(o.numero) && !ordensVisiveis.has(o.numero))
        .sort((a, b) => a.numero.localeCompare(b.numero, undefined, { numeric: true })),
    [ordens, ordensAuto, ordensVisiveis]
  );

  const safraLabel = ordens[0]?.safraLabel ?? "2026/27";

  const ordensSelecionadas = useMemo(
    () => ordens.filter((o) => ordensAuto.has(o.numero) || ordensVisiveis.has(o.numero)),
    [ordens, ordensAuto, ordensVisiveis]
  );

  const filtroFrenteStatusBusca = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return (o: OrdemCorte) => {
      if (!frentesVisiveis.has(o.frente)) return false;
      if (statusFiltro !== "todas" && o.status !== statusFiltro) return false;
      if (termo) {
        const alvo = `${o.numero} ${o.fazendaCodigo} ${o.fazendaNome}`.toLowerCase();
        if (!alvo.includes(termo)) return false;
      }
      return true;
    };
  }, [frentesVisiveis, statusFiltro, busca]);

  const ordensFiltradas = useMemo(
    () => ordensSelecionadas.filter(filtroFrenteStatusBusca),
    [ordensSelecionadas, filtroFrenteStatusBusca]
  );

  // Mesmos filtros de frente/status/busca, mas sobre TODAS as ordens
  // importadas — não só as marcadas pra aparecer nos cards. O resumo por
  // frente e o resumo detalhado usam essa lista (o retrato real da frente
  // inteira); só os cards abaixo deles usam `ordensFiltradas` (a seleção).
  const ordensFiltradasTodas = useMemo(() => ordens.filter(filtroFrenteStatusBusca), [ordens, filtroFrenteStatusBusca]);

  const porFrente = useMemo(() => {
    const map = new Map<string, OrdemCorte[]>();
    for (const o of ordensFiltradas) {
      const arr = map.get(o.frente) ?? [];
      arr.push(o);
      map.set(o.frente, arr);
    }
    return Array.from(map.entries()).sort((a, b) => posicaoFrente(a[0]) - posicaoFrente(b[0]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ordensFiltradas, frentesOrdenadas]);

  // Data da primeira entrada de cana de cada frente (todas as ordens da safra,
  // independente de filtros) — a meta da frente só começa a contar nesse dia.
  const primeiraEntradaPorFrente = useMemo(() => {
    const mapa: Record<string, string> = {};
    for (const o of ordens) {
      for (const e of o.entradas) {
        if (e.toneladas > 0 && (mapa[o.frente] === undefined || e.data < mapa[o.frente])) mapa[o.frente] = e.data;
      }
    }
    return mapa;
  }, [ordens]);

  const resumoFrentes = useMemo(
    () =>
      resumoPorFrente(
        ordensFiltradas,
        ordensFiltradasTodas,
        referencia,
        metas,
        producao?.inicio,
        primeiraEntradaPorFrente,
        horaCorte
      ).sort((a, b) => posicaoFrente(a.frente) - posicaoFrente(b.frente)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ordensFiltradas, ordensFiltradasTodas, referencia, metas, producao, primeiraEntradaPorFrente, horaCorte, frentesOrdenadas]
  );

  // média de t por dia efetivo (só dias com entrada de cana), todas as frentes juntas
  const mediaDiaria = useMemo(
    () => mediaDiariaPorPeriodo(ordensFiltradasTodas, referencia, producao?.inicio),
    [ordensFiltradasTodas, referencia, producao]
  );

  const resumoTotais = useMemo(
    () =>
      resumoFrentes.reduce(
        (acc, r) => ({
          ordensSelecionadas: acc.ordensSelecionadas + r.ordensSelecionadas,
          areaSelecionadaHa: acc.areaSelecionadaHa + r.areaSelecionadaHa,
          areaAcumuladaHa: acc.areaAcumuladaHa + r.areaAcumuladaHa,
          safraT: acc.safraT + r.safraT,
          mesAnteriorT: acc.mesAnteriorT + r.mesAnteriorT,
          mesAtualT: acc.mesAtualT + r.mesAtualT,
          quinzenaT: acc.quinzenaT + r.quinzenaT,
          semanaT: acc.semanaT + r.semanaT,
          diaAnteriorT: acc.diaAnteriorT + r.diaAnteriorT,
          diaAtualT: acc.diaAtualT + r.diaAtualT,
          diasEfetivos: mediaDiaria.safra.dias,
          mediaDiaEfetivoT: mediaDiaria.safra.media,
        }),
        {
          ordensSelecionadas: 0,
          areaSelecionadaHa: 0,
          areaAcumuladaHa: 0,
          safraT: 0,
          mesAnteriorT: 0,
          mesAtualT: 0,
          quinzenaT: 0,
          semanaT: 0,
          diaAnteriorT: 0,
          diaAtualT: 0,
          diasEfetivos: 0,
          mediaDiaEfetivoT: 0,
        }
      ),
    [resumoFrentes, mediaDiaria]
  );

  const metaTotais = useMemo(
    () =>
      resumoFrentes.reduce(
        (acc, r) => ({
          safra: acc.safra + r.meta.safra,
          mesAnterior: acc.mesAnterior + r.meta.mesAnterior,
          mesAtual: acc.mesAtual + r.meta.mesAtual,
          quinzena: acc.quinzena + r.meta.quinzena,
          semana: acc.semana + r.meta.semana,
          diaAnterior: acc.diaAnterior + r.meta.diaAnterior,
          diaAtual: acc.diaAtual + r.meta.diaAtual,
        }),
        { safra: 0, mesAnterior: 0, mesAtual: 0, quinzena: 0, semana: 0, diaAnterior: 0, diaAtual: 0 }
      ),
    [resumoFrentes]
  );
  const temMetas = metaTotais.safra > 0 || metaTotais.diaAtual > 0 || metaTotais.mesAtual > 0;

  // Resumo diário do mês: uma linha por dia e uma coluna por frente, com a
  // barra do que foi alcançado da meta. O mês é o da referência, mas dá para
  // escolher qualquer mês anterior com entrada.
  const [mesResumo, setMesResumo] = usarPersistido<string | null>("ordens.mesResumo", null, (v): v is string | null => v === null || typeof v === "string");
  const mesesResumo = useMemo(() => {
    const mesRef = referencia.slice(0, 7);
    const meses = new Set<string>([mesRef]);
    for (const o of ordensFiltradasTodas) for (const e of o.entradas) if (e.toneladas > 0 && e.data <= referencia) meses.add(e.data.slice(0, 7));
    return Array.from(meses).sort().reverse();
  }, [ordensFiltradasTodas, referencia]);
  const mesResumoEfetivo = mesResumo && mesesResumo.includes(mesResumo) ? mesResumo : referencia.slice(0, 7);
  const resumoMensal = useMemo(
    () =>
      resumoDiarioMes(
        ordensFiltradasTodas,
        mesResumoEfetivo,
        referencia,
        resumoFrentes.map((r) => r.frente),
        metas,
        primeiraEntradaPorFrente,
        horaCorte
      ),
    [ordensFiltradasTodas, mesResumoEfetivo, referencia, resumoFrentes, metas, primeiraEntradaPorFrente, horaCorte]
  );

  // Diferente do resumo por frente (que é de todas as ordens do filtro), o
  // resumo detalhado no final do relatório segue só as ordens marcadas e
  // mostradas nos cards — mesmo critério das colunas "Ordens"/"Área
  // Selecionada" lá em cima.
  const resumoDetalhado = useMemo(() => resumoDetalhadoPorOrdemFazenda(ordensFiltradas, referencia), [ordensFiltradas, referencia]);

  const resumoDetalhadoPorFrenteComSubtotal = useMemo(() => {
    const grupos = new Map<string, LinhaResumoDetalhado[]>();
    for (const linha of resumoDetalhado) {
      const arr = grupos.get(linha.frente) ?? [];
      arr.push(linha);
      grupos.set(linha.frente, arr);
    }
    return Array.from(grupos.entries())
      .map(([frente, linhas]) => {
        const areaColhidaHa = Math.round(linhas.reduce((s, l) => s + l.areaColhidaHa, 0) * 100) / 100;
        const producaoTotalT = Math.round(linhas.reduce((s, l) => s + l.producaoTotalT, 0) * 100) / 100;
        return {
          frente,
          linhas,
          subtotal: {
            areaColhidaHa,
            producaoTotalT,
            tchRealParcial: areaColhidaHa > 0 ? Math.round((producaoTotalT / areaColhidaHa) * 100) / 100 : 0,
          },
        };
      })
      .sort((a, b) => a.frente.localeCompare(b.frente));
  }, [resumoDetalhado]);

  const resumoDetalhadoTotalGeral = useMemo(() => {
    const areaColhidaHa = Math.round(resumoDetalhado.reduce((s, l) => s + l.areaColhidaHa, 0) * 100) / 100;
    const producaoTotalT = Math.round(resumoDetalhado.reduce((s, l) => s + l.producaoTotalT, 0) * 100) / 100;
    return {
      areaColhidaHa,
      producaoTotalT,
      tchRealParcial: areaColhidaHa > 0 ? Math.round((producaoTotalT / areaColhidaHa) * 100) / 100 : 0,
    };
  }, [resumoDetalhado]);

  const rotulosResumo = useMemo(() => {
    // Semana/Quinzena/Mês Atual vão até o dia anterior à referência (o dia
    // atual só entra na coluna "Dia Atual") — mesma regra de resumoPorFrente,
    // pra o rótulo bater com o que é somado de verdade.
    const dm = (iso: string) => fmtDateBR(iso).slice(0, 5);
    const mesAnterior = mesAnteriorRange(referencia);
    return {
      diaAnterior: dm(addDays(referencia, -1)),
      diaAtual: dm(referencia),
      semana: `${dm(startOfWeekMonday(referencia))}–${dm(addDays(referencia, -1))}`,
      quinzena: `${dm(quinzenaRange(referencia).inicio)}–${dm(addDays(referencia, -1))}`,
      mesAtual: `${dm(startOfMonth(referencia))}–${dm(addDays(referencia, -1))}`,
      mesAnterior: `${dm(mesAnterior.inicio)}–${dm(mesAnterior.fim)}`,
    };
  }, [referencia]);

  async function imprimirRelatorio() {
    setGerandoPdf(true);
    try {
      await gerarRelatorioCompletoPdf({
        titulo: "Resumo por Frente — Ordens de Corte",
        safraLabel,
        referencia,
        period,
        periodLabel: PERIODOS.find((p) => p.key === period)?.label ?? "Dia",
        resumoFrentes,
        resumoTotais,
        mediaDiaria,
        metaTotais,
        kpis: [
          { label: "Ordens abertas", value: String(kpisTopo.abertas), sub: "Ordens selecionadas", tom: "green" },
          { label: "Ordens encerradas", value: String(kpisTopo.encerradas), sub: "Ordens selecionadas", tom: "amber" },
          {
            label: "Área aberta",
            value: `${fmtHa(kpisTopo.areaSelecionadaHa)} ha`,
            sub: `Encerradas: ${fmtHa(kpisTopo.areaEncerradaHa)} ha`,
            tom: "blue",
          },
          { label: "Área colhida", value: `${fmtHa(kpisTopo.areaColhidaHa)} ha`, sub: "Pela medição apontada", tom: "blue" },
          {
            label: "Produção dia anterior",
            value: `${fmtT(kpisTopo.prodDiaAnteriorT)} t`,
            sub: `Entrada de ${fmtDateBR(addDays(referencia, -1))} · todas as ordens`,
            tom: "blue",
          },
          {
            label: `Produção dia atual até ${rotuloHora}`,
            value: `${fmtT(kpisTopo.prodDiaAtualAte6hT)} t`,
            sub: `Entrada de ${fmtDateBR(referencia)} até ${rotuloHora} · todas as ordens`,
            tom: "blue",
          },
          {
            label: "TCH estimado",
            value: kpisTopo.tchEstimado !== null ? fmtTch(kpisTopo.tchEstimado) : "",
            sub: "Ordens abertas selecionadas",
            tom: "amber",
          },
          {
            label: "TCH médio realizado",
            value: kpisTopo.tchRealizado !== null ? fmtTch(kpisTopo.tchRealizado) : "",
            sub: "Ton entregue / área medida",
            tom: "red",
          },
        ],
        historicoTch,
        horaCorte,
        divergenciaPorOrdem: podeGravar ? Object.fromEntries(divergenciaPorOrdem) : {},
        producaoDesde: producao?.inicio,
        porFrente,
        resumoDetalhadoPorFrente: resumoDetalhadoPorFrenteComSubtotal,
        resumoDetalhadoTotalGeral,
        resumoMensal,
        nomeUsuario,
      });
    } finally {
      setGerandoPdf(false);
    }
  }

  const totalGeral = useMemo(() => {
    let entradaPeriodoT = 0;
    let areaTotalHa = 0;
    let abertas = 0;
    let encerradas = 0;
    for (const o of ordensFiltradas) {
      const m = calcOrdemMetrics(o, period, referencia);
      entradaPeriodoT += m.entradaPeriodoT;
      areaTotalHa += m.areaTotalHa;
      if (o.status === "Aberta") abertas += 1;
      else encerradas += 1;
    }
    return {
      entradaPeriodoT: Math.round(entradaPeriodoT * 100) / 100,
      areaTotalHa: Math.round(areaTotalHa * 100) / 100,
      abertas,
      encerradas,
      total: ordensFiltradas.length,
    };
  }, [ordensFiltradas, period, referencia]);

  // TCH estimado de uma ordem (safra atual, do histórico importado).
  const tchEstimadoDe = (numero: string): number | null =>
    historicoTch.porOrdem[numero]?.find((h) => h.safra === historicoTch.safraAtual)?.tchEst ?? null;

  // KPIs do topo — sempre sobre as ordens selecionadas (nos cards).
  const kpisTopo = useMemo(() => {
    const diaAnterior = addDays(referencia, -1);
    let abertas = 0;
    let encerradas = 0;
    let areaSelecionadaHa = 0;
    let areaEncerradaHa = 0;
    let areaColhidaHa = 0;
    let prodDiaAnteriorT = 0;
    let prodDiaAtualAte6hT = 0;
    let estPonderado = 0;
    let estArea = 0;
    let realT = 0;
    let realArea = 0;
    for (const o of ordensFiltradas) {
      const area = calcAreaTotalHa(o);
      const colhida = calcAreaColhidaHa(o);
      areaSelecionadaHa += area;
      if (o.status === "Aberta") {
        abertas += 1;
        const est = tchEstimadoDe(o.numero);
        if (est !== null && area > 0) {
          estPonderado += est * area;
          estArea += area;
        }
      } else {
        encerradas += 1;
        areaEncerradaHa += area;
      }
      areaColhidaHa += colhida;
      if (colhida > 0) {
        realT += calcAcumSafraT(o, referencia);
        realArea += colhida;
      }
    }
    // A produção do dia é a da frente inteira (todas as ordens que batem com os filtros), a mesma do
    // Resumo por frente e do Resumo diário — não só das ordens marcadas para aparecer nos cards.
    for (const o of ordensFiltradasTodas) {
      for (const e of o.entradas) {
        if (e.data === diaAnterior) prodDiaAnteriorT += e.toneladas;
        if (e.data === referencia) prodDiaAtualAte6hT += e.toneladasAte6h;
      }
    }
    const tchEstimado = estArea > 0 ? estPonderado / estArea : null;
    const tchRealizado = realArea > 0 ? realT / realArea : null;
    return {
      abertas,
      encerradas,
      areaSelecionadaHa,
      areaEncerradaHa,
      areaColhidaHa,
      prodDiaAnteriorT,
      prodDiaAtualAte6hT,
      tchEstimado,
      tchRealizado,
      divergenciaPct:
        tchEstimado !== null && tchRealizado !== null && tchEstimado > 0
          ? (tchRealizado / tchEstimado - 1) * 100
          : null,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ordensFiltradas, ordensFiltradasTodas, referencia, historicoTch]);

  // Ordens cujo TCH realizado (ton acumulada ÷ área medida) foge do estimado.
  const divergencias = useMemo(() => {
    const lista: { numero: string; real: number; est: number; pct: number }[] = [];
    for (const o of ordensFiltradas) {
      const colhida = calcAreaColhidaHa(o);
      const est = tchEstimadoDe(o.numero);
      if (colhida <= 0 || est === null || est <= 0) continue;
      const real = calcAcumSafraT(o, referencia) / colhida;
      const pct = (real / est - 1) * 100;
      if (Math.abs(pct) > LIMITE_DIVERGENCIA_TCH_PCT) lista.push({ numero: o.numero, real, est, pct });
    }
    return lista.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ordensFiltradas, historicoTch, referencia]);
  const divergenciaPorOrdem = useMemo(() => new Map(divergencias.map((d) => [d.numero, d.pct])), [divergencias]);

  function toggleColapso(frente: string) {
    setColapsadas((prev) => {
      const next = new Set(prev);
      if (next.has(frente)) next.delete(frente);
      else next.add(frente);
      return next;
    });
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      {/* Topbar */}
      <header className="flex flex-shrink-0 items-center gap-3 border-b border-line bg-card px-6 py-3">
        <nav className="min-w-0 flex-1 text-[13px] text-muted">
          <span className="uppercase tracking-wide text-[11px] text-muted">Acompanhamentos</span>
          <div className="truncate text-[15px] font-bold text-ink">Ordens de Corte</div>
        </nav>
        <div className="flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-[12.5px] font-medium text-ink">
          Safra <span className="font-bold text-brand-700">{safraLabel}</span>
          <span className="text-muted">· Capinópolis-MG</span>
          {producao && (
            <span
              className="text-muted"
              title={`Safra ${producao.rotulo}: só contam pesagens de ${fmtDateBR(producao.inicio)} a ${fmtDateBR(producao.fim)} (Cadastros > Safras)`}
            >
              · produção desde {fmtDateBR(producao.inicio)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 rounded-full border border-good-500/30 bg-good-50 px-3 py-1.5 text-[12px] font-semibold text-good-600">
          <span className="h-1.5 w-1.5 rounded-full bg-good-500" />
          Dados do servidor
        </div>
        {!podeGravar && (
          <div className="flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-[12px] font-semibold text-muted">
            Somente leitura
          </div>
        )}
        <button
          type="button"
          onClick={imprimirRelatorio}
          disabled={gerandoPdf || resumoFrentes.length === 0}
          className="flex items-center gap-1.5 rounded-lg border border-line bg-card px-3.5 py-2 text-[13px] font-semibold text-navy-800 shadow-card hover:bg-surface disabled:opacity-50"
        >
          <IconImprimir size={15} />
          {gerandoPdf ? "Gerando…" : "Imprimir / PDF"}
        </button>
        {podeGravar && (
          <button
            type="button"
            onClick={() => setImportarAberto(true)}
            className="flex items-center gap-1.5 rounded-lg bg-navy-900 px-3.5 py-2 text-[13px] font-semibold text-white shadow-card hover:bg-navy-800"
          >
            <IconImportar size={15} />
            Importar planilhas
          </button>
        )}
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="mb-4 flex rounded-lg bg-navy-900/5 p-1 sm:inline-flex">
          {([
            ["painel", "Painel"],
            ["apontamento", "Apontamento · Área colhida"],
          ] as const).map(([k, rotulo]) => (
            <button
              key={k}
              type="button"
              onClick={() => setAba(k)}
              className={`flex-1 rounded-md px-4 py-1.5 text-[13px] font-semibold transition-colors sm:flex-none ${
                aba === k ? "bg-navy-900 text-white shadow-card" : "text-navy-800 hover:bg-white"
              }`}
            >
              {rotulo}
            </button>
          ))}
        </div>

        {aba === "apontamento" && (
          <AreaColhidaTab
            ordens={ordensBrutas}
            referencia={referencia}
            ordemInicial={ordemApontamento}
            podeGravar={podeGravar}
            onSalvo={() => refetch()}
          />
        )}

        {aba === "painel" && (
          <>
        {/* Inserir ordem manualmente */}
        {podeGravar && (
          <div className="mb-4 flex flex-wrap items-center gap-2.5 rounded-xl2 border border-line bg-card px-4 py-3 shadow-card">
            <form onSubmit={inserirOrdem} className="flex flex-wrap items-center gap-2">
              <label className="text-[12.5px] font-semibold text-ink" htmlFor="inserir-ordem-input">
                Inserir Ordem
              </label>
              <input
                id="inserir-ordem-input"
                type="text"
                list="ordens-disponiveis-datalist"
                placeholder="Nº da ordem…"
                value={inserirNumero}
                onChange={(e) => setInserirNumero(e.target.value)}
                className="w-40 rounded-lg border border-line bg-card px-3 py-1.5 text-[13px] text-ink shadow-card placeholder:text-muted"
              />
              <datalist id="ordens-disponiveis-datalist">
                {ordensDisponiveis.map((o) => (
                  <option key={o.numero} value={o.numero}>
                    {o.fazendaNome}
                  </option>
                ))}
              </datalist>
              <button
                type="submit"
                disabled={inserindo || !inserirNumero.trim()}
                className="rounded-lg bg-navy-900 px-3.5 py-1.5 text-[13px] font-semibold text-white shadow-card hover:bg-navy-800 disabled:opacity-50"
              >
                {inserindo ? "Inserindo…" : "Inserir"}
              </button>
            </form>
            {inserirErro && <span className="text-[12.5px] font-medium text-alert-600">{inserirErro}</span>}
            <span className="ml-auto text-[12px] font-medium text-muted">
              Cards automáticos: ordens abertas e encerradas com entrada de cana no dia atual ou anterior ({ordensAuto.size}). Inseridas à
              mão: {[...ordensVisiveis].filter((n) => !ordensAuto.has(n)).length}.
            </span>
          </div>
        )}

        {/* Filtros */}
        <div className="mb-4 flex flex-wrap items-center gap-2.5">
          <div className="flex rounded-lg bg-navy-900/5 p-1">
            {PERIODOS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => setPeriod(p.key)}
                className={`rounded-md px-3.5 py-1.5 text-[13px] font-semibold transition-colors ${
                  period === p.key ? "bg-navy-900 text-white shadow-card" : "text-navy-800 hover:bg-white"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {period !== "safra" && (
            <input
              type="date"
              value={referencia}
              onChange={(e) => setReferencia(e.target.value)}
              className="rounded-lg border border-line bg-card px-3 py-1.5 text-[13px] font-medium text-ink shadow-card"
            />
          )}

          <select
            value={horaCorte}
            onChange={(e) => setHoraCorte(Number(e.target.value) as HoraCorte)}
            title="Horário de corte do dia atual: tudo que entrou depois dele não soma"
            aria-label="Horário de corte do dia atual"
            className="rounded-lg border border-line bg-card px-3 py-1.5 text-[13px] font-medium text-ink shadow-card"
          >
            {HORAS_CORTE.map((h) => (
              <option key={h.hora} value={h.hora} disabled={(h.hora === 12 || h.hora === 18) && !cortesIntermediarios}>
                Dia atual até {h.rotulo}
                {h.hora === 24 ? " (dia completo)" : ""}
                {(h.hora === 12 || h.hora === 18) && !cortesIntermediarios ? " — reimporte a pesagem" : ""}
              </option>
            ))}
          </select>

          <FrentesSeletor
            frentes={frentesOrdenadas}
            visiveis={frentesVisiveis}
            onAlternar={alternarFrente}
            onMover={moverFrente}
            onTodas={mostrarTodasFrentes}
            onRestaurar={restaurarOrdemFrentes}
          />

          <select
            value={statusFiltro}
            onChange={(e) => setStatusFiltro(e.target.value as "todas" | StatusOrdem)}
            className="rounded-lg border border-line bg-card px-3 py-1.5 text-[13px] font-medium text-ink shadow-card"
          >
            <option value="todas">Todos os status</option>
            <option value="Aberta">Abertas</option>
            <option value="Encerrada">Encerradas</option>
          </select>

          <input
            type="search"
            placeholder="Buscar nº da ordem, fazenda…"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="min-w-[220px] flex-1 rounded-lg border border-line bg-card px-3 py-1.5 text-[13px] text-ink shadow-card placeholder:text-muted"
          />

          <span className="ml-auto text-[12.5px] font-medium text-muted">
            {periodoTexto(period, referencia, safraLabel)}
          </span>
        </div>

        {/* KPIs */}
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-flow-col lg:grid-cols-4 lg:grid-rows-2">
          <KpiCard tone="green" icon={<IconOrdemCorte size={22} />} label="Ordens abertas" value={kpisTopo.abertas.toString()} sub="Ordens selecionadas" />
          <KpiCard tone="amber" icon={<IconOrdemEncerrada size={22} />} label="Ordens encerradas" value={kpisTopo.encerradas.toString()} sub="Ordens selecionadas" />
          <KpiCard
            tone="blue"
            icon={<IconTalhao size={22} />}
            label="Área aberta"
            value={`${fmtHa(kpisTopo.areaSelecionadaHa)} ha`}
            sub={`Ordens selecionadas · encerradas: ${fmtHa(kpisTopo.areaEncerradaHa)} ha`}
          />
          <KpiCard
            tone="blue"
            icon={<IconColhedora size={22} />}
            label="Área colhida"
            value={`${fmtHa(kpisTopo.areaColhidaHa)} ha`}
            sub="Pela medição apontada"
          />
          <KpiCard
            tone="blue"
            icon={<IconCaminhaoCana size={22} />}
            label="Produção dia anterior"
            value={`${fmtT(kpisTopo.prodDiaAnteriorT)} t`}
            sub={`Entrada de ${fmtDateBR(addDays(referencia, -1))} · todas as ordens`}
          />
          <KpiCard
            tone="blue"
            icon={<IconRelogio size={22} />}
            label={`Produção dia atual até ${rotuloHora}`}
            value={`${fmtT(kpisTopo.prodDiaAtualAte6hT)} t`}
            sub={`Entrada de ${fmtDateBR(referencia)} até ${rotuloHora} · todas as ordens`}
          />
          <KpiCard
            tone="amber"
            icon={<IconMeta size={22} />}
            label="TCH estimado"
            value={kpisTopo.tchEstimado !== null ? fmtTch(kpisTopo.tchEstimado) : "—"}
            sub={
              kpisTopo.tchEstimado !== null
                ? "Pelas ordens abertas selecionadas"
                : "Importe a safra atual em Histórico de Safras"
            }
          />
          <KpiCard
            tone="red"
            icon={<IconTch size={22} />}
            label="TCH médio realizado"
            value={kpisTopo.tchRealizado !== null ? fmtTch(kpisTopo.tchRealizado) : "—"}
            sub="Ton entregue ÷ área medida lançada"
            aviso={
              podeGravar &&
              kpisTopo.divergenciaPct !== null &&
              Math.abs(kpisTopo.divergenciaPct) > LIMITE_DIVERGENCIA_TCH_PCT
                ? `${kpisTopo.divergenciaPct >= 0 ? "▲" : "▼"} ${Math.abs(kpisTopo.divergenciaPct).toFixed(0)}% vs. estimado`
                : undefined
            }
          />
        </div>

        {podeGravar && divergencias.length > 0 && (
          <div className="mb-4 rounded-xl2 border border-amber-500/40 bg-amber-50 px-4 py-3 text-[12.5px] text-amber-700">
            <p className="font-bold">
              Atenção: {divergencias.length} ordem(ns) com TCH realizado (ton entregue ÷ área medida) mais de{" "}
              {LIMITE_DIVERGENCIA_TCH_PCT}% diferente do estimado. Confira a área medida lançada ou a entrada de cana.
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {divergencias.map((d) => (
                <span
                  key={d.numero}
                  className="rounded-full border border-amber-500/30 bg-card px-2.5 py-0.5 text-[11.5px] text-ink"
                >
                  <b>Ordem {d.numero}</b> · real {fmtTch(d.real)} · est. {fmtTch(d.est)} ·{" "}
                  <b className={d.pct >= 0 ? "text-good-600" : "text-alert-600"}>
                    {d.pct >= 0 ? "▲" : "▼"} {Math.abs(d.pct).toFixed(0)}%
                  </b>
                </span>
              ))}
            </div>
          </div>
        )}

        {period !== "safra" && totalGeral.entradaPeriodoT === 0 && totalGeral.total > 0 && (
          <p className="-mt-2 mb-4 text-[12px] text-muted">
            Nenhuma entrada registrada para {periodoTexto(period, referencia, safraLabel).toLowerCase()}. Os
            filtros só mostram as datas presentes na última importação.
          </p>
        )}

        {/* Resumo por frente — todos os recortes de período de uma vez, sempre
            recalculados a partir da data de referência selecionada acima.
            "Ordens"/"Área Selecionada" refletem só os cards mostrados
            abaixo; as demais colunas (inclusive "Área Acumulada") são o
            retrato real da frente inteira (todas as ordens importadas que
            batem com os filtros de frente/status/busca). */}
        {resumoFrentes.length > 0 && (
          <div className="mb-5 overflow-x-auto rounded-xl2 border border-line bg-card shadow-card">
            <p className="border-b border-line bg-surface px-4 py-1.5 text-[11px] text-muted">
              "Ordens" e "Área Selecionada" são das {totalGeral.total} ordem(ns) marcadas e mostradas nos cards
              abaixo; as demais colunas são de todas as ordens importadas (
              {ordensFiltradasTodas.length} no filtro atual).
              {temMetas &&
                ` Abaixo de cada produção: meta da frente no período e % atingido (Dia Atual compara com ${
                  horaCorte === 24 ? "a meta diária inteira" : `${horaCorte}/24 da meta diária`
                }, por contar só até ${rotuloHora}).`}
            </p>
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-line bg-surface text-left text-muted">
                  <th className="px-4 py-2 font-semibold">Frente</th>
                  <th className="px-3 py-2 text-right font-semibold">Ordens</th>
                  <th className="px-3 py-2 text-right font-semibold">
                    Área Selecionada (ha)
                  </th>
                  <th className="px-3 py-2 text-right font-semibold">
                    Área Acumulada (ha)
                    <div className="font-normal normal-case text-muted/70">todas as ordens</div>
                  </th>
                  <th className="px-3 py-2 text-right font-semibold">
                    Safra
                    <div className="font-normal normal-case text-muted/70">acumulado</div>
                  </th>
                  <th className="px-3 py-2 text-right font-semibold">
                    Mês Anterior
                    <div className="font-normal normal-case text-muted/70">{rotulosResumo.mesAnterior}</div>
                  </th>
                  <th className="px-3 py-2 text-right font-semibold">
                    Mês Atual
                    <div className="font-normal normal-case text-muted/70">{rotulosResumo.mesAtual}</div>
                  </th>
                  <th className="px-3 py-2 text-right font-semibold">
                    Quinzena
                    <div className="font-normal normal-case text-muted/70">{rotulosResumo.quinzena}</div>
                  </th>
                  <th className="px-3 py-2 text-right font-semibold">
                    Semana
                    <div className="font-normal normal-case text-muted/70">{rotulosResumo.semana}</div>
                  </th>
                  <th className="px-3 py-2 text-right font-semibold">
                    Dia Anterior
                    <div className="font-normal normal-case text-muted/70">{rotulosResumo.diaAnterior}</div>
                  </th>
                  <th className="px-4 py-2 text-right font-semibold">
                    Dia Atual
                    <div className="font-normal normal-case text-muted/70">{rotulosResumo.diaAtual} até {rotuloHora}</div>
                  </th>
                  <th className="px-3 py-2 text-right font-semibold">
                    Dias Efet.
                    <div className="font-normal normal-case text-muted/70">safra</div>
                  </th>
                  <th className="px-4 py-2 text-right font-semibold">
                    Ton Média Dia Efet.
                    <div className="font-normal normal-case text-muted/70">safra ÷ dias efet.</div>
                  </th>
                </tr>
              </thead>
              <tbody>
                {resumoFrentes.map((r) => (
                  <tr key={r.frente} className="border-b border-line last:border-0">
                    <td className="px-4 py-1.5 font-semibold text-ink">{r.frente}</td>
                    <td className="px-3 py-1.5 text-right tabular text-muted">{r.ordensSelecionadas}</td>
                    <td className="px-3 py-1.5 text-right tabular text-ink">{fmtHa(r.areaSelecionadaHa)}</td>
                    <td className="px-3 py-1.5 text-right tabular text-ink">{fmtHa(r.areaAcumuladaHa)}</td>
                    <td className="px-3 py-1.5 text-right tabular text-ink">{fmtT(r.safraT)}<MetaLinha real={r.safraT} meta={r.meta.safra} /></td>
                    <td className="px-3 py-1.5 text-right tabular text-ink">{fmtT(r.mesAnteriorT)}<MetaLinha real={r.mesAnteriorT} meta={r.meta.mesAnterior} /></td>
                    <td className="px-3 py-1.5 text-right tabular text-ink">{fmtT(r.mesAtualT)}<MetaLinha real={r.mesAtualT} meta={r.meta.mesAtual} /></td>
                    <td className="px-3 py-1.5 text-right tabular text-ink">{fmtT(r.quinzenaT)}<MetaLinha real={r.quinzenaT} meta={r.meta.quinzena} /></td>
                    <td className="px-3 py-1.5 text-right tabular text-ink">{fmtT(r.semanaT)}<MetaLinha real={r.semanaT} meta={r.meta.semana} /></td>
                    <td className="px-3 py-1.5 text-right tabular text-ink">{fmtT(r.diaAnteriorT)}<MetaLinha real={r.diaAnteriorT} meta={r.meta.diaAnterior} /></td>
                    <td className="px-4 py-1.5 text-right tabular font-semibold text-brand-700">
                      {fmtT(r.diaAtualT)}<MetaLinha real={r.diaAtualT} meta={r.meta.diaAtual} />
                    </td>
                    <td className="px-3 py-1.5 text-right tabular text-ink">{r.diasEfetivos}</td>
                    <td className="px-4 py-1.5 text-right tabular text-ink">{r.diasEfetivos > 0 ? fmtT(r.mediaDiaEfetivoT) : "–"}</td>
                  </tr>
                ))}
                <tr className="bg-surface font-bold text-ink">
                  <td className="px-4 py-1.5">Total geral</td>
                  <td className="px-3 py-1.5 text-right tabular">{resumoTotais.ordensSelecionadas}</td>
                  <td className="px-3 py-1.5 text-right tabular">{fmtHa(resumoTotais.areaSelecionadaHa)}</td>
                  <td className="px-3 py-1.5 text-right tabular">{fmtHa(resumoTotais.areaAcumuladaHa)}</td>
                  <td className="px-3 py-1.5 text-right tabular">{fmtT(resumoTotais.safraT)}<MetaLinha real={resumoTotais.safraT} meta={metaTotais.safra} /></td>
                  <td className="px-3 py-1.5 text-right tabular">{fmtT(resumoTotais.mesAnteriorT)}<MetaLinha real={resumoTotais.mesAnteriorT} meta={metaTotais.mesAnterior} /></td>
                  <td className="px-3 py-1.5 text-right tabular">{fmtT(resumoTotais.mesAtualT)}<MetaLinha real={resumoTotais.mesAtualT} meta={metaTotais.mesAtual} /></td>
                  <td className="px-3 py-1.5 text-right tabular">{fmtT(resumoTotais.quinzenaT)}<MetaLinha real={resumoTotais.quinzenaT} meta={metaTotais.quinzena} /></td>
                  <td className="px-3 py-1.5 text-right tabular">{fmtT(resumoTotais.semanaT)}<MetaLinha real={resumoTotais.semanaT} meta={metaTotais.semana} /></td>
                  <td className="px-3 py-1.5 text-right tabular">{fmtT(resumoTotais.diaAnteriorT)}<MetaLinha real={resumoTotais.diaAnteriorT} meta={metaTotais.diaAnterior} /></td>
                  <td className="px-4 py-1.5 text-right tabular text-brand-700">{fmtT(resumoTotais.diaAtualT)}<MetaLinha real={resumoTotais.diaAtualT} meta={metaTotais.diaAtual} /></td>
                  <td className="px-3 py-1.5 text-right tabular">{resumoTotais.diasEfetivos}</td>
                  <td className="px-4 py-1.5 text-right tabular">{resumoTotais.diasEfetivos > 0 ? fmtT(resumoTotais.mediaDiaEfetivoT) : "–"}</td>
                </tr>
                <tr className="border-t border-line bg-card text-ink">
                  <td className="px-4 py-1.5 font-semibold" colSpan={4}>
                    Média t entregue/dia
                    <span className="ml-1 font-normal text-muted">(só dias com entrega de cana)</span>
                  </td>
                  {(["safra", "mesAnterior", "mesAtual", "quinzena", "semana", "diaAnterior", "diaAtual"] as const).map((k) => (
                    <td key={k} className="px-3 py-1.5 text-right tabular font-semibold">
                      {mediaDiaria[k].dias > 0 ? fmtT(mediaDiaria[k].media) : "–"}
                      <div className="text-[10.5px] font-normal text-muted">{mediaDiaria[k].dias} dia(s)</div>
                    </td>
                  ))}
                  <td colSpan={2} />
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* Grupos por frente com os cards ("quadrados") */}
        {porFrente.length === 0 && (
          <div className="rounded-xl2 border border-dashed border-line bg-card px-6 py-14 text-center text-muted">
            {ordens.length === 0 ? (
              <>
                Nenhuma ordem importada ainda.{" "}
                {podeGravar ? (
                  <button
                    type="button"
                    onClick={() => setImportarAberto(true)}
                    className="font-semibold text-brand-700"
                  >
                    Importar planilhas
                  </button>
                ) : (
                  "Peça para um usuário com nível Gravação ou Administrador importar as planilhas."
                )}
              </>
            ) : ordensSelecionadas.length === 0 ? (
              podeGravar
                ? 'Nenhuma ordem aberta nem encerrada com entrada de cana no dia atual ou anterior. Use "Inserir Ordem" para ver uma ordem específica.'
                : "Nenhuma ordem aberta nem encerrada com entrada de cana no dia atual ou anterior."
            ) : (
              "Nenhuma ordem de corte encontrada para os filtros selecionados."
            )}
          </div>
        )}

        {porFrente.map(([frente, lista]) => {
          const aberto = !colapsadas.has(frente);
          const subtotal = lista.reduce((s, o) => s + calcOrdemMetrics(o, period, referencia).entradaPeriodoT, 0);
          return (
            <div key={frente} className="mb-5">
              <button
                type="button"
                onClick={() => toggleColapso(frente)}
                className="mb-2.5 flex w-full items-center gap-2.5 rounded-lg bg-navy-900 px-4 py-2 text-left text-white"
              >
                <IconSetaDireita size={13} className={`flex-shrink-0 transition-transform ${aberto ? "rotate-90" : ""}`} />
                <span className="text-[13.5px] font-bold tracking-wide">{frente}</span>
                <span className="text-[12px] font-medium text-brand-200">{lista.length} ordem(ns)</span>
                <span className="ml-auto text-[12.5px] font-semibold text-white/90">
                  {fmtT(Math.round(subtotal * 100) / 100)} t no período
                </span>
              </button>
              {aberto && (
                <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 xl:grid-cols-3">
                  {lista.map((ordem) => (
                    <OrdemCard
                      key={ordem.id}
                      ordem={ordem}
                      period={period}
                      referencia={referencia}
                      historico={historicoTch.porOrdem[ordem.numero]}
                      safraAtual={historicoTch.safraAtual}
                      safrasAnteriores={historicoTch.safrasAnteriores}
                      divergenciaPct={podeGravar ? divergenciaPorOrdem.get(ordem.numero) : undefined}
                      onRemover={podeGravar && ordensVisiveis.has(ordem.numero) && !ordensAuto.has(ordem.numero) ? () => removerOrdem(ordem.numero) : undefined}
                      onLancarAreaColhida={podeGravar ? () => { setOrdemApontamento(ordem.numero); setAba("apontamento"); } : undefined}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {/* Resumo detalhado por ordem e fazenda — só as ordens marcadas e
            mostradas nos cards (mesmo critério de "Ordens"/"Área
            Selecionada" no resumo por frente), uma linha por fazenda dentro
            de cada ordem, igual ao relatório impresso de referência. */}
        {resumoDetalhado.length > 0 && (
          <div className="mb-4 max-w-5xl overflow-x-auto rounded-xl2 border border-line bg-card shadow-card">
            <div className="border-b border-line px-2.5 py-0.5">
              <div className="text-[12.5px] font-bold text-ink">Resumo Detalhado por Ordem e Fazenda</div>
              <div className="text-[10.5px] text-muted">
                Área colhida, produção total e TCH parcial das ordens marcadas e mostradas nos cards, por fazenda.
              </div>
            </div>
            <table className="w-full text-[11.5px] leading-tight">
              <thead>
                <tr className="border-b border-line bg-navy-900 text-left text-white">
                  <th className="px-3 py-1 font-semibold">Frente</th>
                  <th className="px-2.5 py-1 font-semibold">Ordem</th>
                  <th className="px-2.5 py-1 font-semibold">Fazenda</th>
                  <th className="px-2.5 py-1 font-semibold">Fundo Agrícola</th>
                  <th className="whitespace-nowrap px-2.5 py-1 text-right text-[10.5px] font-semibold">Área Colhida (ha)</th>
                  <th className="whitespace-nowrap px-2.5 py-1 text-right text-[10.5px] font-semibold">Produção Acumulada (t)</th>
                  <th className="whitespace-nowrap px-3 py-1 text-right text-[10.5px] font-semibold">TCH Parcial (t/ha)</th>
                </tr>
              </thead>
              <tbody>
                {resumoDetalhadoPorFrenteComSubtotal.map((grupo) => (
                  <Fragment key={grupo.frente}>
                    {grupo.linhas.map((l, i) => (
                      <tr
                        key={`${l.ordem}-${l.fazendaCodigo}`}
                        className={`border-b border-line/60 ${i % 2 === 1 ? "bg-surface" : "bg-card"}`}
                      >
                        <td className="px-3 py-0.5 text-ink">{i === 0 ? l.frente : ""}</td>
                        <td className="px-2.5 py-0.5 text-ink">{l.ordem}</td>
                        <td className="px-2.5 py-0.5 text-muted">{l.fazendaCodigo}</td>
                        <td className="px-2.5 py-0.5 text-ink">{l.fazendaNome}</td>
                        <td className="px-2.5 py-0.5 text-right tabular text-ink">
                          {l.areaColhidaHa > 0 ? fmtHa(l.areaColhidaHa) : "–"}
                        </td>
                        <td className="px-2.5 py-0.5 text-right tabular text-ink">
                          {l.producaoTotalT > 0 ? fmtT(l.producaoTotalT) : "–"}
                        </td>
                        <td className="px-3 py-0.5 text-right tabular font-medium text-ink">
                          {l.tchRealParcial > 0 ? fmtTch(l.tchRealParcial) : "–"}
                        </td>
                      </tr>
                    ))}
                    <tr className="bg-navy-900 font-semibold text-white">
                      <td className="px-3 py-0.5" colSpan={4}>
                        {grupo.frente} Total
                      </td>
                      <td className="px-2.5 py-0.5 text-right tabular">{fmtHa(grupo.subtotal.areaColhidaHa)}</td>
                      <td className="px-2.5 py-0.5 text-right tabular">{fmtT(grupo.subtotal.producaoTotalT)}</td>
                      <td className="px-3 py-0.5 text-right tabular">{fmtTch(grupo.subtotal.tchRealParcial)}</td>
                    </tr>
                  </Fragment>
                ))}
                <tr className="bg-navy-950 font-bold text-white">
                  <td className="px-3 py-1" colSpan={4}>
                    Total Geral
                  </td>
                  <td className="px-2.5 py-1 text-right tabular">{fmtHa(resumoDetalhadoTotalGeral.areaColhidaHa)}</td>
                  <td className="px-2.5 py-1 text-right tabular">{fmtT(resumoDetalhadoTotalGeral.producaoTotalT)}</td>
                  <td className="px-3 py-1 text-right tabular">{fmtTch(resumoDetalhadoTotalGeral.tchRealParcial)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {frentesOrdenadas.length > 0 && (
          <ResumoMensalTabela
            resumo={resumoMensal}
            meses={mesesResumo}
            onMes={setMesResumo}
            todasFrentes={frentesOrdenadas}
            ocultas={frentesCfg.ocultas}
            onAlternarFrente={alternarFrente}
            referencia={referencia}
            rotuloHora={rotuloHora}
          />
        )}

        <p className="mb-2 mt-6 text-center text-[11.5px] text-muted">
          Sincronizado com o servidor {ultimaSincronizacao ? new Date(ultimaSincronizacao).toLocaleString("pt-BR") : "…"}
        </p>
          </>
        )}
      </div>

      {importarAberto && <ImportarModal onFechar={() => setImportarAberto(false)} onImportado={() => refetch(true)} admin={ehAdmin(perfil)} />}
    </div>
  );
}

const KPI_TONS = {
  blue: "border-brand-200/60 bg-brand-50 text-brand-800",
  green: "border-good-500/25 bg-good-50 text-good-700",
  amber: "border-amber-500/25 bg-amber-50 text-amber-700",
  red: "border-alert-500/25 bg-alert-50 text-alert-700",
} as const;

function KpiCard({
  label,
  value,
  sub,
  icon,
  tone,
  aviso,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: ReactNode;
  tone: keyof typeof KPI_TONS;
  aviso?: string;
}) {
  return (
    <div className={`rounded-xl2 border p-4 shadow-card ${KPI_TONS[tone]}`}>
      <div className="mb-1.5 opacity-80">{icon}</div>
      <div className="text-[11.5px] font-semibold opacity-80">{label}</div>
      <div className="mt-0.5 text-[24px] font-bold tabular leading-none">{value}</div>
      {sub && <div className="mt-1.5 text-[11px] opacity-70">{sub}</div>}
      {aviso && (
        <div className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-bold text-amber-700">
          ⚠ {aviso}
        </div>
      )}
    </div>
  );
}

/** Selo de produtividade por faixa de TCH — faixas provisórias (precisam ser
 * validadas com a operação); fácil de ajustar depois num só lugar. */
function TchBadge({ tch }: { tch: number }) {
  let label = "Baixo";
  let classes = "bg-alert-50 text-alert-600";
  if (tch > 80) {
    label = "Excelente";
    classes = "bg-good-50 text-good-600";
  } else if (tch >= 60) {
    label = "Bom";
    classes = "bg-brand-50 text-brand-700";
  } else if (tch >= 40) {
    label = "Médio";
    classes = "bg-amber-50 text-amber-600";
  }
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold ${classes}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}

function StatusBadge({ status }: { status: StatusOrdem }) {
  const aberta = status === "Aberta";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold ${
        aberta ? "bg-good-50 text-good-600" : "bg-amber-50 text-amber-600"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${aberta ? "bg-good-500" : "bg-amber-500"}`} />
      {aberta ? "Aberta" : "Encerrada"}
    </span>
  );
}

const DIAS_SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

const rotuloMes = rotuloMesAbrev;

/** Barra fina com o quanto da meta foi alcançado (passa de 100% sem estourar a célula). */
function BarraMeta({ real, meta }: { real: number; meta: number }) {
  if (!(meta > 0)) return <div className="mt-0.5 h-1" />;
  const pct = (real / meta) * 100;
  const cor = pct >= 100 ? "bg-good-500" : pct >= 80 ? "bg-amber-500" : "bg-alert-500";
  return (
    <div className="mt-0.5 flex items-center gap-1" title={`Meta ${fmtT(meta)} t · ${pct.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%`}>
      <div className="h-1 flex-1 overflow-hidden rounded-full bg-line">
        <div className={`h-full rounded-full ${cor}`} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      <span className="w-7 text-right text-[9.5px] font-semibold leading-none text-muted">
        {pct.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%
      </span>
    </div>
  );
}

/** Meta do dia (sem casas decimais, cor suave, sem negrito) antes da tonelada realizada. */
function ValorComMeta({ t, meta, futuro }: { t: number; meta: number; futuro: boolean }) {
  if (futuro) return null;
  return (
    <div className="flex items-baseline justify-end gap-2">
      {meta > 0 && (
        <span className="text-[11px] font-normal text-muted/80">
          {Math.round(meta).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}
        </span>
      )}
      <span>{t > 0 ? fmtT(t) : "–"}</span>
    </div>
  );
}

function ResumoMensalTabela({
  resumo,
  meses,
  onMes,
  todasFrentes,
  ocultas,
  onAlternarFrente,
  referencia,
  rotuloHora,
}: {
  resumo: ResumoMensal;
  meses: string[];
  onMes: (mes: string) => void;
  todasFrentes: string[];
  ocultas: string[];
  onAlternarFrente: (frente: string) => void;
  referencia: string;
  rotuloHora: string;
}) {
  return (
    <div className="mb-5 overflow-x-auto rounded-xl2 border border-line bg-card shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
        <div>
          <div className="text-[13px] font-bold text-ink">Resumo Diário por Frente — {rotuloMes(resumo.mes)}</div>
          <div className="text-[11px] text-muted">
            Toneladas (t) por dia e barra do alcançado sobre a meta diária da frente. O dia {fmtDateBR(referencia).slice(0, 5)}{" "}
            vale até {rotuloHora}; os dias seguintes ficam em branco.
          </div>
        </div>
        <select
          value={resumo.mes}
          onChange={(e) => onMes(e.target.value)}
          className="rounded-lg border border-line bg-card px-3 py-1.5 text-[12.5px] font-medium text-ink shadow-card"
          aria-label="Mês do resumo diário"
        >
          {meses.map((m) => (
            <option key={m} value={m}>
              {rotuloMes(m)}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-surface px-4 py-2">
        <span className="mr-1 text-[11px] font-semibold text-muted">Frentes:</span>
        {todasFrentes.map((f) => {
          const ativa = !ocultas.includes(f);
          return (
            <button
              key={f}
              type="button"
              onClick={() => onAlternarFrente(f)}
              aria-pressed={ativa}
              className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${
                ativa ? "border-navy-900 bg-navy-900 text-white" : "border-line bg-card text-muted"
              }`}
            >
              {f}
            </button>
          );
        })}
      </div>
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="border-b border-line bg-navy-900 text-left text-white">
            <th className="px-4 py-2 font-semibold">Data</th>
            {resumo.frentes.map((f) => (
              <th key={f} className="whitespace-nowrap px-3 py-2 text-right text-[11.5px] font-semibold">
                {f}
              </th>
            ))}
            <th className="whitespace-nowrap px-4 py-2 text-right text-[11.5px] font-semibold">Total (t)</th>
          </tr>
        </thead>
        <tbody>
          {resumo.dias.map((d, i) => {
            const dow = new Date(`${d.data}T00:00:00Z`).getUTCDay();
            const hoje = d.data === referencia;
            return (
              <tr
                key={d.data}
                className={`border-b border-line/60 ${hoje ? "bg-brand-50" : i % 2 === 1 ? "bg-surface" : "bg-card"}`}
              >
                <td className="whitespace-nowrap px-4 py-1 text-ink">
                  {fmtDateBR(d.data).slice(0, 6) + d.data.slice(2, 4)} <span className="text-[10.5px] text-muted">{DIAS_SEMANA[dow]}</span>
                </td>
                {resumo.frentes.map((f) => {
                  const c = d.frentes[f];
                  return (
                    <td key={f} className="min-w-[96px] px-3 py-1 text-right tabular text-ink">
                      <ValorComMeta t={c.t} meta={c.meta} futuro={d.futuro} />
                      {!d.futuro && <BarraMeta real={c.t} meta={c.meta} />}
                    </td>
                  );
                })}
                <td className="min-w-[96px] px-4 py-1 text-right tabular font-semibold text-ink">
                  <ValorComMeta t={d.totalT} meta={d.totalMeta} futuro={d.futuro} />
                  {!d.futuro && <BarraMeta real={d.totalT} meta={d.totalMeta} />}
                </td>
              </tr>
            );
          })}
          <tr className="bg-navy-950 font-bold text-white">
            <td className="px-4 py-2">Total do mês</td>
            {resumo.frentes.map((f) => (
              <td key={f} className="px-3 py-2 text-right tabular">
                {fmtT(resumo.totais[f].t)}
                {resumo.totais[f].meta > 0 && (
                  <div className="text-[10px] font-medium text-white/70">
                    Meta {fmtT(resumo.totais[f].meta)} ·{" "}
                    {((resumo.totais[f].t / resumo.totais[f].meta) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%
                  </div>
                )}
              </td>
            ))}
            <td className="px-4 py-2 text-right tabular">
              {fmtT(resumo.totalT)}
              {resumo.totalMeta > 0 && (
                <div className="text-[10px] font-medium text-white/70">
                  Meta {fmtT(resumo.totalMeta)} · {((resumo.totalT / resumo.totalMeta) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%
                </div>
              )}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function OrdemCard({
  ordem,
  period,
  referencia,
  historico,
  safraAtual,
  safrasAnteriores,
  divergenciaPct,
  onRemover,
  onLancarAreaColhida,
}: {
  ordem: OrdemCorte;
  period: Periodo;
  referencia: string;
  historico?: HistoricoTchOrdem["porOrdem"][string];
  safraAtual: number;
  safrasAnteriores: number[];
  divergenciaPct?: number;
  onRemover?: () => void;
  onLancarAreaColhida?: () => void;
}) {
  const m = calcOrdemMetrics(ordem, period, referencia);
  const areaColhidaHa = calcAreaColhidaHa(ordem);
  // TCH médio realizado: tonelada entregue ÷ área colhida apontada
  const tchMedio = areaColhidaHa > 0 ? Math.round((m.acumSafraT / areaColhidaHa) * 100) / 100 : 0;
  const progresso = m.areaTotalHa > 0 ? Math.min(100, Math.round((areaColhidaHa / m.areaTotalHa) * 100)) : 0;
  const diaAnteriorIso = addDays(referencia, -1);
  const totalDiaAnteriorT =
    Math.round(
      ordem.entradas.filter((e) => e.data === diaAnteriorIso).reduce((s, e) => s + e.toneladas, 0) * 100
    ) / 100;
  const totalDiaAtual6hT =
    Math.round(ordem.entradas.filter((e) => e.data === referencia).reduce((s, e) => s + e.toneladasAte6h, 0) * 100) /
    100;

  const gruposFazenda = useMemo(() => {
    const map = new Map<string, { fazendaCodigo: string; fazendaNome: string; talhoes: TalhaoOrdem[] }>();
    for (const t of ordem.talhoes) {
      const g = map.get(t.fazendaCodigo) ?? { fazendaCodigo: t.fazendaCodigo, fazendaNome: t.fazendaNome, talhoes: [] };
      g.talhoes.push(t);
      map.set(t.fazendaCodigo, g);
    }
    return [...map.values()];
  }, [ordem.talhoes]);

  return (
    <div className="card-ordem flex overflow-hidden rounded-xl2 border border-line bg-card shadow-card">
      <div className={`w-1.5 flex-shrink-0 ${ordem.status === "Aberta" ? "bg-good-500" : "bg-amber-500"}`} />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <div className="text-[17px] font-extrabold tracking-tight text-navy-900">Ordem {ordem.numero}</div>
            <div className="truncate text-[11.5px] text-muted">
              {ordem.fazendaCodigo} · {ordem.fazendaNome}
              {gruposFazenda.length > 1 && ` · +${gruposFazenda.length - 1} fazenda(s)`}
            </div>
          </div>
          <div className="flex flex-shrink-0 items-center gap-1.5">
            <StatusBadge status={ordem.status} />
            {onRemover && (
              <button
                type="button"
                onClick={onRemover}
                title="Remover da tela"
                className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-muted hover:bg-alert-50 hover:text-alert-600"
              >
                <IconFechar size={11} />
              </button>
            )}
          </div>
        </div>

        <div className="card-ordem-corpo p-4">
          {/* Talhões */}
          <div className="flex min-w-0 flex-col">
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">Talhões</div>
            <div className="overflow-x-auto">
            <table className="w-full text-[11.5px]">
              <thead className="bg-card">
                <tr className="whitespace-nowrap text-[9px] text-muted">
                  <th className="px-0.5 py-1 text-center font-semibold">Talhão</th>
                  <th className="px-0.5 py-1 text-right font-semibold">Área (ha)</th>
                  <th className="px-0.5 py-1 text-right font-semibold">Dia Anterior (t)</th>
                  <th className="px-0.5 py-1 text-right font-semibold">Dia Atual (t)</th>
                  <th className="px-0.5 py-1 text-right font-semibold">Acumulado (t)</th>
                </tr>
              </thead>
              <tbody>
                {ordem.talhoes.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-2 text-center text-muted">
                      Sem talhões cadastrados.
                    </td>
                  </tr>
                )}
                {gruposFazenda.map((g) => (
                  <Fragment key={g.fazendaCodigo}>
                    {gruposFazenda.length > 1 && (
                      <tr className="border-t border-line/70 bg-surface">
                        <td colSpan={5} className="py-1 text-[10.5px] font-semibold text-muted">
                          {g.fazendaCodigo} · {g.fazendaNome}
                        </td>
                      </tr>
                    )}
                    {g.talhoes.map((t) => (
                      <tr key={`${t.fazendaCodigo}-${t.talhao}`} className="border-t border-line/70">
                        <td className="py-1 text-center font-medium text-ink">{t.talhao}</td>
                        <td className="py-1 text-right tabular text-muted">{fmtHa(t.areaHa)}</td>
                        <td className="py-1 text-right tabular text-muted">
                          {fmtT(calcTalhaoDiaAnterior(ordem, t, referencia))}
                        </td>
                        <td className="py-1 text-right tabular text-muted">
                          {fmtT(calcTalhaoDiaAtualAte6h(ordem, t, referencia))}
                        </td>
                        <td className="py-1 text-right tabular font-medium text-ink">
                          {fmtT(calcTalhaoEntradaPeriodo(ordem, t, "safra", referencia))}
                        </td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
                {ordem.talhoes.length > 0 && (
                  <tr className="border-t border-line bg-surface font-semibold text-ink">
                    <td className="py-1 text-center">Total</td>
                    <td className="py-1 text-right tabular">{fmtHa(m.areaTotalHa)}</td>
                    <td className="py-1 text-right tabular">{fmtT(totalDiaAnteriorT)}</td>
                    <td className="py-1 text-right tabular">{fmtT(totalDiaAtual6hT)}</td>
                    <td className="py-1 text-right tabular">{fmtT(m.acumSafraT)}</td>
                  </tr>
                )}
              </tbody>
            </table>
            </div>
            <TchComparativo
              areaOrdemHa={m.areaTotalHa}
              tchGeralAtual={tchMedio}
              safraAtual={safraAtual}
              safrasAnteriores={safrasAnteriores}
              historico={historico}
              divergenciaPct={divergenciaPct}
            />
          </div>

          {/* Painel de resumo */}
          <div className="flex flex-col gap-2.5">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg bg-surface p-2.5">
                <div className="text-[10.5px] text-muted">Área da ordem</div>
                <div className="text-[15px] font-bold tabular text-ink">{fmtHa(m.areaTotalHa)} ha</div>
              </div>
              <div className="rounded-lg bg-surface p-2.5">
                <div className="text-[10.5px] text-muted">Área colhida</div>
                <div className="text-[15px] font-bold tabular text-ink">{fmtHa(areaColhidaHa)} ha</div>
              </div>
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between text-[11px] text-muted">
                <span>Progresso da colheita</span>
                <span className="font-semibold text-ink">{progresso}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-surface">
                <div className="h-2 rounded-full bg-good-500" style={{ width: `${progresso}%` }} />
              </div>
            </div>

            <div className="rounded-lg px-3 py-2.5" style={{ backgroundColor: "rgb(255, 255, 209)" }}>
              <div className="text-[11px] text-ink/80">Produção no período</div>
              <div className="text-[19px] font-bold tabular text-ink">{fmtT(m.entradaPeriodoT)} t</div>
            </div>

            <div className="flex items-center justify-between rounded-lg bg-surface px-3 py-2.5">
              <div>
                <div className="text-[10.5px] text-muted">TCH médio realizado</div>
                <div className="text-[17px] font-bold tabular text-ink">{fmtTch(tchMedio)}</div>
              </div>
              <TchBadge tch={tchMedio} />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              {ordem.tipoCana ? (
                <span
                  className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                    ordem.tipoCana.toLowerCase().includes("queimada")
                      ? "bg-amber-50 text-amber-600"
                      : "bg-brand-50 text-brand-700"
                  }`}
                >
                  {ordem.tipoCana}
                </span>
              ) : (
                <span />
              )}
              {onLancarAreaColhida && (
                <button
                  type="button"
                  onClick={onLancarAreaColhida}
                  className="rounded-md border border-line bg-card px-2.5 py-1.5 text-center text-[11px] font-semibold text-navy-800 hover:bg-navy-900/5"
                >
                  Lançar área colhida
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Único lançamento manual que sobrou depois da reformulação: a área já
 * colhida de cada talhão (medição de campo, sempre parcial) — as toneladas
 * continuam 100% vindas da importação. "Por ordem" distribui o total
 * proporcionalmente pela área de cada talhão; "Por talhão" grava os valores
 * exatos.
 */
interface ResultadoImportacaoUI {
  totalOrdens: number;
  totalViagens: number;
  viagensSemOrdem: number;
  avisos: string[];
  erros: string[];
  modo?: "ambos" | "ordens" | "pesagem";
  viagensNovas?: number;
  viagensSubstituidas?: number;
  viagensMantidas?: number;
  periodo?: string | null;
}

const emptyResultado: ResultadoImportacaoUI = {
  totalOrdens: 0,
  totalViagens: 0,
  viagensSemOrdem: 0,
  avisos: [],
  erros: [],
};

/** Limpeza de pesagens por dia ou período — só administrador, com a senha dele. */
function LimparPesagens({ onLimpo }: { onLimpo: () => void }) {
  const [inicio, setInicio] = useState("");
  const [fim, setFim] = useState("");
  const [contagem, setContagem] = useState<{ viagens: number; entradas: number } | null>(null);
  const [senha, setSenha] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [feito, setFeito] = useState<string | null>(null);

  const periodo = fim && fim !== inicio ? `${fmtDateBR(inicio)} a ${fmtDateBR(fim)}` : fmtDateBR(inicio);

  async function chamar(extra: Record<string, unknown>) {
    const res = await fetch("/api/pesagens/limpar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inicio, fim: fim || inicio, ...extra }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error ?? "Não foi possível concluir.");
    return data;
  }

  async function verificar() {
    setOcupado(true);
    setErro(null);
    setFeito(null);
    try {
      setContagem(await chamar({}));
      setSenha("");
    } catch (e) {
      setContagem(null);
      setErro(e instanceof Error ? e.message : "Erro ao verificar.");
    } finally {
      setOcupado(false);
    }
  }

  async function limpar() {
    setOcupado(true);
    setErro(null);
    try {
      const r = await chamar({ confirmar: true, senha });
      setFeito(`Pesagens de ${periodo} removidas do banco: ${r.viagens} viagem(ns) e ${r.entradas} entrada(s) diária(s).`);
      setContagem(null);
      setSenha("");
      await onLimpo();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao limpar.");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="mt-5 rounded-lg border border-alert-500/30 bg-alert-50/50 p-3">
      <p className="text-[12.5px] font-semibold text-alert-700">Limpar pesagens (somente administrador)</p>
      <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted">
        Apaga do banco todas as viagens e as entradas de cana do dia ou do período escolhido, de todas as ordens. Não
        tem volta: depois é preciso importar a pesagem de novo.
      </p>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <label className="text-[11.5px] font-semibold text-muted">
          Data inicial
          <input
            type="date"
            value={inicio}
            onChange={(e) => {
              setInicio(e.target.value);
              setContagem(null);
            }}
            className="mt-0.5 block rounded-lg border border-line bg-card px-2.5 py-1.5 text-[12.5px] text-ink"
          />
        </label>
        <label className="text-[11.5px] font-semibold text-muted">
          Data final <span className="font-normal">(vazio = só o dia)</span>
          <input
            type="date"
            value={fim}
            min={inicio || undefined}
            onChange={(e) => {
              setFim(e.target.value);
              setContagem(null);
            }}
            className="mt-0.5 block rounded-lg border border-line bg-card px-2.5 py-1.5 text-[12.5px] text-ink"
          />
        </label>
        <button
          type="button"
          disabled={!inicio || ocupado}
          onClick={verificar}
          className="rounded-lg border border-alert-500/50 bg-card px-3 py-1.5 text-[12.5px] font-semibold text-alert-700 disabled:opacity-40"
        >
          Verificar
        </button>
      </div>
      {contagem && (
        <div className="mt-2.5 text-[12.5px] text-ink">
          {contagem.viagens === 0 && contagem.entradas === 0 ? (
            <p className="text-muted">Não há pesagens em {periodo}.</p>
          ) : (
            <>
              <p>
                Em <b>{periodo}</b> serão apagadas <b>{contagem.viagens}</b> viagem(ns) e <b>{contagem.entradas}</b>{" "}
                entrada(s) diária(s).
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  type="password"
                  value={senha}
                  onChange={(e) => setSenha(e.target.value)}
                  placeholder="Senha do administrador"
                  autoComplete="current-password"
                  className="w-[220px] rounded-lg border border-line bg-card px-2.5 py-1.5 text-[12.5px] text-ink"
                />
                <button
                  type="button"
                  disabled={!senha || ocupado}
                  onClick={limpar}
                  className="rounded-lg bg-alert-600 px-3 py-1.5 text-[12.5px] font-semibold text-white disabled:opacity-40"
                >
                  {ocupado ? "Limpando…" : "Limpar do banco"}
                </button>
              </div>
            </>
          )}
        </div>
      )}
      {erro && <p className="mt-2 text-[12px] text-alert-600">{erro}</p>}
      {feito && <p className="mt-2 text-[12px] font-semibold text-good-700">{feito}</p>}
    </div>
  );
}

function ImportarModal({
  onFechar,
  onImportado,
  admin,
}: {
  onFechar: () => void;
  onImportado: () => void;
  admin: boolean;
}) {

  const [arqOrdens, setArqOrdens] = useState<File[]>([]);
  const [arqPesagem, setArqPesagem] = useState<File[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoImportacaoUI | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function enviar() {
    if (arqOrdens.length === 0 && arqPesagem.length === 0) return;
    setEnviando(true);
    setErro(null);
    setResultado(null);
    try {
      const form = new FormData();
      arqOrdens.forEach((f) => form.append("ordens", f));
      arqPesagem.forEach((f) => form.append("pesagem", f));
      const res = await fetch("/api/ordens-corte/importar", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) {
        setErro(data?.error ?? "Não foi possível importar os arquivos.");
        if (data?.erros || data?.avisos) setResultado({ ...emptyResultado, ...data });
        return;
      }
      setResultado(data);
      await onImportado();
    } catch {
      setErro("Não foi possível enviar os arquivos. Verifique a conexão e tente novamente.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <ModalShell titulo="Importar planilhas de Ordens de Corte" onFechar={onFechar}>
      <p className="mb-4 text-[12.5px] leading-relaxed text-muted">
        Envie <b className="text-ink">um ou os dois relatórios</b> gerados pelo sistema de origem, do jeito que saem
        de lá — sem mexer nas colunas. Em dias sem abertura de ordem ou sem entrada de cana, importe só o que
        saiu: só <b className="text-ink">Ordem de Colheita</b> atualiza o cadastro (as entradas de cana e as áreas
        medidas são mantidas); só <b className="text-ink">Pesagem</b> atualiza as entradas (o cadastro é mantido).
        A pesagem pode cobrir só um período: cada viagem é conferida por{" "}
        <b className="text-ink">data + liberação + controle</b> e <b className="text-ink">substitui</b> a de mesma
        chave; o histórico anterior não é apagado.
      </p>

      <div className="space-y-3">
        <Campo label='1. "Ordem de Colheita.xlsx" — cadastro (status, frente, fazenda, talhões) — opcional, até 10 arquivos'>
          <input
            type="file"
            multiple
            accept=".xlsx,.xls"
            onChange={(e) => setArqOrdens(Array.from(e.target.files ?? []).slice(0, 10))}
            className="block w-full text-[12.5px] text-ink file:mr-3 file:rounded-md file:border-0 file:bg-navy-900 file:px-3 file:py-1.5 file:text-[12.5px] file:font-semibold file:text-white"
          />
        </Campo>
        <Campo label='2. "Relatório de Pesagem de Cana" — viagens já com a ordem (coluna Liberação), fazenda e peso — opcional, até 10 arquivos'>
          <input
            type="file"
            multiple
            accept=".xlsx,.xls"
            onChange={(e) => setArqPesagem(Array.from(e.target.files ?? []).slice(0, 10))}
            className="block w-full text-[12.5px] text-ink file:mr-3 file:rounded-md file:border-0 file:bg-navy-900 file:px-3 file:py-1.5 file:text-[12.5px] file:font-semibold file:text-white"
          />
        </Campo>
      </div>

      {erro && (
        <div className="mt-3 rounded-lg border border-alert-500/30 bg-alert-50 px-3 py-2 text-[12.5px] text-alert-600">
          {erro}
        </div>
      )}

      {resultado && !erro && (
        <div className="mt-3 rounded-lg border border-good-500/30 bg-good-50 px-3 py-2 text-[12.5px] text-good-700">
          <p className="font-semibold">
            {resultado.modo === "ordens"
              ? `${resultado.totalOrdens} ordem(ns) no cadastro · entradas de cana mantidas.`
              : `${resultado.modo === "ambos" ? `${resultado.totalOrdens} ordem(ns) · ` : ""}${resultado.totalViagens} viagem(ns) lida(s)${
                  resultado.periodo ? ` (${resultado.periodo})` : ""
                } · ${resultado.viagensNovas ?? 0} nova(s), ${resultado.viagensSubstituidas ?? 0} alterada(s) e substituída(s), ${resultado.viagensMantidas ?? 0} sem alteração (histórico mantido).`}
          </p>
          {resultado.viagensSemOrdem > 0 && (
            <p className="mt-1 text-good-600">{resultado.viagensSemOrdem} sem ordem cadastrada.</p>
          )}
        </div>
      )}

      {resultado && resultado.avisos.length > 0 && (
        <div className="mt-3 max-h-[160px] overflow-y-auto rounded-lg border border-line bg-surface p-2.5 text-[12px] text-muted">
          <p className="mb-1 font-semibold text-ink">Avisos ({resultado.avisos.length}):</p>
          <ul className="list-disc space-y-0.5 pl-4">
            {resultado.avisos.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </div>
      )}

      {resultado && resultado.erros.length > 0 && (
        <div className="mt-3 max-h-[140px] overflow-y-auto rounded-lg border border-alert-500/20 bg-alert-50/60 p-2.5 text-[12px] text-alert-600">
          <p className="mb-1 font-semibold">Erros ({resultado.erros.length}):</p>
          <ul className="list-disc space-y-0.5 pl-4">
            {resultado.erros.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </div>
      )}

      {admin && <LimparPesagens onLimpo={onImportado} />}

      <div className="mt-5 flex justify-end gap-2">
        <button
          type="button"
          onClick={onFechar}
          className="rounded-lg border border-line px-4 py-2 text-[13px] font-semibold text-ink"
        >
          {resultado && !erro ? "Fechar" : "Cancelar"}
        </button>
        <button
          type="button"
          disabled={(arqOrdens.length === 0 && arqPesagem.length === 0) || enviando}
          onClick={enviar}
          className="rounded-lg bg-navy-900 px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-40"
        >
          {enviando ? "Importando…" : "Importar"}
        </button>
      </div>
    </ModalShell>
  );
}
