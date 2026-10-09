import type { ReactNode } from "react";

/**
 * Moldura das telas de entrada (login e troca de senha): à esquerda, a faixa azul CRV com o logo branco, o nome do
 * sistema e as linhas de plantio ao fundo; à direita, o formulário. No celular, só o formulário com o logo em cima.
 */
export default function TelaAcesso({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen bg-surface">
      <aside className="relative hidden w-[42%] max-w-[560px] flex-col justify-between overflow-hidden border-r-[4px] border-crv-verde bg-navy-900 px-12 py-10 text-white lg:flex">
        {/* linhas de plantio (talhão visto de cima), só como textura */}
        <svg className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.07]" aria-hidden="true" preserveAspectRatio="none" viewBox="0 0 400 800">
          {Array.from({ length: 34 }, (_, i) => (
            <path key={i} d={`M ${-120 + i * 18} 820 C ${-20 + i * 18} 560, ${40 + i * 18} 300, ${200 + i * 18} -20`} fill="none" stroke="#fff" strokeWidth="1.4" />
          ))}
        </svg>
        <img src="/logo-crv-branca-pdf.png" alt="CRV Industrial" className="relative h-14 w-auto self-start" />
        <div className="relative">
          <div className="font-display text-[46px] font-semibold leading-[1.02]">Controle Agrícola</div>
          <p className="mt-4 max-w-[340px] text-[14px] leading-relaxed text-white/75">
            Ordens de corte, moagem, insumos, atividades e rodadas de campo da safra, num só lugar.
          </p>
        </div>
        <div className="relative text-[12px] text-white/60">CRV Industrial · Unidade Capinópolis-MG</div>
      </aside>
      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-[380px]">
          <div className="mb-6 flex flex-col items-center gap-2 lg:hidden">
            <img src="/logo-crv-azul.png" alt="CRV Industrial" className="h-auto w-56 dark:hidden" />
            <img src="/logo-crv-branca.png" alt="CRV Industrial" className="hidden h-auto w-56 dark:block" />
            <div className="text-center text-[12px] text-muted">Controle Agrícola · Unidade Capinópolis-MG</div>
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
