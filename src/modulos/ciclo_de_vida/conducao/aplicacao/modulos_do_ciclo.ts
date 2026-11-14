// Os módulos de que a condução do Ciclo de Vida depende (CONCEITOS.md §2): o banco, a gestão de Ambientes, o Repositório
// e as Sessões de agente, montados pela composição e entregues a cada condução, gate e caso de uso do agente, e a parada
// do Ciclo de Vida montado.
import type { DatabaseSync } from "node:sqlite";
import type { GestaoDeAmbientes } from "../../../ambiente/publico.ts";
import type { RepositorioDoProjeto } from "../../../repositorio/publico.ts";
import type { SessoesDeAgente } from "../../../sessoes/publico.ts";

export interface ModulosDoCiclo {
  banco: DatabaseSync;
  ambientes: GestaoDeAmbientes;
  repositorio: RepositorioDoProjeto;
  sessoes: SessoesDeAgente;
  /**
   * O serviço está parando: o erro das conduções fora do pi (preparação do Espaço, coleta das verificações, hooks do
   * commit) é efeito da parada, e o ticket falha como "serviço reiniciado".
   */
  emParada(): boolean;
}
