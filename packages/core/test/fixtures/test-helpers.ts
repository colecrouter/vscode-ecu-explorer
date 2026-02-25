import { expect } from "vitest";

/**
 * Common test utilities and assertions for core package tests
 */

export function createTestRomBuffer(size: number = 256): Uint8Array {
	return new Uint8Array(size);
}

export function fillRomBuffer(buffer: Uint8Array, pattern: number[]): void {
	for (let i = 0; i < buffer.length; i++) {
		const value = pattern[i % pattern.length];
		buffer[i] = value ?? 0;
	}
}

export function createRomWithFingerprint(fingerprint: number[]): Uint8Array {
	const buffer = new Uint8Array(256);
	for (let i = 0; i < fingerprint.length; i++) {
		const value = fingerprint[i];
		buffer[i] = value ?? 0;
	}
	return buffer;
}

export function assertBufferEquals(
	actual: Uint8Array,
	expected: Uint8Array,
): void {
	expect(actual.length).toBe(expected.length);
	for (let i = 0; i < actual.length; i++) {
		expect(actual[i]).toBe(expected[i]);
	}
}

export function assertScalarValue(
	actual: number,
	expected: number,
	tolerance: number = 0,
): void {
	if (tolerance > 0) {
		expect(actual).toBeCloseTo(expected, tolerance);
	} else {
		expect(actual).toBe(expected);
	}
}

export function createScaledValue(
	rawValue: number,
	scale: number,
	offset: number,
): number {
	return rawValue * scale + offset;
}

export function createTableAddress(
	baseAddress: number,
	row: number,
	col: number,
	columns: number,
	elementSize: number = 2,
): number {
	return baseAddress + (row * columns + col) * elementSize;
}

export function create3DTableAddress(
	baseAddress: number,
	layer: number,
	row: number,
	col: number,
	columns: number,
	rows: number,
	elementSize: number = 2,
): number {
	return (
		baseAddress + (layer * rows * columns + row * columns + col) * elementSize
	);
}

export function assertAddressInBounds(address: number, romSize: number): void {
	expect(address).toBeGreaterThanOrEqual(0);
	expect(address).toBeLessThan(romSize);
}

export function createTestDefinition(overrides: Record<string, any> = {}) {
	return {
		name: "Test Definition",
		providerId: "test-provider",
		defUri: "test://definition",
		tables: [],
		...overrides,
	};
}

export function createTestTable(overrides: Record<string, any> = {}) {
	return {
		name: "Test Table",
		address: 0x1000,
		type: "1d",
		columns: 10,
		...overrides,
	};
}

export function createTestAxis(overrides: Record<string, any> = {}) {
	return {
		name: "Test Axis",
		address: 0x2000,
		length: 10,
		type: "u16",
		...overrides,
	};
}
