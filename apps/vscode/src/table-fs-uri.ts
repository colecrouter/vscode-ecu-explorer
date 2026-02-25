/**
 * Table Virtual File System URI Utilities
 *
 * This module provides utilities for creating and parsing virtual table URIs
 * using the `ecu-table://` scheme. These URIs enable VSCode's Custom Editor API
 * to work with multiple distinct table editors.
 *
 * URI Format:
 * ecu-table://path/to/rom.hex/TableName
 *
 * Components:
 * - Scheme: "ecu-table" (custom scheme for virtual files)
 * - Authority: Empty (not used)
 * - Path: /path/to/rom.hex/TableName
 *   - ROM file path (absolute) + table name separated by /
 *   - Table name is URL-encoded to handle spaces and special characters
 *
 * Examples:
 * - ecu-table:///Users/cole/ROM/test.hex/Fuel%20Trim
 * - ecu-table:///Users/cole/ROM/evo10.bin/Boost%20Target
 * - ecu-table:///Users/cole/ROM/wrx.hex/Fuel%20Map%20(High%20Octane)
 */

import * as vscode from "vscode";

/**
 * Components of a table URI
 */
export interface TableUri {
	/** Absolute path to the ROM file */
	romPath: string;
	/** Table name/ID */
	tableName: string;
}

/**
 * Create a virtual table URI
 *
 * @param romPath - Path to the ROM file (will be made absolute)
 * @param tableName - Table name/ID
 * @returns VSCode URI for the virtual table file
 *
 * @example
 * ```typescript
 * const uri = createTableUri('/Users/cole/ROM/test.hex', 'Fuel Map');
 * // Returns: ecu-table:///Users/cole/ROM/test.hex/Fuel%20Map
 * ```
 */
export function createTableUri(romPath: string, tableName: string): vscode.Uri {
	// Validate inputs
	if (!romPath) {
		throw new Error("ROM path is required");
	}
	if (!tableName) {
		throw new Error("Table name is required");
	}

	// Ensure ROM path is absolute
	const absolutePath = new URL(romPath, import.meta.url).pathname;

	// URL-encode table name to handle spaces and special characters
	const encodedTableName = encodeURIComponent(tableName);

	// Construct URI path: /rom/path/TableName
	// Use forward slashes for the URI path regardless of platform
	const normalizedAbsolutePath = absolutePath.replace(/\\/g, "/");
	const uriPath = normalizedAbsolutePath.startsWith("/")
		? `${normalizedAbsolutePath}/${encodedTableName}`
		: `/${normalizedAbsolutePath}/${encodedTableName}`;

	// Create URI with ecu-table scheme
	return vscode.Uri.parse(`ecu-table://${uriPath}`);
}

/**
 * Parse a virtual table URI
 *
 * @param uri - VSCode URI to parse
 * @returns Table URI components, or null if not a valid table URI
 *
 * @example
 * ```typescript
 * const uri = vscode.Uri.parse('ecu-table:///Users/cole/ROM/test.hex/Fuel%20Map');
 * const components = parseTableUri(uri);
 * // Returns: { romPath: '/Users/cole/ROM/test.hex', tableName: 'Fuel Map' }
 * ```
 */
export function parseTableUri(uri: vscode.Uri): TableUri | null {
	// Check if this is an ecu-table URI
	if (uri.scheme !== "ecu-table") {
		return null;
	}

	// Split path into ROM path and table name
	const lastSlash = uri.path.lastIndexOf("/");
	if (lastSlash === -1) {
		return null;
	}

	const romPath = uri.path.substring(0, lastSlash);
	const encodedTableName = uri.path.substring(lastSlash + 1);

	// Decode table name
	let tableName: string;
	try {
		tableName = decodeURIComponent(encodedTableName);
	} catch (error) {
		console.error("Failed to decode table name:", error);
		return null;
	}

	// Validate decoded values
	if (!romPath || !tableName) {
		return null;
	}

	return { romPath, tableName };
}

/**
 * Check if a URI is a table URI
 *
 * @param uri - VSCode URI to check
 * @returns True if the URI is a table URI
 *
 * @example
 * ```typescript
 * const uri = vscode.Uri.parse('ecu-table:///Users/cole/ROM/test.hex/Fuel%20Map');
 * if (isTableUri(uri)) {
 *   // Handle table URI
 * }
 * ```
 */
export function isTableUri(uri: vscode.Uri): boolean {
	return uri.scheme === "ecu-table";
}

/**
 * Validate a table URI
 *
 * Performs comprehensive validation including:
 * - Scheme validation
 * - Path parsing
 * - Component validation
 *
 * @param uri - VSCode URI to validate
 * @returns True if the URI is valid
 *
 * @example
 * ```typescript
 * const uri = vscode.Uri.parse('ecu-table:///Users/cole/ROM/test.hex/Fuel%20Map');
 * if (validateTableUri(uri)) {
 *   // URI is valid
 * }
 * ```
 */
export function validateTableUri(uri: vscode.Uri): boolean {
	// Check scheme
	if (!isTableUri(uri)) {
		return false;
	}

	// Parse components
	const components = parseTableUri(uri);
	if (!components) {
		return false;
	}

	// Validate components
	if (!components.romPath || !components.tableName) {
		return false;
	}

	return true;
}
