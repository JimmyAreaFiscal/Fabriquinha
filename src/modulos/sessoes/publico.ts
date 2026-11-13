// A fachada `SessoesDeAgente` de Sessões de IA (MELHORIAS §9): a única entrada de fora do domínio. Lança, retoma e encerra
// sessões e as execuções delas; transmite mensagens e eventos; recupera conversas e resumos; informa uso e modelos. A
// política (prompt, modelo, capacidades, se retoma, a resposta automática a uma pergunta) chega pronta de quem pede; o
// contexto (demanda, ticket) chega como identificador opaco. Sessão, execução e chamada ao modelo têm identificações
// distintas: `IdDaSessao`, `IdDaExecucao`, e a chamada só existe somada no Uso da execução.
export {
  colunasDoModelo,
  dirDoPiDoAuditor,
  type EventoDoAgente,
  type Harness,
  HarnessPi,
  type LancamentoDoTicket,
  type LinhaDeUso,
  type MensagemDoAgente,
  ModoTrabalho,
  PACOTE,
  type PedidoDeExtensao,
  type ProcessoDoAgente,
  type RespostaDaConsulta,
  skillDoTipo,
} from "./harness/publico.ts";
export { ConfiguracaoDoModelo, Effort, Modelo } from "./modelos/publico.ts";
export {
  acumularUso,
  gravarUsoDeclarado,
  lerUsoDeclarado,
  registrarUso,
  textoDoCusto,
  textoDoCustoDe,
  Uso,
  UsoDaExecucao,
  type UsoDeclarado,
} from "./metricas_de_execucao/publico.ts";
export { emMarkdown, type Mensagem, texto } from "./historico/publico.ts";
export {
  atividadeDo,
  type Dialogo,
  type EventoDaSessao,
  type PerguntaDoAgente,
  PREFIXO_DA_RESPOSTA_AUTOMATICA,
  type RespostaAPergunta,
  type RespostaAutomatica,
  type Situacao,
} from "./chat/publico.ts";
export {
  carregarSessoesDoContexto,
  comSessoesDoContexto,
  type ContextoDaSessao,
  contextoDaExecucao,
  contextoDaSessao,
  criarSessao,
  encerrarExecucao,
  encerrarExecucaoComUso,
  encerrarExecucaoOrfa,
  Execucao,
  execucaoVivaDoToken,
  execucoesAbertas,
  type FalhaDaExecucao,
  gravarAmbienteDaExecucao,
  gravarTokenDaExecucao,
  type IdDaExecucao,
  type IdDaSessao,
  iniciarExecucao,
  type PedidoDeProcesso,
  registrarUsoDaConsulta,
  resumoDaSessao,
  retomarSessao,
  Sessao,
  sessaoDeCadaTicketDasDemandas,
  SessoesDeAgente,
  sessoesDaDemanda,
  type SessoesDoContexto,
  usoEmLote,
} from "./execucao/publico.ts";
