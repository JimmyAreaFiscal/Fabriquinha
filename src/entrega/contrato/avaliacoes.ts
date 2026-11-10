// O contrato da API das avaliações de melhoria do SDLC (D12): a entrada de cada rota e o corpo de cada resposta JSON.
// São só tipos e schemas: quem monta o valor é a consulta, quem o valida na saída é o teste de rota.
import { z } from "zod";

const Texto = z.string();
const Contagem = z.number().int().nonnegative();

/**
 * O projeto e o período (AAAA-MM-DD, inclusivas) que a lista de demandas e a nova avaliação compartilham.
 *
 * @testes a rota de avaliações passa a consumi-lo; o teste do contrato o confere
 */
export const PeriodoDaAvaliacao = z.strictObject({ projeto: z.string().min(1), de: Texto, ate: Texto });

/** @testes a rota de avaliações passa a consumi-lo; o teste do contrato o confere */
export const NovaAvaliacao = PeriodoDaAvaliacao.extend({
  demandas: z.array(z.string().min(1)).optional(),
  pedido: z.string().trim().max(4000).optional(),
});

/** @testes a rota de avaliações passa a consumi-lo; o teste do contrato o confere */
export const NovaMensagemDaAvaliacao = z.strictObject({ texto: z.string().trim().min(1) });

/** @testes a rota de avaliações passa a consumi-lo; o teste do contrato o confere */
export const AvaliacaoCriada = z.object({ id: Texto });

/** @testes a rota de avaliações passa a consumi-lo; o teste do contrato o confere */
export const AchadoEncaminhado = z.object({ demanda: Texto });

const EstadoDaAvaliacao = z.enum(["rodando", "concluida"]);

const ResumoDaAvaliacao = z.object({
  id: Texto,
  projeto: Texto,
  de: Texto,
  ate: Texto,
  pedido: Texto,
  criada_em: Texto,
});

/** Uma linha da lista de avaliações: o resumo, quantos achados ela tem e se o pi ainda trabalha nela. */
export const AvaliacaoNaLista = ResumoDaAvaliacao.extend({ achados: Contagem, estado: EstadoDaAvaliacao });
export type AvaliacaoNaLista = z.infer<typeof AvaliacaoNaLista>;

/** Uma demanda do projeto com sessão terminada no período, que o formulário oferece para o escopo. */
export const DemandaDoPeriodo = z.object({ id: Texto, titulo: Texto });
export type DemandaDoPeriodo = z.infer<typeof DemandaDoPeriodo>;

const AchadoDaAvaliacao = z.object({
  achado_id: Contagem,
  titulo: Texto,
  descricao: Texto,
  evidencia: Texto,
  demanda_id: Texto.nullable(),
});

const UsoDaAvaliacao = z.object({
  modelo_provedor: Texto,
  modelo_nome: Texto,
  chamadas: Contagem,
  tokens_entrada: Contagem,
  tokens_saida: Contagem,
  tokens_cache_leitura: Contagem,
  tokens_cache_escrita: Contagem,
  custo: z.number().nonnegative().nullable(),
});

/**
 * A avaliação aberta: escopo, achados, uso, estado e a conversa (o `prompt.md` vem com `fabriquinha: true`).
 *
 * @testes a rota de avaliações passa a consumi-lo; o teste do contrato o confere
 */
export const DadosDaAvaliacao = ResumoDaAvaliacao.extend({
  demandas: z.array(Texto),
  achados: z.array(AchadoDaAvaliacao),
  uso: z.array(UsoDaAvaliacao),
  estado: EstadoDaAvaliacao,
  conversa: z.array(z.unknown()),
});
export type DadosDaAvaliacao = z.infer<typeof DadosDaAvaliacao>;
