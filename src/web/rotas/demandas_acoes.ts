// Ações do Auditor sobre as demandas (comparacao-sdlc §9.1): os gates (demanda, planejamento, PR da rodada) e a sessão
// de ajustes. Cada rota valida o corpo, chama o serviço da aplicação como AUDITOR e devolve o erro dele como está.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { AUDITOR } from "../../dominio/agregado.ts";
import { formatarRodadaRef, interpretarRef } from "../../dominio/demanda.ts";
import { reabrirTicket } from "../../dominio/transicoes_demanda.ts";
import { ErroDeRegra, existe } from "../../dominio/erros.ts";
import { aprovarPRRodada } from "../../execucao/aprovacao_pr_rodada.ts";
import type { RefRodada } from "../../execucao/encerramento_rodada.ts";
import { arquivar, cancelar, decidir } from "../../execucao/gestao_demandas.ts";
import { aprovarPlanejamentoDemanda, reprovarPlanejamentoDemanda } from "../../execucao/planejamento.ts";
import { texto, type Mensagem } from "../../execucao/historico.ts";
import {
  concluirSessaoAjustes,
  enviarMensagemAjustes,
  mensagensRetomadas,
  reprovarPRRodada,
} from "../../execucao/sessao_ajustes.ts";
import { lerConversa } from "../../execucao/sessoes.ts";
import { raizDo } from "../../persistencia/banco.ts";
import { carregarDemanda, comDemanda } from "../../persistencia/demandas.ts";
import { configuracao } from "../../persistencia/servico.ts";
import { carregarSessoesDoTicket } from "../../persistencia/sessoes.ts";
import type { Pedido, Rota } from "../rotas.ts";

const NOTA = "a nota vai de 1 a 5";
const Nota = z.number({ error: NOTA }).int(NOTA).min(1, NOTA).max(5, NOTA);
const Motivo = (de: string) =>
  z
    .string({ error: `informe o motivo ${de}` })
    .trim()
    .min(1, `informe o motivo ${de}`);

/** Aprovar (com nota, quando o gate a aceita) ou reprovar (com motivo e, no PR, sem nota). */
const Decisao = z.object({ aprovado: z.boolean(), nota: Nota.optional(), motivo: z.string().optional() });
const DecisaoDoPlanejamento = z.discriminatedUnion("aprovado", [
  z.object({ aprovado: z.literal(true), nota: Nota.optional() }),
  z.object({ aprovado: z.literal(false), motivo: Motivo("da reprovação do planejamento") }),
]);
const DecisaoDoPR = z.discriminatedUnion("aprovado", [
  z.object({ aprovado: z.literal(true), nota: Nota }),
  z.object({
    aprovado: z.literal(false),
    motivo: Motivo("da reprovação do PR"),
    nota: z.never({ error: "a reprovação não leva nota" }).optional(),
  }),
]);

const agora = () => ({ agora: new Date().toISOString() });

/** O `:ref` do caminho como rodada (`I-206.R2`). */
function refDaRodada({ params }: Pedido): RefRodada {
  const ref = interpretarRef(String(params.ref));
  if (!("rodada_id" in ref))
    throw new ErroDeRegra(`${String(params.ref)} não é uma rodada`, "use o endereço da rodada, como I-206.R2");
  return ref;
}

/** O ticket `sessao_em_aberto` mais recente da rodada. */
const sessaoDaRodada = (pedido: Pedido, ref: RefRodada) =>
  existe(
    carregarDemanda(pedido.banco, ref.demanda_id).tickets.findLast(
      (t) => t.rodada_id === ref.rodada_id && t.etapa === "sessao_em_aberto",
    ),
    `a rodada ${formatarRodadaRef(ref)} não tem sessão de ajustes`,
    "só a rodada com o PR reprovado tem sessão de ajustes",
  );

const limite = (pedido: Pedido) => ({ limiteMin: configuracao(pedido.banco).timeoutMin });

function decisaoDaDemanda({ banco, params, corpo }: Pedido) {
  return decidir(banco, String(params.id), Decisao.parse(corpo), AUDITOR, agora());
}

async function decisaoDoPlanejamento({ banco, params, corpo }: Pedido) {
  const id = String(params.id);
  const decisao = DecisaoDoPlanejamento.parse(corpo);
  return decisao.aprovado
    ? aprovarPlanejamentoDemanda(banco, id, { nota: decisao.nota })
    : reprovarPlanejamentoDemanda(banco, id, decisao.motivo);
}

async function decisaoDoPR(pedido: Pedido) {
  const ref = refDaRodada(pedido);
  const decisao = DecisaoDoPR.parse(pedido.corpo);
  if (decisao.aprovado) return aprovarPRRodada(pedido.banco, ref, decisao.nota, AUDITOR);
  const { id } = await reprovarPRRodada(pedido.banco, ref, decisao.motivo, AUDITOR, limite(pedido));
  return { sessao: id };
}

/**
 * Troca o prompt montado que carrega uma mensagem do Auditor (retomada com o pi parado) pelo texto dele; os demais
 * prompts montados ganham `fabriquinha: true`, que a tela omite.
 * shortcut: a ligação é por `Motivo: <texto>` e pode casar com o prompt de abertura se o Auditor repetir o motivo da
 * reprovação; upgrade: gravar o id da execução junto da mensagem.
 */
