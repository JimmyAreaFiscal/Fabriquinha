// Confere a aprovação de uma revisão pela evidência (comparacao-sdlc-implementacao.md §§4, 8): `aprovada` é derivada dos
// `dados` na hora, sem I/O. Recusa citando a evidência, a fitness, o achado ou o cenário que impede a aprovação.
import type { AgregadoDemanda } from "../dominio/agregado_demanda.ts";
import { type EvidenciaEtapa, pendenciasDoTicket } from "../dominio/evidencia_etapa.ts";
import { ErroDeRegra } from "../dominio/erros.ts";
import { type SchemaEvidencia, schemaDe, schemaDeEtapa } from "../evidencias/schemas.ts";

type Dados = Record<string, unknown>;
interface Linha {
  nome: string;
  codigoSaida: number | null;
}
const ALTA = new Set(["alta", "critica"]);

/** Esses schemas sempre definem `aprovada`. */
const daSchema = (s: SchemaEvidencia) => (dados: Dados) => (s.aprovada as (d: Dados) => boolean).call(s, dados);

/** `aprovada` por tipo; os tipos fora da tabela não têm regra binária. */
const APROVADA: Record<string, (dados: Dados) => boolean> = {
  matriz_fitness: (d) => (d as { linhas: Linha[] }).linhas.every((l) => l.codigoSaida === 0),
  comprovacao_criterios: (d) => daSchema(schemaDe("comprovacao_criterios"))(d),
  testes_estresse: (d) => daSchema(schemaDeEtapa("testes_estresse"))(d),
  analise_seguranca: (d) => daSchema(schemaDeEtapa("analise_seguranca"))(d),
};

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
  if (ticket === undefined) throw new ErroDeRegra(`o ticket ${String(ticket_id)} não existe na demanda`);
  const { demanda_id, etapa } = ticket;
  const doTicket = ag.evidencias.filter((e) => e.ticket_id === ticket_id && e.rodada_id === undefined);
  const evidencias: EvidenciaEtapa[] = [];
  for (const e of doTicket) {
    const dados = e.dados as Dados;
    if ((e.tipo === "testes_estresse" || e.tipo === "analise_seguranca") && dados.aplicavel === false) {
      const resultado = schemaDeEtapa(e.tipo).dados.safeParse(dados);
      if (!resultado.success) {
        throw new ErroDeRegra(
          `a evidência ${e.tipo} está marcada como não se aplica sem justificativa`,
          "informe a justificativa de por que não se aplica",
        );
      }
    }
    evidencias.push({
      demanda_id,
      rodada_id: undefined,
      ticket_id,
      tipo: e.tipo,
      produtor: "agente",
      aprovada: APROVADA[e.tipo]?.(dados),
      dados,
    });
  }
  const { ausentes, reprovadas } = pendenciasDoTicket({ demanda_id, ticket_id, etapa }, evidencias);
  const motivos = [
    ...ausentes.map((t) => `${t} ausente`),
    ...reprovadas.map((t) => `${t} reprovada (${detalhe(t, evidencias.find((e) => e.tipo === t)?.dados as Dados)})`),
  ];
  if (motivos.length > 0) {
    throw new ErroDeRegra(
      `a aprovação do ticket ${String(ticket_id)} foi recusada: ${motivos.join("; ")}`,
      "corrija a evidência e decida de novo, ou reprove",
    );
  }
}
