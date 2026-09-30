# Controle Agrícola — CRV Industrial

Sistema de acompanhamento agrícola da safra de cana-de-açúcar (Unidade
Capinópolis-MG). Primeiro módulo entregue: **Acompanhamento de Ordens de
Corte** — **100% derivado de 3 relatórios do sistema de origem (CHBWEB)**,
importados diariamente. Não há cadastro nem lançamento manual de ordem: a
base é sempre o retrato mais recente dos 3 arquivos.

## Stack

- **Next.js 16** (App Router, Turbopack) + **TypeScript** + **Tailwind CSS**
  — exige **Node 20.9+** (fixado em `package.json` → `engines.node`)
- Persistência em **arquivo JSON no servidor** (`data/db.json`), lido e
  gravado pelas rotas de API.
- Sem dependências externas de banco de dados para começar. Quando quiser
  migrar para Postgres/Supabase, só é preciso reimplementar `lib/db.ts`
  (`getDb`/`saveDb`/`substituirOrdens`) — nenhuma tela precisa mudar.

## Como rodar localmente

```bash
npm install
npm run dev
```

Abra http://localhost:3000 — a rota inicial já leva para
`/acompanhamentos/ordens-de-corte`.

## Build de produção

```bash
npm run build
npm start
```

`npm start` sobe em `$PORT` (Render define isso automaticamente) ou 3000.

## Deploy no Render

Isso precisa ser feito pela sua conta do Render (eu não tenho como criar conta
ou acessar deploy por você) — mas o repositório já está pronto para isso, é só
seguir os passos:

1. Em https://dashboard.render.com → **New → Web Service**, conecte a conta do
   GitHub e escolha o repositório `aureniorg3/controle_agricola`, branch `main`.
2. **Runtime:** Node. **Build Command:** `npm install && npm run build`.
   **Start Command:** `npm start`.
3. **Environment** (aba Environment do serviço) → adicione:
   - `AUTH_SECRET` — um valor aleatório, só seu, usado para assinar o cookie
     de login. Pode usar este (gerado agora), ou qualquer string longa e
     aleatória:
     ```
     MCyed2WYMhzXmYr3LFWpRIMA55TL9LocbIUjEZfZvMI
     ```
   - `DATA_DIR` — `/var/data` (ver disco persistente no próximo passo).
4. **Disco persistente (obrigatório para não perder dados a cada deploy):**
   Settings → **Disks** → Add Disk → *Mount Path* `/var/data` (mesmo caminho
   do `DATA_DIR` acima), qualquer tamanho pequeno (1 GB já sobra). Sem isso, a
   cada novo deploy o Render apaga o disco do serviço, a base de ordens fica
   vazia (é preciso reimportar as planilhas) e o usuário admin volta para a
   senha padrão.

   `lib/db.ts` grava sempre em arquivo temporário + `rename` atômico (nunca
   sobrescreve `db.json` direto) — um processo encerrado no meio de uma
   gravação (ex.: instância gratuita ficando sem memória) não deixa mais o
   arquivo corrompido. Se `db.json` ainda assim aparecer com um JSON
   inválido (de uma gravação antiga, antes dessa proteção), o sistema nunca
   apaga o arquivo sozinho: guarda uma cópia (`db.json.corrompido-<hora>`,
   no mesmo disco) e serve uma base vazia só naquela resposta, sem
   sobrescrever o original — dá pra recuperar manualmente ou reimportar as
   planilhas sem perder a cópia com problema.
5. **Create Web Service.** O primeiro deploy demora alguns minutos (build do
   Next.js); depois disso o Render mostra a URL pública do serviço no topo da
   página (algo como `https://controle-agricola.onrender.com`) — esse é o
   link para compartilhar com o time. O login pede o e-mail/senha da seção
   **Login** abaixo.

   O Next.js 16 exige **Node 20.9 ou mais novo** (já fixado em `package.json`
   → `engines.node`, que o Render lê para escolher a versão). Se um deploy já
   existente estiver preso numa versão antiga do Node, confira/ajuste em
   **Settings → Environment → Node Version** no painel do serviço.

