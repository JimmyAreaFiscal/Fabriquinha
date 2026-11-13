// provisório: remover no ticket 22 (mudou para src/modulos/demandas/projetos/). Direto do núcleo de Projetos, e não da
// fachada: o contrato da API do agente, que o CLI do agente (pacote-pi) empacota, lê o Projeto daqui, e a fachada
// levaria o banco e o git para dentro do pacote.
export { ComandosDePreparacao, Projeto } from "../../demandas/projetos/nucleo/projeto.ts";
export { Hospedagem } from "../../repositorio/nucleo/repositorio_do_projeto.ts";
