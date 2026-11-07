// Falso da suíte de integração do SDLC: a hospedagem (`gh` na frente do PATH, com o estado dos PRs num JSON). O pi falso
// é o de `apoio-testes/pi_falso.ts`. Combinado com a I-244: quem precisa de mais, acrescenta aqui.
import { hospedagemFalsa } from "../src/repositorio/hospedagem-falsa.test.ts";

/** O `gh` falso (a hospedagem já testada em `hospedagem-falsa.test.ts`) com os cenários da seção 12 nomeados. */
export function ghFalso(dir: string) {
  const h = hospedagemFalsa(dir);
  h.zerar();
  return {
    ...h,
    conflito: (id: number) => {
      h.mudar(id, { conflito: true });
    },
    checkFalho: (id: number) => {
      h.mudar(id, { checks: [{ nome: "ci", estado: "falho" }] });
    },
    mergeFalha: (stderr = "merge recusado pela hospedagem") => {
      h.falhar("pr merge", stderr);
    },
  };
}
