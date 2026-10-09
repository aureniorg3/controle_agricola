import type { ReactNode } from "react";
import Link from "next/link";
import type { IconProps } from "@/components/icons";
import { Indicador as IndicadorPadrao, Painel, type CorIndicador } from "@/components/pagina";
import type { DiaCana, FrenteCana, MesCana } from "@/lib/db-painel";
import { fmtDateBR } from "@/lib/format";

type Icone = (p: IconProps) => ReactNode;

export const nf = (n: number, c = 2) => n.toLocaleString("pt-BR", { minimumFractionDigits: c, maximumFractionDigits: c });
export const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

/** 312 mil, 1,25 mi — para rótulos de gráfico. */
export function compacto(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e6) return `${nf(n / 1e6, 2)} mi`;
  if (a >= 1e3) return `${nf(n / 1e3, a >= 1e5 ? 0 : 1)} mil`;
  return nf(n, 0);
}

/** Teto "redondo" para a escala de um gráfico (1; 1,5; 2; 3; 4; 5; 6; 8; 10 × potência de 10). */
function tetoRedondo(v: number): number {
  const alvo = Math.max(v, 1) * 1.04;
  const mag = 10 ** Math.floor(Math.log10(alvo));
  for (const f of [1, 1.5, 2, 3, 4, 5, 6, 8, 10]) if (f * mag >= alvo) return f * mag;
  return 10 * mag;
}

// azul, verde, dourado, laranja, roxo, verde-água, tijolo, aço — o dourado fica ao lado do verde para contrastar
export const PALETA_FRENTES = ["#3B5BA9", "#2D8A5A", "#D9A21B", "#D77B38", "#8E6BBF", "#3AA6A6", "#B5504A", "#7C93BD"];
export function coresDasFrentes(frentes: string[]): Record<string, string> {
  return Object.fromEntries(frentes.map((f, i) => [f, PALETA_FRENTES[i % PALETA_FRENTES.length]]));
}

const VERDE = "#2D8A5A";
const DOURADO = "#D9A21B";
const VERMELHO = "#C94A37";
/** Atingimento da meta: verde a partir de 100%, dourado a partir de 80%, vermelho abaixo. */
export const corAtingimento = (p: number) => (p >= 1 ? VERDE : p >= 0.8 ? DOURADO : VERMELHO);

// ---------------------------------------------------------------------------
// Estrutura
// ---------------------------------------------------------------------------

export function Secao({ titulo, subtitulo, children }: { titulo: string; subtitulo?: string; children: ReactNode }) {
  return (
    <section>
      <div className="mb-4 flex items-baseline gap-3 border-b border-line pb-2">
        <h2 className="font-display text-[20px] font-semibold leading-tight text-ink">{titulo}</h2>
        {subtitulo && <span className="text-[12px] text-muted">{subtitulo}</span>}
      </div>
      {children}
    </section>
  );
}

/** Caixa de um bloco do painel: um Painel do padrão, com o ícone antes do título e a ligação para a tela à direita. */
export function Caixa({
  icone: I,
  titulo,
  subtitulo,
  ligacao,
  rotuloLigacao,
  children,
  className = "",
}: {
  icone?: Icone;
  titulo: string;
  subtitulo?: string;
  ligacao?: string;
  rotuloLigacao?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Painel
      className={className}
      titulo={titulo}
      icone={I && <I size={17} />}
      subtitulo={subtitulo}
      acoes={
        ligacao ? (
          <Link href={ligacao} className="text-[12px] font-medium text-navy-900 hover:underline">
            {rotuloLigacao ?? "Ver"}
          </Link>
        ) : undefined
      }
    >
      {children}
    </Painel>
  );
}

export function Barra({ valor, cor = VERDE, altura = 4 }: { valor: number; cor?: string; altura?: number }) {
  return (
    <div className="w-full rounded-full bg-line" style={{ height: altura }}>
      <div className="rounded-full" style={{ height: altura, width: `${Math.max(0, Math.min(1, valor)) * 100}%`, background: cor }} />
    </div>
  );
}

/**
 * Indicador com ícone (o Indicador do padrão das telas); com `meta`, mostra a barra e o % atingido.
 * `cor` é a cor de significado do filete e do número (azul quando não informada).
 */
