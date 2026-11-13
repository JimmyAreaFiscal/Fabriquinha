// A migração 52, do Ciclo de Vida (MELHORIAS §5.1 e §11, regra 1): o estado do desenvolvimento de cada demanda ganha
// tabela própria, `processo_demanda`, do Processo, que é o único escritor dele. Até a versão 51 o estado, o instante da
// última mudança e a branch moravam na linha da `demanda`, que é dos Pedidos; a migração os copia, na ordem das linhas,
// e não apaga nada (a 53, dos Pedidos, só deixa as colunas antigas sem uso).
const MIGRACAO_52_ESTADO_DO_PROCESSO = `
CREATE TABLE processo_demanda (
    demanda_id         TEXT PRIMARY KEY REFERENCES demanda(id),
    estado             TEXT NOT NULL CHECK (estado IN ('entender_e_desenhar','gate_demanda','planejar','gate_planejamento','em_execucao','revisar_demanda','encerrar_demanda','concluida','arquivada','cancelada')),
    estado_alterado_em TEXT NOT NULL,
    branch             TEXT NOT NULL
  );
INSERT INTO processo_demanda (demanda_id, estado, estado_alterado_em, branch)
  SELECT id, estado, estado_alterado_em, branch FROM demanda ORDER BY rowid;
`;

/** As migrações do Ciclo de Vida, cada uma com a versão do banco que ela entrega; a composição as registra em `abrir`. */
export const MIGRACOES_DO_CICLO_DE_VIDA = {
  dominio: "ciclo_de_vida",
  migracoes: [{ versao: 52, migracao: MIGRACAO_52_ESTADO_DO_PROCESSO }],
};
