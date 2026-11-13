// A migração do catálogo de preços, de Sessões (MELHORIAS §5.1, §9 e §13, item 2): o catálogo nasce vazio, e o Uso das
// execuções ganha a referência do preço com que o custo foi estimado. É aditiva: o Uso já gravado fica sem referência
// (o custo informado segue informado, e o desconhecido segue desconhecido), sem recálculo.

/** A versão do banco que esta migração entrega; trocá-la é trocar só esta linha. */
/** @testes o teste da migração monta o banco na versão anterior a ela */
export const VERSAO_DO_CATALOGO_DE_PRECOS = 56;

const MIGRACAO_DO_CATALOGO_DE_PRECOS = `
CREATE TABLE preco_do_modelo (
    id                           INTEGER PRIMARY KEY,
    modelo_provedor              TEXT NOT NULL CHECK (length(modelo_provedor) > 0),
    modelo_nome                  TEXT NOT NULL CHECK (length(modelo_nome) > 0),
    usd_por_milhao_entrada       REAL NOT NULL CHECK (usd_por_milhao_entrada >= 0),
    usd_por_milhao_saida         REAL NOT NULL CHECK (usd_por_milhao_saida >= 0),
    usd_por_milhao_cache_leitura REAL NOT NULL CHECK (usd_por_milhao_cache_leitura >= 0),
    usd_por_milhao_cache_escrita REAL NOT NULL CHECK (usd_por_milhao_cache_escrita >= 0),
    origem                       TEXT NOT NULL CHECK (length(origem) > 0),
    vigente_de                   TEXT NOT NULL,
    vigente_ate                  TEXT CHECK (vigente_ate IS NULL OR vigente_ate >= vigente_de)
  );
CREATE UNIQUE INDEX preco_vigente_do_modelo ON preco_do_modelo (modelo_provedor, modelo_nome) WHERE vigente_ate IS NULL;
ALTER TABLE uso_modelo_execucao ADD COLUMN preco_id INTEGER REFERENCES preco_do_modelo(id)
  CHECK (preco_id IS NULL OR custo IS NOT NULL);
`;

/** As migrações de Sessões, cada uma com a versão do banco que ela entrega; a composição as registra em `abrir`. */
export const MIGRACOES_DE_SESSOES = {
  dominio: "sessoes",
  migracoes: [{ versao: VERSAO_DO_CATALOGO_DE_PRECOS, migracao: MIGRACAO_DO_CATALOGO_DE_PRECOS }],
};
