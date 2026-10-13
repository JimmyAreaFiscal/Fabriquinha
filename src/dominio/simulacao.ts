// Simulação (F8): o Usuário Simulado, o nome dos seus anexos e a Tarefa. Sem I/O.
import { extname } from "node:path";
import { z } from "zod";
import { Id } from "./primitivos.ts";

/** Pessoa fictícia do projeto (F8 §2): o nome e a descrição do usuário e do seu conhecimento, que vão para a IA. */
export const NovoUsuarioSimulado = z.strictObject({
  nome: z.string().trim().min(1, "Nome obrigatório").max(80),
  descricao: z.string().trim().min(1, "Descrição obrigatória").max(4000),
});

/** Só PDF, texto e imagem: o que o pi lê como `@arquivo` (F8 §2). */
const FORMATOS = new Set([".pdf", ".txt", ".md", ".csv", ".png", ".jpg", ".jpeg", ".webp", ".gif"]);

/** O nome do anexo vira nome de arquivo na pasta da execução: sem `/` nem caractere de controle. */
export const NomeDoAnexo = z
  .string()
  .min(1)
  .max(200)
  .refine((nome) => !/[/\p{Cc}]/u.test(nome), "o nome do arquivo não pode ter / nem caracteres de controle")
  .refine((nome) => FORMATOS.has(extname(nome).toLowerCase()), "formato não suportado: envie PDF, texto ou imagem");

const N_INVALIDO = "N deve ser um inteiro maior que zero";

/** O que o usuário simulado deve tentar fazer, quantas vezes cada um o faz e quais usuários do projeto o fazem (F8 §3). */
export const NovaTarefa = z.strictObject({
  texto: z.string().trim().min(1, "Tarefa obrigatória").max(2000),
  n: z.number(N_INVALIDO).int(N_INVALIDO).min(1, N_INVALIDO).max(20, "N passa de 20"),
  usuarios: z.array(Id).min(1, "Aloque ao menos um usuário simulado"),
});

export type NovoUsuarioSimulado = z.infer<typeof NovoUsuarioSimulado>;
