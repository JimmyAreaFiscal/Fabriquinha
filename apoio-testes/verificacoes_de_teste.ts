// O registro de uma Verificação com `dados` que o schema do tipo aceita, atendendo ou não à regra dele: o fechamento do
// ticket submete esses `dados` ao Avaliador, que recusa o que o schema não aceita e a verificação que não atende.
import type { RegistroDaVerificacao } from "../src/modulos/ciclo_de_vida/publico.ts";

type TipoDaVerificacao = RegistroDaVerificacao["tipo"];

const comandoRodado = (atende: boolean) => ({
  comando: "c",
  codigoSaida: atende ? 0 : 1,
  estourou: false,
  duracaoMs: 1,
  log: "c.log",
});

const DADOS_DO_TIPO: Record<TipoDaVerificacao, (atende: boolean) => Record<string, unknown>> = {
  execucao_testes: (atende) => ({ comandos: [comandoRodado(atende)] }),
  matriz_fitness: (atende) => ({ linhas: [{ nome: "fitness", descricao: "d", ...comandoRodado(atende) }] }),
  relatorio_sonar: (atende) => ({
    chave_sonarqube: "k",
    ceTaskId: "t",
    arquivosAnalisados: [],
    issues: atende ? [] : [{ arquivo: "a.ts", regra: "r", severidade: "MAJOR", mensagem: "m" }],
  }),
};

/** `passou` `undefined` é falha de infraestrutura; `false`, reprovação técnica com o `motivo`. */
export function verificacaoDeTeste(
  tipo: TipoDaVerificacao,
  passou: boolean | undefined,
  motivo = "reprovado no teste",
  logs = [{ nome: `${tipo}.log`, texto: `log de ${tipo}` }],
): RegistroDaVerificacao {
  const falhas: RegistroDaVerificacao["falhas"] = passou
    ? []
    : [
        passou === undefined
          ? { classe: "infraestrutura", causa: "servico_externo_inacessivel", motivo, comando: "c" }
          : { classe: "tecnica", motivo, comando: "c" },
      ];
  return { tipo, passou, falhas, dados: DADOS_DO_TIPO[tipo](passou === true), logs };
}
