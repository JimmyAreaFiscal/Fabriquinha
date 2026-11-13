// O fluxo da varredura dos commits humanos (MELHORIAS §5.3, F4 §4, passo 1), entre Demandas e o Repositório: o agendador
// do servidor o dispara; Demandas lista os projetos cadastrados; o Repositório diz, pelo cursor que ele guarda, quais
// estão sem varredura há 24 horas, e coleta os commits novos da base de cada um.
import type { DatabaseSync } from "node:sqlite";
import type { Relogio } from "../../../shared/nucleo/relogio.ts";
import type { GestaoDeDemandas } from "../../../modulos/demandas/publico.ts";
import { projetosAVarrer, varrerCommitsHumanos } from "../../../modulos/repositorio/publico.ts";

/**
 * Varre, um por vez, cada projeto sem varredura há 24 horas; a falha de um vai a `registrarErro` e não impede os outros.
 * O projeto é relido na hora da sua varredura: o removido ou reconfigurado no meio da fila vale como está agora.
 */
export async function varrerCommitsHumanosVencidos(
  banco: DatabaseSync,
  gestaoDeDemandas: GestaoDeDemandas,
  relogio: Relogio,
  registrarErro: (erro: unknown) => void,
): Promise<void> {
  const vencidos = projetosAVarrer(
    banco,
    gestaoDeDemandas.projetos().map((projeto) => projeto.nome),
    relogio,
  );
  for (const nome of vencidos) {
    try {
      await varrerCommitsHumanos(banco, gestaoDeDemandas.projeto(nome, "cadastre-o na Configuração"));
    } catch (erro) {
      registrarErro(erro);
    }
  }
}
