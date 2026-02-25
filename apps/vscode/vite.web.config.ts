import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

// Vite build configuration for the web extension entrypoint.
// Targets VSCode for the Web (browser runtime) — Node-only modules (e.g. MCP)
// must NOT be imported from this build graph.
export default defineConfig({
	plugins: [svelte()],
	build: {
		// Build as a browser-compatible library (VSCode web extension entry)
		lib: {
			entry: "./src/extension.web.ts",
			formats: ["es"],
			fileName: "extension.web",
		},
		outDir: "dist",
		emptyOutDir: false, // Don't wipe desktop build output
		sourcemap: true,
		target: "es2020",
		rollupOptions: {
			external: ["vscode"],
			output: {
				entryFileNames: "extension.web.js",
			},
		},
	},
});
