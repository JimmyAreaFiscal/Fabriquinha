// A avaliação de uma submissão (F3 §5): o formato (`validarFormato`, puro) e o contexto, que chega como dado de quem
// submete. O resultado é a evidência aceita, com os `dados` validados, ou a submissão recusada, com o motivo. Aceitar
// uma evidência não decide gate: o avanço é do Processo.
import { basename } from "node:path";
import type { Ator, Endereco, ItemCatalogoEtapa, TipoEvidencia } from "../../etapas/publico.ts";
import { ErroDeEscopo, ErroDeRegra } from "../../../../shared/nucleo/erros.ts";
import { schemaDoTipo, validarFormato } from "./formatos.ts";
import { exigirAutoria } from "../../../../shared/nucleo/demanda/ator.ts";
import type { ContextoDaAvaliacao, Veredito } from "./schemas.ts";

/** O que se submete à Etapa: `anexos` são os caminhos dos arquivos, que a Etapa ainda não abriu. */
export interface SubmissaoDeEvidencia {
  tipo: TipoEvidencia;
  dono: Endereco;
  produtor: Ator;
  dados: unknown;
  anexos: readonly string[];
}

/** Aceita, com os `dados` já validados pelo schema, ou recusada, com o motivo escrito para quem submeteu. */
export type Avaliacao =
  | { resultado: "aceita"; dados: Record<string, unknown>; veredito?: Veredito }
  | { resultado: "recusada"; motivo: string };

/**
 * O contexto como as regras cruzadas e a aula o leem: só os tickets da rodada (e os sem rodada) e, nos critérios de
 * aceite, só os que ela cita. Sem rodada, o contexto inteiro.
 */
export function agregadoDaRodada<Contexto extends ContextoDaAvaliacao>(ag: Contexto, rodada?: number): Contexto {
  if (rodada === undefined) return ag;
  const citados = ag.criterios_citados.filter((c) => c.rodada_id === rodada).map((c) => c.criterio_id);
  return {
    ...ag,
    tickets: ag.tickets.filter((t) => t.rodada_id === undefined || t.rodada_id === rodada),
    evidencias: ag.evidencias.map((e) =>
      e.tipo === "criterios_aceite"
        ? { ...e, dados: { criterios: (e.dados.criterios as { id: string }[]).filter((c) => citados.includes(c.id)) } }
        : e,
    ),
  };
}

/** Os tipos obrigatórios da Etapa do ticket que ainda não têm Evidência, na ordem do catálogo. */
export function evidenciasPendentes(
  ag: Pick<ContextoDaAvaliacao, "evidencias">,
  ticket: Pick<ContextoDaAvaliacao["tickets"][number], "ticket_id" | "etapa">,
  catalogo: readonly ItemCatalogoEtapa[],
): TipoEvidencia[] {
  const daDemanda = catalogo.some((i) => i.etapa === ticket.etapa && i.dono === "demanda");
  const dono = daDemanda ? undefined : ticket.ticket_id;
  const presentes = new Set(
    ag.evidencias.filter((e) => e.rodada_id === undefined && e.ticket_id === dono).map((e) => e.tipo),
  );
  return catalogo.filter((i) => i.etapa === ticket.etapa && i.obrigatoria && !presentes.has(i.tipo)).map((i) => i.tipo);
}

/** Onde a submissão cai no catálogo: o ticket dono (ausente na evidência da demanda), como citá-lo e o item da Etapa. */
interface LugarNoCatalogo {
  ticket?: ContextoDaAvaliacao["tickets"][number];
  onde: string;
  item: ItemCatalogoEtapa;
}

/**
 * Aceita ou recusa uma submissão por um caminho só: o lugar no catálogo da Etapa (dono, tipo, produtor), o formato
 * (schema e anexos) e o contexto (regras cruzadas, plano, veredito e autoria). `validarPlano` é a regra de quem é dono
 * do plano, e entra pelo construtor com o contexto que ela precisa.
 */
export class AvaliadorDeEvidencia<Contexto extends ContextoDaAvaliacao = ContextoDaAvaliacao> {
  private readonly catalogo: readonly ItemCatalogoEtapa[];
  private readonly validarPlano: (ag: Contexto, entrada: unknown, ator: Ator) => unknown;

