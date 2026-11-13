// A migração 54, do Ambiente (MELHORIAS §5.1 e §8): a Configuração do Ambiente ganha tabela própria, de linha única. Até a
// versão 53 ela morava nas colunas `ambiente_*` da `configuracao`, que é do Despacho; a migração copia os valores, e as
// colunas antigas ficam lá sem uso, com o que tinham: nada se apaga.
const MIGRACAO_54_CONFIGURACAO_DO_AMBIENTE = `
CREATE TABLE configuracao_ambiente (
    id                           INTEGER PRIMARY KEY CHECK (id = 1),
    tipo                         TEXT NOT NULL DEFAULT 'host_local' CHECK (tipo IN ('host_local','container')),
    memoria_maxima_mb            INTEGER NOT NULL DEFAULT 2048 CHECK (typeof(memoria_maxima_mb) = 'integer' AND memoria_maxima_mb >= 512),
    cpus                         REAL NOT NULL DEFAULT 2 CHECK (typeof(cpus) IN ('integer','real') AND cpus > 0),
    ociosidade_para_eliminar_min INTEGER NOT NULL DEFAULT 60 CHECK (typeof(ociosidade_para_eliminar_min) = 'integer' AND ociosidade_para_eliminar_min >= 5)
  );
INSERT INTO configuracao_ambiente (id, tipo, memoria_maxima_mb, cpus, ociosidade_para_eliminar_min)
  SELECT id, ambiente_tipo, ambiente_memoria_maxima_mb, ambiente_cpus, ambiente_ociosidade_para_eliminar_min
  FROM configuracao;
`;

/**
 * A versão da migração do conjunto fixo ou variável: o único lugar que a escreve (o teste a lê daqui).
 * @testes o teste da migração monta o banco na versão anterior a ela
 */
export const VERSAO_DO_CONJUNTO_FIXO_OU_VARIAVEL = 55;

// A migração do conjunto fixo ou variável, do Ambiente (MELHORIAS §13, item 1): o conjunto ganha o tipo (fixo ou variável) e os limites. O padrão é
// o que o conjunto já fazia: variável, sem capacidade e sem mínimo (cria sob demanda e elimina todo ocioso).
const MIGRACAO_DO_CONJUNTO_FIXO_OU_VARIAVEL = `
ALTER TABLE configuracao_ambiente ADD COLUMN conjunto TEXT NOT NULL DEFAULT 'variavel' CHECK (conjunto IN ('fixo','variavel'));
ALTER TABLE configuracao_ambiente ADD COLUMN capacidade_do_conjunto INTEGER CHECK (capacidade_do_conjunto IS NULL OR (typeof(capacidade_do_conjunto) = 'integer' AND capacidade_do_conjunto >= 1));
ALTER TABLE configuracao_ambiente ADD COLUMN minimo_do_conjunto INTEGER NOT NULL DEFAULT 0 CHECK (typeof(minimo_do_conjunto) = 'integer' AND minimo_do_conjunto >= 0);
`;

/** As migrações do Ambiente, cada uma com a versão do banco que ela entrega; a composição as registra em `abrir`. */
export const MIGRACOES_DO_AMBIENTE = {
  dominio: "ambiente",
  migracoes: [
    { versao: 54, migracao: MIGRACAO_54_CONFIGURACAO_DO_AMBIENTE },
    { versao: VERSAO_DO_CONJUNTO_FIXO_OU_VARIAVEL, migracao: MIGRACAO_DO_CONJUNTO_FIXO_OU_VARIAVEL },
  ],
};
