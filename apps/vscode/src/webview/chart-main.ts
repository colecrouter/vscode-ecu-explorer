/**
 * Webview entry point for chart viewer
 *
 * This file runs in the webview context (browser) and uses Svelte components
 * to render the chart in a separate window.
 */

import { mount } from "svelte";
import ChartViewerApp from "./ChartViewerApp.svelte";

let app: ReturnType<typeof mount> | undefined;
try {
	// Mount the Svelte 5 app using the mount function
	app = mount(ChartViewerApp, {
		target: document.body,
	});
} catch (error) {
	console.error(
		"[CHART WEBVIEW ERROR] chart-main.ts: Failed to mount ChartViewerApp:",
		error,
	);
	console.error(
		"[CHART WEBVIEW ERROR] chart-main.ts: Stack trace:",
		error instanceof Error ? error.stack : "N/A",
	);
	throw error;
}

export default app;
