"use client";

import Link from "next/link";
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
  icon?: () => ReactNode;
  children?: Item[];
}
interface Section {
  title: string;
  items: Item[];
}

function IconHome() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="M4 11.5 12 4l8 7.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 10v9a1 1 0 0 0 1 1h3v-5h4v5h3a1 1 0 0 0 1-1v-9" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}
function IconChart() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconLeaf() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="M5 19c8 0 14-6 14-14-8 0-14 6-14 14Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M5 19c0-5 3-9 7-11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
function IconFlask() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="M9 3h6M10 3v6l-5.5 9a1.5 1.5 0 0 0 1.3 2.3h12.4a1.5 1.5 0 0 0 1.3-2.3L14 9V3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7 15h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
function IconWrench() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path
        d="M14.7 6.3a4 4 0 0 1-5.4 5.4L4 17l3 3 5.3-5.3a4 4 0 0 1 5.4-5.4L15 12l-3-3 2.7-2.7Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function IconUsers() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <circle cx="9" cy="8" r="3" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="17" cy="9" r="2.4" stroke="currentColor" strokeWidth="1.8" />
      <path d="M15.5 14.2c2.6.4 4.5 2.6 4.5 5.3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
function IconAlertTriangle() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="M12 4 2.5 20h19L12 4Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M12 10v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="12" cy="17" r="0.9" fill="currentColor" />
    </svg>
  );
}
function IconClipboard() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <rect x="5" y="4" width="14" height="17" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M9 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 10h8M8 14h8M8 18h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
function IconMap() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="m9 4-5 2v14l5-2 6 2 5-2V4l-5 2-6-2Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M9 4v14M15 6v14" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}
function IconSettings() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M19.4 13.5a7.7 7.7 0 0 0 0-3l1.8-1.4-2-3.4-2.1.7a7.6 7.6 0 0 0-2.6-1.5L14.1 2.5h-4l-.4 2.4a7.6 7.6 0 0 0-2.6 1.5l-2.1-.7-2 3.4L4.6 10.5a7.7 7.7 0 0 0 0 3L2.8 15l2 3.4 2.1-.7c.76.66 1.64 1.17 2.6 1.5l.4 2.4h4l.4-2.4a7.6 7.6 0 0 0 2.6-1.5l2.1.7 2-3.4-1.8-1.5Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function IconSearch() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
      <path d="m21 21-4.3-4.3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
function IconChevronDown() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconChevronRight() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const ITEM_INICIO: Item = { label: "Início / Dashboard", href: "/painel", icon: IconHome };