  constructor(
    catalogo: readonly ItemCatalogoEtapa[],
    validarPlano: (ag: Contexto, entrada: unknown, ator: Ator) => unknown,
  ) {
    this.catalogo = catalogo;
    this.validarPlano = validarPlano;
  }

  avaliar(ag: Contexto, submissao: SubmissaoDeEvidencia): Avaliacao {
    try {
      return this.avaliarOuLancarRecusa(ag, submissao);
    } catch (erro) {
      if (erro instanceof ErroDeRegra || erro instanceof ErroDeEscopo) {
        return { resultado: "recusada", motivo: erro.message };
      }
      throw erro;
    }
  }

  private avaliarOuLancarRecusa(ag: Contexto, submissao: SubmissaoDeEvidencia) {
    const lugar = this.exigirLugarNoCatalogo(ag, submissao);
    const validos = validarFormato(submissao.tipo, submissao.dados, submissao.anexos);
    const veredito = this.conferirContexto(ag, submissao, lugar, validos);
    return { resultado: "aceita", dados: validos, veredito } satisfies Avaliacao;
  }

  private exigirLugarNoCatalogo(ag: Contexto, { tipo, dono, produtor }: SubmissaoDeEvidencia): LugarNoCatalogo {
    if (dono.demanda_id !== ag.demanda.id || dono.rodada_id !== undefined) {
      throw new ErroDeRegra(
        `a evidência ${tipo} tem dono errado: ${dono.toString()}`,
        `use a demanda ${ag.demanda.id} ou um ticket dela`,
      );
    }
    const ticket = ag.tickets.find((t) => t.ticket_id === dono.ticket_id);
    if (dono.ticket_id !== undefined && ticket === undefined) {
      throw new ErroDeRegra(`o ticket ${dono.toString()} não existe`, "use um ticket da demanda");
    }
    const onde = ticket ? `T-${String(ticket.ticket_id)} (${ticket.etapa})` : `a demanda ${ag.demanda.id}`;
    // Sem ticket, a evidência é da própria demanda: a da Etapa cujas evidências são dela.
    const daEtapa = this.catalogo.filter((i) => (ticket ? i.etapa === ticket.etapa : i.dono === "demanda"));
    const item = daEtapa.find((i) => i.tipo === tipo);
    if (item === undefined) {
      throw new ErroDeRegra(
        `${onde} não aceita evidência ${tipo}`,
        `use um de ${daEtapa.map((i) => i.tipo).join(", ") || "nenhum tipo"}`,
      );
    }
    if (produtor.tipo !== item.produtor) {
      throw new ErroDeEscopo(
        `a evidência ${tipo} de ${onde} é produzida por ${item.produtor}`,
        `não por ${produtor.tipo}`,
      );
    }
    return { ticket, onde, item };
  }

  /** As regras que dependem do contexto, depois do formato; devolve o veredito do conteúdo, quando o tipo tem um. */
  private conferirContexto(
    ag: Contexto,
    { tipo, dono, produtor, anexos }: SubmissaoDeEvidencia,
    { ticket, onde, item }: LugarNoCatalogo,
    validos: Record<string, unknown>,
  ): Veredito | undefined {
    const schema = schemaDoTipo(tipo);
    schema.cruzar?.(validos, {
      ag: agregadoDaRodada(ag, ticket?.rodada_id),
      ticket: ticket?.ticket_id,
      anexos: anexos.map((caminho) => basename(caminho)),
    });
    if (tipo === "plano") this.validarPlano(ag, validos, produtor);
    const veredito = schema.veredito?.(validos);
    // Verificação da Fabriquinha que não atende não é evidência; o parecer que não atende é conteúdo e entra.
    if (veredito === "nao_atende" && item.produtor === "fabriquinha" && item.regraAprovacao !== null) {
      throw new ErroDeRegra(
        `a evidência ${tipo} de ${onde} não atende a regra ${item.regraAprovacao}`,
        "corrija o que a verificação apontou",
      );
    }
    // Antes do envio só a autora submete; depois, a definição da demanda fica congelada (§3).
    if (!ag.demanda.enviada) exigirAutoria(ag.demanda, produtor, "submeter evidência da");
    else if (dono.ticket_id === undefined) {
      throw new ErroDeRegra(
        `a demanda ${ag.demanda.id} já foi enviada e a evidência ${tipo} da definição está congelada`,
        "só evidências de ticket entram depois do envio",
      );
    }
    return veredito;
  }
}
