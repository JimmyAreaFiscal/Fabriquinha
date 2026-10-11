import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig(
  { ignores: ["node_modules/", "coverage/", "prototipos/", ".scratch/"] },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      // O próprio eslint.config.js fica fora do tsconfig; o projeto padrão do typescript-eslint o cobre.
      parserOptions: { projectService: { allowDefaultProject: ["eslint.config.js"] } },
    },
    rules: {
      // `test()` do node:test devolve promessa que o próprio runner aguarda.
      "@typescript-eslint/no-floating-promises": [
        "error",
        { allowForKnownSafeCalls: [{ from: "package", package: "node:test", name: ["test", "describe", "it"] }] },
      ],
      // Variável de ambiente vazia vale como ausente: `||` em string é intencional.
      "@typescript-eslint/prefer-nullish-coalescing": ["error", { ignorePrimitives: { string: true } }],
      // `const { campo: _, ...resto } = obj` é o jeito de tirar um campo opcional do objeto.
      "@typescript-eslint/no-unused-vars": ["error", { ignoreRestSiblings: true }],
    },
  },
);
