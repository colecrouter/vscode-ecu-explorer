import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { inspectRom } from "../src/inspect-rom.js";

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "inspect-rom-"));
	try {
		await run(dir);
	} finally {
		await fs.rm(dir, { recursive: true, force: true });
	}
}

describe("inspectRom", () => {
	it("prints explicit definition table info in line-oriented format", async () => {
		await withTempDir(async (dir) => {
			const romPath = path.join(dir, "sample.hex");
			const defPath = path.join(dir, "sample.xml");
			const rom = new Uint8Array(32);
			rom[0] = 0xab;
			rom[1] = 0xcd;
			rom[0x10] = 10;
			rom[0x11] = 20;
			rom[0x12] = 30;
			await fs.writeFile(romPath, rom);
			await fs.writeFile(
				defPath,
				`<?xml version="1.0"?>
<rom>
	<romid>
		<xmlid>sample</xmlid>
		<internalidaddress>0</internalidaddress>
		<internalidhex>ABCD</internalidhex>
	</romid>
	<scaling name="byte" units="raw" toexpr="x" storagetype="uint8" endian="little" />
	<table name="Sample Table" category="Fuel" type="1D" address="10" elements="3" scaling="byte" />
</rom>
`,
				"utf8",
			);

			const logs: string[] = [];
			const spy = vi
				.spyOn(console, "log")
				.mockImplementation((value?: unknown) => {
					logs.push(String(value));
				});
			const errorSpy = vi
				.spyOn(console, "error")
				.mockImplementation(() => undefined);

			try {
				await inspectRom(["--rom", romPath, "--definition", defPath]);
			} finally {
				spy.mockRestore();
				errorSpy.mockRestore();
			}

			// console.error(JSON.stringify(logs, null, 2));

			expect(logs.some((line) => line.includes('kind="rom"'))).toBe(true);
			expect(
				logs.some((line) => line.includes('definitionMode="explicit"')),
			).toBe(true);
			expect(logs.some((line) => line.includes('name="Sample Table"'))).toBe(
				true,
			);
			expect(logs.some((line) => line.includes('valuesCount="1"'))).toBe(true);
			expect(logs.some((line) => line.includes("firstValue="))).toBe(true);
		});
	});

	it("auto-discovers and prints ranked matches", async () => {
		await withTempDir(async (dir) => {
			const romPath = path.join(dir, "sample.hex");
			const defsRoot = path.join(dir, "defs");
			const matchedDefPath = path.join(defsRoot, "matched.xml");
			const otherDefPath = path.join(defsRoot, "other.xml");
			await fs.mkdir(defsRoot, { recursive: true });

			const rom = new Uint8Array(32);
			rom[0] = 0xab;
			rom[1] = 0xcd;
			rom[0x10] = 99;
			await fs.writeFile(romPath, rom);

			await fs.writeFile(
				matchedDefPath,
				`<?xml version="1.0"?>
<rom>
	<romid>
		<xmlid>matched</xmlid>
		<internalidaddress>0</internalidaddress>
		<internalidhex>ABCD</internalidhex>
	</romid>
	<scaling name="byte" units="raw" toexpr="x" storagetype="uint8" endian="little" />
	<table name="Matched Table" type="1D" address="10" elements="1" scaling="byte" />
</rom>
`,
				"utf8",
			);

			await fs.writeFile(
				otherDefPath,
				`<?xml version="1.0"?>
<rom>
	<romid>
		<xmlid>other</xmlid>
		<internalidaddress>0</internalidaddress>
		<internalidhex>FFFF</internalidhex>
	</romid>
	<scaling name="byte" units="raw" toexpr="x" storagetype="uint8" endian="little" />
	<table name="Other Table" type="1D" address="10" elements="1" scaling="byte" />
</rom>
`,
				"utf8",
			);

			const logs: string[] = [];
			const spy = vi
				.spyOn(console, "log")
				.mockImplementation((value?: unknown) => {
					logs.push(String(value));
				});

			try {
				await inspectRom(["--rom", romPath, "--definition", matchedDefPath]);
			} finally {
				spy.mockRestore();
			}

			expect(
				logs.some((line) => line.includes('definitionMode="explicit"')),
			).toBe(true);
			expect(logs.some((line) => line.includes('name="Matched Table"'))).toBe(
				true,
			);
		});
	});

	it("fails deterministically when matches exist but none reach auto-select threshold", async () => {
		await withTempDir(async (dir) => {
			const romPath = path.join(dir, "sample.hex");
			const defsRoot = path.join(dir, "defs");
			const weakDefPath = path.join(defsRoot, "weak.xml");
			await fs.mkdir(defsRoot, { recursive: true });

			const rom = new Uint8Array(32);
			rom[0] = 0xab;
			rom[1] = 0xcd;
			rom[0x10] = 99;
			await fs.writeFile(romPath, rom);

			await fs.writeFile(
				weakDefPath,
				`<?xml version="1.0"?>
<rom>
	<romid>
		<xmlid>weak</xmlid>
		<internalidaddress>0</internalidaddress>
		<internalidhex>ABCD</internalidhex>
	</romid>
	<scaling name="byte" units="raw" toexpr="x" storagetype="uint8" endian="little" />
	<table name="Weak Table" type="1D" address="10" elements="1" scaling="byte" />
</rom>
`,
				"utf8",
			);

			const logs: string[] = [];
			const errors: string[] = [];
			const logSpy = vi
				.spyOn(console, "log")
				.mockImplementation((value?: unknown) => {
					logs.push(String(value));
				});
			const errorSpy = vi
				.spyOn(console, "error")
				.mockImplementation((value?: unknown) => {
					errors.push(String(value));
				});

			await expect(
				inspectRom(["--rom", romPath, "--definitions-root", defsRoot]),
			).rejects.toThrow(/manual definition selection/);

			logSpy.mockRestore();
			errorSpy.mockRestore();

			expect(logs.some((line) => line.includes('kind="candidate"'))).toBe(true);
			expect(
				errors.some((line) => line.includes("manual definition selection")),
			).toBe(true);
			expect(logs.some((line) => line.includes('score="0"'))).toBe(true);
		});
	});

	it("fails deterministically when definitions exist but none match", async () => {
		await withTempDir(async (dir) => {
			const romPath = path.join(dir, "sample.hex");
			const defsRoot = path.join(dir, "defs");
			const defPath = path.join(defsRoot, "other.xml");
			await fs.mkdir(defsRoot, { recursive: true });
			await fs.writeFile(romPath, new Uint8Array(32));
			await fs.writeFile(
				defPath,
				`<?xml version="1.0"?>
<rom>
	<romid>
		<xmlid>other</xmlid>
		<internalidaddress>0</internalidaddress>
		<internalidhex>FFFF</internalidhex>
	</romid>
	<scaling name="byte" units="raw" toexpr="x" storagetype="uint8" endian="little" />
	<table name="Other Table" type="1D" address="10" elements="1" scaling="byte" />
</rom>
`,
				"utf8",
			);

			const logs: string[] = [];
			const errors: string[] = [];
			const logSpy = vi
				.spyOn(console, "log")
				.mockImplementation((value?: unknown) => {
					logs.push(String(value));
				});
			const errorSpy = vi
				.spyOn(console, "error")
				.mockImplementation((value?: unknown) => {
					errors.push(String(value));
				});

			await expect(
				inspectRom(["--rom", romPath, "--definitions-root", defsRoot]),
			).rejects.toThrow(/manual definition selection/);

			logSpy.mockRestore();
			errorSpy.mockRestore();

			expect(logs.some((line) => line.includes('kind="candidate"'))).toBe(true);
			expect(logs.some((line) => line.includes('score="0"'))).toBe(true);
			expect(
				errors.some((line) => line.includes("manual definition selection")),
			).toBe(true);
		});
	});
});
