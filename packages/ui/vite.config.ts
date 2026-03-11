import { sveltekit } from "@sveltejs/kit/vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [sveltekit()],
	test: {
		projects: [
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
					include: ["./test/**/*.svelte.{test,spec}.ts"],
				},
			},
			{
				plugins: [svelte()],
				test: {
					name: "node",
					environment: "node",
					pool: "vmForks",
					include: ["./test/**/*.{test,spec}.ts"],
					exclude: ["./test/**/*.svelte.{test,spec}.ts"],
				},
			},
		],
	},
});
