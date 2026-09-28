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
   cada novo deploy o Render apaga o disco do serviço e o sistema volta para
   os dados de exemplo (seed) e recria o usuário admin com a senha padrão.
5. **Create Web Service.** O primeiro deploy demora alguns minutos (build do
   Next.js); depois disso o Render mostra a URL pública do serviço no topo da
   página (algo como `https://controle-agricola.onrender.com`) — esse é o
   link para compartilhar com o time. O login pede o e-mail/senha da seção
   **Login** abaixo.

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
- **Importar planilha**: lê um .xlsx/.xls/.csv (o mesmo tipo de relatório que
  já foi usado para a carga inicial) e cria/atualiza ordens, talhões e
  apontamentos diários a partir dele — ver seção própria abaixo.
- Encerrar/reabrir ordem.

## Importar planilha (Ordens de Corte)

Na tela de Ordens de Corte, o botão **Importar planilha** abre um envio de
arquivo .xlsx/.xls/.csv. É a forma de trazer, para dentro do sistema, dados
que hoje só existem numa planilha de origem — sem precisar digitar ordem por
ordem, dia por dia.

Como funciona:

- **Reconhecimento tolerante de colunas.** O cabeçalho é procurado nas
  primeiras 15 linhas do arquivo (não precisa estar na linha 1), e nomes de
  coluna são reconhecidos por uma lista de apelidos (ex.: "Ordem", "Nº Ordem",
  "OS" e "Ordem de Corte" são todos aceitos como a coluna de ordem). Um botão
  "Baixar modelo de planilha" no próprio modal mostra o formato recomendado
  (`public/templates/modelo-importacao-ordens-corte.xlsx`), mas o arquivo real
  não precisa seguir esse modelo à risca.
- **Colunas obrigatórias**: Ordem, Talhão, Data e Toneladas do dia. As demais
  (Frente, Região, Código/Nome da fazenda, Área, Acumulado da safra, TCH,
  Safra) são opcionais e, quando ausentes numa linha, herdam o valor da linha
  anterior do mesmo grupo (comum em relatórios onde a ordem só é repetida na
  primeira linha de cada bloco de talhões).
- **A planilha nunca apaga o que já está cadastrado.** Se uma ordem já existe
  no sistema, campos como frente, fazenda ou área de um talhão só são
  **completados** quando estão vazios — nunca sobrescritos. Se o valor da
  planilha for diferente do já cadastrado, o sistema mantém o que já estava
  no sistema e mostra um aviso, em vez de decidir sozinho qual dos dois está
  certo.
- **Reimportar é seguro (idempotente).** Cada apontamento importado recebe um
  identificador fixo por ordem+data; reimportar o mesmo arquivo, ou uma
  versão atualizada dele, atualiza os apontamentos existentes em vez de
  duplicá-los. O acumulado por talhão (`acumSafraT`) usa a coluna "Acum" da
  planilha como valor oficial quando ela existe; quando não existe, é
  incrementado apenas pela produção realmente nova (nunca soma a mesma linha
  duas vezes).
- **Nada é escondido.** Ao final da importação, o modal mostra quantas ordens
  e apontamentos foram criados/atualizados, além da lista de avisos (dados
  mantidos como já estavam) e de linhas ignoradas (com o número da linha e o
  motivo) — a planilha é tratada como uma base de apoio para preencher o
  sistema, não como a verdade final sobre como os dados devem aparecer na
  tela.

## Por que um filtro de data pode aparecer zerado

Os filtros de **Dia / Semana / Mês** só somam os apontamentos que existem de
fato para aquele intervalo — não existe nenhum cálculo escondido nem entrada
"estimada". Se a base de dados só tem um apontamento por ordem (é o caso da
carga inicial, ver seção seguinte), qualquer outra data mostra zero
corretamente, porque não há registro nenhum para ela. A tela também mostra um
aviso nesse caso, com um atalho para **Importar planilha** ou lançar um
apontamento manual naquela data. Assim que existirem apontamentos em mais de
uma data (por importação ou lançamento manual), os filtros passam a mostrar
os valores de cada uma normalmente.

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
      importar/route.ts          POST (importação de planilha)
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
  db.ts                          persistência em data/db.json + importarLinhas()
  import-ordens.ts               leitura/interpretação tolerante da planilha
  auth.ts                        hash de senha e cookie de sessão (sem libs externas)
  period.ts                      cálculo de dia/semana/mês/safra
  seed-data.ts                   carga inicial (ver abaixo)
  format.ts                      formatação de número/data em pt-BR
public/templates/
  modelo-importacao-ordens-corte.xlsx  modelo oferecido no botão "Importar planilha"
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

Importante: essa carga tem **um único apontamento por ordem**, todos na mesma
data (27/09/2026) — é a foto do relatório recebido, não um histórico diário
real. Por isso, filtrar por qualquer outra data nos mostra zero (ver seção
"Por que um filtro de data pode aparecer zerado" acima); isso é o esperado, e
não indica erro no cálculo. Histórico de datas de verdade só existe a partir
de novos lançamentos manuais ou de uma planilha importada com mais de uma
data por ordem/talhão.

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
