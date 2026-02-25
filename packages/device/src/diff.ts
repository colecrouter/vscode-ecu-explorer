/**
 * Identifies which flash sectors differ between two ROM images.
 *
 * Operates at sector (erase block) granularity because flash can only be
 * erased in whole sectors. Uses O(n) byte comparison per sector with early
 * exit on first difference.
 *
 * @param original   - ROM image read from the ECU (before modification)
 * @param modified   - ROM image to be written (after modification)
 * @param sectorSize - Size of one flash erase block in bytes (e.g. 0x10000 for 64 KB)
 * @returns          - Array of zero-based sector indices that contain at least one changed byte
 * @throws           - If original and modified have different lengths
 * @throws           - If modified.length is not a multiple of sectorSize
 *
 * @example
 * // 1 MB ROM, 64 KB sectors → 16 sectors
 * const changed = computeChangedSectors(originalRom, modifiedRom, 0x10000);
 * // changed might be [2, 7] — only sectors 2 and 7 differ
 */
export function computeChangedSectors(
	original: Uint8Array,
	modified: Uint8Array,
	sectorSize: number,
): number[] {
	if (original.length !== modified.length) {
		throw new Error(
			`ROM size mismatch: original is ${original.length} bytes, modified is ${modified.length} bytes`,
		);
	}

	if (modified.length % sectorSize !== 0) {
		throw new Error(
			`ROM size ${modified.length} is not a multiple of sector size ${sectorSize}`,
		);
	}

	const changedSectors: number[] = [];
	const numSectors = modified.length / sectorSize;

	for (let i = 0; i < numSectors; i++) {
		const start = i * sectorSize;
		const end = start + sectorSize;

		// O(n) comparison with early exit on first differing byte
		for (let j = start; j < end; j++) {
			if (original[j] !== modified[j]) {
				changedSectors.push(i);
				break; // early exit — no need to scan rest of sector
			}
		}
	}

	return changedSectors;
}
