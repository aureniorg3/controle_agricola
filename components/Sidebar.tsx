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
  href: string;
  badge?: number;
  icon: () => ReactNode;
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
function IconChevronRight() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const SECTIONS: Section[] = [
  {
    title: "Visão Geral",
    items: [{ label: "Painel", href: "/painel", icon: IconHome }],
  },
  {
    title: "Acompanhamentos",
    items: [
      { label: "Ordens de Corte", href: "/acompanhamentos/ordens-de-corte", icon: IconChart },
      { label: "Colheita", href: "/acompanhamentos/colheita", icon: IconLeaf },
      { label: "Insumos", href: "/acompanhamentos/insumos", icon: IconFlask },
      { label: "Ordem de Serviço Agr.", href: "/acompanhamentos/os-agricola", icon: IconWrench },
      { label: "Colheita Terceiro", href: "/acompanhamentos/colheita-terceiro", icon: IconUsers },
    ],
  },
  {
    title: "Operação",
    items: [
      { label: "Painel de ocorrências", href: "/contencioso", icon: IconAlertTriangle },
      { label: "Cadastro de Atividades", href: "/planejamento/cadastro-atividades", icon: IconClipboard },
    ],
  },
  {
    title: "Agricultura",
    items: [
      { label: "Fazendas e Talhões", href: "/agricultura/fazendas", icon: IconMap },
      { label: "Frentes e Equipes", href: "/agricultura/frentes", icon: IconUsers },
    ],
  },
  {
    title: "Configurações",
    items: [{ label: "Cadastros", href: "/configuracoes/cadastros", icon: IconSettings }],
  },
];

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
    return SECTIONS.map((s) => ({ ...s, items: s.items.filter((i) => i.label.toLowerCase().includes(termo)) })).filter(
      (s) => s.items.length > 0
    );
  }, [busca]);

  async function handleLogout() {
    setSaindo(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.push("/login");
      router.refresh();
    }
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
        {secoesFiltradas.map((section) => (
          <div key={section.title} className="mb-1 mt-3 first:mt-1">
            {!collapsed && (
              <div className="px-2.5 pb-1.5 text-[10.5px] font-bold uppercase tracking-wider text-slate-500">
                {section.title}
              </div>
            )}
            <div className="flex flex-col gap-0.5">
              {section.items.map((item) => {
                const active = pathname === item.href || pathname?.startsWith(item.href + "/");
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    title={collapsed ? item.label : undefined}
                    onClick={onNavigate}
                    className={`relative flex items-center gap-2.5 rounded-md py-2 pl-3 pr-2.5 text-[13px] font-medium transition-colors ${
                      active
                        ? "bg-white text-navy-900 shadow-card"
                        : "text-slate-300 hover:bg-white/8 hover:text-white"
                    }`}
                  >
                    {active && !collapsed && (
                      <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-full bg-brand-600" />
                    )}
                    <span className={`flex-shrink-0 ${active ? "text-brand-600" : "text-slate-400"}`}>
                      <Icon />
                    </span>
                    {!collapsed && <span className="truncate">{item.label}</span>}
                    {!collapsed && item.badge ? (
                      <span className="ml-auto rounded-full bg-alert-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                        {item.badge}
                      </span>
                    ) : null}
                  </Link>
                );
              })}
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
