/**
 * Table Virtual File System Provider
 *
 * Provides a virtual file system that maps table URIs to JSON representations
 * of table data extracted from ROM files. This enables VSCode's Custom Editor
 * API to work with multiple distinct table editors.
 *
 * The provider acts as a transparent encoding layer:
 * - readFile(): Extracts table data from ROM → encodes as JSON
 * - writeFile(): Decodes JSON → updates ROM bytes
 * - stat(): Returns file metadata
 * - watch(): Monitors for changes
 *
 * Each table write updates the ROM file on disk immediately, and the provider
 * handles concurrent writes to the same ROM file.
 */

import type {
	AxisDefinition,
	DefinitionProvider,
	DynamicArrayDefinition,
	Endianness,
	ROMDefinition,
	ScalarType,
	Table1DDefinition,
	Table2DDefinition,
	TableDefinition,
} from "@ecu-explorer/core";
import * as vscode from "vscode";
import { resolveRomDefinition } from "./rom/definition-resolver.js";
import type { RomDocument } from "./rom/document.js";
import { parseTableUri } from "./table-fs-uri.js";
import type { RomExplorerTreeProvider } from "./tree/rom-tree-provider.js";
import type { WorkspaceState } from "./workspace-state.js";

/**
 * Get the byte size of a scalar type
 */
function sizeOf(dtype: ScalarType): number {
	switch (dtype) {
		case "u8":
		case "i8":
			return 1;
		case "u16":
		case "i16":
			return 2;
		case "u32":
		case "i32":
		case "f32":
			return 4;
	}
}

/**
 * Decode a scalar value from bytes
 */
function decodeScalar(
	bytes: Uint8Array,
	dtype: ScalarType,
	endianness: Endianness = "le",
): number {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	switch (dtype) {
		case "u8":
			return view.getUint8(0);
		case "i8":
			return view.getInt8(0);
		case "u16":
			return view.getUint16(0, endianness === "le");
		case "i16":
			return view.getInt16(0, endianness === "le");
		case "u32":
			return view.getUint32(0, endianness === "le");
		case "i32":
			return view.getInt32(0, endianness === "le");
		case "f32":
			return view.getFloat32(0, endianness === "le");
	}
}

/**
 * Encode a scalar value to bytes
 */
function encodeScalar(
	buffer: Uint8Array,
	dtype: ScalarType,
	endianness: Endianness = "le",
	value: number,
): void {
	const view = new DataView(
		buffer.buffer,
		buffer.byteOffset,
		buffer.byteLength,
	);
	const littleEndian = endianness === "le";

	switch (dtype) {
		case "u8":
			view.setUint8(0, Math.max(0, Math.min(0xff, Math.round(value))));
			break;
		case "i8":
			view.setInt8(0, Math.max(-0x80, Math.min(0x7f, Math.round(value))));
			break;
		case "u16":
			view.setUint16(
				0,
				Math.max(0, Math.min(0xffff, Math.round(value))),
				littleEndian,
			);
			break;
		case "i16":
			view.setInt16(
				0,
				Math.max(-0x8000, Math.min(0x7fff, Math.round(value))),
				littleEndian,
			);
			break;
		case "u32":
			view.setUint32(
				0,
				Math.max(0, Math.min(0xffffffff, Math.round(value))),
				littleEndian,
			);
			break;
		case "i32":
			view.setInt32(
				0,
				Math.max(-0x80000000, Math.min(0x7fffffff, Math.round(value))),
				littleEndian,
			);
			break;
		case "f32":
			view.setFloat32(0, value, littleEndian);
			break;
	}
}

/**
 * JSON representation of table data
 */
interface TableData {
	/** Metadata about the table */
	metadata: TableMetadata;

	/** Table data (1D array or 2D array) */
	data: number[] | number[][];

	/** X-axis values (optional) */
	xAxis?: number[];

	/** Y-axis values (optional) */
	yAxis?: number[];
}

/**
 * Table metadata
 */
interface TableMetadata {
	/** Absolute path to ROM file */
	romPath: string;

