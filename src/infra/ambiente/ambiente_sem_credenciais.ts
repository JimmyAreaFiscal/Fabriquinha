// O env de quem roda código do agente no Ambiente: o do serviço, sem as credenciais.
/** Variáveis com credencial de hospedagem ou do SonarQube (F4 §6.1, F5 §5.0). */
const CREDENCIAIS = new Set([
  "GH_TOKEN",
  "GITHUB_TOKEN",
  "GH_ENTERPRISE_TOKEN",
  "GITHUB_ENTERPRISE_TOKEN",
  "AZURE_DEVOPS_EXT_PAT",
  "SYSTEM_ACCESSTOKEN",
  "SONAR_TOKEN",
]);

/**
 * `base` sem as credenciais, com `gh` e `az` lendo a configuração de `dirVazio`, onde não há login salvo. Para o que
 * roda código do agente: o pi e os coletores de testes e fitness.
 */
export function ambienteSemCredenciais(base: NodeJS.ProcessEnv, dirVazio: string): Record<string, string> {
  const env = Object.entries(base).filter(
    (variavel): variavel is [string, string] => variavel[1] !== undefined && !CREDENCIAIS.has(variavel[0]),
  );
  return { ...Object.fromEntries(env), GH_CONFIG_DIR: dirVazio, AZURE_CONFIG_DIR: dirVazio };
}
