import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        include: ["src/**/*.test.ts"],
        exclude: ["node_modules", "dist"],
        coverage: {
            provider: "v8",
            reporter: ["text", "text-summary", "html", "lcov", "json-summary"],
            reportsDirectory: "./coverage",
            include: ["src/**/*.ts"],
            exclude: [
                "src/**/*.test.ts",
                "src/**/fixtures/**",
                "src/test-utils/**",
                "src/db/migrate.ts",
                "src/raidbots/test-sim.ts",
                "src/qelive/test-sim.ts",
                "src/wowaudit/test-flow.ts",
                "src/wowutils/generate-script.ts",
                "src/bot/register-commands.ts",
                "src/index.ts",
            ],
            clean: true,
        },
    },
});
