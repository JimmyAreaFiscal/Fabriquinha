// O tema do web (escuro ou claro): lido e gravado no armazenamento do navegador e aplicado em `<html data-theme>`.
// Sem `prefers-color-scheme`: sem escolha salva, o tema é o escuro. Roda no navegador: módulo puro, sem imports.

type Tema = "dark" | "light";

/**
 * A mesma chave que o script inline do `<head>` do index.html lê antes da primeira pintura.
 * @testes o teste confere a gravação pela chave; o script do index.html a repete por não poder importar
 */
export const CHAVE_DO_TEMA = "fabriquinha.tema";

type Armazenamento = Pick<Storage, "getItem" | "setItem">;
interface RaizDoDocumento {
  dataset: DOMStringMap;
}

/** @testes o script inline do index.html lê o tema salvo antes da pintura; aqui a mesma regra é testada */
export function lerTemaSalvo(armazenamento: Armazenamento): Tema {
  try {
    return armazenamento.getItem(CHAVE_DO_TEMA) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

/** @testes só o alternarTema a usa em produção; o teste a usa para partir do tema lido */
export function aplicarTema(raiz: RaizDoDocumento, tema: Tema): void {
  raiz.dataset.theme = tema;
}

/** Troca o tema aplicado na raiz, grava a escolha e devolve o novo tema. */
export function alternarTema(armazenamento: Armazenamento, raiz: RaizDoDocumento): Tema {
  const novoTema: Tema = raiz.dataset.theme === "light" ? "dark" : "light";
  aplicarTema(raiz, novoTema);
  try {
    armazenamento.setItem(CHAVE_DO_TEMA, novoTema);
  } catch {
    // sem armazenamento, sem lembrança
  }
  return novoTema;
}
