import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vitest/config";

// https://vite.dev/config/
export default defineConfig({
	plugins: [svelte()],
	build: {
		// Build for the VS Code extension host (Node/desktop), not the browser.
		ssr: "./src/extension.desktop.ts",
		outDir: "dist",
		emptyOutDir: true,
		sourcemap: true,
		target: "node18",
		rollupOptions: {
			external: ["vscode"],
			output: {
				format: "cjs",
				entryFileNames: "extension.desktop.cjs",
			},
		},
	},
	test: {
		setupFiles: ["./test/setup.ts"],
	},
});
