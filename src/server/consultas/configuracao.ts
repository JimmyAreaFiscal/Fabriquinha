// As consultas da tela de Configuração (F7 §4.2): cada uma monta o contrato da resposta, lendo num snapshot só.
import type { DatabaseSync } from "node:sqlite";
import { configuracao } from "../../modulos/ciclo_de_vida/publico.ts";
import { lerEmSnapshot } from "../../shared/armazenamento/snapshot.ts";
import type { EstadoDaConfiguracao, EstadoDoAmbiente, ProjetoCadastrado } from "../contrato/configuracao.ts";
import { listarProjetos, projetoComConfiguracoesDasEtapas, projetoExistente } from "../../modulos/demandas/publico.ts";
import { configuracaoDoAmbiente, listarAmbientesDoConjunto } from "../../modulos/ambiente/publico.ts";

/** A configuração do F4 §3 com a próxima busca do agendador, só ligado. */
export function consultarEstadoDaConfiguracao(banco: DatabaseSync, proximaBusca: () => Date): EstadoDaConfiguracao {
  const gravada = configuracao(banco);
  return { ...gravada, proximaBusca: gravada.agendadorAtivo ? proximaBusca().toISOString() : null };
}

/** O tipo e os limites do Ambiente gravados, e o conjunto de containers da Fabriquinha (só os que ela criou). */
export const consultarEstadoDoAmbiente = (banco: DatabaseSync): EstadoDoAmbiente =>
  lerEmSnapshot(banco, () => ({
    configuracao: configuracaoDoAmbiente(banco),
    conjunto: listarAmbientesDoConjunto(banco),
  }));

/** Os projetos cadastrados, cada um com o modelo e o effort de cada etapa. */
export const consultarProjetosCadastrados = (banco: DatabaseSync): ProjetoCadastrado[] =>
  listarProjetos(banco).map(projetoComConfiguracoesDasEtapas);

/** O projeto `nome`, com o modelo e o effort de cada etapa; `ErroDeInexistente` se não está cadastrado. */
export const consultarProjetoCadastrado = (banco: DatabaseSync, nome: string): ProjetoCadastrado =>
  projetoComConfiguracoesDasEtapas(projetoExistente(banco, nome));
