import { getPool, prepararBanco } from "./db";
import { prepararDosagens } from "./db-dosagens";
import { prepararInsumos } from "./db-insumos";

/**
 * Validações do sistema: cruzam os dados entre os módulos e listam o que não
 * bate, com o que fazer para corrigir. Cada verificação é uma consulta que
 * devolve uma linha por divergência (as colunas já saem com o rótulo da tela).
 * Ao criar uma tela ou um cadastro novo, acrescente aqui as verificações que
 * garantem que os dados dele se encontram com os do resto do sistema.
 */

const AMOSTRA = 100;

/** cód numérico igual com ou sem zeros à esquerda (1 = 01) */
const IGUAL = (a, b) => `(${a} = ${b} OR (${a} ~ '^[0-9]+$' AND ${b} ~ '^[0-9]+$' AND ltrim(${a}, '0') = ltrim(${b}, '0')))`;

const CAD_FAZ = "SELECT 1 FROM cad_itm WHERE cad = 'fazendas'";

export const VERIFICACOES = [
  // ------------------------------------------------------------------ Colheita
  {
    id: "viagens-ordem-nao-cadastrada",
    modulo: "Colheita",
    titulo: "Viagens de pesagem de ordens que não estão cadastradas",
    severidade: "atencao",
    descricao:
      "A pesagem trouxe viagens com uma Liberação (ordem) que não existe no cadastro de Ordens de Corte; essas toneladas não aparecem em nenhuma tela.",
    acao: 'Importe o arquivo "Ordem de Colheita" que contém essas ordens. As viagens já estão guardadas e entram sozinhas quando a ordem for cadastrada.',
    sql: `SELECT v.ord_num AS "Ordem", to_char(v.dt, 'DD/MM/YYYY') AS "Data", COUNT(*)::int AS "Viagens", ROUND(SUM(v.ton), 2)::float AS "Toneladas (t)"
            FROM pes_viag v LEFT JOIN ord o ON o.num = v.ord_num
           WHERE o.num IS NULL GROUP BY v.ord_num, v.dt ORDER BY v.dt DESC, v.ord_num`,
  },
  {
    id: "entrada-talhao-fora-da-ordem",
    modulo: "Colheita",
    titulo: "Entradas de cana em talhão que não pertence à ordem",
    severidade: "erro",
    descricao: "Há toneladas lançadas para um talhão/fazenda que não está na lista de talhões da ordem, então não entram nos totais do talhão.",
    acao: 'Se a Fazenda aparece com o nome junto do código (ex.: "9427- FAZ. DOS BAÚS"), a entrada veio de uma importação antiga: importe de novo a pesagem dessas datas. Nos demais casos, confira se a viagem foi lançada na Liberação certa ou importe de novo a Ordem de Colheita para atualizar os talhões da ordem.',
    sql: `SELECT e.ord_num AS "Ordem", e.faz_cod AS "Fazenda", e.tlh AS "Talhão", COUNT(DISTINCT e.dt)::int AS "Dias", ROUND(SUM(e.ton), 2)::float AS "Toneladas (t)"
            FROM ent_dia e
           WHERE e.tlh NOT IN ('', '0')
             AND NOT EXISTS (SELECT 1 FROM tlh t WHERE t.ord_num = e.ord_num AND t.faz_cod = e.faz_cod AND t.tlh = e.tlh)
           GROUP BY e.ord_num, e.faz_cod, e.tlh ORDER BY SUM(e.ton) DESC`,
  },
  {
    id: "encerrada-entrada-sem-talhao",
    modulo: "Colheita",
    titulo: "Ordens encerradas com entrada sem talhão",
    severidade: "atencao",
    descricao:
      "Em ordem encerrada ainda há toneladas sem talhão (o movimento do dia não chegou a ser apropriado). A tela rateia essas toneladas por estimativa.",
    acao: "Quando o sistema de origem processar o movimento, importe de novo o relatório de pesagem desses dias para trazer o talhão real.",
    sql: `SELECT e.ord_num AS "Ordem", to_char(e.dt, 'DD/MM/YYYY') AS "Data", ROUND(SUM(e.ton), 2)::float AS "Toneladas (t)"
            FROM ent_dia e JOIN ord o ON o.num = e.ord_num
           WHERE o.sts = 'Encerrada' AND e.tlh IN ('', '0')
           GROUP BY e.ord_num, e.dt ORDER BY e.dt DESC, e.ord_num`,
  },
  {
    id: "ordem-sem-talhoes",
    modulo: "Colheita",
    titulo: "Ordens sem nenhum talhão cadastrado",
    severidade: "erro",
    descricao: "A ordem não tem talhões, então não há área nem como distribuir a produção.",
    acao: 'Importe de novo o arquivo "Ordem de Colheita" (a ordem precisa vir com a lista de talhões).',
    sql: `SELECT o.num AS "Ordem", o.frt AS "Frente", o.faz_cod AS "Fazenda", o.sts AS "Status"
            FROM ord o WHERE NOT EXISTS (SELECT 1 FROM tlh t WHERE t.ord_num = o.num) ORDER BY o.num`,
  },
  {
    id: "area-colhida-maior",
    modulo: "Colheita",
    titulo: "Área colhida maior que a área do talhão",
    severidade: "erro",
    descricao: "A área colhida lançada à mão passa da área total do talhão na ordem.",
    acao: 'Corrija em Ordens de Corte → "Lançar área colhida" do card da ordem.',
    sql: `SELECT t.ord_num AS "Ordem", t.faz_cod AS "Fazenda", t.tlh AS "Talhão", t.area_ha::float AS "Área (ha)", t.area_col_ha::float AS "Área colhida (ha)"
            FROM tlh t WHERE t.area_col_ha > t.area_ha + 0.005 ORDER BY t.ord_num, t.tlh`,
  },
  {
    id: "area-colhida-dia-maior",
    modulo: "Colheita",
    titulo: "Área colhida apontada dia a dia maior que a área do talhão",
    severidade: "erro",
    descricao: "O saldo anterior mais os apontamentos diários do talhão passam da área total dele.",
    acao: "Em Ordens de Corte → aba Apontamento · Área colhida, corrija os lançamentos do talhão.",
    sql: `SELECT t.ord_num AS "Ordem", t.faz_cod AS "Fazenda", t.tlh AS "Talhão", t.area_ha::float AS "Área (ha)", ROUND(t.area_col_ha + c.s, 2)::float AS "Colhida acumulada (ha)"
            FROM tlh t JOIN (SELECT ord_num, faz_cod, tlh, SUM(area) AS s FROM col_dia GROUP BY ord_num, faz_cod, tlh) c
              ON c.ord_num = t.ord_num AND c.faz_cod = t.faz_cod AND c.tlh = t.tlh
           WHERE t.area_col_ha + c.s > t.area_ha + 0.01 ORDER BY t.ord_num, t.tlh`,
  },
  {
    id: "area-colhida-dia-ordem-inexistente",
    modulo: "Colheita",
    titulo: "Apontamentos de área colhida de talhão que não existe mais na ordem",
    severidade: "atencao",
    descricao: "Há área colhida apontada para um talhão que saiu da ordem (nova importação da Ordem de Colheita).",
    acao: "Confira a ordem; se o talhão foi retirado de propósito, os apontamentos antigos podem ser ignorados.",
    sql: `SELECT c.ord_num AS "Ordem", c.faz_cod AS "Fazenda", c.tlh AS "Talhão", COUNT(*)::int AS "Dias", ROUND(SUM(c.area), 2)::float AS "Área (ha)"
            FROM col_dia c WHERE NOT EXISTS (SELECT 1 FROM tlh t WHERE t.ord_num = c.ord_num AND t.faz_cod = c.faz_cod AND t.tlh = c.tlh)
           GROUP BY c.ord_num, c.faz_cod, c.tlh ORDER BY c.ord_num, c.tlh`,
  },
  {
    id: "diferenca-viagens-entradas",
    modulo: "Colheita",
    titulo: "Entradas diárias diferentes da soma das viagens",
    severidade: "erro",
    descricao: "Para a mesma ordem e dia, o total das entradas não bate com a soma das viagens de pesagem (que contam só viagens com tara).",
    acao: "Importe de novo o relatório de pesagem do período: as entradas são refeitas a partir das viagens.",
    sql: `SELECT e.ord_num AS "Ordem", to_char(e.dt, 'DD/MM/YYYY') AS "Data", e.t::float AS "Entradas (t)", v.t::float AS "Viagens (t)", ROUND(e.t - v.t, 2)::float AS "Diferença (t)"
            FROM (SELECT ord_num, dt, ROUND(SUM(ton), 2) AS t FROM ent_dia GROUP BY ord_num, dt) e
            JOIN (SELECT ord_num, dt, ROUND(COALESCE(SUM(ton) FILTER (WHERE tara IS NULL OR tara > 0), 0), 2) AS t FROM pes_viag GROUP BY ord_num, dt) v
              ON v.ord_num = e.ord_num AND v.dt = e.dt
           WHERE ABS(e.t - v.t) > 0.05 ORDER BY e.dt DESC, e.ord_num`,
  },
  {
    id: "viagens-tara-zero",
    modulo: "Colheita",
    titulo: "Viagens com tara zerada (não contabilizadas)",
    severidade: "atencao",
    descricao: "Viagens sem tara lançada ficam guardadas mas não entram nas entradas de cana (nem nos cortes de 06h, 12h, 18h e 00h).",
    acao: "Lance a tara no sistema de origem e importe de novo o relatório de pesagem desses dias.",
    sql: `SELECT to_char(dt, 'DD/MM/YYYY') AS "Data", ord_num AS "Ordem", COUNT(*)::int AS "Viagens", ROUND(SUM(ton), 2)::float AS "Peso líquido (t)"
            FROM pes_viag WHERE tara = 0 GROUP BY dt, ord_num ORDER BY dt DESC, ord_num`,
  },
  {
    id: "viagens-sem-tara-registrada",
    modulo: "Colheita",
    titulo: "Viagens importadas antes do controle de tara",
    severidade: "info",
    descricao:
      "Estas viagens foram importadas quando o sistema ainda não guardava a tara; contam normalmente, mas não dá para saber se algum peso estava sem tara.",
    acao: "Importe de novo os relatórios de pesagem do período para registrar a tara de cada viagem.",
    sql: `SELECT to_char(dt, 'MM/YYYY') AS "Mês", COUNT(*)::int AS "Viagens", ROUND(SUM(ton), 2)::float AS "Toneladas (t)"
            FROM pes_viag WHERE tara IS NULL GROUP BY to_char(dt, 'MM/YYYY'), date_trunc('month', dt) ORDER BY date_trunc('month', dt)`,
  },
  {
    id: "dias-sem-pesagem",
    modulo: "Colheita",
    titulo: "Dias sem pesagem dentro do período de produção da safra",
    severidade: "atencao",
    descricao: "Datas entre o início da produção (Cadastros → Safras) e ontem sem nenhuma entrada de cana.",
    acao: "Confirme se a usina parou nesses dias. Se houve moagem, importe o relatório de pesagem das datas.",
    sql: `WITH s AS (
            SELECT prd_ini, prd_fim FROM saf_cad ORDER BY CASE tp WHEN 'IND' THEN 0 ELSE 1 END, ano DESC LIMIT 1)
          SELECT to_char(d::date, 'DD/MM/YYYY') AS "Data"
            FROM s, generate_series(s.prd_ini, LEAST(s.prd_fim, current_date - 1), interval '1 day') d
           WHERE NOT EXISTS (SELECT 1 FROM ent_dia e WHERE e.dt = d::date AND e.ton > 0) ORDER BY d::date`,
  },
  {
    id: "frente-sem-meta",
    modulo: "Colheita",
    titulo: "Frentes com cana entregue e sem meta cadastrada",
    severidade: "atencao",
    descricao: "A frente tem entradas de cana mas nenhuma meta; os percentuais de meta ficam em branco.",
    acao: "Cadastre ou importe as metas da frente em Acompanhamentos → Colheita → Metas.",
    sql: `SELECT o.frt AS "Frente", COUNT(DISTINCT o.num)::int AS "Ordens", ROUND(SUM(e.ton), 2)::float AS "Toneladas (t)"
            FROM ord o JOIN ent_dia e ON e.ord_num = o.num
           WHERE NOT EXISTS (SELECT 1 FROM met_frt m WHERE m.frt = o.frt) GROUP BY o.frt ORDER BY o.frt`,
  },
  {
    id: "meta-frente-desconhecida",
    modulo: "Colheita",
    titulo: "Metas de frentes que não existem nas ordens",
    severidade: "atencao",
    descricao: "Há meta cadastrada para um nome de frente que não aparece em nenhuma ordem (provável diferença de nome).",
    acao: "Corrija o nome da frente na meta para ficar igual ao das Ordens de Corte, ou exclua a meta.",
    sql: `SELECT m.frt AS "Frente", COUNT(*)::int AS "Metas", to_char(MIN(m.vig), 'DD/MM/YYYY') AS "Primeira vigência"
            FROM met_frt m WHERE NOT EXISTS (SELECT 1 FROM ord o WHERE o.frt = m.frt) GROUP BY m.frt ORDER BY m.frt`,
  },
  {
    id: "ordem-com-entrada-nao-exibida",
    modulo: "Colheita",
    titulo: "Ordens com cana entregue que não estão marcadas para aparecer nos cards",
    severidade: "info",
    descricao:
      "A produção destas ordens entra nos resumos e nos totais do dia, mas o card da ordem não aparece em Ordens de Corte (ela não foi inserida na tela).",
    acao: 'Em Ordens de Corte, use "Inserir Ordem" para incluir a ordem nos cards, se quiser acompanhá-la lá.',
    sql: `SELECT o.num AS "Ordem", o.frt AS "Frente", o.sts AS "Status", COUNT(DISTINCT e.dt)::int AS "Dias com entrada", ROUND(SUM(e.ton), 2)::float AS "Toneladas (t)"
            FROM ord o JOIN ent_dia e ON e.ord_num = o.num
           WHERE o.sts = 'Aberta' AND NOT EXISTS (SELECT 1 FROM ord_vis v WHERE v.ord_num = o.num)
           GROUP BY o.num, o.frt, o.sts ORDER BY o.num`,
  },
  {
    id: "ordem-fazenda-sem-cadastro",
    modulo: "Colheita",
    titulo: "Fazenda das ordens que não está no Cadastro de Fazenda",
    severidade: "atencao",
    descricao: "O código da fazenda da ordem não existe em Configurações → Cadastros → Fazenda.",
    acao: "Importe ou cadastre a fazenda no Cadastro de Fazenda.",
    sql: `SELECT t.faz_cod AS "Fazenda", MAX(t.faz_nm) AS "Descrição Fazenda", COUNT(DISTINCT t.ord_num)::int AS "Ordens"
            FROM tlh t
           WHERE EXISTS (${CAD_FAZ})
             AND NOT EXISTS (SELECT 1 FROM cad_itm c WHERE c.cad = 'fazendas' AND (c.cod = t.faz_cod OR c.cod LIKE t.faz_cod || '-%'))
           GROUP BY t.faz_cod ORDER BY t.faz_cod`,
  },
  {
    id: "talhao-sem-tch-estimado",
    modulo: "Colheita",
    titulo: "Talhões de ordens abertas sem TCH estimado",
    severidade: "info",
    descricao: "O talhão da ordem aberta não tem produção estimada no histórico de safras; o rateio usa a área e a média da ordem.",
    acao: "Importe o arquivo SF da safra atual completo em Histórico de Safras.",
    sql: `SELECT t.ord_num AS "Ordem", t.faz_cod AS "Fazenda", t.tlh AS "Talhão", t.area_ha::float AS "Área (ha)"
            FROM tlh t JOIN ord o ON o.num = t.ord_num
           WHERE o.sts = 'Aberta'
             AND NOT EXISTS (SELECT 1 FROM saf_tlh s WHERE s.faz_cod = t.faz_cod AND s.tlh = t.tlh
                              AND s.saf = (SELECT MAX(saf) FROM saf_tlh) AND s.prod_est > 0)
           ORDER BY t.ord_num, t.tlh`,
  },

  // ---------------------------------------------------------- Rodadas de Campo
  {
    id: "rodadas-cadastros-vazios",
    modulo: "Rodadas de Campo",
    titulo: "Cadastros de apoio vazios",
    severidade: "atencao",
    descricao: "O Apontamento confere os códigos nestes cadastros; vazios, ele aceita qualquer código e não mostra descrição.",
    acao: "Importe ou cadastre os itens (Configurações → Cadastros e menu Rodadas de Campo).",
    sql: `SELECT t.titulo AS "Cadastro"
            FROM (VALUES ('regiao','Região'),('fazendas','Fazenda'),('ocorrencias','Ocorrências'),('nivel-infestacao','Nível de Infestação'),
                         ('presenca-infestacao','Presença de Infestação'),('prioridade','Prioridade'),('responsavel-regiao','Responsável Região')) AS t(cad, titulo)
           WHERE NOT EXISTS (SELECT 1 FROM cad_itm c WHERE c.cad = t.cad) ORDER BY t.titulo`,
  },
  {
    id: "boletim-fazenda-sem-cadastro",
    modulo: "Rodadas de Campo",
    titulo: "Boletins com fazenda que não está no Cadastro de Fazenda",
    severidade: "atencao",
    descricao: "O código da fazenda do boletim não existe no Cadastro de Fazenda, então o Resumo não mostra o nome.",
    acao: "Importe/cadastre a fazenda em Configurações → Cadastros → Fazenda, ou corrija o código no boletim.",
    sql: `SELECT b.faz AS "Fazenda", COUNT(*)::int AS "Boletins"
            FROM rod_bol b
           WHERE EXISTS (${CAD_FAZ})
             AND NOT EXISTS (SELECT 1 FROM cad_itm c WHERE c.cad = 'fazendas' AND (c.cod = b.faz OR c.cod LIKE b.faz || '-%'))
           GROUP BY b.faz ORDER BY b.faz`,
  },
  {
    id: "boletim-regiao-sem-cadastro",
    modulo: "Rodadas de Campo",
    titulo: "Boletins com região que não está no cadastro de Região",
    severidade: "atencao",
    descricao: "O código da região do boletim não existe no cadastro de Região.",
    acao: "Cadastre a região em Configurações → Cadastros → Região.",
    sql: `SELECT b.reg AS "Região", COUNT(*)::int AS "Boletins"
            FROM rod_bol b
           WHERE b.reg <> '' AND EXISTS (SELECT 1 FROM cad_itm WHERE cad = 'regiao')
             AND NOT EXISTS (SELECT 1 FROM cad_itm c WHERE c.cad = 'regiao' AND ${IGUAL("c.cod", "b.reg")})
           GROUP BY b.reg ORDER BY b.reg`,
  },
  {
    id: "regiao-sem-responsavel",
    modulo: "Rodadas de Campo",
    titulo: "Regiões usadas em boletins sem responsável cadastrado",
    severidade: "atencao",
    descricao: "Nenhum item de Responsável Região aponta para a região, então novos lançamentos ficam sem responsável.",
    acao: "Cadastre o responsável da região em Rodadas de Campo → Responsável Região.",
    sql: `SELECT b.reg AS "Região", COUNT(*)::int AS "Boletins"
            FROM rod_bol b
           WHERE b.reg <> ''
             AND NOT EXISTS (SELECT 1 FROM cad_itm c WHERE c.cad = 'responsavel-regiao' AND c.dds->>'regiao' IS NOT NULL AND ${IGUAL("c.dds->>'regiao'", "b.reg")})
           GROUP BY b.reg ORDER BY b.reg`,
  },
  {
    id: "responsavel-regiao-invalida",
    modulo: "Rodadas de Campo",
    titulo: "Responsável Região apontando para região inexistente",
    severidade: "atencao",
    descricao: "O código da região do responsável não existe no cadastro de Região.",
    acao: "Edite o item em Responsável Região e escolha uma região do cadastro.",
    sql: `SELECT c.cod AS "Código", c.nm AS "Responsável", c.dds->>'regiao' AS "Região informada"
            FROM cad_itm c
           WHERE c.cad = 'responsavel-regiao' AND EXISTS (SELECT 1 FROM cad_itm WHERE cad = 'regiao')
             AND NOT EXISTS (SELECT 1 FROM cad_itm r WHERE r.cad = 'regiao' AND ${IGUAL("r.cod", "COALESCE(c.dds->>'regiao', '')")})
           ORDER BY c.cod`,
  },
  {
    id: "bloco-sem-regiao",
    modulo: "Cadastros",
    titulo: "Blocos sem região informada",
    severidade: "info",
    descricao: "O bloco não tem região escolhida, então não dá para agrupar por região.",
    acao: "Abra Configurações → Cadastros → Bloco, edite o item e escolha a região (ou importe a planilha com a coluna Região).",
    sql: `SELECT c.dds->>'setor' AS "Setor", c.dds->>'descricao' AS "Descrição"
            FROM cad_itm c WHERE c.cad = 'bloco' AND COALESCE(c.dds->>'regiao', '') = '' ORDER BY 1, 2`,
  },
  {
    id: "bloco-regiao-invalida",
    modulo: "Cadastros",
    titulo: "Blocos com região que não existe no cadastro de Região",
    severidade: "atencao",
    descricao: "O código da região do bloco não está no cadastro de Região.",
    acao: "Edite o bloco e escolha uma região do cadastro, ou cadastre a região que falta.",
    sql: `SELECT c.dds->>'setor' AS "Setor", c.dds->>'descricao' AS "Descrição", c.dds->>'regiao' AS "Região informada"
            FROM cad_itm c
           WHERE c.cad = 'bloco' AND COALESCE(c.dds->>'regiao', '') <> '' AND EXISTS (SELECT 1 FROM cad_itm WHERE cad = 'regiao')
             AND NOT EXISTS (SELECT 1 FROM cad_itm r WHERE r.cad = 'regiao' AND ${IGUAL("r.cod", "(c.dds->>'regiao')")})
           ORDER BY 1, 2`,
  },
  {
    id: "grupo-operacao-fora-do-cadastro",
    modulo: "Cadastros",
    titulo: "Operações com grupo que não está no cadastro Grupo Op. Dashboard",
    severidade: "atencao",
    descricao:
      "Em Grupos de Operações, o grupo da operação não é um código do cadastro Grupo Op. Dashboard, então no Dashboard de Atividades a operação aparece em Outras operações.",
    acao: "Cadastre o grupo em Configurações → Cadastros → Grupo Op. Dashboard (as operações com o mesmo nome de grupo passam para ele ao salvar) ou escolha o grupo da operação em Grupos de Operações.",
    sql: `SELECT c.cod AS "Operação", c.dds->>'operacao_nm' AS "Descrição", c.dds->>'grupo' AS "Grupo informado"
            FROM cad_itm c
           WHERE c.cad = 'grupos-operacoes' AND COALESCE(c.dds->>'grupo', '') <> ''
             AND NOT EXISTS (SELECT 1 FROM cad_itm g WHERE g.cad = 'grupos-dashboard' AND ${IGUAL("g.cod", "(c.dds->>'grupo')")})
           ORDER BY 1`,
  },
  {
    id: "operacao-tipo-fora-do-cadastro",
    modulo: "Cadastros",
    titulo: "Operações com tipo que não está no cadastro Tipo Operação",
    severidade: "info",
    descricao: "O Tipo da operação (cadastro Operações) não está no cadastro Tipo Operação, então a descrição do tipo não aparece na lista de Operações.",
    acao: "Cadastre o tipo em Configurações → Cadastros → Tipo Operação, com o código igual ao da coluna Tipo das Operações (ex.: D, P).",
    sql: `SELECT o.dds->>'tipo' AS "Tipo informado", COUNT(*)::int AS "Operações"
            FROM cad_itm o
           WHERE o.cad = 'operacoes' AND COALESCE(o.dds->>'tipo', '') <> ''
             AND NOT EXISTS (SELECT 1 FROM cad_itm t WHERE t.cad = 'tipos-operacao' AND ${IGUAL("t.cod", "(o.dds->>'tipo')")})
           GROUP BY 1 ORDER BY 1`,
  },
  {
    id: "boletim-rodada-sem-calendario",
    modulo: "Rodadas de Campo",
    titulo: "Boletins de rodada sem calendário cadastrado",
    severidade: "erro",
    descricao: "O boletim usa uma rodada que não existe em Cadastro de Rodadas.",
    acao: "Cadastre a rodada (ou corrija o número) em Rodadas de Campo → Cadastro de Rodadas.",
    sql: `SELECT b.rod AS "Rodada", COUNT(*)::int AS "Boletins"
            FROM rod_bol b WHERE NOT EXISTS (SELECT 1 FROM rod_cad c WHERE c.rod = b.rod) GROUP BY b.rod ORDER BY b.rod`,
  },
  {
    id: "boletim-semana-inexistente",
    modulo: "Rodadas de Campo",
    titulo: "Boletins com semana que não existe na rodada",
    severidade: "erro",
    descricao: "A semana do boletim não está no calendário da rodada.",
    acao: "Ajuste o calendário em Cadastro de Rodadas → Editar, ou corrija a semana do boletim.",
    sql: `SELECT b.rod AS "Rodada", b.sem AS "Semana", COUNT(*)::int AS "Boletins"
            FROM rod_bol b
           WHERE EXISTS (SELECT 1 FROM rod_cad c WHERE c.rod = b.rod)
             AND NOT EXISTS (SELECT 1 FROM rod_sem s WHERE s.rod = b.rod AND s.sem = b.sem)
           GROUP BY b.rod, b.sem ORDER BY b.rod, b.sem`,
  },
  {
    id: "rodada-menos-8-semanas",
    modulo: "Rodadas de Campo",
    titulo: "Rodadas com menos de 8 semanas",
    severidade: "info",
    descricao: "Toda rodada deve ter 8 semanas.",
    acao: "Abra Cadastro de Rodadas → Editar e complete o calendário.",
    sql: `SELECT c.rod AS "Rodada", COUNT(s.sem)::int AS "Semanas"
            FROM rod_cad c LEFT JOIN rod_sem s ON s.rod = c.rod GROUP BY c.rod HAVING COUNT(s.sem) < 8 ORDER BY c.rod`,
  },
  {
    id: "boletim-sem-linhas",
    modulo: "Rodadas de Campo",
    titulo: "Boletins sem nenhuma linha",
    severidade: "erro",
    descricao: "O boletim existe mas não tem ocorrência nem talhão lançados.",
    acao: "Relance o boletim no Apontamento (ou reimporte o levantamento).",
    sql: `SELECT b.bol AS "Boletim", b.rod AS "Rodada", b.sem AS "Semana", b.faz AS "Fazenda"
            FROM rod_bol b WHERE NOT EXISTS (SELECT 1 FROM rod_itm i WHERE i.bol = b.bol) ORDER BY b.bol`,
  },
  {
    id: "boletim-ocorrencia-sem-codigo",
    modulo: "Rodadas de Campo",
    titulo: "Linhas de boletim com ocorrência só em texto (sem código)",
    severidade: "info",
    descricao: "Linhas importadas da planilha trazem a ocorrência como texto livre, sem ligação com o Cadastro de Ocorrências.",
    acao: "Padronize no Cadastro de Ocorrências as descrições mais frequentes. Os novos lançamentos já usam o código.",
    sql: `SELECT i.oco_txt AS "Ocorrência (texto)", COUNT(*)::int AS "Linhas"
            FROM rod_itm i JOIN rod_bol b ON b.bol = i.bol
           WHERE b.ori = 'importacao' AND i.oco = '' AND i.oco_txt <> '' GROUP BY i.oco_txt ORDER BY COUNT(*) DESC, i.oco_txt`,
  },
  {
    id: "boletim-ocorrencia-codigo-inexistente",
    modulo: "Rodadas de Campo",
    titulo: "Boletins com código de ocorrência que não existe mais no cadastro",
    severidade: "atencao",
    descricao: "Um código de ocorrência usado no boletim foi excluído ou alterado no Cadastro de Ocorrências.",
    acao: "Recadastre o código no Cadastro de Ocorrências.",
    sql: `SELECT trim(u.cod) AS "Código", COUNT(*)::int AS "Linhas"
            FROM rod_itm i, unnest(string_to_array(i.oco, ',')) AS u(cod)
           WHERE i.oco <> '' AND NOT EXISTS (SELECT 1 FROM cad_itm c WHERE c.cad = 'ocorrencias' AND c.cod = trim(u.cod))
           GROUP BY trim(u.cod) ORDER BY trim(u.cod)`,
  },
  {
    id: "boletim-talhao-fora-do-cadastro",
    modulo: "Rodadas de Campo",
    titulo: "Talhões de boletim que não existem no cadastro de talhões da fazenda",
    severidade: "atencao",
    descricao: "O talhão lançado no boletim não está no cadastro de talhões da safra para aquela fazenda (a fazenda tem talhões cadastrados, mas não este).",
    acao: "Confira o número do talhão no boletim ou atualize o cadastro de talhões (Histórico de Safras).",
    sql: `SELECT b.faz AS "Fazenda", i.tlh AS "Talhão", COUNT(*)::int AS "Linhas"
            FROM rod_itm i JOIN rod_bol b ON b.bol = i.bol
           WHERE i.tlh ~ '^[0-9]+$'
             AND EXISTS (SELECT 1 FROM saf_tlh s WHERE s.faz_cod = split_part(b.faz, '-', 1))
             AND NOT EXISTS (SELECT 1 FROM saf_tlh s WHERE s.faz_cod = split_part(b.faz, '-', 1) AND s.tlh = i.tlh)
           GROUP BY b.faz, i.tlh ORDER BY b.faz, i.tlh::bigint`,
  },
  {
    id: "boletim-fazenda-sem-talhoes",
    modulo: "Rodadas de Campo",
    titulo: "Fazenda de boletim sem talhões no cadastro de safra",
    severidade: "info",
    descricao: "A fazenda não tem talhões no histórico de safras, então o Apontamento não consegue listar os talhões para marcar.",
    acao: "Importe o cadastro de talhões da safra (Histórico de Safras).",
    sql: `SELECT split_part(b.faz, '-', 1) AS "Fazenda", COUNT(*)::int AS "Boletins"
            FROM rod_bol b
           WHERE NOT EXISTS (SELECT 1 FROM saf_tlh s WHERE s.faz_cod = split_part(b.faz, '-', 1)) AND NOT EXISTS (SELECT 1 FROM tlh t WHERE t.faz_cod = split_part(b.faz, '-', 1))
           GROUP BY split_part(b.faz, '-', 1) ORDER BY 1`,
  },
  {
    id: "boletim-repetido-na-semana",
    modulo: "Rodadas de Campo",
    titulo: "Fazenda com mais de um boletim na mesma semana da rodada",
    severidade: "info",
    descricao: "A mesma fazenda aparece em mais de um boletim na mesma rodada e semana (pode ser lançamento em duplicidade).",
    acao: "Confira no Resumo se são vistorias diferentes; se for duplicidade, remova um dos boletins.",
    sql: `SELECT b.rod AS "Rodada", b.sem AS "Semana", b.faz AS "Fazenda", COUNT(*)::int AS "Boletins", string_agg(b.bol::text, ', ' ORDER BY b.bol) AS "Números"
            FROM rod_bol b GROUP BY b.rod, b.sem, b.faz HAVING COUNT(*) > 1 ORDER BY b.rod, b.sem, b.faz`,
  },
  // ------------------------------------------------------------------ Insumos
  {
    id: "dosagem-fora-do-cadastro",
    modulo: "Insumos",
    titulo: "Dosagens de insumos que não estão no cadastro Material e Insumos",
    severidade: "atencao",
    descricao: "O código da dosagem não existe no cadastro Material e Insumos, então a descrição e a unidade de medida não aparecem.",
    acao: "Importe o cadastro atualizado em Configurações → Cadastros → Material e Insumos, ou exclua a dosagem em Insumos → Dosagens e lance de novo com o código certo.",
    sql: `SELECT d.cod AS "Código", d.dmin::float AS "Dosagem mínima", d.dmax::float AS "Dosagem máxima", d.usr AS "Lançado por"
            FROM ins_dos d
           WHERE EXISTS (SELECT 1 FROM cad_itm WHERE cad = 'materiais-insumos')
             AND NOT EXISTS (SELECT 1 FROM cad_itm c WHERE c.cad = 'materiais-insumos' AND c.cod = d.cod)
           ORDER BY d.cod`,
  },
  {
    id: "saldo-sem-dosagem",
    modulo: "Insumos",
    titulo: "Insumos com saldo e sem dosagem cadastrada",
    severidade: "info",
    descricao: "O insumo está no último saldo importado (depósitos 207 e 401) mas ainda não tem dosagem mínima e máxima.",
    acao: "Lance a dosagem em Insumos → Dosagens. Se o insumo não é aplicado por hectare (ex.: diluente), pode ignorar.",
    sql: `SELECT s.cod AS "Código", i.ds AS "Descrição", i.un AS "U.M.", ROUND(SUM(s.saldo), 3)::float AS "Saldo (último retrato)"
            FROM ins_sld s JOIN ins_itm i ON i.cod = s.cod
           WHERE s.dt = (SELECT MAX(dt) FROM ins_sld) AND s.almx IN (207, 401) AND s.saldo > 0
             AND NOT EXISTS (SELECT 1 FROM ins_dos d WHERE d.cod = s.cod)
           GROUP BY s.cod, i.ds, i.un ORDER BY i.ds`,
  },
];

async function executar(v) {
  const pool = getPool();
  const base = { id: v.id, modulo: v.modulo, titulo: v.titulo, severidade: v.severidade, descricao: v.descricao, acao: v.acao };
  try {
    const { rows: cont } = await pool.query(`SELECT COUNT(*)::int AS n FROM (${v.sql}) q`);
    const total = cont[0].n;
    if (total === 0) return { ...base, total: 0, colunas: [], linhas: [] };
    const { rows } = await pool.query(`SELECT * FROM (${v.sql}) q LIMIT ${AMOSTRA}`);
    return { ...base, total, colunas: Object.keys(rows[0] ?? {}), linhas: rows };
  } catch (e) {
    return { ...base, total: 0, colunas: [], linhas: [], erroExecucao: e instanceof Error ? e.message : String(e) };
  }
}

export async function executarValidacoes() {
  const pool = getPool();
  await prepararBanco(pool);
  // tabelas dos módulos que se criam sob demanda precisam existir para as verificações rodarem
  await Promise.all([prepararInsumos(pool), prepararDosagens(pool)]);
  const verificacoes = [];
  for (const v of VERIFICACOES) verificacoes.push(await executar(v));
  return { executadoEm: new Date().toISOString(), verificacoes };
}
