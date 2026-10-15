"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { filtrarMenu, nomeDaTela, podeAcessar, SECOES_MENU, telaDoEndereco } from "@/lib/menu";
import { ehBooleano, usarPersistido } from "@/lib/usar-persistido";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import BarraSuperior from "./BarraSuperior";
import { IconSetaBaixo } from "./icons";
import MenuLateral from "./MenuLateral";
import OrdenarTabelas from "./OrdenarTabelas";
import { ContextoVoltar } from "./pagina";
import PaletaComandos, { registrarRecente } from "./PaletaComandos";

const CHAVE_RECOLHIDO = "ca_menu_recolhido";

/*
 * Barras do topo (barra azul + cabeçalho da tela) no celular em pé e em tela baixa (aparelho deitado): a mesma
 * condição do bloco "Barras do topo no celular" do globals.css, que é quem as encolhe e esconde. No computador
 * (tela larga e alta) nada disso vale.
 */
const MEDIA_COMPACTA = "(max-width: 767px), (max-height: 500px)";
const LIMIAR_OCULTAR = 32; // px rolados para baixo, seguidos, até as barras saírem
const LIMIAR_MOSTRAR = 20; // px rolados para cima até elas voltarem
const PERTO_DO_TOPO = 8; // no topo do conteúdo as barras sempre voltam
const TRAVA_MS = 350; // pouco mais que a transição do CSS (0,22s): a rolagem mexida pela troca de altura não conta

function SemAcesso() {
  return (
    <div className="flex flex-1 items-center justify-center px-6">
      <div className="max-w-md rounded-xl2 border border-line bg-card px-8 py-10 text-center shadow-card">
        <h1 className="font-display text-[20px] font-semibold text-ink">Esta tela não está liberada para você</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-muted">
          O acesso às telas é definido pelo administrador em Parâmetros → Usuários. Se precisar dela, peça a liberação.
        </p>
        <Link href="/painel" className="mt-5 inline-block rounded-lg bg-navy-900 px-4 py-2 text-[13px] font-medium text-white hover:bg-navy-800">
          Ir para o Início
        </Link>
      </div>
    </div>
  );
}

/**
 * Estrutura do sistema: barra superior azul CRV (menu, busca de telas, tema, usuário, logo), menu lateral no mesmo azul
 * (recolhível; gaveta no celular) e a tela ao lado. Também guarda as telas visitadas nesta aba, para o Voltar da
 * barra de comandos de cada tela. No celular e em tela baixa as barras do topo saem de cena ao rolar o conteúdo para
 * baixo (voltam ao rolar para cima) ou ficam recolhidas pelo botão da barra azul, com uma alça no topo para trazê-las.
 */
