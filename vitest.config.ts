import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["dotenv/config"],
    // Los tests pegan a la DB real: se corren en serie para no pisarse.
    fileParallelism: false,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname) },
  },
});
