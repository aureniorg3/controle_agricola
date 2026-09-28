# Controle Agrícola — CRV Industrial

Sistema de acompanhamento agrícola da safra de cana-de-açúcar (Unidade
Capinópolis-MG). Primeiro módulo entregue: **Acompanhamento de Ordens de
Corte**, alimentado a partir do relatório "Relatório de entrada de cana por
Ordem de Colheita" e já com lançamento de novas ordens e apontamentos diários
pela própria tela.

## Stack

- **Next.js 14** (App Router) + **TypeScript** + **Tailwind CSS**
- Persistência em **arquivo JSON no servidor** (`data/db.json`), lido e
  gravado pelas rotas de API — não é mock: criar uma ordem ou lançar um
  apontamento grava de verdade e a tela atualiza sozinha.
- Sem dependências externas de banco de dados para começar. Quando quiser
  migrar para Postgres/Supabase, só é preciso reimplementar `lib/db.ts`
  (`getDb`/`saveDb`/`insertOrdem`/`updateOrdem`) — nenhuma tela precisa mudar.

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

1. **New → Web Service**, aponte para este repositório.
2. Build Command: `npm install && npm run build`
3. Start Command: `npm start`
4. **Disco persistente (recomendado):** por padrão o arquivo `data/db.json`
   fica no disco do serviço. Em um Web Service comum do Render o disco não é
   persistente entre deploys — para não perder as ordens cadastradas, adicione
   um **Persistent Disk** montado em `data/` (Settings → Disks) ou troque a
   persistência por um banco gerenciado (ver seção acima).

## Login

O sistema agora exige login (`middleware.ts` + `app/(app)/layout.tsx`). Um
usuário administrador é criado automaticamente na primeira vez que o servidor
sobe (ou na primeira vez que rodar depois desta atualização, mesmo com um
`data/db.json` já existente):

- **E-mail:** `aureniorg3@gmail.com`
- **Senha inicial:** `crv@2026`

Troque essa senha assim que possível — ainda não existe tela de troca de
senha; por ora, para gerar uma nova senha do admin, apague o usuário de
`data/db.json` e reinicie o servidor (ele recria com a senha padrão), ou peça
para eu adicionar uma tela de gerenciamento de usuários.

Sessão fica em um cookie assinado (HMAC-SHA256, `httpOnly`), válido por 7
dias, sem depender de nenhum pacote novo (usa só o módulo `crypto` do Node).
Em produção, defina a variável de ambiente `AUTH_SECRET` (Render → Environment)
com um valor aleatório — sem isso o sistema usa um segredo padrão de
desenvolvimento.

## O que já funciona no Acompanhamento de Ordens de Corte

- Cards por ordem de corte (um "quadrado" por ordem, igual ao relatório
  impresso), agrupados por frente, com o mini-relatório de talhões, área
  colhida, área liberada e as três linhas de TCH (safra anterior, estimado,
  geral realizado).
- Filtro de período **Dia / Semana / Mês / Safra**: Dia e Semana e Mês somam
  os apontamentos lançados dentro do intervalo; Safra mostra o acumulado
  corrido (igual à coluna "Acum(t)" do relatório).
- Filtro por frente, por status (aberta/encerrada) e busca por número/fazenda.
- **Nova Ordem de Corte**: cria a ordem com seus talhões e ela aparece na tela
  imediatamente (sem recarregar a página).
- **+ Apontamento**: lança a tonelagem do dia numa ordem — pode informar o
  total da ordem (distribuído proporcionalmente pela área dos talhões) ou
  detalhar talhão a talhão. Atualiza a tela na hora e passa a contar nos
  filtros de dia/semana/mês.
- Encerrar/reabrir ordem.

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
    painel/, contencioso/, agricultura/, planejamento/, configuracoes/
                                  demais itens do menu (em construção)
  api/
    ordens-corte/
      route.ts                   GET (listar) / POST (nova ordem)
      [id]/route.ts              GET / PATCH (status, áreas, TCH) / DELETE
      [id]/lancamentos/route.ts  POST (novo apontamento diário)
    auth/
      login/route.ts             POST — confere e-mail/senha, grava cookie
      logout/route.ts            POST — limpa o cookie
      me/route.ts                GET — usuário da sessão atual
components/
  Sidebar.tsx                    menu lateral (cores CRV Industrial) + usuário/sair
  PlaceholderPage.tsx            tela-padrão dos módulos ainda não construídos
lib/
  types.ts                       modelo de dados
  db.ts                          persistência em data/db.json
  auth.ts                        hash de senha e cookie de sessão (sem libs externas)
  period.ts                      cálculo de dia/semana/mês/safra
  seed-data.ts                   carga inicial (ver abaixo)
  format.ts                      formatação de número/data em pt-BR
```

## Sobre os dados de carga inicial (seed)

`lib/seed-data.ts` contém as ordens de corte extraídas do relatório em PDF/XLSX
enviado (fechamento de 27/09/2026, safra 2026/27). É uma carga **ilustrativa**
para o sistema já nascer com a operação real dentro — a partir daí, a fonte de
verdade passa a ser o que for cadastrado pela tela (novas ordens e novos
apontamentos). Alguns números de talhão do relatório impresso têm pequenas
inconsistências internas entre o corpo do relatório e o resumo por frente
(comum nesse tipo de relatório de impressão paginada); onde havia divergência,
foi priorizado o resumo consolidado por Frente/Ordem/Fazenda. Vale revisar as
15 ordens carregadas na primeira tela e corrigir o que precisar direto por lá.

## Cores

A paleta (`tailwind.config.ts`, grupo `navy`/`brand`) foi ajustada para bater
com o padrão visual do outro sistema da CRV Industrial (menu lateral azul-marinho,
cartões brancos, indicador verde "Salvo no servidor", destaques em azul).

## Próximos módulos sugeridos

1. Acompanhamento de Colheita (própria) e Colheita Terceiro.
2. Acompanhamento de Insumos.
3. Cadastros (fazendas/talhões, equipamentos, funcionários, fornecedores).
4. Tela de gerenciamento de usuários (criar/editar/desativar, trocar senha) —
   hoje o único jeito de mexer nos usuários é editando `data/db.json`.

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
