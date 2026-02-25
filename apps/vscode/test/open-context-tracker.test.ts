/**
 * Tests for OpenContextTracker
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as vscode from "vscode";
import { OpenContextTracker } from "../src/open-context-tracker.js";
import { RomDocument } from "../src/rom/document.js";

describe("OpenContextTracker", () => {
	let tracker: OpenContextTracker;

	beforeEach(() => {
		tracker = new OpenContextTracker();
	});

	afterEach(() => {
		tracker.dispose();
	});

	describe("ROM tracking", () => {
		it("should add ROM document and track its state", async () => {
			const uri = vscode.Uri.file("/path/to/rom.bin");
			const romBytes = new Uint8Array([0x00, 0x01, 0x02]);
			const romDoc = new RomDocument(uri, romBytes);

			tracker.addRomDocument(romDoc);

			const context = tracker.getContext();

			expect(context.roms).toHaveLength(1);
			expect(context.roms[0]?.uri).toBe(uri.toString());
			expect(context.roms[0]?.name).toBe("rom.bin");
			expect(context.roms[0]?.sizeBytes).toBe(3);
			expect(context.roms[0]?.isDirty).toBe(false);
			expect(context.roms[0]?.activeEditors).toBe(1);

			romDoc.dispose();
		});

		it("should update ROM dirty state when ROM changes", async () => {
			const uri = vscode.Uri.file("/path/to/rom.bin");
			const romBytes = new Uint8Array([0x00]);
			const romDoc = new RomDocument(uri, romBytes);

			tracker.addRomDocument(romDoc);

			let context = tracker.getContext();
			expect(context.roms[0]?.isDirty).toBe(false);

			// Simulate ROM becoming dirty
			romDoc.makeDirty();

			// Wait for debounce
			await new Promise((resolve) => setTimeout(resolve, 150));

			context = tracker.getContext();
			expect(context.roms[0]?.isDirty).toBe(true);

			romDoc.dispose();
		});

		it("should emit context update when ROM is added", async () => {
			const contextUpdates: any[] = [];
			tracker.onContextUpdate((context) => {
				contextUpdates.push(context);
			});

			const uri = vscode.Uri.file("/path/to/rom.bin");
			const romBytes = new Uint8Array([0x00]);
			const romDoc = new RomDocument(uri, romBytes);

			tracker.addRomDocument(romDoc);

			// Wait for debounce
			await new Promise((resolve) => setTimeout(resolve, 150));

			expect(contextUpdates.length).toBeGreaterThan(0);
			expect(contextUpdates[contextUpdates.length - 1]?.roms).toHaveLength(1);

			romDoc.dispose();
		});

		it("should set focus timestamp", async () => {
			const uri = vscode.Uri.file("/path/to/rom.bin");
			const romBytes = new Uint8Array([0x00]);
			const romDoc = new RomDocument(uri, romBytes);

			tracker.addRomDocument(romDoc);

			const context1 = tracker.getContext();
			const oldTime = context1.roms[0]?.lastFocusedAt;

			// Wait and then set focus
			await new Promise((resolve) => setTimeout(resolve, 10));
			tracker.setRomFocused(uri.toString());

			const context2 = tracker.getContext();
			const newTime = context2.roms[0]?.lastFocusedAt;

			expect(newTime).toBeDefined();
			expect(newTime).not.toBe(oldTime);

			romDoc.dispose();
		});
	});

	describe("Context payload", () => {
		it("should generate valid context with version and timestamp", () => {
			const context = tracker.getContext();

			expect(context.version).toBe(1);
			expect(context.timestamp).toBeDefined();
			expect(typeof context.timestamp).toBe("string");
			expect(context.roms).toBeInstanceOf(Array);
			expect(context.tables).toBeInstanceOf(Array);
		});

		it("should have empty arrays initially", () => {
			const context = tracker.getContext();

			expect(context.roms).toHaveLength(0);
			expect(context.tables).toHaveLength(0);
		});
	});
});
