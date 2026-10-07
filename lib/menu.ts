import type { ReactNode } from "react";
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
  type IconProps,
} from "@/components/icons";
import { CADASTROS } from "./cadastros";
import type { PerfilUsuario } from "./types";

/**
 * Menu do sistema — fonte única para o menu lateral e para a liberação de telas por usuário
 * (Parâmetros → Usuários). Cada `href` é uma tela; grupos podem ter a própria tela e/ou filhos.
 */
export interface ItemMenu {
  label: string;
  href?: string;
  badge?: number;
  icon?: (p: IconProps) => ReactNode;
  children?: ItemMenu[];
  /** só o administrador vê (e não entra na liberação por usuário) */
  soAdmin?: boolean;
}

export interface SecaoMenu {
  title: string;
  items: ItemMenu[];
}

export const ITEM_INICIO: ItemMenu = { label: "Início / Dashboard", href: "/painel", icon: IconPainel };

export const SECOES_MENU: SecaoMenu[] = [
  {
    title: "Operação Agrícola",
    items: [
      {
        label: "Acompanhamentos",
        icon: IconAcompanhamentos,
        children: [
          {
            label: "Colheita",
            href: "/acompanhamentos/colheita",
            icon: IconCana,
            children: [
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
        children: [{ label: "Usuários", href: "/parametros/usuarios" }],
      },
    ],
  },
];

/** Uma tela que pode ser liberada para o usuário, com o caminho no menu ("Insumos › Dosagens"). */
export interface TelaMenu {
  href: string;
  label: string;
  secao: string;
  caminho: string[];
}

export function telasDoMenu(secoes: SecaoMenu[] = SECOES_MENU): TelaMenu[] {
  const lista: TelaMenu[] = [];
  const visitar = (item: ItemMenu, secao: string, caminho: string[]) => {
    if (item.soAdmin) return;
    if (item.href) lista.push({ href: item.href, label: item.label, secao, caminho: [...caminho, item.label] });
    item.children?.forEach((c) => visitar(c, secao, [...caminho, item.label]));
  };
  secoes.forEach((s) => s.items.forEach((i) => visitar(i, s.title, [])));
  return lista;
}

const TELAS = telasDoMenu();
const HREFS_ADMIN = (() => {
  const l: string[] = [];
  const visitar = (item: ItemMenu, admin: boolean) => {
    const a = admin || !!item.soAdmin;
    if (a && item.href) l.push(item.href);
    item.children?.forEach((c) => visitar(c, a));
  };
  SECOES_MENU.forEach((s) => s.items.forEach((i) => visitar(i, false)));
  return l;
})();

const casa = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

/** Tela do menu a que um endereço pertence (a mais específica), ou null se não é uma tela do menu. */
export function telaDoEndereco(pathname: string): string | null {
  let melhor: string | null = null;
  for (const t of TELAS) if (casa(pathname, t.href) && (!melhor || t.href.length > melhor.length)) melhor = t.href;
  return melhor;
}

/**
 * O usuário pode abrir este endereço? Administrador abre tudo; telas só de administrador ficam fechadas para os
 * demais; `acessos` nulo libera todas as outras; o Início e endereços que não são telas do menu (redirecionamentos)
 * ficam sempre abertos.
 */
export function podeAcessar(pathname: string, perfil: PerfilUsuario | string | undefined, acessos: string[] | null | undefined): boolean {
  if (perfil === "admin") return true;
  if (HREFS_ADMIN.some((h) => casa(pathname, h))) return false;
  if (!acessos) return true;
  if (pathname === "/" || casa(pathname, "/painel")) return true;
  const tela = telaDoEndereco(pathname);
  return tela === null || acessos.includes(tela);
}

/** Menu que o usuário enxerga: sem itens de administrador e só com as telas liberadas. */
export function filtrarMenu(secoes: SecaoMenu[], perfil: PerfilUsuario | string | undefined, acessos: string[] | null | undefined): SecaoMenu[] {
  const admin = perfil === "admin";
  const filtrar = (item: ItemMenu): ItemMenu | null => {
    if (item.soAdmin && !admin) return null;
    const filhos = item.children?.map(filtrar).filter((c): c is ItemMenu => !!c);
    const liberado = !!item.href && (admin || !acessos || acessos.includes(item.href));
    if (liberado) return { ...item, children: filhos };
    if (filhos && filhos.length > 0) return { ...item, href: undefined, children: filhos };
    return null;
  };
  return secoes
    .map((s) => ({ ...s, items: s.items.map(filtrar).filter((i): i is ItemMenu => !!i) }))
    .filter((s) => s.items.length > 0);
}
