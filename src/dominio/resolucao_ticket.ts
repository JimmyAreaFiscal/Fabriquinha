// Resolução de modelo/effort do ticket e classificação da saída do E2E (comparacao-sdlc-implementacao.md §7.1 e §11, D07).
import { ErroDeRegra } from "./erros.ts";
import type { TicketDemanda } from "./agregado_demanda.ts";
import type { Projeto } from "./configuracao_projeto.ts";
import type { Effort } from "./primitivos.ts";

type Origem = "ticket" | "etapa" | "padrao";
interface ParModelo {
  provedor: string;
  nome: string;
}
type Campos = Pick<TicketDemanda, "modelo_provedor" | "modelo_nome" | "effort">;

/** O par provedor + nome da fonte, `undefined` se não tem modelo; metade do par é erro. */
function parModelo(fonte: Campos): ParModelo | undefined {
  const { modelo_provedor: provedor, modelo_nome: nome } = fonte;
  if (provedor === undefined && nome === undefined) return undefined;
  if (provedor === undefined || nome === undefined)
    throw new ErroDeRegra("informe modelo_provedor e modelo_nome juntos ou nenhum");
  return { provedor, nome };
}

/** Modelo e effort, cada um sozinho: o do ticket, senão o da etapa do projeto, senão o padrão do harness (sem valor). */
export function resolverModeloEffort(
  ticket: Campos,
  etapa: Projeto["etapas"][number] | undefined,
): { modelo: { valor?: ParModelo; origem: Origem }; effort: { valor?: Effort; origem: Origem } } {
  const doTicket = parModelo(ticket);
  const daEtapa = etapa === undefined ? undefined : parModelo(etapa);
  const modelo =
    doTicket !== undefined
      ? { valor: doTicket, origem: "ticket" as const }
      : daEtapa !== undefined
        ? { valor: daEtapa, origem: "etapa" as const }
        : { origem: "padrao" as const };
  const effort =
    ticket.effort !== undefined
      ? { valor: ticket.effort, origem: "ticket" as const }
      : etapa?.effort !== undefined
        ? { valor: etapa.effort, origem: "etapa" as const }
        : { origem: "padrao" as const };
  return { modelo, effort };
}

/** 0 passou; `codigo_falha` é teste reprovado (reprovação técnica, D05); qualquer outro código é falha de infraestrutura e bloqueia. */
export function classificarSaidaE2E(
  codigo_falha: number,
  saida: number,
): "passou" | "reprovado" | "falha_infraestrutura" {
  if (saida === 0) return "passou";
  return saida === codigo_falha ? "reprovado" : "falha_infraestrutura";
}
