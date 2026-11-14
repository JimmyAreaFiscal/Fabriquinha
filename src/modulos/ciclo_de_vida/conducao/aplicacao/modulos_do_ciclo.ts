// Os módulos de que a condução do Ciclo de Vida depende (CONCEITOS.md §2): o banco, a gestão de Ambientes e o
// Repositório, montados pela composição e entregues a cada condução, gate e caso de uso do agente.
import type { DatabaseSync } from "node:sqlite";
import type { GestaoDeAmbientes } from "../../../ambiente/publico.ts";
import type { RepositorioDoProjeto } from "../../../repositorio/publico.ts";

export interface ModulosDoCiclo {
  banco: DatabaseSync;
  ambientes: GestaoDeAmbientes;
  repositorio: RepositorioDoProjeto;
}
