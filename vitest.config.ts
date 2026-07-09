import { defineConfig } from "vitest/config";

// Dedicated vitest config — deliberately does NOT load vite.config.ts (which
// pulls in @crxjs/vite-plugin + the MV3 manifest, irrelevant and disruptive
// under test). The offline test loop runs pure module logic: the audit
// renderer, banner-to-course mapper, and buildWhatIfGoals. See ADR 0018.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    setupFiles: ["src/test/setup.ts"],
  },
});
