export type StatusOrdem = "Aberta" | "Encerrada";

export interface Talhao {
  talhao: string;
  areaHa: number;
  /** toneladas colhidas no último lançamento registrado (equivalente ao "Ontem(t)" do relatório) */
  ultimaEntradaT: number;
  /** toneladas acumuladas na safra para este talhão */
  acumSafraT: number;
}

export interface Lancamento {
  id: string;
  data: string; // YYYY-MM-DD
  toneladas: number;
  /** opcional: quebra por talhão */
  porTalhao?: { talhao: string; toneladas: number }[];
  criadoEm: string; // ISO datetime
}

export interface OrdemCorte {
  id: string;
  numero: string; // ex: "2461"
  frente: string; // ex: "FRENTE-1"
  regiao: string; // ex: "Reg - 1"
  fazendaCodigo: string; // ex: "9321"
  fazendaNome: string; // ex: "SANTARITA DE CASSIA"
  status: StatusOrdem;
  dataAbertura: string; // YYYY-MM-DD
  dataEncerramento?: string;
  talhoes: Talhao[];
  areaLiberadaHa: number;
  areaColhidaHa: number;
  tchRealizadoSafraAnterior: number;
  tchEstimado: number;
  safraLabel: string; // ex: "2026/27"
  lancamentos: Lancamento[];
  observacoes?: string;
  criadoEm: string;
  atualizadoEm: string;
}

/**
 * Três níveis, cada um contendo o anterior:
 *  - leitura: vê todo o sistema, não cria nem edita nada;
 *  - gravacao: leitura + cria ordens, lança apontamentos, importa planilha;
 *  - admin: gravacao + gerencia usuários (Configurações → Cadastros).
 */
export type PerfilUsuario = "leitura" | "gravacao" | "admin";

export interface Usuario {
  id: string;
  nome: string;
  email: string;
  /** formato "salt:hash" (scrypt) — nunca a senha em texto puro */
  senhaHash: string;
  perfil: PerfilUsuario;
  /** desativado não consegue mais logar, mas o cadastro/histórico é mantido */
  ativo: boolean;
  criadoEm: string;
}

/** Usuario sem o hash de senha — o que trafega entre API e tela. */
export type UsuarioPublico = Omit<Usuario, "senhaHash">;

export interface Database {
  ordens: OrdemCorte[];
  usuarios: Usuario[];
  ultimaAtualizacao: string;
}

export type Periodo = "dia" | "semana" | "mes" | "safra";
