// A configuração do agente de cada etapa do projeto: o modelo e o effort passam entre o formato do formulário e o
// cadastro.
import { type ConfiguracaoAgente, EtapaTicket } from "../../../ciclo_de_vida/publico.ts";
import type { Projeto } from "../nucleo/projeto.ts";

/** O modelo escolhido na configuração do agente: o par provedor/nome. */
type Modelo = NonNullable<ConfiguracaoAgente["modelo"]>;

/** A conferência do par provedor/modelo pelo harness (F4 §9), que a composição entrega: recusa o que ele não conhece. */
export type ConferirModeloNoHarness = (modelo: Modelo) => Promise<void>;

/** O modelo e o effort de cada etapa; a etapa ausente usa o padrão do pi. */
export type ConfiguracoesDasEtapas = Partial<Record<EtapaTicket, ConfiguracaoAgente>>;

/** O par `provedor/nome` do modelo, para comparar dois modelos; `undefined` se não há modelo. */
export const parDoModelo = (modelo: Modelo | null | undefined): string | undefined =>
  modelo ? `${modelo.provedor}/${modelo.nome}` : undefined;

/** As etapas do projeto no formato do formulário: a configuração do agente de cada etapa que tem uma. */
export const configuracoesDasEtapas = (etapas: Projeto["etapas"]): ConfiguracoesDasEtapas =>
  Object.fromEntries(
    etapas.flatMap(({ etapa, configuracao_agente }) => (configuracao_agente ? [[etapa, configuracao_agente]] : [])),
  );

/** O projeto como o formulário o lê: o cadastro com a configuração do agente de cada etapa. */
export const projetoComConfiguracoesDasEtapas = (projeto: Projeto) => ({
  ...projeto,
  configuracoes: configuracoesDasEtapas(projeto.etapas),
});

/** As linhas de `configuracao_etapa_projeto` do formulário: só as etapas com modelo ou effort escolhido. */
export const etapasComModeloOuEffort = (configuracoes: ConfiguracoesDasEtapas) =>
  EtapaTicket.options.flatMap((etapa) => {
    const configuracao_agente = configuracoes[etapa];
    return configuracao_agente?.modelo || configuracao_agente?.effort ? [{ etapa, configuracao_agente }] : [];
  });
