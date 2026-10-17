"use client";

import { useState } from "react";
import { JanelaInfo } from "@/components/janela";
import { qtdParaArea, textoDose } from "@/lib/os-agr";

/*
 * Dose recomendada da O.S. no momento de apontar (tela Apontamento e Lançamento Mobile): os insumos da requisição de
 * produtos da operação (relatório OS - Ordem de Serviço do ERP), com a dose por ha, e a janela "Ver insumos e doses" com
 * a quantidade para a área que está sendo lançada (dose × área) e a requisitada na O.S.
 */

const nf = (n, c = 2) => n.toLocaleString("pt-BR", { minimumFractionDigits: c, maximumFractionDigits: c });
const nf3 = (n) => n.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 3 });

/**
 * `insumos`: os da operação ([{ prodCod, ds, un, dose, qtd, almox, almoxNm, servico }]); `area`: a área do lançamento
 * (ha); `vazao`: a vazão da observação da O.S. (L/ha). `compacto` (celular): um insumo por linha. Sem insumos nem
 * vazão, nada.
 */
export default function InsumosRecomendados({ os, opCod, opDs, insumos = [], vazao = null, area = 0, compacto = false }) {
  const [aberto, setAberto] = useState(false);
  const produtos = insumos.filter((i) => !i.servico);
  if (produtos.length === 0 && !vazao) return null;
  const botao = (
    <button
      type="button"
      onClick={() => setAberto(true)}
      className="whitespace-nowrap text-[12px] font-medium text-crv-acao hover:underline dark:text-[#8fb6f2]"
      aria-haspopup="dialog"
    >
      Ver insumos e doses
    </button>
  );
  return (
    <>
      {compacto ? (
        <div className="rounded-lg border border-[#2E5FA8]/25 bg-[#2E5FA8]/[0.05] px-3 py-2 text-[12.5px]">
          <div className="mb-0.5 flex items-center justify-between gap-2">
            <span className="font-medium text-ink">Dose recomendada</span>
            {botao}
          </div>
          <ul className="space-y-0.5">
            {produtos.map((i) => (
              <li key={`${i.prodCod}|${i.almox}`} className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-ink">{i.ds}</span>
                <b className="flex-shrink-0 font-semibold tabular text-ink">{textoDose(i)}</b>
              </li>
            ))}
            {vazao ? (
              <li className="flex items-baseline justify-between gap-3 text-muted">
                <span>Vazão</span>
                <span className="tabular">{nf3(vazao)} L/ha</span>
              </li>
            ) : null}
          </ul>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-[#2E5FA8]/25 bg-[#2E5FA8]/[0.05] px-3 py-2 text-[12.5px]">
          <span className="font-medium text-ink">Dose recomendada na O.S.:</span>
          {produtos.map((i) => (
            <span key={`${i.prodCod}|${i.almox}`} className="whitespace-nowrap text-ink">
              {i.ds} <b className="font-semibold tabular">{textoDose(i)}</b>
            </span>
          ))}
          {vazao ? <span className="whitespace-nowrap text-muted">vazão {nf3(vazao)} L/ha</span> : null}
          <span className="ml-auto">{botao}</span>
        </div>
      )}
      {aberto && (
        <JanelaInfo
          titulo={`Insumos e doses da O.S. ${os}`}
          subtitulo={`Operação ${opCod}${opDs ? ` · ${opDs}` : ""}${area > 0 ? ` · ${nf(area)} ha neste lançamento` : ""}`}
          largura="3xl"
          onFechar={() => setAberto(false)}
        >
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="whitespace-nowrap border-b border-line bg-surface text-left text-muted">
                  <th className="px-3 py-2 font-medium">Insumo</th>
                  <th className="px-3 py-2 text-right font-medium">Dose recomendada</th>
                  <th className="px-3 py-2 text-right font-medium" title="Dose × área deste lançamento">
                    Para {area > 0 ? `${nf(area)} ha` : "a área lançada"}
                  </th>
                  <th className="px-3 py-2 text-right font-medium">Requisitado na O.S.</th>
                </tr>
              </thead>
              <tbody>
                {insumos.map((i) => {
                  const q = qtdParaArea(i.dose, area);
                  return (
                    <tr key={`${i.prodCod}|${i.almox}`} className="border-t border-line/60">
                      <td className="px-3 py-1.5 text-ink">
                        <span className="tabular text-muted">{i.prodCod} · </span>
                        {i.ds}
                        {i.servico && <span className="ml-1.5 rounded-full border border-line px-1.5 text-[10.5px] text-muted">serviço</span>}
                        {i.almoxNm && <div className="text-[11px] text-muted">{i.almox ? `${i.almox} · ` : ""}{i.almoxNm}</div>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-right tabular font-medium text-ink">{textoDose(i)}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-right tabular text-ink">{q === null ? "–" : `${nf3(q)} ${i.un}`}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-right tabular text-muted">{i.qtd === null ? "–" : `${nf3(i.qtd)} ${i.un}`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {vazao ? <p className="mt-2 text-[12px] text-muted">Vazão informada na O.S.: {nf3(vazao)} L/ha.</p> : null}
          <p className="mt-2 text-[12px] leading-relaxed text-muted">
            Dose e quantidade requisitada vêm da requisição de produtos da O.S. (relatório OS - Ordem de Serviço do ERP). A coluna do meio é a dose × a
            área deste lançamento{area > 0 ? "" : " (informe as áreas para ver a quantidade)"}.
          </p>
        </JanelaInfo>
      )}
    </>
  );
}
