// As consultas da tela de Configuração (F7 §4.2): cada uma monta o contrato da resposta, lendo num snapshot só.
import type { DatabaseSync } from "node:sqlite";
import { configuracao } from "../../../compartilhado/armazenamento/servico.ts";
import { lerEmSnapshot } from "../../../compartilhado/armazenamento/snapshot.ts";
import type {
  EstadoDaConfiguracao,
  EstadoDoAmbiente,
  ProjetoCadastrado,
} from "../../../entrega/contrato/configuracao.ts";
import { listarAmbientesDoConjunto } from "../../../sandbox/aplicacao/conjunto_de_ambientes/conjunto_da_configuracao.ts";
import { projetoComConfiguracoesDasEtapas } from "../configuracao_do_agente.ts";
import { listarProjetos, projetoExistente } from "../cadastro.ts";
import { configuracaoDoAmbiente } from "../../../sandbox/armazenamento/configuracao_do_ambiente.ts";

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
