/** Valor de uma célula já normalizado: texto sem espaços sobrando, número ou "" */
export type ValorCadastro = string | number;
export type DadosCadastro = Record<string, ValorCadastro>;

export interface ColunaCadastro {
  chave: string;
  rotulo: string;
  /** largura mínima sugerida na tabela (px) */
  largura?: number;
  alinhar?: "esquerda" | "direita" | "centro";
}

export interface CadastroSpec {
  slug: string;
  titulo: string;
  /** nomes de arquivo (sem extensão, normalizados) associados a este cadastro */
  arquivos: string[];
  /** colunas do relatório que identificam o cabeçalho certo (chaves normalizadas) */
  obrigatorias: string[];
  codigo: (d: DadosCadastro) => string;
  nome: (d: DadosCadastro) => string;
  colunas: ColunaCadastro[];
  /** colunas que formam o código — não se edita depois de criado */
  chaves: string[];
}

/** minúsculas, sem acento e sem pontuação: "Código Cliente/Forn." -> "codigo cliente forn" */
export function normalizarTexto(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const texto = (v: ValorCadastro | undefined): string => (v === undefined ? "" : String(v)).trim();

export const CADASTROS_SPEC: CadastroSpec[] = [
  {
    slug: "fazendas",
    titulo: "Fazendas",
    arquivos: ["fazendas", "propriedades", "cadastro de propriedade"],
    obrigatorias: ["propriedade", "sequencia", "fundo_agricola"],
    codigo: (d) => `${texto(d.propriedade)}${Number(d.sequencia) ? `-${texto(d.sequencia)}` : ""}`,
    nome: (d) => texto(d.fundo_agricola),
    chaves: ["propriedade", "sequencia"],
    colunas: [
      { chave: "propriedade", rotulo: "Propriedade", alinhar: "direita" },
      { chave: "sequencia", rotulo: "Seq.", alinhar: "direita" },
      { chave: "fundo_agricola", rotulo: "Fundo Agrícola", largura: 220 },
      { chave: "proprietario", rotulo: "Código Proprietário", alinhar: "direita" },
      { chave: "proprietario_2", rotulo: "Proprietário", largura: 240 },
      { chave: "tipo_de_propriedade", rotulo: "Tipo", alinhar: "centro" },
      { chave: "area_ha", rotulo: "Área (ha)", alinhar: "direita" },
      { chave: "cidade", rotulo: "Cidade" },
      { chave: "uf", rotulo: "UF", alinhar: "centro" },
      { chave: "ativo", rotulo: "Ativo", alinhar: "centro" },
    ],
  },
  {
    slug: "fornecedores-prestadores",
    titulo: "Fornecedores e Prestadores",
    arquivos: ["prestadores e fornecedores", "fornecedores e prestadores", "fornecedores", "prestadores"],
    obrigatorias: ["codigo_cliente_forn", "nome"],
    codigo: (d) => texto(d.codigo_cliente_forn),
    nome: (d) => texto(d.nome),
    chaves: ["codigo_cliente_forn"],
    colunas: [
      { chave: "codigo_cliente_forn", rotulo: "Código", alinhar: "direita" },
      { chave: "nome", rotulo: "Nome", largura: 260 },
      { chave: "nome_fantasia", rotulo: "Nome Fantasia", largura: 200 },
      { chave: "cnpj_cpf", rotulo: "CNPJ/CPF" },
      { chave: "cidade", rotulo: "Cidade" },
      { chave: "uf", rotulo: "UF", alinhar: "centro" },
      { chave: "telefone_comercial", rotulo: "Telefone" },
      { chave: "bloqueado", rotulo: "Bloqueado", alinhar: "centro" },
    ],
  },
  {
    slug: "regiao",
    titulo: "Região",
    arquivos: ["regioes", "regiao"],
    obrigatorias: ["regiao", "nome"],
    codigo: (d) => texto(d.regiao),
    nome: (d) => texto(d.nome),
    chaves: ["regiao"],
    colunas: [
      { chave: "regiao", rotulo: "Região", alinhar: "direita" },
      { chave: "nome", rotulo: "Nome", largura: 240 },
    ],
  },
  {
    slug: "bloco",
    titulo: "Bloco",
    arquivos: ["blocos", "bloco", "setores"],
    obrigatorias: ["setor", "descricao", "grau"],
    // o mesmo setor aparece com mais de uma descrição: a chave é o par
    codigo: (d) => `${texto(d.setor)}|${texto(d.descricao)}`,
    nome: (d) => texto(d.descricao),
    chaves: ["setor", "descricao"],
    colunas: [
      { chave: "setor", rotulo: "Setor" },
      { chave: "descricao", rotulo: "Descrição", largura: 280 },
      { chave: "grau", rotulo: "Grau", alinhar: "direita" },
    ],
  },
  {
    slug: "estados",
    titulo: "Estados",
    arquivos: ["estados"],
    obrigatorias: ["sigla_do_estado", "nome_do_estado"],
    codigo: (d) => texto(d.sigla_do_estado),
    nome: (d) => texto(d.nome_do_estado),
    chaves: ["sigla_do_estado"],
    colunas: [
      { chave: "sigla_do_estado", rotulo: "Sigla", alinhar: "centro" },
      { chave: "nome_do_estado", rotulo: "Nome do Estado", largura: 200 },
      { chave: "codigo_u_f", rotulo: "Código UF", alinhar: "direita" },
      { chave: "codigo_ibge", rotulo: "Código IBGE", alinhar: "direita" },
      { chave: "possui_zfm_alc", rotulo: "ZFM/ALC", alinhar: "centro" },
    ],
  },
  {
    slug: "solos",
    titulo: "Solos",
    arquivos: ["solos", "solo"],
    obrigatorias: ["codigo", "descricao", "tipo_de_solo"],
    codigo: (d) => texto(d.codigo),
    nome: (d) => texto(d.descricao),
    chaves: ["codigo"],
    colunas: [
      { chave: "codigo", rotulo: "Código", alinhar: "direita" },
      { chave: "descricao", rotulo: "Descrição", largura: 240 },
      { chave: "tipo_de_solo", rotulo: "Tipo de Solo", alinhar: "direita" },
      { chave: "descricao_do_tipo", rotulo: "Descrição do Tipo", largura: 200 },
      { chave: "acrescimo_de_produtividade", rotulo: "% Acréscimo de Produtividade", alinhar: "direita" },
    ],
  },
  {
    slug: "tipos-solo",
    titulo: "Tipos de Solo",
    arquivos: ["tipo de solo", "tipos de solo", "tipos de solos"],
    obrigatorias: ["codigo", "descricao"],
    codigo: (d) => texto(d.codigo),
    nome: (d) => texto(d.descricao),
    chaves: ["codigo"],
    colunas: [
      { chave: "codigo", rotulo: "Código", alinhar: "direita" },
      { chave: "descricao", rotulo: "Descrição", largura: 240 },
    ],
  },
  {
    slug: "maturacao",
    titulo: "Maturação",
    arquivos: ["maturacao"],
    obrigatorias: ["codigo", "descricao"],
    codigo: (d) => texto(d.codigo),
    nome: (d) => texto(d.descricao),
    chaves: ["codigo"],
    colunas: [
      { chave: "codigo", rotulo: "Código", alinhar: "direita" },
      { chave: "descricao", rotulo: "Descrição", largura: 240 },
    ],
  },
  {
    slug: "variedades",
    titulo: "Variedades",
    arquivos: ["variedades", "variedade"],
    obrigatorias: ["codigo", "descricao", "cortes_previstos"],
    codigo: (d) => texto(d.codigo),
    nome: (d) => texto(d.descricao),
    chaves: ["codigo"],
    colunas: [
      { chave: "codigo", rotulo: "Código", alinhar: "direita" },
      { chave: "descricao", rotulo: "Descrição", largura: 200 },
      { chave: "cortes_previstos", rotulo: "Cortes Previstos", alinhar: "direita" },
      { chave: "mat_tipo_ciclo", rotulo: "Código Maturação", alinhar: "direita" },
      { chave: "descricao_2", rotulo: "Maturação" },
      { chave: "ativa", rotulo: "Ativa", alinhar: "centro" },
    ],
  },
  {
    slug: "ocorrencias",
    titulo: "Ocorrências",
    arquivos: ["ocorrencias", "ocorrencia"],
    obrigatorias: ["codigo", "descricao"],
    codigo: (d) => texto(d.codigo),
    nome: (d) => texto(d.descricao),
    chaves: ["codigo"],
    colunas: [
      { chave: "codigo", rotulo: "Código", largura: 90 },
      { chave: "descricao", rotulo: "Descrição", largura: 320 },
    ],
  },
  {
    slug: "nivel-infestacao",
    titulo: "Nível de Infestação",
    arquivos: ["nivel de infestacao", "niveis de infestacao", "nivel infestacao"],
    obrigatorias: ["codigo", "descricao"],
    codigo: (d) => texto(d.codigo),
    nome: (d) => texto(d.descricao),
    chaves: ["codigo"],
    colunas: [
      { chave: "codigo", rotulo: "Código", largura: 90 },
      { chave: "descricao", rotulo: "Descrição", largura: 320 },
    ],
  },
  {
    slug: "presenca-infestacao",
    titulo: "Presença de Infestação",
    arquivos: ["presenca de infestacao", "presenca infestacao"],
    obrigatorias: ["codigo", "descricao"],
    codigo: (d) => texto(d.codigo),
    nome: (d) => texto(d.descricao),
    chaves: ["codigo"],
    colunas: [
      { chave: "codigo", rotulo: "Código", largura: 90 },
      { chave: "descricao", rotulo: "Descrição", largura: 320 },
    ],
  },
  {
    slug: "prioridade",
    titulo: "Prioridade",
    arquivos: ["prioridade", "prioridades"],
    obrigatorias: ["codigo", "descricao"],
    codigo: (d) => texto(d.codigo),
    nome: (d) => texto(d.descricao),
    chaves: ["codigo"],
    colunas: [
      { chave: "codigo", rotulo: "Código", largura: 90 },
      { chave: "descricao", rotulo: "Descrição", largura: 320 },
    ],
  },
  {
    slug: "responsavel-regiao",
    titulo: "Responsável Região",
    arquivos: ["responsavel regiao", "responsaveis regiao", "responsavel por regiao", "responsaveis"],
    obrigatorias: ["codigo", "nome", "regiao"],
    codigo: (d) => texto(d.codigo),
    nome: (d) => texto(d.nome),
    chaves: ["codigo"],
    colunas: [
      { chave: "codigo", rotulo: "Código", largura: 90 },
      { chave: "nome", rotulo: "Nome", largura: 300 },
      { chave: "regiao", rotulo: "Região (código)", largura: 130 },
    ],
  },
];

export function specPorSlug(slug: string): CadastroSpec | undefined {
  return CADASTROS_SPEC.find((s) => s.slug === slug);
}

/** Cadastro sugerido pelo nome do arquivo ("Tipo de Solo.xlsx" -> tipos-solo). */
export function specPorNomeArquivo(nomeArquivo: string): CadastroSpec | undefined {
  const base = normalizarTexto(nomeArquivo.replace(/\.[^.]+$/, ""));
  return CADASTROS_SPEC.find((s) => s.arquivos.includes(base));
}
