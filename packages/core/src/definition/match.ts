import type { ROMDefinitionStub, ROMFingerprint } from "./rom";

/**
 * Normalize hex string by removing non-hex characters and converting to lowercase
 *
 * @param hex - Hex string to normalize
 * @returns Normalized hex string
 * @example
 * normalizeHex("12:34:AB:CD") // "1234abcd"
 */
function normalizeHex(hex: string): string {
	return hex.replace(/[^a-fA-F0-9]/g, "").toLowerCase();
}

/**
 * Convert hex string to byte array
 *
 * @param hex - Hex string to convert
 * @returns Byte array
 * @throws Error if hex string has odd length
 * @example
 * hexToBytes("1234") // Uint8Array([0x12, 0x34])
 */
function hexToBytes(hex: string): Uint8Array {
	const clean = normalizeHex(hex);
	if (clean.length % 2 !== 0) {
		throw new Error(`Invalid hex string length: ${hex.length}`);
	}
	const out = new Uint8Array(clean.length / 2);
	for (let i = 0; i < clean.length; i += 2) {
		out[i / 2] = Number.parseInt(clean.slice(i, i + 2), 16);
	}
	return out;
}

/**
 * Compare two byte arrays for equality
 *
 * @param a - First byte array
 * @param b - Second byte array
 * @returns True if arrays are equal
 */
function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
	return true;
}

/**
 * Score a ROM fingerprint against ROM bytes
 *
 * Compares expected byte sequences at specific addresses in the ROM
 * against actual bytes. Each match contributes its weight to the score.
 * Used for ROM definition matching.
 *
 * @param romBytes - ROM image bytes to score against
 * @param fp - Fingerprint with expected bytes and addresses
 * @returns Score from 0 to sum of weights (higher is better match)
 * @example
 * const score = scoreRomFingerprint(romBytes, fingerprint);
 * if (score > 500) { // Good match
 *   useDefinition(definition);
 * }
 */
export function scoreRomFingerprint(
	romBytes: Uint8Array,
	fp: ROMFingerprint,
): number {
	const weights = fp.weights ?? fp.reads.map(() => 100);
	let score = 0;

	for (let i = 0; i < fp.reads.length; i++) {
		const read = fp.reads[i];
		if (!read) continue;
		const expectedHex = fp.expectedHex[i] ?? "";
		const weight = weights[i] ?? 100;
		if (!expectedHex) continue;
		if (read.address < 0 || read.length <= 0) continue;
		if (read.address + read.length > romBytes.length) continue;

		const actual = romBytes.subarray(read.address, read.address + read.length);
		const expected = hexToBytes(expectedHex);
		if (bytesEqual(actual, expected)) score += weight;
	}

	return score;
}

/**
 * Score a ROM definition against ROM bytes
 *
 * Finds the best matching fingerprint for the definition and returns
 * its score. Used to find the best matching ROM definition for a given ROM.
 *
 * @param romBytes - ROM image bytes to score against
 * @param stub - ROM definition with fingerprints
 * @returns Best score among all fingerprints (higher is better match)
 * @example
 * const score = scoreRomDefinition(romBytes, definition);
 * if (score > bestScore) {
 *   bestScore = score;
 *   bestDefinition = definition;
 * }
 */
export function scoreRomDefinition(
	romBytes: Uint8Array,
	stub: ROMDefinitionStub,
): number {
	let best = 0;
	for (const fp of stub.fingerprints) {
		const s = scoreRomFingerprint(romBytes, fp);
		if (s > best) best = s;
	}
	return best;
}
