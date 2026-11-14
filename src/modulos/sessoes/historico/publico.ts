// A API do subdomínio Histórico: a conversa guardada de uma sessão, as perguntas respondidas e o texto de cada mensagem.
export { type Mensagem, perguntasRespondidasNaConversa, texto } from "./nucleo/conversa.ts";
export { lerConversaDoArquivo } from "./infra/arquivo_da_conversa.ts";