## Login

O sistema agora exige login (`middleware.ts` + `app/(app)/layout.tsx`). Um
usuário administrador é criado automaticamente na primeira vez que o servidor
sobe (ou na primeira vez que rodar depois desta atualização, mesmo com um
`data/db.json` já existente):

- **E-mail:** `aureniorg3@gmail.com`
- **Senha inicial:** `crv@2026`

Troque essa senha assim que possível — em **Configurações → Cadastros** (só
administradores veem essa tela), editando o próprio usuário.

Sessão fica em um cookie assinado (HMAC-SHA256, `httpOnly`), válido por 7
dias, sem depender de nenhum pacote novo (usa só o módulo `crypto` do Node).
Em produção, defina a variável de ambiente `AUTH_SECRET` (Render → Environment)
com um valor aleatório — sem isso o sistema usa um segredo padrão de
desenvolvimento.

### Usuários e níveis de acesso

**Configurações → Cadastros** (visível a todos no menu, mas o conteúdo só
aparece para administradores — os demais veem um aviso) lista, cria, edita,
desativa e exclui usuários. Três níveis, cada um contendo o anterior:

| Nível | Pode |
|---|---|
| **Leitura** | Ver todas as telas e dados. Nada mais — os botões de criar/editar/lançar/importar ficam escondidos, e a API recusa (`403`) qualquer tentativa de gravação mesmo que alguém chame direto. |
| **Gravação** | Tudo de Leitura, mais criar ordens, lançar apontamentos, encerrar/reabrir e importar planilha. |
| **Administrador** | Tudo de Gravação, mais gerenciar usuários (criar, editar nível/senha, desativar, excluir). |

A permissão é checada **nos dois lados**: a tela esconde/desativa o que o
nível não permite (`lib/permissoes.ts`, `podeEditar`/`ehAdmin`), e cada rota
de API que grava dado confere de novo antes de gravar (`usuarioDaRequisicao`
em `lib/db.ts`) — esconder o botão na tela nunca é, sozinho, controle de
acesso de verdade.

Travas de segurança em `updateUsuario`/`deleteUsuario` (`lib/db.ts`): ninguém
desativa, rebaixa ou exclui o próprio usuário logado, e o último administrador
ativo não pode ser desativado, rebaixado nem excluído — promova outro usuário
a admin antes.

Usuário desativado (`ativo: false`) mantém o cadastro e o histórico, só não
consegue mais logar; é reversível a qualquer momento. Excluir é definitivo.

## O que já funciona no Acompanhamento de Ordens de Corte

- Cards por ordem de corte (um "quadrado" por ordem, igual ao relatório
  impresso), agrupados por frente, com o mini-relatório de talhões, área
  total, acumulado da safra e o TCH geral realizado. Status **Aberta** em
  verde, **Encerrada** em âmbar; tipo de cana **queimada** em laranja claro,
  as demais em azul.
- **Ordens com mais de uma fazenda**: o arquivo "Ordem de Colheita.xlsx" pode
  ter mais de um bloco "Propriedade" dentro da mesma ordem (uma fazenda por
  bloco, cada uma com seus próprios talhões) — e o número do talhão sozinho
  não é único nesse caso (ex.: talhão "1" pode existir em duas fazendas
  diferentes da mesma ordem). O card mostra cada fazenda como uma seção
  separada na tabela de talhões (a chave real é fazenda+talhão, tanto no
  cadastro quanto na entrada diária — ver `TalhaoOrdem`/`EntradaDiaria` em
  `lib/types.ts`).
- Filtro de período **Dia / Semana / Mês / Safra**: controla os KPIs do topo
  e a "Entrada no período" de cada card — Dia, Semana e Mês somam a entrada
  real de cana dentro do intervalo; Safra mostra o acumulado corrido desde o
  início.
