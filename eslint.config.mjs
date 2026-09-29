import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "public/orderat/**",
    // The built site (git-ignored); site/build.mjs copies public/orderat's web app into dist/app/.
    "site/dist/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
