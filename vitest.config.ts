import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@epm/core-client": resolve(__dirname, "packages/epm-core-client/src/index.ts"),
      "@epm/servers-as-code": resolve(__dirname, "servers-as-code/src/index.ts"),
    },
  },
  test: {
    include: ["**/*.eval.ts", "**/*.test.ts"],
    environment: "node",
  },
});
