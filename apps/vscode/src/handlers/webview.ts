import * as vscode from "vscode";

/**
 * Render table HTML for webview
 *
 * Generates the HTML content for the table viewer webview, including:
 * - Security policies (CSP)
 * - Script injection with nonce
 * - CSS stylesheet linking
 * - Module loading for table view
 *
 * @param webview - The webview instance
 * @param extensionUri - Extension URI for resource loading
 * @returns Promise that resolves to HTML string
 */
export async function renderTableHtml(
	webview: vscode.Webview,
	extensionUri: vscode.Uri,
): Promise<string> {
	try {
		console.log(
			"[DEBUG] renderTableHtml: extensionUri =",
			extensionUri.toString(),
		);

		// TEST: Try minimal HTML first to isolate the issue
		const USE_MINIMAL_HTML = false; // Set to true to test with minimal HTML
		if (USE_MINIMAL_HTML) {
			const minimalHtml = `<!doctype html>
<html lang="en">
	<head>
		<meta charset="UTF-8" />
		<title>Test</title>
	</head>
	<body>
		<h1>Hello World - Minimal Test</h1>
		<p>If you see this, the webview panel creation works.</p>
	</body>
</html>`;
			return minimalHtml;
		}

		const scriptUri = webview.asWebviewUri(
			vscode.Uri.joinPath(extensionUri, "dist", "webview", "table.js"),
		);

		// Find the CSS file (it has a hash in the name)
		const webviewDir = vscode.Uri.joinPath(extensionUri, "dist", "webview");
		console.log(
			"[DEBUG] renderTableHtml: webviewDir.fsPath =",
			webviewDir.fsPath,
		);

		let cssFileName = "table-D9vXwniH.css"; // Default fallback

		try {
			const files = await vscode.workspace.fs.readDirectory(webviewDir);
			console.log(
				"[DEBUG] renderTableHtml: fs.readdir succeeded, files =",
				files,
			);

			const [cssFile] =
				files.find(([f]) => f.startsWith("table-") && f.endsWith(".css")) || [];

			if (cssFile) {
				cssFileName = cssFile;
				console.log(
					"[DEBUG] renderTableHtml: Updated cssFileName =",
					cssFileName,
				);
			}
		} catch (_error) {
			// Use default if directory read fails
			console.warn(
				"[WARN] renderTableHtml: Could not read webview directory, using default CSS filename",
			);
		}

		const cssUri = webview.asWebviewUri(
			vscode.Uri.joinPath(extensionUri, "dist", "webview", cssFileName),
		);

		const nonce = String(Date.now());

		console.log(
			"[DEBUG] renderTableHtml: webview.cspSource =",
			webview.cspSource,
		);
		const csp = [
			"default-src 'none'",
			`img-src ${webview.cspSource} data: https:`,
			`style-src ${webview.cspSource} 'unsafe-inline'`,
			`script-src 'nonce-${nonce}' 'unsafe-eval'`,
			`font-src ${webview.cspSource}`,
			`connect-src ${webview.cspSource} https:`,
		].join("; ");

		const html = `<!doctype html>
<html lang="en">
	<head>
		<meta charset="UTF-8" />
		<meta http-equiv="Content-Security-Policy" content="${csp}" />
		<meta name="viewport" content="width=device-width, initial-scale=1.0" />
		<title>ROM Table</title>
		<link rel="stylesheet" href="${cssUri}" />
	</head>
	<body>
		<script type="module" nonce="${nonce}" src="${scriptUri}"></script>
	</body>
</html>`;
		return html;
	} catch (error) {
		console.error(
			"[ERROR] renderTableHtml: Stack trace:",
			error instanceof Error ? error.stack : "N/A",
		);
		throw error;
	}
}
