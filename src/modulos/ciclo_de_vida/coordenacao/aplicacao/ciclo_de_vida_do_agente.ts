// O Ciclo de Vida do agente (PROPOSTA §4.2): os casos de uso do agente no escopo que o token resolveu. Cada método confere
// que o endereço pedido é do ticket do token antes de chamar o caso de uso, que confere de novo.
import { z } from "zod";
import { ErroDeEscopo } from "../../../../shared/nucleo/erros.ts";
import type { Relogio } from "../../../../shared/nucleo/relogio.ts";
import { Endereco } from "../../etapas/publico.ts";
import { LIMITE } from "../../evidencias/publico.ts";
import {
  adicionarEvidenciaComAnexosEnviados,
  criarTicketCorretivo,
  decidirRevisao,
  type EscopoDoAgente,
  exigirDemandaPropria,
  exigirTicketProprio,
  type ModulosDoCiclo,
  type ProcessoDoAgente,
  tipoDoAgente,
  verDemanda,
  verProjeto,
  verTicket,
} from "../../conducao/publico.ts";

/** O que o agente lê: o projeto (o `ticket`, se vier, tem de ser o dele), a própria demanda ou o próprio ticket. */
type PedidoDeAndamento =
  { de: "projeto"; ticket?: string } | { de: "demanda"; demanda: string } | { de: "ticket"; ticket: string };

/** O JSON de uma opção do comando do agente, que já veio no corpo; `opcao` é a opção que o erro cita. */
type LeitorDoJsonDaOpcao = (valor: string, opcao?: string) => Promise<unknown>;

export interface CicloDeVidaDoAgente {
  /** A execução, a demanda e o ticket que o token alcança. */
  readonly escopo: EscopoDoAgente;
  /** O maior anexo que alguma Evidência aceita, em bytes. */
  readonly maiorAnexoEmBytes: number;
  andamento(pedido: { de: "projeto"; ticket?: string }): ReturnType<typeof verProjeto>;
  andamento(pedido: { de: "demanda"; demanda: string }): ReturnType<typeof verDemanda>;
  andamento(pedido: { de: "ticket"; ticket: string }): ReturnType<typeof verTicket>;
  /** O JSON Schema dos `dados` e os arquivos que a Evidência `tipo` pede; o `ticket`, se vier, tem de ser o do agente. */
  schemaDaEvidencia(tipo: string, ticket?: string): { dados: unknown; arquivos: unknown };
  /** `conferirAnexosEnviados` roda logo depois de conferir que o ticket é do agente, antes de qualquer outra regra. */
  submeterEvidencia(
    pedido: Parameters<typeof adicionarEvidenciaComAnexosEnviados>[2],
    lerJson: LeitorDoJsonDaOpcao,
    conferirAnexosEnviados: () => void,
  ): ReturnType<typeof adicionarEvidenciaComAnexosEnviados>;
  criarTicketCorretivo(pedido: { rodada: string; titulo: string | undefined }): ReturnType<typeof criarTicketCorretivo>;
  decidirRevisao(
    pedido: Parameters<typeof decidirRevisao>[2],
    lerJson: LeitorDoJsonDaOpcao,
  ): ReturnType<typeof decidirRevisao>;
}

/** A rodada de outra demanda é recusada aqui; o endereço malformado segue para o caso de uso, que mostra a forma certa. */
function exigirRodadaDaPropriaDemanda(agente: EscopoDoAgente, rodada: string): void {
  let demanda;
  try {
    demanda = Endereco.ler(rodada).demanda_id;
  } catch {
    return;
  }
  if (demanda !== agente.demanda_id) {
    throw new ErroDeEscopo(`${rodada} é de outra demanda`, `use uma rodada de ${agente.demanda_id}`);
  }
}

export function cicloDeVidaDoAgente(
  modulos: ModulosDoCiclo,
  escopo: EscopoDoAgente,
  relogio: Relogio,
): CicloDeVidaDoAgente {
  const { banco } = modulos;
  const processo: ProcessoDoAgente = { id: escopo.ator.trabalho_id };
  const exigirTicketOpcionalProprio = (ticket: string | undefined) => {
    if (ticket !== undefined) exigirTicketProprio(escopo, ticket);
  };
  function andamento(pedido: { de: "projeto"; ticket?: string }): ReturnType<typeof verProjeto>;
  function andamento(pedido: { de: "demanda"; demanda: string }): ReturnType<typeof verDemanda>;
  function andamento(pedido: { de: "ticket"; ticket: string }): ReturnType<typeof verTicket>;
  function andamento(pedido: PedidoDeAndamento) {
    if (pedido.de === "projeto") {
      exigirTicketOpcionalProprio(pedido.ticket);
      return verProjeto(banco, processo);
    }
    if (pedido.de === "demanda") {
      exigirDemandaPropria(escopo, pedido.demanda);
      return verDemanda(banco, processo, pedido.demanda);
    }
    exigirTicketProprio(escopo, pedido.ticket);
    return verTicket(banco, processo, pedido.ticket);
  }
  return {
    escopo,
    maiorAnexoEmBytes: Math.max(...Object.values(LIMITE)),
    andamento,
    schemaDaEvidencia(tipo, ticket) {
      exigirTicketOpcionalProprio(ticket);
      const { dados, arquivos } = tipoDoAgente(tipo).schema;
      return { dados: z.toJSONSchema(dados, { io: "input" }), arquivos };
    },
    submeterEvidencia(pedido, lerJson, conferirAnexosEnviados) {
      exigirTicketProprio(escopo, pedido.ticket, true);
      conferirAnexosEnviados();
      return adicionarEvidenciaComAnexosEnviados(modulos, processo, pedido, lerJson);
    },
    criarTicketCorretivo(pedido) {
      exigirRodadaDaPropriaDemanda(escopo, pedido.rodada);
      return criarTicketCorretivo(banco, processo, pedido, relogio);
    },
    decidirRevisao(pedido, lerJson) {
      exigirTicketProprio(escopo, pedido.ticket, true);
      return decidirRevisao(modulos, processo, pedido, lerJson);
    },
  };
}
