// As consultas da tela de Configuração (F7 §4.2): cada uma monta o contrato da resposta, lendo num snapshot só.
import type { DatabaseSync } from "node:sqlite";
import type { CicloDeVida } from "../../../../modulos/ciclo_de_vida/publico.ts";
import type { EstadoDaConfiguracao, EstadoDoAmbiente, ProjetoCadastrado } from "../contrato/configuracao.ts";
import type { GestaoDeDemandas, Projeto } from "../../../../modulos/demandas/publico.ts";
import type { GestaoDeAmbientes } from "../../../../modulos/ambiente/publico.ts";
import { configuracaoDoAmbiente } from "../../../../shared/armazenamento/configuracao_do_ambiente.ts";

/** A configuração do F4 §3 com a próxima busca do agendador, só ligado. */
export function consultarEstadoDaConfiguracao(cicloDeVida: CicloDeVida): EstadoDaConfiguracao {
  const gravada = cicloDeVida.configuracao();
  return { ...gravada, proximaBusca: gravada.agendadorAtivo ? cicloDeVida.proximaBusca() : null };
}

/** O tipo e os limites do Ambiente gravados, e o conjunto de containers da Fabriquinha (só os que ela criou) com o uso medido. */
export async function consultarEstadoDoAmbiente(
  banco: DatabaseSync,
  ambientes: GestaoDeAmbientes,
): Promise<EstadoDoAmbiente> {
  const configuracao = configuracaoDoAmbiente(banco);
  return { configuracao, conjunto: await ambientes.listar() };
}

/** O projeto como o formulário o lê: o cadastro com a configuração do agente de cada etapa que tem uma. */
export const projetoComConfiguracoesDasEtapas = (projeto: Projeto): ProjetoCadastrado => ({
  ...projeto,
  configuracoes: Object.fromEntries(
    projeto.etapas.flatMap(({ etapa, configuracao_agente }) =>
      configuracao_agente ? [[etapa, configuracao_agente]] : [],
    ),
  ),
});

/** Os projetos cadastrados, cada um com o modelo e o effort de cada etapa. */
export const consultarProjetosCadastrados = (gestaoDeDemandas: GestaoDeDemandas): ProjetoCadastrado[] =>
  gestaoDeDemandas.projetos().map(projetoComConfiguracoesDasEtapas);

/** O projeto `nome`, com o modelo e o effort de cada etapa; `ErroDeInexistente` se não está cadastrado. */
export const consultarProjetoCadastrado = (gestaoDeDemandas: GestaoDeDemandas, nome: string): ProjetoCadastrado =>
  projetoComConfiguracoesDasEtapas(gestaoDeDemandas.projeto(nome));
