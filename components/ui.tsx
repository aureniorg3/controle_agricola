import type { ReactNode } from "react";

export function Campo({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-semibold text-muted">{label}</span>
      {children}
    </label>
  );
}

export function ModalShell({
  titulo,
  onFechar,
  children,
}: {
  titulo: string;
  onFechar: () => void;
  children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy-950/50 px-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl2 bg-card p-5 shadow-pop">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[16px] font-bold text-ink">{titulo}</h2>
          <button
            type="button"
            onClick={onFechar}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-surface"
            aria-label="Fechar"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
