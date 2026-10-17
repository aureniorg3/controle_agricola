import {
  IconAcompanhamentos,
  IconAjustes,
  IconAlerta,
  IconAtividades,
  IconBalanca,
  IconCaminhaoCana,
  IconCana,
  IconCelular,
  IconColhedora,
  IconConfig,
  IconEquipe,
  IconHistorico,
  IconInsumo,
  IconMapa,
  IconMeta,
  IconOrdemCorte,
  IconOrdemServico,
  IconPainel,
  IconRodadas,
} from "@/components/icons";
import { CADASTROS } from "./cadastros";

/**
 * Menu do sistema — fonte única para o menu lateral e para a liberação de telas por usuário
 * (Parâmetros → Usuários). Cada `href` é uma tela; grupos podem ter a própria tela e/ou filhos.
 */
export const ITEM_INICIO = { label: "Início / Dashboard", href: "/painel", icon: IconPainel };

/**
 * Marca de versão gravada no começo da lista de telas liberadas (Parâmetros → Usuários) desde que o Início passou a
 * ser uma tela marcável. Uma lista gravada antes (sem a marca) continua liberando o Início: lá ele não foi desmarcado,
 * a opção é que não existia. Ao salvar o usuário de novo a lista ganha a marca e o Início vale como as outras telas.
 * Não é uma tela: quem lê a lista procura os endereços nela (`acessos.includes(href)`) e a marca não atrapalha.
 */
export const MARCA_ACESSOS = "#v2";

export const SECOES_MENU = [
  {
    title: "Operação Agrícola",
    items: [
      {
        label: "Acompanhamentos",
        icon: IconAcompanhamentos,
        children: [
          {
            // o grupo só abre o menu; os dados de moagem ficam no Dashboard
            label: "Moagem",
            icon: IconCana,
            children: [
              { label: "Dashboard", href: "/acompanhamentos/colheita", icon: IconPainel, exato: true },
              { label: "Ordens de Corte", href: "/acompanhamentos/ordens-de-corte", icon: IconOrdemCorte },
              { label: "Metas", href: "/acompanhamentos/colheita/metas", icon: IconMeta },
              { label: "Histórico de Safras", href: "/acompanhamentos/colheita/historico-safras", icon: IconHistorico },
              { label: "Conferência de Pesagem", href: "/acompanhamentos/colheita/conferencia-pesagem", icon: IconBalanca },
              { label: "Equipto Frente", href: "/acompanhamentos/colheita/equipto-frente", icon: IconColhedora },
            ],
          },
        ],
      },
      {
        label: "Atividades",
        icon: IconAtividades,
        children: [
          { label: "Dashboard", href: "/atividades/dashboard" },
          {
            label: "Apontamentos Diários",
            children: [{ label: "Apontamento", href: "/atividades/apontamentos-diarios/apontamento" }],
          },
        ],
      },
      // lançamento de campo pelo celular (O.S. do responsável, talhões realizados e o texto para o grupo do WhatsApp)
      { label: "Lançamento Mobile", href: "/atividades/lancamento-mobile", icon: IconCelular },
      {
        label: "Insumos",
        icon: IconInsumo,
        children: [
          { label: "Saldo Insumos", href: "/acompanhamentos/insumos/saldo" },
          { label: "Estoque Insumos", href: "/acompanhamentos/insumos/estoque" },
          {
            label: "Empréstimos",
            children: [
              { label: "Empréstimos", href: "/acompanhamentos/insumos/emprestimos", exato: true },
              { label: "Assinaturas", href: "/acompanhamentos/insumos/emprestimos/assinaturas" },
            ],
          },
          { label: "Dosagens", href: "/acompanhamentos/insumos/dosagens" },
        ],
      },
      {
        label: "Ordem de Serviço Agr.",
        icon: IconOrdemServico,
        children: [
          { label: "Dashboard", href: "/acompanhamentos/os-agricola" },
          { label: "Ordens de Serviço", href: "/acompanhamentos/os-agricola/ordens" },
          { label: "Cadastro Responsáveis", href: "/acompanhamentos/os-agricola/responsaveis" },
          { label: "Faixas Dias", href: "/acompanhamentos/os-agricola/faixas-dias" },
        ],
      },
      { label: "Colheita Terceiro", href: "/acompanhamentos/colheita-terceiro", icon: IconCaminhaoCana },
      { label: "Painel de ocorrências", href: "/contencioso", icon: IconAlerta },
      {
        label: "Rodadas de Campo",
        icon: IconRodadas,
        children: [
          { label: "Resumo", href: "/rodadas-de-campo/resumo" },
          { label: "Apontamento", href: "/rodadas-de-campo/apontamento" },
          { label: "Cadastro de Rodadas", href: "/rodadas-de-campo/cadastro-de-rodadas" },
          { label: "Cadastro de Ocorrências", href: "/rodadas-de-campo/ocorrencias" },
          { label: "Cadastro de Nível de Infestação", href: "/rodadas-de-campo/nivel-de-infestacao" },
          { label: "Cadastro Presença de Infestação", href: "/rodadas-de-campo/presenca-de-infestacao" },
          { label: "Prioridade", href: "/rodadas-de-campo/prioridade" },
          { label: "Responsável Região", href: "/rodadas-de-campo/responsavel-regiao" },
        ],
      },
    ],
  },
  {
    title: "Planejamento Agrícola",
    items: [
      { label: "Cadastro de Atividades", href: "/planejamento/cadastro-atividades", icon: IconAtividades },
      { label: "Fazenda e Talhões", href: "/agricultura/fazendas", icon: IconMapa },
      { label: "Frentes e Equipes", href: "/agricultura/frentes", icon: IconEquipe },
    ],
  },
  {
    title: "Configurações",
    items: [
      {
        label: "Cadastros",
        icon: IconConfig,
        children: itensDosCadastros(),
      },
      { label: "Validações", href: "/configuracoes/validacoes", icon: IconAlerta },
      { label: "Log de Alterações", href: "/configuracoes/auditoria", icon: IconHistorico },
      {
        label: "Parâmetros",
        icon: IconAjustes,
        soAdmin: true,
        children: [
          { label: "Usuários", href: "/parametros/usuarios" },
          { label: "Apontamento Diário", href: "/parametros/apontamento-diario" },
        ],
      },
    ],
  },
];

