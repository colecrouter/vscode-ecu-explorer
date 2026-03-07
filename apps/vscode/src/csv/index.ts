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
} from "./export.js";
// Import functions
export { applySnapshotToRom, importTableFromCsvFlow } from "./import.js";
// Parser functions
export {
	csvToSnapshot,
	parseCsv,
	parseCsv1D,
	parseCsv2D,
	type TableSnapshot,
} from "./parser.js";

// Validation functions and types
export {
	generateImportPreview,
	getPreviewValues,
	type ImportPreview,
	showImportPreviewDialog,
	type ValidationError,
	type ValidationWarning,
	validateDimensions,
} from "./validation.js";
