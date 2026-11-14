// O Ambiente do serviço (CONCEITOS.md §7): a composição é quem lê e grava a Configuração do Ambiente e monta com ela a
// gestão de Ambientes; a web recebe a gestão e a gravação, que vale na pergunta seguinte da gestão, sem remontá-la.
import { homedir } from "node:os";
import type { DatabaseSync } from "node:sqlite";
import { montarGestaoDeAmbientes } from "../../modulos/ambiente/publico.ts";
import { dirDoPiDoAuditor, instalacaoDoPi, PACOTE } from "../../shared/infra/isolamento_do_ambiente.ts";
import {
  configuracaoDoAmbiente,
  salvarConfiguracaoDoAmbiente,
} from "../../shared/armazenamento/configuracao_do_ambiente.ts";
import { type Relogio, relogioDoSistema } from "../../shared/nucleo/relogio.ts";
import type { AmbientesDoServico } from "./api/rotas.ts";

/** O serviço que escuta em `porta`, com os dados em `raiz`: o que o container do conjunto precisa saber dele. */
interface ServicoQueMontaOsAmbientes {
  banco: DatabaseSync;
  raiz: string;
  porta: number;
  registrarErro: (erro: unknown) => void;
  relogio?: Relogio;
}

/** Monta a gestão de Ambientes com a Configuração gravada no banco, relida a cada pergunta, e a gravação dela. */
export async function montarAmbientesDoServico({
  banco,
  raiz,
  porta,
  registrarErro,
  relogio = relogioDoSistema,
}: ServicoQueMontaOsAmbientes): Promise<AmbientesDoServico> {
  const gestao = await montarGestaoDeAmbientes({
    banco,
    configuracao: () => configuracaoDoAmbiente(banco),
    servico: {
      raiz,
      porta_da_api: porta,
      home_do_usuario: homedir(),
      pacote_do_harness: PACOTE,
      instalacao_do_harness: instalacaoDoPi,
      dir_do_harness_do_auditor: dirDoPiDoAuditor(),
    },
    relogio,
    registrarErro,
  });
  return {
    gestao,
    configurar: (configuracao) => {
      salvarConfiguracaoDoAmbiente(banco, configuracao);
    },
  };
}
