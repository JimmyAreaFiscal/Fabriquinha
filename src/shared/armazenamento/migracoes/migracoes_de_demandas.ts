// A migração 51, de Demandas (MELHORIAS §5.1.6 e §12): a situação administrativa do pedido ganha coluna própria em
// `demanda`, derivada do estado e do envio gravados até a versão 50. É aditiva: nenhuma coluna sai, e as demais colunas
// das linhas existentes não mudam, então a demanda em andamento continua de onde estava.

/** A situação que o estado do desenvolvimento e o envio gravados implicam; a arquivada, para Demandas, está concluída. */
const SITUACAO_IMPLICADA_PELO_ESTADO_GRAVADO = `CASE
    WHEN estado IN ('concluida', 'arquivada') THEN 'concluido'
    WHEN estado = 'cancelada' THEN 'cancelado'
    WHEN enviada = 1 THEN 'enviado'
    ELSE 'rascunho' END`;

const MIGRACAO_51_SITUACAO_DO_PEDIDO = `
ALTER TABLE demanda ADD COLUMN situacao TEXT NOT NULL DEFAULT 'rascunho'
  CHECK (situacao IN ('rascunho', 'enviado', 'cancelado', 'concluido'));
UPDATE demanda SET situacao = ${SITUACAO_IMPLICADA_PELO_ESTADO_GRAVADO};
`;

// A migração 53, de Demandas: a linha da `demanda` fica só com o pedido. O estado do desenvolvimento passou à tabela do
// Processo na 52; as colunas dele aqui (estado, instante da mudança e branch) deixam de ser obrigatórias e ficam sem uso,
// com os valores que tinham, para o pedido novo nascer sem elas. É uma recriação da tabela que guarda todas as colunas e
// linhas: nada se apaga.
const MIGRACAO_53_DEMANDA_SO_COM_O_PEDIDO = `
CREATE TABLE demanda_nova (
    id                    TEXT PRIMARY KEY,
    projeto               TEXT NOT NULL REFERENCES projeto(nome),
    titulo                TEXT NOT NULL,
    tipo                  TEXT NOT NULL CHECK (tipo IN ('funcionalidade','problema')),
    descricao             TEXT NOT NULL,
    estado                TEXT CHECK (estado IN ('entender_e_desenhar','gate_demanda','planejar','gate_planejamento','em_execucao','revisar_demanda','encerrar_demanda','concluida','arquivada','cancelada')),
    estado_alterado_em    TEXT,
    criada_por_ferramenta TEXT NOT NULL,
    criada_por_sessao     TEXT NOT NULL,
    enviada               INTEGER NOT NULL CHECK (enviada IN (0,1)),
    branch                TEXT,
    situacao              TEXT NOT NULL DEFAULT 'rascunho' CHECK (situacao IN ('rascunho', 'enviado', 'cancelado', 'concluido'))
  );
INSERT INTO demanda_nova (id, projeto, titulo, tipo, descricao, estado, estado_alterado_em, criada_por_ferramenta,
                          criada_por_sessao, enviada, branch, situacao)
  SELECT id, projeto, titulo, tipo, descricao, estado, estado_alterado_em, criada_por_ferramenta, criada_por_sessao,
         enviada, branch, situacao
  FROM demanda ORDER BY rowid;
DROP TABLE demanda;
ALTER TABLE demanda_nova RENAME TO demanda;
`;

// A migração 58, de Demandas: o projeto aponta os arquivos de dependências (lista em JSON) no lugar da imagem do Ambiente.
// O `Dockerfile` do repositório passa a `package.json`, o arquivo equivalente; o nome de imagem publicada não tem
// equivalente, e esse projeto volta a rodar no host local.
const MIGRACAO_58_ARQUIVOS_DE_DEPENDENCIAS = `
ALTER TABLE projeto ADD COLUMN arquivos_de_dependencias TEXT CHECK (arquivos_de_dependencias IS NULL OR json_valid(arquivos_de_dependencias));
UPDATE projeto SET arquivos_de_dependencias = '["package.json"]' WHERE imagem_do_ambiente = 'Dockerfile';
ALTER TABLE projeto DROP COLUMN imagem_do_ambiente;
`;

// A migração 59, de Demandas: a instalação das dependências ganha lista própria, `comando_instalacao_projeto`, e o comando
// `npm ci` (igualdade exata, depois do trim) sai da preparação para ela. Os demais comandos da preparação mantêm a ordem.
const MIGRACAO_59_COMANDO_DE_INSTALACAO = `
CREATE TABLE comando_instalacao_projeto (
    projeto TEXT NOT NULL REFERENCES projeto(nome) ON DELETE CASCADE,
    ordem   INTEGER NOT NULL CHECK (typeof(ordem) = 'integer' AND ordem > 0),
    comando TEXT NOT NULL CHECK (length(comando) > 0),
    PRIMARY KEY (projeto, ordem)
  );
INSERT INTO comando_instalacao_projeto (projeto, ordem, comando)
  SELECT projeto, ROW_NUMBER() OVER (PARTITION BY projeto ORDER BY ordem), 'npm ci'
  FROM comando_preparacao_projeto WHERE trim(comando) = 'npm ci' ORDER BY projeto, ordem;
DELETE FROM comando_preparacao_projeto WHERE trim(comando) = 'npm ci';
`;

/**
 * As migrações de Demandas, cada uma com a versão do banco que ela entrega; a composição as registra em `abrir`. Moram
 * no histórico do esquema, e não na fachada de Demandas, que só expõe a GestaoDeDemandas.
 */
export const MIGRACOES_DE_DEMANDAS = {
  dominio: "demandas",
  migracoes: [
    { versao: 51, migracao: MIGRACAO_51_SITUACAO_DO_PEDIDO },
    { versao: 53, migracao: MIGRACAO_53_DEMANDA_SO_COM_O_PEDIDO },
    { versao: 58, migracao: MIGRACAO_58_ARQUIVOS_DE_DEPENDENCIAS },
    { versao: 59, migracao: MIGRACAO_59_COMANDO_DE_INSTALACAO },
  ],
};
