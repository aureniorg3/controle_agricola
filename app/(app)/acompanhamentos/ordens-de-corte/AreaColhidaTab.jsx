"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import BotaoLimparFiltros from "@/components/BotaoLimparFiltros";
import { IconMais } from "@/components/icons";
import JanelaFormulario, { Aviso, JanelaConfirmar, useAtalhoTela } from "@/components/janela";
import { Comando, Painel } from "@/components/pagina";
import { fmtDataHora, fmtDateBR, fmtHa } from "@/lib/format";
import { ratearArea } from "@/lib/rateio";

import { ehUmDe, usarPersistido } from "@/lib/usar-persistido";
import LeitorPlanejamento from "./LeitorPlanejamento";

const INPUT = "rounded-md border border-line bg-card px-2.5 py-1.5 text-[13px] text-ink focus:border-brand-600 focus:outline-none disabled:bg-surface";
const ROTULO = "mb-1 block text-[11.5px] font-semibold text-muted";
const BOTAO = "rounded-lg border border-line bg-card px-3 py-1.5 text-[12.5px] font-medium text-navy-800 hover:bg-surface disabled:opacity-50";

const arred = (n) => Math.round(n * 100) / 100;
const numero = (v) => Number(v.replace(/\./g, "").replace(",", "."));

/**
 * Apontamento dia a dia da área colhida: escolhe a data e a ordem, informa os
 * hectares colhidos no dia em cada talhão e grava. O lançamento abre numa janela
 * (Novo lançamento, F2); o histórico fica guardado (com usuário e log), e o filtro
 * de datas anteriores do painel soma só até a data.
 */
