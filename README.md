# Controle Agrícola — CRV Industrial

Sistema de acompanhamento agrícola da safra de cana-de-açúcar (Unidade
Capinópolis-MG). Primeiro módulo entregue: **Acompanhamento de Ordens de
Corte** — **100% derivado de 2 relatórios do sistema de origem (CHBWEB)**,
importados diariamente. Não há cadastro nem lançamento manual de ordem: a
base é sempre o retrato mais recente dos 2 arquivos.

## Stack

- **Next.js 16** (App Router, Turbopack) + **TypeScript** + **Tailwind CSS**
  — exige **Node 20.9+** (fixado em `package.json` → `engines.node`)
- Persistência em **Postgres** (driver oficial `pg`, sem ORM) — tabelas
  normais (`usr`, `ord`, `tlh`, `ent_dia`,
  `ord_vis`, `met_frt`, `app_met` — nomes abreviados, legenda no topo do schema.sql), compartilhadas e persistentes entre
  deploys/restarts. Ver `supabase/schema.sql` (DDL completo, rode no SQL
  Editor do Supabase **antes do primeiro uso** — a aplicação não cria as
  tabelas sozinha, só semeia o usuário admin padrão se `usr` estiver
  vazia) e `lib/db.ts` (as consultas). Usamos o tier **grátis** do
  [Supabase](https://supabase.com) — ver `DATABASE_URL` na seção "Deploy no
  Render" abaixo.
  - **Por que trocamos de um arquivo local (`data/db.json`) pra isso:** o
    Render free não suporta disco persistente (só a partir do plano pago
    Starter) — sem disco, qualquer arquivo local é apagado a cada
    deploy/restart. Isso já causou perda de usuários cadastrados e ordens
    importadas em produção. Um banco externo resolve isso sem custo,
    independente do plano de hospedagem.
  - **Atenção (Supabase free):** o projeto pausa sozinho depois de ~1 semana
    sem uso. Se o sistema parar de responder depois de um tempo sem acesso,
    entre no [painel do Supabase](https://supabase.com/dashboard) e
    reative o projeto (um clique) antes de investigar outra coisa.

### Configurar o banco (uma vez só, antes do primeiro uso)

1. Abra o projeto no [painel do Supabase](https://supabase.com/dashboard) →
   **SQL Editor** → **New query**.
2. Cole o conteúdo de [`supabase/schema.sql`](supabase/schema.sql) inteiro e
   clique em **Run**. Cria as tabelas (`usr`, `ord`, `tlh`,
   `ent_dia`, `ord_vis`, `met_frt`, `app_met`) e os índices — pode
   rodar de novo sem problema, nenhum comando apaga dado existente.
3. Pegue a connection string (`DATABASE_URL`) — ver instruções na seção
   "Deploy no Render" abaixo — e configure localmente (`.env.local`) e no
   Render.

Não precisa rodar nenhum outro script: a aplicação cria o usuário
administrador padrão sozinha na primeira consulta, se a tabela `usuarios`
estiver vazia (mesmo comportamento de antes).

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
   - `DATABASE_URL` — **obrigatório**, a connection string do seu projeto
     gratuito no [Supabase](https://supabase.com/dashboard). No painel do
     Supabase: botão **Connect** (topo da página) → aba **Direto** → método
     **Session pooler** (recomendado pra servidores de longa duração como o
     Render, e evita depender de IPv6) → copie a string (formato
     `postgresql://postgres.xxxxx:[YOUR-PASSWORD]@aws-0-xxxxx.pooler.supabase.com:5432/postgres`)
     e substitua `[YOUR-PASSWORD]` pela senha real do banco (a que você
     definiu ao criar o projeto — se perdeu, redefina em **Project Settings
     → Database → Reset database password**). Essa etapa envolve uma senha
     de verdade — faça você mesmo, direto no painel do Render; eu não
     insiro credenciais em formulários por política.
   - `AUTH_SECRET` — um valor aleatório, só seu, usado para assinar o cookie
     de login. Pode usar este (gerado agora), ou qualquer string longa e
     aleatória:
     ```
     MCyed2WYMhzXmYr3LFWpRIMA55TL9LocbIUjEZfZvMI
     ```
4. **Sem `DATABASE_URL` o sistema não funciona de verdade** (não é mais um
   fallback silencioso pra um arquivo local): toda leitura/gravação falha, e
   qualquer admin logado vê uma faixa vermelha no topo de toda tela
   (`diagnosticoArmazenamento()` em `lib/db.ts`, checado em
   `app/(app)/layout.tsx`), além do aviso no log do serviço assim que o
   processo sobe. **Importante:** usuários cadastrados, ordens importadas e
   a seleção de quais ordens aparecem na tela são **sempre globais** (um
   único documento compartilhado por todo mundo que acessa o sistema — não
   há nada "por usuário" no modelo de dados).
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

O sistema agora exige login (`middleware.ts` + `app/(app)/layout.tsx`). O
campo de login aceita **e-mail OU nome de usuário** — qualquer um dos dois
funciona (`getUsuarioPorIdentificador` em `lib/db.ts`). Um usuário
administrador é criado automaticamente na primeira vez que o sistema
consulta a tabela `usuarios` e ela está vazia:

- **E-mail:** `aureniorg3@gmail.com`
- **Usuário:** `admin`
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

**Cadastro com senha provisória:** ao criar um usuário, o nome vem em dois
campos (Nome e Sobrenome), mais e-mail e um **nome de usuário** (login
alternativo — 3-30 caracteres: letras, números, ponto, hífen ou underscore).
A senha **não é digitada por quem cadastra** — o sistema gera uma senha
provisória sozinha (`gerarSenhaProvisoria` em `lib/auth.ts`) e mostra na tela
na hora de criar, pra quem cadastrou repassar manualmente (não há envio
automático por e-mail). No primeiro login com essa senha (ou depois de um
admin resetar a senha de alguém em Editar), o sistema obriga a trocar por uma
definitiva em `/trocar-senha` antes de liberar qualquer outra tela
(`precisaTrocarSenha` em `Usuario`, checado em `app/(app)/layout.tsx`) —
trocar a própria senha não ativa essa trava, só quando é OUTRA pessoa (um
admin) quem define a senha. Todo campo de senha (login, trocar senha,
cadastro/edição de usuário) tem um botão de olho pra mostrar/ocultar o que
foi digitado (`InputSenha` em `components/ui.tsx`).

## O que já funciona no Acompanhamento de Ordens de Corte

- Cards por ordem de corte (um "quadrado" por ordem, igual ao relatório
  impresso), agrupados por frente, com o mini-relatório de talhões (Talhão /
  Área / **Dia Anterior** / **Dia Atual** até 06h / Acum(t) — essas duas
  últimas colunas usam sempre esse recorte fixo, independente dos botões
  Dia/Semana/Mês/Safra), terminando numa linha **Total** (soma das colunas
  acima, antes do resumo), área total, acumulado da safra e o TCH geral
  realizado. Status **Aberta** em verde, **Encerrada** em âmbar; tipo de
  cana **queimada** em laranja claro, as demais em azul.
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
- **Resumo por frente**: uma linha por frente com **Ordens** e **Área
  Selecionada** (contagem e área só das ordens marcadas e mostradas nos
  cards abaixo) seguidas de **Área Acumulada** e 7 colunas de tonelada —
  Safra, Mês Anterior, Mês Atual, Quinzena, Semana, Dia Anterior e Dia Atual
  — todas recalculadas a partir da data selecionada no filtro (mudar a data
  recalcula a tabela inteira na hora; ela não segue os botões
  Dia/Semana/Mês/Safra, que só afetam os KPIs e os cards). Essas colunas são
  sempre de **todas as ordens que batem com os filtros de frente/status/busca**
  — não só as marcadas pra aparecer nos cards; só "Ordens" e "Área
  Selecionada" refletem a seleção manual (um aviso acima da tabela deixa
  isso explícito). Semana, Quinzena, Mês Atual e Safra são sempre "até a
  data selecionada" (o fim do recorte é a própria data de referência, nunca
  o fim natural do período) — escolher uma data retroativa não mistura
  produção de dias depois dela, mesmo que já estejam na base por causa de
  uma importação mais recente. **Dia Atual** é a única coluna com regra
  própria: só conta a entrada pesada entre 00:00 e 06:00 daquele dia (é o
  número disponível assim que o relatório da madrugada sai, antes do resto
  do dia ser pesado). Essa janela de 6h vem da coluna "Hora Saída Indústria"
  do relatório de pesagem (`toneladasAte6h` em `EntradaDiaria`, calculada na
  importação).
- **Resumo Detalhado por Ordem e Fazenda**: tabela no final da tela (Frente /
  Ordem / Fazenda / Descrição; Estimado: Área Total OC, TCH Est., Ton Est.;
  Realizado: Área Colhida, Produção Acum., TCH Parcial; A colher: área total −
  colhida (0 na ordem encerrada), TCH (o parcial; sem ele, o estimado, com *)
  e Ton; Projetado: produção acumulada + ton a colher) com uma linha por fazenda — uma ordem
  com mais de uma fazenda vira mais de uma linha — subtotal por frente e
  total geral no final, igual ao relatório impresso de referência. Mesmo
  critério de escopo do resumo por frente: todas as ordens do filtro atual,
  não só as selecionadas. Seguida de um gráfico de barras de Produção Total
  (t) por frente (`resumoDetalhadoPorOrdemFazenda`/`LinhaResumoDetalhado` em
  `lib/period.ts`).
- **Imprimir / PDF**: baixa um PDF completo seguindo o padrão visual CRV
  Industrial (cabeçalho azul `#23396B` com filete verde e logo da empresa,
  tabelas com cabeçalho azul/linhas alternadas/linha de total em azul) — a
  tabela de resumo por frente, os cards de ordem em **grade de 4 colunas**
  (igual à tela) agrupados por frente, e por fim o resumo detalhado por
  ordem/fazenda com o gráfico de barras, paginando automaticamente conforme
  o conteúdo cresce. Cabeçalho com título + safra + data de referência, e
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
- **Importar planilhas**: lê os 2 relatórios oficiais do CHBWEB e substitui
  a base inteira de ordens por eles — ver seção própria abaixo. As toneladas
  são 100% derivadas do sistema de origem; não há cadastro manual de ordem
  nem lançamento manual de apontamento.

## Importar planilhas (Ordens de Corte)

Este módulo não tem cadastro manual: **toda a base de ordens de corte é
reconstruída a partir de 2 arquivos exportados diariamente do ERP (CHBWEB)**.
Na tela de Ordens de Corte, o botão **Importar planilhas** pede os 2 arquivos
de uma vez:

1. **"Ordem de Colheita.xlsx"** — cadastro das ordens: número, frente,
   fazenda (código/nome), proprietário, status (Aberta/Encerrada), tipo de
   cana, data de queima e a lista de talhões com área (ha) de cada ordem.
   Parseado por `parseOrdemColheita` em [lib/import-pesagem.ts](lib/import-pesagem.ts),
   que separa o arquivo em blocos (cada bloco começa numa linha
   `"Ordem de Colheita"`) e lê os sub-campos de cada um.
2. **"Relatório de Pesagem de Cana"** (ex.: `RSC0907R-275.xlsx`) — uma linha
   por viagem de caminhão, já com tudo junto: a coluna **"Liberação" já é o
   número da ordem (O.Q.) diretamente**, "Fundo Agrícola" já traz
   fazenda código+nome ("9529 - FAZ. SANTA VITÓRIA", mesmo formato do
   arquivo 1), além de Talhão, Peso Líquido e os horários reais de
   acionamento/chegada/carregamento/saída (campo/indústria). Parseado por
   `agregarPesagem`.

   Esse relatório **substitui dois arquivos antigos** ("Pesagem de Cana por
   Hora" + "Conferência de Pesagens", que exigiam cruzar `Controle+Seq`
   entre os dois pra descobrir a ordem de cada viagem) — como a ordem já vem
   direto na "Liberação", não tem mais cruzamento nenhum a fazer.

Como o processamento funciona:

- O arquivo 2 é lido **em streaming, linha a linha**
  (`agregarPesagem` em [lib/import-pesagem.ts](lib/import-pesagem.ts), via
  `exceljs`) — para cada viagem, confere se a "Liberação" é uma ordem
  cadastrada no arquivo 1 e já agrega direto em (ordem, data, fazenda,
  talhão), sem guardar cada viagem num array à parte (o arquivo pode chegar
  a centenas de milhares de linhas numa exportação de safra inteira, e a
  instância gratuita do Render só tem 512 MB de RAM).
- Viagem cuja "Liberação" não é uma ordem cadastrada no arquivo 1 é contada
  à parte e **não** entra no total — o resultado da importação mostra
  quantas viagens caíram nesse caso.
- A coluna **"Dia Atual"** (resumo por frente e cards) usa a "Hora Saída
  Indústria" de cada viagem pra saber se ela foi pesada antes das 06:00 —
  diferente da "Data Mov." (sempre igual à "Data Saída Indústria", é o dia
  que a viagem pertence pra todas as outras colunas).
- A importação é **substituição total**: os 2 arquivos são sempre a
  exportação completa da safra corrente (não deltas diários), então cada
  importação **zera e recria** a base inteira de ordens (`substituirOrdens`
  em [lib/db.ts](lib/db.ts)), gravando o timestamp em `ultimaImportacao`.
  Rodar o processo diariamente com os 2 arquivos mais recentes é o fluxo
  esperado.
- Ao final, o modal mostra `totalOrdens`, `totalViagens` e
  `viagensSemOrdem`, além de avisos e erros de leitura — nada fica escondido.

Validado ponta a ponta com um arquivo real do novo relatório (848 viagens de
um dia, 0 sem ordem cadastrada): os totais por talhão e a divisão "Dia
Atual" (antes/depois das 06:00) bateram exatamente com a soma manual feita
direto na planilha de origem, e ordens com mais de uma fazenda (ex.: a
2474, com talhões em "9479 - DOIS IRMÃOS" e "9529 - FAZ. SANTA VITÓRIA")
continuaram sendo separadas corretamente por fazenda no card.

## Sobre o filtro de data mostrar zero

Os filtros de **Dia / Semana / Mês** só somam a entrada real de cana que
existe para aquele intervalo (via `EntradaDiaria`, uma por ordem+data+talhão)
— não existe estimativa nem rateio. Se uma ordem não teve viagem numa data,
o filtro mostra zero corretamente para ela naquele período; isso é o
esperado e reflete o que veio dos 2 arquivos, não um erro de cálculo.

## Estrutura

```
middleware.ts                    gate leve (checa cookie) antes de cada rota
app/
  layout.tsx                     layout raiz (html/body, sem menu)
  login/
    page.tsx                     redireciona pra dentro se já logado
    LoginForm.tsx                formulário de login
  trocar-senha/
    page.tsx                     só acessível com sessão + precisaTrocarSenha
    TrocarSenhaForm.tsx          formulário de nova senha
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
      importar/route.ts          POST (importa os 2 arquivos, exige gravação+)
      visiveis/route.ts          POST/DELETE (marca/desmarca ordem pra exibir, exige gravação+)
      area-colhida/route.ts      POST (lança área colhida por ordem/talhão, exige gravação+)
    usuarios/
      route.ts                   GET (listar) / POST (criar) — só admin
      [id]/route.ts              PATCH (editar) / DELETE (excluir) — só admin
    auth/
      login/route.ts             POST — confere e-mail/senha, grava cookie
      logout/route.ts            POST — limpa o cookie
      me/route.ts                GET — usuário da sessão atual
      trocar-senha/route.ts      POST — troca a senha provisória, limpa precisaTrocarSenha
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
  import-pesagem.ts              parseOrdemColheita + agregarPesagem() (streaming,
                                  "Liberação" já é a ordem) + montarOrdens()
  auth.ts                        hash de senha, senha provisória e cookie de sessão
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
