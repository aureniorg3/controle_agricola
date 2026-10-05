import type { EntradaDiaria, OrdemCorte } from "./types";

export type HoraCorte = 6 | 12 | 18 | 24;

export const HORAS_CORTE: { hora: HoraCorte; rotulo: string }[] = [
  { hora: 6, rotulo: "06:00" },
  { hora: 12, rotulo: "12:00" },
  { hora: 18, rotulo: "18:00" },
  { hora: 24, rotulo: "00:00" },
];

export function rotuloHoraCorte(hora: HoraCorte): string {
  return HORAS_CORTE.find((h) => h.hora === hora)?.rotulo ?? "06:00";
}

/** Tonelada da entrada pesada até o horário de corte (24 = dia completo, "00:00"). */
function ateCorte(e: EntradaDiaria, hora: HoraCorte): number {
  if (hora === 6) return e.toneladasAte6h;
  if (hora === 12) return e.toneladasAte12h;
  if (hora === 18) return e.toneladasAte18h;
  return e.toneladas;
}

const arredonda = (n: number) => Math.round(n * 1000) / 1000;

/**
 * A área colhida da ordem na data escolhida: o saldo lançado antes do apontamento
 * diário (tlh.area_col_ha) + o que foi apontado dia a dia até essa data. Assim o
 * filtro de datas anteriores mostra a área colhida que valia naquele dia.
 */
export function aplicarAreaColhidaDia(ordem: OrdemCorte, referencia: string): OrdemCorte {
  return {
    ...ordem,
    talhoes: ordem.talhoes.map((t) => ({
      ...t,
      areaColhidaHa:
        Math.round((t.areaColhidaHa + (t.colhidaDias ?? []).filter((d) => d.d <= referencia).reduce((s, d) => s + d.ha, 0)) * 100) / 100,
    })),
  };
}

/**
 * Prepara uma ordem para a tela:
 *  1) no dia da referência, `toneladasAte6h` passa a valer "até o horário de
 *     corte escolhido" (6, 12, 18 ou 00:00 = dia completo) — todo o resto do
 *     sistema continua lendo esse campo como "entrada do dia atual";
 *  2) entradas sem talhão (ordem em aberto, o movimento ainda não foi
 *     apropriado) são rateadas entre os talhões da ordem, na proporção de
 *     TCH estimado x área do talhão (sem TCH estimado, só pela área). O total
 *     da ordem não muda.
 */
export function aplicarCorteERateio(
  ordem: OrdemCorte,
  referencia: string,
  hora: HoraCorte,
  estPorTalhao: Record<string, number> | undefined
): OrdemCorte {
  const entradas: EntradaDiaria[] = [];

  for (const e of ordem.entradas) {
    const base: EntradaDiaria = e.data === referencia ? { ...e, toneladasAte6h: ateCorte(e, hora) } : e;

    const temTalhao = ordem.talhoes.some((t) => t.fazendaCodigo === e.fazendaCodigo && t.talhao === e.talhao);
    if (temTalhao || ordem.talhoes.length === 0) {
      entradas.push(base);
      continue;
    }

    // ordem com mais de uma fazenda: o rateio vale para TODOS os talhões da ordem,
    // não só os da fazenda da pesagem (a entrada ainda não foi apropriada a talhão nenhum)
    const candidatos = ordem.talhoes;

    const estimados = candidatos
      .map((t) => ({ t, est: estPorTalhao?.[`${t.fazendaCodigo}|${t.talhao}`] }))
      .filter((x): x is { t: (typeof candidatos)[number]; est: number } => typeof x.est === "number" && x.est > 0);
    const areaEst = estimados.reduce((s, x) => s + x.t.areaHa, 0);
    const mediaEst = areaEst > 0 ? estimados.reduce((s, x) => s + x.est * x.t.areaHa, 0) / areaEst : 1;

    const pesos = candidatos.map((t) => {
      const est = estPorTalhao?.[`${t.fazendaCodigo}|${t.talhao}`];
      return (typeof est === "number" && est > 0 ? est : mediaEst) * t.areaHa;
    });
    const somaPesos = pesos.reduce((s, p) => s + p, 0);

    candidatos.forEach((t, i) => {
      const parte = somaPesos > 0 ? pesos[i] / somaPesos : 1 / candidatos.length;
      entradas.push({
        data: base.data,
        fazendaCodigo: t.fazendaCodigo,
        talhao: t.talhao,
        toneladas: arredonda(base.toneladas * parte),
        toneladasAte6h: arredonda(base.toneladasAte6h * parte),
        toneladasAte12h: arredonda(base.toneladasAte12h * parte),
        toneladasAte18h: arredonda(base.toneladasAte18h * parte),
        viagens: i === 0 ? base.viagens : 0,
      });
    });
  }

  return { ...ordem, entradas };
}

/**
 * Rateia o total do dia entre os talhões da ordem. O peso de cada talhão é o seu saldo a colher ou a sua
 * área (conforme a base escolhida) e nenhum talhão passa do que ainda falta colher dele: o que
 * sobraria num talhão que enche é redistribuído entre os outros.
 */
export function ratearArea(total: number, itens: { chave: string; peso: number; teto: number }[]): Record<string, number> {
  const res: Record<string, number> = Object.fromEntries(itens.map((i) => [i.chave, 0]));
  let ativos = itens.filter((i) => i.teto > 0.004 && i.peso > 0);
  for (let volta = 0; volta < 20; volta++) {
    const feito = Object.values(res).reduce((a, b) => a + b, 0);
    const restante = total - feito;
    if (restante < 0.004 || ativos.length === 0) break;
    const soma = ativos.reduce((a, i) => a + i.peso, 0);
    for (const i of ativos) res[i.chave] = Math.min(i.teto, res[i.chave] + (restante * i.peso) / soma);
    ativos = ativos.filter((i) => res[i.chave] < i.teto - 0.004);
  }
  for (const k of Object.keys(res)) res[k] = arredonda2(res[k]);
  // ajuste dos centésimos que sobram do arredondamento no talhão de maior valor que ainda comporta
  const dif = arredonda2(total - Object.values(res).reduce((a, b) => a + b, 0));
  if (Math.abs(dif) >= 0.01) {
    const alvo = itens
      .filter((i) => res[i.chave] + dif <= i.teto + 0.001 && res[i.chave] + dif >= 0)
      .sort((a, b) => res[b.chave] - res[a.chave])[0];
    if (alvo) res[alvo.chave] = arredonda2(res[alvo.chave] + dif);
  }
  return res;
}

const arredonda2 = (n: number) => Math.round(n * 100) / 100;
