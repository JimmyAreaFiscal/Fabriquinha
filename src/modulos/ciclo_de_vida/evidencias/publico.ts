// A API de Evidências (MELHORIAS §11): os formatos de cada tipo, a autoria, os anexos, a avaliação (o formato, puro, e
// o contexto, recebido como dado de quem submete) e a submissão, que dá a evidência aceita ou a submissão recusada.
// Aceitar uma evidência não decide gate. As tabelas `evidencia_demanda` e `arquivo_evidencia` só passam por aqui.
export {
  ArvorePRsCriteriosCustos,
  ComandoRodado,
  type ContextoDaAvaliacao,
  CustosRealizados,
  daUltimaConcluida,
  DemonstracaoLimpeza,
  type EsquemaDeEvidencia,
  impactoExigeReversao,
  LIMITE,
} from "./nucleo/schemas.ts";
export { schemaDoTipo } from "./nucleo/formatos.ts";
export {
  agregadoDaRodada,
  type Avaliacao,
  AvaliadorDeEvidencia,
  evidenciasPendentes,
  exigirAutoria,
  type SubmissaoDeEvidencia,
} from "./nucleo/avaliacao.ts";
export { donoDe, EvidenciaDemanda, pendentesDeEnvio } from "./nucleo/evidencia_demanda.ts";
export type { AnexoEnviado, Origens } from "./aplicacao/guarda_dos_anexos.ts";
export { avaliarEGuardarAnexos, type OrigemDosAnexos } from "./aplicacao/submissao.ts";
export {
  type AnexoDaDemanda,
  anexosDaDemanda,
  evidenciasDoTipoDasDemandas,
  gravarAnexos,
  gravarEvidenciasNovasEAlteradas,
  gravarRetiradaDasEvidencias,
  lerAnexo,
  lerEvidenciasDaDemanda,
  primeiraEvidenciaDasDemandas,
} from "./armazenamento/evidencia_demanda.ts";
