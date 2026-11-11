// Confere a aprovação de uma revisão pela evidência (comparacao-sdlc-implementacao.md §§4, 8): o `veredito` é derivado dos
// `dados` na hora, sem I/O. Recusa citando a evidência, a fitness, o achado ou o cenário que impede a aprovação.
import type { AgregadoDemanda } from "../../../demanda/nucleo/agregado_demanda.ts";
import { formatarTicketRef } from "../../../demanda/nucleo/demanda.ts";
import { CATALOGO_ETAPAS, catalogoDaEtapa } from "../../../qualidade/nucleo/evidencias/evidencia_etapa.ts";
import { ErroDeRegra } from "../../../compartilhado/nucleo/erros.ts";
import { evidenciasPendentes, schemaDoTipo } from "../../../qualidade/nucleo/evidencias/evidencia.ts";

type Dados = Record<string, unknown>;
interface Linha {
  nome: string;
  codigoSaida: number | null;
}
const ALTA = new Set(["alta", "critica"]);

/** O que reprovou a evidência, para a recusa dizer o que corrigir. */
function detalhe(tipo: string, dados: Dados): string {
  if (tipo === "matriz_fitness") {
    const nomes = (dados.linhas as Linha[]).filter((l) => l.codigoSaida !== 0).map((l) => l.nome);
    return `fitness que falhou: ${nomes.join(", ")}`;
  }
  if (tipo === "analise_seguranca") {
    const achados = (dados.achados as { descricao: string; severidade: string }[]).filter((a) =>
      ALTA.has(a.severidade),
    );
    return `achado alto ou crítico: ${achados.map((a) => `${a.descricao} (${a.severidade})`).join("; ")}`;
  }
  if (tipo === "testes_estresse") {
    const nomes = (dados.cenarios as { nome: string; resultado: string }[])
      .filter((c) => c.resultado === "quebrou")
      .map((c) => c.nome);
    return `cenário que quebrou: ${nomes.join(", ")}`;
  }
  return "critério não atendido";
}

/** Lança ErroDeRegra se as evidências do ticket não sustentam a aprovação; senão não faz nada. */
export function conferirAprovacao(ag: AgregadoDemanda, ticket_id: number): void {
  const ticket = ag.tickets.find((t) => t.ticket_id === ticket_id);
  if (ticket === undefined)
    throw new ErroDeRegra(
      `o ticket ${formatarTicketRef({ demanda_id: ag.demanda.id, ticket_id })} não existe`,
      "use um ticket da demanda",
    );
  const { demanda_id, etapa } = ticket;
  const doTicket = ag.evidencias.filter((e) => e.ticket_id === ticket_id && e.rodada_id === undefined);
  const reprovadas: { tipo: string; dados: Dados }[] = [];
  for (const { tipo } of catalogoDaEtapa(etapa)) {
    const e = doTicket.find((x) => x.tipo === tipo);
    if (e === undefined) continue;
    const dados = e.dados as Dados;
    if ((tipo === "testes_estresse" || tipo === "analise_seguranca") && dados.aplicavel === false) {
      const resultado = schemaDoTipo(tipo).dados.safeParse(dados);
      if (!resultado.success) {
        throw new ErroDeRegra(
          `a evidência ${tipo} está marcada como não se aplica sem justificativa`,
          "informe a justificativa de por que não se aplica",
        );
      }
    }
    if (schemaDoTipo(tipo).veredito?.(dados) === "nao_atende") reprovadas.push({ tipo, dados });
  }
  const motivos = [
    ...evidenciasPendentes(ag, ticket, CATALOGO_ETAPAS).map((t) => `${t} ausente`),
    ...reprovadas.map(({ tipo, dados }) => `${tipo} reprovada (${detalhe(tipo, dados)})`),
  ];
  if (motivos.length > 0) {
    throw new ErroDeRegra(
      `a aprovação do ticket ${formatarTicketRef({ demanda_id, ticket_id })} foi rejeitada: ${motivos.join("; ")}`,
      "corrija a evidência e decida de novo, ou reprove",
    );
  }
}
