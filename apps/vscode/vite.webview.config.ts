import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

const here = path.dirname(fileURLToPath(import.meta.url));

// https://vite.dev/config/
export default defineConfig({
	plugins: [svelte()],
	resolve: {
		conditions: ["svelte", "browser"],
	},
	build: {
		// Build for the webview (browser context)
		outDir: "dist/webview",
		emptyOutDir: true,
		sourcemap: true,
		target: "es2020",
		rollupOptions: {
			input: {
				table: path.resolve(here, "src/webview/main.ts"),
				chart: path.resolve(here, "src/webview/chart-main.ts"),
				"live-data": path.resolve(here, "src/webview/live-data.ts"),
			},
			output: {
				entryFileNames: "[name].js",
				chunkFileNames: "[name]-[hash].js",
				assetFileNames: "[name]-[hash][extname]",
			},
			external: [],
		},
	},
	optimizeDeps: {
		exclude: ["@ecu-explorer/ui"],
	},
});
