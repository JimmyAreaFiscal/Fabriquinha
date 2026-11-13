// provisório: remover no ticket 22 (o módulo de sandbox virou o domínio Ambiente, src/modulos/ambiente/)
export {
  type Ambiente,
  ambienteSemCredenciais,
  chavesDeProvedorDoLlm,
  type ComandoNoAmbiente,
  type IdentificadorDoProcesso,
  LIMITE_COMANDO_MS,
  PASTA_DAS_ENTRADAS_DE_WORKTREE_DA_FABRIQUINHA,
  type ProcessoNoAmbiente,
  type SaidaDoComando,
} from "../../ambiente/publico.ts";
