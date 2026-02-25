import type { Endianness, ScalarType } from "./binary";

/** Scale definition for converting between raw and scaled values */
export interface Unit {
	symbol: string;
	min: number;
	max: number;
	step: number;
	type: ScalarType;
	order: Endianness;
	to: (raw: number) => number;
	from: (scaled: number) => number;
}
