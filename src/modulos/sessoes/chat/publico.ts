// A API do subdomínio Chat: o que se transporta de uma sessão viva e quem assina cada sessão.
export {
  atividadeDo,
  daPergunta,
  type Dialogo,
  DIALOGOS,
  type EventoDaSessao,
  type PerguntaDoAgente,
  PREFIXO_DA_RESPOSTA_AUTOMATICA,
  type RespostaAPergunta,
  type RespostaAutomatica,
  type Situacao,
} from "./nucleo/eventos_da_sessao.ts";
export { OuvintesDasSessoes } from "./aplicacao/ouvintes_das_sessoes.ts";
