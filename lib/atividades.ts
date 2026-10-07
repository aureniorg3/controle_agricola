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

export interface ApontamentoDiario {
  id: number;
  dt: string;
  os: string;
  opCod: string;
  opDs: string;
  solicitante: string;
  etapaCod: string;
  etapaDs: string;
  tipoAplicacao: string;
  numEquipamentos: number;
  numPessoas: number;
  obs: string;
  talhoes: TalhaoApontado[];
  areaTotal: number;
  usr: string;
  criEm: string;
  atuUsr: string | null;
  atuEm: string | null;
}

export interface EntradaApontamento {
  dt: string;
  os: string;
  opCod: string;
  solicitante: string;
  etapaCod: string;
  tipoAplicacao: string;
  numEquipamentos: number;
  numPessoas: number;
  obs: string;
  talhoes: { propCod: string; tlh: string; area: number }[];
}

export const chaveTalhao = (propCod: string, tlh: string) => `${propCod}|${tlh}`;
export const round2 = (n: number) => Math.round(n * 100) / 100;

const DATA = /^\d{4}-\d{2}-\d{2}$/;

/** Confere o formulário (sem consultar a base) e devolve o erro, ou null. */
export function validarApontamento(e: EntradaApontamento): string | null {
  if (!DATA.test(e.dt) || Number.isNaN(Date.parse(e.dt))) return "Informe a data do apontamento.";
  if (!e.os.trim()) return "Informe a Ordem de Serviço.";
  if (!e.opCod.trim()) return "Escolha a operação.";
  if (!e.solicitante.trim()) return "Informe o solicitante.";
  if (!Number.isInteger(e.numEquipamentos) || e.numEquipamentos < 0) return "Número de equipamentos inválido.";
  if (!Number.isInteger(e.numPessoas) || e.numPessoas < 0) return "Número de pessoas inválido.";
  const comArea = e.talhoes.filter((t) => t.area > 0);
  if (e.talhoes.some((t) => !Number.isFinite(t.area) || t.area < 0)) return "Há área realizada inválida em algum talhão.";
  if (comArea.length === 0) return "Informe a área realizada em pelo menos um talhão.";
  return null;
}
