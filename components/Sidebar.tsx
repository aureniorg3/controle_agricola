"use client";

import Link from "next/link";
import { CADASTROS } from "@/lib/cadastros";
import {
  IconAcompanhamentos,
  IconAlerta,
  IconAtividades,
  IconBalanca,
  IconBusca,
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
  IconSair,
  IconSetaBaixo,
  IconSetaDireita,
  IconSetaEsquerda,
  type IconProps,
} from "@/components/icons";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

interface UsuarioLogado {
  nome: string;
  email: string;
  perfil: string;
}

interface Item {
  label: string;
  /** grupos podem ter href (a própria tela do grupo) e/ou filhos. */
  href?: string;
  badge?: number;
  icon?: (p: IconProps) => ReactNode;
  children?: Item[];
}
interface Section {
  title: string;
  items: Item[];
}

const ITEM_INICIO: Item = { label: "Início / Dashboard", href: "/painel", icon: IconPainel };

const SECTIONS: Section[] = [
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
        label: "Insumos",
        icon: IconInsumo,
        children: [
          { label: "Saldo Insumos", href: "/acompanhamentos/insumos/saldo" },
          { label: "Empréstimos", href: "/acompanhamentos/insumos/emprestimos" },
        ],
      },
      { label: "Ordem de Serviço Agr.", href: "/acompanhamentos/os-agricola", icon: IconOrdemServico },
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
      { label: "Fazendas e Talhões", href: "/agricultura/fazendas", icon: IconMapa },
      { label: "Frentes e Equipes", href: "/agricultura/frentes", icon: IconEquipe },
    ],
  },
  {
    title: "Configurações",
    items: [
      {
        label: "Cadastros",
        icon: IconConfig,
        children: CADASTROS.map((c) => ({ label: c.label, href: `/configuracoes/cadastros/${c.slug}` })),
      },
      { label: "Validações", href: "/configuracoes/validacoes", icon: IconAlerta },
      { label: "Log de Alterações", href: "/configuracoes/auditoria", icon: IconHistorico },
    ],
  },
];

function hrefAtivo(pathname: string | null, href?: string, exato = false): boolean {
  if (!href || !pathname) return false;
  return pathname === href || (!exato && pathname.startsWith(href + "/"));
}

function contemAtivo(item: Item, pathname: string | null): boolean {
  return hrefAtivo(pathname, item.href, !!item.children) || !!item.children?.some((c) => contemAtivo(c, pathname));
}

function primeiroHref(item: Item): string | undefined {
  return item.href ?? item.children?.map(primeiroHref).find(Boolean);
}

function filtrarItem(item: Item, termo: string): Item | null {
  if (item.label.toLowerCase().includes(termo)) return item;
  const filhos = item.children?.map((c) => filtrarItem(c, termo)).filter((c): c is Item => !!c);
  return filhos && filhos.length > 0 ? { ...item, children: filhos } : null;
}

function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "?";
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

