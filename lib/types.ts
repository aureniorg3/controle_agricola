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
  /** apontamento diário da área colhida (histórico); a tela soma o que vale até a data escolhida */
  colhidaDias?: { d: string; ha: number }[];
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
  /** idem, pesada até 12:00 e até 18:00 — permitem escolher o horário de corte do "dia atual".
   * Na tela, `toneladasAte6h` passa a valer "até o horário de corte escolhido". */
  toneladasAte12h: number;
  toneladasAte18h: number;
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
 * Perfis de acesso:
 *  - leitura: vê as telas liberadas, não cria nem edita nada;
 *  - analista1 / analista2: lançam e gravam nas telas de operação, mas não incluem itens nos cadastros;
 *  - gravacao: cria ordens, lança apontamentos, importa planilha e inclui itens nos cadastros;
 *  - admin: gravacao + gerencia usuários e os Parâmetros.
 * Quais telas cada usuário vê é configurado à parte (Parâmetros → Usuários).
 */
export type PerfilUsuario = "leitura" | "analista1" | "analista2" | "gravacao" | "admin";

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
  /** telas liberadas (endereços do menu); null = todas, inclusive as que forem criadas depois */
  acessos: string[] | null;
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
  /** quem lançou e quem alterou por último */
  lancadoPor?: string;
  alteradoPor?: string;
  alteradoEm?: string;
  frente: string;
  metaDiaT: number;
  /** YYYY-MM-DD — primeiro dia em que esta meta vale. */
  vigencia: string;
}

/** Linha do "Relatório de Frentes por Especialidade" (conferência de pesagem):
 * toneladas que um equipamento colheu numa fazenda, num dia, e a frente em
 * que o relatório do ERP o colocou. */
export interface ConferenciaLinha {
  data: string;
  eqp: string;
  eqpNome: string;
  frente: string;
  fazendaCodigo: string;
  fazendaNome: string;
  toneladas: number;
  /** frente correta, lançada pelo usuário para corrigir no sistema de origem */
  frenteCorrecao?: string | null;
}

/** Em qual frente um equipamento está a partir de uma data (vale até o
 * próximo lançamento do mesmo equipamento). */
export interface EquiptoFrente {
  lancadoPor?: string;
  alteradoPor?: string;
  alteradoEm?: string;
  id: string;
  eqp: string;
  frente: string;
  /** YYYY-MM-DD */
  vigencia: string;
}

/** O mínimo de uma ordem de corte para a conferência de pesagem. */
export interface OrdemConferencia {
  numero: string;
  frente: string;
  status: "Aberta" | "Encerrada";
  ultimaEntrada: string | null;
  fazendas: { codigo: string; nome: string }[];
}

/** Safra cadastrada: tipo (agrícola ou industrial), período do ano e período de produção. */
export type TipoSafra = "AGR" | "IND";

export interface SafraCadastro {
  id: string;
  tipo: TipoSafra;
  ano: number;
  anoInicio: string;
  anoFim: string;
  producaoInicio: string;
  producaoFim: string;
  lancadoPor?: string;
  alteradoPor?: string;
  alteradoEm?: string;
}

/** Uma linha (talhão) do relatório "Rendimentos e Estimativas de Talhões" de uma safra. */
export interface SafraTalhao {
  safra: number;
  /** ordem da linha dentro do mesmo fazenda+talhão (um talhão pode repetir com áreas parciais) */
  seq: number;
  fazendaCodigo: string;
  fazendaNome: string;
  proprietarioCodigo: string;
  proprietarioNome: string;
  municipio: string;
  uf: string;
  talhao: string;
  km: number;
  variedadeCodigo: string;
  variedadeNome: string;
  dtColheitaAnt: string | null;
  dtColheita: string | null;
  dtPlantio: string | null;
  corte: number;
  areaTot: number;
  areaPlant: number;
  areaColh: number;
  mtLinear: number;
  espac: number;
  prodAnt: number;
  tchAnt: number;
  prodEst: number;
  /** TCH estimado (coluna Q do relatório — o cabeçalho "Kg/Ha" do arquivo é t/ha) */
  tchEst: number;
  prodAtual: number;
  /** TCH realizado (coluna S do relatório) */
  tchReal: number;
  resultado: number;
  pct: number;
  ce: string;
}

/** Agregado de uma safra (ou de uma safra dentro de um grupo: fazenda, município…). */
export interface SafraAgregado {
  safra: number;
  chave: string;
  areaTot: number;
  /** área só das linhas já colhidas (com produção) — base do TCH realizado */
  areaColhida: number;
  producaoT: number;
  producaoEstT: number;
  /** produção real / área colhida */
  tchReal: number | null;
  /** produção estimada / área total */
  tchEst: number | null;
}

/** Agregado de uma variedade num corte (estágio) dentro de uma safra. */
export interface SafraVariedadeCorte {
  safra: number;
  variedade: string;
  corte: number;
  areaTot: number;
  areaColhida: number;
  producaoT: number;
  tchReal: number | null;
}

/** TCH por ordem de corte e safra (cruzando fazenda + talhão da ordem com o histórico). */
export interface HistoricoTchOrdem {
  safraAtual: number;
  /** as duas safras anteriores mais recentes importadas (mais nova primeiro) */
  safrasAnteriores: number[];
  porOrdem: Record<string, { safra: number; tchReal: number | null; tchEst: number | null }[]>;
  /** TCH estimado da safra atual por talhão da ordem: ordem -> "fazenda|talhão" -> t/ha (base do rateio das entradas sem talhão) */
  estPorTalhao: Record<string, Record<string, number>>;
}

export type Periodo = "dia" | "semana" | "mes" | "safra";