export default function AppShell({ usuario, children }) {
  const [gavetaAberta, setGavetaAberta] = useState(false);
  const [recolhido, setRecolhido] = useState(false);
  const [buscaAberta, setBuscaAberta] = useState(false);
  // barras do topo recolhidas pelo botão (celular e tela baixa): lembrado neste aparelho
  const [barrasRecolhidas, setBarrasRecolhidas] = usarPersistido("barras_recolhidas", false, ehBooleano);
  const raizRef = useRef(null);
  const pathname = usePathname();
  const router = useRouter();
  const liberado = podeAcessar(pathname ?? "/", usuario?.perfil, usuario?.acessos ?? null);
  const anterior = usarTelaAnterior(pathname);
  // menu do usuário: sem os itens de administrador e só com as telas liberadas (Parâmetros → Usuários)
  const secoes = useMemo(() => filtrarMenu(SECOES_MENU, usuario?.perfil, usuario?.acessos ?? null), [usuario?.perfil, usuario?.acessos]);
  // com a gaveta do menu ou a busca de telas aberta as barras ficam à vista
  const barrasPresas = gavetaAberta || buscaAberta;
  const { compacta, ocultas, mostrarBarras, travarRolagem } = usarBarrasAoRolar(raizRef, pathname, barrasPresas);
  const barrasEscondidas = compacta && !barrasPresas && (barrasRecolhidas || ocultas);
  const alcaVisivel = barrasEscondidas && barrasRecolhidas;

  // a troca de altura das barras mexe na rolagem do conteúdo: essa rolagem não conta como gesto
  useEffect(() => travarRolagem(), [barrasEscondidas, travarRolagem]);

  useEffect(() => {
    try {
      setRecolhido(localStorage.getItem(CHAVE_RECOLHIDO) === "1");
    } catch {
      /* sem armazenamento: menu aberto */
    }
  }, []);

  useEffect(() => {
    setGavetaAberta(false);
    if (pathname) registrarRecente(pathname === "/" ? "/painel" : (telaDoEndereco(pathname) ?? (pathname.startsWith("/painel") ? "/painel" : null)));
  }, [pathname]);

  useEffect(() => {
    function onKeyDown(e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setBuscaAberta(true);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const alternarRecolhido = useCallback(() => {
    setRecolhido((r) => {
      try {
        localStorage.setItem(CHAVE_RECOLHIDO, r ? "0" : "1");
      } catch {
        /* vale só nesta visita */
      }
      return !r;
    });
  }, []);

  // botão do menu: no celular abre a gaveta; na tela larga recolhe/expande o menu
  const botaoMenu = useCallback(() => {
    if (window.matchMedia("(min-width: 768px)").matches) alternarRecolhido();
    else setGavetaAberta(true);
  }, [alternarRecolhido]);

  // recolher/expandir as barras do topo: pelo teclado (clique sem ponteiro, detail 0) o foco segue para o botão do
  // outro lado; no toque não mexe no foco (o botão focado contaria como foco de teclado e prenderia as barras)
  const recolherBarras = useCallback((e) => {
    const doTeclado = e?.detail === 0;
    travarRolagem();
    setBarrasRecolhidas(true);
    if (doTeclado) requestAnimationFrame(() => document.getElementById("alca-barras")?.focus({ preventScroll: true }));
  }, [setBarrasRecolhidas, travarRolagem]);
  const expandirBarras = useCallback((e) => {
    const doTeclado = e?.detail === 0;
    travarRolagem();
    setBarrasRecolhidas(false);
    mostrarBarras();
    if (doTeclado) requestAnimationFrame(() => document.getElementById("botao-recolher-barras")?.focus({ preventScroll: true }));
  }, [setBarrasRecolhidas, mostrarBarras, travarRolagem]);

  const voltar = useCallback(() => router.back(), [router]);
  const contexto = useMemo(() => ({ anterior, voltar }), [anterior, voltar]);

  return (
    <ContextoVoltar.Provider value={contexto}>
      {/* h-dvh: no celular a altura não conta a barra do navegador (o rodapé fixo das telas fica à vista); sem dvh vale o h-screen */}
      {/* data-barras: no celular e em tela baixa, a barra azul e o cabeçalho da tela saem de cena (globals.css) */}
      <div
        ref={raizRef}
        data-barras={barrasEscondidas ? "ocultas" : undefined}
        className="app-shell-root flex h-screen h-dvh w-full flex-col overflow-hidden bg-surface"
      >
        {/* clicar no título de uma coluna ordena qualquer tabela */}
        <OrdenarTabelas />
        <BarraSuperior usuario={usuario} onMenu={botaoMenu} onBuscar={() => setBuscaAberta(true)} onRecolher={recolherBarras} />
        {/* barras recolhidas: alça no canto de cima à direita, onde fica o botão que as recolhe (abaixo das janelas e
            da gaveta), para trazê-las de volta; desenhada inteira (40×40): nenhum pedaço invisível toma o toque do conteúdo */}
        {alcaVisivel && (
          <button
            id="alca-barras"
            type="button"
            onClick={expandirBarras}
            className="alca-barras print-hide fixed right-0 top-0 z-30 flex h-10 w-10 items-center justify-center rounded-bl-xl2 border-b-[3px] border-l border-b-crv-verde border-l-white/15 bg-navy-900/90 text-white shadow-pop hover:bg-navy-800"
            aria-expanded="false"
            aria-label="Mostrar as barras do topo"
            title="Mostrar as barras do topo"
          >
            <IconSetaBaixo size={18} />
          </button>
        )}
        <div className="app-shell-corpo flex min-h-0 flex-1">
          {gavetaAberta && <div className="fixed inset-0 z-40 bg-navy-950/55 md:hidden" onClick={() => setGavetaAberta(false)} aria-hidden="true" />}
          {/* celular: gaveta por cima da tela */}
          <div
            className={`print-hide fixed inset-y-0 left-0 z-50 transition-transform duration-200 md:hidden ${gavetaAberta ? "translate-x-0" : "-translate-x-full"}`}
          >
            <MenuLateral
              secoes={secoes}
              recolhido={false}
              gaveta
              onNavigate={() => setGavetaAberta(false)}
              onAlternar={alternarRecolhido}
              onFechar={() => setGavetaAberta(false)}
            />
          </div>
          {/* tela larga: menu fixo ao lado */}
          <div className="print-hide hidden md:flex">
            <MenuLateral secoes={secoes} recolhido={recolhido} onAlternar={alternarRecolhido} />
          </div>
          <main className="flex min-w-0 flex-1 flex-col">{liberado ? children : <SemAcesso />}</main>
        </div>
        {buscaAberta && <PaletaComandos secoes={secoes} onFechar={() => setBuscaAberta(false)} />}
      </div>
    </ContextoVoltar.Provider>
  );
}

/**
 * Barras do topo ao rolar (celular em pé e tela baixa): rolar o conteúdo da tela (CorpoPagina, `[data-corpo-pagina]`)
 * para baixo esconde a barra azul e o cabeçalho da tela; rolar para cima ou chegar ao topo traz de volta. Os limiares
 * evitam piscar com toques curtos. `presas` (gaveta do menu ou busca de telas aberta) não deixa esconder.
 */
function usarBarrasAoRolar(raizRef, pathname, presas) {
  const [compacta, setCompacta] = useState(false);
  // tela em que as barras saíram pela rolagem: na tela seguinte já valem à vista desde o primeiro quadro (sem esperar
  // o efeito que limpa o estado, que rodaria depois de pintar a tela nova com o cabeçalho escondido)
  const caminho = pathname ?? "";
  const [ocultasEm, setOcultasEm] = useState(null);
  const ocultas = compacta && ocultasEm === caminho;
  const estado = useRef({ ocultas: false, presas: false, travadoAte: 0, caminho });
  estado.current.ocultas = ocultas;
  estado.current.presas = presas;
  estado.current.caminho = caminho;

  useEffect(() => {
    const mq = window.matchMedia(MEDIA_COMPACTA);
    const aplicar = () => setCompacta(mq.matches);
    aplicar();
    if (mq.addEventListener) mq.addEventListener("change", aplicar);
    else mq.addListener(aplicar); // Safari antigo
    return () => (mq.removeEventListener ? mq.removeEventListener("change", aplicar) : mq.removeListener(aplicar));
  }, []);

  // outra tela, ou voltou para a tela larga: o estado também volta a "à vista" (voltar à mesma tela não as esconde)
  useEffect(() => setOcultasEm(null), [pathname, compacta]);

  const travarRolagem = useCallback(() => {
    estado.current.travadoAte = performance.now() + TRAVA_MS;
  }, []);
  const mostrarBarras = useCallback(() => setOcultasEm(null), []);

  useEffect(() => {
    const raiz = raizRef.current;
    if (!compacta || !raiz) return;
    let corpoAtual = null;
    let ultimo = 0;
    let acumulado = 0;
    function mudar(ocultar) {
      acumulado = 0;
      estado.current.ocultas = ocultar;
      estado.current.travadoAte = performance.now() + TRAVA_MS;
      setOcultasEm(ocultar ? estado.current.caminho : null);
    }
    // a rolagem não sobe pela página: escuta na captura, na raiz, e só vale a do corpo da tela
    function aoRolar(e) {
      const corpo = e.target;
      if (!(corpo instanceof HTMLElement) || !corpo.hasAttribute("data-corpo-pagina")) return;
      const max = Math.max(corpo.scrollHeight - corpo.clientHeight, 0);
      const topo = Math.min(Math.max(corpo.scrollTop, 0), max); // sem o "elástico" do iOS nas pontas
      if (corpo !== corpoAtual) {
        corpoAtual = corpo;
        ultimo = topo;
        acumulado = 0;
      }
      const delta = topo - ultimo;
      ultimo = topo;
      const s = estado.current;
      if (topo <= PERTO_DO_TOPO) {
        acumulado = 0;
        if (s.ocultas) mudar(false);
        return;
      }
      if (performance.now() < s.travadoAte) {
        acumulado = 0;
        return;
      }
      if (delta === 0) return;
      // soma enquanto rola no mesmo sentido; trocou de sentido, recomeça
      acumulado = Math.sign(delta) === Math.sign(acumulado) ? acumulado + delta : delta;
      if (!s.ocultas && acumulado >= LIMIAR_OCULTAR && podeOcultarBarras(corpo, topo, s.presas)) mudar(true);
      else if (s.ocultas && acumulado <= -LIMIAR_MOSTRAR) mudar(false);
    }
    raiz.addEventListener("scroll", aoRolar, { capture: true, passive: true });
    return () => raiz.removeEventListener("scroll", aoRolar, { capture: true });
  }, [compacta, raizRef]);

  return { compacta, ocultas, mostrarBarras, travarRolagem };
}

/** As barras do topo podem sair agora? */
function podeOcultarBarras(corpo, topo, presas) {
  if (presas || topo < 48) return false;
  let altura = 0;
  document.querySelectorAll("[data-barra-ocultavel]").forEach((b) => (altura += b.offsetHeight));
  // sem as barras ainda precisa sobrar rolagem: senão o conteúdo cabe, volta ao topo e as barras voltam (pisca)
  if (corpo.scrollHeight - corpo.clientHeight < altura + 48) return false;
  // campo das barras em foco (teclado do celular aberto) ou foco de teclado nelas
  const ativo = document.activeElement;
  if (ativo instanceof HTMLElement && ativo.closest("[data-barra-ocultavel]")) {
    if (ativo.matches("input, select, textarea, [contenteditable]:not([contenteditable='false'])")) return false;
    try {
      if (ativo.matches(":focus-visible")) return false;
    } catch {
      /* navegador sem :focus-visible: vale só o campo */
    }
  }
  // menu aberto numa delas (usuário, Exportar…)
  return !document.querySelector("[data-barra-ocultavel] [aria-haspopup][aria-expanded='true']");
}

/**
 * Telas visitadas nesta aba (sessionStorage): ao passar de uma tela para outra, a barra de comandos mostra o Voltar
 * com o nome da tela de onde veio. Voltar pelo botão (ou pelo navegador) tira a tela da pilha.
 */
function usarTelaAnterior(pathname) {
  const [anterior, setAnterior] = useState(null);
  useEffect(() => {
    if (!pathname) return;
    let pilha = [];
    try {
      pilha = JSON.parse(sessionStorage.getItem("ca_nav") ?? "[]");
      if (!Array.isArray(pilha)) pilha = [];
    } catch {
      pilha = [];
    }
    if (pilha[pilha.length - 1] === pathname) {
      /* recarregou a mesma tela */
    } else if (pilha[pilha.length - 2] === pathname) pilha.pop();
    else pilha.push(pathname);
    pilha = pilha.slice(-30);
    try {
      sessionStorage.setItem("ca_nav", JSON.stringify(pilha));
    } catch {
      /* sem armazenamento: o Voltar só não aparece */
    }
    const prev = pilha.length >= 2 ? pilha[pilha.length - 2] : null;
    setAnterior(prev ? { href: prev, nome: nomeDaTela(prev) } : null);
  }, [pathname]);
  return anterior;
}
