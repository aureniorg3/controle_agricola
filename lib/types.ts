export type StatusOrdem = "Aberta" | "Encerrada";

/**
 * Talhão dentro de uma ordem, como cadastrado no arquivo "Ordem de
 * Colheita.xlsx" — uma ordem pode abranger mais de uma fazenda (cada uma com
 * seu próprio bloco "Propriedade" e seus próprios talhões no arquivo), e o
 * número do talhão sozinho NÃO é único dentro da ordem nesse caso (ex.:
 * talhão "1" pode existir em duas fazendas diferentes da mesma ordem) — por
 * isso a chave real é o par fazendaCodigo+talhao. Quando o mesmo par aparece
 * mais de uma vez (plantios/"partes" diferentes dentro do mesmo talhão), as
 * áreas são somadas num único registro.
 */
export interface TalhaoOrdem {
  fazendaCodigo: string;
  fazendaNome: string;
  talhao: string;
  areaHa: number;
  /** área colhida lançada manualmente (medição de campo, parcial) — 0 até
   * ser lançada pela primeira vez. */
  areaColhidaHa: number;
}

/**
 * Entrada de cana de um talhão num dia — já agregada a partir das viagens
 * individuais de "Pesagem de Cana por Hora" (uma viagem = um caminhão, um
 * talhão, um Controle+Sequência). `viagens` é só informativo. `fazendaCodigo`
 * é necessário para casar com o `TalhaoOrdem` certo (ver comentário lá).
 */
export interface EntradaDiaria {
  data: string; // YYYY-MM-DD
  fazendaCodigo: string;
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
  sobrenome: string;
  email: string;
  /** nome de usuário curto — alternativa ao e-mail pra entrar no sistema. */
  usuario: string;
  /** formato "salt:hash" (scrypt) — nunca a senha em texto puro */
  senhaHash: string;
  perfil: PerfilUsuario;
  /** desativado não consegue mais logar, mas o cadastro/histórico é mantido */
  ativo: boolean;
  /** true logo após o cadastro (senha provisória) — barra o acesso ao resto
   * do sistema até trocar a senha em /trocar-senha. */
  precisaTrocarSenha: boolean;
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

/** Meta diária de uma frente (t/dia), válida a partir da data de vigência
 * até a próxima meta cadastrada pra mesma frente. */
export interface MetaFrente {
  id: string;
  frente: string;
  metaDiaT: number;
  /** YYYY-MM-DD — primeiro dia em que esta meta vale. */
  vigencia: string;
}

export type Periodo = "dia" | "semana" | "mes" | "safra";
