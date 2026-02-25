import { builtinModules } from "module";
import { defineConfig } from "vitest/config";

// Separate Vite build configuration that bundles the MCP server into a single
// self-contained .mjs file. The MCP server is a standalone Node.js stdio process
// spawned as a child process by VS Code — it runs in a real Node.js environment,
// so Node built-ins must be externalized (not stubbed with browser shims).
export default defineConfig({
	build: {
		// Node target — MCP server runs as a child process
		target: "node18",
		// Output a standalone ESM module
		lib: {
			entry: "../../packages/mcp/src/index.ts",
			formats: ["es"],
			fileName: "server",
		},
		outDir: "dist/mcp",
		emptyOutDir: false, // don't wipe other dist/ contents
		sourcemap: true,
		rollupOptions: {
			// Externalize all Node built-in modules so Vite does not replace them
			// with browser stubs (__vite_browser_external). The spawned child process
			// runs in a real Node.js runtime where these are always available.
			external: [...builtinModules, ...builtinModules.map((m) => `node:${m}`)],
			output: {
				// Ensure output is .mjs so Node treats it as ESM
				entryFileNames: "server.mjs",
			},
		},
	},
});
