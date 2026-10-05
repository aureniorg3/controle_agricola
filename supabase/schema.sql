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
--            de pesagem (frt_cor=frente correta lançada), eqp_frt=equipamento x frente,
--            cad_itm=cadastros importados (cad=cadastro, cod=código, nm=descrição, dds=colunas),
--            pes_viag=viagens da pesagem (ctl=controle, hsd=hora saída indústria),
--            saf_tlh=histórico de safras (por talhão), saf_cad=cadastro de safras,
--            app_met=metadados
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
  -- idem até 12:00 e até 18:00 (horário de corte do "dia atual" na tela)
  ton_ate_12h numeric not null default 0,
  ton_ate_18h numeric not null default 0,
  vgn integer not null default 0,
  primary key (ord_num, dt, faz_cod, tlh)
);

-- Viagens da pesagem, uma linha por Data Mov. + Liberação (ordem) + Controle.
-- A importação da pesagem é incremental: o arquivo novo substitui as viagens
-- de mesma chave e o histórico anterior permanece. `ent_dia` é reconstruída
-- a partir destas viagens (por ordem + data).
create table if not exists pes_viag (
  dt date not null,
  ord_num text not null,
  ctl text not null,
  faz_cod text not null default '-',
  tlh text not null default '',
  ton numeric not null default 0,
  hsd text not null default '',
  -- tara (kg); viagem com tara zerada não entra nas entradas diárias
  tara numeric,
  primary key (dt, ord_num, ctl)
);

-- Cadastros de apoio importados de planilhas (fazendas, solos, tipos de solo,
-- maturação, estados, fornecedores e prestadores, regiões, blocos, variedades).
-- Uma linha por item: cad = qual cadastro, cod = código, nm = descrição e
-- dds = todas as colunas da planilha (jsonb, pelo nome normalizado da coluna).
create table if not exists cad_itm (
  cad text not null,
  cod text not null,
  nm text not null default '',
  dds jsonb not null default '{}'::jsonb,
  atu_em timestamptz not null default now(),
  primary key (cad, cod)
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
  -- frente correta lançada pelo usuário (correção no sistema de origem)
  frt_cor text,
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

-- Histórico de safras: relatório "Rendimentos e Estimativas de Talhões" de cada
-- safra, uma linha por talhão (um talhão pode repetir com áreas parciais).
-- Reimportar uma safra substitui todas as linhas dela.
create table if not exists saf_tlh (
  saf integer not null,
  seq integer not null,
  faz_cod text not null,
  faz_nm text not null default '',
  prp_cod text not null default '',
  prp_nm text not null default '',
  mun text not null default '',
  uf text not null default '',
  tlh text not null,
  km numeric not null default 0,
  var_cod text not null default '',
  var_nm text not null default '',
  dt_col_ant date,
  dt_col date,
  dt_plt date,
  cor integer not null default 0,
  area_tot numeric not null default 0,
  area_plt numeric not null default 0,
  area_col numeric not null default 0,
  mt_lin numeric not null default 0,
  esp numeric not null default 0,
  prod_ant numeric not null default 0,
  tch_ant numeric not null default 0,
  prod_est numeric not null default 0,
  tch_est numeric not null default 0,
  prod_atu numeric not null default 0,
  tch_real numeric not null default 0,
  res numeric not null default 0,
  pct numeric not null default 0,
  ce text not null default '',
  primary key (saf, faz_cod, tlh, seq)
);

-- Cadastro de safras: tipo (AGR = agrícola, IND = industrial), período do ano e
-- período de produção. O período de produção delimita as pesagens/entradas de
-- cana usadas nos comparativos (contam a partir da data de início).
create table if not exists saf_cad (
  id text primary key,
  tp text not null check (tp in ('AGR', 'IND')),
  ano integer not null,
  ano_ini date not null,
  ano_fim date not null,
  prd_ini date not null,
  prd_fim date not null,
  cri_em timestamptz not null default now(),
  unique (tp, ano)
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
create index if not exists idx_saf_tlh_faz on saf_tlh(faz_cod, tlh);


-- ---------------------------------------------------------------------------
-- Rodadas de Campo
--   rod_cad = rodada (número + primeira segunda-feira); rod_sem = as 8 semanas
--   (segunda a domingo); rod_bol = boletim (cabeçalho: rodada, data, semana,
--   região, responsável, fazenda); rod_itm = linhas do boletim (ocorrência,
--   presença, nível, prioridade, talhão(es), recomendação). Ocorrência, presença,
--   nível e prioridade referenciam os cadastros em cad_itm pelo código.
-- ---------------------------------------------------------------------------
create table if not exists rod_cad (
  rod integer primary key,
  ini date not null,
  cri_em timestamptz not null default now()
);

create table if not exists rod_sem (
  rod integer not null,
  sem integer not null,
  ini date not null,
  fim date not null,
  primary key (rod, sem)
);

create table if not exists rod_bol (
  bol integer primary key,
  rod integer not null,
  dt date not null,
  sem integer not null default 0,
  reg text not null default '',
  resp text not null default '',
  faz text not null default '',
  ori text not null default 'apontamento',
  usr text not null default '',
  cri_em timestamptz not null default now()
);
create index if not exists idx_rod_bol_chave on rod_bol(rod, dt, reg, sem, faz);

create table if not exists rod_itm (
  id bigserial primary key,
  bol integer not null,
  seq integer not null default 1,
  oco text not null default '',
  oco_txt text not null default '',
  pre text not null default '',
  niv text not null default '',
  pri text not null default '',
  tlh text not null default '',
  area numeric,
  rec text not null default '',
  ext jsonb not null default '{}'::jsonb
);
create index if not exists idx_rod_itm_bol on rod_itm(bol);

-- Log de inclusões, alterações e exclusões de boletins das Rodadas de Campo:
-- quem fez (usr), quando (em) e o conteúdo do boletim antes e depois.
create table if not exists rod_log (
  id bigserial primary key,
  bol integer not null,
  acao text not null,
  usr text not null default '',
  em timestamptz not null default now(),
  antes jsonb,
  depois jsonb
);
create index if not exists idx_rod_log_bol on rod_log(bol, em);
