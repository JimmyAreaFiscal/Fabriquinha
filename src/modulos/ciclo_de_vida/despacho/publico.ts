// A API do Despacho (MELHORIAS §11): identifica e reserva os tickets elegíveis, aplica o limite global de paralelismo e
// os entrega à Condução, no ciclo do agendador e no "Executar agora", pela mesma regra e pela mesma reserva; a
// configuração do serviço e as Pendências da demanda, com o despacho parado, são dele.
export {
  cicloDoDespacho,
  executarAgora,
  reservarTicketParaAFabriquinha,
  ultimasRecusas,
} from "./aplicacao/despacho.ts";
export { retomarFalhasDeInfraestrutura } from "./aplicacao/retomada_infraestrutura.ts";
export { Configuracao, configuracao, salvarConfiguracao } from "./armazenamento/configuracao_do_servico.ts";
export { validarESalvarConfiguracao } from "./aplicacao/configuracao_do_servico.ts";
export { Despacho, MotivoDeRecusa, prontosParaExecutarAgora, situacaoDeUmaDemanda } from "./nucleo/despacho.ts";
export { pendenciasDaDemanda } from "./nucleo/pendencias_da_demanda.ts";
