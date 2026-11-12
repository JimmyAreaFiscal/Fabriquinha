// O harness dos testes: em produção a composição monta o harness no condutor do serviço; os testes usam os casos de uso
// sem a composição, e o `npm test` e o `npm run integracao` carregam este módulo antes de cada arquivo (`--import`). É o
// pi (o falso, quando o teste aponta `FABRIQUINHA_PI` para ele); quem precisa de outro monta o seu.
import { condutor } from "../src/modulos/trabalho_agentico/aplicacao/trabalho/condutor.ts";
import { HarnessPi } from "../src/modulos/harness/pi/harness_pi.ts";

condutor.montarHarness(new HarnessPi());