/**
 * Itens do menu Cadastros: cada cadastro, e os de um `grupo` juntos num submenu (Equipamentos › Veículos…), na
 * posição do primeiro deles.
 */
function itensDosCadastros() {
  const itens = [];
  const grupos = new Map();
  for (const c of CADASTROS) {
    const item = { label: c.label, href: `/configuracoes/cadastros/${c.slug}`, soAdmin: c.slug === "usuarios" };
    if (!c.grupo) {
      itens.push(item);
      continue;
    }
    if (!grupos.has(c.grupo)) {
      const g = { label: c.grupo, children: [] };
      grupos.set(c.grupo, g);
      itens.push(g);
    }
    grupos.get(c.grupo).children.push(item);
  }
  return itens;
}

/**
 * Uma tela que pode ser liberada para o usuário, com o caminho no menu ("Insumos › Dosagens"). O Início / Dashboard
 * vem primeiro, numa seção só dele (no menu ele fica acima das seções).
 */
export function telasDoMenu(secoes = SECOES_MENU) {
  const lista = [{ href: ITEM_INICIO.href, label: ITEM_INICIO.label, secao: "Início", caminho: [ITEM_INICIO.label] }];
  const visitar = (item, secao, caminho) => {
    if (item.soAdmin) return;
    if (item.href) lista.push({ href: item.href, label: item.label, secao, caminho: [...caminho, item.label] });
    item.children?.forEach((c) => visitar(c, secao, [...caminho, item.label]));
  };
  secoes.forEach((s) => s.items.forEach((i) => visitar(i, s.title, [])));
  return lista;
}

const TELAS = telasDoMenu();
const HREFS_ADMIN = (() => {
  const l = [];
  const visitar = (item, admin) => {
    const a = admin || !!item.soAdmin;
    if (a && item.href) l.push(item.href);
    item.children?.forEach((c) => visitar(c, a));
  };
  SECOES_MENU.forEach((s) => s.items.forEach((i) => visitar(i, false)));
  return l;
})();

const casa = (pathname, href) => pathname === href || pathname.startsWith(`${href}/`);

/** Tela do menu a que um endereço pertence (a mais específica), ou null se não é uma tela do menu. */
export function telaDoEndereco(pathname) {
  let melhor = null;
  for (const t of TELAS) if (casa(pathname, t.href) && (!melhor || t.href.length > melhor.length)) melhor = t.href;
  return melhor;
}

/**
 * O usuário vê o Início / Dashboard? Administrador e `acessos` nulo, sempre; lista gravada antes de o Início ser
 * marcável (sem a MARCA_ACESSOS) também; na lista nova, só se ele estiver marcado.
 */
export function veInicio(perfil, acessos) {
  if (perfil === "admin" || !acessos) return true;
  return !acessos.includes(MARCA_ACESSOS) || acessos.includes(ITEM_INICIO.href);
}

/**
 * O usuário pode abrir este endereço? Administrador abre tudo; telas só de administrador ficam fechadas para os
 * demais; `acessos` nulo libera todas as outras; o Início segue o `veInicio`; "/" (que leva à página inicial) e
 * endereços que não são telas do menu (redirecionamentos) ficam sempre abertos.
 */
