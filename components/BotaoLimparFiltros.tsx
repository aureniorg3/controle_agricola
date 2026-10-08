"use client";

/**
 * "Limpar filtros" padrão do sistema: aparece só quando algum filtro está diferente do padrão e, ao clicar, a tela
 * volta TODOS os filtros (inclusive os lembrados neste navegador) para o valor inicial.
 */
export default function BotaoLimparFiltros({ ativo, onLimpar, className = "" }: { ativo: boolean; onLimpar: () => void; className?: string }) {
  if (!ativo) return null;
  return (
    <button
      type="button"
      onClick={onLimpar}
      className={`whitespace-nowrap rounded-md px-2 py-1.5 text-[12px] font-medium text-[#2E5FA8] underline-offset-2 hover:bg-[#2E5FA8]/[0.06] hover:underline ${className}`}
      title="Volta todos os filtros desta tela para o padrão"
    >
      Limpar filtros
    </button>
  );
}
