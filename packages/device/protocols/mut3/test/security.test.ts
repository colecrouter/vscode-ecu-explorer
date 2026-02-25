import { describe, expect, it } from "vitest";
import { computeSecurityKey } from "../src/security.js";

/**
 * Unit tests for the Mitsubishi 4B11T SecurityAccess seed/key algorithm.
 *
 * Algorithm: key16 = (seed16 * 0x4081 + 0x1234) & 0xFFFF
 *
 * Expected values are computed from the algorithm formula and verified
 * against the community-documented Mitsubishi/Denso security algorithm.
 */
describe("computeSecurityKey", () => {
	// ── Known seed/key pairs ────────────────────────────────────────────────

	it("all-zeros seed produces 0x1234 key (additive constant only)", () => {
		// seed16 = 0x0000 → key16 = (0 * 0x4081 + 0x1234) & 0xFFFF = 0x1234
		const key = computeSecurityKey(new Uint8Array([0x00, 0x00]));
		expect(Array.from(key)).toEqual([0x12, 0x34]);
	});

	it("all-0xFF seed produces correct key", () => {
		// seed16 = 0xFFFF → key16 = (0xFFFF * 0x4081 + 0x1234) & 0xFFFF = 0xD1B3
		const key = computeSecurityKey(new Uint8Array([0xff, 0xff]));
		expect(Array.from(key)).toEqual([0xd1, 0xb3]);
	});

	it("seed 0x1234 produces correct key", () => {
		// seed16 = 0x1234 → key16 = (0x1234 * 0x4081 + 0x1234) & 0xFFFF = 0x3E68
		const key = computeSecurityKey(new Uint8Array([0x12, 0x34]));
		expect(Array.from(key)).toEqual([0x3e, 0x68]);
	});

	it("seed 0xABCD produces correct key", () => {
		// seed16 = 0xABCD → key16 = (0xABCD * 0x4081 + 0x1234) & 0xFFFF = 0xE481
		const key = computeSecurityKey(new Uint8Array([0xab, 0xcd]));
		expect(Array.from(key)).toEqual([0xe4, 0x81]);
	});

	it("seed 0x0001 produces correct key", () => {
		// seed16 = 0x0001 → key16 = (0x0001 * 0x4081 + 0x1234) & 0xFFFF = 0x52B5
		const key = computeSecurityKey(new Uint8Array([0x00, 0x01]));
		expect(Array.from(key)).toEqual([0x52, 0xb5]);
	});

	it("seed 0x8000 produces correct key (high-bit set)", () => {
		// seed16 = 0x8000 → key16 = (0x8000 * 0x4081 + 0x1234) & 0xFFFF = 0x9234
		const key = computeSecurityKey(new Uint8Array([0x80, 0x00]));
		expect(Array.from(key)).toEqual([0x92, 0x34]);
	});

	// ── Output format ───────────────────────────────────────────────────────

	it("returns a Uint8Array of exactly 2 bytes", () => {
		const key = computeSecurityKey(new Uint8Array([0x00, 0x00]));
		expect(key).toBeInstanceOf(Uint8Array);
		expect(key.length).toBe(2);
	});

	it("returns a different Uint8Array instance from the input", () => {
		const seed = new Uint8Array([0x12, 0x34]);
		const key = computeSecurityKey(seed);
		expect(key).not.toBe(seed);
	});

	// ── Algorithm properties ────────────────────────────────────────────────

	it("is deterministic — same seed always produces same key", () => {
		const seed = new Uint8Array([0xde, 0xad]);
		const key1 = computeSecurityKey(seed);
		const key2 = computeSecurityKey(seed);
		expect(Array.from(key1)).toEqual(Array.from(key2));
	});

	it("different seeds produce different keys (non-trivial mapping)", () => {
		const key1 = computeSecurityKey(new Uint8Array([0x00, 0x00]));
		const key2 = computeSecurityKey(new Uint8Array([0x00, 0x01]));
		expect(Array.from(key1)).not.toEqual(Array.from(key2));
	});

	it("key is not a simple XOR of the seed (not the stub algorithm)", () => {
		// The old stub was: key[i] = seed[i] ^ 0xFF
		// Verify the real algorithm differs from the stub for a known seed
		const seed = new Uint8Array([0x12, 0x34]);
		const key = computeSecurityKey(seed);
		const stubKey = [0x12 ^ 0xff, 0x34 ^ 0xff]; // [0xED, 0xCB]
		expect(Array.from(key)).not.toEqual(stubKey);
	});

	// ── Error handling ──────────────────────────────────────────────────────

	it("throws RangeError for empty seed", () => {
		expect(() => computeSecurityKey(new Uint8Array([]))).toThrow(RangeError);
	});

	it("throws RangeError for 1-byte seed", () => {
		expect(() => computeSecurityKey(new Uint8Array([0x42]))).toThrow(
			RangeError,
		);
	});

	it("throws RangeError for 3-byte seed", () => {
		expect(() =>
			computeSecurityKey(new Uint8Array([0x01, 0x02, 0x03])),
		).toThrow(RangeError);
	});

	it("throws RangeError for 4-byte seed", () => {
		expect(() =>
			computeSecurityKey(new Uint8Array([0x01, 0x02, 0x03, 0x04])),
		).toThrow(RangeError);
	});

	it("error message includes the actual seed length", () => {
		expect(() =>
			computeSecurityKey(new Uint8Array([0x01, 0x02, 0x03])),
		).toThrow(/3 bytes/);
	});
});
