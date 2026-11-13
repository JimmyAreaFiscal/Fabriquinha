// provisório: remover no ticket 22 (mudou para src/modulos/ciclo_de_vida/despacho/armazenamento/configuracao_do_servico.ts;
// o arquivo, e não a API do Despacho, porque a Condução ainda lê a configuração por aqui e a API traz a Condução)
export {
  Configuracao,
  configuracao,
  limiteParalelismo,
  salvarConfiguracao,
} from "../../ciclo_de_vida/despacho/armazenamento/configuracao_do_servico.ts";
