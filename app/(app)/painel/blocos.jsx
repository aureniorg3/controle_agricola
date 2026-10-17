import Link from "next/link";

import { JanelaInfo } from "@/components/janela";
import { Indicador as IndicadorPadrao, Painel } from "@/components/pagina";

import { fmtDateBR } from "@/lib/format";
import { nomeEmpresa } from "@/lib/insumos-saldo";
import { addDays, endOfMonth, metaNoIntervalo } from "@/lib/period";
import { BotaoExportar } from "@/app/(app)/acompanhamentos/os-agricola/comum";

export const nf = (n, c = 2) => n.toLocaleString("pt-BR", { minimumFractionDigits: c, maximumFractionDigits: c });
export const brl = (n) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

/** 312 mil, 1,25 mi — para rótulos de gráfico. */
export function compacto(n) {
  const a = Math.abs(n);
  if (a >= 1e6) return `${nf(n / 1e6, 2)} mi`;
  if (a >= 1e3) return `${nf(n / 1e3, a >= 1e5 ? 0 : 1)} mil`;
  return nf(n, 0);
}

/** Teto "redondo" para a escala de um gráfico (1; 1,5; 2; 3; 4; 5; 6; 8; 10 × potência de 10). */
function tetoRedondo(v) {
  const alvo = Math.max(v, 1) * 1.04;
  const mag = 10 ** Math.floor(Math.log10(alvo));
  for (const f of [1, 1.5, 2, 3, 4, 5, 6, 8, 10]) if (f * mag >= alvo) return f * mag;
  return 10 * mag;
}

// azul, verde, dourado, laranja, roxo, verde-água, tijolo, aço — o dourado fica ao lado do verde para contrastar
export const PALETA_FRENTES = ["#3B5BA9", "#2D8A5A", "#D9A21B", "#D77B38", "#8E6BBF", "#3AA6A6", "#B5504A", "#7C93BD"];
export function coresDasFrentes(frentes) {
  return Object.fromEntries(frentes.map((f, i) => [f, PALETA_FRENTES[i % PALETA_FRENTES.length]]));
}

const VERDE = "#2D8A5A";
const DOURADO = "#D9A21B";
const VERMELHO = "#C94A37";
/** Atingimento da meta: verde a partir de 100%, dourado a partir de 80%, vermelho abaixo. */
export const corAtingimento = (p) => (p >= 1 ? VERDE : p >= 0.8 ? DOURADO : VERMELHO);

// ---------------------------------------------------------------------------
// Estrutura
// ---------------------------------------------------------------------------

