-- =====================================================================
-- Controle Agrícola — CRV Industrial
-- Schema para Supabase (Postgres) — nomes ABREVIADOS de tabelas e colunas.
--
-- Como rodar: painel do Supabase → SQL Editor → New query → cole este
-- arquivo inteiro → Run. Pode rodar de novo sem problema (todo comando usa
-- "if not exists"/"on conflict" — não apaga nem duplica nada já existente).
--
-- Bancos criados com os nomes por extenso (usuarios, ordens, talhoes...)
-- NÃO precisam rodar este arquivo: o próprio app renomeia tudo sozinho na
-- primeira conexão (lib/db.ts, migrarNomesAbreviados), preservando os dados.
--
-- Não cria o usuário administrador padrão aqui de propósito: o hash de
-- senha (scrypt, formato "salt:hash") é gerado pelo próprio app em
-- lib/auth.ts — a aplicação cria esse usuário sozinha na primeira consulta
-- se a tabela `usr` estiver vazia.
--
-- Legenda das abreviações
--   Tabelas: usr=usuários, ord=ordens, tlh=talhões, ent_dia=entradas diárias,
--            ord_vis=ordens visíveis, met_frt=metas por frente, conf_pes=conferência
--            de pesagem, eqp_frt=equipamento x frente, app_met=metadados
--   Colunas: nm=nome, snm=sobrenome, eml=e-mail, usr=usuário, sen_hsh=senha (hash),
--            prf=perfil, atv=ativo, prc_trc_sen=precisa trocar senha, cri_em=criado em,
--            atu_em=atualizado em, num=número, frt=frente, faz_cod/faz_nm=fazenda
--            código/nome, prp_cod/prp_nm=proprietário código/nome, sts=status,
--            tip_can=tipo de cana, dt_qma=data da queima, obs=observação,
--            saf_lbl=safra, tlh=talhão, area_col_ha=área colhida (ha),
--            ord_num=nº da ordem, dt=data, ton=toneladas, ton_ate_6h=toneladas
--            até 06h, vgn=viagens, met_dia_t=meta (t/dia), vig=vigência,
--            ult_imp=última importação, ult_atu=última atualização
-- =====================================================================

-- Usuários do sistema (login, perfis de acesso)
create table if not exists usr (
  id text primary key,
  nm text not null,
  snm text not null default '',
  eml text not null unique,
  usr text not null,
  sen_hsh text not null,
  prf text not null check (prf in ('leitura', 'gravacao', 'admin')),
  atv boolean not null default true,
  prc_trc_sen boolean not null default false,
  cri_em timestamptz not null default now()
);
create unique index if not exists idx_usr_usr_lower on usr (lower(usr));

-- Ordens de corte — 100% derivadas da importação das planilhas do CHBWEB
-- (nunca cadastradas nem editadas manualmente, exceto área colhida)
create table if not exists ord (
  num text primary key,
  frt text not null,
  faz_cod text not null,
  faz_nm text not null,
  prp_cod text,
  prp_nm text,
  sts text not null check (sts in ('Aberta', 'Encerrada')),
  tip_can text,
  dt_qma date,
  obs text,
  saf_lbl text not null,
  atu_em timestamptz not null default now()
);

-- Talhões de cada ordem — uma ordem pode abranger mais de uma fazenda, por
-- isso a chave é o par (faz_cod, tlh) dentro da ordem, não só o número do
-- talhão.
create table if not exists tlh (
  ord_num text not null references ord(num) on delete cascade,
  faz_cod text not null,
  faz_nm text not null,
  tlh text not null,
  area_ha numeric not null default 0,
  -- área colhida lançada manualmente (medição de campo, parcial)
  area_col_ha numeric not null default 0,
  primary key (ord_num, faz_cod, tlh)
);

-- Entradas diárias de cana por talhão — já agregadas das viagens de pesagem
-- na importação (uma linha por ordem+data+fazenda+talhão).
create table if not exists ent_dia (
  ord_num text not null references ord(num) on delete cascade,
  dt date not null,
  faz_cod text not null,
  tlh text not null,
  ton numeric not null default 0,
  -- parte de `ton` pesada entre 00:00 e 06:00 (coluna "Dia Atual")
  ton_ate_6h numeric not null default 0,
  vgn integer not null default 0,
  primary key (ord_num, dt, faz_cod, tlh)
);

-- Ordens marcadas manualmente para aparecer na tela — seleção GLOBAL,
-- visível a todo mundo que acessa o sistema (não é por usuário).
create table if not exists ord_vis (
  ord_num text primary key references ord(num) on delete cascade
);

-- Metas diárias por frente (t/dia). Cada meta vale a partir da data de
-- vigência até a próxima cadastrada pra mesma frente; dias anteriores à
-- primeira meta ficam sem meta.
create table if not exists met_frt (
  id text primary key,
  frt text not null,
  met_dia_t numeric not null check (met_dia_t >= 0),
  vig date not null,
  cri_em timestamptz not null default now(),
  unique (frt, vig)
);

-- Conferência de pesagem: toneladas por equipamento/frente/fazenda/dia, vindas
-- do "Relatório de Frentes por Especialidade". Reimportar um dia substitui o dia.
create table if not exists conf_pes (
  dt date not null,
  eqp text not null,
  eqp_nm text not null default '',
  frt text not null,
  faz_cod text not null,
  faz_nm text not null default '',
  ton numeric not null default 0,
  imp_em timestamptz not null default now(),
  primary key (dt, eqp, frt, faz_cod)
);

-- Em qual frente cada equipamento está, a partir de uma data (vigência).
create table if not exists eqp_frt (
  id text primary key,
  eqp text not null,
  frt text not null,
  vig date not null,
  cri_em timestamptz not null default now(),
  unique (eqp, vig)
);

-- Metadados gerais (data/hora da última importação e da última atualização
-- da base) — tabela de uma linha só, sempre com id = true.
create table if not exists app_met (
  id boolean primary key default true,
  ult_imp timestamptz,
  ult_atu timestamptz not null default now(),
  constraint app_met_singleton check (id)
);
insert into app_met (id) values (true) on conflict (id) do nothing;

-- Índices para os filtros/relatórios mais comuns da tela de Ordens de Corte
create index if not exists idx_ord_frt on ord(frt);
create index if not exists idx_ord_sts on ord(sts);
create index if not exists idx_ent_dia_dt on ent_dia(dt);
create index if not exists idx_ent_dia_ord on ent_dia(ord_num);
create index if not exists idx_tlh_ord on tlh(ord_num);
create index if not exists idx_conf_pes_dt on conf_pes(dt);
