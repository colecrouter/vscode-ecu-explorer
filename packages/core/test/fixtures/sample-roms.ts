/**
 * Helper functions to create test ROM byte arrays
 */

export function createEmptyRom(size: number = 0x10000): Uint8Array {
	return new Uint8Array(size);
}

export function createRomWithPattern(
	size: number,
	pattern: number[],
): Uint8Array {
	const rom = new Uint8Array(size);
	for (let i = 0; i < size; i++) {
		const patternValue = pattern[i % pattern.length];
		rom[i] = patternValue ?? 0;
	}
	return rom;
}

export function createRomWithFingerprint(
	fingerprint: number[],
	size: number = 0x10000,
): Uint8Array {
	const rom = new Uint8Array(size);
	for (let i = 0; i < fingerprint.length && i < size; i++) {
		const value = fingerprint[i];
		rom[i] = value ?? 0;
	}
	return rom;
}

export function createRomWithData(
	baseAddress: number,
	data: number[],
	size: number = 0x10000,
): Uint8Array {
	const rom = new Uint8Array(size);
	for (let i = 0; i < data.length && baseAddress + i < size; i++) {
		const value = data[i];
		rom[baseAddress + i] = value ?? 0;
	}
	return rom;
}

export function createRomWithTable(
	tableAddress: number,
	tableData: number[],
	size: number = 0x10000,
): Uint8Array {
	return createRomWithData(tableAddress, tableData, size);
}

export function createRomWithAxis(
	axisAddress: number,
	axisData: number[],
	size: number = 0x10000,
): Uint8Array {
	return createRomWithData(axisAddress, axisData, size);
}

export function createRomWithMultipleTables(
	tables: Array<{ address: number; data: number[] }>,
	size: number = 0x10000,
): Uint8Array {
	const rom = new Uint8Array(size);
	for (const table of tables) {
		for (let i = 0; i < table.data.length && table.address + i < size; i++) {
			const value = table.data[i];
			rom[table.address + i] = value ?? 0;
		}
	}
	return rom;
}

export function createEvo10Rom(): Uint8Array {
	// Create a sample Evo 10 ROM with known fingerprints
	const rom = new Uint8Array(0x10000);

	// Add Evo 10 fingerprint at known location
	const fingerprint = [0x4d, 0x5a, 0x90, 0x00]; // MZ header
	for (let i = 0; i < fingerprint.length; i++) {
		const value = fingerprint[i];
		rom[i] = value ?? 0;
	}

	return rom;
}

export function createCorruptedRom(): Uint8Array {
	// Create a ROM with all 0xFF (erased/corrupted)
	return new Uint8Array(0x10000).fill(0xff);
}

export function createMinimalRom(): Uint8Array {
	// Create a minimal ROM (256 bytes)
	return new Uint8Array(256);
}

export function createLargeRom(): Uint8Array {
	// Create a large ROM (1MB)
	return new Uint8Array(0x100000);
}

export function getRomByte(rom: Uint8Array, address: number): number {
	if (address < 0 || address >= rom.length) {
		throw new Error(`Address out of bounds: 0x${address.toString(16)}`);
	}
	return rom[address] ?? 0;
}

export function setRomByte(
	rom: Uint8Array,
	address: number,
	value: number,
): void {
	if (address < 0 || address >= rom.length) {
		throw new Error(`Address out of bounds: 0x${address.toString(16)}`);
	}
	rom[address] = value & 0xff;
}

export function getRomWord(
	rom: Uint8Array,
	address: number,
	endian: "le" | "be" = "le",
): number {
	if (address + 1 >= rom.length) {
		throw new Error(`Address out of bounds: 0x${address.toString(16)}`);
	}

	if (endian === "le") {
		return (rom[address] ?? 0) | ((rom[address + 1] ?? 0) << 8);
	} else {
		return ((rom[address] ?? 0) << 8) | (rom[address + 1] ?? 0);
	}
}

export function setRomWord(
	rom: Uint8Array,
	address: number,
	value: number,
	endian: "le" | "be" = "le",
): void {
	if (address + 1 >= rom.length) {
		throw new Error(`Address out of bounds: 0x${address.toString(16)}`);
	}

	if (endian === "le") {
		rom[address] = value & 0xff;
		rom[address + 1] = (value >> 8) & 0xff;
	} else {
		rom[address] = (value >> 8) & 0xff;
		rom[address + 1] = value & 0xff;
	}
}
