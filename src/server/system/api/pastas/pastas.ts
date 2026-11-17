// Rota do navegador de pastas da Configuração (I-309): lista só as subpastas de um caminho da máquina da Fabriquinha.
import { accessSync, constants, existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { ErroHttp } from "../erros.ts";
import { ListaDePastas } from "../contrato/pastas.ts";
import type { Rota } from "../rotas.ts";

function ehPastaLegivel(caminho: string): boolean {
  try {
    accessSync(caminho, constants.R_OK | constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function ehPasta(caminho: string): boolean {
  try {
    return statSync(caminho).isDirectory();
  } catch {
    return false;
  }
}

function listarPastas(caminhoPedido: string | null): ListaDePastas {
  const caminho = caminhoPedido ?? homedir();
  if (!isAbsolute(caminho)) throw new ErroHttp(422, "o caminho precisa ser absoluto");
  const atual = resolve(caminho);
  if (!ehPasta(atual)) throw new ErroHttp(422, "o caminho não é uma pasta existente");
  const pai = dirname(atual) === atual ? null : dirname(atual);
  let nomes: string[];
  try {
    nomes = readdirSync(atual);
  } catch {
    return { caminho: atual, pai, acessivel: false, pastas: [] };
  }
  const pastas = nomes
    .map((nome) => ({ nome, caminho: join(atual, nome) }))
    .filter(({ caminho: subpasta }) => ehPasta(subpasta))
    .map(({ nome, caminho: subpasta }) => ({
      nome,
      caminho: subpasta,
      repositorioGit: existsSync(join(subpasta, ".git")),
      acessivel: ehPastaLegivel(subpasta),
    }))
    .sort((a, b) => a.nome.localeCompare(b.nome));
  return { caminho: atual, pai, acessivel: true, pastas };
}

export const ROTAS_DAS_PASTAS: Rota[] = [
  {
    metodo: "GET",
    caminho: "/api/pastas",
    tratar: ({ query }) => listarPastas(query.get("caminho")),
    resposta: ListaDePastas,
  },
];
