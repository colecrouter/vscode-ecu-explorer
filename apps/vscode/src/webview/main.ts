/**
 * Webview entry point for table editing
 *
 * This file runs in the webview context (browser) and uses Svelte components
 * to render the table grid with full editing support.
 */

import { mount } from "svelte";
import TableApp from "./TableApp.svelte";

let app: ReturnType<typeof mount> | undefined;
try {
	// Mount the Svelte 5 app using the mount function
	app = mount(TableApp, {
		target: document.body,
	});
} catch (error) {
	console.error("[WEBVIEW ERROR] main.ts: Failed to mount TableApp:", error);
	console.error(
		"[WEBVIEW ERROR] main.ts: Stack trace:",
		error instanceof Error ? error.stack : "N/A",
	);
	throw error;
}

export default app;
