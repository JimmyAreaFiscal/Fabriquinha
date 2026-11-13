// A API do Despacho (MELHORIAS §11): identifica e reserva os tickets elegíveis, aplica o limite global de paralelismo e
// os entrega à Condução, no ciclo do agendador e no "Executar agora", pela mesma regra e pela mesma reserva; a
// configuração do serviço é dele. Fica fora da fachada, como a da Condução: ela lê o agregado do sdlc, que importa a
// fachada, e o ciclo de import daria TDZ na carga do agregado (ticket 22).
export {
  cicloDoDespacho,
  executarAgora,
  reservarTicketParaAFabriquinha,
  ultimasRecusas,
} from "./aplicacao/despacho.ts";
export { retomarFalhasDeInfraestrutura } from "./aplicacao/retomada_infraestrutura.ts";
export { Configuracao, configuracao, salvarConfiguracao } from "./armazenamento/configuracao_do_servico.ts";
export { Despacho, MotivoDeRecusa, prontosParaExecutarAgora, situacaoDeUmaDemanda } from "./nucleo/despacho.ts";
