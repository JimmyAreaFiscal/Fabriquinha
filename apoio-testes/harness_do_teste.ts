// O harness dos testes: em produção a composição monta a gestão de Ambientes; os testes usam os casos de uso sem a
// composição, e o `npm test` e o `npm run integracao` carregam este módulo antes de cada arquivo (`--import`). O harness
// das Sessões é o pi (o falso, quando o teste aponta `FABRIQUINHA_PI` para ele); quem precisa de outro monta o seu. Carrega também a
// abertura do banco da composição, que liga ao Ciclo de Vida a leitura de Demandas, para o teste que abre o banco sozinho.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import "../src/server/system/banco_da_fabriquinha.ts";
import { ligarGestaoDeAmbientesNosModulos } from "./falsos/ambiente_falso.ts";

// As telas formatam datas no fuso local, e os testes esperam o de São Paulo; sem isto, a máquina em UTC os reprova.
process.env.TZ ??= "America/Sao_Paulo";

// Nenhum teste lê o `~/.pi/agent` do Auditor: copiado para o container falso, ele mudava no meio da cópia pelo pi de
// verdade (`tar: file changed as we read it`), levava as credenciais do Auditor e exigia o login dele na máquina. Os
// testes têm um login vazio; quem precisa de outro aponta o seu.
if (process.env.PI_CODING_AGENT_DIR === undefined) {
  const dirDoPiDosTestes = mkdtempSync(join(tmpdir(), "fabriquinha-pi-agent-"));
  writeFileSync(join(dirDoPiDosTestes, "auth.json"), "{}");
  process.env.PI_CODING_AGENT_DIR = dirDoPiDosTestes;
  process.on("exit", () => {
    rmSync(dirDoPiDosTestes, { recursive: true, force: true });
  });
}

// Nenhum teste lê o home do usuário: a composição copia para o container o `.claude` e o `.codex` dele e, de minuto em
// minuto, renova no host a credencial que está para vencer, rodando o Claude Code e o Codex de verdade. Os testes têm um
// home vazio; quem precisa de credencial grava a sua.
const homeDosTestes = mkdtempSync(join(tmpdir(), "fabriquinha-home-"));
process.env.HOME = homeDosTestes;
process.on("exit", () => {
  rmSync(homeDosTestes, { recursive: true, force: true });
});

// Os testes das telas leem o mês e o dia no fuso do navegador, fixado já na importação do módulo (antes de o teste poder
// mudar `TZ`): sem fuso fixo aqui, a máquina em UTC os reprova.
process.env.TZ ??= "America/Sao_Paulo";

// Nenhum teste roda o pi de verdade: sem `FABRIQUINHA_PI`, vale o pi falso sem roteiro, de quem o serviço que sobe lê o
// catálogo de preços. Quem precisa de outro roteiro instala o seu (`instalarPiFalso`).
process.env.FABRIQUINHA_PI ??= join(import.meta.dirname, "falsos", "pi_falso.ts");

// Sem a composição, o trabalho roda no host local; quem precisa de outro Ambiente liga a sua gestão.
ligarGestaoDeAmbientesNosModulos();
