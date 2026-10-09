"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { IconBusca, IconSetaDireita } from "@/components/icons";
import { telasParaBusca } from "@/lib/menu";

const CHAVE_RECENTES = "ca_recentes";

/** Guarda a tela aberta entre as recentes deste navegador (as 6 últimas), para a busca de telas. */
export function registrarRecente(href) {
  if (!href) return;
  try {
    const lista = JSON.parse(localStorage.getItem(CHAVE_RECENTES) ?? "[]");
    const atual = Array.isArray(lista) ? lista.filter((h) => typeof h === "string" && h !== href) : [];
    localStorage.setItem(CHAVE_RECENTES, JSON.stringify([href, ...atual].slice(0, 6)));
  } catch {
    /* sem armazenamento: a busca só não mostra as recentes */
  }
}

function lerRecentes() {
  try {
    const lista = JSON.parse(localStorage.getItem(CHAVE_RECENTES) ?? "[]");
    return Array.isArray(lista) ? lista.filter((h) => typeof h === "string") : [];
  } catch {
    return [];
  }
}

const normalizar = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Busca de telas (Ctrl K ou a caixa da barra superior): digita parte do nome ou do caminho no menu e abre com Enter.
 * Sem nada digitado, mostra as telas abertas por último e, depois, todas as do menu do usuário.
 */
export default function PaletaComandos({ secoes, onFechar }) {
  const router = useRouter();
  const [termo, setTermo] = useState("");
  const [sel, setSel] = useState(0);
  const listaRef = useRef(null);
  const telas = useMemo(() => telasParaBusca(secoes), [secoes]);
  const [recentes] = useState(() => lerRecentes());

  const grupos = useMemo(() => {
    const t = normalizar(termo.trim());
    if (!t) {
      const rec = recentes.map((h) => telas.find((x) => x.href === h)).filter((x) => !!x);
      return [...(rec.length ? [{ titulo: "Abertas por último", itens: rec }] : []), { titulo: "Todas as telas", itens: telas }];
    }
    const partes = t.split(/\s+/);
    const pontuadas = telas
      .map((x) => {
        const nome = normalizar(x.label);
        const tudo = normalizar([...x.caminho, x.label].join(" "));
        if (!partes.every((p) => tudo.includes(p))) return null;
        const pontos = nome.startsWith(t) ? 0 : nome.includes(t) ? 1 : partes.every((p) => nome.includes(p)) ? 2 : 3;
        return { x, pontos };
      })
      .filter((v) => !!v)
      .sort((a, b) => a.pontos - b.pontos);
    return [{ titulo: pontuadas.length ? "Telas encontradas" : "", itens: pontuadas.map((p) => p.x) }];
  }, [termo, telas, recentes]);

  const plana = useMemo(() => grupos.flatMap((g) => g.itens), [grupos]);
  useEffect(() => setSel(0), [termo]);
  useEffect(() => {
    listaRef.current?.querySelector(`[data-indice="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  function abrir(t) {
    if (!t) return;
    onFechar();
    router.push(t.href);
  }

  function teclas(e) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((s) => Math.min(plana.length - 1, s + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((s) => Math.max(0, s - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      abrir(plana[sel]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onFechar();
    }
  }

  let indice = -1;
  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-navy-950/45 px-3 pt-[10vh]" onMouseDown={onFechar}>
      <div
        className="flex max-h-[72vh] w-full max-w-[620px] flex-col overflow-hidden rounded-xl2 border border-line bg-card shadow-pop"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Buscar tela"
      >
        <div className="flex items-center gap-2.5 border-b border-line px-4">
          <span className="text-muted">
            <IconBusca size={18} />
          </span>
          <input
            autoFocus
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
            onKeyDown={teclas}
            placeholder="Buscar tela pelo nome ou pelo módulo"
            className="h-12 min-w-0 flex-1 bg-transparent text-[15px] text-ink placeholder:text-muted focus:shadow-none focus-visible:shadow-none"
            role="combobox"
            aria-expanded="true"
            aria-controls="paleta-lista"
          />
          <kbd className="rounded border border-line px-1.5 py-0.5 text-[10.5px] text-muted">Esc</kbd>
        </div>
        <div ref={listaRef} id="paleta-lista" role="listbox" className="flex-1 overflow-y-auto py-1.5">
          {plana.length === 0 && <p className="px-4 py-6 text-center text-[13px] text-muted">Nenhuma tela com “{termo.trim()}”. Tente outra parte do nome.</p>}
          {grupos.map(
            (g) =>
              g.itens.length > 0 && (
                <div key={g.titulo} className="pb-1">
                  {g.titulo && <div className="px-4 pb-1 pt-2 text-[11.5px] font-semibold text-muted">{g.titulo}</div>}
                  {g.itens.map((t) => {
                    indice++;
                    const i = indice;
                    const ativo = i === sel;
                    return (
                      <button
                        key={`${g.titulo}-${t.href}`}
                        type="button"
                        data-indice={i}
                        role="option"
                        aria-selected={ativo}
                        onMouseMove={() => setSel(i)}
                        onClick={() => abrir(t)}
                        className={`relative flex w-full items-center gap-3 px-4 py-2 text-left ${ativo ? "bg-hover" : ""}`}
                      >
                        {ativo && <span className="absolute inset-y-1 left-0 w-[3px] rounded-r bg-crv-verde" aria-hidden="true" />}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13.5px] text-ink">{t.label}</span>
                          {t.caminho.length > 0 && <span className="block truncate text-[11.5px] text-muted">{t.caminho.join(" › ")}</span>}
                        </span>
                        {ativo && (
                          <span className="flex-shrink-0 text-muted">
                            <IconSetaDireita size={14} />
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ),
          )}
        </div>
        <div className="flex items-center gap-3 border-t border-line px-4 py-2 text-[11px] text-muted">
          <span>
            <kbd className="rounded border border-line px-1">↑</kbd> <kbd className="rounded border border-line px-1">↓</kbd> navegar
          </span>
          <span>
            <kbd className="rounded border border-line px-1">Enter</kbd> abrir
          </span>
          <span className="ml-auto">Ctrl K abre esta busca de qualquer tela</span>
        </div>
      </div>
    </div>
  );
}