export function Indicador({
  icone: I,
  rotulo,
  valor,
  unidade,
  apoio,
  meta,
  real,
  cor = "azul",
}: {
  icone: Icone;
  rotulo: string;
  valor: string;
  unidade?: string;
  apoio?: ReactNode;
  meta?: number;
  real?: number;
  cor?: CorIndicador;
}) {
  const p = meta && meta > 0 && real !== undefined ? real / meta : null;
  return (
    <IndicadorPadrao cor={cor} icone={<I size={18} />} rotulo={rotulo} valor={valor} unidade={unidade} title={rotulo}>
      {p !== null && (
        <div className="mt-3 space-y-1">
          <Barra valor={p} cor={corAtingimento(p)} />
          <div className="flex justify-between text-[11px] text-muted">
            <span style={{ color: corAtingimento(p) }} className="font-medium">
              {Math.round(p * 100).toLocaleString("pt-BR")}% da meta
            </span>
            <span className="tabular">{nf(meta!)} t</span>
          </div>
        </div>
      )}
      {apoio && <div className="mt-2 text-[11.5px] leading-snug text-muted">{apoio}</div>}
    </IndicadorPadrao>
  );
}

export function Numero({ rotulo, valor, apoio, tom }: { rotulo: string; valor: string; apoio?: string; tom?: "bom" | "ruim" }) {
  return (
    <div className="min-w-0">
      <div className="text-[12px] text-muted">{rotulo}</div>
      <div className={`tabular font-display text-[23px] font-semibold leading-tight ${tom === "bom" ? "text-good-600" : tom === "ruim" ? "text-alert-600" : "text-ink"}`}>{valor}</div>
      {apoio && <div className="mt-0.5 text-[11.5px] text-muted">{apoio}</div>}
    </div>
  );
}

export function Vazio({ texto }: { texto: string }) {
  return <p className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-[12.5px] text-muted">{texto}</p>;
}

