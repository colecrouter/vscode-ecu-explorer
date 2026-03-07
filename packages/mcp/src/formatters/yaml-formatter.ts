/**
 * YAML formatter for the ECU Explorer MCP server.
 *
 * Renders metadata objects as YAML documents or YAML frontmatter blocks.
 * Uses js-yaml for serialization.
 */

import yaml from "js-yaml";

function sanitizeYamlValue(value: unknown): unknown {
	if (typeof value === "function") {
		return undefined;
	}

	if (Array.isArray(value)) {
		return value
			.map((entry) => sanitizeYamlValue(entry))
			.filter((entry) => entry !== undefined);
	}

	if (value && typeof value === "object") {
		const entries = Object.entries(value as Record<string, unknown>)
			.map(([key, entry]) => [key, sanitizeYamlValue(entry)] as const)
			.filter(([, entry]) => entry !== undefined);
		return Object.fromEntries(entries);
	}

	return value;
}

/**
 * Serialize a metadata object as a YAML document.
 *
 * @param data - Object to serialize
 * @returns YAML string
 */
export function toYaml(data: Record<string, unknown>): string {
	return yaml.dump(sanitizeYamlValue(data), {
		indent: 2,
		lineWidth: 120,
		noRefs: true,
		sortKeys: false,
	});
}

/**
 * Wrap a metadata object in YAML frontmatter delimiters.
 *
 * @param data - Object to serialize as frontmatter
 * @returns YAML frontmatter block (---\n...\n---\n)
 */
export function toYamlFrontmatter(data: Record<string, unknown>): string {
	const yamlContent = toYaml(data);
	return `---\n${yamlContent}---\n`;
}
