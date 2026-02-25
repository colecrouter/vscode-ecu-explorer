/**
 * Sample table data for testing
 */

export function createSampleTableData(
	columns: number,
	rows: number = 1,
): number[] {
	const data: number[] = [];
	for (let i = 0; i < columns * rows; i++) {
		data.push(Math.floor(Math.random() * 255));
	}
	return data;
}

export function create1DTableData(columns: number = 16): number[] {
	return Array.from({ length: columns }, (_, i) => i * 10);
}

export function create2DTableData(
	columns: number = 16,
	rows: number = 16,
): number[] {
	const data: number[] = [];
	for (let r = 0; r < rows; r++) {
		for (let c = 0; c < columns; c++) {
			data.push((r + c) * 5);
		}
	}
	return data;
}

export function create3DTableData(
	columns: number = 16,
	rows: number = 16,
	layers: number = 8,
): number[] {
	const data: number[] = [];
	for (let l = 0; l < layers; l++) {
		for (let r = 0; r < rows; r++) {
			for (let c = 0; c < columns; c++) {
				data.push((l + r + c) * 3);
			}
		}
	}
	return data;
}

export function createFuelMapData(): number[] {
	// 16x16 fuel map with realistic values
	const data: number[] = [];
	for (let r = 0; r < 16; r++) {
		for (let c = 0; c < 16; c++) {
			// Simulate fuel values (0-255)
			const value = Math.floor(100 + r * 2 + c * 1.5);
			data.push(Math.min(value, 255));
		}
	}
	return data;
}

export function createIgnitionMapData(): number[] {
	// 16x16x8 ignition map with realistic values
	const data: number[] = [];
	for (let l = 0; l < 8; l++) {
		for (let r = 0; r < 16; r++) {
			for (let c = 0; c < 16; c++) {
				// Simulate ignition timing values (0-255)
				const value = Math.floor(50 + l * 5 + r * 1 + c * 0.5);
				data.push(Math.min(value, 255));
			}
		}
	}
	return data;
}

export function createBoostMapData(): number[] {
	// 12x12 boost map with realistic values
	const data: number[] = [];
	for (let r = 0; r < 12; r++) {
		for (let c = 0; c < 12; c++) {
			// Simulate boost values (0-255)
			const value = Math.floor(80 + r * 3 + c * 2);
			data.push(Math.min(value, 255));
		}
	}
	return data;
}

export function createAxisData(
	length: number,
	scale: number = 1,
	offset: number = 0,
): number[] {
	return Array.from({ length }, (_, i) => i * scale + offset);
}

export function createRPMAxis(): number[] {
	// RPM axis: 0, 500, 1000, 1500, ..., 7500
	return Array.from({ length: 16 }, (_, i) => i * 500);
}

export function createLoadAxis(): number[] {
	// Load axis: 0, 10, 20, ..., 150
	return Array.from({ length: 16 }, (_, i) => i * 10);
}

export function createGearAxis(): number[] {
	// Gear axis: 1, 2, 3, 4, 5, 6, 7, 8
	return Array.from({ length: 8 }, (_, i) => i + 1);
}

export function createTableWithGradient(
	columns: number,
	rows: number = 1,
): number[] {
	const data: number[] = [];
	for (let r = 0; r < rows; r++) {
		for (let c = 0; c < columns; c++) {
			const value = Math.floor((c / columns) * 255);
			data.push(value);
		}
	}
	return data;
}

export function createTableWithPattern(
	columns: number,
	rows: number = 1,
	pattern: number[],
): number[] {
	const data: number[] = [];
	for (let i = 0; i < columns * rows; i++) {
		data.push(pattern[i % pattern.length]);
	}
	return data;
}

export function createUniformTable(
	columns: number,
	rows: number = 1,
	value: number = 128,
): number[] {
	return Array(columns * rows).fill(value);
}

export function createTableWithNoise(
	columns: number,
	rows: number = 1,
	baseValue: number = 128,
): number[] {
	const data: number[] = [];
	for (let i = 0; i < columns * rows; i++) {
		const noise = Math.floor((Math.random() - 0.5) * 50);
		data.push(Math.max(0, Math.min(255, baseValue + noise)));
	}
	return data;
}

export function createTableMetadata(
	name: string = "Test Table",
	type: "1d" | "2d" | "3d" = "2d",
	columns: number = 16,
	rows: number = 16,
	layers: number = 1,
) {
	return {
		name,
		type,
		columns,
		rows,
		layers,
		address: 0x1000,
		xAxis: {
			name: "X Axis",
			address: 0x2000,
			length: columns,
		},
		yAxis: {
			name: "Y Axis",
			address: 0x2100,
			length: rows,
		},
		zAxis:
			type === "3d"
				? {
						name: "Z Axis",
						address: 0x2200,
						length: layers,
					}
				: undefined,
	};
}
