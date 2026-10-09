import { IconUsina } from "./icons";
import { CabecalhoPagina, CorpoPagina, Pagina } from "./pagina";

export default function PlaceholderPage({ categoria, titulo, descricao }) {
  return (
    <Pagina>
      <CabecalhoPagina titulo={titulo} categoria={categoria} />
      <CorpoPagina className="flex items-center justify-center">
        <div className="max-w-md rounded-xl2 border border-dashed border-line bg-card px-8 py-12 text-center shadow-card">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-700">
            <IconUsina size={22} />
          </div>
          <h2 className="font-display text-[20px] font-semibold text-ink">{titulo}</h2>
          <p className="mt-2 text-[13px] leading-relaxed text-muted">{descricao}</p>
          <p className="mt-3 text-[12px] font-medium text-brand-700">
            Módulo em construção — comece pelo Acompanhamento de Ordens de Corte, já em funcionamento.
          </p>
        </div>
      </CorpoPagina>
    </Pagina>
  );
}
