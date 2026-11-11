// O prompt do ticket como a condução da Etapa dele o monta, com a seção que só ela lê: o que os testes do prompt e a foto
// da base conferem. As conduções só montam o prompt aqui; nada lê o banco nem lança o agente.
import { DatabaseSync } from "node:sqlite";
import { anotar } from "../src/compartilhado/infra/registro.ts";
import { relogioDoSistema } from "../src/compartilhado/nucleo/relogio.ts";
import { ConducaoAgentica } from "../src/etapas/conducao/conducao_de_etapa.ts";
import { montarConducoesDasEtapas } from "../src/etapas/conducoes.ts";
import { montarPromptDemanda } from "../src/etapas/prompt/prompt_demanda.ts";
import type { ContextoDoPrompt } from "../src/sdlc/nucleo/contexto_do_prompt.ts";
import { condutor } from "../src/trabalho_agentico/aplicacao/trabalho/condutor.ts";

const CONDUCOES_DO_PROMPT = montarConducoesDasEtapas({
  banco: new DatabaseSync(":memory:"),
  relogio: relogioDoSistema,
  condutor,
  registro: anotar,
});

/** O prompt da Etapa do ticket do contexto; a Etapa sem agente (e a externa) só tem o de todo ticket. */
export function promptDaEtapa(contexto: ContextoDoPrompt): string {
  const etapa = contexto.ticket.etapa;
  const conducao = etapa === "entender_e_desenhar" ? undefined : CONDUCOES_DO_PROMPT[etapa];
  return conducao instanceof ConducaoAgentica ? conducao.montarPrompt(contexto) : montarPromptDemanda(contexto);
}
