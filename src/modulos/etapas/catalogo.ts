// provisório: remover no ticket 22 (mudou para src/modulos/ciclo_de_vida/; vem da API de Etapas, sem a fachada: o CLI do
// agente o empacota, e a fachada traria Verificações e, com elas, o banco)
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
} from "../ciclo_de_vida/etapas/publico.ts";
