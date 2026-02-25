import type { Endianness, ScalarType } from "../binary";
import type { Unit } from "../units";

// Base traits
interface Entity {
	/** Human-readable name */
	name: string;
}

interface Measured {
	/** Unit of measurement this entity represents in the real world */
	unit?: Unit;
}

interface Addressed {
	/** Byte address in ROM */
	address: number;
	/** Endianness of the stored data @default "le" */
	endianness?: Endianness;
}

interface Categorized {
	/** Textual label for grouping related tables */
	category?: string;
}

interface Scalable {
	offset?: number; // physical = raw * scale + offset
	scale?: number;
}

/**
 * Generic 1D array descriptor.
 * Use for axes and for Z data. Dynamic arrays live in ROM; static arrays are embedded values.
 */
export interface StaticArrayDefinition extends Entity, Measured {
	kind: "static";
	values: number[]; // already in physical units
}

export interface DynamicArrayDefinition
	extends Entity,
		Measured,
		Addressed,
		Scalable {
	kind: "dynamic";
	length: number;
	/** Raw data type stored in ROM */
	dtype: ScalarType;
	notes?: string;
}

/** Axis definition for tables */
export type AxisDefinition = StaticArrayDefinition | DynamicArrayDefinition;

/**
 * Z data (table body) is a dynamic array (lives in ROM).
 * Represented as a flat, row-major block unless layout overrides are provided.
 */
export interface ZDataDefinition extends Entity, Measured, Addressed, Scalable {
	dtype: ScalarType;
	endianness?: Endianness;
	/** total elements = rows * cols for 2D, or explicit for 1D */
	/** Optional length when rows/cols provided in view */
	length?: number;
	notes?: string;

	// Optional layout overrides for padded/interleaved layouts
	/** @default cols * byteSize(dtype) */
	rowStrideBytes?: number;
	/** @default byteSize(dtype) */
	colStrideBytes?: number;
	/** Custom indexer: compute byte offset for (r,c). If provided, overrides strides. */
	indexer?: (r: number, c: number) => number;
}

/** 1D table: only Z array, no axes required (can still have one axis if desired) */
export interface Table1DDefinition extends Entity, Categorized {
	kind: "table1d";
	rows: number;
	z: ZDataDefinition;
	// Optional single axis for labeling (e.g., RPM breakpoints)
	x?: AxisDefinition;
}

/** 2D table: X and Y axes define breakpoints; Z contains the cells */
export interface Table2DDefinition extends Entity, Categorized {
	kind: "table2d";
	rows: number;
	cols: number;
	x?: AxisDefinition; // columns axis (length = cols)
	y?: AxisDefinition; // rows axis (length = rows)
	z: ZDataDefinition; // row-major Z data block
}

/** 3D table: X, Y axes; Z can be interpreted as a stack or surface—use rows*cols and optionally depth */
export interface Table3DDefinition extends Entity, Categorized {
	kind: "table3d";
	rows: number;
	cols: number;
	depth: number; // number of layers (optional depending on your use case)
	x?: AxisDefinition;
	y?: AxisDefinition;
	/** Z can be modeled as one contiguous block rows*cols*depth or as multiple Z blocks (advanced) */
	z: ZDataDefinition;
}

/** Unified table definition */
export type TableDefinition =
	| Table1DDefinition
	| Table2DDefinition
	| Table3DDefinition;
