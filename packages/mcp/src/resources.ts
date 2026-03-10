/**
 * Shared MCP resource helpers.
 */

export interface OpenDocumentsContextResource {
	version: number;
	timestamp: string;
	roms?: Array<{
		uri: string;
		path: string;
		name: string;
		sizeBytes: number;
		definition?: { name: string; uri?: string };
		isDirty: boolean;
		activeEditors: number;
		lastFocusedAt?: string;
	}>;
	tables?: Array<{
		uri: string;
		tableId: string;
		romPath: string;
		romUri: string;
		kind: string;
		dimensions: { rows: number; cols: number };
		unit?: string;
		definitionUri?: string;
		activeEditors: number;
		lastFocusedAt?: string;
	}>;
}

export function buildOpenDocumentsContextPayload(
	context: OpenDocumentsContextResource & {
		roms?: OpenDocumentsContextResource["roms"] | [];
		tables?: OpenDocumentsContextResource["tables"] | [];
	},
): string {
	return JSON.stringify(
		{
			version: context.version,
			timestamp: context.timestamp,
			...(context.roms !== undefined && context.roms.length > 0
				? { roms: context.roms }
				: {}),
			...(context.tables !== undefined && context.tables.length > 0
				? { tables: context.tables }
				: {}),
		},
		null,
		2,
	);
}

export function buildQuerySyntaxResourceText(): string {
	return [
		"# ECU Explorer Query Syntax",
		"",
		"Supported operators:",
		"- `==`, `!=`, `>`, `>=`, `<`, `<=`",
		"- `&&`, `||`",
		"- parentheses",
		"",
		"Field names can be used exactly as exposed by the tool, including spaces and punctuation.",
		"",
		"Examples:",
		"- `Engine RPM > 3000 && Knock Sum > 0`",
		"- `RPM (rpm) >= 3000 && Load (g/rev) <= 2.0`",
		"- `Coolant Temp (C) >= 60 && Coolant Temp (C) <= 90`",
		"",
		"For table selectors, equality matches exact breakpoint values only.",
	].join("\n");
}
