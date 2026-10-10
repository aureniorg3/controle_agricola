import { CADASTROS_SPEC } from "./cadastros-spec";
import { nomeDaTela } from "./menu";

/*
 * Programas do log de alterações: cada tela do sistema onde algo é lançado, importado ou cadastrado, com o que ela
 * grava no log (módulo e "o quê" — a entidade de cada registro de auditar()). A tela Log de Alterações filtra por
 * programa ou por grupo inteiro; o nome vem do menu ("Moagem › Metas"), para ser o mesmo que o usuário vê.
 *
 * Ao criar uma tela nova que grava no log, inclua aqui o módulo e a entidade que ela usa.
 *
 * `tambem`: o que a tela também grava, mas que já tem outra tela como dona (o mesmo registro sai das duas e o log não
 * guarda de qual veio). Entra na consulta da tela, mas o nome do programa na coluna continua o da tela dona.
 */

export const GRUPOS_PROGRAMA = ["Lançamentos", "Consultas e importações", "Cadastros", "Parâmetros e sistema"];

/** Telas de cadastro que não ficam em Configurações › Cadastros (o resto abre em /configuracoes/cadastros/<slug>). */
const TELA_DO_CADASTRO = {
  ocorrencias: "/rodadas-de-campo/ocorrencias",
  "nivel-infestacao": "/rodadas-de-campo/nivel-de-infestacao",
  "presenca-infestacao": "/rodadas-de-campo/presenca-de-infestacao",
  prioridade: "/rodadas-de-campo/prioridade",
  "responsavel-regiao": "/rodadas-de-campo/responsavel-regiao",
  "responsaveis-os": "/acompanhamentos/os-agricola/responsaveis",
  "faixas-dias-os": "/acompanhamentos/os-agricola/faixas-dias",
};

/** [módulo, entidade]; entidade null = tudo do módulo */
const TELAS = [
  // lançamentos: telas onde o usuário digita e grava
  { id: "area-colhida", grupo: "Lançamentos", href: "/acompanhamentos/ordens-de-corte", sufixo: "Apontamento · Área colhida", filtros: [["Colheita", "Área colhida"]] },
  {
    id: "metas",
    grupo: "Lançamentos",
    href: "/acompanhamentos/colheita/metas",
    filtros: [
      ["Colheita", "Meta"],
      ["Colheita", "Metas"],
      ["Colheita", "Atividade da frente"],
    ],
  },
  { id: "equipto-frente", grupo: "Lançamentos", href: "/acompanhamentos/colheita/equipto-frente", filtros: [["Colheita", "Equipto Frente"]] },
  {
    id: "apontamento-atividades",
    grupo: "Lançamentos",
    href: "/atividades/apontamentos-diarios/apontamento",
    filtros: [
      ["Atividades", "Apontamento diário"],
      ["Atividades", "Base de O.S."],
    ],
  },
  { id: "emprestimos", grupo: "Lançamentos", href: "/acompanhamentos/insumos/emprestimos", filtros: [["Insumos", "Empréstimo"]] },
  { id: "dosagens", grupo: "Lançamentos", href: "/acompanhamentos/insumos/dosagens", filtros: [["Insumos", "Dosagem"]] },
  { id: "rodadas-apontamento", grupo: "Lançamentos", href: "/rodadas-de-campo/apontamento", sufixo: "boletins", filtros: [["Rodadas de Campo", "Boletim"]] },

  // consultas e acompanhamentos: o que entra por importação (e os ajustes feitos nessas telas)
  {
    id: "ordens-corte",
    grupo: "Consultas e importações",
    href: "/acompanhamentos/ordens-de-corte",
    filtros: [
      ["Colheita", "Importação de ordens e pesagem"],
      ["Colheita", "Ordem inserida na tela"],
      ["Colheita", "Pesagens"],
    ],
  },
  {
    id: "conferencia",
    grupo: "Consultas e importações",
    href: "/acompanhamentos/colheita/conferencia-pesagem",
    filtros: [
      ["Colheita", "Conferência de pesagem"],
      ["Colheita", "Correção da conferência de pesagem"],
    ],
  },
  { id: "historico-safras", grupo: "Consultas e importações", href: "/acompanhamentos/colheita/historico-safras", filtros: [["Colheita", "Histórico de Safras"]] },
  { id: "saldo", grupo: "Consultas e importações", href: "/acompanhamentos/insumos/saldo", filtros: [["Insumos", "Saldo de insumos"]] },
  { id: "estoque", grupo: "Consultas e importações", href: "/acompanhamentos/insumos/estoque", filtros: [["Insumos", "Estoque Insumos"]] },
  { id: "os-agricola", grupo: "Consultas e importações", href: "/acompanhamentos/os-agricola/ordens", sufixo: "base de O.S.", filtros: [["Ordem de Serviço Agr.", "Base de O.S."]] },
  // o Dashboard da O.S. tem o mesmo "Importar O.S." da tela Ordens de Serviço
  {
    id: "os-agricola-painel",
    grupo: "Consultas e importações",
    href: "/acompanhamentos/os-agricola",
    sufixo: "base de O.S.",
    filtros: [],
    tambem: [["Ordem de Serviço Agr.", "Base de O.S."]],
  },
  // "Grupos das operações" do Dashboard de Atividades grava no cadastro Grupos de Operações
  {
    id: "dashboard-atividades",
    grupo: "Consultas e importações",
    href: "/atividades/dashboard",
    sufixo: "grupos das operações",
    filtros: [],
    tambem: [["Cadastros", "Cadastro de Grupos de Operações"]],
  },
  {
    id: "rodadas-resumo",
    grupo: "Consultas e importações",
    href: "/rodadas-de-campo/resumo",
    filtros: [
      ["Rodadas de Campo", "Importação do levantamento"],
      ["Rodadas de Campo", "Padronização das ocorrências importadas"],
    ],
  },

  // cadastros fora da lista genérica
  { id: "rodadas-cadastro", grupo: "Cadastros", href: "/rodadas-de-campo/cadastro-de-rodadas", filtros: [["Rodadas de Campo", "Rodada"]] },
  { id: "safras", grupo: "Cadastros", href: "/configuracoes/cadastros/safras", filtros: [["Configurações", "Cadastro de Safras"]] },
  { id: "usuarios", grupo: "Cadastros", href: "/configuracoes/cadastros/usuarios", filtros: [["Configurações", "Usuário"]] },

  // parâmetros e o que o próprio sistema faz
  // o nível de acesso (perfil) trocado aqui grava como alteração do Usuário (a mesma API do cadastro de usuários)
  {
    id: "parametros-usuarios",
    grupo: "Parâmetros e sistema",
    href: "/parametros/usuarios",
    sufixo: "acessos",
    filtros: [["Parâmetros", "Acesso de usuário"]],
    tambem: [["Configurações", "Usuário"]],
  },
  { id: "parametros-apontamento", grupo: "Parâmetros e sistema", href: "/parametros/apontamento-diario", filtros: [["Parâmetros", "Apontamento Diário"]] },
  { id: "sistema", grupo: "Parâmetros e sistema", rotulo: "Sistema · limpeza automática de dados", filtros: [["Sistema", "Limpeza de dados"]] },
];