	/** Table name */
	tableName: string;

	/** Table kind (table1d, table2d, table3d) */
	tableKind: "table1d" | "table2d" | "table3d";

	/** URI of ROM definition */
	definitionUri?: string;

	/** Table address in ROM */
	address: number;

	/** Table dimensions */
	dimensions: {
		rows: number;
		cols: number;
	};

	/** Data unit (optional) */
	unit?: string;

	/** Last modified timestamp */
	lastModified: number;
}

/**
 * Cache entry for table metadata
 */
interface TableCacheEntry {
	romPath: string;
	tableName: string;
	definition: TableDefinition;
	lastRead: number;
}

/**
 * Virtual file system provider for table editors
 *
 * Implements VSCode's FileSystemProvider interface to provide virtual files
 * for table data. Each table gets a unique URI (ecu-table://...) that maps
 * to JSON-encoded table data extracted from the ROM file.
 */
export class TableFileSystemProvider implements vscode.FileSystemProvider {
	private readonly _emitter = new vscode.EventEmitter<
		vscode.FileChangeEvent[]
	>();
	readonly onDidChangeFile = this._emitter.event;

	// Cache of ROM documents by ROM path
	private readonly romDocuments = new Map<string, RomDocument>();

	// Cache of table metadata by URI
	private readonly tableCache = new Map<string, TableCacheEntry>();

	constructor(
		private readonly providerRegistry: { list(): DefinitionProvider[] },
		private readonly stateManager: WorkspaceState,
		private readonly treeProvider?: RomExplorerTreeProvider,
	) {}
	watch(
		_uri: vscode.Uri,
		_options: {
			readonly recursive: boolean;
			readonly excludes: readonly string[];
		},
	): vscode.Disposable {
		// Virtual file system - no real file watching needed.
		// Tables are backed by ROM files which are tracked separately.
		// Return a no-op Disposable to satisfy the interface.
		return {
			dispose() {
				// No-op: nothing to clean up
			},
		};
	}
	copy?(
		_source: vscode.Uri,
		_destination: vscode.Uri,
		_options: { readonly overwrite: boolean },
	): void | Thenable<void> {
		throw new Error("Method not implemented.");
	}

	/**
	 * Read a virtual table file
	 *
	 * Extracts table data from ROM and encodes as JSON
	 */
	async readFile(uri: vscode.Uri): Promise<Uint8Array> {
		const parsed = parseTableUri(uri);
		if (!parsed) {
			throw vscode.FileSystemError.FileNotFound(uri);
		}

		const { romPath, tableName } = parsed;

		// Get or load ROM document
		const romDoc = await this.getRomDocument(romPath);
		if (!romDoc || !romDoc.definition) {
			throw vscode.FileSystemError.FileNotFound(uri);
		}

		// Find table definition
		const tableDef = romDoc.definition.tables.find((t) => t.name === tableName);
		if (!tableDef) {
			throw vscode.FileSystemError.FileNotFound(uri);
		}

		// Extract table data
		const tableData = this.extractTableData(romDoc, tableDef);

		// Encode as JSON
		const json = JSON.stringify(tableData, null, 2);

		// Cache metadata
		this.tableCache.set(uri.toString(), {
			romPath,
			tableName,
			definition: tableDef,
			lastRead: Date.now(),
		});

		return new TextEncoder().encode(json);
	}

