// Catálogo de evidências por etapa (F1 §3.9) e C17 registrarEvidencia. O conteúdo de cada tipo é do F3.
import { z } from "zod";
import {
  type Agregado,
  type Ator,
  type Contexto,
  Evidencia,
  exigirExecucaoEmAndamento,
  type Produtor,
  type Ticket,
  TipoEvidencia,
} from "./agregado.ts";
import { ErroDeEscopo, ErroDeRegra } from "./erros.ts";
import { rotuloTicket, ticketDe } from "./execucao.ts";
import { type Etapa, Id } from "./primitivos.ts";

/**
 * `aprovada`: obrigatória e com `aprovada = true`; `funcionalidade`: obrigatória só se a issue é funcionalidade; `nao`:
 * o agente decide se a produz.
 */
export type Obrigatoria = "sim" | "aprovada" | "funcionalidade" | "nao";

export interface ItemCatalogo {
  readonly etapa: Etapa;
  readonly tipo: TipoEvidencia;
  readonly produtor: Produtor;
  readonly obrigatoria: Obrigatoria;
}

const item = (etapa: Etapa, tipo: TipoEvidencia, produtor: Produtor, obrigatoria: Obrigatoria = "sim") => ({
  etapa,
  tipo,
  produtor,
  obrigatoria,
});

/** F1 §3.9. `matriz_fitness` aparece em duas etapas; `sessao` não tem evidência. */
export const CATALOGO: readonly ItemCatalogo[] = [
  item("registro", "comportamento", "agente"),
  item("registro", "criterios_aceite", "agente"),
  item("desenho", "desenho_solucao", "agente"),
  item("desenho", "prototipo", "agente", "funcionalidade"),
  item("desenho", "relatorio_complexidade", "agente"),
  item("desenho", "relatorio_impactos_arquitetura", "agente"),
  item("desenvolvimento", "execucao_testes", "fabriquinha", "aprovada"),
  item("desenvolvimento", "matriz_fitness", "fabriquinha", "aprovada"),
  item("desenvolvimento", "relatorio_sonar", "fabriquinha", "aprovada"),
  item("revisao", "arquivos_alterados", "fabriquinha"),
  item("revisao", "matriz_fitness", "fabriquinha"),
  item("revisao", "explicacao_fitness", "agente"),
  item("revisao", "comprovacao_criterios", "agente"),
  item("encerramento", "mensagem_pr", "agente"),
  item("encerramento", "aula_codigo", "agente"),
  // Só quando a mudança aparece no cliente (frontend); quem decide é o agente (artefato-video-demonstracao).
  item("encerramento", "video_demonstracao", "agente", "nao"),
  item("encerramento", "relatorio_produtividade", "fabriquinha"),
  item("encerramento", "pr_aberto", "fabriquinha"),
];

/**
 * As evidências obrigatórias (F1 §3.9) que faltam em `ticket`: ausentes, ou sem `aprovada = true` quando o catálogo
 * a exige. `prototipo` só é obrigatório quando a issue é funcionalidade.
 */
export function evidenciasFaltando(ag: Agregado, ticket: Ticket): TipoEvidencia[] {
  return CATALOGO.filter((c) => {
    if (c.etapa !== ticket.etapa || c.obrigatoria === "nao") return false;
    if (c.obrigatoria === "funcionalidade" && ag.issue.tipo !== "funcionalidade") return false;
    const e = ag.evidencias.find((x) => x.ticket === ticket.id && x.tipo === c.tipo);
    return !e || (c.obrigatoria === "aprovada" && e.aprovada !== true);
  }).map((c) => c.tipo);
}

/**
 * C7, C10 e C25: lança dizendo o que falta ou está reprovado e quem resolve (F1 §7): o agente submete as dele; as da
 * Fabriquinha ela coleta de novo depois do pi. `acao` é o que o ticket não pode fazer sem elas.
 */
