export type StatusOrdem = "Aberta" | "Encerrada";

/**
 * Talhão dentro de uma ordem, como cadastrado no arquivo "Ordem de
 * Colheita.xlsx" — quando um talhão aparece mais de uma vez nesse arquivo
 * (plantios/"partes" diferentes dentro do mesmo número), as áreas são
 * somadas num único registro por número de talhão.
 */
export interface TalhaoOrdem {
  talhao: string;
  areaHa: number;
}

/**
 * Entrada de cana de um talhão num dia — já agregada a partir das viagens
 * individuais de "Pesagem de Cana por Hora" (uma viagem = um caminhão, um
 * talhão, um Controle+Sequência). `viagens` é só informativo.
 */
export interface EntradaDiaria {
  data: string; // YYYY-MM-DD
  talhao: string;
  toneladas: number;
  /** parte de `toneladas` pesada entre 00:00 e 06:00 desse dia — usada pela
   * coluna "Dia Atual" do resumo por frente, que só conta essa janela. */
  toneladasAte6h: number;
  viagens: number;
}

export interface OrdemCorte {
  /** = numero (Ordem de Colheita não tem outro identificador único) */
  id: string;
  numero: string; // ex: "2461" — coluna "O.Q." nos relatórios de pesagem
  frente: string; // ex: "FRENTE I"
  fazendaCodigo: string; // ex: "9321"
  fazendaNome: string; // ex: "SANTARITA DE CASSIA"
  proprietarioCodigo?: string;
  proprietarioNome?: string;
  status: StatusOrdem;
  tipoCana?: string;
  dataQueima?: string; // YYYY-MM-DD
  observacao?: string;
  safraLabel: string; // ex: "2026/27"
  talhoes: TalhaoOrdem[];
  entradas: EntradaDiaria[];
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
  /** números de ordem escolhidos manualmente para aparecer na tela — a
   * importação traz todas as ordens da safra, mas só as marcadas aqui são
   * exibidas nos cards. */
  ordensVisiveis: string[];
  usuarios: Usuario[];
  /** data/hora da última importação bem-sucedida das 3 planilhas */
  ultimaImportacao?: string;
  ultimaAtualizacao: string;
}

export type Periodo = "dia" | "semana" | "mes" | "safra";
