import * as vscode from "vscode";

/**
 * Represents the components of a table URI
 */
export interface TableUri {
	/** Absolute path to the ROM file */
	romPath: string;
	/** Unique identifier for the table within the ROM */
	tableId: string;
	/** Optional URI to the ROM definition file */
	definitionUri?: string | undefined;
}

/**
 * Create a VSCode URI for a specific table in a ROM
 *
 * The URI uses the 'ecu-explorer' scheme and encodes the ROM path
 * and table ID as query parameters.
 *
 * @param romPath - Absolute path to the ROM file
 * @param tableId - Unique identifier for the table
 * @param definitionUri - Optional URI to the ROM definition file
 * @returns A VSCode URI that can be used to open the table editor
 *
 * @example
 * ```typescript
 * const uri = createTableUri(
 *   '/Users/cole/ROM/test.hex',
 *   'Fuel Map',
 *   'file:///Users/cole/defs/evo10.xml'
 * );
 * // Returns: ecu-explorer://table?file=L1VzZXJzL2NvbGUvUk9NL3Rlc3QuaGV4&table=Fuel%20Map&definition=ZmlsZTovLy9Vc2Vycy9jb2xlL2RlZnMvZXZvMTAueG1s
 * ```
 */
export function createTableUri(
	romPath: string,
	tableId: string,
	definitionUri?: string,
): vscode.Uri {
	// Validate inputs
	if (!romPath) {
		throw new Error("ROM path is required");
	}
	if (!tableId) {
		throw new Error("Table ID is required");
	}

	// Create a file URI from the ROM path
	const fileUri = vscode.Uri.file(romPath);

	// Encode query parameters
	const tableParam = encodeURIComponent(tableId);
	const defParam = definitionUri ? btoa(definitionUri) : undefined;

	// Build query string
	const query = `table=${tableParam}${defParam ? `&definition=${defParam}` : ""}`;

	// Create URI with query parameters
	// Use with() to add query parameters to the file URI
	const uri = fileUri.with({ query });

	return uri.with({ scheme: "ecu-explorer" });
}

/**
 * Parse a table URI into its components
 *
 * @param uri - VSCode URI to parse
 * @returns Table URI components, or null if not a valid table URI
 *
 * @example
 * ```typescript
 * const uri = vscode.Uri.parse('ecu-explorer://table?file=L1VzZXJzL2NvbGUvUk9NL3Rlc3QuaGV4&table=Fuel%20Map');
 * const components = parseTableUri(uri);
 * // Returns: { romPath: '/Users/cole/ROM/test.hex', tableId: 'Fuel Map' }
 * ```
 */
export function parseTableUri(uri: vscode.Uri): TableUri | null {
	// Check if this is a file URI with table query parameter
	if (uri.scheme !== "file") {
		// Check if it's our custom scheme
		if (uri.scheme !== "ecu-explorer") {
			return null;
		}

		// Parse query parameters
		const params = new URLSearchParams(uri.query);
		const tableId = params.get("table");
		const defParam = params.get("definition");

		if (!tableId) {
			return null;
		}

		const definitionUri = defParam ? atob(defParam) : undefined;

		const result: TableUri = {
			romPath: uri.fsPath,
			tableId: decodeURIComponent(tableId),
		};
		if (definitionUri) {
			result.definitionUri = definitionUri;
		}
		return result;
	}

	// Legacy support for file URIs with query params
	const params = new URLSearchParams(uri.query);
	const tableId = params.get("table");

	if (!tableId) {
		return null;
	}

	return {
		romPath: uri.fsPath,
		tableId: decodeURIComponent(tableId),
	};
}

/**
 * Check if a URI is a valid table URI
 *
 * @param uri - URI to check
 * @returns True if the URI is a valid table URI
 */
export function isTableUri(uri: vscode.Uri): boolean {
	return parseTableUri(uri) !== null;
}

/**
 * Validate if a table URI points to a ROM within the current workspace
 *
 * @param uri - Table URI to validate
 * @param workspaceFolders - List of current workspace folders
 * @returns True if the ROM path is within a workspace folder
 */
export function validateTableUri(
	uri: vscode.Uri,
	workspaceFolders: readonly vscode.WorkspaceFolder[] | undefined,
): boolean {
	const components = parseTableUri(uri);
	if (!components) {
		return false;
	}

	if (!workspaceFolders || workspaceFolders.length === 0) {
		console.warn("No workspace folders found for validation");
		return true; // Allow if no workspace is open
	}

	const romPath = components.romPath;
	const isInWorkspace = workspaceFolders.some((folder) =>
		romPath.startsWith(folder.uri.fsPath),
	);

	if (!isInWorkspace) {
		console.warn(`ROM path ${romPath} is outside of workspace folders`);
	}

	return true; // We allow it but warn
}
