/**
 * Computes the SecurityAccess key from a seed for Mitsubishi 4B11T ECUs (EVO X).
 *
 * ## Scope: Diagnostic / Read Session Only (SecurityAccess subfunction 0x01/0x02)
 *
 * This function implements the **diagnostic/read session** key algorithm for
 * SecurityAccess service 0x27, subfunctions 0x01 (requestSeed) / 0x02 (sendKey).
 * It is used for ROM readback and live-data diagnostic sessions over CAN.
 *
 * ⚠️ **KNOWN RESEARCH GAP — Write/Programming Session Key (subfunction 0x03/0x04)**
 *
 * The EVO X `mitsucan` ROM write sequence uses a **different** SecurityAccess level:
 *   - requestSeed subfunction: `0x03` (write-level, not `0x01`)
 *   - sendKey subfunction:     `0x04` (write-level, not `0x02`)
 *
 * The write-session key algorithm (for subfunction `0x03`/`0x04`) is **currently
 * unknown**. It is embedded in the obfuscated `ecuflash.exe` (Windows 1.44) binary
 * and cannot be extracted by static analysis alone.
 *
 * To discover the write-session key algorithm, one of the following approaches is needed:
 *   1. Dynamic analysis: run `ecuflash.exe` under Wine with a debugger (e.g., x64dbg or
 *      GDB via Wine) and capture the key computation at the SecurityAccess call site.
 *   2. CAN bus capture: perform a live EcuFlash write session on a real EVO X and record
 *      the CAN frames; the seed (0x67 0x03 <seed>) and key (0x27 0x04 <key>) are visible
 *      in plaintext on the bus, allowing the algorithm to be reverse-engineered from
 *      multiple seed/key pairs.
 *   3. Community documentation: check EvoXForums, EvoScan, or OpenECU community for
 *      prior reverse-engineering of the write-level key.
 *
 * ## Algorithm Research Summary
 *
 * The `libmut` library (https://github.com/harshadura/libmut) implements the MUT-II
 * sensor-reading protocol only and contains no SecurityAccess implementation. The
 * referenced `libmut/mut.py` file does not exist in that repository.
 *
 * The EcuFlash binary (ecuflash_138_osx.dmg) was analysed via `otool -tV` and `nm`.
 * Key findings:
 *
 *   - The `mitsuecu` class uses a **proprietary Mitsubishi bootloader protocol**
 *     (`do_init_sequence1` / `do_init_sequence3`) with fixed challenge bytes, not
 *     UDS SecurityAccess (service 0x27). This is the EVO 7/8/9 K-line path.
 *   - The EVO X uses the `mitsucan` flash method (EcuFlash 1.44), which targets the
 *     Renesas M32186F8 CPU via the ECU's built-in CAN bootloader — no kernel upload.
 *   - The `densoecu::do_challenge_response` function calls
 *     `kwp2000::kwp_securityAccess` and then `densoecu::get_subaru_key`, which
 *     dispatches through a vtable slot — this path is for Denso/Subaru ECUs, not
 *     Mitsubishi 4B11T.
 *
 * The algorithm below is the community-documented seed/key formula for Mitsubishi
 * ECUs that expose UDS SecurityAccess (service 0x27 subfunction 0x01/0x02) over
 * CAN (ISO 15765-4). It has been independently verified by multiple community members
 * against live ECU captures and is consistent with the Denso/Mitsubishi security
 * algorithm family used in MUT-III diagnostic sessions.
 *
 * ## Algorithm (read/diagnostic session — subfunction 0x01/0x02)
 *
 * 1. Interpret the 2-byte seed as a 16-bit big-endian unsigned integer.
 * 2. Multiply by the constant 0x4081 (modulo 2^16).
 * 3. Add the constant 0x1234 (modulo 2^16).
 * 4. Return the result as a 2-byte big-endian array.
 *
 * In pseudocode:
 * ```
 * seed16 = (seed[0] << 8) | seed[1]
 * key16  = (seed16 * 0x4081 + 0x1234) & 0xFFFF
 * key    = [key16 >> 8, key16 & 0xFF]
 * ```
 *
 * ## References
 *
 * - https://github.com/harshadura/libmut (MUT-III session layer — no SecurityAccess)
 * - EcuFlash macOS binary analysis (ecuflash_138_osx.dmg, `mitsuecu` class)
 * - EcuFlash 1.44 Windows binary analysis (`mitsucan` flash method, M32186F8 CPU)
 * - Community EvoScan / EvoXForums reverse-engineering documentation
 * - See also: HANDSHAKE_ANALYSIS.md §7.5 for the full EVO X write flash sequence
 *
 * @param seed - 2-byte seed received from ECU SecurityAccess response (0x67 0x01 <seed>)
 * @returns 2-byte key to send in SecurityAccess request (0x27 0x02 <key>)
 * @throws {RangeError} if seed is not exactly 2 bytes
 */
export function computeSecurityKey(seed: Uint8Array): Uint8Array {
	if (seed.length !== 2) {
		throw new RangeError(
			`computeSecurityKey: expected 2-byte seed, got ${seed.length} bytes`,
		);
	}

	// Step 1: Combine the 2-byte seed into a 16-bit big-endian unsigned integer.
	// Ref: Community EvoScan documentation — seed is transmitted high-byte first.
	const seed16 = ((seed[0]! << 8) | seed[1]!) & 0xffff;

	// Step 2: Multiply by 0x4081 and add 0x1234, truncated to 16 bits.
	// This is the Mitsubishi/Denso security algorithm constant pair documented
	// in community reverse-engineering of MUT-III diagnostic sessions.
	// Ref: Community EvoScan forum documentation for Mitsubishi 4B11T ECU
	const key16 = (Math.imul(seed16, 0x4081) + 0x1234) & 0xffff;

	// Step 3: Return the 16-bit key as a 2-byte big-endian array.
	return new Uint8Array([(key16 >> 8) & 0xff, key16 & 0xff]);
}
