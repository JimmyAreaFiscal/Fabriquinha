// As únicas pastas de processo que o container enxerga (decisão do usuário de 2026-11-10): cada container tem as suas
// `sessoes` e `execucoes` em `<raiz>/ambientes/<id>/`, montadas sobre `<raiz>/sessoes` e `<raiz>/execucoes` dele. O core
// continua lendo pelo caminho de sempre (`<raiz>/sessoes/<sessão>`, `<raiz>/execucoes/E-<id>`), que vira symlink para a
// pasta de dentro do container enquanto o Espaço o usa e, quando o container volta ao conjunto, para `<raiz>/espacos/<espaço>`.
import { existsSync, lstatSync, mkdirSync, readdirSync, readlinkSync, renameSync, rmSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";

type TipoDePastaDoProcesso = "sessoes" | "execucoes";
const TIPOS: readonly TipoDePastaDoProcesso[] = ["sessoes", "execucoes"];

/** As pastas do host que o container `idDoAmbiente` monta, uma por tipo. */
export const pastasDoAmbiente = (raiz: string, idDoAmbiente: string): Record<TipoDePastaDoProcesso, string> => ({
  sessoes: join(raiz, "ambientes", idDoAmbiente, "sessoes"),
  execucoes: join(raiz, "ambientes", idDoAmbiente, "execucoes"),
});

/** Onde a pasta está de verdade: o alvo do symlink ou, se não é symlink (ou não existe), o próprio caminho. */
function ondeAPastaEsta(caminhoDoCore: string): string {
  try {
    return lstatSync(caminhoDoCore).isSymbolicLink() ? readlinkSync(caminhoDoCore) : caminhoDoCore;
  } catch {
    return caminhoDoCore;
  }
}

/** Leva a pasta (criando-a vazia se não existe) para `novoLugar` e deixa o `caminhoDoCore` apontando para lá. */
function levarPara(caminhoDoCore: string, lugarAtual: string, novoLugar: string): void {
  if (lugarAtual === novoLugar) return;
  mkdirSync(dirname(novoLugar), { recursive: true });
  if (existsSync(lugarAtual)) renameSync(lugarAtual, novoLugar);
  else mkdirSync(novoLugar);
  rmSync(caminhoDoCore, { force: true }); // só sobra o symlink; a pasta de verdade já foi renomeada
  mkdirSync(dirname(caminhoDoCore), { recursive: true });
  symlinkSync(novoLugar, caminhoDoCore);
}

/** Põe a pasta `nome` do tipo dentro das pastas do container, onde ele a enxerga. */
export function abrigarNoAmbiente(raiz: string, idDoAmbiente: string, tipo: TipoDePastaDoProcesso, nome: string): void {
  const caminhoDoCore = join(raiz, tipo, nome);
  levarPara(caminhoDoCore, ondeAPastaEsta(caminhoDoCore), join(pastasDoAmbiente(raiz, idDoAmbiente)[tipo], nome));
}

/** Tira do container tudo o que o Espaço `nomeDoEspaco` pôs nas pastas dele, para o próximo Espaço não enxergar. */
export function recolherParaOEspaco(raiz: string, idDoAmbiente: string, nomeDoEspaco: string): void {
  const pastas = pastasDoAmbiente(raiz, idDoAmbiente);
  for (const tipo of TIPOS)
    if (existsSync(pastas[tipo]))
      for (const nome of readdirSync(pastas[tipo]))
        levarPara(join(raiz, tipo, nome), join(pastas[tipo], nome), join(raiz, "espacos", nomeDoEspaco, tipo, nome));
}