export default function AreaColhidaTab({ ordens, referencia, pedidoOrdem, onPedidoAtendido, podeGravar, onSalvo, atalhoAtivo = true }) {
  const formRef = useRef(null);
  const ordemRef = useRef(null);
  const boletimRef = useRef(null);
  // mensagens dentro da janela (no topo do fundo rolável): rola até elas quando mudam
  const avisoRef = useRef(null);
  // área do dia e boletim que vieram do banco (ou da sugestão) para a ordem e a data (para saber se algo foi alterado ao fechar)
  const valoresDoBanco = useRef({});
  const boletimDoBanco = useRef("");
  // ordem e data com que a janela abriu (trocadas, contam como alteração ao fechar)
  const inicio = useRef({ ordem: "", dt: "" });
  // data em uso antes do "Abrir" do histórico: volta ao sair da edição
  const dtAntesDaEdicao = useRef(referencia);
  const [formAberto, setFormAberto] = useState(false);
  // aberta pelo "Abrir" do histórico: gravar fecha a janela
  const [editando, setEditando] = useState(false);
  // aberta com a ordem (cartão ou "Abrir"): o foco vai para o primeiro talhão
  const [focarTalhao, setFocarTalhao] = useState(false);
  const [leitorAberto, setLeitorAberto] = useState(false);
  const [confirmar, setConfirmar] = useState(null);
  const [dt, setDt] = useState(referencia);
  const [ordemNum, setOrdemNum] = useState("");
  // valores = área do DIA por talhão (é o que se grava); no modo acumulado, o que se digita é o total até a data
  const [valores, setValores] = useState({});
  const [informar, setInformar] = usarPersistido("area-colhida.informar", "acumulado", ehUmDe(["acumulado", "dia"]));
  const [acumTexto, setAcumTexto] = useState({});
  const [editHist, setEditHist] = useState(null);
  const [boletim, setBoletim] = useState("");
  // lançar pela ordem (o total do dia é rateado entre os talhões) ou direto em cada talhão
  const [modo, setModo] = useState("talhao");
  const [totalOrdem, setTotalOrdem] = useState("");
  const [baseRateio, setBaseRateio] = useState("saldo");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState(null);
  const [aviso, setAviso] = useState(null);
  // conta as tentativas de gravar/ratear: o mesmo erro de novo (texto igual) também rola até a mensagem
  const [tentativa, setTentativa] = useState(0);
  const [historico, setHistorico] = useState([]);
  const [carregando, setCarregando] = useState(false);
  const [filtroOrdem, setFiltroOrdem] = useState("");
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");

  const janelaAberta = podeGravar && formAberto;
  const ordem = useMemo(() => ordens.find((o) => o.numero === ordemNum.trim()), [ordens, ordemNum]);
  const opcoes = useMemo(
    () =>
      [...ordens].sort(
        (a, b) => Number(b.status === "Aberta") - Number(a.status === "Aberta") || b.numero.localeCompare(a.numero, undefined, { numeric: true }),
      ),
    [ordens],
  );

  // botão "Lançar área colhida" do cartão da ordem: abre a janela já com ela (o pedido é atendido uma vez só)
  useEffect(() => {
    if (!pedidoOrdem) return;
    setErro(null);
    setAviso(null);
    setEditando(false);
    limpar(false);
    setOrdemNum(pedidoOrdem.numero);
    inicio.current = { ordem: pedidoOrdem.numero, dt };
    setFormAberto(true);
    setFocarTalhao(true);
    onPedidoAtendido?.();
  }, [pedidoOrdem]); // eslint-disable-line react-hooks/exhaustive-deps

  // depois do foco inicial da janela (na Ordem), passa para o primeiro talhão
  useEffect(() => {
    if (!janelaAberta || !focarTalhao) return;
    const t = setTimeout(() => {
      const el = formRef.current?.querySelector("tbody [data-nav]:not(:disabled)");
      el?.focus();
      el?.select?.();
      setFocarTalhao(false);
    }, 0);
    return () => clearTimeout(t);
  }, [janelaAberta, focarTalhao]);

  // mensagem nova com a janela aberta: rola até ela (com muitos talhões, quem grava pelo Enter está no fim da janela)
  useEffect(() => {
    if (janelaAberta && (erro || aviso)) avisoRef.current?.scrollIntoView({ block: "nearest" });
  }, [erro, aviso, janelaAberta, tentativa]);

  // escolhendo a ordem no formulário, o histórico de baixo mostra os lançamentos dela
  const numeroOrdem = ordem?.numero ?? "";
  useEffect(() => {
    if (numeroOrdem) setFiltroOrdem(numeroOrdem);
  }, [numeroOrdem]);

  // ao trocar a ordem ou a data, traz o que já estava lançado naquele dia
  useEffect(() => {
    if (!ordem) {
      valoresDoBanco.current = {};
      setValores({});
      return;
    }
    const v = {};
    for (const t of ordem.talhoes) {
      const dia = (t.colhidaDias ?? []).find((x) => x.d === dt);
      v[`${t.fazendaCodigo}|${t.talhao}`] = dia ? String(dia.ha).replace(".", ",") : "";
    }
    valoresDoBanco.current = v;
    setValores(v);
    setAcumTexto({});
  }, [ordem, dt]);

  useEffect(() => {
    if (!ordem || !dt) return;
    let ativo = true;
    (async () => {
      try {
        const p = new URLSearchParams({ ordem: ordem.numero, de: dt, ate: dt });
        const j = await (await fetch(`/api/area-colhida?${p}`, { cache: "no-store" })).json();
        const usado = j.lancamentos?.find((l) => l.boletim)?.boletim;
        if (usado) {
          if (ativo) {
            boletimDoBanco.current = String(usado);
            setBoletim(String(usado));
          }
          return;
        }
        const prox = await (await fetch("/api/area-colhida?proximo=1", { cache: "no-store" })).json();
        if (ativo) {
          boletimDoBanco.current = String(prox.boletim ?? "");
          setBoletim(String(prox.boletim ?? ""));
        }
      } catch {
        /* digita à mão */
      }
    })();
    return () => {
      ativo = false;
    };
  }, [ordem, dt]);

  const carregarHistorico = useCallback(async () => {
    setCarregando(true);
    try {
      const p = new URLSearchParams();
      if (filtroOrdem.trim()) p.set("ordem", filtroOrdem.trim());
      if (de) p.set("de", de);
      if (ate) p.set("ate", ate);
      const res = await fetch(`/api/area-colhida?${p}`, { cache: "no-store" });
      const j = await res.json();
      if (res.ok) setHistorico(j.lancamentos);
    } finally {
      setCarregando(false);
    }
  }, [filtroOrdem, de, ate]);

  useEffect(() => {
    carregarHistorico();
  }, [carregarHistorico]);

  const linhas = useMemo(() => {
    if (!ordem) return [];
    return ordem.talhoes.map((t) => {
      const dias = t.colhidaDias ?? [];
      const anterior = arred(t.areaColhidaHa + dias.filter((x) => x.d < dt).reduce((s, x) => s + x.ha, 0));
      const posterior = arred(dias.filter((x) => x.d > dt).reduce((s, x) => s + x.ha, 0));
      const chave = `${t.fazendaCodigo}|${t.talhao}`;
      const dia = Number.isFinite(numero(valores[chave] ?? "")) ? numero(valores[chave] ?? "") : 0;
      const acumulado = arred(anterior + dia);
      return { t, chave, anterior, posterior, dia, acumulado, saldo: arred(t.areaHa - acumulado - posterior) };
    });
  }, [ordem, valores, dt]);

  const totalDia = arred(linhas.reduce((s, l) => s + l.dia, 0));

  /** Valor mostrado no campo do talhão: a área do dia, ou o acumulado até a data. */
  const textoCampo = (l) => {
    if (informar === "dia") return valores[l.chave] ?? "";
    if (l.chave in acumTexto) return acumTexto[l.chave];
    return (valores[l.chave] ?? "").trim() ? String(l.acumulado).replace(".", ",") : "";
  };
  function digitarTalhao(l, txt) {
    if (informar === "dia") return setValores((v) => ({ ...v, [l.chave]: txt }));
    setAcumTexto((a) => ({ ...a, [l.chave]: txt }));
    // acumulado → área do dia = acumulado − colhido até o dia anterior (negativo fica marcado e é recusado ao gravar)
    const acum = numero(txt);
    setValores((v) => ({ ...v, [l.chave]: txt.trim() === "" || !Number.isFinite(acum) ? "" : String(arred(acum - l.anterior)).replace(".", ",") }));
  }

  /** Acumulado do talhão até a data do lançamento (saldo anterior ao apontamento + dias até a data). */
  function acumuladoAte(ord, faz, tlh, d) {
    const t = ordens.find((o) => o.numero === ord)?.talhoes.find((x) => x.fazendaCodigo === faz && x.talhao === tlh);
    if (!t) return null;
    return arred(t.areaColhidaHa + (t.colhidaDias ?? []).filter((x) => x.d <= d).reduce((s, x) => s + x.ha, 0));
  }

  /** Edição direta na linha do histórico: grava a nova área daquele dia (0 apaga). */
  async function salvarEdicaoHistorico(l, txt) {
    const ha = numero(txt.trim() || "0");
    if (!Number.isFinite(ha) || ha < 0) return setErro("Informe uma área válida.");
    setErro(null);
    const res = await fetch("/api/area-colhida", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ordem: l.ord, dt: l.dt, boletim: l.boletim ?? 0, itens: [{ faz: l.faz, tlh: l.tlh, ha }] }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return setErro(j.error ?? "Não foi possível alterar.");
    setEditHist(null);
    setAviso(`Área do talhão ${l.tlh} em ${fmtDateBR(l.dt)} alterada para ${fmtHa(ha)} ha.`);
    await onSalvo();
    await carregarHistorico();
  }

  function aplicarRateio() {
    setErro(null);
    setAviso(null);
    setTentativa((n) => n + 1);
    if (!ordem) return setErro("Escolha a ordem.");
    const informado = numero(totalOrdem);
    if (totalOrdem.trim() === "" || !Number.isFinite(informado) || informado < 0) {
      return setErro(informar === "acumulado" ? "Informe a área colhida acumulada da ordem até a data (ha)." : "Informe a área colhida no dia (ha) da ordem.");
    }
    // acumulado: o dia é o total informado menos o que já estava colhido até o dia anterior
    const anteriorOrdem = arred(linhas.reduce((s, l) => s + l.anterior, 0));
    const total = informar === "acumulado" ? arred(informado - anteriorOrdem) : informado;
    if (total < 0) {
      return setErro(
        `O acumulado informado (${fmtHa(informado)} ha) é menor que o já colhido até o dia anterior (${fmtHa(anteriorOrdem)} ha). Para diminuir, corrija os lançamentos dos dias anteriores no histórico.`,
      );
    }
    // o que ainda cabe em cada talhão, sem contar o que já está lançado neste mesmo dia
    const itens = linhas.map((l) => {
      const disp = Math.max(0, arred(l.t.areaHa - l.anterior - l.posterior));
      return { chave: l.chave, peso: baseRateio === "saldo" ? disp : l.t.areaHa, teto: disp };
    });
    const cabe = arred(itens.reduce((a, i) => a + i.teto, 0));
    if (total > cabe + 0.01) {
      return setErro(`O total do dia (${fmtHa(total)} ha) passa do que ainda falta colher na ordem (${fmtHa(cabe)} ha).`);
    }
    const r = ratearArea(total, itens);
    setValores(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v > 0 ? String(v).replace(".", ",") : ""])));
    setAcumTexto({});
    setAviso(
      informar === "acumulado"
        ? `Acumulado de ${fmtHa(informado)} ha: ${fmtHa(total)} ha no dia, rateados entre os talhões. Confira, ajuste se precisar e grave.`
        : `Total de ${fmtHa(total)} ha rateado entre os talhões. Confira, ajuste se precisar e grave.`,
    );
  }

  async function gravar() {
    if (salvando) return;
    setErro(null);
    setAviso(null);
    setTentativa((n) => n + 1);
    if (!ordem) return setErro("Escolha a ordem.");
    if (!dt) return setErro("Informe a data.");
    if (!boletim.trim() && totalDia > 0) {
      // o boletim fica no topo da janela: o foco vai para ele
      boletimRef.current?.focus();
      return setErro("Informe o número do boletim.");
    }
    for (const l of linhas) {
      const txt = (valores[l.chave] ?? "").trim();
      if (txt !== "" && (!Number.isFinite(numero(txt)) || numero(txt) < 0)) {
        if (informar === "acumulado" && Number.isFinite(numero(txt))) {
          return setErro(
            `Talhão ${l.t.talhao}: o acumulado informado é menor que o já colhido até o dia anterior (${fmtHa(l.anterior)} ha). Para diminuir, corrija os lançamentos dos dias anteriores no histórico.`,
          );
        }
        return setErro(`Talhão ${l.t.talhao}: informe um número válido.`);
      }
    }
    setSalvando(true);
    try {
      const res = await fetch("/api/area-colhida", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ordem: ordem.numero,
          dt,
          boletim: Number(boletim || 0),
          itens: linhas.map((l) => ({ faz: l.t.fazendaCodigo, tlh: l.t.talhao, ha: l.dia })),
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "Não foi possível gravar.");
      setAviso(
        `Boletim nº ${boletim} — área colhida de ${fmtDateBR(dt)} gravada na ordem ${ordem.numero}: ${j.incluidos} incluído(s), ${j.alterados} alterado(s), ${j.removidos} removido(s).`,
      );
      await onSalvo();
      await carregarHistorico();
      // só depois de recarregar as ordens: a recarga traz de novo as áreas do dia e apagaria o que já fosse digitado.
      // Edição: fecha a janela, a mensagem fica na página e a data volta à de antes do "Abrir";
      // lançamento novo: a janela fica limpa para o próximo (a data fica)
      if (editando) {
        setFormAberto(false);
        setEditando(false);
        setDt(dtAntesDaEdicao.current);
        limpar(false);
      } else limpar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível gravar.");
    } finally {
      setSalvando(false);
    }
  }

  /** Enter passa para o próximo campo da janela; no último talhão, grava. */
  function aoTeclarNoForm(e) {
    const alvo = e.target;
    if (e.key !== "Enter" || alvo.dataset?.nav === undefined || e.defaultPrevented) return;
    e.preventDefault();
    const navs = Array.from(formRef.current?.querySelectorAll("[data-nav]:not(:disabled)") ?? []);
    const i = navs.indexOf(alvo);
    if (i < navs.length - 1) {
      navs[i + 1].focus();
      navs[i + 1].select?.();
    } else gravar();
  }

  /** Limpa o formulário para o próximo lançamento: a data, o "Informar" e o modo ficam. */
  function limpar(focar = true) {
    setOrdemNum("");
    setValores({});
    setAcumTexto({});
    setTotalOrdem("");
    setBoletim("");
    boletimDoBanco.current = "";
    inicio.current = { ordem: "", dt };
    if (focar) setTimeout(() => ordemRef.current?.focus(), 0);
  }

  /** Novo lançamento: janela limpa. */
  function novo() {
    setErro(null);
    setAviso(null);
    setEditando(false);
    setFocarTalhao(false);
    limpar(false);
    setFormAberto(true);
  }

  /**
   * Algo que ainda não foi gravado: área diferente da que veio do banco, total da ordem para ratear, ordem digitada
   * ou trocada, boletim diferente do que veio do banco (ou da sugestão) e, na edição, a data trocada.
   */
  function temAlteracao() {
    if (totalOrdem.trim()) return true;
    if (ordemNum.trim() !== inicio.current.ordem || boletim.trim() !== boletimDoBanco.current) return true;
    if (editando && dt !== inicio.current.dt) return true;
    const base = valoresDoBanco.current;
    return Object.keys({ ...base, ...valores }).some((k) => {
      const a = (valores[k] ?? "").trim();
      const b = (base[k] ?? "").trim();
      return a !== b && numero(a || "0") !== numero(b || "0");
    });
  }

  /** Fechar a janela: com algo digitado, pergunta antes de descartar. */
  function fecharForm() {
    const fechar = () => {
      setFormAberto(false);
      // saindo da edição, a data volta à de antes do "Abrir"
      if (editando) setDt(dtAntesDaEdicao.current);
      setEditando(false);
      setErro(null);
      // com uma ordem no formulário, o aviso é do que estava em andamento (rateio), não de um lançamento gravado
      if (ordemNum.trim()) setAviso(null);
      limpar(false);
    };
    if (!temAlteracao()) return fechar();
    setConfirmar({
      titulo: editando ? "Cancelar a edição?" : "Descartar o lançamento?",
      texto: editando ? "As alterações feitas não serão gravadas." : "O que foi digitado será perdido.",
      botao: "Descartar",
      perigo: true,
      acao: fechar,
    });
  }

  // F2 sem janela aberta: lançamento novo (com a janela aberta, F2 grava; Esc fecha a janela de cima).
  // Desligado com outra caixa da página aberta por cima da aba (Importar planilhas)
  useAtalhoTela("F2", novo, podeGravar && atalhoAtivo);

  function excluirLancamento(l) {
    setConfirmar({
      titulo: "Excluir a área colhida?",
      texto: `${fmtHa(l.area)} ha do talhão ${l.tlh} em ${fmtDateBR(l.dt)}, ordem ${l.ord}. Fica registrado no Log de Alterações.`,
      botao: "Excluir",
      perigo: true,
      acao: () => excluirDeVez(l),
    });
  }

  async function excluirDeVez(l) {
    setErro(null);
    const res = await fetch("/api/area-colhida", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ordem: l.ord, dt: l.dt, boletim: l.boletim ?? 0, itens: [{ faz: l.faz, tlh: l.tlh, ha: 0 }] }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return setErro(j.error ?? "Não foi possível excluir.");
    setAviso(`Lançamento do talhão ${l.tlh} em ${fmtDateBR(l.dt)} excluído.`);
    await onSalvo();
    await carregarHistorico();
  }

  /** "Abrir" do histórico: a ordem e a data do lançamento na janela, para conferir ou alterar. */
  function editarLancamento(l) {
    dtAntesDaEdicao.current = dt;
    inicio.current = { ordem: l.ord, dt: l.dt };
    setOrdemNum(l.ord);
    setDt(l.dt);
    if (l.boletim) {
      boletimDoBanco.current = String(l.boletim);
      setBoletim(String(l.boletim));
    }
    setTotalOrdem("");
    setAviso(null);
    setErro(null);
    setEditando(true);
    setFormAberto(true);
    setFocarTalhao(true);
  }

  // mensagens: dentro da janela enquanto ela está aberta; na página quando fechada
  const mensagens =
    erro || aviso ? (
      <>
        {erro && <Aviso msg={{ texto: erro, erro: true }} onFechar={() => setErro(null)} />}
        {aviso && <Aviso msg={{ texto: aviso, erro: false }} onFechar={() => setAviso(null)} />}
      </>
    ) : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl2 border border-line bg-card px-4 py-2.5 shadow-card">
        {podeGravar && (
          <Comando primario icone={<IconMais size={16} />} onClick={novo} title="Novo lançamento de área colhida (F2)">
            Novo lançamento
          </Comando>
        )}
        <Comando
          onClick={() => setLeitorAberto(true)}
          title='Cola a mensagem "Planejamento Ordem de Cortes": confere cada ordem e lança várias de uma vez'
        >
          Ler mensagem do WhatsApp
        </Comando>
        <span className="text-[12px] text-muted">Hectares colhidos no dia, por talhão da ordem{podeGravar ? " · F2 abre um lançamento novo" : ""}</span>
      </div>

      {!janelaAberta && mensagens}

      {/* mensagem "Planejamento Ordem de Cortes" do WhatsApp: confere e lança várias ordens de uma vez */}
      <LeitorPlanejamento
        aberto={leitorAberto}
        onFechar={() => setLeitorAberto(false)}
        podeGravar={podeGravar}
        onLancado={async () => {
          await onSalvo();
          await carregarHistorico();
        }}
      />

      <JanelaFormulario
        aberto={janelaAberta}
        rotulo={editando ? "Editar lançamento de área colhida" : "Lançar área colhida"}
        titulo={editando ? `Editando o boletim nº ${boletim || "—"}` : "Lançar área colhida"}
        subtitulo="Hectares colhidos no dia, por talhão da ordem · F2 grava · Esc fecha"
        aviso={
          mensagens && (
            <div ref={avisoRef} className="space-y-3">
              {mensagens}
            </div>
          )
        }
        onFechar={fecharForm}
        onGravar={gravar}
        ocupado={salvando}
        corpoRef={formRef}
        focoInicial={ordemRef}
        onKeyDown={aoTeclarNoForm}
        topoDireita={
          <label className="campo-boletim">
            Boletim nº
            <input
              ref={boletimRef}
              value={boletim}
              onChange={(e) => setBoletim(e.target.value.replace(/\D/g, "").slice(0, 9))}
              disabled={!podeGravar}
              inputMode="numeric"
              aria-label="Número do boletim"
            />
          </label>
        }
        rodape={
          <>
            <button type="button" onClick={fecharForm} disabled={salvando} className={BOTAO}>
              {editando ? "Cancelar edição" : "Fechar"}
            </button>
            {!editando && (ordemNum.trim() || totalOrdem.trim()) && (
              <button
                type="button"
                onClick={() => {
                  setErro(null);
                  setAviso(null);
                  limpar();
                }}
                disabled={salvando}
                className={BOTAO}
              >
                Limpar
              </button>
            )}
            <button
              type="button"
              onClick={gravar}
              disabled={!podeGravar || salvando || !ordem}
              className="rounded-lg bg-navy-900 px-5 py-2 text-[13px] font-medium text-white hover:bg-navy-800 disabled:opacity-40"
            >
              {salvando ? "Gravando…" : editando ? "Salvar alteração (F2)" : "Lançar (F2)"}
            </button>
          </>
        }
      >
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className={ROTULO}>Data</label>
            <input type="date" value={dt} onChange={(e) => setDt(e.target.value)} disabled={!podeGravar} className={`${INPUT} w-[160px]`} data-nav />
          </div>
          <div>
            <label className={ROTULO}>Ordem</label>
            <input
              ref={ordemRef}
              list="ordens-area-lista"
              value={ordemNum}
              onChange={(e) => setOrdemNum(e.target.value)}
              disabled={!podeGravar}
              placeholder="Nº da ordem"
              className={`${INPUT} w-[140px]`}
              data-nav
            />
            <datalist id="ordens-area-lista">
              {opcoes.map((o) => (
                <option key={o.numero} value={o.numero}>
                  {`${o.status} · ${o.fazendaNome}`}
                </option>
              ))}
            </datalist>
          </div>
          <p className="min-w-0 flex-1 truncate pb-2 text-[12.5px] text-ink">
            {ordemNum.trim() === "" ? (
              <span className="text-muted">Escolha a ordem para listar os talhões.</span>
            ) : !ordem ? (
              <span className="font-semibold text-alert-600">Ordem {ordemNum} não encontrada.</span>
            ) : (
              <>
                <b>{ordem.status}</b> · {ordem.frente} · {ordem.fazendaCodigo} {ordem.fazendaNome}
              </>
            )}
          </p>
        </div>

        {ordem && <div className="caixa-form-sub">Como lançar</div>}
        {ordem && (
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className={ROTULO}>Informar</label>
              <div className="flex rounded-lg border border-line bg-card p-1">
                {[
                  ["acumulado", "Acumulado até a data"],
                  ["dia", "Área do dia"],
                ].map(([k, rotulo]) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => {
                      setInformar(k);
                      setAcumTexto({});
                    }}
                    className={`rounded-md px-3.5 py-1.5 text-[12.5px] font-semibold transition-colors ${
                      informar === k ? "bg-navy-900 text-white shadow-card" : "text-navy-800 hover:bg-surface"
                    }`}
                  >
                    {rotulo}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex rounded-lg border border-line bg-card p-1">
              {[
                ["talhao", "Por talhão"],
                ["ordem", "Por ordem (rateio)"],
              ].map(([k, rotulo]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setModo(k)}
                  className={`rounded-md px-3.5 py-1.5 text-[12.5px] font-semibold transition-colors ${
                    modo === k ? "bg-navy-900 text-white shadow-card" : "text-navy-800 hover:bg-surface"
                  }`}
                >
                  {rotulo}
                </button>
              ))}
            </div>
            {modo === "ordem" && (
              <>
                <div>
                  <label className={ROTULO}>{informar === "acumulado" ? "Acumulado da ordem até a data (ha)" : "Área colhida no dia — ordem (ha)"}</label>
                  <input
                    value={totalOrdem}
                    onChange={(e) => setTotalOrdem(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        e.stopPropagation();
                        aplicarRateio();
                      }
                    }}
                    inputMode="decimal"
                    disabled={!podeGravar}
                    className={`${INPUT} w-[150px] text-right`}
                    aria-label={informar === "acumulado" ? "Área colhida acumulada da ordem até a data" : "Área colhida no dia na ordem"}
                  />
                </div>
                <div>
                  <label className={ROTULO}>Ratear proporcional ao</label>
                  <select value={baseRateio} onChange={(e) => setBaseRateio(e.target.value)} className={`${INPUT} w-[210px]`}>
                    <option value="saldo">Saldo a colher de cada talhão</option>
                    <option value="area">Área de cada talhão</option>
                  </select>
                </div>
                <button
                  type="button"
                  onClick={aplicarRateio}
                  disabled={!podeGravar}
                  className="rounded-lg border border-line bg-card px-3.5 py-2 text-[13px] font-medium text-navy-800 hover:bg-surface disabled:opacity-50"
                >
                  Ratear pelos talhões
                </button>
              </>
            )}
            <p className="basis-full text-[11.5px] text-muted">
              {informar === "acumulado"
                ? "Informe o total colhido até a data (ex.: dia 01 = 15 ha e dia 02 = 35 ha grava 15 ha no dia 01 e 20 ha no dia 02). O sistema calcula a área do dia pelo que já estava colhido até o dia anterior. "
                : "Informe só o que foi colhido no dia. "}
              {modo === "ordem"
                ? "O total da ordem é dividido entre os talhões; nenhum talhão passa do que ainda falta colher dele. O resultado aparece na tabela e pode ser ajustado talhão a talhão antes de gravar."
                : "Digite em cada talhão."}
            </p>
          </div>
        )}

        {ordem && <div className="caixa-form-sub">Talhões da ordem · {linhas.length}</div>}
        {ordem && (
          <div className="overflow-x-auto rounded-lg border border-line bg-card">
            <table className="w-full text-[12.5px]" data-sem-ordenar>
              <thead>
                <tr className="border-b border-line bg-surface text-left text-muted">
                  <th className="px-3 py-1.5 font-medium">Fazenda</th>
                  <th className="px-3 py-1.5 font-medium">Descrição Fazenda</th>
                  <th className="px-3 py-1.5 text-center font-medium">Talhão</th>
                  <th className="px-3 py-1.5 text-right font-medium">Área (ha)</th>
                  <th className="px-3 py-1.5 text-right font-medium">Colhida até o dia anterior</th>
                  <th className="px-3 py-1.5 text-right font-medium">{informar === "acumulado" ? "Acumulada até a data (ha)" : "Colhida no dia (ha)"}</th>
                  <th className="px-3 py-1.5 text-right font-medium">{informar === "acumulado" ? "Colhida no dia" : "Acumulada"}</th>
                  <th className="px-3 py-1.5 text-right font-medium">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((l, i) => (
                  <tr key={l.chave} className={`border-t border-line/60 ${i % 2 === 1 ? "bg-surface/40" : ""}`}>
                    <td className="px-3 py-1 tabular text-ink">{l.t.fazendaCodigo}</td>
                    <td className="px-3 py-1 text-ink">{l.t.fazendaNome}</td>
                    <td className="px-3 py-1 text-center font-semibold text-ink">{l.t.talhao}</td>
                    <td className="px-3 py-1 text-right tabular text-ink">{fmtHa(l.t.areaHa)}</td>
                    <td className="px-3 py-1 text-right tabular text-muted">{fmtHa(l.anterior)}</td>
                    <td className="px-3 py-1 text-right">
                      <input
                        value={textoCampo(l)}
                        onChange={(e) => digitarTalhao(l, e.target.value)}
                        onFocus={(e) => e.target.select()}
                        disabled={!podeGravar}
                        inputMode="decimal"
                        data-nav
                        className={`${INPUT} w-[110px] text-right ${l.dia < 0 ? "border-alert-500 bg-alert-50" : ""}`}
                        title={l.dia < 0 ? `Menor que o colhido até o dia anterior (${fmtHa(l.anterior)} ha)` : undefined}
                        aria-label={`${informar === "acumulado" ? "Área acumulada até a data" : "Área colhida no dia"} — talhão ${l.t.talhao}`}
                      />
                    </td>
                    <td className={`px-3 py-1 text-right tabular font-semibold ${l.dia < 0 ? "text-alert-600" : "text-ink"}`}>
                      {fmtHa(informar === "acumulado" ? l.dia : l.acumulado)}
                    </td>
                    <td className={`px-3 py-1 text-right tabular ${l.saldo < -0.01 ? "font-semibold text-alert-600" : "text-muted"}`}>{fmtHa(l.saldo)}</td>
                  </tr>
                ))}
                <tr className="border-t border-line bg-surface font-semibold text-ink">
                  <td className="px-3 py-1.5" colSpan={3}>
                    Total
                  </td>
                  <td className="px-3 py-1.5 text-right tabular">{fmtHa(arred(ordem.talhoes.reduce((s, t) => s + t.areaHa, 0)))}</td>
                  <td className="px-3 py-1.5 text-right tabular">{fmtHa(arred(linhas.reduce((s, l) => s + l.anterior, 0)))}</td>
                  <td className="px-3 py-1.5 text-right tabular">
                    {fmtHa(informar === "acumulado" ? arred(linhas.reduce((s, l) => s + l.acumulado, 0)) : totalDia)}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular">
                    {fmtHa(informar === "acumulado" ? totalDia : arred(linhas.reduce((s, l) => s + l.acumulado, 0)))}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular">{fmtHa(arred(linhas.reduce((s, l) => s + l.saldo, 0)))}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-2 text-[11.5px] text-muted">
          {informar === "acumulado"
            ? "Acumulado igual ao colhido até o dia anterior (ou vazio) apaga o lançamento do dia."
            : "Vazio ou 0 apaga o lançamento do dia."}{" "}
          A área colhida até o dia anterior inclui o saldo lançado antes do apontamento diário. Enter passa para o próximo talhão.
        </p>
      </JanelaFormulario>

      <Painel semEspaco titulo="Histórico de lançamentos">
        <div className="flex flex-wrap items-end gap-3 border-b border-line px-4 py-3">
          <div>
            <label className={ROTULO}>Ordem</label>
            <input value={filtroOrdem} onChange={(e) => setFiltroOrdem(e.target.value)} placeholder="Todas" className={`${INPUT} w-[110px]`} />
          </div>
          <div>
            <label className={ROTULO}>De</label>
            <input type="date" value={de} onChange={(e) => setDe(e.target.value)} className={`${INPUT} w-[150px]`} />
          </div>
          <div>
            <label className={ROTULO}>Até</label>
            <input type="date" value={ate} onChange={(e) => setAte(e.target.value)} className={`${INPUT} w-[150px]`} />
          </div>
          <BotaoLimparFiltros
            ativo={!!(filtroOrdem.trim() || de || ate)}
            onLimpar={() => {
              setFiltroOrdem("");
              setDe("");
              setAte("");
            }}
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-line bg-surface text-left text-muted">
                <th className="px-3 py-2 font-medium">Boletim</th>
                <th className="px-3 py-2 font-semibold">Data</th>
                <th className="px-3 py-2 font-semibold">Ordem</th>
                <th className="px-3 py-2 font-semibold">Fazenda</th>
                <th className="px-3 py-2 font-semibold">Descrição Fazenda</th>
                <th className="px-3 py-2 text-center font-semibold">Talhão</th>
                <th className="px-3 py-2 text-right font-semibold">Área colhida no dia (ha)</th>
                <th className="px-3 py-2 text-right font-semibold">Acumulado até a data (ha)</th>
                <th className="px-3 py-2 font-semibold">Lançado por</th>
                <th className="px-3 py-2 font-semibold">Lançado em</th>
                <th className="px-3 py-2 font-semibold">Alterado por</th>
                <th className="px-3 py-2 font-semibold">Alterado em</th>
                <th className="px-3 py-2 text-right font-semibold">Ações</th>
              </tr>
            </thead>
            <tbody>
              {historico.map((l, i) => {
                const alterado = l.alteradoEm !== l.criadoEm;
                return (
                  <tr key={`${l.ord}|${l.faz}|${l.tlh}|${l.dt}`} className={`border-b border-line/60 ${i % 2 === 1 ? "bg-surface" : "bg-card"}`}>
                    <td className="px-3 py-1 tabular font-medium text-ink">{l.boletim ?? "—"}</td>
                    <td className="whitespace-nowrap px-3 py-1 text-ink">{fmtDateBR(l.dt)}</td>
                    <td className="px-3 py-1 text-ink">{l.ord}</td>
                    <td className="px-3 py-1 tabular text-ink">{l.faz}</td>
                    <td className="px-3 py-1 text-ink">{l.fazNm}</td>
                    <td className="px-3 py-1 text-center text-ink">{l.tlh}</td>
                    <td className="px-3 py-1 text-right tabular text-ink">
                      {editHist?.chave === `${l.ord}|${l.faz}|${l.tlh}|${l.dt}` ? (
                        <input
                          autoFocus
                          value={editHist.valor}
                          onChange={(e) => setEditHist({ chave: editHist.chave, valor: e.target.value })}
                          onKeyDown={(e) => {
                            e.stopPropagation();
                            if (e.key === "Enter") salvarEdicaoHistorico(l, editHist.valor);
                            if (e.key === "Escape") setEditHist(null);
                          }}
                          inputMode="decimal"
                          className={`${INPUT} w-[90px] py-0.5 text-right`}
                          aria-label="Nova área colhida no dia"
                        />
                      ) : (
                        fmtHa(l.area)
                      )}
                    </td>
                    <td className="px-3 py-1 text-right tabular text-muted">
                      {(() => {
                        const a = acumuladoAte(l.ord, l.faz, l.tlh, l.dt);
                        return a === null ? "—" : fmtHa(a);
                      })()}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1 text-ink">{l.usuario || "—"}</td>
                    <td className="whitespace-nowrap px-3 py-1 text-muted">{fmtDataHora(l.criadoEm)}</td>
                    <td className="whitespace-nowrap px-3 py-1 text-ink">{alterado ? l.alteradoPor || "—" : ""}</td>
                    <td className="whitespace-nowrap px-3 py-1 text-muted">{alterado ? fmtDataHora(l.alteradoEm) : ""}</td>
                    <td className="whitespace-nowrap px-3 py-1 text-right">
                      {podeGravar && (
                        <>
                          {editHist?.chave === `${l.ord}|${l.faz}|${l.tlh}|${l.dt}` ? (
                            <>
                              <button
                                type="button"
                                onClick={() => salvarEdicaoHistorico(l, editHist.valor)}
                                className="mr-1 rounded px-1.5 py-0.5 text-[12px] font-semibold text-good-700 hover:bg-good-50"
                              >
                                Salvar
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditHist(null)}
                                className="mr-1 rounded px-1.5 py-0.5 text-[12px] text-muted hover:bg-surface"
                              >
                                Cancelar
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() => setEditHist({ chave: `${l.ord}|${l.faz}|${l.tlh}|${l.dt}`, valor: String(l.area).replace(".", ",") })}
                                className="mr-1 rounded px-1.5 py-0.5 text-[12px] font-semibold text-brand-700 hover:bg-brand-50"
                                title="Editar a área deste dia aqui mesmo"
                              >
                                Editar
                              </button>
                              <button
                                type="button"
                                onClick={() => editarLancamento(l)}
                                className="mr-1 rounded px-1.5 py-0.5 text-[12px] text-muted hover:bg-surface"
                                title="Abrir a ordem e a data na janela de lançamento"
                              >
                                Abrir
                              </button>
                            </>
                          )}
                          <button
                            type="button"
                            onClick={() => excluirLancamento(l)}
                            aria-label="Excluir lançamento"
                            className="rounded px-1.5 text-[15px] leading-none text-muted hover:bg-alert-50 hover:text-alert-600"
                          >
                            ×
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!carregando && historico.length === 0 && (
                <tr>
                  <td colSpan={13} className="px-4 py-8 text-center text-muted">
                    Nenhum lançamento de área colhida ainda.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Painel>

      {confirmar && (
        <JanelaConfirmar
          {...confirmar}
          onCancelar={() => setConfirmar(null)}
          onConfirmar={() => {
            const acao = confirmar.acao;
            setConfirmar(null);
            acao();
          }}
        />
      )}
    </div>
  );
}
