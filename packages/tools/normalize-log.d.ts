export function parseCsvLine(line: string): string[];
export function detectLogFormat(headers: string[]): "evoscan" | "unknown";
export function inferEvoScanUnit(channel: string): string;
export function normalizeEvoScanCsv(
	csvText: string,
	options?: {
		channels?: string[] | undefined;
	},
): {
	headers: string[];
	units: string[];
	rows: string[][];
};
export function renderNormalizedCsv(normalized: {
	headers: string[];
	units: string[];
	rows: string[][];
}): string;
export function getDefaultOutputPath(inputPath: string): string;
