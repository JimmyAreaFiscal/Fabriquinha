// As conduções das Etapas que a Fabriquinha conduz, uma por pasta: o despacho entrega o ticket reservado à da Etapa dele.
// Fica fora do catálogo, que é valor puro, para o motor ler as definições sem trazer pi, git nem banco; quem chama o
// despacho (a composição, cada teste) lhe entrega estas conduções (`despachoDasEtapas`).
import type { EtapaConduzida } from "../../etapas/publico.ts";
import type { ConducaoDeEtapa, ConducaoDoTicket, DepsDaConducao } from "./conducao_de_etapa/conducao_de_etapa.ts";
import { ConducaoDeAjustarResultado } from "./ajustar_resultado/conducao_de_ajustar_resultado.ts";
import {
  ConducaoDeEncerrarDemanda,
  type OpcoesDoEncerramentoDaDemanda,
} from "./encerrar_demanda/conducao_de_encerrar_demanda.ts";
import { ConducaoDeEncerrarRodada } from "./encerrar_rodada/conducao_de_encerrar_rodada.ts";
import { ConducaoDeImplementar, type OpcoesDaImplementacao } from "./implementar/conducao_de_implementar.ts";
import { ConducaoDePlanejar } from "./planejar/conducao_de_planejar.ts";
import { ConducaoDeResolverConflito } from "./resolver_conflito/conducao_de_resolver_conflito.ts";
import { ConducaoDeRevisarDemanda } from "./revisar_demanda/conducao_de_revisar_demanda.ts";
import { ConducaoDeRevisarRodada } from "./revisar_rodada/conducao_de_revisar_rodada.ts";

export type { ConducaoDoTicket, DepsDaConducao } from "./conducao_de_etapa/conducao_de_etapa.ts";

/** O despacho não conhece as Etapas: quem o chama (a composição, cada teste) entrega as conduções delas. */
export interface DepsDespacho {
  montarConducoes(deps: DepsDaConducao): Readonly<Record<EtapaConduzida, ConducaoDoTicket>>;
}

/** O que as conduções recebem além das dependências comuns; injetável nos testes. */
interface OpcoesDasConducoes {
  /** Coleta das verificações e limite do commit do `implementar` e do `resolver_conflito`. */
  implementacao?: OpcoesDaImplementacao;
  /** Espera da verificação do PR no `encerrar_demanda`. */
  verificacao?: OpcoesDoEncerramentoDaDemanda["verificacao"];
  /** Substitui conduções nos testes que não sobem pi nem git. */
  conducoesSubstitutas?: (deps: DepsDaConducao) => Partial<Record<EtapaConduzida, ConducaoDeEtapa>>;
}

export const montarConducoesDasEtapas = (
  deps: DepsDaConducao,
  { implementacao, verificacao, conducoesSubstitutas }: OpcoesDasConducoes = {},
): Record<EtapaConduzida, ConducaoDeEtapa> => ({
  planejar: new ConducaoDePlanejar(deps),
  implementar: new ConducaoDeImplementar(deps, implementacao),
  resolver_conflito: new ConducaoDeResolverConflito(deps, implementacao),
  revisar_rodada: new ConducaoDeRevisarRodada(deps),
  revisar_demanda: new ConducaoDeRevisarDemanda(deps),
  encerrar_rodada: new ConducaoDeEncerrarRodada(deps),
  encerrar_demanda: new ConducaoDeEncerrarDemanda(deps, { verificacao }),
  ajustar_resultado: new ConducaoDeAjustarResultado(deps),
  ...conducoesSubstitutas?.(deps),
});

/** O despacho com as conduções das Etapas: o que a composição entrega a cada ciclo do agendador e "Executar agora". */
export const despachoDasEtapas = (opcoes: OpcoesDasConducoes = {}): DepsDespacho => ({
  montarConducoes: (deps) => montarConducoesDasEtapas(deps, opcoes),
});