export function Legenda({ itens }: { itens: { rotulo: string; cor: string; tracejado?: boolean }[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[11.5px] text-muted">
      {itens.map((i) => (
        <span key={i.rotulo} className="flex items-center gap-1.5">
          {i.tracejado ? (
            <span className="inline-block w-4 border-t-2 border-dashed" style={{ borderColor: i.cor }} />
          ) : (
            <span className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: i.cor }} />
          )}
          {i.rotulo}
        </span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Gráficos (SVG, sem JavaScript no navegador; o detalhe aparece ao passar o mouse)
// ---------------------------------------------------------------------------

/** Entrada de cana por dia, empilhada por frente; a linha tracejada é a meta diária somada. */
export function GraficoDiario({ dias, frentes, cores }: { dias: DiaCana[]; frentes: string[]; cores: Record<string, string> }) {
  const W = 700;
  const H = 240;
  const m = { l: 46, r: 8, t: 12, b: 26 };
  const n = dias.length;
  const teto = tetoRedondo(Math.max(1, ...dias.map((d) => Math.max(d.total, d.metaT))));
  const y = (v: number) => m.t + (1 - v / teto) * (H - m.t - m.b);
  const slot = (W - m.l - m.r) / Math.max(n, 1);
  const barra = slot * 0.7;
  const x = (i: number) => m.l + i * slot + (slot - barra) / 2;
  const centro = (i: number) => m.l + i * slot + slot / 2;

  // linha da meta, quebrada onde não há meta
  const trechos: string[] = [];
  let atual = "";
  dias.forEach((d, i) => {
    if (d.metaT > 0) atual += `${atual ? "L" : "M"}${centro(i).toFixed(1)},${y(d.metaT).toFixed(1)} `;
    else if (atual) {
      trechos.push(atual);
      atual = "";
    }
  });
  if (atual) trechos.push(atual);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full text-ink" role="img" aria-label="Entrada de cana por dia nos últimos 30 dias, por frente">
      {[0, 0.5, 1].map((f) => (
        <g key={f}>
          <line x1={m.l} x2={W - m.r} y1={y(teto * f)} y2={y(teto * f)} stroke="currentColor" strokeOpacity={f === 0 ? 0.25 : 0.09} />
          <text x={m.l - 6} y={y(teto * f) + 3} fontSize="9.5" textAnchor="end" fill="currentColor" opacity="0.55">
            {f === 0 ? "0" : compacto(teto * f)}
          </text>
        </g>
      ))}
      {dias.map((d, i) => {
        let base = 0;
        const detalhe = frentes
          .filter((f) => (d.porFrente[f] ?? 0) > 0)
          .map((f) => `${f}: ${nf(d.porFrente[f])} t`)
          .join("\n");
        const ultimo = i === n - 1;
        return (
          <g key={d.dt}>
            <title>{`${fmtDateBR(d.dt)} · ${d.total > 0 ? `${nf(d.total)} t` : "sem entrega"}${d.metaT > 0 ? `\nMeta: ${nf(d.metaT)} t` : ""}${detalhe ? `\n${detalhe}` : ""}`}</title>
            {ultimo && <rect x={m.l + i * slot} y={m.t} width={slot} height={H - m.t - m.b} fill="currentColor" opacity="0.05" />}
            {d.total === 0 ? (
              <rect x={x(i)} y={y(0) - 1.5} width={barra} height={1.5} fill="currentColor" opacity="0.25" />
            ) : (
              frentes.map((f) => {
                const v = d.porFrente[f] ?? 0;
                if (v <= 0) return null;
                const alto = (v / teto) * (H - m.t - m.b);
                const topo = y(base) - alto;
                base += v;
                return <rect key={f} x={x(i)} y={topo} width={barra} height={Math.max(alto, 0.8)} fill={cores[f]} rx="0.8" />;
              })
            )}
            {(i % 5 === 0 || ultimo) && (
              <text x={centro(i)} y={H - 8} fontSize="9.5" textAnchor="middle" fill="currentColor" opacity={ultimo ? 0.85 : 0.5} fontWeight={ultimo ? 600 : 400}>
                {fmtDateBR(d.dt).slice(0, 5)}
              </text>
            )}
          </g>
        );
      })}
      {trechos.map((t, k) => (
        <path key={k} d={t} fill="none" stroke="#D77B38" strokeWidth="1.5" strokeDasharray="4 3" />
      ))}
    </svg>
  );
}

/** Moagem por mês na safra; o traço laranja marca a meta do período; o mês corrente (parcial) fica em verde. */
export function GraficoMensal({ meses }: { meses: MesCana[] }) {
  const W = 460;
  const H = 240;
  const m = { l: 8, r: 8, t: 24, b: 44 };
  const n = Math.max(meses.length, 1);
  const teto = tetoRedondo(Math.max(1, ...meses.map((x) => Math.max(x.ton, x.metaT ?? 0))));
  const y = (v: number) => m.t + (1 - v / teto) * (H - m.t - m.b);
  const slot = (W - m.l - m.r) / n;
  const barra = Math.min(slot * 0.62, 48);
  const centro = (i: number) => m.l + i * slot + slot / 2;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full text-ink" role="img" aria-label="Moagem mensal da safra">
      <line x1={m.l} x2={W - m.r} y1={y(0)} y2={y(0)} stroke="currentColor" strokeOpacity="0.25" />
      {[0.5, 1].map((f) => (
        <line key={f} x1={m.l} x2={W - m.r} y1={y(teto * f)} y2={y(teto * f)} stroke="currentColor" strokeOpacity="0.09" />
      ))}
      {meses.map((r, i) => {
        const alto = (r.ton / teto) * (H - m.t - m.b);
        const corrente = i === meses.length - 1;
        return (
          <g key={r.mes}>
            <title>{`${r.rotulo} · ${nf(r.ton)} t\n${r.dias} dias com entrega · média ${nf(r.mediaDiaT)} t/dia${r.metaT ? `\nMeta${r.parcial ? " até a última data" : ""}: ${nf(r.metaT)} t` : ""}${r.parcial ? "\nMês em andamento" : ""}`}</title>
            <rect x={centro(i) - barra / 2} y={y(r.ton)} width={barra} height={Math.max(alto, r.ton > 0 ? 1 : 0)} rx="2" fill={corrente ? VERDE : "#3B5BA9"} opacity={r.parcial ? 0.8 : 1} />
            <text x={centro(i)} y={Math.min(y(r.ton), r.metaT !== null ? y(r.metaT) : y(r.ton)) - 6} fontSize="10" textAnchor="middle" fill="currentColor" fontWeight="600" opacity="0.85">
              {compacto(r.ton)}
            </text>
            {r.metaT !== null && <line x1={centro(i) - barra / 2 - 4} x2={centro(i) + barra / 2 + 4} y1={y(r.metaT)} y2={y(r.metaT)} stroke="#D77B38" strokeWidth="2" strokeLinecap="round" />}
            <text x={centro(i)} y={H - 24} fontSize="10" textAnchor="middle" fill="currentColor" opacity="0.8">
              {r.rotulo}
            </text>
            <text x={centro(i)} y={H - 10} fontSize="8.5" textAnchor="middle" fill="currentColor" opacity="0.45">
              {compacto(r.mediaDiaT)}/dia
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function MiniSerie({ valores, cor }: { valores: number[]; cor: string }) {
  const W = 240;
  const H = 34;
  const n = valores.length;
  const max = Math.max(1, ...valores);
  const bw = W / Math.max(n, 1);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full text-ink" role="img" aria-label="Moagem dos últimos 14 dias">
      {valores.map((v, i) => {
        const alto = v > 0 ? Math.max(2, (v / max) * (H - 3)) : 1.2;
        return (
          <rect key={i} x={i * bw + 1} y={H - alto} width={Math.max(bw - 2, 1)} height={alto} rx="1" fill={v > 0 ? cor : "currentColor"} opacity={v > 0 ? (i === n - 1 ? 1 : 0.6) : 0.2}>
            <title>{`${nf(v)} t`}</title>
          </rect>
        );
      })}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Frente
// ---------------------------------------------------------------------------

function LinhaMeta({ rotulo, real, meta }: { rotulo: string; real: number; meta: number }) {
  const p = meta > 0 ? real / meta : null;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-[12px]">
        <span className="w-[38px] flex-shrink-0 text-muted">{rotulo}</span>
        <span className="tabular flex-1 text-right font-medium text-ink">{real > 0 ? `${nf(real)} t` : "—"}</span>
        <span className="w-[42px] flex-shrink-0 text-right text-[11px] font-medium" style={{ color: p === null ? undefined : corAtingimento(p) }}>
          {p === null ? "" : `${Math.round(p * 100).toLocaleString("pt-BR")}%`}
        </span>
      </div>
      {p !== null && (
        <div className="mt-1 pl-[38px] pr-[42px]">
          <Barra valor={p} cor={corAtingimento(p)} altura={3} />
        </div>
      )}
    </div>
  );
}

export function CartaoFrente({ f, cor }: { f: FrenteCana; cor: string }) {
  return (
    <div className="flex flex-col rounded-xl2 border border-line p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <span className="inline-block h-2.5 w-2.5 flex-shrink-0 rounded-[3px]" style={{ background: cor }} />
          <span className="truncate text-[13.5px] font-semibold text-ink">{f.frente}</span>
        </span>
        <span className="flex-shrink-0 rounded-full bg-surface px-2 py-0.5 text-[11px] text-muted">{Math.round(f.participacao * 100).toLocaleString("pt-BR")}% da safra</span>
      </div>
      <div className="space-y-2.5">
        <LinhaMeta rotulo="Dia" real={f.diaT} meta={f.metaDiaT} />
        <LinhaMeta rotulo="Mês" real={f.mesT} meta={f.metaMesT} />
        <LinhaMeta rotulo="Safra" real={f.safraT} meta={f.metaSafraT} />
      </div>
      <div className="mt-4 border-t border-line pt-3">
        <div className="mb-1 text-[10.5px] text-muted">Últimos 14 dias</div>
        <MiniSerie valores={f.serie} cor={cor} />
        <div className="mt-2.5 text-[11.5px] leading-snug text-muted">
          <div>
            {f.diasEfetivos} dias com entrega · média <span className="tabular text-ink">{nf(f.mediaDiaEfetivoT)} t</span>/dia
          </div>
          {f.melhorDia && (
            <div>
              Melhor dia <span className="tabular text-ink">{nf(f.melhorDia.ton)} t</span> em {fmtDateBR(f.melhorDia.dt).slice(0, 5)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
