// A migração do slot, de Ambiente (CONCEITOS.md §7): o container ganha o número do slot, que o nomeia no docker
// (`fabriquinha-slot-<n>`). É nulo nas linhas que já existem, que a reconciliação da subida elimina, e único entre os
// que não foram eliminados, então o número de um eliminado volta a servir.

/** A versão do banco que esta migração entrega; trocá-la é trocar só esta linha. */
/** @testes o teste da migração monta o banco na versão anterior a ela */
export const VERSAO_DO_SLOT_DO_AMBIENTE = 57;

const MIGRACAO_DO_SLOT_DO_AMBIENTE = `
ALTER TABLE ambiente ADD COLUMN slot INTEGER CHECK (slot IS NULL OR (typeof(slot) = 'integer' AND slot >= 1));
CREATE UNIQUE INDEX ux_ambiente_slot ON ambiente(slot) WHERE estado <> 'eliminado';
`;

/** As migrações de Ambiente, cada uma com a versão do banco que ela entrega; a composição as registra em `abrir`. */
export const MIGRACOES_DE_AMBIENTE = {
  dominio: "ambiente",
  migracoes: [{ versao: VERSAO_DO_SLOT_DO_AMBIENTE, migracao: MIGRACAO_DO_SLOT_DO_AMBIENTE }],
};
