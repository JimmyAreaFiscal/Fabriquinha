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

/** As migrações do Ambiente, cada uma com a versão do banco que ela entrega; a composição as registra em `abrir`. */
export const MIGRACOES_DO_AMBIENTE = {
  dominio: "ambiente",
  migracoes: [{ versao: 54, migracao: MIGRACAO_54_CONFIGURACAO_DO_AMBIENTE }],
};
