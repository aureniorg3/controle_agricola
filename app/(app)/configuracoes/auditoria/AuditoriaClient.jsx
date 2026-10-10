"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import BotaoLimparFiltros from "@/components/BotaoLimparFiltros";
import { IconAtualizar } from "@/components/icons";
import { BarraFiltros, CabecalhoPagina, Comando, CorpoPagina, Pagina, Painel } from "@/components/pagina";
import { fmtDataHora } from "@/lib/format";
import { ehTexto, ehUmDe, usarPersistido } from "@/lib/usar-persistido";

const FILTRO = "rounded-md border border-line bg-card px-2.5 py-1.5 text-[12.5px] text-ink focus:border-brand-600 focus:outline-none";
const ROTULO = "flex flex-col gap-1 text-[11.5px] text-muted";

const ACOES = [
  { id: "inclusao", nome: "Inclusão" },
  { id: "alteracao", nome: "Alteração" },
  { id: "exclusao", nome: "Exclusão" },
  { id: "importacao", nome: "Importação" },
  { id: "limpeza", nome: "Limpeza" },
];
/** ação lembrada neste navegador: só serve se ainda for uma das da lista (senão a lista mostraria em branco) */
const ehAcao = ehUmDe(["", ...ACOES.map((a) => a.id)]);

/** "Todos os lançamentos", "Todos os cadastros"… */
const todosDoGrupo = (g) => (g === "Cadastros" ? "Todos os cadastros" : g === "Lançamentos" ? "Todos os lançamentos" : `Todos — ${g.toLowerCase()}`);

/**
 * Configurações › Log de Alterações: o único lugar do sistema para consultar o que foi lançado, alterado, excluído ou
 * importado — escolhendo o programa (a tela de lançamento, consulta ou cadastro) em que foi feito.
 */
