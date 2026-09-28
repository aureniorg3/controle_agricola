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
app/
  layout.tsx                     shell com o menu lateral
  page.tsx                       redireciona para Ordens de Corte
  acompanhamentos/ordens-de-corte/
    page.tsx                     carrega os dados no servidor
    OrdensCorteClient.tsx        tela inteira (filtros, cards, modais)
  api/ordens-corte/
    route.ts                     GET (listar) / POST (nova ordem)
    [id]/route.ts                GET / PATCH (status, áreas, TCH) / DELETE
    [id]/lancamentos/route.ts    POST (novo apontamento diário)
  painel/, contencioso/, agricultura/, planejamento/, configuracoes/
                                  demais itens do menu (em construção)
components/
  Sidebar.tsx                    menu lateral (cores CRV Industrial)
  PlaceholderPage.tsx            tela-padrão dos módulos ainda não construídos
lib/
  types.ts                       modelo de dados
  db.ts                          persistência em data/db.json
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
4. Autenticação e perfis de acesso — hoje o sistema não tem login.
