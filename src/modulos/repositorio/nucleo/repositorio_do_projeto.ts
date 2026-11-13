// provisório: remover no ticket 22 (o caminho antigo reexporta do Repositório). Direto do núcleo do Git, e não da
// fachada: o CLI do agente (pacote-pi) empacota o Projeto, e a fachada levaria o banco e o git para dentro do pacote.
export { Hospedagem } from "../git/nucleo/repositorio_do_projeto.ts";