- Filtro por frente, por status (aberta/encerrada, vindo direto do ERP) e
  busca por número/fazenda.
- **Resumo por frente**: uma linha por frente com 7 colunas de uma vez —
  Safra, Mês Anterior, Mês Atual, Quinzena, Semana, Dia Anterior e Dia Atual
  — todas recalculadas a partir da data selecionada no filtro (mudar a data
  recalcula a tabela inteira na hora; ela não segue os botões
  Dia/Semana/Mês/Safra, que só afetam os KPIs e os cards). Semana, Quinzena,
  Mês Atual e Safra são sempre "até a data selecionada" (o fim do recorte é
  a própria data de referência, nunca o fim natural do período) — escolher
  uma data retroativa não mistura produção de dias depois dela, mesmo que já
  estejam na base por causa de uma importação mais recente. **Dia Atual** é
  a única coluna com regra própria: só conta a entrada pesada entre 00:00 e
  06:00 daquele dia (é o número disponível assim que o relatório da
  madrugada sai, antes do resto do dia ser pesado). Essa janela de 6h vem da
  coluna Hora do relatório de Pesagem (`toneladasAte6h` em `EntradaDiaria`,
  calculada na importação). É sempre com base nas ordens selecionadas e
  mostradas nos cards abaixo (já com os filtros de frente/status/busca
  aplicados) — nunca nas 314 ordens importadas inteiras; um aviso acima da
  tabela deixa isso explícito.
- **Imprimir / PDF**: baixa um PDF do resumo por frente (mesmas colunas e
  valores da tela), com cabeçalho (título + safra + data de referência) e
  rodapé em toda página — empresa/usuário/data-hora à esquerda, nome do
  relatório ao centro, "Página X de Y" à direita. Gerado no navegador
  (`jspdf` + `jspdf-autotable`, ver `lib/relatorio-pdf.ts`), sem precisar de
  servidor; abra o PDF baixado pra imprimir.
- **Inserir Ordem**: a importação traz a safra inteira (centenas de ordens),
  mas a tela só mostra as que forem escolhidas manualmente — digite o número
  da ordem no campo "Inserir Ordem" (autocompleta pelas ordens já
  importadas) e ela aparece no card da sua frente; o × no card tira a ordem
  da tela de novo. Essa seleção fica salva no servidor
  (`ordensVisiveis` em `data/db.json`) e sobrevive a uma reimportação — só os
  *dados* da ordem são atualizados, a escolha de quais aparecem não muda.
- **Lançar área colhida**: único dado ainda lançado manualmente — a área já
  colhida de cada talhão (medição de campo, sempre parcial). Botão em cada
  card, com dois modos: **Total da ordem** (um número só, distribuído
  proporcionalmente pela área de cada talhão) ou **Por talhão** (um valor
  exato por talhão). Mostrado no resumo do card, ao lado da área da ordem.
  As toneladas continuam 100% vindas da importação — isso não reabre
  lançamento manual de apontamento.
- **Importar planilhas**: lê os 3 relatórios oficiais do CHBWEB e substitui
  a base inteira de ordens por eles — ver seção própria abaixo. As toneladas
  são 100% derivadas do sistema de origem; não há cadastro manual de ordem
  nem lançamento manual de apontamento.

## Importar planilhas (Ordens de Corte)

Este módulo não tem cadastro manual: **toda a base de ordens de corte é
reconstruída a partir de 3 arquivos exportados diariamente do ERP (CHBWEB)**.
Na tela de Ordens de Corte, o botão **Importar planilhas** pede os 3 arquivos
de uma vez:

1. **"Ordem de Colheita.xlsx"** — cadastro das ordens: número, frente,
   fazenda (código/nome), proprietário, status (Aberta/Encerrada), tipo de
   cana, data de queima e a lista de talhões com área (ha) de cada ordem.
   Parseado por `parseOrdemColheita` em [lib/import-pesagem.ts](lib/import-pesagem.ts),
   que separa o arquivo em blocos (cada bloco começa numa linha
   `"Ordem de Colheita"`) e lê os sub-campos de cada um.
