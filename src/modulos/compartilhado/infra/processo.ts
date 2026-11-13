// provisório: remover no ticket 22 (o executor do host morou aqui; agora vem de src/shared/infra/processo.ts)
export {
  executar,
  executarNoShell,
  git,
  gitComLimite,
  lancarSolto,
  LIMITE_COMANDO_MS,
  sinalNoGrupo,
} from "../../../shared/infra/processo.ts";
