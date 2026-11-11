// O contrato das rotas da Configuração (F7 §4.2): o que cada resposta e cada formulário carregam. Só tipos e schemas.
import { z } from "zod";
import { ConfiguracaoAgente, Modelo } from "../../execucao/nucleo/configuracao_agente.ts";
import { EtapaTicket } from "../../compartilhado/nucleo/primitivos.ts";
import { ComandosDePreparacao, ConfiguracaoDoAmbiente, Hospedagem, Projeto } from "../../ambiente/nucleo/projeto.ts";

/** `GET` e `POST /api/configuracao`: a configuração do F4 §3 e a próxima busca do agendador, só ligado. */
export const EstadoDaConfiguracao = z.strictObject({
  agendadorAtivo: z.boolean(),
  intervaloMin: z.number(),
  timeoutMin: z.number(),
  ociosidadeMin: z.number(),
  modeloAuditoria: Modelo.nullable(),
  proximaBusca: z.string().nullable(),
});
export type EstadoDaConfiguracao = z.infer<typeof EstadoDaConfiguracao>;

const AmbienteDoConjunto = z.strictObject({
  id: z.string(),
  container_id: z.string(),
  imagem: z.string(),
  estado: z.enum(["livre", "alocado", "sujo", "eliminado"]),
  alocado_para: z.string().nullable(),
  criado_em: z.string(),
  liberado_em: z.string().nullable(),
});

/** `GET` e `POST /api/ambiente`: o tipo e os limites gravados, e o conjunto de containers da Fabriquinha. */
export const EstadoDoAmbiente = z.strictObject({
  configuracao: ConfiguracaoDoAmbiente,
  conjunto: z.array(AmbienteDoConjunto),
});
export type EstadoDoAmbiente = z.infer<typeof EstadoDoAmbiente>;

/** O modelo e o effort de cada etapa; a etapa ausente usa o padrão do pi. */
const ConfiguracoesPorEtapa = z.partialRecord(EtapaTicket, ConfiguracaoAgente);

/** `GET /api/projetos`, `GET /api/projetos/:nome` e os `POST`: o projeto com o modelo e o effort de cada etapa. */
export const ProjetoCadastrado = Projeto.extend({ configuracoes: ConfiguracoesPorEtapa });
export type ProjetoCadastrado = z.infer<typeof ProjetoCadastrado>;
export const ProjetosCadastrados = z.array(ProjetoCadastrado);

/** `GET /api/modelos`: todos os pares que o pi conhece. */
export const ModelosDoPi = z.array(Modelo);

/** `DELETE /api/projetos/:nome`: o que sobrou no disco depois que o banco foi limpo. */
export const ProjetoRemovido = z.strictObject({ avisos: z.array(z.string()) });

/** O projeto como o formulário manda: a hospedagem, que ele só mostra, é ignorada; o F5 a deduz do remoto. */
export const FormularioDoProjeto = Projeto.pick({
  nome: true,
  raiz_git: true,
  branch_base: true,
  link_produto: true,
}).extend({
  hospedagem: Hospedagem.optional(),
  preparacao: ComandosDePreparacao,
  configuracoes: ConfiguracoesPorEtapa,
});

/** O nome é a chave e não muda (C19): o do caminho vale, e o do corpo é ignorado. */
export const FormularioDeEdicaoDoProjeto = FormularioDoProjeto.extend({ nome: z.unknown() });