2. **"Pesagem de Cana por Hora - Mod. B - Cana Moagem.xlsx"** — o relatório
   de pesagem, uma linha por viagem de caminhão (`Data`, `Hora`, `Veículo`,
   `Controle`, `Seq`, `Propriedade`, `Talhão`, peso líquido em kg). É a base
   principal: cada linha vira uma viagem real de cana entrando.
3. **"Conferência de Pesagens - Cana Moagem.xlsx"** — usado só para
   descobrir a qual **ordem** (coluna O.Q.) cada viagem pertence, já que o
   relatório de pesagem por hora não traz essa informação diretamente.
   Parseado por `parseConferencia`.

**A ligação entre os arquivos 2 e 3 é composta: `Controle` + `Seq`**, não
`Controle` sozinho — o mesmo número de Controle se repete para viagens
diferentes (parciais do mesmo carregamento), e só o par `Controle+Seq` é
único. Usar só `Controle` juntaria viagens de talhões/cortes diferentes por
engano.

Como o processamento funciona:

- O arquivo 3 (Conferência) é lido primeiro, montando um mapa
  `Controle+Seq → Ordem`.
- O arquivo 2 (Pesagem) é lido **em streaming, linha a linha**
  (`agregarPesagem` em [lib/import-pesagem.ts](lib/import-pesagem.ts), via
  `exceljs`) — para cada viagem, busca a ordem no mapa da Conferência e já
  agrega direto em (ordem, data, talhão), sem guardar as ~176 mil viagens
  num array à parte. O parser antigo (pacote `xlsx`, que carrega a planilha
  inteira em objetos antes de converter) passava de 700 MB de RAM só para
  ler um desses arquivos — o suficiente para derrubar por falta de memória
  a instância gratuita do Render (512 MB). Ler em streaming e agregar na
  hora mantém o pico bem abaixo disso.
- Viagem sem `Controle+Seq` na Conferência, ou cuja ordem não está
  cadastrada no arquivo 1, é contada à parte e **não** entra no total — o
  resultado da importação mostra quantas viagens caíram em cada caso.
- A importação é **substituição total**: os 3 arquivos são sempre a
  exportação completa da safra corrente (não deltas diários), então cada
  importação **zera e recria** a base inteira de ordens (`substituirOrdens`
  em [lib/db.ts](lib/db.ts)), gravando o timestamp em `ultimaImportacao`.
  Rodar o processo diariamente com os 3 arquivos mais recentes é o fluxo
  esperado.
- Ao final, o modal mostra `totalOrdens`, `totalViagens`,
  `viagensSemOrdem`, `viagensSemConferencia`, além de avisos e erros de
  leitura — nada fica escondido.

Validado ponta a ponta com os arquivos reais de produção (176.123 viagens,
314 ordens, 16 viagens sem correspondência — 0,009%, esperado): o acumulado
da safra mostrado na tela bateu exatamente com o total do rodapé do arquivo
de Conferência, e as áreas por talhão de uma ordem específica bateram com o
que já estava publicado no sistema em produção.

## Sobre o filtro de data mostrar zero

Os filtros de **Dia / Semana / Mês** só somam a entrada real de cana que
existe para aquele intervalo (via `EntradaDiaria`, uma por ordem+data+talhão)
— não existe estimativa nem rateio. Se uma ordem não teve viagem numa data,
o filtro mostra zero corretamente para ela naquele período; isso é o
esperado e reflete o que veio dos 3 arquivos, não um erro de cálculo.

## Estrutura