	/**
	 * Write a virtual table file
	 *
	 * Decodes JSON and updates ROM bytes
	 */
	async writeFile(
		uri: vscode.Uri,
		content: Uint8Array,
		_options: { create: boolean; overwrite: boolean },
	): Promise<void> {
		const parsed = parseTableUri(uri);
		if (!parsed) {
			throw vscode.FileSystemError.FileNotFound(uri);
		}

		const { romPath, tableName } = parsed;

		// Get ROM document
		const romDoc = await this.getRomDocument(romPath);
		if (!romDoc || !romDoc.definition) {
			throw vscode.FileSystemError.FileNotFound(uri);
		}

		// Find table definition
		const tableDef = romDoc.definition.tables.find((t) => t.name === tableName);
		if (!tableDef) {
			throw vscode.FileSystemError.FileNotFound(uri);
		}

		// Decode JSON
		const json = new TextDecoder().decode(content);
		let tableData: TableData;
		try {
			tableData = JSON.parse(json);
		} catch (_error) {
			throw vscode.FileSystemError.NoPermissions("Invalid JSON format");
		}

		// Validate table data
		this.validateTableData(tableData, tableDef);

		// Update ROM bytes
		this.updateRomBytes(romDoc, tableDef, tableData);

		// Mark ROM as dirty and fire update event
		romDoc.updateBytes(
			romDoc.romBytes,
			tableDef.z.address,
			this.getTableDataLength(tableDef),
		);

		// Mark this specific table as dirty
		this.stateManager.markTableDirty(romPath, tableName);

		// Notify tree provider to refresh
		this.treeProvider?.refresh();

		// Notify other editors of the change
		this._emitter.fire([
			{
				type: vscode.FileChangeType.Changed,
				uri,
			},
		]);
	}

	/**
	 * Get file metadata
	 */
	async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
		const parsed = parseTableUri(uri);
		if (!parsed) {
			throw vscode.FileSystemError.FileNotFound(uri);
		}

