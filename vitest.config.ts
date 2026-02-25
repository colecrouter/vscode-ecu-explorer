import { svelte } from "@sveltejs/vite-plugin-svelte";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		setupFiles: ["./apps/vscode/test/setup.ts"],
		globals: true,
		coverage: {
			reporter: ["text"],
			include: ["**/*.ts", "**/*.svelte"],
			exclude: ["**/*.d.ts", "**/routes/**"],
		},
		// We have accompanying tsconfig files for each of these, to ensure the correct types are available in each context
		projects: [
			// Browser environment for Svelte component tests
			{
				plugins: [svelte()],
				test: {
					name: "browser",
					browser: {
						enabled: true,
						headless: true,
						provider: playwright(),
						instances: [{ browser: "chromium", headless: true }],
					},
					include: ["./**/*.svelte.{test,spec}.ts"],
					exclude: ["./apps/vscode/**/*.{test,spec}.ts", "node_modules/**"],
				},
			},
			// Node environment for VSCode extension tests (with jest-mock-vscode)
			{
				plugins: [],
				test: {
					name: "vscode",
					environment: "node",
					// vmForks is used here because for some reason Kilo Code breaks in several ways (Windows only) when using any other pool type
					pool: "vmForks",
					setupFiles: ["./apps/vscode/test/setup.ts"],
					include: ["./apps/vscode/**/*.{test,spec}.ts"],
					exclude: ["./**/*.svelte.{test,spec}.ts", "node_modules/**"],
				},
			},
			// Node environment for all other tests (core, providers, ui non-svelte)
			{
				plugins: [],
				test: {
					name: "node",
					environment: "node",
					pool: "vmForks",
					include: ["./**/*.{test,spec}.ts"],
					exclude: [
						"./**/*.svelte.{test,spec}.ts",
						"./apps/vscode/**/*.{test,spec}.ts",
						"node_modules/**",
					],
				},
			},
		],
	},
});
