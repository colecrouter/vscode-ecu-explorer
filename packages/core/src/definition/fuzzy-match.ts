/**
 * Fuzzy string matching utilities for table name lookups.
 *
 * Uses a hybrid scoring system combining substring matching,
 * base-name matching, and Levenshtein distance.
 */

/**
 * Calculates the Levenshtein distance between two strings.
 *
 * The Levenshtein distance is the minimum number of single-character edits
 * (insertions, deletions, or substitutions) required to change one string into the other.
 *
 * @param a - First string to compare
 * @param b - Second string to compare
 * @returns The Levenshtein distance between the two strings
 */
export function levenshteinDistance(a: string, b: string): number {
	const aLen = a.length;
	const bLen = b.length;

	// Handle empty strings
	if (aLen === 0) return bLen;
	if (bLen === 0) return aLen;

	// Use a more memory-efficient algorithm with two rows
	let previousRow: number[] = [];
	let currentRow: number[] = [];

	// Initialize previous row
	for (let j = 0; j <= bLen; j++) {
		previousRow[j] = j;
	}

	// Fill in the matrix row by row
	for (let i = 1; i <= aLen; i++) {
		// Initialize current row
		currentRow = [i];

		for (let j = 1; j <= bLen; j++) {
			const cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
			const deletion = (previousRow[j] ?? 0) + 1;
			const insertion = (currentRow[j - 1] ?? 0) + 1;
			const substitution = (previousRow[j - 1] ?? 0) + cost;
			currentRow[j] = Math.min(deletion, insertion, substitution);
		}

		// Swap rows
		[previousRow, currentRow] = [currentRow, previousRow];
	}

	return previousRow[bLen] ?? Infinity;
}

/**
 * Strips parenthetical descriptions from the end of a name.
 *
 * @param candidate - The candidate string to extract the base name from
 * @returns The base name without trailing parenthetical content
 *
 * @example
 * extractBaseName("Boost Target #1B (High Gear Range)") // → "Boost Target #1B"
 * extractBaseName("Fuel_Table")                         // → "Fuel_Table"
 * extractBaseName("Table A (variant (v2))")             // → "Table A"
 */
function extractBaseName(candidate: string): string {
	const match = candidate.match(/^(.+?)\s*\(/);
	return match ? (match[1] ?? candidate).trim() : candidate;
}

/**
 * Scores a candidate string against an input query.
 *
 * Returns a score 0–1 (higher = better match), checking in priority order:
 * - Level 1: Candidate contains input (case-insensitive) → score 0.95+
 * - Level 2: Base name of candidate contains input, or vice versa → score 0.85+
 * - Level 3: Normalized Levenshtein → score up to 0.84
 *
 * @param input - The query string
 * @param candidate - The candidate string to score
 * @returns Score between 0 and 1 (higher = better match)
 */
function scoreCandidate(input: string, candidate: string): number {
	const lowerInput = input.toLowerCase();
	const lowerCandidate = candidate.toLowerCase();

	// Level 1: Candidate contains the input as a substring (query is contained in the full name)
	if (lowerCandidate.includes(lowerInput)) {
		return 0.95 + 0.05 * (input.length / candidate.length);
	}

	// Level 2: Base name match (candidate has parens, and base name includes input or vice versa)
	const baseName = extractBaseName(lowerCandidate);
	if (baseName !== lowerCandidate) {
		if (baseName.includes(lowerInput) || lowerInput.includes(baseName)) {
			const coverage =
				Math.min(input.length, baseName.length) /
				Math.max(input.length, baseName.length);
			return 0.85 + 0.09 * coverage;
		}
	}

	// Level 3: Normalized Levenshtein
	const maxLen = Math.max(lowerInput.length, lowerCandidate.length);
	const distance = levenshteinDistance(lowerInput, lowerCandidate);
	return Math.max(0, Math.min(0.84, 1 - distance / maxLen));
}

/**
 * Finds the closest matching strings from a list of candidates.
 *
 * Uses a hybrid scoring system: substring matches, base-name matches, and
 * Levenshtein distance. Returns original case from the candidates list.
 *
 * @param input - The incorrect string to find matches for
 * @param candidates - List of available strings to match against
 * @param maxResults - Maximum number of matches to return (default: 3)
 * @param maxDistance - Maximum Levenshtein distance to consider for matches (default: Infinity)
 * @returns Array of closest matching strings, sorted by similarity (closest first)
 *
 * @example
 * const tables = ['Fuel_Table', 'Timing_Table', 'Boost_Table', 'Idle_Table'];
 * findClosestMatches('Fuel_Tabl', tables);
 * // Returns ['Fuel_Table'] (if maxResults is 1)
 *
 * @example
 * findClosestMatches('timing', ['Fuel_Table', 'Timing_Table', 'Boost_Table']);
 * // Returns ['Timing_Table']
 */
export function findClosestMatches(
	input: string,
	candidates: string[],
	maxResults: number = 3,
	maxDistance: number = Infinity,
): string[] {
	if (!input || input.length === 0) {
		return [];
	}

	if (!candidates || candidates.length === 0) {
		return [];
	}

	// Score all candidates
	const scored = candidates.map((c) => ({
		candidate: c,
		score: scoreCandidate(input, c),
	}));

	// Map maxDistance parameter to a minScore threshold.
	// maxLen here is max(query.length, max candidate length).
	// When maxDistance is Infinity, include all candidates (no filter).
	const maxLen = Math.max(input.length, ...candidates.map((c) => c.length));
	const minScore =
		maxDistance === Infinity
			? -Infinity
			: Math.max(0, 1 - maxDistance / maxLen);

	return scored
		.filter((s) => s.score > minScore)
		.sort((a, b) => b.score - a.score)
		.slice(0, maxResults)
		.map((s) => s.candidate);
}