export function podeAcessar(pathname, perfil, acessos) {
  if (perfil === "admin") return true;
  if (HREFS_ADMIN.some((h) => casa(pathname, h))) return false;
  if (!acessos) return true;
  if (pathname === "/") return true;
  if (casa(pathname, ITEM_INICIO.href)) return veInicio(perfil, acessos);
  const tela = telaDoEndereco(pathname);
  return tela === null || acessos.includes(tela);
}

/**
 * Página inicial do usuário (depois de entrar, ao abrir "/" e no nome/logo da barra azul): o Início, se liberado;
 * senão a primeira tela liberada, na ordem do menu. Null quando nenhuma tela está liberada (quem chama mostra um aviso
 * em vez de redirecionar).
 */
export function paginaInicial(perfil, acessos) {
  return TELAS.find((t) => podeAcessar(t.href, perfil, acessos))?.href ?? null;
}

/**
 * Telas marcadas numa lista gravada, para Parâmetros → Usuários: sem a marca de versão e, na lista antiga, com o
 * Início (que ela libera). `null` (todas as telas) continua null.
 */
export function telasMarcadas(acessos) {
  if (!acessos) return null;
  const telas = acessos.filter((h) => h !== MARCA_ACESSOS);
  return veInicio(undefined, acessos) && !telas.includes(ITEM_INICIO.href) ? [ITEM_INICIO.href, ...telas] : telas;
}

/**
 * Menu que o usuário enxerga: sem itens de administrador e só com as telas liberadas. O Início fica fora das seções
 * (o menu lateral o desenha no topo): a lista volta com `inicio` (true/false), que a busca de telas também respeita.
 */
export function filtrarMenu(secoes, perfil, acessos) {
  const admin = perfil === "admin";
  const filtrar = (item) => {
    if (item.soAdmin && !admin) return null;
    const filhos = item.children?.map(filtrar).filter((c) => !!c);
    const liberado = !!item.href && (admin || !acessos || acessos.includes(item.href));
    if (liberado) return { ...item, children: filhos };
    if (filhos && filhos.length > 0) return { ...item, href: undefined, children: filhos };
    return null;
  };
  const menu = secoes.map((s) => ({ ...s, items: s.items.map(filtrar).filter((i) => !!i) })).filter((s) => s.items.length > 0);
  menu.inicio = veInicio(perfil, acessos);
  return menu;
}

/** Nome da tela de um endereço, com o grupo de cima ("Moagem › Dashboard"), para o botão Voltar. */
export function nomeDaTela(pathname) {
  if (pathname === "/" || casa(pathname, "/painel")) return ITEM_INICIO.label;
  let melhor = null;
  const visitar = (item, pai) => {
    if (item.href && casa(pathname, item.href) && (!melhor || item.href.length > melhor.href.length)) {
      melhor = { href: item.href, nome: pai ? `${pai} › ${item.label}` : item.label };
    }
    item.children?.forEach((c) => visitar(c, item.label));
  };
  SECOES_MENU.forEach((s) => s.items.forEach((i) => visitar(i, null)));
  return melhor?.nome ?? null;
}

/**
 * Onde a tela fica no menu — seção e grupos acima dela ("Operação Agrícola › Insumos") — para a trilha do cabeçalho
 * das telas. Inclui as telas só de administrador. Null quando o endereço não é uma tela do menu.
 */
export function caminhoDaTela(pathname) {
  if (pathname === "/" || casa(pathname, "/painel")) return { secao: "", grupos: [], label: ITEM_INICIO.label };
  let melhor = null;
  const visitar = (item, secao, grupos) => {
    const atual = melhor;
    if (item.href && casa(pathname, item.href) && (!atual || item.href.length > atual.href.length)) {
      melhor = { href: item.href, secao, grupos, label: item.label };
    }
    item.children?.forEach((c) => visitar(c, secao, [...grupos, item.label]));
  };
  SECOES_MENU.forEach((s) => s.items.forEach((i) => visitar(i, s.title, [])));
  const achado = melhor;
  return achado ? { secao: achado.secao, grupos: achado.grupos, label: achado.label } : null;
}

/**
 * Todas as telas de um menu (já filtrado para o usuário), com a seção e os grupos acima — para a busca de telas. O
 * Início entra primeiro, salvo quando o menu do `filtrarMenu` diz que ele não está liberado (`inicio: false`).
 */
export function telasParaBusca(secoes) {
  const lista = secoes.inicio === false ? [] : [{ href: ITEM_INICIO.href, label: ITEM_INICIO.label, caminho: [] }];
  const visitar = (item, caminho) => {
    if (item.href && !lista.some((t) => t.href === item.href)) lista.push({ href: item.href, label: item.label, caminho });
    item.children?.forEach((c) => visitar(c, [...caminho, item.label]));
  };
  secoes.forEach((s) => s.items.forEach((i) => visitar(i, [s.title])));
  return lista;
}