function rotuloDa(t) {
  if (t.rotulo) return t.rotulo;
  const nome = (t.href && nomeDaTela(t.href)) || t.href || t.id;
  return t.sufixo ? `${nome} · ${t.sufixo}` : nome;
}

function montar() {
  // filtros: o que a consulta da tela traz; proprios: o que leva o nome dela na coluna Programa
  const lista = TELAS.map((t) => ({ id: t.id, grupo: t.grupo, rotulo: rotuloDa(t), filtros: [...t.filtros, ...(t.tambem ?? [])], proprios: t.filtros }));
  // cadastros genéricos (Configurações › Cadastros e os que abrem em outras telas): "Cadastro de <título>"
  for (const s of CADASTROS_SPEC) {
    const href = TELA_DO_CADASTRO[s.slug] ?? `/configuracoes/cadastros/${s.slug}`;
    const filtros = [["Cadastros", `Cadastro de ${s.titulo}`]];
    lista.push({
      id: `cadastro-${s.slug}`,
      grupo: "Cadastros",
      rotulo: nomeDaTela(href) ?? `Cadastros › ${s.titulo}`,
      filtros,
      proprios: filtros,
    });
  }
  return lista.sort((a, b) => GRUPOS_PROGRAMA.indexOf(a.grupo) - GRUPOS_PROGRAMA.indexOf(b.grupo) || a.rotulo.localeCompare(b.rotulo, "pt-BR"));
}

export const PROGRAMAS_LOG = montar();

/**
 * Filtros (pares módulo/entidade) de uma escolha da tela: o id de um programa ou "grupo:<nome do grupo>".
 * Null quando a escolha não existe (a consulta ignora o filtro).
 */
export function filtrosDaEscolha(escolha) {
  if (!escolha) return null;
  if (escolha.startsWith("grupo:")) {
    const g = escolha.slice(6);
    // sem repetir o par que duas telas do grupo gravam
    const f = [...new Map(PROGRAMAS_LOG.filter((p) => p.grupo === g).flatMap((p) => p.filtros).map((x) => [`${x[0]}|${x[1] ?? "*"}`, x])).values()];
    return f.length ? f : null;
  }
  const f = PROGRAMAS_LOG.find((p) => p.id === escolha)?.filtros;
  return f?.length ? f : null;
}

const PROGRAMA_POR_CHAVE = new Map();
for (const p of PROGRAMAS_LOG) for (const [m, e] of p.proprios) if (!PROGRAMA_POR_CHAVE.has(`${m}|${e ?? "*"}`)) PROGRAMA_POR_CHAVE.set(`${m}|${e ?? "*"}`, p.rotulo);

/** Nome do programa de um registro do log (pelo módulo e pela entidade); null quando não é de nenhum programa conhecido. */
export function programaDoRegistro(modulo, entidade) {
  return PROGRAMA_POR_CHAVE.get(`${modulo}|${entidade}`) ?? PROGRAMA_POR_CHAVE.get(`${modulo}|*`) ?? null;
}
