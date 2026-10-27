import js from "@eslint/js";
import ts from "typescript-eslint";
export default ts.config(
  {
    ignores: [
      "dist/**",
      "showcase-dist/**",
      "tests/fixtures/**",
      ".demo/**",
      "node_modules/**",
      ".data/**",
      ".test-data/**",
      "f0-client/**",
      "playwright-report/**",
      "test-results/**",
    ],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);
