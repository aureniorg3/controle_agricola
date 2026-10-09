"use client";

import { useCallback, useEffect, useState } from "react";
import { TabelaAuditoria } from "@/components/AuditoriaModal";
import { IconAtualizar } from "@/components/icons";
import { BarraFiltros, CabecalhoPagina, Comando, CorpoPagina, Pagina } from "@/components/pagina";
import type { RegistroAuditoria } from "@/lib/auditoria";
import { ehTexto, usarPersistido } from "@/lib/usar-persistido";
import BotaoLimparFiltros from "@/components/BotaoLimparFiltros";

const FILTRO =
  "rounded-md border border-line bg-card px-2.5 py-1.5 text-[12.5px] text-ink focus:border-brand-600 focus:outline-none";

export default function AuditoriaClient() {
  const [modulo, setModulo] = usarPersistido("auditoria.modulo", "", ehTexto);
  const [usuario, setUsuario] = usarPersistido("auditoria.usuario", "", ehTexto);
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");
  const [busca, setBusca] = useState("");
  const [termo, setTermo] = useState("");
  const [registros, setRegistros] = useState<RegistroAuditoria[]>([]);
  const [opcoes, setOpcoes] = useState<{ modulos: string[]; usuarios: string[] } | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const algumFiltroAtivo = modulo !== "" || usuario !== "" || de !== "" || ate !== "" || busca !== "";
  function limparFiltros() {
    setModulo("");
    setUsuario("");
    setDe("");
    setAte("");
    setBusca("");
    setTermo("");
  }

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const p = new URLSearchParams();
      if (modulo) p.set("modulo", modulo);
      if (usuario) p.set("usuario", usuario);
      if (de) p.set("de", de);
      if (ate) p.set("ate", ate);
      if (termo) p.set("q", termo);
      if (!opcoes) p.set("opcoes", "1");
      const res = await fetch(`/api/auditoria?${p}`, { cache: "no-store" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Não foi possível carregar o log.");
      setRegistros(j.registros);
      if (j.opcoes) setOpcoes(j.opcoes);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível carregar o log.");
    } finally {
      setCarregando(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modulo, usuario, de, ate, termo]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  useEffect(() => {
    const t = setTimeout(() => setTermo(busca), 350);
    return () => clearTimeout(t);
  }, [busca]);

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
          Tudo o que é lançado, alterado, excluído ou importado no sistema fica registrado aqui, com a data, a hora e o usuário. Os
          registros mais recentes aparecem primeiro (até 300).
        </p>
        <BarraFiltros>
          <select value={modulo} onChange={(e) => setModulo(e.target.value)} className={FILTRO} aria-label="Módulo">
            <option value="">Todos os módulos</option>
            {opcoes?.modulos.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <select value={usuario} onChange={(e) => setUsuario(e.target.value)} className={FILTRO} aria-label="Usuário">
            <option value="">Todos os usuários</option>
            {opcoes?.usuarios.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 text-[12px] text-muted">
            De
            <input type="date" value={de} onChange={(e) => setDe(e.target.value)} className={FILTRO} />
          </label>
          <label className="flex items-center gap-1.5 text-[12px] text-muted">
            Até
            <input type="date" value={ate} onChange={(e) => setAte(e.target.value)} className={FILTRO} />
          </label>
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar no log…" className={`${FILTRO} min-w-[220px]`} />
          <BotaoLimparFiltros ativo={algumFiltroAtivo} onLimpar={limparFiltros} />
        </BarraFiltros>
        {erro && <p className="mb-2 text-[12.5px] font-medium text-alert-600">{erro}</p>}
        <div className="overflow-auto rounded-xl2 border border-line bg-card shadow-card">
          {carregando && registros.length === 0 ? (
            <p className="px-4 py-6 text-[12.5px] text-muted">Carregando…</p>
          ) : registros.length === 0 ? (
            <p className="px-4 py-8 text-center text-[12.5px] text-muted">Nenhum registro no log para os filtros escolhidos.</p>
          ) : (
            <TabelaAuditoria linhas={registros} />
          )}
        </div>
      </CorpoPagina>
    </Pagina>
  );
}
