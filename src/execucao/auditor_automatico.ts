// Auditor automático: a pergunta que o agente de um ticket autônomo faz com a `perguntar` vai antes a um modelo, numa
// chamada única do pi sem ferramentas. Ele responde o que é banal pelas regras do Auditor e escala o estratégico, que
// segue esperando o Auditor no chat. Na dúvida, em erro ou sem resposta legível, escala: nunca decide no lugar dele.
import { z } from "zod";
import { executar } from "../processo.ts";
import { perguntarAoPiSemFerramentas } from "./pi.ts";

export interface PerguntaDoAgente {
  pergunta: string;
  detalhes?: string;
  /** Os rótulos das opções; vazio na pergunta de texto livre. */
  opcoes: string[];
}

export interface ContextoDaPergunta {
  /** Endereço público do ticket (`I-12.T3`), a etapa e o título da demanda. */
  ticket: string;
  etapa: string;
  demanda: string;
}

export interface RespostaDoAuditorAutomatico {
  /** Um dos rótulos, na pergunta com opções; senão, o texto da resposta. */
  resposta: string;
  justificativa: string;
}

/** A resposta fixa à pergunta sobre verificação que fica fora da revisão; o modelo só classifica, o texto é do código. */
export const RESPOSTA_FORA_DA_REVISAO =
  "Fica fora da revisão; registre como verificado fora da revisão e decida pelo resto.";

const ETAPAS_DE_REVISAO = ["revisar_rodada", "revisar_demanda"];

// Rede de segurança do código: o modelo pode errar e mandar "responder" com uma oferta de acesso; aqui isso escala.
// shortcut: palavras-chave, com falso positivo que só escala; trocar por classificação do modelo se escalar demais.
const OFERTA_DE_ACESSO =
  /credencia|acess|deploy|autentic|autentiqu|login|logue|logar|senha|token|conta d|\bentr(?:e|ar|a)\b|painel|dashboard|console|conect|\bssh\b|\bvpn\b|github|\bgh\b|ambiente de teste|c[óo]pia do banco|\bdump\b/i;

const REGRAS = `Você é o Auditor automático da Fabriquinha. Um agente que executa um ticket sozinho fez uma pergunta ao Auditor humano.
Responda você só o que for banal; escale o que for estratégico.

Banal (responda):
- issue do SonarQube, teste ou lint falhando: corrigir, sempre;
- permissão para usar docker ou containers: permitido;
- falha vinda de outro ticket ou do ambiente: corrigir a causa, mesmo fora dos caminhos do ticket;
- escolha de como provar ou implementar algo que não muda o critério de aceite: a opção recomendada;
- confirmação de seguir o que o plano ou o ticket já dizem ("posso submeter?", "posso continuar?"): sim.

Fora da revisão (só em revisar_rodada e revisar_demanda):
- pergunta sobre Sonar, PR, deploy, cópia do banco, credencial ou ambiente de teste: responda com a linha
{"decisao":"fora_da_revisao","justificativa":"<o que a pergunta pede fora da revisão>"}

Estratégico (escale):
- toda opção ou resposta que ofereça credencial, acesso ou deploy de teste ao agente;
- mudar interface pública ou arquitetura;
- mudar o plano, o desenho ou um critério de aceite (inclusive dar um critério por inviável);
- abrir demanda nova;
- alterar funcionalidade além do que o ticket pede;
- qualquer coisa de que você não tenha certeza.

Responda com uma única linha JSON e nada mais:
{"decisao":"responder","resposta":"<o rótulo exato de uma opção, ou o texto da resposta se não houver opções>","justificativa":"<a regra que você aplicou>"}
ou, só nas etapas de revisão, a linha fora_da_revisao acima;
ou
{"decisao":"escalar","justificativa":"<por que é decisão do Auditor humano>"}`;

/** O prompt da triagem: as regras, o ticket e a pergunta com as opções. */
export function promptDaTriagem(contexto: ContextoDaPergunta, p: PerguntaDoAgente): string {
  const opcoes =
    p.opcoes.length > 0 ? p.opcoes.map((o) => `- ${o}`).join("\n") : "(sem opções: resposta em texto livre)";
  return [
    REGRAS,
    `Ticket ${contexto.ticket}, etapa ${contexto.etapa}, da demanda "${contexto.demanda}".`,
    `Pergunta: ${p.pergunta}`,
    ...(p.detalhes ? [`Detalhes: ${p.detalhes}`] : []),
    `Opções:\n${opcoes}`,
  ].join("\n\n");
}

const Decisao = z.discriminatedUnion("decisao", [
  z.object({ decisao: z.literal("responder"), resposta: z.string().trim().min(1), justificativa: z.string() }),
  z.object({ decisao: z.literal("escalar"), justificativa: z.string() }),
  z.object({ decisao: z.literal("fora_da_revisao"), justificativa: z.string() }),
]);

/**
 * A resposta na saída do pi, ou `undefined` para escalar. A saída pode trazer texto além do JSON; vale a última linha
 * que é uma decisão. Com opções, a resposta precisa ser um dos rótulos. "Fora da revisão" vale só nas etapas de
 * revisão, com a resposta fixa (mesmo com opções); em outra etapa, escala. Resposta que ofereça credencial, acesso ou
 * deploy de teste também escala.
 */
export function lerDecisao(saida: string, p: PerguntaDoAgente, etapa: string): RespostaDoAuditorAutomatico | undefined {
  const decisao = saida
    .split("\n")
    .map((linha) => {
      try {
        return Decisao.safeParse(JSON.parse(linha.trim())).data;
      } catch {
        return undefined;
      }
    })
    .findLast((d) => d !== undefined);
  if (decisao?.decisao === "fora_da_revisao") {
    return ETAPAS_DE_REVISAO.includes(etapa)
      ? { resposta: RESPOSTA_FORA_DA_REVISAO, justificativa: decisao.justificativa }
      : undefined;
  }
  if (decisao?.decisao !== "responder") return undefined;
  if (p.opcoes.length > 0 && !p.opcoes.includes(decisao.resposta)) return undefined;
  if (OFERTA_DE_ACESSO.test(decisao.resposta)) return undefined;
  return { resposta: decisao.resposta, justificativa: decisao.justificativa };
}

/** Tempo máximo da triagem; passado, escala. */
const LIMITE_TRIAGEM_MS = 3 * 60_000;

/**
 * Triagem da pergunta com o modelo do ticket (`provedor/nome`, ou o padrão do pi). Devolve a resposta para mandar ao
 * agente, ou `undefined` para deixar a pergunta com o Auditor humano.
 */
export async function triarPergunta(
  modelo: { provedor: string; nome: string } | undefined,
  contexto: ContextoDaPergunta,
  p: PerguntaDoAgente,
  rodar: typeof executar = executar,
): Promise<RespostaDoAuditorAutomatico | undefined> {
  const saida = await perguntarAoPiSemFerramentas(promptDaTriagem(contexto, p), modelo, LIMITE_TRIAGEM_MS, rodar);
  return saida === undefined ? undefined : lerDecisao(saida, p, contexto.etapa);
}
