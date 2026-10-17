import { limparNomeFazenda } from "./fazendas";
import { numeroDigitado, prepararOcupacao, TIPOS_AREA_OCUPACAO, validarOcupacao } from "./ocupacao";

/** Valor de uma célula já normalizado: texto sem espaços sobrando, número ou "" */
/** minúsculas, sem acento e sem pontuação: "Código Cliente/Forn." -> "codigo cliente forn" */
export function normalizarTexto(s) {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const texto = (v) => (v === undefined ? "" : String(v)).trim();

export const CADASTROS_SPEC = [
  {
    slug: "fazendas",
    titulo: "Fazenda",
    // "Cadastro de Propriedade" sai do sistema como "ExportWWTCN02TExportToExcel"
    arquivos: ["fazendas", "propriedades", "cadastro de propriedade", "exportwwtcn02texporttoexcel"],
    obrigatorias: ["propriedade", "sequencia", "fundo_agricola"],
    codigo: (d) => `${texto(d.propriedade)}${Number(d.sequencia) ? `-${texto(d.sequencia)}` : ""}`,
    nome: (d) => texto(d.fundo_agricola),
    chaves: ["propriedade", "sequencia"],
    ajuste: {
      rotulo: "Corrigir Descrição Fazenda",
      descricao: "Tira números, espaços e traços antes do nome (ex.: “9386 - FAZ. NOSSA SENHORA” → “FAZ. NOSSA SENHORA”).",
      aplicar: (d) => ({ ...d, fundo_agricola: limparNomeFazenda(texto(d.fundo_agricola), texto(d.propriedade)) }),
    },
    // todas as colunas do relatório "Cadastro de Propriedade", na ordem dele (as duas sem título são o nome do
    // Fornecedor e a descrição do Preço da Cana); Tipo Propriedade = descrição da Classificação Proprietário no
    // cadastro Tipo Propriedade (lida na hora, acompanha o que mudar lá)
    colunas: [
      { chave: "propriedade", rotulo: "Propriedade", alinhar: "direita" },
      { chave: "sequencia", rotulo: "Seq.", alinhar: "direita" },
      { chave: "fundo_agricola", rotulo: "Descrição Fazenda", largura: 260 },
      { chave: "tipo_do_proprietario", rotulo: "Tipo do Proprietário", alinhar: "centro" },
      { chave: "proprietario", rotulo: "Código Proprietário", alinhar: "direita" },
      { chave: "proprietario_2", rotulo: "Proprietário", largura: 240 },
      { chave: "classificacao_proprietario", rotulo: "Classificação Proprietário", alinhar: "centro", ref: "tipo-propriedade", refLivre: true },
      { chave: "classificacao_proprietario_nm", rotulo: "Tipo Propriedade", largura: 150, derivada: true },
      { chave: "tipo_de_propriedade", rotulo: "Tipo de Propriedade (S/F)", alinhar: "centro" },
      { chave: "distancia_da_usina", rotulo: "Distância da Usina", alinhar: "direita" },
      { chave: "cod_receita", rotulo: "Cód. Receita" },
      { chave: "inscr_produtor_rural", rotulo: "Inscr. Produtor Rural", largura: 150 },
      { chave: "incra", rotulo: "Incra", largura: 140 },
      { chave: "data_decap", rotulo: "Data DECAP", alinhar: "centro" },
      { chave: "area_ha", rotulo: "Área (ha)", alinhar: "direita" },
      { chave: "area_alq", rotulo: "Área (alq)", alinhar: "direita" },
      { chave: "area_contratada_ha", rotulo: "Área Contratada (ha)", alinhar: "direita" },
      { chave: "area_contratada_alq", rotulo: "Área Contratada (alq)", alinhar: "direita" },
      { chave: "area_inutilizada", rotulo: "Área Inutilizada", alinhar: "direita" },
      { chave: "nirf", rotulo: "NIRF" },
      { chave: "mapa", rotulo: "Mapa" },
      { chave: "sec_meio_ambiente", rotulo: "Sec. Meio Ambiente" },
      { chave: "eixo_x", rotulo: "Eixo X", alinhar: "direita" },
      { chave: "eixo_z", rotulo: "Eixo Z", alinhar: "direita" },
      { chave: "eixo_y", rotulo: "Eixo Y", alinhar: "direita" },
      { chave: "latitude", rotulo: "Latitude", alinhar: "direita" },
      { chave: "longitude", rotulo: "Longitude", alinhar: "direita" },
      { chave: "elegivel_para_renovabio", rotulo: "Elegível para Renovabio", alinhar: "centro" },
      { chave: "fornecedor", rotulo: "% Fornecedor", alinhar: "direita" },
      { chave: "fornecedor_2", rotulo: "Código Fornecedor", alinhar: "direita" },
      { chave: "col_30", rotulo: "Fornecedor", largura: 240 },
      { chave: "cnpj", rotulo: "CNPJ / CPF", largura: 150 },
      { chave: "inscricao_estadual", rotulo: "Inscrição Estadual", largura: 140 },
      { chave: "logradouro", rotulo: "Logradouro", largura: 220 },
      { chave: "bairro", rotulo: "Bairro", largura: 160 },
      { chave: "cidade", rotulo: "Cidade" },
      { chave: "uf", rotulo: "UF", alinhar: "centro" },
      { chave: "cep", rotulo: "CEP" },
      { chave: "inss", rotulo: "INSS" },
      { chave: "preco_da_cana", rotulo: "Preço da Cana", alinhar: "direita" },
      { chave: "col_40", rotulo: "Descrição Preço da Cana", largura: 170 },
      { chave: "grupo_de_taxa", rotulo: "Grupo de Taxa", alinhar: "direita" },
      { chave: "descricao_da_taxa", rotulo: "Descrição da Taxa", largura: 220 },
      { chave: "grupo_taxa_frete", rotulo: "Grupo Taxa (Frete)", alinhar: "direita" },
      { chave: "descricao_grupo_taxa", rotulo: "Descrição Grupo Taxa", largura: 220 },
      { chave: "observacao_nf", rotulo: "Observação NF", alinhar: "direita" },
      { chave: "descricao_observacao_nf", rotulo: "Descrição Observação NF", largura: 220 },
      { chave: "obs_nf_complem", rotulo: "Obs NF Complem.", alinhar: "direita" },
      { chave: "descricao_obs_nf_complem", rotulo: "Descrição Obs NF Complem.", largura: 220 },
      { chave: "grupo_frete", rotulo: "Grupo Frete", alinhar: "direita" },
      { chave: "descricao_grupo_frete", rotulo: "Descrição Grupo Frete", largura: 180 },
      { chave: "c_c_t", rotulo: "C.C.T.", alinhar: "direita" },
      { chave: "descricao_c_c_t", rotulo: "Descrição C.C.T.", largura: 180 },
      { chave: "centro_de_custo", rotulo: "Centro de Custo", alinhar: "direita" },
      { chave: "descricao_centro_de_custo", rotulo: "Descrição Centro de Custo", largura: 200 },
      { chave: "agrupamento", rotulo: "Agrupamento", alinhar: "direita" },
      { chave: "descricao_agrupamento", rotulo: "Descrição Agrupamento", largura: 180 },
      { chave: "utiliza_faturamento_de_cana", rotulo: "Utiliza Faturamento de Cana", alinhar: "centro" },
      { chave: "paga_analise", rotulo: "Paga Análise?", alinhar: "centro" },
      { chave: "ajuste_final_de_safra", rotulo: "Ajuste Final de Safra", alinhar: "centro" },
      { chave: "ativo", rotulo: "Ativo (planilha)", alinhar: "centro" },
      { chave: "permite_entrada_de_cana_sem_pedido", rotulo: "Permite Entrada de Cana sem Pedido", alinhar: "centro" },
      { chave: "financeiro_cct", rotulo: "Financeiro CCT", alinhar: "centro" },
      { chave: "atr_relativo", rotulo: "ATR Relativo", alinhar: "direita" },
      { chave: "atr_usina", rotulo: "ATR Usina", alinhar: "direita" },
      { chave: "pureza", rotulo: "Pureza", alinhar: "direita" },
      { chave: "pureza_usina", rotulo: "Pureza Usina", alinhar: "direita" },
      { chave: "cct_total_da_propriedade", rotulo: "CCT Total da Propriedade", alinhar: "direita" },
      { chave: "retencao", rotulo: "Retenção", alinhar: "centro" },
      { chave: "utiliza_controle_de_fornecimento", rotulo: "Utiliza Controle de Fornecimento", alinhar: "centro" },
      { chave: "atr_cf", rotulo: "ATR CF", alinhar: "direita" },
      { chave: "propriedade_certificada_pelo_copersucar", rotulo: "Propriedade Certificada pelo Copersucar", alinhar: "centro" },
      { chave: "gera_txt_sistema_atr", rotulo: "Gera TXT - Sistema ATR", alinhar: "centro" },
      { chave: "retencao_2", rotulo: "% Retenção", alinhar: "direita" },
      { chave: "complemento", rotulo: "% Complemento", alinhar: "direita" },
      { chave: "fixo_analise", rotulo: "% Fixo Análise", alinhar: "direita" },
      { chave: "retencao_cf", rotulo: "% Retenção CF", alinhar: "direita" },
      { chave: "nivel_desempenho", rotulo: "% Nível Desempenho", alinhar: "direita" },
      { chave: "producao_estimada", rotulo: "Produção Estimada", alinhar: "direita" },
      { chave: "data_de_revisao", rotulo: "Data de Revisão", alinhar: "centro" },
      { chave: "data_de_validade", rotulo: "Data de Validade", alinhar: "centro" },
    ],
  },
  {
    // tipos de propriedade da fazenda (Próprio, Parceria, Fornecedor…): o código é a Classificação Proprietário do
    // Cadastro de Propriedade (P, R, F)
    slug: "tipo-propriedade",
    titulo: "Tipo Propriedade",
    arquivos: ["tipo propriedade", "tipos de propriedade", "tipo de propriedade", "tipos propriedade"],
    obrigatorias: ["codigo", "descricao"],
    codigo: (d) => texto(d.codigo).toUpperCase(),
    nome: (d) => texto(d.descricao),
    chaves: ["codigo"],
    colunas: [
      { chave: "codigo", rotulo: "Código", alinhar: "centro", largura: 90 },
      { chave: "descricao", rotulo: "Descrição", largura: 280 },
    ],
  },
  {
    // faixas de código de talhão ou de parte → tipo de área (base Fazenda e Talhões e apontamentos)
    slug: "ocupacao",
    titulo: "Ocupação",
    arquivos: ["ocupacao", "ocupacoes", "01 ocupacoes talhoes areas", "ocupacoes talhoes areas"],
    obrigatorias: ["codigo", "descricao"],
    codigo: (d) => texto(d.codigo),
    nome: (d) => texto(d.descricao),
    chaves: ["codigo"],
    // a planilha original traz "De 01 a 800" no código, a faixa de parte em RANGER/PARTE e o tipo em TIPO
    preparar: prepararOcupacao,
    validar: validarOcupacao,
    colunas: [
      { chave: "codigo", rotulo: "Código", largura: 90 },
      { chave: "descricao", rotulo: "Descrição", largura: 340 },
      { chave: "talhao_de", rotulo: "Talhão de", alinhar: "direita", numero: true },
      { chave: "talhao_ate", rotulo: "Talhão até", alinhar: "direita", numero: true },
      { chave: "parte_de", rotulo: "Parte de", alinhar: "direita", numero: true },
      { chave: "parte_ate", rotulo: "Parte até", alinhar: "direita", numero: true },
      { chave: "tipo_de_area", rotulo: "Tipo de área", largura: 330, opcoes: TIPOS_AREA_OCUPACAO },
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
      { chave: "regiao", rotulo: "Região (código)", largura: 130, ref: "regiao" },
      { chave: "regiao_nm", rotulo: "Descrição da Região", largura: 220, derivada: true },
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
      { chave: "regiao", rotulo: "Região (código)", largura: 130, ref: "regiao" },
      { chave: "regiao_nm", rotulo: "Descrição da Região", largura: 220, derivada: true },
    ],
  },
  {
    slug: "materiais-insumos",
    titulo: "Material e Insumos",
    // o relatório sai do sistema como "ExportTCO13TExportToExcel-NNNN"
    arquivos: ["materiais e insumos", "material e insumos", "produtos", "materiais", "exporttco13texporttoexcel"],
    obrigatorias: ["codigo", "descricao", "grupo_de_produto", "unidade_medida_consumo"],
    codigo: (d) => texto(d.codigo),
    nome: (d) => texto(d.descricao),
    chaves: ["codigo"],
    grande: true,
    abas: [
      { id: "insumos", rotulo: "Insumos", descricao: "Grupos 01.02.00 a 01.02.35 (defensivos, adjuvantes, fertilizantes…), com os dados de aplicação." },
      { id: "materiais", rotulo: "Materiais", descricao: "Os demais grupos do cadastro." },
    ],
    colunas: [
      { chave: "codigo", rotulo: "Código", alinhar: "direita" },
      { chave: "descricao", rotulo: "Descrição", largura: 300 },
      { chave: "nome_comercial", rotulo: "Nome Comercial", largura: 160, aba: "insumos" },
      { chave: "principio_ativo", rotulo: "Princípio Ativo", largura: 260, aba: "insumos" },
      { chave: "concentracao", rotulo: "Concentração", largura: 150, aba: "insumos" },
      { chave: "classe_agronomica", rotulo: "Classe Agronômica", largura: 170, aba: "insumos" },
      { chave: "categoria", rotulo: "Categoria", largura: 170, aba: "insumos" },
      { chave: "un_aplicacao", rotulo: "Un. Aplicação", alinhar: "centro", aba: "insumos" },
      { chave: "descricao_complementar_1", rotulo: "Descrição Complementar", largura: 220, aba: "materiais" },
      { chave: "grupo_de_produto", rotulo: "Grupo" },
      { chave: "unidade_medida_consumo", rotulo: "UM", alinhar: "centro" },
      { chave: "tipo_de_produto", rotulo: "Tipo de Produto" },
    ],
  },
  {
    slug: "etapa",
    titulo: "Etapa",
    arquivos: ["etapa", "etapas"],
    obrigatorias: ["codigo_da_etapa", "descricao_da_etapa"],
    codigo: (d) => texto(d.codigo_da_etapa),
    nome: (d) => texto(d.descricao_da_etapa),
    chaves: ["codigo_da_etapa"],
    colunas: [
      { chave: "codigo_da_etapa", rotulo: "Código", alinhar: "direita", largura: 90 },
      { chave: "descricao_da_etapa", rotulo: "Descrição da Etapa", largura: 300 },
      { chave: "ativa", rotulo: "Ativa", alinhar: "centro" },
    ],
  },
  {
    slug: "tipo-aplicacao",
    titulo: "Tipo Aplicação",
    // "Tipos de aplicações agrícolas" sai do sistema como "ExportWWTAG55TExportToExcel"
    arquivos: ["tipo aplicacao", "tipos de aplicacao", "tipo de aplicacao", "tipos de aplicacoes agricolas", "exportwwtag55texporttoexcel"],
    obrigatorias: ["codigo", "descricao"],
    // o mesmo código aparece com mais de uma descrição (ex.: 14 Aplicação Localizada e 14 Colheitabilidade): a chave é o par
    codigo: (d) => `${texto(d.codigo)}|${texto(d.descricao)}`,
    nome: (d) => texto(d.descricao),
    chaves: ["codigo", "descricao"],
    colunas: [
      { chave: "codigo", rotulo: "Código", alinhar: "direita", largura: 90 },
      { chave: "descricao", rotulo: "Descrição", largura: 320 },
    ],
  },
  {
    slug: "classificacao-operacoes",
    titulo: "Classificação de Operações",
    // sai do sistema como "ExportWWTSC41TExportToExcel"
    arquivos: ["classificacao de operacoes", "classificacoes de operacoes", "exportwwtsc41texporttoexcel"],
    obrigatorias: ["codigo", "descricao", "producao_da_operacao"],
    codigo: (d) => texto(d.codigo),
    nome: (d) => texto(d.descricao),
    chaves: ["codigo"],
    colunas: [
      { chave: "codigo", rotulo: "Código", alinhar: "direita", largura: 90 },
      { chave: "descricao", rotulo: "Descrição", largura: 280 },
      { chave: "producao_da_operacao", rotulo: "Produção da Operação", alinhar: "direita", largura: 160 },
    ],
  },
  {
    slug: "tipos-despesa",
    titulo: "Tipos de Despesa",
    // sai do sistema como "ExportWWTSC39TExportToExcel" (cada tipo repetido uma vez por safra do rateio)
    arquivos: ["tipos de despesa", "tipos de despesas", "tipo de despesa", "exportwwtsc39texporttoexcel"],
    obrigatorias: ["codigo", "descricao", "forma_de_amortizacao"],
    codigo: (d) => texto(d.codigo),
    nome: (d) => texto(d.descricao),
    chaves: ["codigo"],
    colunas: [
      { chave: "codigo", rotulo: "Código", alinhar: "direita", largura: 90 },
      { chave: "descricao", rotulo: "Descrição", largura: 260 },
      { chave: "forma_de_amortizacao", rotulo: "Forma de Amortização", alinhar: "centro", largura: 170 },
      { chave: "total_do_percentual", rotulo: "Total do Percentual", alinhar: "direita", largura: 150 },
    ],
  },
  {
    slug: "operacoes",
    titulo: "Operações",
    // sai do sistema como "ExportWWTSC42TExportToExcel"
    arquivos: ["operacoes", "operacao", "exportwwtsc42texporttoexcel"],
    obrigatorias: ["codigo", "descricao_da_operacao", "unidade_de_medida"],
    codigo: (d) => texto(d.codigo),
    nome: (d) => texto(d.descricao_da_operacao),
    chaves: ["codigo"],
    colunas: [
      { chave: "codigo", rotulo: "Código", alinhar: "direita", largura: 90 },
      { chave: "descricao_da_operacao", rotulo: "Descrição da Operação", largura: 320 },
      // a descrição vem do cadastro Tipo Operação; o código não é barrado (o relatório exportado traz D, O, P e R)
      { chave: "tipo", rotulo: "Tipo", alinhar: "centro", ref: "tipos-operacao", refLivre: true },
      { chave: "tipo_nm", rotulo: "Tipo Operação", largura: 150, derivada: true },
      { chave: "grupo", rotulo: "Grupo" },
      { chave: "descricao_do_grupo", rotulo: "Descrição do Grupo", largura: 220 },
      { chave: "grau", rotulo: "Grau", alinhar: "direita" },
      { chave: "unidade_de_medida", rotulo: "UM", alinhar: "centro" },
      { chave: "descricao_unidade_de_medida", rotulo: "Descrição UM", largura: 130 },
      // o 2º "Código" do relatório é o da Classificação de Operações
      { chave: "codigo_2", rotulo: "Classificação (código)", alinhar: "direita", largura: 150, ref: "classificacao-operacoes" },
      { chave: "codigo_2_nm", rotulo: "Classificação", largura: 160, derivada: true },
      { chave: "codigo_da_etapa", rotulo: "Código da Etapa", alinhar: "direita" },
      { chave: "descricao_da_etapa", rotulo: "Descrição da Etapa", largura: 220 },
      { chave: "codigo_de_despesa", rotulo: "Tipo de Despesa (código)", alinhar: "direita", largura: 160, ref: "tipos-despesa" },
      { chave: "codigo_de_despesa_nm", rotulo: "Tipo de Despesa", largura: 160, derivada: true },
      { chave: "centro_de_custo", rotulo: "Centro de Custo", alinhar: "direita" },
      { chave: "nome_do_centro_de_custo", rotulo: "Nome do Centro de Custo", largura: 200 },
      { chave: "valor_unitario", rotulo: "Valor Unitário", alinhar: "direita" },
      { chave: "vinculo_c_operacao_agricola_realizada_por_terceiros", rotulo: "Vínculo c/ Operação de Terceiros", alinhar: "direita", largura: 200 },
      { chave: "descricao_do_vinculo", rotulo: "Descrição do Vínculo", largura: 180 },
    ],
  },
  {
    slug: "recursos",
    titulo: "Recurso",
    arquivos: ["recurso", "recursos"],
    obrigatorias: ["codigo", "descricao"],
    codigo: (d) => texto(d.codigo),
    nome: (d) => texto(d.descricao),
    chaves: ["codigo"],
    colunas: [
      { chave: "codigo", rotulo: "Código", alinhar: "direita", largura: 110 },
      { chave: "descricao", rotulo: "Descrição", largura: 360 },
    ],
  },
  {
    slug: "grupos-operacoes",
    titulo: "Grupos de Operações",
    arquivos: ["grupos de operacoes", "grupo de operacoes", "grupos das operacoes"],
    obrigatorias: ["operacao", "grupo"],
    codigo: (d) => texto(d.operacao),
    nome: (d) => texto(d.grupo_nm) || texto(d.grupo),
    chaves: ["operacao"],
    colunas: [
      {
        chave: "operacao",
        rotulo: "Operação (código)",
        alinhar: "direita",
        largura: 140,
        ref: "operacoes",
        traz: { classificacao: { campo: "codigo_2", ref: "classificacao-operacoes" } },
      },
      { chave: "operacao_nm", rotulo: "Operação", largura: 300, derivada: true },
      { chave: "classificacao", rotulo: "Classificação da Operação", largura: 190, derivada: true },
      // grupo do cadastro Grupo Op. Dashboard: aceita o código ou o nome do grupo (planilha) e guarda o código
      { chave: "grupo", rotulo: "Grupo (código)", alinhar: "direita", largura: 120, ref: "grupos-dashboard", aceitaNome: true, traz: { ordem: "ordem" } },
      { chave: "grupo_nm", rotulo: "Grupo (Dashboard de Atividades)", largura: 240, derivada: true },
      { chave: "ordem", rotulo: "Ordem do grupo", alinhar: "direita", largura: 120, derivada: true },
    ],
  },
  {
    // grupos das operações no Dashboard de Atividades (a ordem é a das linhas no dashboard e no PDF)
    slug: "grupos-dashboard",
    titulo: "Grupo Op. Dashboard",
    arquivos: ["grupo op dashboard", "grupos op dashboard", "grupos do dashboard", "grupo do dashboard"],
    obrigatorias: ["codigo", "grupo"],
    codigo: (d) => texto(d.codigo),
    nome: (d) => texto(d.grupo).toUpperCase(),
    chaves: ["codigo"],
    // o mesmo grupo não fica em dois códigos, nem com outra grafia (acento, maiúsculas, espaços)
    nomeUnico: true,
    colunas: [
      { chave: "codigo", rotulo: "Código", alinhar: "direita", largura: 100 },
      { chave: "grupo", rotulo: "Grupo", largura: 300 },
      { chave: "ordem", rotulo: "Ordem no dashboard", alinhar: "direita", largura: 150 },
    ],
  },
  {
    slug: "tipos-operacao",
    titulo: "Tipo Operação",
    arquivos: ["tipo operacao", "tipos operacao", "tipo de operacao", "tipos de operacao"],
    obrigatorias: ["codigo", "tipo_operacao"],
    codigo: (d) => texto(d.codigo),
    nome: (d) => texto(d.tipo_operacao),
    chaves: ["codigo"],
    colunas: [
      { chave: "codigo", rotulo: "Código", alinhar: "centro", largura: 100 },
      { chave: "tipo_operacao", rotulo: "Tipo Operação", largura: 320 },
    ],
  },
  {
    slug: "responsaveis-os",
    titulo: "Responsáveis",
    arquivos: ["responsaveis os", "responsaveis o s", "cadastro responsaveis", "responsaveis das os"],
    obrigatorias: ["area", "matricula", "nome_do_responsavel"],
    codigo: (d) => texto(d.matricula),
    nome: (d) => texto(d.nome_do_responsavel),
    chaves: ["matricula"],
    colunas: [
      { chave: "matricula", rotulo: "Matrícula", alinhar: "direita", largura: 110 },
      { chave: "nome_do_responsavel", rotulo: "Nome do Responsável", largura: 300 },
      { chave: "area", rotulo: "Área", largura: 220 },
    ],
  },
  {
    slug: "faixas-dias-os",
    titulo: "Faixas Dias",
    arquivos: ["faixas dias", "faixas de dias"],
    obrigatorias: ["faixa", "de_dias"],
    codigo: (d) => texto(d.faixa),
    nome: (d) => texto(d.descricao),
    chaves: ["faixa"],
    colunas: [
      { chave: "faixa", rotulo: "Ordem", alinhar: "direita", largura: 80 },
      { chave: "descricao", rotulo: "Descrição", largura: 240 },
      { chave: "de_dias", rotulo: "De (dias)", alinhar: "direita", largura: 100 },
      { chave: "ate_dias", rotulo: "Até (dias) — vazio = sem limite", alinhar: "direita", largura: 200 },
    ],
  },
  {
    slug: "funcionarios",
    titulo: "Funcionários",
    // o relatório de Pessoas sai do sistema como "ExportWWTFR05TExportToExcel"
    arquivos: ["funcionarios", "pessoas", "exportwwtfr05texporttoexcel"],
    obrigatorias: ["pessoa", "nome_pessoa", "matricula"],
    codigo: (d) => texto(d.pessoa),
    nome: (d) => texto(d.nome_pessoa),
    chaves: ["pessoa"],
    grande: true,
    colunas: [
      { chave: "pessoa", rotulo: "Pessoa", alinhar: "direita", largura: 90 },
      { chave: "nome_pessoa", rotulo: "Nome", largura: 280 },
      { chave: "matricula", rotulo: "Matrícula", alinhar: "direita" },
      { chave: "ativo", rotulo: "Ativo", alinhar: "centro" },
      { chave: "motivo_da_inatividade", rotulo: "Motivo da Inatividade", largura: 160 },
      { chave: "descricao", rotulo: "Hora / Função", largura: 160 },
      { chave: "centro_de_custo", rotulo: "Centro de Custo", alinhar: "direita" },
      { chave: "nome_centro_de_custo", rotulo: "Nome do Centro de Custo", largura: 200 },
      { chave: "codigo_da_frente", rotulo: "Frente", alinhar: "direita" },
      { chave: "descricao_da_frente", rotulo: "Descrição da Frente", largura: 180 },
      { chave: "nome_do_empregador", rotulo: "Empregador", largura: 240 },
      { chave: "interna_externa", rotulo: "Interna / Externa", alinhar: "centro" },
      { chave: "tipo_pessoa", rotulo: "Tipo Pessoa", alinhar: "centro" },
    ],
  },
  {
    // quem assina o termo (Comunicado de Saída de Insumo) dos empréstimos, na ordem do nível hierárquico (1 primeiro);
    // fica em Insumos › Empréstimos › Assinaturas (não é ligado ao cadastro de Funcionários)
    slug: "assinaturas-emprestimo",
    titulo: "Assinaturas",
    arquivos: ["assinaturas", "assinaturas emprestimo", "assinaturas dos emprestimos"],
    obrigatorias: ["responsavel", "ordem"],
    codigo: (d) => texto(d.responsavel).replace(/\s+/g, " ").toUpperCase(),
    nome: (d) => texto(d.responsavel).replace(/\s+/g, " "),
    chaves: ["responsavel"],
    // a lista na ordem do nível hierárquico (como saem no termo)
    ordenarPor: "ordem",
    colunas: [
      { chave: "responsavel", rotulo: "Responsável", largura: 300 },
      { chave: "funcao", rotulo: "Função", largura: 260 },
      { chave: "ordem", rotulo: "Ordem (nível hierárquico)", alinhar: "direita", largura: 190, numero: true },
    ],
    validar: (d) => {
      const n = Number(d.ordem);
      return Number.isInteger(n) && n >= 1 && n <= 99 ? null : "Ordem: informe o nível hierárquico (1 = o primeiro a assinar, 2, 3…).";
    },
  },
  // ---------------------------------------------------------------------------------------------------------------
  // Equipamentos (Cadastros › Equipamentos): os relatórios do sistema de frota, com todas as colunas na ordem deles
  // ---------------------------------------------------------------------------------------------------------------
  {
    slug: "veiculos",
    titulo: "Veículos",
    // "Cadastro de veículos" sai do sistema como "ExportWWTFR02TExportToExcel"
    arquivos: ["veiculos", "veiculo", "cadastro de veiculos", "exportwwtfr02texporttoexcel"],
    obrigatorias: ["veiculo", "descricao_veiculo"],
    codigo: (d) => texto(d.veiculo),
    nome: (d) => texto(d.descricao_veiculo),
    chaves: ["veiculo"],
    grande: true,
    // marca, modelo, especialidade e combustível apontam para os outros cadastros de Equipamentos (a descrição da
    // especialidade e do combustível vem de lá, lida na hora; marca e modelo já vêm descritos no relatório)
    colunas: [
      { chave: "veiculo", rotulo: "Veículo", alinhar: "direita" },
      { chave: "descricao_veiculo", rotulo: "Descrição Veículo", largura: 280 },
      { chave: "tipo_de_veiculo", rotulo: "Tipo de Veículo", alinhar: "direita" },
      { chave: "descricao", rotulo: "Descrição Tipo de Veículo", largura: 200 },
      { chave: "renavan", rotulo: "Renavan" },
      { chave: "marca", rotulo: "Marca (código)", alinhar: "direita", ref: "marcas", refLivre: true },
      { chave: "descricao_marca", rotulo: "Descrição Marca", largura: 160 },
      { chave: "modelo", rotulo: "Modelo (código)", alinhar: "direita", ref: "modelos", refLivre: true },
      { chave: "modelo_2", rotulo: "Descrição Modelo", largura: 200 },
      { chave: "pivo", rotulo: "Pivô", alinhar: "direita" },
      { chave: "placa", rotulo: "Placa" },
      { chave: "uf_placa", rotulo: "UF Placa" },
      { chave: "chassis", rotulo: "Chassis", largura: 170 },
      { chave: "ativo", rotulo: "Ativo (planilha)", alinhar: "centro" },
      { chave: "nro_serie", rotulo: "Nro Serie" },
      { chave: "ano_fabricacao", rotulo: "Ano Fabricação", alinhar: "direita" },
      { chave: "ano_de_modelo", rotulo: "Ano de Modelo", alinhar: "direita" },
      { chave: "cor", rotulo: "Cor" },
      { chave: "cilindros", rotulo: "Cilindros", alinhar: "direita" },
      { chave: "tipo_do_motor", rotulo: "Tipo do Motor" },
      { chave: "numero_do_motor", rotulo: "Número do Motor", largura: 170 },
      { chave: "potencia", rotulo: "Potência" },
      { chave: "km_hora", rotulo: "Km/Hora", alinhar: "centro" },
      { chave: "custo_hora", rotulo: "Custo /Hora", alinhar: "direita" },
      { chave: "categoria", rotulo: "Categoria", alinhar: "centro" },
      { chave: "responsavel", rotulo: "Responsável", alinhar: "direita" },
      { chave: "nome_do_responsavel", rotulo: "Nome do Responsável", largura: 240 },
      { chave: "km_hora_atual", rotulo: "KM/Hora Atual" },
      { chave: "dt_da_ultima_afericao", rotulo: "Dt da Última Aferição", alinhar: "centro" },
      { chave: "n_de_eixo", rotulo: "Nº de Eixo", alinhar: "direita" },
      { chave: "veiculo_alienado", rotulo: "Veículo Alienado", alinhar: "centro" },
      { chave: "capacidade_de_carga", rotulo: "Capacidade de Carga", alinhar: "direita" },
      { chave: "tara_padrao", rotulo: "Tara Padrão", alinhar: "direita" },
      { chave: "centro_de_custo", rotulo: "Centro de Custo", alinhar: "direita" },
      { chave: "houve_manutencao_horimetro", rotulo: "Houve Manutenção Horímetro", alinhar: "centro" },
      { chave: "data_de_aquisicao_do_veiculo", rotulo: "Data de Aquisição do Veículo", alinhar: "centro" },
      { chave: "km_h_garantia_veiculo", rotulo: "KM/H Garantia Veículo" },
      { chave: "meses_grantia_do_veiculo", rotulo: "Meses Garantia do Veículo", alinhar: "direita" },
      { chave: "km_h_garantida_componentes", rotulo: "KM/H Garantida Componentes" },
      { chave: "meses_garantia_componentes", rotulo: "Meses Garantia Componentes", alinhar: "direita" },
      { chave: "especialidade_atual", rotulo: "Especialidade Atual (código)", alinhar: "direita", ref: "especialidades", refLivre: true },
      { chave: "especialidade_atual_nm", rotulo: "Descrição Especialidade", largura: 200, derivada: true },
      { chave: "implemento", rotulo: "Implemento", alinhar: "centro" },
      { chave: "empresa_da_folha", rotulo: "Empresa da Folha", alinhar: "direita" },
      { chave: "mes_licenciamento", rotulo: "Mês Licenciamento", alinhar: "direita" },
      { chave: "servico_para_frete", rotulo: "Serviço para Frete", alinhar: "direita" },
      { chave: "km_por_hora", rotulo: "Km por Hora", alinhar: "direita" },
      { chave: "empresa_txt", rotulo: "Empresa TXT", alinhar: "direita" },
      { chave: "empresa_estoque", rotulo: "Empresa Estoque", alinhar: "direita" },
      { chave: "frente", rotulo: "Frente", alinhar: "direita" },
      { chave: "item_do_ativo", rotulo: "Item do Ativo", alinhar: "direita" },
      { chave: "sequencia_do_item_ativo", rotulo: "Sequencia do Item Ativo", alinhar: "direita" },
      { chave: "vida_atual_km_h", rotulo: "Vida Atual KM/H", alinhar: "direita" },
      { chave: "media_padrao", rotulo: "Media Padrao", alinhar: "direita" },
      { chave: "projecao_da_vida", rotulo: "Projeção da Vida", alinhar: "direita" },
      { chave: "medidor_quebrado", rotulo: "Medidor Quebrado", alinhar: "direita" },
      { chave: "frente_de_destino", rotulo: "Frente de Destino", alinhar: "direita" },
      { chave: "ultima_pesagem", rotulo: "Ultima Pesagem" },
      { chave: "tara_padrao_com_carreta", rotulo: "Tara Padrao com Carreta", alinhar: "direita" },
      { chave: "utiliza_movimentacao_veiculo", rotulo: "Utiliza Movimentação Veículo", alinhar: "direita" },
      { chave: "tag_balanca", rotulo: "Tag Balança" },
      { chave: "quantidade_de_furos_para_analise", rotulo: "Quantidade de Furos para Análise", alinhar: "direita" },
      { chave: "fornecedor_contratante", rotulo: "Fornecedor Contratante", alinhar: "direita" },
      { chave: "escritorio_contabil", rotulo: "Escritório Contábil", alinhar: "direita" },
      { chave: "frota_n", rotulo: "Frota N", alinhar: "direita" },
      { chave: "div_01", rotulo: "DIV 01" },
      { chave: "div_02", rotulo: "DIV 02" },
      { chave: "div_03", rotulo: "DIV 03" },
      { chave: "veiculo_de_correlacao", rotulo: "Veículo de Correlação", alinhar: "direita" },
      { chave: "preco_combustivel", rotulo: "Preço Combustível", alinhar: "direita" },
      { chave: "cota_mensal_de_combustivel", rotulo: "Cota Mensal de Combustível", alinhar: "direita" },
      { chave: "cota_isenta", rotulo: "Cota Isenta", alinhar: "direita" },
      { chave: "faixa_para_exedente_da_conta", rotulo: "Faixa para Excedente da Conta", alinhar: "direita" },
      { chave: "capacidade_do_tanque", rotulo: "Capacidade do Tanque", alinhar: "direita" },
      { chave: "requisicao_do_posto", rotulo: "Requisição do Posto", alinhar: "direita" },
      { chave: "realiza_controle_de_medidor", rotulo: "Realiza Controle de Medidor", alinhar: "direita" },
      { chave: "lanca_posto", rotulo: "Lança Posto", alinhar: "centro" },
      { chave: "combustivel", rotulo: "Combustível (código)", alinhar: "centro", ref: "tipos-combustivel", refLivre: true },
      { chave: "combustivel_nm", rotulo: "Descrição Combustível", largura: 200, derivada: true },
      { chave: "utiliza_preco_variavel", rotulo: "Utiliza Preço Variável", alinhar: "direita" },
      { chave: "garantia_venal", rotulo: "Garantia Venal", alinhar: "direita" },
      { chave: "valo_da_aquisicao", rotulo: "Valor da Aquisição", alinhar: "direita" },
      { chave: "percentual_residual", rotulo: "Percentual Residual", alinhar: "direita" },
      { chave: "valor_total_da_depreciacao", rotulo: "Valor Total da Depreciação", alinhar: "direita" },
      { chave: "vida_estimada_km_h", rotulo: "Vida Estimada KM/H", alinhar: "direita" },
      { chave: "vida_util", rotulo: "Vida Util", alinhar: "direita" },
      { chave: "depreciacao_por_hora", rotulo: "Depreciação por Hora", alinhar: "direita" },
      { chave: "oficina_comboio_do_veiculo", rotulo: "Oficina (comboio) do veículo", alinhar: "direita" },
      { chave: "cod_veiculo_na_outra_unidade", rotulo: "Cód. Veículo na Outra Unidade", alinhar: "direita" },
      { chave: "integra_com_seguranca_do_trabalho", rotulo: "Integra com Segurança do Trabalho", alinhar: "centro" },
      { chave: "bruto_maximo", rotulo: "Bruto Máximo", alinhar: "direita" },
      { chave: "veiculo_para_consumo_automatico", rotulo: "Veículo para Consumo Automático", alinhar: "direita" },
      { chave: "empresa_proprietaria", rotulo: "Empresa Proprietária", alinhar: "direita" },
      { chave: "capacidade_do_transbordo", rotulo: "Capacidade do Transbordo", alinhar: "direita" },
    ],
  },
  {
    slug: "modelos",
    titulo: "Modelos",
    // "Cadastro de modelo de veículos" sai do sistema como "ExportWWTFR33TExportToExcel"
    arquivos: ["modelos", "modelo", "modelos de veiculos", "cadastro de modelo de veiculos", "exportwwtfr33texporttoexcel"],
    obrigatorias: ["modelo", "descricao"],
    codigo: (d) => texto(d.modelo),
    nome: (d) => texto(d.descricao),
    chaves: ["modelo"],
    colunas: [
      { chave: "modelo", rotulo: "Modelo", alinhar: "direita", largura: 90 },
      { chave: "descricao", rotulo: "Descrição", largura: 280 },
      { chave: "ativo", rotulo: "Ativo (planilha)", alinhar: "centro" },
      { chave: "km_hora", rotulo: "KM/Hora", alinhar: "centro" },
      { chave: "custo_hora", rotulo: "Custo Hora", alinhar: "direita" },
      { chave: "horas_disponiveis", rotulo: "Horas Disponíveis", alinhar: "direita" },
    ],
  },
  {
    slug: "marcas",
    titulo: "Marcas",
    // o cadastro de marcas sai do sistema como "ExportTFR36TExportToExcel"
    arquivos: ["marcas", "marca", "marcas de veiculos", "exporttfr36texporttoexcel"],
    obrigatorias: ["marca", "descricao_da_marca"],
    codigo: (d) => texto(d.marca),
    nome: (d) => texto(d.descricao_da_marca),
    chaves: ["marca"],
    colunas: [
      { chave: "marca", rotulo: "Marca", alinhar: "direita", largura: 90 },
      { chave: "descricao_da_marca", rotulo: "Descrição da Marca", largura: 280 },
      { chave: "ativo", rotulo: "Ativo (planilha)", alinhar: "centro" },
    ],
  },
  {
    slug: "especialidades",
    titulo: "Especialidades",
    // o cadastro de especialidades sai do sistema como "ExportTFR11TExportToExcel" (a bloqueada lá entra inativa)
    arquivos: ["especialidades", "especialidade", "exporttfr11texporttoexcel"],
    obrigatorias: ["cod_especialidade", "descricao"],
    codigo: (d) => texto(d.cod_especialidade),
    nome: (d) => texto(d.descricao),
    chaves: ["cod_especialidade"],
    colunas: [
      { chave: "cod_especialidade", rotulo: "Cód. Especialidade", alinhar: "direita", largura: 110 },
      { chave: "descricao", rotulo: "Descrição", largura: 300 },
      { chave: "cod_centro_de_custo", rotulo: "Cód. Centro de Custo", alinhar: "direita" },
      { chave: "nome_centro_de_custo", rotulo: "Nome Centro de Custo", largura: 240 },
      { chave: "bloqueada", rotulo: "Bloqueada", alinhar: "centro" },
      { chave: "indicador_para_custo", rotulo: "Indicador para Custo", alinhar: "direita" },
      { chave: "alocacao_de_custo", rotulo: "Alocação de Custo", alinhar: "direita" },
    ],
  },
  {
    slug: "tipos-combustivel",
    titulo: "Tipos de Combustíveis",
    // "Tipo de Combustivel" sai do sistema como "ExportWWTFR09TExportToExcel"
    arquivos: ["tipos de combustiveis", "tipos de combustivel", "tipo de combustivel", "combustiveis", "exportwwtfr09texporttoexcel"],
    obrigatorias: ["combustivel", "descricao_combustivel"],
    codigo: (d) => texto(d.combustivel),
    nome: (d) => texto(d.descricao_combustivel),
    chaves: ["combustivel"],
    colunas: [
      { chave: "combustivel", rotulo: "Combustível", alinhar: "direita", largura: 100 },
      { chave: "descricao_combustivel", rotulo: "Descrição Combustível", largura: 240 },
      { chave: "codigo_do_produto", rotulo: "Código do Produto", alinhar: "direita" },
      { chave: "desc_produto", rotulo: "Descrição do Produto", largura: 280 },
    ],
  },
];

/**
 * Confere e normaliza os campos de um item antes de gravar: coluna com lista fixa (`opcoes`) aceita só uma das opções
 * (sem diferença de acento/maiúscula; grava o texto da lista), coluna `numero` vira número, e a regra própria do
 * cadastro (`validar`) por último. Devolve { dados } ou { erro }.
 */
export function validarDadosCadastro(spec, dados) {
  const out = { ...dados };
  for (const c of spec.colunas) {
    const v = out[c.chave];
    if (v === undefined || String(v).trim() === "") continue;
    if (c.opcoes) {
      const achada = c.opcoes.find((o) => normalizarTexto(o) === normalizarTexto(String(v)));
      if (!achada) return { erro: `${c.rotulo}: escolha uma das opções (${c.opcoes.join("; ")}).` };
      out[c.chave] = achada;
    }
    if (c.numero) {
      // "1.000" (ponto de milhar) = 1000; "1,5" = 1.5
      const x = numeroDigitado(v);
      if (x === null) return { erro: `${c.rotulo}: informe um número.` };
      out[c.chave] = x;
    }
  }
  const erro = spec.validar ? spec.validar(out) : null;
  return erro ? { erro } : { dados: out };
}

/** O cadastro tem alguma conferência de campo (lista fixa, número ou regra própria). */
export const temValidacao = (spec) => !!spec.validar || spec.colunas.some((c) => c.opcoes || c.numero);

export function specPorSlug(slug) {
  return CADASTROS_SPEC.find((s) => s.slug === slug);
}

/** Cadastro sugerido pelo nome do arquivo ("Tipo de Solo.xlsx" -> tipos-solo). */
export function specPorNomeArquivo(nomeArquivo) {
  const base = normalizarTexto(nomeArquivo.replace(/\.[^.]+$/, ""));
  return CADASTROS_SPEC.find((s) => s.arquivos.some((a) => base === a || base.startsWith(`${a} `)));
}
