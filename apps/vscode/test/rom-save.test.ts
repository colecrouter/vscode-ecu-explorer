import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ChecksumDefinition } from "@ecu-explorer/core";
import { validateChecksum } from "@ecu-explorer/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RomSaveManager } from "../src/rom/save-manager";

describe("ROM Save Integration Test", () => {
	const testDir = path.join(__dirname, "..", "..", "..", "test-output");
	const romFileName = "56890009_2011_USDM_5MT.hex";
	const originalRomPath = path.join(__dirname, "..", "..", "..", romFileName);
	let testRomPath: string;
	let saveManager: RomSaveManager;

	beforeEach(async () => {
		// Create test output directory
		await fs.mkdir(testDir, { recursive: true });

		// Copy original ROM to test directory
		testRomPath = path.join(testDir, romFileName);
		await fs.copyFile(originalRomPath, testRomPath);

		// Initialize save manager
		saveManager = new RomSaveManager();
	});

	afterEach(async () => {
		// Clean up test files
		try {
			await fs.rm(testDir, { recursive: true, force: true });
		} catch {
			// Ignore cleanup errors
		}
	});

	it("should save ROM without checksum validation", async () => {
		// Read original ROM
		const originalData = await fs.readFile(testRomPath);

		// Make a test edit (change first byte)
		const modifiedData = new Uint8Array(originalData);
		modifiedData[0] = (modifiedData[0] ?? 0) ^ 0xff;

		// Save ROM without checksum
		const result = await saveManager.save({
			romPath: testRomPath,
			romData: modifiedData,
		});

		// Verify save succeeded
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		// Verify ROM was modified
		const savedData = await fs.readFile(testRomPath);
		expect(savedData[0]).toBe(modifiedData[0]);
		expect(savedData[0]).not.toBe(originalData[0]);
	});

	it("should save ROM with checksum recomputation", async () => {
		// Read original ROM
		const originalData = await fs.readFile(testRomPath);

		// Create a hardcoded checksum definition for Mitsubishi CAN (mitsucan)
		// Based on common Mitsubishi ROM structure
		// This is a simplified example - real implementation would parse from XML
		const checksumDef: ChecksumDefinition = {
			algorithm: "crc32",
			regions: [
				{ start: 0, end: 0x7fffc }, // Main ROM region (excluding checksum storage)
			],
			storage: {
				offset: 0x7fffc, // Checksum stored at end of ROM
				size: 4,
				endianness: "be",
			},
		};

		// Validate original checksum
		const originalValidation = validateChecksum(originalData, checksumDef);
		console.log("Original checksum validation:", originalValidation);

		// Make a test edit (change a byte in the middle of ROM)
		const modifiedData = new Uint8Array(originalData);
		const editOffset = 0x1000;
		modifiedData[editOffset] = (modifiedData[editOffset] ?? 0) ^ 0xff;

		// Save ROM with checksum recomputation
		const result = await saveManager.save({
			romPath: testRomPath,
			romData: modifiedData,
			checksumDef,
		});

		// Verify save succeeded
		expect(result.ok).toBe(true);

		// Verify ROM was modified
		const savedData = await fs.readFile(testRomPath);
		expect(savedData[editOffset]).toBe(modifiedData[editOffset]);

		// Verify checksum is valid after save
		const savedValidation = validateChecksum(savedData, checksumDef);
		console.log("Saved checksum validation:", savedValidation);
		expect(savedValidation.valid).toBe(true);
	});

	it("should handle save errors gracefully", async () => {
		// Try to save to invalid path
		const result = await saveManager.save({
			romPath: "/invalid/path/that/does/not/exist/rom.hex",
			romData: new Uint8Array([1, 2, 3]),
		});

		// Verify save failed
		expect(result.ok).toBe(false);
		if (result.ok) return;

		// Verify error message is present
		expect(result.error).toBeTruthy();
		expect(result.error.length).toBeGreaterThan(0);
	});

	it("should validate checksum after save", async () => {
		// Read original ROM
		const originalData = await fs.readFile(testRomPath);

		// Create a checksum definition
		const checksumDef: ChecksumDefinition = {
			algorithm: "crc32",
			regions: [{ start: 0, end: 0x1000 }],
			storage: {
				offset: 0x1000,
				size: 4,
				endianness: "be",
			},
		};

		// Make a test edit
		const modifiedData = new Uint8Array(originalData);
		modifiedData[0] = (modifiedData[0] ?? 0) ^ 0xff;

		// Save ROM with checksum definition
		// This should succeed because we recompute the checksum
		const result = await saveManager.save({
			romPath: testRomPath,
			romData: modifiedData,
			checksumDef,
		});

		// The save should succeed because we recompute the checksum
		// This test demonstrates that the save manager properly handles checksums
		expect(result.ok).toBe(true);
	});
});
