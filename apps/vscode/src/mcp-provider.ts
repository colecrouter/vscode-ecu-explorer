import * as vscode from "vscode";

/**
 * Registers the ECU Explorer MCP server definition provider.
 *
 * When an LLM agent or GitHub Copilot requests MCP servers, VSCode will call
 * `provideMcpServerDefinitions()` and we return the command needed to spawn
 * the bundled MCP server process.
 *
 * The server is bundled as `dist/mcp/server.mjs` inside the extension.
 * It is launched as a stdio child process; VSCode manages the process lifecycle.
 *
 * @param ctx - Extension context (used to locate the bundled server binary)
 */
export function registerMcpProvider(ctx: vscode.ExtensionContext): void {
	const version: string = ctx.extension.packageJSON.version;

	const provider: vscode.McpServerDefinitionProvider<vscode.McpStdioServerDefinition> =
		{
			provideMcpServerDefinitions(
				_token: vscode.CancellationToken,
			): vscode.McpStdioServerDefinition[] {
				// Resolve the absolute path to the bundled server binary
				const serverPath = vscode.Uri.joinPath(
					ctx.extensionUri,
					"dist",
					"mcp",
					"server.mjs",
				).fsPath;

				// Resolve the workspace folder for the MCP server's working directory
				const workspaceFolder =
					vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();

				// Read definition paths from extension settings
				const config = vscode.workspace.getConfiguration("ecuExplorer");
				const definitionPaths: string[] = [
					...(config.get<string[]>("definitions.paths") ?? []),
					...(config.get<string[]>("definitions.ecuflash.paths") ?? []),
				].map((p) =>
					p.startsWith("/")
						? p
						: new URL(`./${p}`, vscode.Uri.file(workspaceFolder).toString())
								.pathname,
				);

				const logsFolder = config.get<string>("logsFolder") ?? "logs";
				const logsDir = logsFolder.startsWith("/")
					? logsFolder
					: new URL(
							`./${logsFolder}`,
							vscode.Uri.file(workspaceFolder).toString(),
						).pathname;

				const definition = new vscode.McpStdioServerDefinition(
					"ECU Explorer MCP",
					process.execPath, // node binary
					[serverPath],
					{
						ECU_DEFINITIONS_PATH: definitionPaths.join("/"),
						ECU_LOGS_DIR: logsDir,
						ECU_ICON_PATH: vscode.Uri.joinPath(ctx.extensionUri, "icon.png")
							.fsPath,
					},
					version,
				);

				definition.cwd = vscode.Uri.file(workspaceFolder);

				return [definition];
			},
		};

	ctx.subscriptions.push(
		vscode.lm.registerMcpServerDefinitionProvider("ecu-explorer", provider),
	);
}
