import type { TableDefinition } from "@ecu-explorer/core";
import * as vscode from "vscode";
import { createTableUri } from "../table-fs-uri";
import type { RomExplorerTreeProvider } from "../tree/rom-tree-provider";

/**
 * WorkspaceSymbolProvider for ROM tables
 *
 * Enables Quick Open integration (Cmd+P then #) to search and open ROM tables
 * across all loaded ROMs in the workspace.
 *
 * NOTE: WorkspaceSymbolProvider requires the # prefix in Quick Open.
 * This is the standard VSCode approach - there is no official API to add custom items
 * directly to Cmd+P file search without a prefix.
 */
export class RomSymbolProvider implements vscode.WorkspaceSymbolProvider {
	constructor(private readonly treeProvider: RomExplorerTreeProvider) {}

	/**
	 * Provide workspace symbols for ROM tables
	 *
	 * Called when user opens Quick Open with # prefix (Cmd+P then #)
	 * Returns all tables from all loaded ROMs that match the query
	 *
	 * @param query - Search query (can be empty to show all symbols)
	 * @param token - Cancellation token
	 * @returns Array of SymbolInformation for matching tables
	 */
	provideWorkspaceSymbols(
		query: string,
		token: vscode.CancellationToken,
	): vscode.ProviderResult<vscode.SymbolInformation[]> {
		const symbols: vscode.SymbolInformation[] = [];

		// Get all documents from the tree provider
		const documents = this.treeProvider.getDocuments();

		for (const [romUriString, document] of documents.entries()) {
			if (token.isCancellationRequested) {
				return [];
			}

			// Skip ROMs without definitions
			if (!document.definition?.tables) {
				continue;
			}

			const romUri = vscode.Uri.parse(romUriString);
			const romFileName = romUri.path.split("/").pop() || romUri.path;

			// Create symbols for each table
			for (const table of document.definition.tables) {
				// Filter by query if provided (case-insensitive, relaxed matching)
				if (query && !this.matchesQuery(table, query)) {
					continue;
				}

				// Create table URI
				const tableUri = createTableUri(romUri.fsPath, table.name);

				// Create symbol information
				const symbol = new vscode.SymbolInformation(
					table.name,
					this.getSymbolKind(table),
					table.category || "Uncategorized",
					new vscode.Location(tableUri, new vscode.Position(0, 0)),
				);

				// Add ROM filename to the container name for context
				symbol.containerName = `${table.category || "Uncategorized"} (${romFileName})`;

				symbols.push(symbol);
			}
		}

		return symbols;
	}

	/**
	 * Match table against query string
	 *
	 * Uses relaxed matching: case-insensitive, checks if query characters
	 * appear in order in the table name or category
	 *
	 * @param table - Table definition to match
	 * @param query - Search query
	 * @returns True if table matches query
	 */
	private matchesQuery(table: TableDefinition, query: string): boolean {
		const lowerQuery = query.toLowerCase();
		const lowerName = table.name.toLowerCase();
		const lowerCategory = (table.category || "").toLowerCase();

		// Check if query appears in name or category
		return lowerName.includes(lowerQuery) || lowerCategory.includes(lowerQuery);
	}

	/**
	 * Get appropriate symbol kind for table type
	 *
	 * Maps table types to VSCode symbol kinds for better visual representation
	 *
	 * @param table - Table definition
	 * @returns VSCode SymbolKind
	 */
	private getSymbolKind(table: TableDefinition): vscode.SymbolKind {
		switch (table.kind) {
			case "table1d":
				return vscode.SymbolKind.Array;
			case "table2d":
				return vscode.SymbolKind.Class;
			case "table3d":
				return vscode.SymbolKind.Struct;
			default:
				return vscode.SymbolKind.Variable;
		}
	}
}
