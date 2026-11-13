// Primitivos do domínio (F1 §3.1), que não são do shared. Fonte única: o schema gera o tipo e valida em runtime (D2).
// provisório: remover no ticket 22 (os primitivos técnicos moraram aqui; agora vêm de src/shared/nucleo/primitivos.ts)
export {
  Id,
  Instante,
  Markdown,
  Motivo,
  motivo,
  palavras,
  Slug,
  Titulo,
  unicoPor,
} from "../../../shared/nucleo/primitivos.ts";

// provisório: remover no ticket 22 (o modelo, o effort e o modo de trabalho do agente moraram aqui; agora vêm de Sessões)
export { Effort, Modelo, ModoTrabalho } from "../../sessoes/publico.ts";

// provisório: remover no ticket 22 (os estados do ticket mudaram para src/modulos/ciclo_de_vida/processo/, pela fachada)
export { EstadoTicket } from "../../ciclo_de_vida/publico.ts";
