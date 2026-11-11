// A Configuração do Ambiente na aplicação: validada antes de gravar e traduzida, num ponto só, no adapter que ela escolhe.
import type { DatabaseSync } from "node:sqlite";
import type { Relogio } from "../../compartilhado/nucleo/relogio.ts";
import { ConfiguracaoDoAmbiente } from "../nucleo/configuracao_do_ambiente.ts";
import { configuracaoDoAmbiente, salvarConfiguracaoDoAmbiente } from "../armazenamento/configuracao_do_ambiente.ts";
import { GeradorDeAmbientes } from "../infra/container/gerador_de_ambientes.ts";
import { ConjuntoDeAmbientes, type ServicoDoConjunto } from "./conjunto_de_ambientes/conjunto.ts";

/** Valida a `entrada` e grava a configuração do Ambiente inteira; campo ausente volta ao padrão. */
export function validarESalvarConfiguracaoDoAmbiente(banco: DatabaseSync, entrada: unknown): ConfiguracaoDoAmbiente {
  return salvarConfiguracaoDoAmbiente(banco, ConfiguracaoDoAmbiente.parse(entrada));
}

/**
 * O único ponto que traduz o tipo configurado do Ambiente no adapter, relido do banco a cada pergunta (a Configuração
 * muda com o serviço no ar): `host_local` não tem conjunto, o Espaço roda no Ambiente do serviço e o docker nunca é
 * chamado; `container` tem o conjunto de containers, criado na primeira pergunta e o mesmo dali em diante.
 */
export function conjuntoDoTipoConfigurado(
  relogio: Relogio,
  servico: ServicoDoConjunto,
): (banco: DatabaseSync) => ConjuntoDeAmbientes | undefined {
  let conjuntoDeContainers: ConjuntoDeAmbientes | undefined;
  return (banco) => {
    switch (configuracaoDoAmbiente(banco).tipo) {
      case "host_local":
        return undefined;
      case "container":
        return (conjuntoDeContainers ??= new ConjuntoDeAmbientes(banco, new GeradorDeAmbientes(), relogio, servico));
    }
  };
}
