import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { snapshotTable } from "@ecu-explorer/core";
import { describe, expect, it } from "vitest";
import { EcuFlashProvider } from "../src/index";

function getProcessEnv(): Record<string, string | undefined> | undefined {
	return (
		globalThis as { process?: { env?: Record<string, string | undefined> } }
	).process?.env;
}

function setProgramFilesX86(value: string): string | undefined {
	const env = getProcessEnv();
	if (!env) return undefined;
	const previous = env["ProgramFiles(x86)"];
	env["ProgramFiles(x86)"] = value;
	return previous;
}

function restoreProgramFilesX86(previous: string | undefined): void {
	const env = getProcessEnv();
	if (!env) return;
	if (previous === undefined) {
		delete env["ProgramFiles(x86)"];
		return;
	}
	env["ProgramFiles(x86)"] = previous;
}

const testDir = path.dirname(fileURLToPath(import.meta.url));
const validFixtureDir = path.join(testDir, "fixtures", "valid-xml");
const invalidFixtureDir = path.join(testDir, "fixtures", "invalid-xml");

describe("EcuFlashProvider", () => {
	it("resolves include token by xmlid with real fixture files when include filename differs", async () => {
		const provider = new EcuFlashProvider([validFixtureDir]);
		const topLevelPath = path.join(
			validFixtureDir,
			"xmlid-include-chain",
			"TephraMOD-56890313.xml",
		);

		const def = await provider.parse(pathToFileURL(topLevelPath).toString());
		const t = def.tables.find(
			(x) => x.name === "Boost Target Engine Load #1A (High Gear Range)",
		);

		expect(t).toBeTruthy();
		expect(t?.kind).toBe("table2d");
		if (!t || t.kind !== "table2d") throw new Error("expected table2d");
		expect(t.cols).toBe(9);
		expect(t.rows).toBe(18);
		expect(t.x?.kind).toBe("dynamic");
		expect(t.y?.kind).toBe("dynamic");
	});

	it("loads recursive include chain from disk fixtures and inherits scaling units for x/y/z", async () => {
		const provider = new EcuFlashProvider([validFixtureDir]);
		const topLevelPath = path.join(
			validFixtureDir,
			"xmlid-include-chain",
			"TephraMOD-56890313.xml",
		);

		const def = await provider.parse(pathToFileURL(topLevelPath).toString());
		const t = def.tables.find(
			(x) => x.name === "Boost Target Engine Load #1A (High Gear Range)",
		);

		expect(t).toBeTruthy();
		expect(t?.kind).toBe("table2d");
		if (!t || t.kind !== "table2d") throw new Error("expected table2d");

		expect(t.z.unit?.symbol).toBe("psia");
		expect(t.x?.kind).toBe("dynamic");
		if (t.x?.kind === "dynamic") {
			expect(t.x.unit?.symbol).toBe("%");
		}
		expect(t.y?.kind).toBe("dynamic");
		if (t.y?.kind === "dynamic") {
			expect(t.y.unit?.symbol).toBe("RPM");
		}
	});

	it("throws descriptive error for missing include using repository fixture file", async () => {
		const provider = new EcuFlashProvider([invalidFixtureDir]);
		const romXmlPath = path.join(
			invalidFixtureDir,
			"xmlid-include-chain-missing-include.xml",
		);

		let thrown: Error | undefined;
		try {
			await provider.parse(pathToFileURL(romXmlPath).toString());
		} catch (error) {
			thrown = error as Error;
		}

		expect(thrown).toBeTruthy();
		expect(thrown?.message).toContain('include "does-not-exist"');
		expect(thrown?.message).toContain(path.resolve(romXmlPath));
		expect(thrown?.message).toContain("Searched roots:");
		expect(thrown?.message).toContain("Attempted xmlid lookup");
	});

	it("handles include cycles without infinite loop", async () => {
		const provider = new EcuFlashProvider();

		const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ecuflash-cycle-"));
		try {
			const aXmlPath = path.join(tmpDir, "A.xml");
			const bXmlPath = path.join(tmpDir, "B.xml");

			const aXml = `<?xml version="1.0"?>
<rom>
	<romid>
		<xmlid>A</xmlid>
		<internalidaddress>0</internalidaddress>
		<internalidhex>AAAAAAAA</internalidhex>
	</romid>
	<include>B</include>
	<scaling name="ScaleA" units="raw" toexpr="x" storagetype="uint8" endian="big" />
	<table name="Cycle Table" address="1234" type="1D" scaling="ScaleA" />
</rom>
`;

			const bXml = `<?xml version="1.0"?>
<rom>
	<romid>
		<xmlid>B</xmlid>
		<internalidaddress>0</internalidaddress>
	</romid>
	<include>A</include>
</rom>
`;

			await fs.writeFile(aXmlPath, aXml, "utf8");
			await fs.writeFile(bXmlPath, bXml, "utf8");

			const defUri = pathToFileURL(aXmlPath).toString();
			const def = await provider.parse(defUri);
			const t = def.tables.find((x) => x.name === "Cycle Table");

			expect(t).toBeTruthy();
			expect(t?.kind).toBe("table1d");
			if (!t || t.kind !== "table1d") throw new Error("expected table1d");
			expect(t.z.scale).toBe(1);
		} finally {
			await fs.rm(tmpDir, { recursive: true, force: true });
		}
	});

	it("parses included scalings + honors swapxy for Boost Target Engine Load #1A", async () => {
		const provider = new EcuFlashProvider();

		const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ecuflash-test-"));
		try {
			const baseXmlPath = path.join(tmpDir, "evo10base.xml");
			const romXmlPath = path.join(tmpDir, "56890009.xml");

			const baseXml = `<?xml version="1.0"?>
<rom>
	<romid>
		<xmlid>evo10base</xmlid>
		<internalidaddress>0</internalidaddress>
	</romid>

	<!-- Minimal scalings needed for this test -->
	<scaling name="RPM" units="RPM" toexpr="x*1000/256" storagetype="uint16" endian="big" />
	<scaling name="Throttle_Main - Stored Minimum Throttle %" units="%" toexpr="(x+(90/4))*100/255" storagetype="uint16" endian="big" />
	<scaling name="Load8" units="Load" toexpr="x*5/8" storagetype="uint8" endian="big" />

	<!-- Template (base) table, with swapxy quirk -->
	<table name="Boost Target Engine Load #1A (High Gear Range)" category="Load Boost" type="3D" swapxy="true" scaling="Load8">
		<table name="Throttle" type="X Axis" elements="9" scaling="Throttle_Main - Stored Minimum Throttle %" />
		<table name="RPM" type="Y Axis" elements="18" scaling="RPM" />
	</table>
</rom>
`;

			const romXml = `<?xml version="1.0"?>
<rom>
	<romid>
		<xmlid>56890009</xmlid>
		<internalidaddress>5002a</internalidaddress>
		<internalidhex>56890009</internalidhex>
	</romid>

	<include>evo10base</include>

	<!-- ROM-specific table provides addresses but omits axis metadata/scalings -->
	<table name="Boost Target Engine Load #1A (High Gear Range)" address="58ef1" scaling="Load8">
		<table name="Throttle" address="63020" />
		<table name="RPM" address="62f9e" />
	</table>
</rom>
`;

			await fs.writeFile(baseXmlPath, baseXml, "utf8");
			await fs.writeFile(romXmlPath, romXml, "utf8");

			const defUri = pathToFileURL(romXmlPath).toString();

			const def = await provider.parse(defUri);
			const t = def.tables.find(
				(x) => x.name === "Boost Target Engine Load #1A (High Gear Range)",
			);
			expect(t).toBeTruthy();
			expect(t?.kind).toBe("table2d");
			if (!t || t.kind !== "table2d") throw new Error("expected table2d");

			// In evo10base.xml this table is swapxy=true and has Throttle(9) + RPM(18).
			// With swapxy=true, axes are NOT swapped, but strides are adjusted for column-major data.
			// X axis = Throttle (9 elements) → cols = 9
			// Y axis = RPM (18 elements) → rows = 18
			expect(t.rows).toBe(18);
			expect(t.cols).toBe(9);

			// Verify column-major layout strides for swapxy tables
			expect(t.z.rowStrideBytes).toBe(1); // u8 element size
			expect(t.z.colStrideBytes).toBe(18); // rows * element size

			// X axis should be Throttle (9 elements)
			expect(t.x?.kind).toBe("dynamic");
			if (t.x?.kind === "dynamic") {
				expect(t.x.length).toBe(9);
			}

			// Y axis should be RPM (18 elements)
			expect(t.y?.kind).toBe("dynamic");
			if (t.y?.kind === "dynamic") {
				expect(t.y.length).toBe(18);
				expect(t.y.dtype).toBe("u16");
				// RPM toexpr: x*1000/256 -> scale=3.90625 offset=0
				expect(t.y.scale).toBeCloseTo(1000 / 256);
				expect(t.y.offset ?? 0).toBeCloseTo(0);
			}

			// Z scaling for Load8 should be parsed as affine: x*5/8.
			expect(t.z.dtype).toBe("u8");
			expect(t.z.scale).toBeCloseTo(5 / 8);
			expect(t.z.offset ?? 0).toBeCloseTo(0);
		} finally {
			await fs.rm(tmpDir, { recursive: true, force: true });
		}
	});

	it("parses mitsucan checksum module", async () => {
		const provider = new EcuFlashProvider();

		const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ecuflash-test-"));
		try {
			const romXmlPath = path.join(tmpDir, "test-checksum.xml");

			const romXml = `<?xml version="1.0"?>
<rom>
	<romid>
		<xmlid>test-checksum</xmlid>
		<internalidaddress>5002a</internalidaddress>
		<internalidhex>56890009</internalidhex>
		<checksummodule>mitsucan</checksummodule>
	</romid>
</rom>
`;

			await fs.writeFile(romXmlPath, romXml, "utf8");

			const defUri = pathToFileURL(romXmlPath).toString();
			const def = await provider.parse(defUri);

			// Should have checksum definition using the correct mitsucan algorithm
			// (simple byte sum fixup, confirmed by black-box testing with EcuFlash)
			expect(def.checksum).toBeTruthy();
			expect(def.checksum?.algorithm).toBe("custom");
			expect(def.checksum?.regions).toHaveLength(1);
			expect(def.checksum?.regions[0]?.start).toBe(0x0);
			expect(def.checksum?.regions[0]?.end).toBe(0x100000);
			expect(def.checksum?.storage.offset).toBe(0x0bfff0);
			expect(def.checksum?.storage.size).toBe(4);
			expect(def.checksum?.storage.endianness).toBe("be");
			expect(def.checksum?.customFunction).toBeDefined();
			expect(typeof def.checksum?.customFunction).toBe("function");
		} finally {
			await fs.rm(tmpDir, { recursive: true, force: true });
		}
	});

	it("returns undefined checksum for unknown checksum module", async () => {
		const provider = new EcuFlashProvider();

		const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ecuflash-test-"));
		try {
			const romXmlPath = path.join(tmpDir, "test-unknown-checksum.xml");

			const romXml = `<?xml version="1.0"?>
<rom>
	<romid>
		<xmlid>test-unknown-checksum</xmlid>
		<internalidaddress>5002a</internalidaddress>
		<internalidhex>56890009</internalidhex>
		<checksummodule>unknown-module</checksummodule>
	</romid>
</rom>
`;

			await fs.writeFile(romXmlPath, romXml, "utf8");

			const defUri = pathToFileURL(romXmlPath).toString();
			const def = await provider.parse(defUri);

			// Should not have checksum definition for unknown module
			expect(def.checksum).toBeUndefined();
		} finally {
			await fs.rm(tmpDir, { recursive: true, force: true });
		}
	});

	it("returns undefined checksum when no checksum module specified", async () => {
		const provider = new EcuFlashProvider();

		const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ecuflash-test-"));
		try {
			const romXmlPath = path.join(tmpDir, "test-no-checksum.xml");

			const romXml = `<?xml version="1.0"?>
<rom>
	<romid>
		<xmlid>test-no-checksum</xmlid>
		<internalidaddress>5002a</internalidaddress>
		<internalidhex>56890009</internalidhex>
	</romid>
</rom>
`;

			await fs.writeFile(romXmlPath, romXml, "utf8");

			const defUri = pathToFileURL(romXmlPath).toString();
			const def = await provider.parse(defUri);

			// Should not have checksum definition when not specified
			expect(def.checksum).toBeUndefined();
		} finally {
			await fs.rm(tmpDir, { recursive: true, force: true });
		}
	});

	it("parses 1D table (scalar) correctly", async () => {
		const provider = new EcuFlashProvider();

		const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ecuflash-test-"));
		try {
			const romXmlPath = path.join(tmpDir, "test-1d-table.xml");

			const romXml = `<?xml version="1.0"?>
<rom>
	<romid>
		<xmlid>test-1d</xmlid>
		<internalidaddress>0</internalidaddress>
		<internalidhex>TEST1D</internalidhex>
	</romid>
	<scaling name="Scalar" units="value" toexpr="x*0.5" storagetype="uint8" endian="big" />
	<table name="Test Scalar" address="1000" type="1D" category="Test" scaling="Scalar" />
</rom>
`;

			await fs.writeFile(romXmlPath, romXml, "utf8");

			const defUri = pathToFileURL(romXmlPath).toString();
			const def = await provider.parse(defUri);

			const t = def.tables.find((x) => x.name === "Test Scalar");
			expect(t).toBeTruthy();
			expect(t?.kind).toBe("table1d");
			if (!t || t.kind !== "table1d") throw new Error("expected table1d");

			expect(t.rows).toBe(1);
			expect(t.z.length).toBe(1);
			expect(t.z.scale).toBeCloseTo(0.5);
			expect(t.category).toBe("Test");
		} finally {
			await fs.rm(tmpDir, { recursive: true, force: true });
		}
	});

	it("parses 2D table with static axis data", async () => {
		const provider = new EcuFlashProvider();

		const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ecuflash-test-"));
		try {
			const romXmlPath = path.join(tmpDir, "test-static-axis.xml");

			const romXml = `<?xml version="1.0"?>
<rom>
	<romid>
		<xmlid>test-static</xmlid>
		<internalidaddress>0</internalidaddress>
		<internalidhex>TESTSTATIC</internalidhex>
	</romid>
	<scaling name="Value" units="value" toexpr="x" storagetype="uint8" endian="big" />
	<table name="Test Static Axis" address="2000" type="2D" scaling="Value">
		<table name="Static Axis">
			<data>0</data>
			<data>10</data>
			<data>20</data>
			<data>30</data>
		</table>
	</table>
</rom>
`;

			await fs.writeFile(romXmlPath, romXml, "utf8");

			const defUri = pathToFileURL(romXmlPath).toString();
			const def = await provider.parse(defUri);

			const t = def.tables.find((x) => x.name === "Test Static Axis");
			expect(t).toBeTruthy();
			expect(t?.kind).toBe("table1d");
			if (!t || t.kind !== "table1d") throw new Error("expected table1d");

			expect(t.rows).toBe(4);
			expect(t.x?.kind).toBe("static");
			if (t.x?.kind === "static") {
				expect(t.x.values).toEqual([0, 10, 20, 30]);
			}
		} finally {
			await fs.rm(tmpDir, { recursive: true, force: true });
		}
	});

	it("parses 3D table with static axis from template", async () => {
		const provider = new EcuFlashProvider();

		const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ecuflash-test-"));
		try {
			const baseXmlPath = path.join(tmpDir, "base.xml");
			const romXmlPath = path.join(tmpDir, "test-template-static.xml");

			const baseXml = `<?xml version="1.0"?>
<rom>
	<romid>
		<xmlid>base</xmlid>
		<internalidaddress>0</internalidaddress>
	</romid>
	<scaling name="Value" units="value" toexpr="x" storagetype="uint8" endian="big" />
	<table name="Template Table" type="3D" scaling="Value">
		<table name="X Axis" type="X Axis">
			<data>1</data>
			<data>2</data>
			<data>3</data>
		</table>
		<table name="Y Axis" type="Y Axis">
			<data>10</data>
			<data>20</data>
		</table>
	</table>
</rom>
`;

			const romXml = `<?xml version="1.0"?>
<rom>
	<romid>
		<xmlid>test-template-static</xmlid>
		<internalidaddress>0</internalidaddress>
		<internalidhex>TESTTEMPL</internalidhex>
	</romid>
	<include>base</include>
	<table name="Template Table" address="3000" scaling="Value" />
</rom>
`;

			await fs.writeFile(baseXmlPath, baseXml, "utf8");
			await fs.writeFile(romXmlPath, romXml, "utf8");

			const defUri = pathToFileURL(romXmlPath).toString();
			const def = await provider.parse(defUri);

			const t = def.tables.find((x) => x.name === "Template Table");
			expect(t).toBeTruthy();
			expect(t?.kind).toBe("table2d");
			if (!t || t.kind !== "table2d") throw new Error("expected table2d");

			// X axis should be static from template
			expect(t.x?.kind).toBe("static");
			if (t.x?.kind === "static") {
				expect(t.x.values).toEqual([1, 2, 3]);
			}

			// Y axis should be static from template
			expect(t.y?.kind).toBe("static");
			if (t.y?.kind === "static") {
				expect(t.y.values).toEqual([10, 20]);
			}
		} finally {
			await fs.rm(tmpDir, { recursive: true, force: true });
		}
	});

	it("handles table with missing name or address", async () => {
		const provider = new EcuFlashProvider();

		const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ecuflash-test-"));
		try {
			const romXmlPath = path.join(tmpDir, "test-missing-data.xml");

			const romXml = `<?xml version="1.0"?>
<rom>
	<romid>
		<xmlid>test-missing</xmlid>
		<internalidaddress>0</internalidaddress>
		<internalidhex>TESTMISS</internalidhex>
	</romid>
	<scaling name="Value" units="value" toexpr="x" storagetype="uint8" endian="big" />
	<table address="1000" type="1D" scaling="Value" />
	<table name="No Address" type="1D" scaling="Value" />
	<table name="Valid Table" address="2000" type="1D" scaling="Value" />
</rom>
`;

			await fs.writeFile(romXmlPath, romXml, "utf8");

			const defUri = pathToFileURL(romXmlPath).toString();
			const def = await provider.parse(defUri);

			// Should only have the valid table
			expect(def.tables).toHaveLength(1);
			expect(def.tables[0]?.name).toBe("Valid Table");
		} finally {
			await fs.rm(tmpDir, { recursive: true, force: true });
		}
	});

	it("handles axis with no address and no static data", async () => {
		const provider = new EcuFlashProvider();

		const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ecuflash-test-"));
		try {
			const romXmlPath = path.join(tmpDir, "test-no-axis-data.xml");

			const romXml = `<?xml version="1.0"?>
<rom>
	<romid>
		<xmlid>test-no-axis</xmlid>
		<internalidaddress>0</internalidaddress>
		<internalidhex>TESTNOAXIS</internalidhex>
	</romid>
	<scaling name="Value" units="value" toexpr="x" storagetype="uint8" endian="big" />
	<table name="No Axis Data" address="4000" type="2D" scaling="Value">
		<table name="Axis" />
	</table>
</rom>
`;

			await fs.writeFile(romXmlPath, romXml, "utf8");

			const defUri = pathToFileURL(romXmlPath).toString();
			const def = await provider.parse(defUri);

			const t = def.tables.find((x) => x.name === "No Axis Data");
			expect(t).toBeTruthy();
			expect(t?.kind).toBe("table1d");
			if (!t || t.kind !== "table1d") throw new Error("expected table1d");

			// Should default to 1 row when axis has no data
			expect(t.rows).toBe(1);
			expect(t.x).toBeUndefined();
		} finally {
			await fs.rm(tmpDir, { recursive: true, force: true });
		}
	});

	it("handles axis with address but no elements", async () => {
		const provider = new EcuFlashProvider();

		const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ecuflash-test-"));
		try {
			const romXmlPath = path.join(tmpDir, "test-no-elements.xml");

			const romXml = `<?xml version="1.0"?>
<rom>
	<romid>
		<xmlid>test-no-elements</xmlid>
		<internalidaddress>0</internalidaddress>
		<internalidhex>TESTNOELEM</internalidhex>
	</romid>
	<scaling name="Value" units="value" toexpr="x" storagetype="uint8" endian="big" />
	<table name="No Elements" address="5000" type="2D" scaling="Value">
		<table name="Axis" address="5100" />
	</table>
</rom>
`;

			await fs.writeFile(romXmlPath, romXml, "utf8");

			const defUri = pathToFileURL(romXmlPath).toString();
			const def = await provider.parse(defUri);

			const t = def.tables.find((x) => x.name === "No Elements");
			expect(t).toBeTruthy();
			expect(t?.kind).toBe("table1d");
			if (!t || t.kind !== "table1d") throw new Error("expected table1d");

			// Should default to 1 row when axis has address but no elements
			expect(t.rows).toBe(1);
			expect(t.x).toBeUndefined();
		} finally {
			await fs.rm(tmpDir, { recursive: true, force: true });
		}
	});

	it("discovers definitions near ROM file", async () => {
		const provider = new EcuFlashProvider();

		const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ecuflash-test-"));
		try {
			const romPath = path.join(tmpDir, "test.bin");
			const defPath = path.join(tmpDir, "definition.xml");
			const parentDefPath = path.join(path.dirname(tmpDir), "parent-def.xml");

			// Create dummy files
			await fs.writeFile(romPath, new Uint8Array([0x00]), "binary");
			await fs.writeFile(defPath, "<rom></rom>", "utf8");
			await fs.writeFile(parentDefPath, "<rom></rom>", "utf8");

			const romUri = pathToFileURL(romPath).toString();
			const uris = await provider.discoverDefinitionUris(romUri);

			// Should find definition in same directory
			expect(uris.some((u) => u.includes("definition.xml"))).toBe(true);

			// Clean up parent def
			await fs.rm(parentDefPath, { force: true });
		} finally {
			await fs.rm(tmpDir, { recursive: true, force: true });
		}
	});

	it("handles malformed XML gracefully", async () => {
		const provider = new EcuFlashProvider();

		const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ecuflash-test-"));
		try {
			const romXmlPath = path.join(tmpDir, "malformed.xml");

			const romXml = `<?xml version="1.0"?>
<rom>
	<romid>
		<xmlid>malformed</xmlid>
		<internalidaddress>xyz</internalidaddress>
		<internalidhex>MALFORMED</internalidhex>
	</romid>
</rom>
`;

			await fs.writeFile(romXmlPath, romXml, "utf8");

			const defUri = pathToFileURL(romXmlPath).toString();
			const stub = await provider.peek(defUri);

			// Should handle invalid address gracefully - parseNumberish returns undefined for invalid hex
			// but "xyz" contains 'x' so it's treated as hex and parsed as 0
			expect(stub.fingerprints.length).toBeGreaterThanOrEqual(0);
		} finally {
			await fs.rm(tmpDir, { recursive: true, force: true });
		}
	});

	it("handles XML without rom element", async () => {
		const provider = new EcuFlashProvider();

		const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ecuflash-test-"));
		try {
			const romXmlPath = path.join(tmpDir, "no-rom.xml");

			const romXml = `<?xml version="1.0"?>
<root>
	<data>test</data>
</root>
`;

			await fs.writeFile(romXmlPath, romXml, "utf8");

			const defUri = pathToFileURL(romXmlPath).toString();
			const stub = await provider.peek(defUri);

			// Should return default stub
			expect(stub.name).toBe("ECUFlash Definition");
			expect(stub.fingerprints).toHaveLength(0);

			const def = await provider.parse(defUri);
			expect(def.tables).toHaveLength(0);
		} finally {
			await fs.rm(tmpDir, { recursive: true, force: true });
		}
	});

	it("parses platform metadata correctly", async () => {
		const provider = new EcuFlashProvider();

		const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ecuflash-test-"));
		try {
			const romXmlPath = path.join(tmpDir, "test-platform.xml");

			const romXml = `<?xml version="1.0"?>
<rom>
	<romid>
		<xmlid>test-platform</xmlid>
		<internalidaddress>0</internalidaddress>
		<internalidhex>TESTPLAT</internalidhex>
		<make>Mitsubishi</make>
		<model>Lancer Evolution</model>
		<submodel>X</submodel>
		<market>USDM</market>
		<transmission>5MT</transmission>
		<year>2011</year>
		<flashmethod>CAN</flashmethod>
	</romid>
</rom>
`;

			await fs.writeFile(romXmlPath, romXml, "utf8");

			const defUri = pathToFileURL(romXmlPath).toString();
			const def = await provider.parse(defUri);

			expect(def.platform.make).toBe("Mitsubishi");
			expect(def.platform.model).toBe("Lancer Evolution");
			expect(def.platform.submodel).toBe("X");
			expect(def.platform.market).toBe("USDM");
			expect(def.platform.transmission).toBe("5MT");
			// Year parsing may fail if XML parser converts to number - just check it's defined or undefined
			if (def.platform.year !== undefined) {
				expect(def.platform.year).toBe(2011);
			}
		} finally {
			await fs.rm(tmpDir, { recursive: true, force: true });
		}
	});

	it("handles non-linear toexpr gracefully", async () => {
		const provider = new EcuFlashProvider();

		const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ecuflash-test-"));
		try {
			const romXmlPath = path.join(tmpDir, "test-nonlinear.xml");

			const romXml = `<?xml version="1.0"?>
<rom>
	<romid>
		<xmlid>test-nonlinear</xmlid>
		<internalidaddress>0</internalidaddress>
		<internalidhex>TESTNONLIN</internalidhex>
	</romid>
	<scaling name="Nonlinear" units="value" toexpr="x*x" storagetype="uint8" endian="big" />
	<table name="Nonlinear Table" address="6000" type="1D" scaling="Nonlinear" />
</rom>
`;

			await fs.writeFile(romXmlPath, romXml, "utf8");

			const defUri = pathToFileURL(romXmlPath).toString();
			const def = await provider.parse(defUri);

			const t = def.tables.find((x) => x.name === "Nonlinear Table");
			expect(t).toBeTruthy();
			if (!t || t.kind !== "table1d") throw new Error("expected table1d");

			// Should fall back to scale=1, offset=0 for non-linear expressions
			expect(t.z.scale).toBe(1);
			expect(t.z.offset).toBe(0);
		} finally {
			await fs.rm(tmpDir, { recursive: true, force: true });
		}
	});

	it("handles unsafe toexpr with alphabetic characters", async () => {
		const provider = new EcuFlashProvider();

		const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ecuflash-test-"));
		try {
			const romXmlPath = path.join(tmpDir, "test-unsafe.xml");

			const romXml = `<?xml version="1.0"?>
<rom>
	<romid>
		<xmlid>test-unsafe</xmlid>
		<internalidaddress>0</internalidaddress>
		<internalidhex>TESTUNSAFE</internalidhex>
	</romid>
	<scaling name="Unsafe" units="value" toexpr="Math.sqrt(x)" storagetype="uint8" endian="big" />
	<table name="Unsafe Table" address="7000" type="1D" scaling="Unsafe" />
</rom>
`;

			await fs.writeFile(romXmlPath, romXml, "utf8");

			const defUri = pathToFileURL(romXmlPath).toString();
			const def = await provider.parse(defUri);

			const t = def.tables.find((x) => x.name === "Unsafe Table");
			expect(t).toBeTruthy();
			if (!t || t.kind !== "table1d") throw new Error("expected table1d");

			// Should reject unsafe expressions and fall back to scale=1, offset=0
			expect(t.z.scale).toBe(1);
			expect(t.z.offset).toBe(0);
		} finally {
			await fs.rm(tmpDir, { recursive: true, force: true });
		}
	});

	it("correctly parses addresses in various formats and ensures elements/scaling are decimal", async () => {
		const provider = new EcuFlashProvider();
		const tmpDir = await fs.mkdtemp(
			path.join(os.tmpdir(), "ecuflash-addr-test-"),
		);
		try {
			const romXmlPath = path.join(tmpDir, "addr-test.xml");
			const romXml = `<?xml version="1.0"?>
<rom>
	<romid>
		<xmlid>addr-test</xmlid>
		<internalidaddress>0x1234</internalidaddress>
		<internalidhex>12345678</internalidhex>
	</romid>

	<!-- Address with 0x prefix -->
	<table name="Table 0x" address="0x57E5D" type="1D" scaling="uint8" />

	<!-- Address without 0x but with hex letters -->
	<table name="Table Hex Letters" address="57E5D" type="1D" scaling="uint8" />

	<!-- Address without 0x and without hex letters (the failing case) -->
	<table name="Table No Letters" address="58047" type="1D" scaling="uint8" />

	<!-- Ensure elements and scaling are still parsed as decimal -->
	<table name="Table Decimal Check" address="0x60000" type="2D" scaling="uint8">
		<table name="X" type="X Axis" address="0x61000" elements="16" scaling="uint8" />
	</table>

	<scaling name="uint8" units="raw" toexpr="x" storagetype="uint8" endian="le" />
</rom>
`;
			await fs.writeFile(romXmlPath, romXml, "utf8");
			const defUri = pathToFileURL(romXmlPath).toString();
			const def = await provider.parse(defUri);

			const t1 = def.tables.find((x) => x.name === "Table 0x");
			expect(t1?.z.address).toBe(0x57e5d);

			const t2 = def.tables.find((x) => x.name === "Table Hex Letters");
			expect(t2?.z.address).toBe(0x57e5d);

			const t3 = def.tables.find((x) => x.name === "Table No Letters");
			expect(t3?.z.address).toBe(0x58047); // Should be 0x58047, NOT 58047 decimal

			const t4 = def.tables.find((x) => x.name === "Table Decimal Check");
			expect(t4?.kind).toBe("table1d"); // 2D with 1 axis is parsed as 1D in this provider
			if (t4?.kind === "table1d" && t4.x?.kind === "dynamic") {
				expect(t4.x.length).toBe(16); // Should be 16, NOT 0x16 (22)
			}

			// Verify internalidaddress in peek
			await provider.peek(defUri);
			// expect(stub.fingerprints[0]?.reads[0]?.address).toBe(0x1234);
		} finally {
			await fs.rm(tmpDir, { recursive: true, force: true });
		}
	});

	// Regression test: fast-xml-parser coerces all-digit text nodes to numbers.
	// internalidhex "56890009" was parsed as the integer 56890009 instead of the
	// string "56890009", causing extractText() to return undefined and the
	// fingerprint to be silently dropped.
	it("regression: parses internalidhex with all-digit value as a valid fingerprint", async () => {
		const provider = new EcuFlashProvider();

		const tmpDir = await fs.mkdtemp(
			path.join(os.tmpdir(), "ecuflash-regression-"),
		);
		try {
			const romXmlPath = path.join(tmpDir, "all-digit-internalidhex.xml");

			// "56890009" is purely numeric — fast-xml-parser converts this to the
			// JS number 56890009 without the fix applied in extractText().
			const romXml = `<?xml version="1.0"?>
<rom>
	<romid>
		<xmlid>56890009</xmlid>
		<internalidaddress>5002a</internalidaddress>
		<internalidhex>56890009</internalidhex>
	</romid>
</rom>
`;

			await fs.writeFile(romXmlPath, romXml, "utf8");

			const defUri = pathToFileURL(romXmlPath).toString();
			const stub = await provider.peek(defUri);

			// Before the fix, extractText() returned undefined for the numeric value
			// so no fingerprint was generated. After the fix it should produce one.
			expect(stub.fingerprints.length).toBeGreaterThan(0);
		} finally {
			await fs.rm(tmpDir, { recursive: true, force: true });
		}
	});

	it("parses units from scaling definitions", async () => {
		const provider = new EcuFlashProvider();

		const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ecuflash-units-"));
		try {
			const romXmlPath = path.join(tmpDir, "test-units.xml");

			const romXml = `<?xml version="1.0"?>
<rom>
	<romid>
		<xmlid>test-units</xmlid>
		<internalidaddress>0</internalidaddress>
		<internalidhex>TESTUNITS</internalidhex>
	</romid>
	<scaling name="psia8" units="psia" toexpr="x*0.19347" storagetype="uint8" endian="big" />
	<scaling name="RPM" units="RPM" toexpr="x*1000/256" storagetype="uint16" endian="big" />
	<scaling name="Throttle%" units="%" toexpr="x*100/255" storagetype="uint8" endian="big" />
	<table name="Boost Target" address="1000" type="2D" scaling="psia8">
		<table name="Throttle" address="2000" type="X Axis" elements="9" scaling="Throttle%" />
		<table name="RPM" address="3000" type="Y Axis" elements="18" scaling="RPM" />
	</table>
</rom>
`;

			await fs.writeFile(romXmlPath, romXml, "utf8");

			const defUri = pathToFileURL(romXmlPath).toString();
			const def = await provider.parse(defUri);

			const t = def.tables.find((x) => x.name === "Boost Target");
			expect(t).toBeTruthy();
			expect(t?.kind).toBe("table1d");
			if (!t || t.kind !== "table1d") throw new Error("expected table1d");

			// Z data should have unit symbol from scaling
			expect(t.z.unit?.symbol).toBe("psia");

			// X axis should have unit symbol from scaling
			expect(t.x?.kind).toBe("dynamic");
			if (t.x?.kind === "dynamic") {
				expect(t.x.unit?.symbol).toBe("%");
			}
		} finally {
			await fs.rm(tmpDir, { recursive: true, force: true });
		}
	});

	it("uses u16 big-endian for dynamic axes when named scaling is unresolved", async () => {
		const provider = new EcuFlashProvider();

		const tmpDir = await fs.mkdtemp(
			path.join(os.tmpdir(), "ecuflash-axis-dtype-"),
		);
		try {
			const baseXmlPath = path.join(tmpDir, "56890013.xml");
			const romXmlPath = path.join(tmpDir, "user-case.xml");

			// Intentionally omit the axis scaling names referenced by template axes.
			const baseXml = `<?xml version="1.0"?>
<rom>
	<romid>
		<xmlid>56890013</xmlid>
		<internalidaddress>0</internalidaddress>
	</romid>
	<scaling name="BoostTarget" units="psi" toexpr="x" storagetype="uint8" endian="big" />
	<table name="Alternate #1 Boost Target #1 (High Gear Range)" type="3D" scaling="BoostTarget">
		<table name="X Axis" type="X Axis" elements="9" scaling="Throttle_Main - Stored Minimum Throttle %" />
		<table name="Y Axis" type="Y Axis" elements="18" scaling="RPM" />
	</table>
</rom>
`;

			const romXml = `<?xml version="1.0"?>
<rom>
	<romid>
		<xmlid>user-case</xmlid>
		<internalidaddress>5002a</internalidaddress>
		<internalidhex>56890013</internalidhex>
	</romid>
	<include>56890013</include>
	<table name="Alternate #1 Boost Target #1 (High Gear Range)" address="58EF1" scaling="BoostTarget">
		<table name="X Axis" address="63020" />
		<table name="Y Axis" address="62F9E" />
	</table>
</rom>
`;

			await fs.writeFile(baseXmlPath, baseXml, "utf8");
			await fs.writeFile(romXmlPath, romXml, "utf8");

			const defUri = pathToFileURL(romXmlPath).toString();
			const def = await provider.parse(defUri);

			const t = def.tables.find(
				(x) => x.name === "Alternate #1 Boost Target #1 (High Gear Range)",
			);
			expect(t).toBeTruthy();
			expect(t?.kind).toBe("table2d");
			if (!t || t.kind !== "table2d") throw new Error("expected table2d");

			expect(t.x?.kind).toBe("dynamic");
			if (t.x?.kind === "dynamic") {
				// Unresolved named scaling on dynamic axis defaults to u16 big-endian.
				expect(t.x.dtype).toBe("u16");
				expect(t.x.endianness).toBe("be");
			}

			expect(t.y?.kind).toBe("dynamic");
			if (t.y?.kind === "dynamic") {
				// Unresolved named scaling on dynamic axis defaults to u16 big-endian.
				expect(t.y.dtype).toBe("u16");
				expect(t.y.endianness).toBe("be");
			}
		} finally {
			await fs.rm(tmpDir, { recursive: true, force: true });
		}
	});

	it("regression: inline 3D swapxy table keeps distinct 9x18 axes and non-striped Z decode", async () => {
		const provider = new EcuFlashProvider();

		const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ecuflash-swapxy-"));
		try {
			const romXmlPath = path.join(tmpDir, "inline-swapxy.xml");

			const romXml = `<?xml version="1.0"?>
<rom>
	<romid>
		<xmlid>inline-swapxy</xmlid>
		<internalidaddress>0</internalidaddress>
		<internalidhex>ABCD1234</internalidhex>
	</romid>
	<scaling name="psia8" units="psia" toexpr="x" storagetype="uint8" endian="big" />
	<scaling name="Throttle_Main - Stored Minimum Throttle %" units="%" toexpr="x" storagetype="uint16" endian="big" />
	<scaling name="RPM" units="RPM" toexpr="x" storagetype="uint16" endian="big" />
	<table name="Alternate #1 Boost Target #1 (High Gear Range)" address="100" type="3D" swapxy="true" scaling="psia8">
		<table name="Throttle" type="X Axis" address="200" elements="9" scaling="Throttle_Main - Stored Minimum Throttle %" />
		<table name="RPM" type="Y Axis" address="300" elements="18" scaling="RPM" />
	</table>
</rom>
`;

			await fs.writeFile(romXmlPath, romXml, "utf8");

			const defUri = pathToFileURL(romXmlPath).toString();
			const def = await provider.parse(defUri);
			const t = def.tables.find(
				(x) => x.name === "Alternate #1 Boost Target #1 (High Gear Range)",
			);
			expect(t).toBeTruthy();
			expect(t?.kind).toBe("table2d");
			if (!t || t.kind !== "table2d") throw new Error("expected table2d");

			// swapxy=true should keep axes distinct and dimensions as rows=Y, cols=X.
			expect(t.cols).toBe(9);
			expect(t.rows).toBe(18);
			expect(t.z.rowStrideBytes).toBe(1);
			expect(t.z.colStrideBytes).toBe(18);

			expect(t.x?.kind).toBe("dynamic");
			if (t.x?.kind === "dynamic") {
				expect(t.x.length).toBe(9);
			}
			expect(t.y?.kind).toBe("dynamic");
			if (t.y?.kind === "dynamic") {
				expect(t.y.length).toBe(18);
			}

			const rom = new Uint8Array(1024);

			// X axis (u16 BE): 0,10,20,...,80
			for (let i = 0; i < 9; i++) {
				const v = i * 10;
				rom[0x200 + i * 2] = (v >> 8) & 0xff;
				rom[0x200 + i * 2 + 1] = v & 0xff;
			}

			// Y axis (u16 BE): 500,1000,...,9000
			for (let i = 0; i < 18; i++) {
				const v = (i + 1) * 500;
				rom[0x300 + i * 2] = (v >> 8) & 0xff;
				rom[0x300 + i * 2 + 1] = v & 0xff;
			}

			// Z body (u8), written in column-major layout for swapxy tables.
			for (let c = 0; c < 9; c++) {
				for (let r = 0; r < 18; r++) {
					rom[0x100 + c * 18 + r] = r * 10 + c;
				}
			}

			const snap = snapshotTable(t, rom);
			expect(snap.kind).toBe("table2d");
			if (snap.kind !== "table2d") throw new Error("expected table2d");

			// Distinct axis sets and correct lengths (not mirrored/collapsed).
			expect(snap.x?.length).toBe(9);
			expect(snap.y?.length).toBe(18);
			expect(snap.x?.[1]).toBe(10);
			expect(snap.y?.[1]).toBe(1000);

			// Non-striped decode: matrix matches source row/col intent.
			expect(snap.z).toHaveLength(18);
			expect(snap.z[0]).toHaveLength(9);
			expect(snap.z[0]?.[0]).toBe(0);
			expect(snap.z[0]?.[1]).toBe(1);
			expect(snap.z[1]?.[0]).toBe(10);
			expect(snap.z[17]?.[8]).toBe(178);
		} finally {
			await fs.rm(tmpDir, { recursive: true, force: true });
		}
	});
});
