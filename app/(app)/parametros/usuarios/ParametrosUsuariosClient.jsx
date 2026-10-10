"use client";

import { useMemo, useState } from "react";
import { CabecalhoPagina, CorpoPagina, Pagina, Painel } from "@/components/pagina";
import { telasDoMenu } from "@/lib/menu";
import { PERFIL_DESCRICAO, PERFIL_LABEL, PERFIS } from "@/lib/permissoes";

const TELAS = telasDoMenu();
const SECOES = Array.from(new Set(TELAS.map((t) => t.secao)));
const TODAS = TELAS.map((t) => t.href);

const COR_PERFIL = {
  leitura: "bg-surface text-muted",
  analista1: "bg-amber-50 text-amber-700",
  analista2: "bg-amber-50 text-amber-700",
  gravacao: "bg-brand-50 text-brand-700",
  admin: "bg-good-50 text-good-600",
};

function Selo({ perfil }) {
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${COR_PERFIL[perfil]}`}>{PERFIL_LABEL[perfil]}</span>;
}

const nomeCompleto = (u) => `${u.nome} ${u.sobrenome}`.trim() || u.usuario;

export default function ParametrosUsuariosClient({ usuariosIniciais, idLogado }) {
  const [usuarios, setUsuarios] = useState(usuariosIniciais);
  const [busca, setBusca] = useState("");
  const [selId, setSelId] = useState(usuariosIniciais.find((u) => u.perfil !== "admin")?.id ?? usuariosIniciais[0]?.id ?? null);
  const sel = usuarios.find((u) => u.id === selId) ?? null;

  // rascunho do usuário escolhido
  const [perfil, setPerfil] = useState(sel?.perfil ?? "leitura");
  const [todas, setTodas] = useState(sel ? sel.acessos === null : true);
  const [marcadas, setMarcadas] = useState(new Set(sel?.acessos ?? TODAS));
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState(null);

  const alterado =
    !!sel &&
    (perfil !== sel.perfil ||
      todas !== (sel.acessos === null) ||
      (!todas && (sel.acessos === null || sel.acessos.length !== marcadas.size || sel.acessos.some((h) => !marcadas.has(h)))));

  function escolher(u) {
    if (u.id === selId) return;
    if (alterado && !window.confirm("Há alterações não salvas para este usuário. Descartar?")) return;
    setSelId(u.id);
    setPerfil(u.perfil);
    setTodas(u.acessos === null);
    setMarcadas(new Set(u.acessos ?? TODAS));
    setMsg(null);
  }

  const lista = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return usuarios.filter((u) => !q || `${nomeCompleto(u)} ${u.email} ${u.usuario}`.toLowerCase().includes(q));
  }, [usuarios, busca]);

  const alternar = (href) =>
    setMarcadas((m) => {
      const n = new Set(m);
      if (n.has(href)) n.delete(href);
      else n.add(href);
      return n;
    });
  const marcarSecao = (secao, marcar) =>
    setMarcadas((m) => {
      const n = new Set(m);
      for (const t of TELAS) if (t.secao === secao) marcar ? n.add(t.href) : n.delete(t.href);
      return n;
    });

  async function salvar() {
    if (!sel) return;
    setSalvando(true);
    setMsg(null);
    try {
      let atualizado = { ...sel };
      if (perfil !== sel.perfil) {
        const res = await fetch(`/api/usuarios/${sel.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ perfil }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error ?? "Não foi possível alterar o perfil.");
        atualizado = { ...atualizado, perfil };
      }
      if (perfil !== "admin") {
        const acessos = todas ? null : TODAS.filter((h) => marcadas.has(h));
        const mudouAcesso =
          todas !== (sel.acessos === null) || (!todas && (sel.acessos?.length !== acessos.length || acessos.some((h) => !sel.acessos.includes(h))));
        if (mudouAcesso) {
          const res = await fetch("/api/parametros/acessos", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: sel.id, acessos }),
          });
          const json = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(json.error ?? "Não foi possível salvar as telas liberadas.");
          atualizado = { ...atualizado, acessos };
        }
      }
      setUsuarios((us) => us.map((u) => (u.id === sel.id ? atualizado : u)));
      setMsg({ texto: "Alterações salvas. Valem no próximo acesso do usuário (ou ao recarregar a página).", erro: false });
    } catch (e) {
      setMsg({ texto: e instanceof Error ? e.message : "Não foi possível salvar.", erro: true });
    } finally {
      setSalvando(false);
    }
  }

  const ehAdminSel = perfil === "admin";
  const desabilitado = ehAdminSel || todas;

  return (
    <Pagina>
      <div className="flex min-h-0 flex-1 flex-col" translate="no">
        <CabecalhoPagina
          titulo="Usuários"
          categoria="Configurações · Parâmetros"
        />

        <CorpoPagina>
          <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
            {/* usuários e perfis */}
            <div className="space-y-4">
              <div className="rounded-xl2 border border-line bg-card shadow-card">
                <div className="border-b border-line p-3">
                  <input
                    value={busca}
                    onChange={(e) => setBusca(e.target.value)}
                    placeholder="Buscar usuário"
                    className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-[13px]"
                    aria-label="Buscar usuário"
                  />
                </div>
                <ul className="max-h-[420px] overflow-y-auto p-1.5">
                  {lista.map((u) => (
                    <li key={u.id}>
                      <button
                        type="button"
                        onClick={() => escolher(u)}
                        className={`flex w-full items-start justify-between gap-2 rounded-lg px-3 py-2 text-left ${u.id === selId ? "bg-[#2D8A5A]/10" : "hover:bg-surface"} ${u.ativo ? "" : "opacity-60"}`}
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-[13px] font-medium text-ink">
                            {nomeCompleto(u)}
                            {u.id === idLogado && <span className="ml-1 text-[11px] font-normal text-muted">(você)</span>}
                          </span>
                          <span className="block truncate text-[11.5px] text-muted">
                            {u.perfil === "admin" ? "Todas as telas" : u.acessos === null ? "Todas as telas" : `${u.acessos.length} de ${TODAS.length} telas`}
                            {u.ativo ? "" : " · inativo"}
                          </span>
                        </span>
                        <Selo perfil={u.perfil} />
                      </button>
                    </li>
                  ))}
                  {lista.length === 0 && <li className="px-3 py-4 text-center text-[12.5px] text-muted">Nenhum usuário encontrado.</li>}
                </ul>
              </div>

              <Painel titulo="Perfis">
                <dl className="space-y-2">
                  {PERFIS.map((p) => (
                    <div key={p}>
                      <dt>
                        <Selo perfil={p} />
                      </dt>
                      <dd className="mt-1 text-[11.5px] leading-snug text-muted">{PERFIL_DESCRICAO[p]}</dd>
                    </div>
                  ))}
                </dl>
              </Painel>
            </div>

            {/* acesso do usuário escolhido */}
            {sel ? (
              <div className="rounded-xl2 border border-line bg-card p-5 shadow-card">
                <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-4">
                  <div className="min-w-0">
                    <h2 className="truncate text-[16px] font-semibold text-ink">{nomeCompleto(sel)}</h2>
                    <p className="text-[12px] text-muted">
                      {sel.email} · {sel.usuario}
                    </p>
                  </div>
                  <label className="block w-full max-w-[260px]">
                    <span className="mb-1 block text-[11.5px] text-muted">Perfil</span>
                    <select
                      value={perfil}
                      onChange={(e) => setPerfil(e.target.value)}
                      disabled={sel.id === idLogado}
                      className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-[13px] disabled:opacity-60"
                    >
                      {PERFIS.map((p) => (
                        <option key={p} value={p}>
                          {PERFIL_LABEL[p]}
                        </option>
                      ))}
                    </select>
                    <span className="mt-1 block text-[11.5px] leading-snug text-muted">
                      {sel.id === idLogado ? "Você não pode alterar o próprio perfil." : PERFIL_DESCRICAO[perfil]}
                    </span>
                  </label>
                </div>

                <div className="mt-4">
                  <h3 className="text-[13.5px] font-semibold text-ink">Telas que o usuário vê</h3>
                  {ehAdminSel ? (
                    <p className="mt-2 text-[12.5px] text-muted">O administrador vê todas as telas, inclusive os Parâmetros.</p>
                  ) : (
                    <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2 text-[13px] text-ink">
                      <label className="flex items-center gap-2">
                        <input type="radio" name="modo" checked={todas} onChange={() => setTodas(true)} />
                        Todas as telas (inclusive as que forem criadas depois)
                      </label>
                      <label className="flex items-center gap-2">
                        <input type="radio" name="modo" checked={!todas} onChange={() => setTodas(false)} />
                        Somente as telas marcadas
                      </label>
                    </div>
                  )}
                  <p className="mt-1 text-[11.5px] text-muted">O Início fica sempre liberado. Cadastros de usuários e Parâmetros são só do administrador.</p>
                </div>

                <div className={`mt-4 space-y-5 ${desabilitado ? "pointer-events-none opacity-45" : ""}`} aria-disabled={desabilitado}>
                  {SECOES.map((secao) => {
                    const telas = TELAS.filter((t) => t.secao === secao);
                    const n = telas.filter((t) => marcadas.has(t.href)).length;
                    return (
                      <section key={secao}>
                        <div className="mb-2 flex flex-wrap items-baseline gap-3 border-b border-line pb-1.5">
                          <h4 className="text-[12.5px] font-semibold text-[#2D8A5A]">{secao}</h4>
                          <span className="text-[11.5px] text-muted">
                            {n} de {telas.length}
                          </span>
                          <span className="ml-auto flex gap-3 text-[11.5px]">
                            <button
                              type="button"
                              className="text-muted hover:text-ink"
                              onClick={() => marcarSecao(secao, true)}
                              tabIndex={desabilitado ? -1 : 0}
                            >
                              Marcar todas
                            </button>
                            <button
                              type="button"
                              className="text-muted hover:text-ink"
                              onClick={() => marcarSecao(secao, false)}
                              tabIndex={desabilitado ? -1 : 0}
                            >
                              Desmarcar
                            </button>
                          </span>
                        </div>
                        <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2 xl:grid-cols-3">
                          {telas.map((t) => (
                            <label key={t.href} className="flex items-start gap-2 rounded-md px-1.5 py-1 text-[12.5px] hover:bg-surface">
                              <input
                                type="checkbox"
                                className="mt-0.5"
                                checked={desabilitado ? true : marcadas.has(t.href)}
                                onChange={() => alternar(t.href)}
                                tabIndex={desabilitado ? -1 : 0}
                              />
                              <span className="min-w-0">
                                {t.caminho.length > 1 && <span className="text-muted">{t.caminho.slice(0, -1).join(" › ")} › </span>}
                                <span className="text-ink">{t.label}</span>
                              </span>
                            </label>
                          ))}
                        </div>
                      </section>
                    );
                  })}
                </div>

                <div className="mt-6 flex flex-wrap items-center justify-end gap-3 border-t border-line pt-4">
                  {msg && <p className={`mr-auto text-[12.5px] ${msg.erro ? "text-alert-700" : "text-good-600"}`}>{msg.texto}</p>}
                  {!todas && !ehAdminSel && (
                    <span className="text-[12px] text-muted">
                      {marcadas.size} de {TODAS.length} telas marcadas
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={salvar}
                    disabled={salvando || !alterado || (!todas && !ehAdminSel && marcadas.size === 0)}
                    className="rounded-lg bg-navy-900 px-4 py-2 text-[13px] font-medium text-white hover:bg-navy-800 disabled:opacity-40"
                  >
                    {salvando ? "Salvando…" : "Salvar"}
                  </button>
                </div>
              </div>
            ) : (
              <p className="rounded-xl2 border border-dashed border-line px-4 py-8 text-center text-[13px] text-muted">Escolha um usuário na lista.</p>
            )}
          </div>
        </CorpoPagina>
      </div>
    </Pagina>
  );
}