export function Secao({ titulo, subtitulo, children }) {
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
export function Caixa({ icone: I, titulo, subtitulo, ligacao, rotuloLigacao, children, className = "" }) {
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

export function Barra({ valor, cor = VERDE, altura = 4 }) {
  return (
    <div className="w-full rounded-full bg-line" style={{ height: altura }}>
      <div className="rounded-full" style={{ height: altura, width: `${Math.max(0, Math.min(1, valor)) * 100}%`, background: cor }} />
    </div>
  );
}

/** Cartão que abre a janela do detalhe (o mesmo das telas com janelas nos cards, como Fazenda e Talhões). */
const CLASSE_BOTAO_CARTAO = "min-w-0 rounded-xl2 text-left transition hover:-translate-y-px focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-500";

/**
 * Indicador com ícone (o Indicador do padrão das telas); com `meta`, mostra a barra e o % atingido.
 * `cor` é a cor de significado do filete e do número (azul quando não informada). Com `onClick` o cartão vira botão
 * (abre a janela com o detalhe do número), com foco visível e "Ver o detalhe" ao passar o mouse.
 */
export function Indicador({ icone: I, rotulo, valor, unidade, apoio, meta, real, cor = "azul", onClick }) {
  const p = meta && meta > 0 && real !== undefined ? real / meta : null;
  const cartao = (
    <IndicadorPadrao
      cor={cor}
      icone={<I size={18} />}
      rotulo={rotulo}
      valor={valor}
      unidade={unidade}
      title={onClick ? undefined : rotulo}
      className={onClick ? "h-full" : ""}
    >
      {p !== null && (
        <div className="mt-3 space-y-1">
          <Barra valor={p} cor={corAtingimento(p)} />
          <div className="flex justify-between text-[11px] text-muted">
            <span style={{ color: corAtingimento(p) }} className="font-medium">
              {Math.round(p * 100).toLocaleString("pt-BR")}% da meta
            </span>
            <span className="tabular">{nf(meta)} t</span>
          </div>
        </div>
      )}
      {apoio && <div className="mt-2 text-[11.5px] leading-snug text-muted">{apoio}</div>}
    </IndicadorPadrao>
  );
  if (!onClick) return cartao;
  return (
    <button type="button" onClick={onClick} title={`Ver o detalhe · ${rotulo}`} className={CLASSE_BOTAO_CARTAO}>
      {cartao}
    </button>
  );
}

/** Área clicável dentro de uma caixa (número ou bloco que abre a janela): a margem negativa mantém o lugar de antes. */
export const CLASSE_BOTAO_AREA =
  "-m-1.5 rounded-lg p-1.5 text-left transition hover:bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-500";

/** Número de uma caixa; com `onClick` vira botão (abre a janela com o detalhe), com foco visível e "Ver o detalhe". */
export function Numero({ rotulo, valor, apoio, tom, onClick }) {
  const conteudo = (
    <>
      <div className="text-[12px] text-muted">{rotulo}</div>
      <div
        className={`tabular font-display text-[23px] font-semibold leading-tight ${tom === "bom" ? "text-good-600" : tom === "ruim" ? "text-alert-600" : "text-ink"}`}
      >
        {valor}
      </div>
      {apoio && <div className="mt-0.5 text-[11.5px] text-muted">{apoio}</div>}
    </>
  );
  if (!onClick) return <div className="min-w-0">{conteudo}</div>;
  return (
    <button type="button" onClick={onClick} title={`Ver o detalhe · ${rotulo}`} className={`block min-w-0 ${CLASSE_BOTAO_AREA}`}>
      {conteudo}
    </button>
  );
}

export function Vazio({ texto }) {
  return <p className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-[12.5px] text-muted">{texto}</p>;
}

export function Legenda({ itens }) {
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
// Gráficos (SVG puro; o detalhe aparece ao passar o mouse)
// ---------------------------------------------------------------------------

/** Entrada de cana por dia, empilhada por frente; a linha tracejada é a meta diária somada. */
export function GraficoDiario({ dias, frentes, cores }) {
  const W = 700;
  const H = 240;
  const m = { l: 46, r: 8, t: 12, b: 26 };
  const n = dias.length;
  const teto = tetoRedondo(Math.max(1, ...dias.map((d) => Math.max(d.total, d.metaT))));
  const y = (v) => m.t + (1 - v / teto) * (H - m.t - m.b);
  const slot = (W - m.l - m.r) / Math.max(n, 1);
  const barra = slot * 0.7;
  const x = (i) => m.l + i * slot + (slot - barra) / 2;
  const centro = (i) => m.l + i * slot + slot / 2;

  // linha da meta, quebrada onde não há meta
  const trechos = [];
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
              <text
                x={centro(i)}
                y={H - 8}
                fontSize="9.5"
                textAnchor="middle"
                fill="currentColor"
                opacity={ultimo ? 0.85 : 0.5}
                fontWeight={ultimo ? 600 : 400}
              >
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
export function GraficoMensal({ meses }) {
  const W = 460;
  const H = 240;
  const m = { l: 8, r: 8, t: 24, b: 44 };
  const n = Math.max(meses.length, 1);
  const teto = tetoRedondo(Math.max(1, ...meses.map((x) => Math.max(x.ton, x.metaT ?? 0))));
  const y = (v) => m.t + (1 - v / teto) * (H - m.t - m.b);
  const slot = (W - m.l - m.r) / n;
  const barra = Math.min(slot * 0.62, 48);
  const centro = (i) => m.l + i * slot + slot / 2;
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
            <rect
              x={centro(i) - barra / 2}
              y={y(r.ton)}
              width={barra}
              height={Math.max(alto, r.ton > 0 ? 1 : 0)}
              rx="2"
              fill={corrente ? VERDE : "#3B5BA9"}
              opacity={r.parcial ? 0.8 : 1}
            />
            <text
              x={centro(i)}
              y={Math.min(y(r.ton), r.metaT !== null ? y(r.metaT) : y(r.ton)) - 6}
              fontSize="10"
              textAnchor="middle"
              fill="currentColor"
              fontWeight="600"
              opacity="0.85"
            >
              {compacto(r.ton)}
            </text>
            {r.metaT !== null && (
              <line
                x1={centro(i) - barra / 2 - 4}
                x2={centro(i) + barra / 2 + 4}
                y1={y(r.metaT)}
                y2={y(r.metaT)}
                stroke="#D77B38"
                strokeWidth="2"
                strokeLinecap="round"
              />
            )}
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

export function MiniSerie({ valores, cor }) {
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
          <rect
            key={i}
            x={i * bw + 1}
            y={H - alto}
            width={Math.max(bw - 2, 1)}
            height={alto}
            rx="1"
            fill={v > 0 ? cor : "currentColor"}
            opacity={v > 0 ? (i === n - 1 ? 1 : 0.6) : 0.2}
          >
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

function LinhaMeta({ rotulo, real, meta }) {
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

/** Cartão da frente; com `onClick` vira botão e abre a janela com o detalhe da frente. */
export function CartaoFrente({ f, cor, onClick }) {
  const classe = "flex flex-col rounded-xl2 border border-line p-4";
  const conteudo = (
    <>
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <span className="inline-block h-2.5 w-2.5 flex-shrink-0 rounded-[3px]" style={{ background: cor }} />
          <span className="truncate text-[13.5px] font-semibold text-ink">{f.frente}</span>
        </span>
        <span className="flex-shrink-0 rounded-full bg-surface px-2 py-0.5 text-[11px] text-muted">
          {Math.round(f.participacao * 100).toLocaleString("pt-BR")}% da safra
        </span>
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
    </>
  );
  if (!onClick) return <div className={classe}>{conteudo}</div>;
  return (
    <button type="button" onClick={onClick} title={`Ver o detalhe da frente ${f.frente}`} className={`${classe} w-full ${CLASSE_BOTAO_CARTAO}`}>
      {conteudo}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Janelas das caixas de moagem e dos cartões das frentes: o detalhe que forma cada número, com os mesmos dados da
// caixa (o total da janela é o número dela). Clicar na frente abre a janela da frente; no mês, o dia a dia do mês.
// As janelas das caixas de safra e de insumos ficam mais abaixo.
// ---------------------------------------------------------------------------

/** Telas de origem (as ligações do rodapé só aparecem para quem pode abri-las). */
export const ORDENS_DE_CORTE = "/acompanhamentos/ordens-de-corte";
export const METAS_FRENTES = "/acompanhamentos/colheita/metas";

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const rotuloMes = (mes) => `${MESES[Number(mes.slice(5, 7)) - 1]}/${mes.slice(2, 4)}`;
const SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const diaDaSemana = (iso) => SEMANA[new Date(`${iso}T12:00:00Z`).getUTCDay()];
const dm = (iso) => fmtDateBR(iso).slice(0, 5);
/** o que vai para a planilha: tonelada em 2 casas (como na tela), percentual em 1 */
const r2 = (n) => (n === null || n === undefined ? null : Math.round(n * 100) / 100);
const r1 = (n) => (n === null || n === undefined ? null : Math.round(n * 10) / 10);
const somaDe = (linhas, campo) => linhas.reduce((s, l) => s + l[campo], 0);
/** % da meta atingido; sem meta, nada */
const atingido = (real, meta) => (meta > 0 ? (real / meta) * 100 : null);
const intervalo = (inicio, fim) => (inicio === fim ? fmtDateBR(inicio) : `de ${fmtDateBR(inicio)} a ${fmtDateBR(fim)}`);
/** nome da planilha exportada: sem os caracteres que o arquivo e a aba do Excel não aceitam */
const nomePlanilha = (s) => s.replace(/[\\/:*?"<>|[\]]/g, "-");

/**
 * Contas das janelas sobre `cana.detalhe` (lib/db-painel.js): a entrada de cada dia por frente e a meta de qualquer
 * período com as mesmas regras das caixas (a meta da frente só conta a partir da primeira entrada dela e nos dias de
 * atividade cadastrados em Metas).
 */
export function detalheMoagem(cana) {
  const det = cana.detalhe;
  const frentesComMeta = Array.from(new Set(det.metas.map((m) => m.frente)));
  const metaNoPeriodo = (frente, inicio, fim) => {
    const p = det.primeira[frente];
    if (!p) return 0;
    const i = inicio > p ? inicio : p;
    return i > fim ? 0 : metaNoIntervalo(det.metas, frente, { inicio: i, fim });
  };
  const metaTotal = (inicio, fim) => frentesComMeta.reduce((s, f) => s + metaNoPeriodo(f, inicio, fim), 0);
  const porData = new Map(det.dias.map((d) => [d.dt, d]));
  /** toneladas do dia, de uma frente ou de todas */
  const tonDoDia = (d, frente) => (!d ? 0 : frente ? (d.porFrente[frente] ?? 0) : Object.values(d.porFrente).reduce((s, t) => s + t, 0));
  const diasEntre = (inicio, fim) => det.dias.filter((d) => d.dt >= inicio && d.dt <= fim);

  /** Por frente no período: toneladas, dias com entrega e meta (a frente com meta e sem entrega também aparece). */
  function porFrente(inicio, fim) {
    const m = new Map();
    for (const d of diasEntre(inicio, fim)) {
      for (const [frente, t] of Object.entries(d.porFrente)) {
        const x = m.get(frente) ?? { frente, ton: 0, dias: 0 };
        x.ton += t;
        if (t > 0) x.dias += 1;
        m.set(frente, x);
      }
    }
    for (const frente of frentesComMeta) if (!m.has(frente)) m.set(frente, { frente, ton: 0, dias: 0 });
    return Array.from(m.values())
      .map((x) => ({ ...x, meta: metaNoPeriodo(x.frente, inicio, fim) }))
      .filter((x) => x.ton !== 0 || x.meta > 0)
      .sort((a, b) => b.ton - a.ton || a.frente.localeCompare(b.frente));
  }

  /** Mês a mês no período (cada mês recortado por ele), de uma frente ou de todas; os meses do começo sem entrada nem meta ficam de fora. */
  function porMes(inicio, fim, frente) {
    const linhas = [];
    for (let mes = inicio.slice(0, 7); mes <= fim.slice(0, 7); ) {
      const fimMes = endOfMonth(`${mes}-01`);
      const a = `${mes}-01` < inicio ? inicio : `${mes}-01`;
      const b = fimMes < fim ? fimMes : fim;
      const ds = diasEntre(a, b);
      linhas.push({
        mes,
        rotulo: rotuloMes(mes),
        inicio: a,
        fim: b,
        ton: ds.reduce((s, d) => s + tonDoDia(d, frente), 0),
        dias: ds.filter((d) => tonDoDia(d, frente) > 0).length,
        meta: frente ? metaNoPeriodo(frente, a, b) : metaTotal(a, b),
      });
      mes = addDays(fimMes, 1).slice(0, 7);
    }
    const primeiro = linhas.findIndex((l) => l.ton !== 0 || l.meta > 0);
    return primeiro < 0 ? [] : linhas.slice(primeiro);
  }

  /** Cada dia do período, com ou sem entrega: toneladas por frente, total e meta. */
  function diaADia(inicio, fim) {
    const linhas = [];
    for (let dt = inicio; dt <= fim; dt = addDays(dt, 1)) {
      const d = porData.get(dt);
      linhas.push({ dt, porFrente: d?.porFrente ?? {}, ton: tonDoDia(d), meta: metaTotal(dt, dt) });
    }
    return linhas;
  }

  return {
    ultima: cana.ultimaData,
    inicio: det.inicio,
    inicioMes: det.inicioMes,
    dias: det.dias,
    ordensDia: det.ordensDia,
    /** último dia com entrega antes da última data, por frente (o "dia anterior" da caixa), ou null */
    anterior: det.anterior ?? null,
    tonDoDia,
    diasEntre,
    metaNoPeriodo,
    porFrente,
    porMes,
    diaADia,
  };
}

/** Valor na janela: "t" (2 casas: t, ha, TCH, R$), "int" (contagem), "pct" (inteiro, como nas caixas), "cod" (à direita) ou texto. */
function formatar(num, v) {
  if (v === null || v === undefined || v === "" || (typeof v === "number" && !Number.isFinite(v))) return "—";
  if (num === "t") return nf(v);
  if (num === "int") return v.toLocaleString("pt-BR");
  if (num === "pct") return `${Math.round(v).toLocaleString("pt-BR")}%`;
  return v;
}

/**
 * Tabela das janelas: cabeçalho, números à direita e linha de total (fica no fim ao ordenar pelo título da coluna).
 * Coluna: { rotulo, valor(l) (o que vai para a planilha), num ("t", "int", "pct", "cod" = à direita), exibir(l) (o que
 * aparece, se diferente do valor), classe(l), zeroVazio (zero aparece como "—"), total }. `rotuloTotal` troca o "Total".
 */
function TabelaJanela({ colunas, linhas, chave, vazio = "Nada no período.", rotuloTotal = "Total" }) {
  const inicioTotal = colunas.findIndex((c) => c.total !== undefined);
  const texto = (c, v) => formatar(c.num, c.zeroVazio && v === 0 ? null : v);
  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="whitespace-nowrap border-b border-line bg-surface text-left text-muted">
            {colunas.map((c) => (
              <th key={c.rotulo} className={`px-3 py-2 font-medium ${c.num ? "text-right" : ""}`}>
                {c.rotulo}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => (
            <tr key={chave(l)} className="border-t border-line/60 hover:bg-surface/60">
              {colunas.map((c) => (
                <td key={c.rotulo} className={`px-3 py-1.5 ${c.num ? "whitespace-nowrap text-right tabular" : ""} ${c.classe?.(l) ?? "text-ink"}`}>
                  {c.exibir ? c.exibir(l) : texto(c, c.valor(l))}
                </td>
              ))}
            </tr>
          ))}
          {linhas.length === 0 && (
            <tr>
              <td colSpan={colunas.length} className="px-4 py-8 text-center text-muted">
                {vazio}
              </td>
            </tr>
          )}
          {linhas.length > 0 && inicioTotal > 0 && (
            <tr className="bg-navy-900 font-semibold text-white">
              <td colSpan={inicioTotal} className="px-3 py-2">
                {rotuloTotal}
              </td>
              {colunas.slice(inicioTotal).map((c) => (
                <td key={c.rotulo} className={`px-3 py-2 ${c.num ? "whitespace-nowrap text-right tabular" : ""}`}>
                  {c.total === undefined ? "" : texto(c, c.total)}
                </td>
              ))}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function NotaJanela({ children }) {
  return <p className="mb-3 text-[12px] leading-relaxed text-muted">{children}</p>;
}

function SecaoJanela({ titulo, acoes, children }) {
  return (
    <div className="mt-5">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="text-[12.5px] font-medium text-ink">{titulo}</div>
        {acoes}
      </div>
      {children}
    </div>
  );
}

/** Texto clicável de uma linha da janela (abre o detalhe da frente ou do mês). */
function BotaoLink({ onClick, title, children }) {
  return (
    <button type="button" onClick={onClick} title={title} className="text-left font-medium text-[#2E5FA8] hover:underline">
      {children}
    </button>
  );
}

/** % da meta com a cor do atingimento (a mesma das barras das caixas). */
function PctMeta({ v }) {
  if (v === null) return "—";
  return (
    <span className="font-medium" style={{ color: corAtingimento(v / 100) }}>
      {Math.round(v).toLocaleString("pt-BR")}%
    </span>
  );
}

function Marca({ children }) {
  return <span className="ml-1.5 whitespace-nowrap rounded-full bg-surface px-1.5 py-0.5 text-[10.5px] text-muted">{children}</span>;
}

/** Data com o dia da semana (e, se houver, a marca do dia). */
function DataDia({ dt, marca }) {
  return (
    <span className="whitespace-nowrap">
      {fmtDateBR(dt)} <span className="text-[11px] text-muted">{diaDaSemana(dt)}</span>
      {marca && <Marca>{marca}</Marca>}
    </span>
  );
}

// colunas comuns; sem `total` informado, a coluna fica sem total (tabela sem linha de total)
const colFrente = (base) => ({
  rotulo: "Frente",
  valor: (l) => l.frente,
  exibir: (l) => (
    <BotaoLink onClick={() => base.abrir({ tipo: "frente", frente: l.frente })} title={`Ver o detalhe da frente ${l.frente}`}>
      {l.frente}
    </BotaoLink>
  ),
});
const colMes = (base) => ({
  rotulo: "Mês",
  valor: (l) => l.rotulo,
  exibir: (l) => (
    <BotaoLink onClick={() => base.abrir({ tipo: "periodo", inicio: l.inicio, fim: l.fim })} title={`Ver o dia a dia de ${l.rotulo}`}>
      {l.rotulo}
    </BotaoLink>
  ),
});
const colTon = (rotulo, total) => ({ rotulo, num: "t", valor: (l) => r2(l.ton), total });
const colMeta = (total) => ({ rotulo: "Meta (t)", num: "t", valor: (l) => r2(l.meta), total, zeroVazio: true, classe: () => "text-muted" });
const colPctMeta = (ton, meta) => ({
  rotulo: "% da meta",
  num: "pct",
  valor: (l) => r1(atingido(l.ton, l.meta)),
  exibir: (l) => <PctMeta v={atingido(l.ton, l.meta)} />,
  total: meta === undefined ? undefined : atingido(ton, meta),
});
const colDias = (total) => ({ rotulo: "Dias com entrega", num: "int", valor: (l) => l.dias, total });
const colMedia = (ton, dias) => ({
  rotulo: "Média (t/dia)",
  num: "t",
  valor: (l) => (l.dias > 0 ? r2(l.ton / l.dias) : null),
  total: dias === undefined ? undefined : dias > 0 ? ton / dias : null,
  classe: () => "text-muted",
});
const colParticipacao = (ton) => ({
  rotulo: "Participação",
  num: "pct",
  valor: (l) => r1(ton > 0 ? (l.ton / ton) * 100 : null),
  total: ton > 0 ? 100 : null,
  classe: () => "text-muted",
});
/** Toneladas de cada frente por dia (colunas do dia a dia), com o total da frente nas linhas da tabela. */
const colsFrentesDoDia = (frentes, linhas) =>
  frentes.map((f) => ({
    rotulo: `${f} (t)`,
    num: "t",
    valor: (d) => r2(d.porFrente[f] ?? 0),
    total: linhas.reduce((s, d) => s + (d.porFrente[f] ?? 0), 0),
    zeroVazio: true,
    classe: () => "text-muted",
  }));
const colsOrdens = (ordens, comFrente) => [
  { rotulo: "Ordem", num: "cod", valor: (o) => o.ord, classe: () => "font-medium text-ink" },
  ...(comFrente ? [{ rotulo: "Frente", valor: (o) => o.frente }] : []),
  { rotulo: "Fazenda", valor: (o) => (o.fazNm ? `${o.faz} · ${o.fazNm}` : o.faz) },
  { rotulo: "Talhões", valor: (o) => o.talhoes, classe: () => "text-muted" },
  { rotulo: "Viagens", num: "int", valor: (o) => o.viagens, total: somaDe(ordens, "viagens") },
  { rotulo: "Moagem (t)", num: "t", valor: (o) => r2(o.ton), total: somaDe(ordens, "ton") },
];

/** Botão de exportar uma tabela da janela (só o rótulo e o valor de cada coluna); sem linhas, nada. */
const exportarTabela = (base, { nome, colunas, linhas }) =>
  linhas.length > 0 && (
    <BotaoExportar
      nome={nomePlanilha(`Início ${base.safra} - ${nome}`)}
      colunas={colunas.map(({ rotulo, valor }) => ({ rotulo, valor }))}
      buscar={async () => linhas}
    />
  );

/**
 * Moldura das janelas do painel: exportar a tabela principal no topo e, no rodapé, as telas de origem
 * (`ligacoes`: { href, rotulo }) que o usuário pode abrir.
 */
function JanelaPainel({ titulo, subtitulo, base, exportar, ligacoes = [], largura = "5xl", children }) {
  const telas = ligacoes.filter((x) => base.pode(x.href));
  return (
    <JanelaInfo
      titulo={titulo}
      subtitulo={subtitulo}
      largura={largura}
      onFechar={base.onFechar}
      acoes={exportar && exportarTabela(base, exportar)}
      rodape={
        telas.length > 0
          ? telas.map((x) => (
              <Link key={x.href} href={x.href} className="rounded-md px-2 py-1 text-[12.5px] font-medium text-[#2E5FA8] hover:bg-[#2E5FA8]/[0.06]">
                {x.rotulo}
              </Link>
            ))
          : undefined
      }
    >
      {children}
    </JanelaInfo>
  );
}

/** Moldura das janelas da moagem: safra e período no subtítulo; no rodapé, as ordens de corte (e as metas). */
function JanelaMoagem({ subtitulo, base, comMetas = false, ...resto }) {
  const ligacoes = [
    ...(comMetas ? [{ href: METAS_FRENTES, rotulo: "Ver metas das frentes" }] : []),
    { href: ORDENS_DE_CORTE, rotulo: "Ver ordens de corte" },
  ];
  return <JanelaPainel {...resto} subtitulo={`Safra ${base.safra} · ${subtitulo}`} base={base} ligacoes={ligacoes} />;
}

/** Caixa "Moagem do dia": por frente, com a meta e o dia anterior com entrega, e por ordem de corte e fazenda. */
function JanelaDia({ mo, base }) {
  const dia = mo.ultima;
  // dia anterior: o último com entrada antes deste, com a mesma consulta da caixa (vem à parte, porque pode ser de
  // antes do período carregado, como no primeiro dia de entrega da safra)
  const anterior = mo.anterior;
  const linhas = mo.porFrente(dia, dia);
  if (anterior) for (const frente of Object.keys(anterior.porFrente)) if (!linhas.some((l) => l.frente === frente)) linhas.push({ frente, ton: 0, dias: 0, meta: 0 });
  const ton = somaDe(linhas, "ton");
  const meta = somaDe(linhas, "meta");
  const tonAnterior = anterior ? mo.tonDoDia(anterior) : 0;
  const colunas = [
    colFrente(base),
    colTon("Moagem (t)", ton),
    colMeta(meta),
    colPctMeta(ton, meta),
    ...(anterior
      ? [
          {
            rotulo: `Dia anterior ${dm(anterior.dt)} (t)`,
            num: "t",
            valor: (l) => r2(anterior.porFrente[l.frente] ?? 0),
            total: tonAnterior,
            zeroVazio: true,
            classe: () => "text-muted",
          },
        ]
      : []),
  ];
  const colunasOrdens = colsOrdens(mo.ordensDia, true);
  return (
    <JanelaMoagem
      titulo={`Moagem do dia ${fmtDateBR(dia)}`}
      subtitulo={`${diaDaSemana(dia)}, ${fmtDateBR(dia)}`}
      base={base}
      comMetas
      exportar={{ nome: `Moagem do dia ${fmtDateBR(dia)} por frente`, colunas, linhas }}
    >
      <NotaJanela>
        {nf(ton)} t no dia{meta > 0 ? `, ${Math.round(atingido(ton, meta)).toLocaleString("pt-BR")}% da meta de ${nf(meta)} t` : ""}
        {anterior && tonAnterior > 0
          ? ` · ${ton >= tonAnterior ? "▲" : "▼"} ${nf((Math.abs(ton - tonAnterior) / tonAnterior) * 100, 1)}% sobre ${fmtDateBR(anterior.dt)} (${nf(tonAnterior)} t)`
          : ""}
        . Clique na frente para ver o detalhe dela.
      </NotaJanela>
      <TabelaJanela colunas={colunas} linhas={linhas} chave={(l) => l.frente} vazio="Nenhuma frente com entrega ou meta no dia." />
      <SecaoJanela
        titulo={`Ordens de corte com entrada no dia · ${mo.ordensDia.length.toLocaleString("pt-BR")}`}
        acoes={exportarTabela(base, { nome: `Moagem do dia ${fmtDateBR(dia)} por ordem`, colunas: colunasOrdens, linhas: mo.ordensDia })}
      >
        <TabelaJanela colunas={colunasOrdens} linhas={mo.ordensDia} chave={(o) => `${o.ord}|${o.faz}`} vazio="Nenhuma ordem com entrada no dia." />
      </SecaoJanela>
    </JanelaMoagem>
  );
}

/** Caixa "Moagem em <mês>" (e o mês clicado nas outras janelas): por frente e o dia a dia do período. */
function JanelaPeriodo({ mo, base, inicio, fim }) {
  const frentes = mo.porFrente(inicio, fim);
  const dias = mo.diaADia(inicio, fim);
  const ton = somaDe(frentes, "ton");
  const meta = somaDe(frentes, "meta");
  const diasCom = dias.filter((d) => d.ton > 0).length;
  // mês que começa antes do início da safra (a caixa do mês): o total conta o mês inteiro, mas os dias e a média do
  // texto da caixa (e a barra do mês no gráfico mensal) contam só desde o início da safra; a nota mostra as duas contas
  const desdeSafra = inicio < mo.inicio && mo.inicio <= fim ? dias.filter((d) => d.dt >= mo.inicio) : null;
  const tonSafra = desdeSafra ? somaDe(desdeSafra, "ton") : 0;
  const diasSafra = desdeSafra ? desdeSafra.filter((d) => d.ton > 0).length : 0;
  const colunasFrentes = [colFrente(base), colTon("Moagem (t)", ton), colDias(diasCom), colMedia(ton, diasCom), colMeta(meta), colPctMeta(ton, meta), colParticipacao(ton)];
  const colunasDias = [
    { rotulo: "Data", valor: (d) => fmtDateBR(d.dt), exibir: (d) => <DataDia dt={d.dt} /> },
    ...colsFrentesDoDia(
      frentes.filter((f) => f.ton !== 0).map((f) => f.frente),
      dias,
    ),
    { rotulo: "Total (t)", num: "t", valor: (d) => r2(d.ton), total: somaDe(dias, "ton"), zeroVazio: true, classe: () => "font-medium text-ink" },
    colMeta(somaDe(dias, "meta")),
    colPctMeta(somaDe(dias, "ton"), somaDe(dias, "meta")),
  ];
  const mes = rotuloMes(inicio.slice(0, 7));
  return (
    <JanelaMoagem
      titulo={`Moagem em ${mes}`}
      subtitulo={intervalo(inicio, fim)}
      base={base}
      comMetas
      largura="6xl"
      exportar={{ nome: `Moagem ${inicio.slice(0, 7)} por frente`, colunas: colunasFrentes, linhas: frentes }}
    >
      <NotaJanela>
        {nf(ton)} t em {diasCom.toLocaleString("pt-BR")} dias com entrega (média {nf(diasCom > 0 ? ton / diasCom : 0)} t/dia)
        {meta > 0 ? ` · ${Math.round(atingido(ton, meta)).toLocaleString("pt-BR")}% da meta de ${nf(meta)} t no período` : ""}. A média conta só os dias
        com entrega.
        {desdeSafra &&
          ` Os dias com entrega e a média do texto da caixa (e a barra do mês no gráfico mensal) contam só desde o início da safra (${fmtDateBR(mo.inicio)}): ${nf(tonSafra)} t em ${diasSafra.toLocaleString("pt-BR")} dias com entrega, média ${nf(diasSafra > 0 ? tonSafra / diasSafra : 0)} t/dia.`}
      </NotaJanela>
      <TabelaJanela colunas={colunasFrentes} linhas={frentes} chave={(l) => l.frente} vazio="Nenhuma frente com entrega ou meta no período." />
      <SecaoJanela
        titulo="Dia a dia"
        acoes={exportarTabela(base, { nome: `Moagem ${inicio.slice(0, 7)} dia a dia`, colunas: colunasDias, linhas: dias })}
      >
        <TabelaJanela colunas={colunasDias} linhas={dias} chave={(d) => d.dt} />
      </SecaoJanela>
    </JanelaMoagem>
  );
}

/** Caixa "Moagem da safra": mês a mês e por frente, com a meta. */
function JanelaSafra({ mo, base }) {
  const meses = mo.porMes(mo.inicio, mo.ultima);
  const frentes = mo.porFrente(mo.inicio, mo.ultima);
  const ton = somaDe(meses, "ton");
  const meta = somaDe(meses, "meta");
  const dias = somaDe(meses, "dias");
  const colunasMeses = [colMes(base), colTon("Moagem (t)", ton), colDias(dias), colMedia(ton, dias), colMeta(meta), colPctMeta(ton, meta)];
  const colunasFrentes = [colFrente(base), colTon("Moagem (t)", ton), colDias(dias), colMedia(ton, dias), colMeta(meta), colPctMeta(ton, meta), colParticipacao(ton)];
  return (
    <JanelaMoagem
      titulo="Moagem da safra"
      subtitulo={intervalo(mo.inicio, mo.ultima)}
      base={base}
      comMetas
      exportar={{ nome: "Moagem da safra por mês", colunas: colunasMeses, linhas: meses }}
    >
      <NotaJanela>
        {base.safraInicio ? `Desde o início da produção da safra (${fmtDateBR(mo.inicio)})` : "Sem safra cadastrada para hoje: contam os últimos 365 dias"}
        {` até ${fmtDateBR(mo.ultima)}`}
        {meta > 0 ? ` · ${Math.round(atingido(ton, meta)).toLocaleString("pt-BR")}% da meta de ${nf(meta)} t` : ""}. Clique no mês para ver o dia a dia e na
        frente para ver o detalhe dela.
      </NotaJanela>
      <TabelaJanela colunas={colunasMeses} linhas={meses} chave={(l) => l.mes} />
      <SecaoJanela titulo="Por frente" acoes={exportarTabela(base, { nome: "Moagem da safra por frente", colunas: colunasFrentes, linhas: frentes })}>
        <TabelaJanela colunas={colunasFrentes} linhas={frentes} chave={(l) => l.frente} vazio="Nenhuma frente com entrega ou meta na safra." />
      </SecaoJanela>
    </JanelaMoagem>
  );
}

/** Caixa "Média por dia efetivo": a conta (safra ÷ dias com entrega), mês a mês e cada dia com entrega. */
function JanelaMedia({ mo, base, melhor, menor }) {
  const meses = mo.porMes(mo.inicio, mo.ultima);
  const ton = somaDe(meses, "ton");
  const dias = somaDe(meses, "dias");
  const media = dias > 0 ? ton / dias : 0;
  const lista = mo
    .diasEntre(mo.inicio, mo.ultima)
    .map((d) => ({ dt: d.dt, porFrente: d.porFrente, ton: mo.tonDoDia(d) }))
    .filter((d) => d.ton > 0)
    .reverse();
  const frentes = mo
    .porFrente(mo.inicio, mo.ultima)
    .filter((f) => f.ton !== 0)
    .map((f) => f.frente);
  const colunasMeses = [colMes(base), colTon("Moagem (t)", ton), colDias(dias), colMedia(ton, dias)];
  const colunasDias = [
    {
      rotulo: "Data",
      valor: (d) => fmtDateBR(d.dt),
      exibir: (d) => <DataDia dt={d.dt} marca={d.dt === melhor ? "melhor dos últimos 30" : d.dt === menor ? "menor dos últimos 30" : null} />,
    },
    ...colsFrentesDoDia(frentes, lista),
    { rotulo: "Total (t)", num: "t", valor: (d) => r2(d.ton), total: somaDe(lista, "ton"), classe: () => "font-medium text-ink" },
    { rotulo: "% da média", num: "pct", valor: (d) => r1(media > 0 ? (d.ton / media) * 100 : null), classe: () => "text-muted" },
  ];
  return (
    <JanelaMoagem
      titulo="Média por dia efetivo"
      subtitulo={intervalo(mo.inicio, mo.ultima)}
      base={base}
      exportar={{ nome: "Média por dia efetivo por mês", colunas: colunasMeses, linhas: meses }}
    >
      <NotaJanela>
        Moagem da safra ÷ dias com entrega: {nf(ton)} t ÷ {dias.toLocaleString("pt-BR")} dias = {nf(media)} t/dia. Os dias sem entrega não entram na conta.
      </NotaJanela>
      <TabelaJanela colunas={colunasMeses} linhas={meses} chave={(l) => l.mes} />
      <SecaoJanela
        titulo={`Dias com entrega · ${lista.length.toLocaleString("pt-BR")}`}
        acoes={exportarTabela(base, { nome: "Dias com entrega na safra", colunas: colunasDias, linhas: lista })}
      >
        <TabelaJanela colunas={colunasDias} linhas={lista} chave={(d) => d.dt} rotuloTotal={`Total · ${lista.length.toLocaleString("pt-BR")} dias`} />
      </SecaoJanela>
    </JanelaMoagem>
  );
}

/** Cartão da frente: dia, mês e safra com a meta, mês a mês e as ordens de corte do último dia. */
function JanelaFrente({ mo, base, frente }) {
  const fim = mo.ultima;
  const periodo = (rotulo, inicio) => {
    const ds = mo.diasEntre(inicio, fim);
    return {
      rotulo,
      ton: ds.reduce((s, d) => s + mo.tonDoDia(d, frente), 0),
      dias: ds.filter((d) => mo.tonDoDia(d, frente) > 0).length,
      meta: mo.metaNoPeriodo(frente, inicio, fim),
    };
  };
  const resumo = [periodo(`Dia ${dm(fim)}`, fim), periodo(`Mês (${rotuloMes(fim.slice(0, 7))})`, mo.inicioMes), periodo("Safra", mo.inicio)];
  const meses = mo.porMes(mo.inicio, fim, frente);
  const ordens = mo.ordensDia.filter((o) => o.frente === frente);
  const ton = somaDe(meses, "ton");
  const meta = somaDe(meses, "meta");
  const dias = somaDe(meses, "dias");
  const tonSafra = somaDe(mo.porFrente(mo.inicio, fim), "ton");
  const colunasResumo = [
    { rotulo: "Período", valor: (l) => l.rotulo, classe: () => "font-medium text-ink" },
    colTon("Moagem (t)"),
    colMeta(),
    colPctMeta(),
    colDias(),
    colMedia(),
  ];
  const colunasMeses = [colMes(base), colTon("Moagem (t)", ton), colDias(dias), colMedia(ton, dias), colMeta(meta), colPctMeta(ton, meta)];
  const colunasOrdens = colsOrdens(ordens, false);
  return (
    <JanelaMoagem
      titulo={`Moagem por frente · ${frente}`}
      subtitulo={`dados até ${fmtDateBR(fim)}`}
      base={base}
      comMetas
      exportar={{ nome: `${frente} - dia, mês e safra`, colunas: colunasResumo, linhas: resumo }}
    >
      <NotaJanela>
        {tonSafra > 0 && ton > 0 ? `${Math.round((ton / tonSafra) * 100).toLocaleString("pt-BR")}% da moagem da safra. ` : ""}Clique no mês para ver o dia a
        dia de todas as frentes.
      </NotaJanela>
      <TabelaJanela colunas={colunasResumo} linhas={resumo} chave={(l) => l.rotulo} />
      <SecaoJanela titulo="Mês a mês na safra" acoes={exportarTabela(base, { nome: `${frente} - mês a mês`, colunas: colunasMeses, linhas: meses })}>
        <TabelaJanela colunas={colunasMeses} linhas={meses} chave={(l) => l.mes} vazio="Sem entrega nem meta da frente na safra." />
      </SecaoJanela>
      <SecaoJanela
        titulo={`Ordens de corte com entrada em ${fmtDateBR(fim)} · ${ordens.length.toLocaleString("pt-BR")}`}
        acoes={exportarTabela(base, { nome: `${frente} - ordens do dia ${fmtDateBR(fim)}`, colunas: colunasOrdens, linhas: ordens })}
      >
        <TabelaJanela colunas={colunasOrdens} linhas={ordens} chave={(o) => `${o.ord}|${o.faz}`} vazio="Nenhuma entrada da frente no dia." />
      </SecaoJanela>
    </JanelaMoagem>
  );
}

// ---------------------------------------------------------------------------
// Janelas das caixas de safra e de insumos (dados já carregados por lib/db-painel.js; o total é o número da caixa)
// ---------------------------------------------------------------------------

export const HISTORICO_SAFRAS = "/acompanhamentos/colheita/historico-safras";
export const SALDO_INSUMOS = "/acompanhamentos/insumos/saldo";
export const EMPRESTIMOS = "/acompanhamentos/insumos/emprestimos";

/** "ADUBOS" → "Adubos" (os nomes de grupo vêm em caixa alta do ERP) */
const frase = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s);
/** TCH: produção ÷ área dos talhões com produção; sem área, nada */
const tch = (t, ha) => (ha > 0 ? t / ha : null);
const muted = () => "text-muted";

/** Variação com a seta e a cor da caixa (verde subiu, vermelho desceu); `formato` do valor sem sinal. */
function Variacao({ v, formato = nf }) {
  if (v === null || v === undefined) return "—";
  return (
    <span style={{ color: v >= 0 ? VERDE : VERMELHO }}>
      {v >= 0 ? "▲" : "▼"} {formato(Math.abs(v))}
    </span>
  );
}

/**
 * Caixas "Produção estimada", "TCH estimado" e "TCH realizado" (Safra: estimado e realizado): a safra da caixa por
 * fazenda e, embaixo, as safras das barras de TCH. "Moagem até agora" abre a janela da moagem da safra.
 */
function JanelaEstimado({ d, mo, base }) {
  const { safra, fazendas } = d.safraFazendas;
  const s = d.safraComparativo.find((x) => x.safra === safra);
  const soma = (c) => somaDe(fazendas, c);
  const estimado = soma("estimadoT");
  const realizado = soma("realizadoT");
  const tchE = tch(estimado, soma("areaEstimadoHa"));
  const tchR = tch(realizado, soma("areaRealizadoHa"));
  const tomTch = (r, e) => (r === null || e === null ? "text-ink" : r >= e ? "font-medium text-good-600" : "font-medium text-alert-600");
  const colunas = [
    { rotulo: "Fazenda", valor: (f) => (f.fazNm ? `${f.faz} · ${f.fazNm}` : f.faz) },
    { rotulo: "Talhões", num: "int", valor: (f) => f.talhoes, total: soma("talhoes"), classe: muted },
    { rotulo: "Área total (ha)", num: "t", valor: (f) => r2(f.areaTotalHa), total: soma("areaTotalHa"), classe: muted },
    { rotulo: "Estimado (t)", num: "t", valor: (f) => r2(f.estimadoT), total: estimado, zeroVazio: true },
    { rotulo: "TCH estimado", num: "t", valor: (f) => r2(tch(f.estimadoT, f.areaEstimadoHa)), total: tchE },
    { rotulo: "Área colhida (ha)", num: "t", valor: (f) => r2(f.areaColhidaHa), total: soma("areaColhidaHa"), zeroVazio: true, classe: muted },
    { rotulo: "Realizado (t)", num: "t", valor: (f) => r2(f.realizadoT), total: realizado, zeroVazio: true },
    {
      rotulo: "TCH realizado",
      num: "t",
      valor: (f) => r2(tch(f.realizadoT, f.areaRealizadoHa)),
      total: tchR,
      classe: (f) => tomTch(tch(f.realizadoT, f.areaRealizadoHa), tch(f.estimadoT, f.areaEstimadoHa)),
    },
  ];
  const colunasSafras = [
    { rotulo: "Safra", valor: (x) => String(x.safra), classe: () => "font-medium text-ink" },
    { rotulo: "Área total (ha)", num: "t", valor: (x) => x.areaTotalHa, classe: muted },
    { rotulo: "Estimado (t)", num: "t", valor: (x) => x.estimadoT, zeroVazio: true },
    { rotulo: "TCH estimado", num: "t", valor: (x) => x.tchEstimado },
    { rotulo: "Área colhida (ha)", num: "t", valor: (x) => x.areaColhidaHa, zeroVazio: true, classe: muted },
    { rotulo: "Realizado (t)", num: "t", valor: (x) => x.realizadoT, zeroVazio: true },
    { rotulo: "TCH realizado", num: "t", valor: (x) => x.tchRealizado, classe: (x) => tomTch(x.tchRealizado, x.tchEstimado) },
  ];
  return (
    <JanelaPainel
      titulo="Safra: estimado e realizado"
      subtitulo={`Safra ${safra} · ${fazendas.length.toLocaleString("pt-BR")} fazendas · planilha da safra`}
      base={base}
      largura="6xl"
      ligacoes={[{ href: HISTORICO_SAFRAS, rotulo: "Ver histórico de safras" }]}
      exportar={{ nome: `Safra ${safra} estimado e realizado por fazenda`, colunas, linhas: fazendas }}
    >
      <NotaJanela>
        Produção estimada {nf(estimado)} t · TCH estimado {tchE === null ? "—" : nf(tchE)} · TCH realizado {tchR === null ? "—" : nf(tchR)}. O TCH é a
        produção ÷ a área dos talhões com produção (estimada ou realizada). A moagem até agora ({nf(d.realizadoAteHojeT)} t
        {s && s.estimadoT > 0 ? `, ${Math.round((d.realizadoAteHojeT / s.estimadoT) * 100).toLocaleString("pt-BR")}% do estimado` : ""}) é a entrada de cana
        na usina
        {mo ? (
          <>
            {": "}
            <BotaoLink onClick={() => base.abrir({ tipo: "safra" })} title="Ver a moagem da safra">
              ver a moagem da safra
            </BotaoLink>
          </>
        ) : null}
        .
      </NotaJanela>
      <TabelaJanela colunas={colunas} linhas={fazendas} chave={(f) => f.faz} vazio="Nenhum talhão da safra na planilha importada." />
      <SecaoJanela
        titulo="Safra a safra"
        acoes={exportarTabela(base, { nome: "Estimado e realizado por safra", colunas: colunasSafras, linhas: d.safraComparativo })}
      >
        <TabelaJanela colunas={colunasSafras} linhas={d.safraComparativo} chave={(x) => x.safra} />
      </SecaoJanela>
    </JanelaPainel>
  );
}

/** Caixa "Saldo contábil": por empresa (com o retrato anterior e a variação) e todos os grupos de insumo por empresa. */
function JanelaSaldo({ insumos, base }) {
  const atual = new Map(insumos.porEmpresa.map((e) => [e.emp, e.valor]));
  const anterior = insumos.dtAnterior ? new Map(insumos.porEmpresaAnterior.map((e) => [e.emp, e.valor])) : null;
  const emps = Array.from(new Set([...atual.keys(), ...(anterior?.keys() ?? [])])).sort((a, b) => a - b);
  const total = insumos.valor;
  const linhas = emps.map((emp) => ({ emp, valor: atual.get(emp) ?? 0, anterior: anterior ? (anterior.get(emp) ?? 0) : null }));
  const participacao = (v) => (total !== 0 ? (v / total) * 100 : null);
  const colunas = [
    { rotulo: "Empresa", valor: (l) => nomeEmpresa(l.emp), classe: () => "font-medium text-ink" },
    { rotulo: `Saldo em ${fmtDateBR(insumos.dtBase)} (R$)`, num: "t", valor: (l) => r2(l.valor), total },
    ...(anterior
      ? [
          { rotulo: `Saldo em ${fmtDateBR(insumos.dtAnterior)} (R$)`, num: "t", valor: (l) => r2(l.anterior), total: total - insumos.variacao, classe: muted },
          {
            rotulo: "Variação (R$)",
            num: "t",
            valor: (l) => r2(l.valor - l.anterior),
            exibir: (l) => <Variacao v={l.valor - l.anterior} />,
            total: insumos.variacao,
          },
        ]
      : []),
    { rotulo: "Participação", num: "pct", valor: (l) => r1(participacao(l.valor)), total: participacao(total), classe: muted },
  ];
  const colunasGrupos = [
    { rotulo: "Grupo", valor: (g) => (g.grp ? `${g.grp} · ${frase(g.ds)}` : frase(g.ds)) },
    ...emps.map((emp) => ({
      rotulo: `${nomeEmpresa(emp)} (R$)`,
      num: "t",
      valor: (g) => r2(g.porEmpresa[emp] ?? 0),
      total: atual.get(emp) ?? 0,
      zeroVazio: true,
      classe: muted,
    })),
    { rotulo: "Total (R$)", num: "t", valor: (g) => r2(g.valor), total, classe: () => "font-medium text-ink" },
    { rotulo: "Participação", num: "pct", valor: (g) => r1(participacao(g.valor)), total: participacao(total), classe: muted },
    { rotulo: "Insumos com saldo", num: "int", valor: (g) => g.itens, total: somaDe(insumos.porGrupo, "itens"), classe: muted },
  ];
  return (
    <JanelaPainel
      titulo="Saldo contábil"
      subtitulo={`Saldo de ${fmtDateBR(insumos.dtBase)} · depósitos 207 e 401`}
      base={base}
      largura="6xl"
      ligacoes={[{ href: SALDO_INSUMOS, rotulo: "Ver saldo de insumos" }]}
      exportar={{ nome: `Saldo contábil ${insumos.dtBase} por empresa`, colunas, linhas }}
    >
      <NotaJanela>
        Valor do estoque: saldo × custo médio de cada insumo nos depósitos agrícolas, {brl(total)}
        {insumos.variacao !== null ? (
          <>
            {" "}
            (<Variacao v={insumos.variacao} formato={brl} /> sobre {fmtDateBR(insumos.dtAnterior)})
          </>
        ) : null}
        .
      </NotaJanela>
      <TabelaJanela colunas={colunas} linhas={linhas} chave={(l) => l.emp} vazio="Sem saldo nos depósitos agrícolas." />
      <SecaoJanela
        titulo={`Por grupo de insumo · ${insumos.porGrupo.length.toLocaleString("pt-BR")}`}
        acoes={exportarTabela(base, { nome: `Saldo contábil ${insumos.dtBase} por grupo`, colunas: colunasGrupos, linhas: insumos.porGrupo })}
      >
        <TabelaJanela colunas={colunasGrupos} linhas={insumos.porGrupo} chave={(g) => `${g.grp}|${g.ds}`} vazio="Sem saldo nos depósitos agrícolas." />
      </SecaoJanela>
    </JanelaPainel>
  );
}

/** Caixa "Empréstimos em aberto": cada empréstimo ainda não devolvido nem pago, com o valor dos itens. */
function JanelaEmprestimos({ insumos, base }) {
  const e = insumos.emprestimosAbertos;
  const lista = e.lista ?? [];
  const colunas = [
    { rotulo: "Solicitação", num: "cod", valor: (l) => l.solicitacao ?? null, classe: () => "font-medium text-ink" },
    { rotulo: "Data Solicitação", valor: (l) => (l.dtSol ? fmtDateBR(l.dtSol) : null), classe: muted },
    { rotulo: "Data Saída", valor: (l) => (l.dtSaida ? fmtDateBR(l.dtSaida) : null), classe: muted },
    { rotulo: "Fornecedor", valor: (l) => l.fornecedor },
    { rotulo: "Fazendas", valor: (l) => l.fazendas, classe: muted },
    { rotulo: "Insumos", num: "int", valor: (l) => l.itens, total: somaDe(lista, "itens"), classe: muted },
    { rotulo: "Valor total (R$)", num: "t", valor: (l) => r2(l.valor), total: e.valor, classe: () => "font-medium text-ink" },
  ];
  return (
    <JanelaPainel
      titulo="Empréstimos em aberto"
      subtitulo="Insumos emprestados e ainda não devolvidos ou pagos"
      base={base}
      largura="6xl"
      ligacoes={[{ href: EMPRESTIMOS, rotulo: "Ver empréstimos" }]}
      exportar={{ nome: "Empréstimos em aberto", colunas, linhas: lista }}
    >
      <NotaJanela>
        {e.n.toLocaleString("pt-BR")} empréstimo(s) em aberto somam {brl(e.valor)}
        {insumos.valor > 0 && e.valor > 0 ? `, ${Math.round((e.valor / insumos.valor) * 100).toLocaleString("pt-BR")}% do saldo contábil` : ""}. Dê baixa em
        Insumos › Empréstimos quando o insumo voltar ou for pago.
      </NotaJanela>
      <TabelaJanela
        colunas={colunas}
        linhas={lista}
        chave={(l) => l.id}
        vazio="Nenhum empréstimo em aberto."
        rotuloTotal={`Total · ${lista.length.toLocaleString("pt-BR")} empréstimo(s)`}
      />
    </JanelaPainel>
  );
}

/**
 * Janela aberta no painel: moagem { tipo: "dia" | "periodo" (inicio, fim) | "safra" | "media" | "frente" (frente) },
 * safra { tipo: "estimado" } ou insumos { tipo: "saldo" | "emprestimos" }.
 */
export function JanelaDoPainel({ janela, d, mo, base, melhor, menor }) {
  if (!janela) return null;
  if (janela.tipo === "estimado") return <JanelaEstimado d={d} mo={mo} base={base} />;
  if (janela.tipo === "saldo") return <JanelaSaldo insumos={d.insumos} base={base} />;
  if (janela.tipo === "emprestimos") return <JanelaEmprestimos insumos={d.insumos} base={base} />;
  if (!mo) return null;
  if (janela.tipo === "dia") return <JanelaDia mo={mo} base={base} />;
  if (janela.tipo === "periodo") return <JanelaPeriodo key={janela.inicio} mo={mo} base={base} inicio={janela.inicio} fim={janela.fim} />;
  if (janela.tipo === "safra") return <JanelaSafra mo={mo} base={base} />;
  if (janela.tipo === "media") return <JanelaMedia mo={mo} base={base} melhor={melhor} menor={menor} />;
  if (janela.tipo === "frente") return <JanelaFrente key={janela.frente} mo={mo} base={base} frente={janela.frente} />;
  return null;
}