export default function AuditoriaClient() {
  const [programa, setPrograma] = usarPersistido("auditoria.programa", "", ehTexto);
  const [acao, setAcao] = usarPersistido("auditoria.acao", "", ehAcao);
  const [usuario, setUsuario] = usarPersistido("auditoria.usuario", "", ehTexto);
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");
  const [busca, setBusca] = useState("");
  const [termo, setTermo] = useState("");
  const [registros, setRegistros] = useState([]);
  const [opcoes, setOpcoes] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(null);
  const algumFiltroAtivo = programa !== "" || acao !== "" || usuario !== "" || de !== "" || ate !== "" || busca !== "";
  function limparFiltros() {
    setPrograma("");
    setAcao("");
    setUsuario("");
    setDe("");
    setAte("");
    setBusca("");
    setTermo("");
  }

  // cada busca leva um número: a resposta de uma busca que já foi substituída por outra (ex.: a primeira, sem os filtros
  // lembrados neste navegador, ou um filtro trocado antes de a anterior voltar) não pode sobrescrever a tabela
  const ultimaBusca = useRef(0);
  const carregar = useCallback(async () => {
    const n = ++ultimaBusca.current;
    const atual = () => n === ultimaBusca.current;
    setCarregando(true);
    setErro(null);
    try {
      const p = new URLSearchParams();
      if (programa) p.set("programa", programa);
      if (acao) p.set("acao", acao);
      if (usuario) p.set("usuario", usuario);
      if (de) p.set("de", de);
      if (ate) p.set("ate", ate);
      if (termo) p.set("q", termo);
      if (!opcoes) p.set("opcoes", "1");
      const res = await fetch(`/api/auditoria?${p}`, { cache: "no-store" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Não foi possível carregar o log.");
      if (j.opcoes) setOpcoes(j.opcoes); // as opções não dependem dos filtros: valem mesmo de uma busca já substituída
      if (atual()) setRegistros(j.registros);
    } catch (e) {
      if (atual()) setErro(e instanceof Error ? e.message : "Não foi possível carregar o log.");
    } finally {
      if (atual()) setCarregando(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [programa, acao, usuario, de, ate, termo]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  useEffect(() => {
    const t = setTimeout(() => setTermo(busca), 350);
    return () => clearTimeout(t);
  }, [busca]);

  // programa ou usuário lembrados neste navegador que não existem mais na lista (programa renomeado/retirado, usuário
  // sem registro no log): voltam para "Todos" — senão a lista ficaria em branco e a consulta, filtrada por algo que não aparece
  useEffect(() => {
    if (!opcoes) return;
    const programaValido =
      programa === "" ||
      (programa.startsWith("grupo:") ? opcoes.grupos.includes(programa.slice(6)) : opcoes.programas.some((p) => p.id === programa));
    if (!programaValido) setPrograma("");
    if (usuario !== "" && !opcoes.usuarios.includes(usuario)) setUsuario("");
  }, [opcoes, programa, usuario, setPrograma, setUsuario]);

  const nomeEscolha = programa.startsWith("grupo:")
    ? todosDoGrupo(programa.slice(6))
    : (opcoes?.programas.find((p) => p.id === programa)?.rotulo ?? "");

  return (
    <Pagina>
      <CabecalhoPagina
        titulo="Log de Alterações"
        categoria="Configurações"
        comandos={
          <Comando icone={<IconAtualizar size={16} />} onClick={carregar}>
            Atualizar
          </Comando>
        }
      />
      <CorpoPagina>
        <p className="mb-4 max-w-3xl text-[12.5px] leading-relaxed text-muted">
          Tudo o que é lançado, alterado, excluído ou importado no sistema fica registrado aqui, com a data, a hora e o usuário. Escolha o programa em que
          foi feito — a tela de lançamento, de consulta ou de cadastro — para ver só o log dele. Os registros mais recentes aparecem primeiro (até 300).
        </p>
        <BarraFiltros>
          <label className={ROTULO}>
            Programa
            <select value={programa} onChange={(e) => setPrograma(e.target.value)} className={`${FILTRO} min-w-[280px] max-w-[360px]`}>
              <option value="">Todos os programas</option>
              {(opcoes?.grupos ?? []).map((g) => (
                <optgroup key={g} label={g}>
                  <option value={`grupo:${g}`}>{todosDoGrupo(g)}</option>
                  {opcoes.programas
                    .filter((p) => p.grupo === g)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.rotulo}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label className={ROTULO}>
            Ação
            <select value={acao} onChange={(e) => setAcao(e.target.value)} className={FILTRO}>
              <option value="">Todas</option>
              {ACOES.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.nome}
                </option>
              ))}
            </select>
          </label>
          <label className={ROTULO}>
            Usuário
            <select value={usuario} onChange={(e) => setUsuario(e.target.value)} className={FILTRO}>
              <option value="">Todos</option>
              {opcoes?.usuarios.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </label>
          <label className={ROTULO}>
            De
            <input type="date" value={de} onChange={(e) => setDe(e.target.value)} className={FILTRO} />
          </label>
          <label className={ROTULO}>
            Até
            <input type="date" value={ate} onChange={(e) => setAte(e.target.value)} className={FILTRO} />
          </label>
          <label className={ROTULO}>
            Buscar
            <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Ordem, boletim, código, texto…" className={`${FILTRO} min-w-[220px]`} />
          </label>
          <BotaoLimparFiltros ativo={algumFiltroAtivo} onLimpar={limparFiltros} />
        </BarraFiltros>
        {erro && <p className="mb-2 text-[12.5px] font-medium text-alert-600">{erro}</p>}
        <Painel
          titulo={nomeEscolha || "Todos os programas"}
          subtitulo={carregando ? "Carregando…" : `${registros.length.toLocaleString("pt-BR")} registro(s)${registros.length >= 300 ? " — os 300 mais recentes" : ""}`}
          semEspaco
        >
          {carregando && registros.length === 0 ? (
            <p className="px-4 py-6 text-[12.5px] text-muted">Carregando…</p>
          ) : registros.length === 0 ? (
            <p className="px-4 py-8 text-center text-[12.5px] text-muted">Nenhum registro no log para os filtros escolhidos.</p>
          ) : (
            <div className={`overflow-x-auto transition-opacity ${carregando ? "opacity-60" : ""}`}>
              <TabelaAuditoria linhas={registros} />
            </div>
          )}
        </Painel>
      </CorpoPagina>
    </Pagina>
  );
}

function TabelaAuditoria({ linhas }) {
  return (
    <table className="w-full text-[12px]">
      <thead>
        <tr className="border-b border-line bg-navy-900 text-left text-white">
          <th className="whitespace-nowrap px-3 py-2 font-semibold">Data e hora</th>
          <th className="px-3 py-2 font-semibold">Usuário</th>
          <th className="px-3 py-2 font-semibold">Programa</th>
          <th className="px-3 py-2 font-semibold">O que</th>
          <th className="px-3 py-2 font-semibold">Ação</th>
          <th className="px-3 py-2 font-semibold">Detalhes</th>
        </tr>
      </thead>
      <tbody>
        {linhas.map((l, i) => (
          <tr key={l.id} className={`border-b border-line/60 align-top ${i % 2 === 1 ? "bg-surface" : "bg-card"}`}>
            <td className="whitespace-nowrap px-3 py-1.5 text-ink">{fmtDataHora(l.em)}</td>
            <td className="whitespace-nowrap px-3 py-1.5 text-ink">{l.usuario || "—"}</td>
            <td className="min-w-[150px] px-3 py-1.5 text-ink">{l.programa}</td>
            <td className="min-w-[160px] px-3 py-1.5 text-ink">
              <span className="font-semibold">{l.entidade}</span>
              {l.chave && <span className="block text-muted">{l.chave}</span>}
            </td>
            <td className="whitespace-nowrap px-3 py-1.5 font-semibold text-ink">{l.acao}</td>
            <td className="min-w-[240px] px-3 py-1.5 text-muted">{l.resumo}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
