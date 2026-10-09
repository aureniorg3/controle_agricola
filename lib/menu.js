import {
  IconAcompanhamentos,
  IconAjustes,
  IconAlerta,
  IconAtividades,
  IconBalanca,
  IconCaminhaoCana,
  IconCana,
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
      {
        label: "Insumos",
        icon: IconInsumo,
        children: [
          { label: "Saldo Insumos", href: "/acompanhamentos/insumos/saldo" },
          { label: "Estoque Insumos", href: "/acompanhamentos/insumos/estoque" },
          { label: "Empréstimos", href: "/acompanhamentos/insumos/emprestimos" },
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
        children: CADASTROS.map((c) => ({ label: c.label, href: `/configuracoes/cadastros/${c.slug}`, soAdmin: c.slug === "usuarios" })),
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

/** Uma tela que pode ser liberada para o usuário, com o caminho no menu ("Insumos › Dosagens"). */
export function telasDoMenu(secoes = SECOES_MENU) {
  const lista = [];
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
 * O usuário pode abrir este endereço? Administrador abre tudo; telas só de administrador ficam fechadas para os
 * demais; `acessos` nulo libera todas as outras; o Início e endereços que não são telas do menu (redirecionamentos)
 * ficam sempre abertos.
 */
export function podeAcessar(pathname, perfil, acessos) {
  if (perfil === "admin") return true;
  if (HREFS_ADMIN.some((h) => casa(pathname, h))) return false;
  if (!acessos) return true;
  if (pathname === "/" || casa(pathname, "/painel")) return true;
  const tela = telaDoEndereco(pathname);
  return tela === null || acessos.includes(tela);
}

/** Menu que o usuário enxerga: sem itens de administrador e só com as telas liberadas. */
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
  return secoes.map((s) => ({ ...s, items: s.items.map(filtrar).filter((i) => !!i) })).filter((s) => s.items.length > 0);
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

/** Todas as telas de um menu (já filtrado para o usuário), com a seção e os grupos acima — para a busca de telas. */
export function telasParaBusca(secoes) {
  const lista = [{ href: ITEM_INICIO.href, label: ITEM_INICIO.label, caminho: [] }];
  const visitar = (item, caminho) => {
    if (item.href && !lista.some((t) => t.href === item.href)) lista.push({ href: item.href, label: item.label, caminho });
    item.children?.forEach((c) => visitar(c, [...caminho, item.label]));
  };
  secoes.forEach((s) => s.items.forEach((i) => visitar(i, [s.title])));
  return lista;
}
