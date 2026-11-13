// A API de Condução (MELHORIAS §11): executa o trabalho de um ticket, da reserva à transição pedida ao Processo, com a
// política de uso dos agentes (prompt, modelo, capacidades, retomada, triagem do Auditor automático) entregue pronta a
// Sessões; as conduções de cada Etapa, a decisão dos gates com os efeitos fora do agregado, os casos de uso do agente e o
// chat do Auditor: o estado da sessão do ticket, a Pendência que a segura, as marcas da conversa e as ações dele.
export { adicionarEvidenciaComAnexosEnviados } from "./aplicacao/agente/adicionar_evidencia.ts";
export { verDemanda, verProjeto, verTicket } from "./aplicacao/agente/consultas.ts";
export { criarTicketCorretivo } from "./aplicacao/agente/criar_ticket_corretivo.ts";
export { decidirRevisao } from "./aplicacao/agente/decidir_revisao.ts";
export {
  type EscopoDoAgente,
  exigirDemandaPropria,
  exigirTicketProprio,
  type ProcessoDoAgente,
  resolverEscopoDoToken,
} from "./aplicacao/agente/escopo.ts";
export { tipoDoAgente } from "./aplicacao/agente/tipo_do_agente.ts";
export { concluirSessaoAjustes } from "./aplicacao/ajustar_resultado/sessao_ajustes.ts";
export { abortarDemanda, responderDialogoDemanda } from "./aplicacao/chat_do_auditor/acoes_do_auditor_no_chat.ts";
export { marcadorDaConversa, promptsDaFabriquinha } from "./aplicacao/chat_do_auditor/marcas_da_conversa.ts";
export {
  type EstadoDaSessao,
  estadoEDesdeDaSessao,
  execucaoDaSessao,
  pendenciaDaSessao,
  type PendenciaDoChat,
  pendenciaDoChat,
  type SessaoDoTicket,
  trabalhoVivoDaSessao,
} from "./aplicacao/chat_do_auditor/sessao_do_ticket.ts";
// provisório: remover no ticket 22, que traz a regra das Pendências do sdlc para o Ciclo de Vida. A regra única do que
// aguarda o Auditor, para as consultas das telas.
export { pendenciasDaDemanda, type TrabalhoVivo } from "../../sdlc/nucleo/demanda/pendencia.ts";
export { ConducaoAgentica } from "./aplicacao/conducao_de_etapa/conducao_de_etapa.ts";
export { enviarDemanda } from "./aplicacao/conducao_de_etapa/mensagem_do_auditor.ts";
export {
  type ConducaoDoTicket,
  type DepsDaConducao,
  type DepsDespacho,
  despachoDasEtapas,
  montarConducoesDasEtapas,
} from "./aplicacao/conducoes.ts";
export { marcaDoPRFinal } from "./aplicacao/encerrar_demanda/encerramento_demanda.ts";
export { marcaDoPRRodada } from "./aplicacao/encerrar_rodada/documentacao_do_pr/pr_rodada.ts";
export { type RefRodada } from "./aplicacao/encerrar_rodada/encerramento_rodada.ts";
export { decidirGate, GATE_DA_DEMANDA, GATES } from "./aplicacao/gates.ts";
export { ConducaoDeImplementar } from "./aplicacao/implementar/conducao_de_implementar.ts";
export { ConducaoDePlanejar } from "./aplicacao/planejar/conducao_de_planejar.ts";
export {
  iniciarExecucaoDemanda,
  interromperExecucaoDemanda,
  type OpcoesExecucaoDemanda,
} from "./aplicacao/execucao/execucao_demanda.ts";
export { condutor, CondutorDeTrabalhos, type RecuperacaoDaSubida } from "./aplicacao/politica_dos_agentes/condutor.ts";
export { exigirTrabalhoDoTicket } from "./aplicacao/politica_dos_agentes/trabalho_do_ticket.ts";
export { montarPromptDemanda } from "./aplicacao/prompt/prompt_demanda.ts";
export { ConducaoDeResolverConflito } from "./aplicacao/resolver_conflito/conducao_de_resolver_conflito.ts";