```
middleware.ts                    gate leve (checa cookie) antes de cada rota
app/
  layout.tsx                     layout raiz (html/body, sem menu)
  login/
    page.tsx                     redireciona pra dentro se já logado
    LoginForm.tsx                formulário de login
  (app)/                         grupo de rotas autenticadas (mesma URL, só
                                  organização de pastas — não aparece no link)
    layout.tsx                   valida a sessão de verdade e renderiza o menu
    page.tsx                     redireciona para Ordens de Corte
    acompanhamentos/ordens-de-corte/
      page.tsx                   carrega os dados no servidor
      OrdensCorteClient.tsx      tela inteira (filtros, cards, modais)
    configuracoes/cadastros/
      page.tsx                   busca o usuário logado; só admin vê a tela
      UsuariosClient.tsx         tabela de usuários + modais novo/editar
    painel/, contencioso/, agricultura/, planejamento/
                                  demais itens do menu (em construção)
  api/
    ordens-corte/
      route.ts                   GET (listar ordens + ordensVisiveis)
      importar/route.ts          POST (importa os 3 arquivos, exige gravação+)
      visiveis/route.ts          POST/DELETE (marca/desmarca ordem pra exibir, exige gravação+)
      area-colhida/route.ts      POST (lança área colhida por ordem/talhão, exige gravação+)
    usuarios/
      route.ts                   GET (listar) / POST (criar) — só admin
      [id]/route.ts              PATCH (editar) / DELETE (excluir) — só admin
    auth/
      login/route.ts             POST — confere e-mail/senha, grava cookie
      logout/route.ts            POST — limpa o cookie
      me/route.ts                GET — usuário da sessão atual
components/
  Sidebar.tsx                    menu lateral (cores CRV Industrial) + usuário/sair
  PlaceholderPage.tsx            tela-padrão dos módulos ainda não construídos
  ui.tsx                         ModalShell e Campo, compartilhados entre telas
lib/
  types.ts                       modelo de dados (OrdemCorte, TalhaoOrdem, EntradaDiaria,
                                  PerfilUsuario, UsuarioPublico)
  db.ts                          persistência em data/db.json + substituirOrdens() +
                                  CRUD de usuários + usuarioAtual()/usuarioDaRequisicao()
  permissoes.ts                  podeEditar()/ehAdmin() — checados na tela E na API
  import-pesagem.ts              parseOrdemColheita/parsePesagemPorHora/parseConferencia
                                  + montarOrdens() (join Controle+Seq e agregação)
  auth.ts                        hash de senha e cookie de sessão (sem libs externas)
  period.ts                      cálculo de dia/semana/mês/safra a partir de EntradaDiaria
  format.ts                      formatação de número/data em pt-BR
```

## Cores

A paleta (`tailwind.config.ts`, grupo `navy`/`brand`) foi ajustada para bater
com o padrão visual do outro sistema da CRV Industrial (menu lateral azul-marinho,
cartões brancos, indicador verde "Salvo no servidor", destaques em azul).

## Próximos módulos sugeridos

1. Acompanhamento de Colheita (própria) e Colheita Terceiro.
2. Acompanhamento de Insumos.
3. Cadastro de fazendas/talhões, equipamentos, funcionários, fornecedores
   (a parte de usuários já está pronta, ver "Usuários e níveis de acesso").

## Colocando no ar (o "link do programa")

Este ambiente onde eu trabalho não tem acesso de deploy (Render/Vercel/etc.) —
só ao repositório do GitHub. Não existe hoje um link público rodando; para ter
um, é um dos dois caminhos abaixo:

- **Rodar localmente**, só pra testar na sua máquina:
  ```bash
  npm install
  npm run dev
  ```
  e abrir `http://localhost:3000` (o login pede o e-mail/senha padrão da
  seção **Login** acima).
- **Publicar no Render** (é o que o restante deste README já documenta em
  "Deploy no Render", com o disco persistente para não perder as ordens
  cadastradas a cada deploy). Depois de criar o Web Service lá, o próprio
  Render gera a URL pública (algo como
  `https://controle-agricola.onrender.com`) — esse é o link que dá pra
  compartilhar com o time.

Se preferir, me diga em qual dessas contas (Render, Vercel, outra) você quer
publicar e, se me der acesso a ela, posso configurar o deploy diretamente
daqui.
