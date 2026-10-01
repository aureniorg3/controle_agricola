-- =====================================================================
-- Controle Agrícola — CRV Industrial
-- Schema inicial para Supabase (Postgres).
--
-- Como rodar: painel do Supabase → SQL Editor → New query → cole este
-- arquivo inteiro → Run. Pode rodar de novo sem problema (todo comando usa
-- "if not exists"/"on conflict" — não apaga nem duplica nada já existente).
--
-- Não cria o usuário administrador padrão aqui de propósito: o hash de
-- senha (scrypt, formato "salt:hash") é gerado pelo próprio app em
-- lib/auth.ts — a aplicação cria esse usuário sozinha na primeira consulta
-- se a tabela `usuarios` estiver vazia, do mesmo jeito que já fazia antes.
-- =====================================================================

-- Usuários do sistema (login, perfis de acesso)
create table if not exists usuarios (
  id text primary key,
  nome text not null,
  sobrenome text not null default '',
  email text not null unique,
  usuario text,
  senha_hash text not null,
  perfil text not null check (perfil in ('leitura', 'gravacao', 'admin')),
  ativo boolean not null default true,
  precisa_trocar_senha boolean not null default false,
  criado_em timestamptz not null default now()
);

-- Login por usuário, além de e-mail — coluna adicionada numa versão
-- posterior deste schema; os comandos abaixo são seguros de rodar de novo
-- em bancos que já tinham a tabela `usuarios` sem essa coluna (preenche com
-- a parte antes do "@" do e-mail pra quem já existe, só na primeira vez).
alter table usuarios add column if not exists usuario text;
update usuarios set usuario = split_part(email, '@', 1) where usuario is null;
alter table usuarios alter column usuario set not null;
create unique index if not exists idx_usuarios_usuario_lower on usuarios (lower(usuario));

-- Ordens de corte — 100% derivadas da importação das planilhas do CHBWEB
-- (nunca cadastradas nem editadas manualmente, exceto área colhida)
create table if not exists ordens (
  numero text primary key,
  frente text not null,
  fazenda_codigo text not null,
  fazenda_nome text not null,
  proprietario_codigo text,
  proprietario_nome text,
  status text not null check (status in ('Aberta', 'Encerrada')),
  tipo_cana text,
  data_queima date,
  observacao text,
  safra_label text not null,
  atualizado_em timestamptz not null default now()
);

-- Talhões de cada ordem — uma ordem pode abranger mais de uma fazenda, por
-- isso a chave é o par (fazenda_codigo, talhao) dentro da ordem, não só o
-- número do talhão.
create table if not exists talhoes (
  ordem_numero text not null references ordens(numero) on delete cascade,
  fazenda_codigo text not null,
  fazenda_nome text not null,
  talhao text not null,
  area_ha numeric not null default 0,
  -- área colhida lançada manualmente (medição de campo, parcial)
  area_colhida_ha numeric not null default 0,
  primary key (ordem_numero, fazenda_codigo, talhao)
);

-- Entradas diárias de cana por talhão — já agregadas das viagens de pesagem
-- na importação (uma linha por ordem+data+fazenda+talhao).
create table if not exists entradas_diarias (
  ordem_numero text not null references ordens(numero) on delete cascade,
  data date not null,
  fazenda_codigo text not null,
  talhao text not null,
  toneladas numeric not null default 0,
  -- parte de `toneladas` pesada entre 00:00 e 06:00 (coluna "Dia Atual")
  toneladas_ate_6h numeric not null default 0,
  viagens integer not null default 0,
  primary key (ordem_numero, data, fazenda_codigo, talhao)
);

-- Ordens marcadas manualmente para aparecer na tela — seleção GLOBAL,
-- visível a todo mundo que acessa o sistema (não é por usuário).
create table if not exists ordens_visiveis (
  ordem_numero text primary key references ordens(numero) on delete cascade
);

-- Metadados gerais (data/hora da última importação e da última atualização
-- da base) — tabela de uma linha só, sempre com id = true.
create table if not exists app_meta (
  id boolean primary key default true,
  ultima_importacao timestamptz,
  ultima_atualizacao timestamptz not null default now(),
  constraint app_meta_singleton check (id)
);
insert into app_meta (id) values (true) on conflict (id) do nothing;

-- Índices para os filtros/relatórios mais comuns da tela de Ordens de Corte
create index if not exists idx_ordens_frente on ordens(frente);
create index if not exists idx_ordens_status on ordens(status);
create index if not exists idx_entradas_data on entradas_diarias(data);
create index if not exists idx_entradas_ordem on entradas_diarias(ordem_numero);
create index if not exists idx_talhoes_ordem on talhoes(ordem_numero);
