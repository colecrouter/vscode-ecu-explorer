/**
 * Computes the SecurityAccess key from a seed for Subaru/Denso ECUs.
 *
 * ## Algorithm
 *
 * Uses model-specific S-box nibble-swap tables extracted from EcuFlash binary
 * analysis (`densoecu::get_subaru_key` / `transform_kernel_block02`).
 *
 * For each byte in the seed:
 * 1. Split into high nibble (bits 7–4) and low nibble (bits 3–0).
 * 2. Map the high nibble through S-box A (default / flag=false path).
 * 3. XOR the low nibble with 0x5.
 * 4. Recombine: `(new_high << 4) | new_low`.
 *
 * S-box A (16 entries, indexed by high nibble):
 * ```
 * [10, 5, 4, 7, 6, 1, 0, 3, 2, 13, 12, 15, 14, 9, 8, 11]
 * ```
 *
 * S-box B (16 entries, used when flag=true):
 * ```
 * [6, 5, 8, 7, 2, 1, 4, 3, 14, 13, 0, 15, 10, 9, 12, 11]
 * ```
 *
 * ## References
 *
 * - HANDSHAKE_ANALYSIS.md — §4.5 Subaru Kernel Transformation
 *   (`densoecu::transform_kernel_block02`, address `0x1510a`)
 * - HANDSHAKE_ANALYSIS.md — §4.3 Subaru Key Algorithm
 *   (`densoecu::get_subaru_key`, address `0x1509e`)
 * - HANDSHAKE_ANALYSIS.md — §4.2 Subaru Security Access
 *   (`densoecu::do_challenge_response`, address `0x15a26`)
 * - EcuFlash binary — `densoecu::get_subaru_key` vtable dispatch
 *
 * @param seed - 2-byte seed from KWP2000 SecurityAccess response (0x67 0x01 <seed>)
 * @returns 2-byte key for SecurityAccess request (0x27 0x02 <key>)
 * @throws {RangeError} if seed is not exactly 2 bytes
 */
export function computeSubaruKey(seed: Uint8Array): Uint8Array {
	if (seed.length !== 2) {
		throw new RangeError(
			`computeSubaruKey: expected 2-byte seed, got ${seed.length} bytes`,
		);
	}

	// S-box A: high-nibble substitution table (flag=false path)
	// Ref: HANDSHAKE_ANALYSIS.md — §4.5 densoecu::transform_kernel_block02 (0x1510a)
	// sbox_A = [10, 5, 4, 7, 6, 1, 0, 3, 2, 13, 12, 15, 14, 9, 8, 11]
	const SBOX_A = new Uint8Array([
		10, 5, 4, 7, 6, 1, 0, 3, 2, 13, 12, 15, 14, 9, 8, 11,
	]);

	const key = new Uint8Array(2);

	for (let i = 0; i < 2; i++) {
		const byte = seed[i]!;

		// Split into nibbles
		const highNibble = (byte >> 4) & 0xf;
		const lowNibble = byte & 0xf;

		// Apply S-box A to high nibble
		// Ref: HANDSHAKE_ANALYSIS.md — §4.5 (flag=false → sbox_A path)
		const newHigh = SBOX_A[highNibble]!;

		// XOR low nibble with 0x5
		// Ref: HANDSHAKE_ANALYSIS.md — §4.5 new_low = low_nibble XOR 0x5
		const newLow = lowNibble ^ 0x5;

		// Recombine nibbles
		key[i] = (newHigh << 4) | newLow;
	}

	return key;
}