const SECTIONS: Section[] = [
  {
    title: "Operação Agrícola",
    items: [
      {
        label: "Acompanhamentos",
        icon: IconChart,
        children: [
          {
            label: "Colheita",
            href: "/acompanhamentos/colheita",
            icon: IconLeaf,
            children: [
              { label: "Ordens de Corte", href: "/acompanhamentos/ordens-de-corte" },
              { label: "Metas", href: "/acompanhamentos/colheita/metas" },
              { label: "Histórico de Safras", href: "/acompanhamentos/colheita/historico-safras" },
            ],
          },
        ],
      },
      { label: "Insumos", href: "/acompanhamentos/insumos", icon: IconFlask },
      { label: "Ordem de Serviço Agr.", href: "/acompanhamentos/os-agricola", icon: IconWrench },
      { label: "Colheita Terceiro", href: "/acompanhamentos/colheita-terceiro", icon: IconUsers },
      { label: "Painel de ocorrências", href: "/contencioso", icon: IconAlertTriangle },
    ],
  },
  {
    title: "Planejamento Agrícola",
    items: [
      { label: "Cadastro de Atividades", href: "/planejamento/cadastro-atividades", icon: IconClipboard },
      { label: "Fazendas e Talhões", href: "/agricultura/fazendas", icon: IconMap },
      { label: "Frentes e Equipes", href: "/agricultura/frentes", icon: IconUsers },
    ],
  },
  {
    title: "Configurações",
    items: [{ label: "Cadastros", href: "/configuracoes/cadastros", icon: IconSettings }],
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
            ativoCol ? "bg-white text-brand-600 shadow-card" : "text-slate-400 hover:bg-white/8 hover:text-white"
          }`}
        >
          <Icon />
        </Link>
      );
    }

    const classes = `relative flex min-w-0 flex-1 items-center gap-2.5 rounded-md py-2 pr-2.5 text-[13px] font-medium transition-colors ${
      ativo ? "bg-white text-navy-900 shadow-card" : "text-slate-300 hover:bg-white/8 hover:text-white"
    }`;
    const conteudo = (
      <>
        {ativo && <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-full bg-brand-600" />}
        {Icon && (
          <span className={`flex-shrink-0 ${ativo ? "text-brand-600" : "text-slate-400"}`}>
            <Icon />
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
              className="flex h-8 w-6 flex-shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-white/8 hover:text-white"
            >
              {aberto ? <IconChevronDown /> : <IconChevronRight />}
            </button>
          )}
        </div>
        {aberto && (
          <div className="ml-[18px] mt-0.5 flex flex-col gap-0.5 border-l border-white/10 pl-1.5">
            {item.children!.map((c) => renderItem(c, depth + 1, chave))}
          </div>
        )}
      </div>
    );
  }

  return (
    <aside
      className={`flex h-full flex-shrink-0 flex-col bg-navy-950 text-slate-200 transition-all duration-150 ${
        collapsed ? "w-[68px]" : "w-[260px]"
      }`}
    >
      <div className="px-3 pb-3 pt-4">
        <div className="flex items-start justify-between gap-2">
          {!collapsed && (
            <Link href="/" aria-label="Ir para o início" className="block min-w-0 flex-1">
              <img src="/logo-crv-branca.png" alt="CRV Industrial" className="h-auto w-full" />
            </Link>
          )}
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-white/10 hover:text-white ${
              collapsed ? "" : "mt-1"
            }`}
            aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path
                d={collapsed ? "M9 6l6 6-6 6" : "M15 6l-6 6 6 6"}
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>

        {!collapsed && (
          <label className="relative mt-3 block">
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500">
              <IconSearch />
            </span>
            <input
              ref={buscaRef}
              type="text"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar módulo…"
              className="w-full rounded-md border border-white/10 bg-white/5 py-1.5 pl-8 pr-10 text-[12.5px] text-white placeholder:text-slate-500 focus:border-brand-600 focus:outline-none"
            />
            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-white/15 px-1 py-0.5 text-[9.5px] font-semibold text-slate-500">
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
                  ? "border-transparent bg-white text-navy-900 shadow-card"
                  : "border-white/10 bg-white/10 text-white hover:bg-white/15"
              } ${collapsed ? "justify-center" : ""}`}
            >
              <span className={`flex-shrink-0 ${inicioAtivo ? "text-brand-600" : "text-white"}`}>
                <IconHome />
              </span>
              {!collapsed && <span className="truncate">{ITEM_INICIO.label}</span>}
            </Link>
          );
        })()}
        {secoesFiltradas.map((section) => (
          <div key={section.title} className="mb-1 mt-3 first:mt-1">
            {!collapsed && (
              <div className="px-2.5 pb-1.5 text-[10.5px] font-bold uppercase tracking-wider text-slate-500">
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

      <div className="border-t border-white/10 px-2 py-3">
        <div className={`flex items-center gap-2.5 rounded-md py-1 ${collapsed ? "justify-center" : "px-1"}`}>
          <div
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-brand-600 text-[11px] font-bold text-white"
            title={usuario ? `${usuario.nome} · ${usuario.email}` : undefined}
          >
            {usuario ? iniciais(usuario.nome) : "CA"}
          </div>
          {!collapsed && (
            <>
              <div className="min-w-0 flex-1 leading-tight">
                <div className="truncate text-[12.5px] font-semibold text-white">
                  {usuario?.nome ?? "Controle Agrícola"}
                </div>
                <div className="truncate text-[11px] text-slate-400">
                  {usuario?.email ?? "Unidade Capinópolis-MG"}
                </div>
              </div>
              <span className="flex-shrink-0 text-slate-500">
                <IconChevronRight />
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
            className={`mt-2 flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-[12px] font-medium text-slate-400 transition-colors hover:bg-white/8 hover:text-white disabled:opacity-60 ${
              collapsed ? "justify-center" : ""
            }`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="flex-shrink-0">
              <path
                d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {!collapsed && <span>{saindo ? "Saindo…" : "Sair do sistema"}</span>}
          </button>
        )}
      </div>
    </aside>
  );
}
