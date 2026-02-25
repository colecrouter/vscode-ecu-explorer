/**
 * YAML formatter for the ECU Explorer MCP server.
 *
 * Renders metadata objects as YAML documents or YAML frontmatter blocks.
 * Uses js-yaml for serialization.
 */

import yaml from "js-yaml";

/**
 * Serialize a metadata object as a YAML document.
 *
 * @param data - Object to serialize
 * @returns YAML string
 */
export function toYaml(data: Record<string, unknown>): string {
	return yaml.dump(data, {
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
