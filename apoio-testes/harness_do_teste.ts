// O harness dos testes: em produção a composição monta o harness no condutor do serviço; os testes usam os casos de uso
// sem a composição, e o `npm test` e o `npm run integracao` carregam este módulo antes de cada arquivo (`--import`). É o
// pi (o falso, quando o teste aponta `FABRIQUINHA_PI` para ele); quem precisa de outro monta o seu. Carrega também a
// abertura do banco da composição, que liga ao Ciclo de Vida a leitura de Demandas, para o teste que abre o banco sozinho.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { condutor } from "../src/modulos/ciclo_de_vida/publico.ts";
import { HarnessPi } from "../src/modulos/sessoes/publico.ts";
import "../src/server/composicao/banco_da_fabriquinha.ts";

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

// Nenhum teste roda o pi de verdade: sem `FABRIQUINHA_PI`, vale o pi falso sem roteiro, de quem o serviço que sobe lê o
// catálogo de preços. Quem precisa de outro roteiro instala o seu (`instalarPiFalso`).
process.env.FABRIQUINHA_PI ??= join(import.meta.dirname, "falsos", "pi_falso.ts");

condutor.montarHarness(new HarnessPi());