export function exigirEvidencias(ag: Agregado, ticket: Ticket, acao = "concluir"): void {
  const faltam = evidenciasFaltando(ag, ticket);
  if (faltam.length === 0) return;
  const t = rotuloTicket(ticket);
  const existe = (tipo: TipoEvidencia) => ag.evidencias.some((e) => e.ticket === ticket.id && e.tipo === tipo);
  const doAgente = (tipo: TipoEvidencia) =>
    CATALOGO.some((c) => c.etapa === ticket.etapa && c.tipo === tipo && c.produtor === "agente");
  const ausentes = faltam.filter((tipo) => !existe(tipo));
  const reprovadas = faltam.filter(existe);
  const doAgenteFaltando = faltam.filter(doAgente);
  const problemas = [
    ...(ausentes.length > 0 ? [`falta a evidência ${ausentes.join(", ")}`] : []),
    ...(reprovadas.length > 0 ? [`a evidência ${reprovadas.join(", ")} está reprovada`] : []),
  ];
  const solucoes = [
    ...(doAgenteFaltando.length > 0
      ? [
          `o agente de ${t} submete com ${doAgenteFaltando.map((tipo) => "fabriquinha evidencia add " + tipo).join(" e ")}`,
        ]
      : []),
    ...(doAgenteFaltando.length < faltam.length ? ["a Fabriquinha coleta depois do pi; execute o ticket de novo"] : []),
  ];
  throw new ErroDeRegra(`${t} não pode ${acao}: ${problemas.join("; ")}`, solucoes.join("; "));
}

/**
 * Pré-condições de C17. O F3 as confere antes de validar e guardar o conteúdo (F3 §5, passos 1 e 2), e C17 de novo
 * dentro da transação. Devolve o item do catálogo, com o produtor.
 */
export function exigirRegistroDeEvidencia(ag: Agregado, ator: Ator, id: Id, tipo: TipoEvidencia): ItemCatalogo {
  const acao = `registrar evidência em T-${String(id)}`;
  if (ator.tipo === "auditor") {
    throw new ErroDeEscopo(`o Auditor não pode ${acao}`, "quem registra é o agente do ticket ou a própria Fabriquinha");
  }
  if (ator.tipo === "agente" && ator.ticket !== id) {
    throw new ErroDeEscopo(
      `o agente de T-${String(ator.ticket)} não pode ${acao}`,
      "cada agente registra só no próprio ticket",
    );
  }
  const ticket = ticketDe(ag, id);
  const t = rotuloTicket(ticket);
  if (ator.tipo === "agente") exigirExecucaoEmAndamento(ag, ator, acao);
  if (ticket.status !== "em_execucao") {
    throw new ErroDeRegra(
      `${t} está ${ticket.status}, não em execução`,
      "só se registra evidência de ticket em execução",
    );
  }
  const doTicket = CATALOGO.filter((i) => i.etapa === ticket.etapa);
  const achado = doTicket.find((i) => i.tipo === tipo);
  if (!achado) {
    const aceitos = doTicket.map((i) => i.tipo).join(", ") || "nenhuma";
    throw new ErroDeRegra(
      `${tipo} não é evidência da etapa ${ticket.etapa}`,
      `a etapa ${ticket.etapa} aceita: ${aceitos}`,
    );
  }
  // Princípio 2 da visão geral: o agente não declara o que a máquina mede.
  if (achado.produtor !== ator.tipo) {
    throw achado.produtor === "fabriquinha"
      ? new ErroDeEscopo(`o agente não pode submeter ${tipo}`, "quem a produz é a Fabriquinha, ao fim da execução")
      : new ErroDeEscopo(`a Fabriquinha não produz ${tipo}`, `quem a submete é o agente de ${t}`);
  }
  return achado;
}

const EntradaEvidencia = z.object({
  ticket: Id,
  tipo: TipoEvidencia,
  aprovada: z.boolean().optional(),
  dados: Evidencia.shape.dados,
  arquivos: Evidencia.shape.arquivos,
});

/** C17: grava os metadados com o conteúdo já validado pelo F3; o mesmo tipo no mesmo ticket substitui o anterior. */
export function registrarEvidencia(ag: Agregado, entrada: unknown, ator: Ator, ctx: Contexto): Agregado {
  const { ticket, tipo, aprovada, dados, arquivos } = EntradaEvidencia.parse(entrada);
  const { produtor } = exigirRegistroDeEvidencia(ag, ator, ticket, tipo);
  const nova: Evidencia = {
    id: ctx.novoId("evidencia"),
    ticket,
    tipo,
    produtor,
    ...(aprovada !== undefined && { aprovada }),
    dados,
    arquivos,
    em: ctx.agora,
  };
  return {
    ...ag,
    evidencias: [...ag.evidencias.filter((e) => e.ticket !== ticket || e.tipo !== tipo), nova],
  };
}
