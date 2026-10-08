/** Tipos e regras (sem banco) de Atividades › Apontamentos Diários. */

/** Uma linha da base de O.S. (Acompanhamento de O.S.): O.S. × talhão × operação. */
export interface LinhaBaseOS {
  emp: string;
  os: string;
  propCod: string;
  propNm: string;
  tlh: string;
  areaTlh: number | null;
  areaRec: number | null;
  opCod: string;
  opDs: string;
  etapaCod: string;
  etapaDs: string;
  tipoCod: string;
  tipoDs: string;
  resp: string;
  status: string;
  safra: string;
  dtLanc: string | null;
  obs: string;
}

export interface TalhaoOS {
  propCod: string;
  propNm: string;
  tlh: string;
  areaTlh: number | null;
  areaRec: number | null;
}

export interface OperacaoOS {
  cod: string;
  ds: string;
  etapaCod: string;
  etapaDs: string;
  tipoCod: string;
  tipoDs: string;
  talhoes: TalhaoOS[];
}

export interface ConsultaOS {
  os: string;
  emp: string;
  status: string;
  safra: string;
  resp: string;
  obs: string;
  dtLanc: string | null;
  operacoes: OperacaoOS[];
  /** área já apontada (outros apontamentos): operação → "fazenda|talhão" → ha */
  realizado: Record<string, Record<string, number>>;
  /** tipos de aplicação que existem na base, para sugerir no campo */
  tiposConhecidos: string[];
}

export interface TalhaoApontado {
  propCod: string;
  propNm: string;
  tlh: string;
  areaTlh: number | null;
  area: number;
}

/** Como a área do dia foi informada: talhão a talhão, ou um volume total rateado entre os talhões marcados. */
export type ModoArea = "talhao" | "rateio";

/** Insumo aplicado no apontamento (código do cadastro Material e Insumos). */
export interface InsumoApontado {
  cod: string;
  ds: string;
  um: string;
  /** dose programada por hectare */
  dose: number | null;
  /** quantidade real aplicada */
  qtd: number | null;
  dep: string;
}

export interface ApontamentoDiario {
  id: number;
  /** nº do boletim de campo (único) */
  boletim: number | null;
  dt: string;
  /** vazio = apontamento sem O.S. (fazenda e talhões informados à mão) */
  os: string;
  modoArea: ModoArea;
  /** volume total informado no rateio */
  volume: number | null;
  opCod: string;
  opDs: string;
  solicitante: string;
  etapaCod: string;
  etapaDs: string;
  tipoAplicacao: string;
  numEquipamentos: number;
  numPessoas: number;
  obs: string;
  /** código do equipamento */
  eqp: string;
  /** vazão (L/ha) recomendada e utilizada; a utilizada pode ter sido calculada (calda ÷ área) */
  vazaoRec: number | null;
  vazaoUti: number | null;
  vazaoAuto: boolean;
  /** volume de calda (L) */
  volCalda: number | null;
  insumos: InsumoApontado[];
  talhoes: TalhaoApontado[];
  areaTotal: number;
  usr: string;
  criEm: string;
  atuUsr: string | null;
  atuEm: string | null;
}

export interface EntradaApontamento {
  boletim: number;
  dt: string;
  /** sem O.S.: a fazenda vai em cada talhão (pode haver mais de uma fazenda) */
  semOS: boolean;
  os: string;
  opCod: string;
  opDs: string;
  modoArea: ModoArea;
  /** volume total (ha) para o rateio */
  volume: number | null;
  solicitante: string;
  etapaCod: string;
  tipoAplicacao: string;
  numEquipamentos: number;
  numPessoas: number;
  obs: string;
  eqp: string;
  vazaoRec: number | null;
  /** vazio = calculada pelo volume de calda ÷ área do dia */
  vazaoUti: number | null;
  volCalda: number | null;
  insumos: { cod: string; dose: number | null; qtd: number | null; dep: string }[];
  talhoes: { propCod: string; tlh: string; area: number }[];
}

export const chaveTalhao = (propCod: string, tlh: string) => `${propCod}|${tlh}`;
export const round2 = (n: number) => Math.round(n * 100) / 100;

const DATA = /^\d{4}-\d{2}-\d{2}$/;

/** Confere o formulário (sem consultar a base) e devolve o erro, ou null. */
export function validarApontamento(e: EntradaApontamento): string | null {
  if (!Number.isInteger(e.boletim) || e.boletim <= 0) return "Informe o número do boletim.";
  if (!DATA.test(e.dt) || Number.isNaN(Date.parse(e.dt))) return "Informe a data do apontamento.";
  if (!e.semOS && !e.os.trim()) return "Informe a Ordem de Serviço.";
  if (e.semOS && e.talhoes.some((t) => !t.propCod.trim())) return "Informe a fazenda em todas as linhas de talhão.";
  if (!e.opCod.trim()) return e.semOS ? "Informe a operação." : "Escolha a operação.";
  if (!e.solicitante.trim()) return "Informe o solicitante.";
  if (!Number.isInteger(e.numEquipamentos) || e.numEquipamentos < 0) return "Número de equipamentos inválido.";
  if (!Number.isInteger(e.numPessoas) || e.numPessoas < 0) return "Número de pessoas inválido.";
  for (const [v, nome] of [[e.vazaoRec, "Vazão recomendada"], [e.vazaoUti, "Vazão utilizada"], [e.volCalda, "Volume de calda"]] as const) {
    if (v !== null && (!Number.isFinite(v) || v < 0)) return `${nome} inválido(a).`;
  }
  for (const i of e.insumos) {
    if (!i.cod.trim()) return "Há insumo sem código.";
    if ((i.dose !== null && (!Number.isFinite(i.dose) || i.dose < 0)) || (i.qtd !== null && (!Number.isFinite(i.qtd) || i.qtd < 0))) {
      return `Insumo ${i.cod}: dose ou total inválido.`;
    }
  }
  if (e.talhoes.some((t) => !t.tlh.trim())) return "Há talhão sem número.";
  if (e.modoArea === "rateio") {
    if (!(e.volume !== null && Number.isFinite(e.volume) && e.volume > 0)) return "Informe o volume (ha) a ratear.";
    if (e.talhoes.length === 0) return "Marque os talhões que vão receber o rateio.";
    return null;
  }
  const comArea = e.talhoes.filter((t) => t.area > 0);
  if (e.talhoes.some((t) => !Number.isFinite(t.area) || t.area < 0)) return "Há área realizada inválida em algum talhão.";
  if (comArea.length === 0) return "Informe a área realizada em pelo menos um talhão.";
  return null;
}

/**
 * Rateia o volume entre os talhões, proporcional à área de cada um (quando todos têm área); sem área, divide igual.
 * Arredonda em centésimos e acerta a diferença no maior talhão, para a soma bater com o volume.
 */
export function ratearArea(volume: number, areas: (number | null)[]): number[] {
  if (areas.length === 0 || !(volume > 0)) return areas.map(() => 0);
  const pesos = areas.every((a) => a !== null && a > 0) ? (areas as number[]) : areas.map(() => 1);
  const soma = pesos.reduce((a, b) => a + b, 0);
  const r = pesos.map((p) => round2((volume * p) / soma));
  const dif = round2(volume - r.reduce((a, b) => a + b, 0));
  if (dif !== 0) {
    const i = pesos.indexOf(Math.max(...pesos));
    r[i] = round2(r[i] + dif);
  }
  return r;
}