		// Check if ROM file exists
		const romUri = vscode.Uri.file(parsed.romPath);
		try {
			const romStat = await vscode.workspace.fs.stat(romUri);

			// Return virtual file stat based on ROM file
			return {
				type: vscode.FileType.File,
				ctime: romStat.ctime,
				mtime: romStat.mtime,
				size: 0, // Size is not meaningful for virtual files
			};
		} catch (_error) {
			throw vscode.FileSystemError.FileNotFound(uri);
		}
	}

	/**
	 * Read directory (not supported for virtual files)
	 */
	readDirectory(_uri: vscode.Uri): [string, vscode.FileType][] {
		throw vscode.FileSystemError.NoPermissions("Cannot read directory");
	}

	/**
	 * Create directory (not supported for virtual files)
	 */
	createDirectory(_uri: vscode.Uri): void {
		throw vscode.FileSystemError.NoPermissions("Cannot create directory");
	}

	/**
	 * Delete file (not supported for virtual files)
	 */
	delete(_uri: vscode.Uri, _options: { recursive: boolean }): void {
		throw vscode.FileSystemError.NoPermissions("Cannot delete virtual file");
	}

	/**
	 * Rename file (not supported for virtual files)
	 */
	rename(
		_oldUri: vscode.Uri,
		_newUri: vscode.Uri,
		_options: { overwrite: boolean },
	): void {
		throw vscode.FileSystemError.NoPermissions("Cannot rename virtual file");
	}

	/**
	 * Get or load a ROM document
	 */
	private async getRomDocument(romPath: string): Promise<RomDocument | null> {
		// Check cache
		let romDoc = this.romDocuments.get(romPath);
		if (romDoc) {
			return romDoc;
		}

		// Load ROM file
		const romUri = vscode.Uri.file(romPath);
		try {
			const romBytes = new Uint8Array(
				await vscode.workspace.fs.readFile(romUri),
			);

			// Get saved definition from workspace state
			const savedDefUri = this.stateManager.getRomDefinition(romPath);
			let definition: ROMDefinition | undefined;

			if (savedDefUri) {
				// Load saved definition
				const provider = this.providerRegistry.list()[0];
				if (provider) {
					try {
						definition = await provider.parse(savedDefUri);
					} catch (error) {
						console.error("Failed to load saved definition:", error);
					}
				}
			}

			if (!definition) {
				// No saved definition - prompt user to select one via resolveRomDefinition
				definition = await resolveRomDefinition(
					romUri,
					romBytes,
					this.providerRegistry,
					this.stateManager,
				);
				if (!definition) {
					console.error(
						"User cancelled definition selection for ROM:",
						romPath,
					);
					return null;
				}
			}

			// Create ROM document
			romDoc = new (await import("./rom/document.js")).RomDocument(
				romUri,
				romBytes,
				definition,
			);
			this.romDocuments.set(romPath, romDoc);

			// Clean up when document is disposed
			romDoc.onDidDispose(() => {
				this.romDocuments.delete(romPath);
			});

			return romDoc;
		} catch (error) {
			console.error("Failed to load ROM file:", error);
			return null;
		}
	}

	/**
	 * Extract table data from ROM
	 */
	private extractTableData(
		romDoc: RomDocument,
		tableDef: TableDefinition,
	): TableData {
		const rom = romDoc.romBytes;

		// Read axis data
		const xAxis = this.readAxis(tableDef.x, rom);
		let yAxis: number[] | undefined;
		if (tableDef.kind === "table2d" || tableDef.kind === "table3d") {
			yAxis = this.readAxis((tableDef as Table2DDefinition).y, rom);
		}

		// Read table data based on kind
		let data: number[] | number[][];
		let dimensions: { rows: number; cols: number };

		if (tableDef.kind === "table1d") {
			const t = tableDef as Table1DDefinition;
			dimensions = { rows: t.rows, cols: 1 };

			const width = sizeOf(t.z.dtype);
			const stride = t.z.rowStrideBytes ?? width;
			const z: number[] = [];

			for (let r = 0; r < t.rows; r++) {
				const addr = t.z.address + r * stride;
				const bytes = rom.subarray(addr, addr + width);
				const raw = decodeScalar(bytes, t.z.dtype, t.z.endianness);
				z.push(raw * (t.z.scale ?? 1) + (t.z.offset ?? 0));
			}

			data = z;
		} else {
			// table2d or table3d
			const t = tableDef as Table2DDefinition;
			dimensions = { rows: t.rows, cols: t.cols };

			const width = sizeOf(t.z.dtype);
			const colStride = t.z.colStrideBytes ?? width;
			const rowStride = t.z.rowStrideBytes ?? t.cols * colStride;
			const z: number[][] = [];

			for (let r = 0; r < t.rows; r++) {
				const row: number[] = [];
				for (let c = 0; c < t.cols; c++) {
					const addr = t.z.address + r * rowStride + c * colStride;
					const bytes = rom.subarray(addr, addr + width);
					const raw = decodeScalar(bytes, t.z.dtype, t.z.endianness);
					row.push(raw * (t.z.scale ?? 1) + (t.z.offset ?? 0));
				}
				z.push(row);
			}

			data = z;
		}

		const metadata: TableMetadata = {
			romPath: romDoc.uri.fsPath,
			tableName: tableDef.name,
			tableKind: tableDef.kind,
			address: tableDef.z.address,
			dimensions,
			lastModified: Date.now(),
		};

		if (romDoc.definition?.uri) {
			metadata.definitionUri = romDoc.definition.uri;
		}

		if (tableDef.z.unit) {
			metadata.unit = String(tableDef.z.unit);
		}

		const result: TableData = {
			metadata,
			data,
		};

		if (xAxis) {
			result.xAxis = xAxis;
		}

		if (yAxis) {
			result.yAxis = yAxis;
		}

		return result;
	}

	/**
	 * Get the total length of table data in bytes
	 */
	private getTableDataLength(tableDef: TableDefinition): number {
		const width = sizeOf(tableDef.z.dtype);
		if (tableDef.kind === "table1d") {
			const t = tableDef as Table1DDefinition;
			const stride = t.z.rowStrideBytes ?? width;
			return t.rows * stride;
		}
		const t = tableDef as Table2DDefinition;
		const colStride = t.z.colStrideBytes ?? width;
		const rowStride = t.z.rowStrideBytes ?? t.cols * colStride;
		return t.rows * rowStride;
	}

	/**
	 * Update ROM bytes from table data
	 */
	private updateRomBytes(
		romDoc: RomDocument,
		tableDef: TableDefinition,
		tableData: TableData,
	): void {
		const rom = romDoc.romBytes;

		if (tableDef.kind === "table1d") {
			const t = tableDef as Table1DDefinition;
			const width = sizeOf(t.z.dtype);
			const stride = t.z.rowStrideBytes ?? width;
			const z = tableData.data as number[];

			for (let r = 0; r < t.rows; r++) {
				const addr = t.z.address + r * stride;
				const physical = z[r];
				if (physical !== undefined) {
					const raw = Math.round(
						(physical - (t.z.offset ?? 0)) / (t.z.scale ?? 1),
					);
					const bytes = rom.subarray(addr, addr + width);
					encodeScalar(bytes, t.z.dtype, t.z.endianness, raw);
				}
			}
		} else {
			// table2d or table3d
			const t = tableDef as Table2DDefinition;
			const width = sizeOf(t.z.dtype);
			const colStride = t.z.colStrideBytes ?? width;
			const rowStride = t.z.rowStrideBytes ?? t.cols * colStride;
			const z = tableData.data as number[][];

			for (let r = 0; r < t.rows; r++) {
				const row = z[r];
				if (row) {
					for (let c = 0; c < t.cols; c++) {
						const addr = t.z.address + r * rowStride + c * colStride;
						const physical = row[c];
						if (physical !== undefined) {
							const raw = Math.round(
								(physical - (t.z.offset ?? 0)) / (t.z.scale ?? 1),
							);
							const bytes = rom.subarray(addr, addr + width);
							encodeScalar(bytes, t.z.dtype, t.z.endianness, raw);
						}
					}
				}
			}
		}

		// Note: Axis data is read-only, so we don't update it
	}

	/**
	 * Read axis data
	 */
	private readAxis(
		axis: AxisDefinition | undefined,
		rom: Uint8Array,
	): number[] | undefined {
		if (!axis) return undefined;
		if (axis.kind === "static") return axis.values;

		const dyn = axis as DynamicArrayDefinition;
		const width = sizeOf(dyn.dtype);
		const out: number[] = [];

		for (let i = 0; i < dyn.length; i++) {
			const addr = dyn.address + i * width;
			const cell = rom.subarray(addr, addr + width);
			const raw = decodeScalar(cell, dyn.dtype, dyn.endianness);
			const scaled = raw * (dyn.scale ?? 1) + (dyn.offset ?? 0);
			out.push(scaled);
		}

		return out;
	}

	/**
	 * Validate table data against definition
	 */
	private validateTableData(
		tableData: TableData,
		tableDef: TableDefinition,
	): void {
		// Check metadata
		if (!tableData.metadata || !tableData.data) {
			throw vscode.FileSystemError.NoPermissions("Invalid table data format");
		}

		// Check dimensions
		const expectedDims = this.getTableDimensions(tableDef);
		const actualDims = this.getDataDimensions(tableData.data);

		if (
			expectedDims.rows !== actualDims.rows ||
			expectedDims.cols !== actualDims.cols
		) {
			throw vscode.FileSystemError.NoPermissions(
				`Dimension mismatch: expected ${expectedDims.rows}x${expectedDims.cols}, got ${actualDims.rows}x${actualDims.cols}`,
			);
		}
	}

	/**
	 * Get table dimensions from definition
	 */
	private getTableDimensions(tableDef: TableDefinition): {
		rows: number;
		cols: number;
	} {
		if (tableDef.kind === "table1d") {
			return { rows: (tableDef as Table1DDefinition).rows, cols: 1 };
		}
		const t = tableDef as Table2DDefinition;
		return { rows: t.rows, cols: t.cols };
	}

	/**
	 * Get data dimensions from array
	 */
	private getDataDimensions(data: number[] | number[][]): {
		rows: number;
		cols: number;
	} {
		if (Array.isArray(data[0])) {
			return { rows: data.length, cols: (data[0] as number[]).length };
		}
		return { rows: data.length, cols: 1 };
	}

	/**
	 * Dispose the provider
	 */
	dispose(): void {
		this._emitter.dispose();
		this.romDocuments.clear();
		this.tableCache.clear();
	}
}
