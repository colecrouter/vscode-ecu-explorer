import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { clearRomCache, loadRom } from "./rom-loader.js";

function buildDefinitionXml(options: {
	romId?: string;
	name: string;
	tableName?: string;
	category?: string;
}): string {
	const romId = options.romId ?? "TESTROM1";
	const tableName = options.tableName ?? "Primary Fuel";
	const category = options.category ?? "Fuel";
	return `<?xml version="1.0" encoding="UTF-8"?>
<roms>
	<rom>
		<xmlid>${options.name}</xmlid>
		<romid>
			<internalidhex>${romId}</internalidhex>
			<internalidaddress>0x0</internalidaddress>
		</romid>
		<table type="2D" name="${tableName}" category="${category}" address="0x10">
			<table type="X Axis" name="Engine Speed" elements="2">
				<data>1000</data>
				<data>2000</data>
			</table>
			<table type="Y Axis" name="Load" elements="2">
				<data>10</data>
				<data>20</data>
			</table>
		</table>
	</rom>
</roms>`;
}

async function makeTempDir(): Promise<string> {
	return fs.mkdtemp(path.join(os.tmpdir(), "ecu-mcp-rom-loader-"));
}

afterEach(async () => {
	clearRomCache();
});

describe("loadRom explicit definition support", () => {
	it("loads with an explicit definition when autodetection would fail", async () => {
		const tempDir = await makeTempDir();
		try {
			const romPath = path.join(tempDir, "sample.hex");
			const definitionPath = path.join(tempDir, "explicit.xml");
			const romBytes = Buffer.alloc(64);
			romBytes.write("TESTROM1", 0, "ascii");

			await fs.writeFile(romPath, romBytes);
			await fs.writeFile(
				definitionPath,
				buildDefinitionXml({ name: "Explicit Definition" }),
			);

			await expect(loadRom(romPath, [])).rejects.toThrow(
				/No matching definition found|No definition files found/,
			);

			const loaded = await loadRom(romPath, [], { definitionPath });
			expect(loaded.definition.tables).toHaveLength(0);
			expect(loaded.definition.uri).toContain("explicit.xml");
		} finally {
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});

	it("does not reuse cached data across different explicit definitions", async () => {
		const tempDir = await makeTempDir();
		try {
			const romPath = path.join(tempDir, "sample.hex");
			const definitionAPath = path.join(tempDir, "definition-a.xml");
			const definitionBPath = path.join(tempDir, "definition-b.xml");
			const romBytes = Buffer.alloc(64);
			romBytes.write("TESTROM1", 0, "ascii");

			await fs.writeFile(romPath, romBytes);
			await fs.writeFile(
				definitionAPath,
				buildDefinitionXml({
					name: "Definition A",
					tableName: "Fuel A",
				}),
			);
			await fs.writeFile(
				definitionBPath,
				buildDefinitionXml({
					name: "Definition B",
					tableName: "Fuel B",
				}),
			);

			const loadedA = await loadRom(romPath, [], {
				definitionPath: definitionAPath,
			});
			const loadedB = await loadRom(romPath, [], {
				definitionPath: definitionBPath,
			});

			expect(loadedA.definition.uri).toContain("definition-a.xml");
			expect(loadedB.definition.uri).toContain("definition-b.xml");
			expect(loadedA.definition).not.toBe(loadedB.definition);
		} finally {
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});
});
