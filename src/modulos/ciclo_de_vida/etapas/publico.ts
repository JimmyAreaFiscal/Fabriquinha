// A API de Etapas (MELHORIAS §11): o catálogo do que cada Etapa declara (objetivo, executor, capacidades, prompt, gates,
// evidências e verificações), o modo de trabalhar de cada uma e o vocabulário do SDLC que todo o Ciclo de Vida fala.
export {
  CATALOGO_DE_ETAPAS,
  type DeclaracoesDasEtapas,
  type DefinicaoDoCatalogo,
  type EtapaConduzida,
  etapaDoPapel,
  EtapaTicket,
  exigirEtapaConduzida,
  NomeGate,
  oAgenteDecideOGate,
  ORDEM_DO_SDLC,
} from "./nucleo/catalogo.ts";
export { ConfiguracaoAgente, resolverConfiguracaoAgente } from "./nucleo/configuracao_agente.ts";
export {
  type DefinicaoDaEtapa,
  evidenciaExigida,
  type EvidenciaExigida,
  evidenciasDeVerificacao,
  EXTENSOES_DO_AGENTE,
  type PapelDaEtapa,
  SEM_CAPACIDADES,
  VERIFICACOES_DE_CODIGO,
} from "./nucleo/definicao/definicao_da_etapa.ts";
export { catalogoDaEtapa, CATALOGO_ETAPAS, ItemCatalogoEtapa } from "./nucleo/definicao/evidencia_exigida.ts";
export { ExibicaoDaEtapa } from "./nucleo/definicao/exibicao_da_etapa.ts";
export {
  ProdutorDaEvidencia,
  RegraAprovacaoEtapa,
  TipoEvidencia,
  type TipoMetrica,
  type TipoVerificacao,
} from "./nucleo/definicao/tipos_declaraveis.ts";
export { DEFINICAO_DO_AJUSTAR_RESULTADO } from "./nucleo/ajustar_resultado/definicao.ts";
export { DEFINICAO_DO_ENCERRAR_DEMANDA } from "./nucleo/encerrar_demanda/definicao.ts";
export { DEFINICAO_DO_ENCERRAR_RODADA } from "./nucleo/encerrar_rodada/definicao.ts";
export {
  DEFINICAO_DO_ENTENDER_E_DESENHAR,
  OBRIGATORIAS_DEMANDA,
  type TipoDaDemanda,
  TIPOS_DA_DEMANDA,
} from "./nucleo/entender_e_desenhar/definicao.ts";
export { DEFINICAO_DO_IMPLEMENTAR } from "./nucleo/implementar/definicao.ts";
export { DEFINICAO_DO_PLANEJAR } from "./nucleo/planejar/definicao.ts";
export { DEFINICAO_DO_RESOLVER_CONFLITO } from "./nucleo/resolver_conflito/definicao.ts";
export { DEFINICAO_DO_REVISAR_DEMANDA } from "./nucleo/revisar_demanda/definicao.ts";
export { DEFINICAO_DO_REVISAR_RODADA } from "./nucleo/revisar_rodada/definicao.ts";
export { AUDITOR, Ator, AtorExterno, exigirAtor, FABRIQUINHA } from "./nucleo/vocabulario/ator.ts";
export { Endereco } from "./nucleo/vocabulario/endereco.ts";
export {
  branchDemanda,
  branchRodada,
  CaminhoPrevisto,
  CriterioId,
  DemandaId,
  formatarRodadaRef,
  formatarTicketRef,
  RodadaRef,
  TicketIdentidade,
  TicketRef,
} from "./nucleo/vocabulario/identidades.ts";
export {
  CausaDeInfraestrutura,
  FalhaDaTentativa,
  falhaDoErro,
  falhaInterrompidaPeloAuditor,
  falhaPorServicoReiniciado,
  falhaQueExigeOAuditor,
  ResultadoDaTentativa,
  resultadoDoErro,
  rotuloDaCausa,
} from "./nucleo/vocabulario/resultado_da_tentativa.ts";
export { lerModoDeTrabalhar } from "./infra/modo_de_trabalhar.ts";
