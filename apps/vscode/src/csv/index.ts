/**
 * CSV utilities module
 *
 * Provides functions for:
 * - Parsing CSV files into table snapshots
 * - Exporting table data to CSV format
 * - Importing CSV data into tables with validation
 * - Validating imported data with error/warning reporting
 */

// Export functions
export {
	exportActiveTableCsvFlow,
	sanitizeFilename,
	snapshotToCsv,
} from "./export";
// Import functions
export { applySnapshotToRom, importTableFromCsvFlow } from "./import";
// Parser functions
export {
	csvToSnapshot,
	parseCsv,
	parseCsv1D,
	parseCsv2D,
	type TableSnapshot,
} from "./parser";

// Validation functions and types
export {
	generateImportPreview,
	getPreviewValues,
	type ImportPreview,
	showImportPreviewDialog,
	type ValidationError,
	type ValidationWarning,
	validateDimensions,
} from "./validation";