export default function Sidebar({
  usuario,
  onNavigate,
}: {
  usuario?: UsuarioLogado;
  /** chamado ao clicar num item do menu — usado pra fechar a gaveta no mobile. */
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [saindo, setSaindo] = useState(false);
  const [busca, setBusca] = useState("");
  const buscaRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCollapsed(false);
        buscaRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const secoesFiltradas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return SECTIONS;
    return SECTIONS.map((s) => ({
      ...s,
      items: s.items.map((i) => filtrarItem(i, termo)).filter((i): i is Item => !!i),
    })).filter((s) => s.items.length > 0);
  }, [busca]);

  const [abertos, setAbertos] = useState<Record<string, boolean>>({});

  async function handleLogout() {
    setSaindo(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.push("/login");
      router.refresh();
    }
  }

  function renderItem(item: Item, depth: number, caminho: string): ReactNode {
    const chave = `${caminho}/${item.label}`;
    const Icon = item.icon;
    const temFilhos = !!item.children?.length;
    const buscando = busca.trim() !== "";
    const aberto = temFilhos && (buscando || (abertos[chave] ?? contemAtivo(item, pathname)));
    const ativo = hrefAtivo(pathname, item.href, temFilhos);

    if (collapsed) {
      if (depth > 0) return null;
      const destino = primeiroHref(item);
      if (!destino || !Icon) return null;
      const ativoCol = contemAtivo(item, pathname);
      return (
        <Link
          key={chave}
          href={destino}
          title={item.label}
          onClick={onNavigate}
          className={`relative flex items-center justify-center rounded-md py-2 transition-colors ${
            ativoCol ? "bg-[#2D8A5A]/10 text-[#2D8A5A]" : "text-slate-400 hover:bg-surface hover:text-ink"
          }`}
        >
          <Icon />
        </Link>
      );
    }

    const classes = `relative flex min-w-0 flex-1 items-center gap-2.5 rounded-md py-2 pr-2.5 text-[13px] font-medium transition-colors ${
      ativo ? "bg-[#2D8A5A]/[0.08] text-navy-900" : "text-slate-600 hover:bg-surface hover:text-ink"
    }`;
    const conteudo = (
      <>
        {ativo && <span className="absolute inset-y-2 left-0 w-[2px] rounded-full bg-[#2D8A5A]" />}
        {Icon && (
          <span className={`flex-shrink-0 ${ativo ? "text-[#2D8A5A]" : "text-slate-400"}`}>
            <Icon size={depth >= 2 ? 15 : 18} />
          </span>
        )}
        <span className="truncate">{item.label}</span>
        {item.badge ? (
          <span className="ml-auto rounded-full bg-alert-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
            {item.badge}
          </span>
        ) : null}
      </>
    );
    const recuo = { paddingLeft: Icon ? 12 : 10 };

    return (
      <div key={chave}>
        <div className="flex items-center gap-0.5">
          {item.href ? (
            <Link href={item.href} onClick={onNavigate} className={classes} style={recuo}>
              {conteudo}
            </Link>
          ) : (
            <button
              type="button"
              onClick={() => setAbertos((o) => ({ ...o, [chave]: !aberto }))}
              className={`${classes} text-left`}
              style={recuo}
            >
              {conteudo}
            </button>
          )}
          {temFilhos && (
            <button
              type="button"
              onClick={() => setAbertos((o) => ({ ...o, [chave]: !aberto }))}
              aria-label={aberto ? `Recolher ${item.label}` : `Expandir ${item.label}`}
              aria-expanded={aberto}
              className="flex h-8 w-6 flex-shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-surface hover:text-ink"
            >
              {aberto ? <IconSetaBaixo size={14} /> : <IconSetaDireita size={14} />}
            </button>
          )}
        </div>
        {aberto && (
          <div className="ml-[18px] mt-0.5 flex flex-col gap-0.5 border-l border-line pl-1.5">
            {item.children!.map((c) => renderItem(c, depth + 1, chave))}
          </div>
        )}
      </div>
    );
  }

  return (
    <aside
      className={`flex h-full flex-shrink-0 flex-col border-r border-line bg-white text-ink transition-all duration-200 ${
        collapsed ? "w-[68px]" : "w-[260px]"
      }`}
    >
      <div className="px-3 pb-3 pt-4">
        <div className="flex items-start justify-between gap-2">
          {!collapsed && (
            <Link href="/" aria-label="Ir para o início" className="block min-w-0 flex-1">
              <img src="/logo-crv-azul.png" alt="CRV Industrial" className="h-auto w-full" />
            </Link>
          )}
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-muted hover:bg-surface hover:text-ink ${
              collapsed ? "" : "mt-1"
            }`}
            aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
          >
            {collapsed ? <IconSetaDireita size={14} /> : <IconSetaEsquerda size={14} />}
          </button>
        </div>

        {!collapsed && (
          <label className="relative mt-3 block">
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted">
              <IconBusca size={15} />
            </span>
            <input
              ref={buscaRef}
              type="text"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar módulo…"
              className="w-full rounded-md border border-line bg-surface py-1.5 pl-8 pr-10 text-[12.5px] text-ink placeholder:text-muted/70 focus:bg-white focus:outline-none"
            />
            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-line px-1 py-0.5 text-[9.5px] font-medium text-muted">
              Ctrl K
            </span>
          </label>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-4">
        {(() => {
          const inicioAtivo = pathname === "/painel" || pathname === "/";
          return (
            <Link
              href="/painel"
              title={collapsed ? ITEM_INICIO.label : undefined}
              onClick={onNavigate}
              className={`mb-2 mt-1 flex items-center gap-2.5 rounded-lg border py-2 pl-3 pr-2.5 text-[13px] font-semibold transition-colors ${
                inicioAtivo
                  ? "border-transparent bg-[#2D8A5A]/[0.08] text-navy-900"
                  : "border-line bg-white text-ink hover:bg-surface"
              } ${collapsed ? "justify-center" : ""}`}
            >
              <span className={`flex-shrink-0 ${inicioAtivo ? "text-[#2D8A5A]" : "text-slate-500"}`}>
                <IconPainel />
              </span>
              {!collapsed && <span className="truncate">{ITEM_INICIO.label}</span>}
            </Link>
          );
        })()}
        {secoesFiltradas.map((section) => (
          <div key={section.title} className="mb-1 mt-3 first:mt-1">
            {!collapsed && (
              <div className="px-2.5 pb-1.5 text-[11px] font-medium text-slate-400">
                {section.title}
              </div>
            )}
            <div className="flex flex-col gap-0.5">
              {section.items.map((item) => renderItem(item, 0, section.title))}
            </div>
          </div>
        ))}
        {secoesFiltradas.length === 0 && !collapsed && (
          <p className="px-2.5 py-3 text-[12px] text-slate-500">Nenhum módulo encontrado.</p>
        )}
      </nav>

      <div className="border-t border-line px-2 py-3">
        <div className={`flex items-center gap-2.5 rounded-md py-1 ${collapsed ? "justify-center" : "px-1"}`}>
          <div
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-navy-900 text-[11px] font-medium text-white"
            title={usuario ? `${usuario.nome} · ${usuario.email}` : undefined}
          >
            {usuario ? iniciais(usuario.nome) : "CA"}
          </div>
          {!collapsed && (
            <>
              <div className="min-w-0 flex-1 leading-tight">
                <div className="truncate text-[12.5px] font-medium text-ink">
                  {usuario?.nome ?? "Controle Agrícola"}
                </div>
                <div className="truncate text-[11px] text-muted">
                  {usuario?.email ?? "Unidade Capinópolis-MG"}
                </div>
              </div>
              <span className="flex-shrink-0 text-slate-400">
                <IconSetaDireita size={14} />
              </span>
            </>
          )}
        </div>
        {usuario && (
          <button
            type="button"
            onClick={handleLogout}
            disabled={saindo}
            title="Sair do sistema"
            className={`mt-2 flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-[12px] font-medium text-muted transition-colors hover:bg-surface hover:text-ink disabled:opacity-60 ${
              collapsed ? "justify-center" : ""
            }`}
          >
            <IconSair size={15} className="flex-shrink-0" />
            {!collapsed && <span>{saindo ? "Saindo…" : "Sair do sistema"}</span>}
          </button>
        )}
      </div>
    </aside>
  );
}
