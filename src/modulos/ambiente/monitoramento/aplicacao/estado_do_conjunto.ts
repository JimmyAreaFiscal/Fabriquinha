// O conjunto de Ambientes como a tela de Configuração o vê: a lista do banco, que só tem containers criados pelo
// `GeradorDeAmbientes` (com o rótulo `fabriquinha.ambiente`), sem perguntar nada ao docker.
import type { DatabaseSync } from "node:sqlite";
import { type AmbienteGravado, listarAmbientes } from "../../sandboxes/publico.ts";

export const listarAmbientesDoConjunto = (banco: DatabaseSync): AmbienteGravado[] => listarAmbientes(banco);
