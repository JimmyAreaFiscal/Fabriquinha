// provisório: remover no ticket 22 (mudou para src/modulos/ciclo_de_vida/processo/, pela fachada)
export {
  comReaberturaDoAuditor,
  comTentativaAberta,
  comTentativaEncerrada,
  desdeAReabertura,
  montarRetornoAoAgente,
  motivoDaFalhaDoTicket,
  POLITICA_DE_TENTATIVAS,
  type RetornoAoAgente,
  retornoAoAgenteDoTicket,
  Tentativa,
  tentativaAnteriorEmMemoria,
  tentativasDoTicket,
} from "../../ciclo_de_vida/publico.ts";
