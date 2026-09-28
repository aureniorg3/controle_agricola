export default function PlaceholderPage({
  categoria,
  titulo,
  descricao,
}: {
  categoria: string;
  titulo: string;
  descricao: string;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <header className="flex flex-shrink-0 items-center gap-3 border-b border-line bg-card px-6 py-3">
        <nav className="min-w-0 flex-1 text-[13px] text-muted">
          <span className="uppercase tracking-wide text-[11px] text-muted">{categoria}</span>
          <div className="truncate text-[15px] font-bold text-ink">{titulo}</div>
        </nav>
      </header>
      <div className="flex flex-1 items-center justify-center px-6">
        <div className="max-w-md rounded-xl2 border border-dashed border-line bg-card px-8 py-12 text-center shadow-card">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-700">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 3l9 4.5v9L12 21l-9-4.5v-9L12 3z"
                stroke="currentColor"
                strokeWidth="1.6"
              />
              <path d="M12 12v6M12 12L4.5 8M12 12l7.5-4" stroke="currentColor" strokeWidth="1.6" />
            </svg>
          </div>
          <h1 className="text-[16px] font-bold text-ink">{titulo}</h1>
          <p className="mt-2 text-[13px] leading-relaxed text-muted">{descricao}</p>
          <p className="mt-3 text-[12px] font-medium text-brand-700">
            Módulo em construção — comece pelo Acompanhamento de Ordens de Corte, já em funcionamento.
          </p>
        </div>
      </div>
    </div>
  );
}