function marcarPrompts(entradas: unknown[], prompts: Set<string>, mensagens: string[]): unknown[] {
  const livres = [...mensagens];
  return entradas.map((entrada) => {
    const m = (entrada as { message?: Mensagem } | undefined)?.message;
    if (m?.role !== "user" || !prompts.has(texto(m))) return entrada;
    const i = livres.findIndex((l) => texto(m).includes(`Motivo: ${l}`));
    if (i < 0) return { ...(entrada as object), fabriquinha: true };
    const [auditor] = livres.splice(i, 1);
    return { ...(entrada as object), message: { ...m, content: auditor } };
  });
}

function conversa(pedido: Pedido) {
  const ref = refDaRodada(pedido);
  const ticket = sessaoDaRodada(pedido, ref);
  const estado = carregarSessoesDoTicket(pedido.banco, ticket);
  const sessao = existe(
    estado.sessoes[0],
    "a sessão de ajustes ainda não tem conversa",
    "a conversa nasce quando o pi sobe",
  );
  const raiz = raizDo(pedido.banco);
  const prompts = new Set(
    estado.execucoes
      .map((e) => join(raiz, "execucoes", `E-${e.id}`, "prompt.md"))
      .filter((p) => existsSync(p))
      .map((p) => readFileSync(p, "utf8")),
  );
  return {
    conversa: marcarPrompts(lerConversa(raiz, sessao.id), prompts, mensagensRetomadas(pedido.banco, ref)),
  };
}

const Mensagem = z.object({
  texto: z.string({ error: "informe o texto da mensagem" }).trim().min(1, "informe o texto da mensagem"),
});

function mensagem(pedido: Pedido): void {
  const ref = refDaRodada(pedido);
  const { texto } = Mensagem.parse(pedido.corpo);
  const rodada = carregarDemanda(pedido.banco, ref.demanda_id).rodadas.find((r) => r.rodada_id === ref.rodada_id);
  if (rodada?.fase !== "sessao" || !["aberto", "em_execucao"].includes(sessaoDaRodada(pedido, ref).status)) {
    throw new ErroDeRegra(
      `a rodada ${formatarRodadaRef(ref)} não tem sessão de ajustes aberta`,
      "mensagem só na sessão aberta pela reprovação do PR",
    );
  }
  enviarMensagemAjustes(pedido.banco, ref, texto, AUDITOR, limite(pedido));
}

const concluir = (pedido: Pedido) => concluirSessaoAjustes(pedido.banco, refDaRodada(pedido), AUDITOR);

/** O `:ref` do caminho como ticket (`I-206.T3`). */
function refDoTicket({ params }: Pedido) {
  const ref = interpretarRef(String(params.ref));
  if (!("ticket_id" in ref))
    throw new ErroDeRegra(`${String(params.ref)} não é um ticket`, "use o endereço do ticket, como I-206.T3");
  return ref;
}

const Reabertura = z.object({ instrucao: Motivo("da reabertura, como instrução para o ticket") });

function reabrir(pedido: Pedido) {
  const { demanda_id, ticket_id } = refDoTicket(pedido);
  const { instrucao } = Reabertura.parse(pedido.corpo);
  const ag = comDemanda(pedido.banco, demanda_id, (d) => reabrirTicket(d, { ticket_id, instrucao }, AUDITOR, agora()));
  return {
    ticket: existe(
      ag.tickets.find((t) => t.ticket_id === ticket_id),
      "ticket não encontrado",
      "confira o endereço",
    ),
  };
}

async function executar(pedido: Pedido): Promise<void> {
  const { agendador } = pedido;
  if (!agendador.executarAgoraDemanda)
    throw new ErroDeRegra(
      "o agendador não executa tickets de demanda",
      "suba a Fabriquinha com o serviço (fabriquinha servir)",
    );
  await agendador.executarAgoraDemanda(refDoTicket(pedido));
}

const cancelamento = ({ banco, params }: Pedido) => cancelar(banco, String(params.id), AUDITOR, agora());
const arquivamento = ({ banco, params }: Pedido) => ({
  demanda: arquivar(banco, String(params.id), AUDITOR, agora()),
});

export const ROTAS_DAS_ACOES_DE_DEMANDA: Rota[] = [
  { metodo: "POST", caminho: "/api/demandas/:id/decisao", tratar: decisaoDaDemanda },
  { metodo: "POST", caminho: "/api/demandas/:id/planejamento/decisao", tratar: decisaoDoPlanejamento },
  { metodo: "POST", caminho: "/api/demandas/rodadas/:ref/pr", tratar: decisaoDoPR },
  { metodo: "GET", caminho: "/api/demandas/rodadas/:ref/ajustes", tratar: conversa },
  { metodo: "POST", caminho: "/api/demandas/rodadas/:ref/ajustes/mensagens", tratar: mensagem },
  { metodo: "POST", caminho: "/api/demandas/rodadas/:ref/ajustes/concluir", tratar: concluir },
  { metodo: "POST", caminho: "/api/demandas/tickets/:ref/reabrir", tratar: reabrir },
  { metodo: "POST", caminho: "/api/demandas/tickets/:ref/executar", tratar: executar },
  { metodo: "POST", caminho: "/api/demandas/:id/cancelar", tratar: cancelamento },
  { metodo: "POST", caminho: "/api/demandas/:id/arquivar", tratar: arquivamento },
];
