import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
    {
        ignores: ["dist/**", "data/**", "drizzle/**", "node_modules/**", ".playwright-mcp/**"],
    },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        languageOptions: {
            ecmaVersion: 2023,
            sourceType: "module",
        },
        rules: {
            "no-unused-vars": "off",
            "@typescript-eslint/no-unused-vars": [
                "warn",
                {
                    argsIgnorePattern: "^_",
                    varsIgnorePattern: "^_",
                    caughtErrorsIgnorePattern: "^_",
                },
            ],
            "@typescript-eslint/no-non-null-assertion": "off",
            "@typescript-eslint/no-explicit-any": "warn",
            "no-unreachable": "warn",
            "no-constant-condition": ["warn", { checkLoops: false }],
            quotes: ["error", "double", { avoidEscape: true, allowTemplateLiterals: true }],
        },
    },
    prettier,
);
