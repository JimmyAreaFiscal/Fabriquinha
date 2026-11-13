// O resultado de uma Tentativa (cada execução de uma Etapa de um ticket): o sucesso, a reprovação que o agente corrige
// ou a falha (de infraestrutura, ou a interrupção que pede o Auditor). É vocabulário de todo o serviço: o condutor e as
// verificações também o devolvem.
import { z } from "zod";
import { AUDITOR, Ator, FABRIQUINHA } from "./ator.ts";
import { ErroDeReprovacao, ErroExterno, mensagem } from "../../../../../shared/nucleo/erros.ts";
import { Markdown, motivo } from "../../../../../shared/nucleo/primitivos.ts";

export const CausaDeInfraestrutura = z.enum([
  "tempo_limite",
  "cota",
  "servico_reiniciado",
  "modelo_sem_resposta",
  "comando_ausente",
  "servico_externo_inacessivel",
]);
export type CausaDeInfraestrutura = z.infer<typeof CausaDeInfraestrutura>;

/** O único lugar que escreve a causa em palavras: o reinício tem a sua; as demais falhas de ambiente, a mesma. */
const ROTULO_DA_CAUSA: Record<CausaDeInfraestrutura, string> = {
  tempo_limite: "falha de infraestrutura",
  cota: "falha de infraestrutura",
  servico_reiniciado: "serviço reiniciado",
  modelo_sem_resposta: "falha de infraestrutura",
  comando_ausente: "falha de infraestrutura",
  servico_externo_inacessivel: "falha de infraestrutura",
};
export const rotuloDaCausa = (causa: CausaDeInfraestrutura): string => ROTULO_DA_CAUSA[causa];

/**
 * `interrompida` leva o `motivo` quando a Tentativa terminou sem ser reprovação nem falha de ambiente (o Auditor a
 * interrompeu, ou o erro pede o Auditor): é o que o ticket mostra como motivo da falha.
 */
const FalhaDeInfraestrutura = z.object({
  tipo: z.literal("falha_infraestrutura"),
  causa: CausaDeInfraestrutura,
  motivo: Markdown,
});
const Interrompida = z.object({ tipo: z.literal("interrompida"), por: Ator, motivo: Markdown.optional() });
export const ResultadoDaTentativa = z.discriminatedUnion("tipo", [
  z.object({ tipo: z.literal("sucesso") }),
  z.object({ tipo: z.literal("reprovacao"), motivo: Markdown }),
  FalhaDeInfraestrutura,
  Interrompida,
]);
export type ResultadoDaTentativa = z.infer<typeof ResultadoDaTentativa>;

/** O resultado de uma execução que não passou nem reprovou: o que o condutor devolve quando a etapa falha, sempre com motivo. */
export const FalhaDaTentativa = z.discriminatedUnion("tipo", [
  FalhaDeInfraestrutura,
  Interrompida.required({ motivo: true }),
]);
export type FalhaDaTentativa = z.infer<typeof FalhaDaTentativa>;

export const falhaPorServicoReiniciado: FalhaDaTentativa = {
  tipo: "falha_infraestrutura",
  causa: "servico_reiniciado",
  motivo: rotuloDaCausa("servico_reiniciado"),
};

export const falhaInterrompidaPeloAuditor: FalhaDaTentativa = {
  tipo: "interrompida",
  por: AUDITOR,
  motivo: "interrompida pelo Auditor",
};

/** A falha que a Fabriquinha não retoma sozinha: a política bloqueia e o ticket espera o Auditor. */
export const falhaQueExigeOAuditor = (texto: string): FalhaDaTentativa => ({
  tipo: "interrompida",
  por: FABRIQUINHA,
  motivo: motivo(texto),
});

/** O erro de uma etapa que não tem reprovação: o externo é infraestrutura, o resto pede o Auditor. */
export function falhaDoErro(erro: unknown): FalhaDaTentativa {
  return erro instanceof ErroExterno
    ? {
        tipo: "falha_infraestrutura",
        causa: "servico_externo_inacessivel",
        motivo: `${rotuloDaCausa("servico_externo_inacessivel")}: ${motivo(erro.message)}`,
      }
    : falhaQueExigeOAuditor(mensagem(erro));
}

/** O erro de uma etapa que o agente corrige reprova; qualquer outro é falha (`falhaDoErro`). */
export function resultadoDoErro(
  erro: unknown,
): FalhaDaTentativa | Extract<ResultadoDaTentativa, { tipo: "reprovacao" }> {
  return erro instanceof ErroDeReprovacao ? { tipo: "reprovacao", motivo: motivo(erro.message) } : falhaDoErro(erro);
}
