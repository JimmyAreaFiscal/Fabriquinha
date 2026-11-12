// Aprovação automática do PR da rodada (comparacao-sdlc-implementacao.md §§4 e 6): no projeto que a ligou, a Fabriquinha
// decide o gate do PR sozinha; a decisão em si é de `decidirGate`.
import type { DatabaseSync } from "node:sqlite";
import type { AgregadoDemanda } from "../../../sdlc/nucleo/demanda/agregado_demanda.ts";
import { FABRIQUINHA } from "../../../compartilhado/nucleo/vocabulario_do_sdlc/ator.ts";
import { MOTIVO_APROVACAO_AUTOMATICA_PR } from "../../../sdlc/nucleo/gate.ts";
import { Endereco } from "../../../compartilhado/nucleo/vocabulario_do_sdlc/endereco.ts";
import { noLog } from "../../../compartilhado/infra/registro.ts";
import type { RefRodada } from "../encerramento_rodada.ts";
import { decidirGate } from "../../gates.ts";

/**
 * Os projetos que aprovam sozinhos o PR da rodada: `$FABRIQUINHA_APROVACAO_AUTOMATICA_PR_RODADA`, nomes separados por
 * vírgula (vem do `ambiente` do serviço). Ausente, nenhum: o Auditor decide todo gate, como sempre.
 */
const aprovaPRDaRodadaSozinho = (projeto: string, env: NodeJS.ProcessEnv): boolean =>
  (env.FABRIQUINHA_APROVACAO_AUTOMATICA_PR_RODADA ?? "")
    .split(",")
    .map((nome) => nome.trim())
    .includes(projeto);

/**
 * Logo depois do encerramento: no projeto que a ligou, a Fabriquinha aprova o PR da rodada que chegou ao gate, porque
 * chegar a ele já exige a revisão aceita e o PR sem conflito nem check falho. O Auditor fica com o PR final da demanda.
 * A falha só vai ao log e deixa o gate aberto para o Auditor; fora do gate ou sem a opção, nada acontece. Devolve a
 * demanda com o PR aprovado, ou `ag` como veio.
 */
export async function aprovarPRRodadaSeAutomatico(
  banco: DatabaseSync,
  ag: AgregadoDemanda,
  ref: RefRodada,
  env: NodeJS.ProcessEnv = process.env,
): Promise<AgregadoDemanda> {
  const noGate = ag.rodadas.some((r) => r.rodada_id === ref.rodada_id && r.estado === "gate_pr");
  if (!noGate || !aprovaPRDaRodadaSozinho(ag.demanda.projeto, env)) return ag;
  const decisao = { resultado: "aprovado", motivo: MOTIVO_APROVACAO_AUTOMATICA_PR };
  return decidirGate(banco, "gate_pr", Endereco.daRodada(ref.demanda_id, ref.rodada_id), decisao, FABRIQUINHA).then(
    ({ demanda }) => demanda,
    (erro: unknown) => {
      noLog(erro);
      return ag;
    },
  );
}
