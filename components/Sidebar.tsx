"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

interface UsuarioLogado {
  nome: string;
  email: string;
  perfil: string;
}

interface Item {
  label: string;
  href: string;
  badge?: number;
}
interface Section {
  title: string;
  items: Item[];
}

const SECTIONS: Section[] = [
  {
    title: "Visão Geral",
    items: [{ label: "Painel", href: "/painel" }],
  },
  {
    title: "Acompanhamentos",
    items: [
      { label: "Ordens de Corte", href: "/acompanhamentos/ordens-de-corte" },
      { label: "Colheita", href: "/acompanhamentos/colheita" },
      { label: "Insumos", href: "/acompanhamentos/insumos" },
      { label: "Ordem de Serviço Agr.", href: "/acompanhamentos/os-agricola" },
      { label: "Colheita Terceiro", href: "/acompanhamentos/colheita-terceiro" },
    ],
  },
  {
    title: "Contencioso",
    items: [{ label: "Painel de ocorrências", href: "/contencioso" }],
  },
  {
    title: "Planejamento",
    items: [{ label: "Cadastro de Atividades", href: "/planejamento/cadastro-atividades" }],
  },
  {
    title: "Agricultura",
    items: [
      { label: "Fazendas e Talhões", href: "/agricultura/fazendas" },
      { label: "Frentes e Equipes", href: "/agricultura/frentes" },
    ],
  },
  {
    title: "Configurações",
    items: [{ label: "Cadastros", href: "/configuracoes/cadastros" }],
  },
];

function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "?";
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

export default function Sidebar({ usuario }: { usuario?: UsuarioLogado }) {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [saindo, setSaindo] = useState(false);

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
        collapsed ? "w-[68px]" : "w-[252px]"
      }`}
    >
      <div className="flex items-center gap-2 px-3 py-4">
        {!collapsed && (
          <img src="/logo-crv-branca.png" alt="CRV Industrial" className="h-16 w-auto flex-shrink-0" />
        )}
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="ml-auto flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-white/10 hover:text-white"
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

      <nav className="flex-1 overflow-y-auto px-2 pb-4">
        {SECTIONS.map((section) => (
          <div key={section.title} className="mb-1 mt-3 first:mt-1">
            {!collapsed && (
              <div className="px-2.5 pb-1.5 text-[10.5px] font-bold uppercase tracking-wider text-slate-500">
                {section.title}
              </div>
            )}
            <div className="flex flex-col gap-0.5">
              {section.items.map((item) => {
                const active = pathname === item.href || pathname?.startsWith(item.href + "/");
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    title={collapsed ? item.label : undefined}
                    className={`flex items-center gap-2 rounded-md px-2.5 py-2 text-[13px] font-medium transition-colors ${
                      active
                        ? "bg-white text-navy-900 shadow-card"
                        : "text-slate-300 hover:bg-white/8 hover:text-white"
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${
                        active ? "bg-brand-600" : "bg-slate-600"
                      }`}
                    />
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
      </nav>

      <div className="border-t border-white/10 px-2 py-3">
        <div className={`flex items-center gap-2.5 ${collapsed ? "justify-center" : "px-1"}`}>
          <div
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-brand-500 text-[11px] font-bold text-white"
            title={usuario ? `${usuario.nome} · ${usuario.email}` : undefined}
          >
            {usuario ? iniciais(usuario.nome) : "CA"}
          </div>
          {!collapsed && (
            <div className="min-w-0 leading-tight">
              <div className="truncate text-[12.5px] font-semibold text-white">
                {usuario?.nome ?? "Controle Agrícola"}
              </div>
              <div className="truncate text-[11px] text-slate-400">
                {usuario?.email ?? "Unidade Capinópolis-MG"}
              </div>
            </div>
          )}
        </div>
        {usuario && (
          <button
            type="button"
            onClick={handleLogout}
            disabled={saindo}
            title="Sair"
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
            {!collapsed && <span>{saindo ? "Saindo..." : "Sair"}</span>}
          </button>
        )}
      </div>
    </aside>
  );
}
