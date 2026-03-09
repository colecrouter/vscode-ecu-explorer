/**
 * Handlers Module
 *
 * Exports all handler functions for extension.ts
 */

export {
	handleCellEdit,
	setCellEditHandlerContext,
} from "./cell-edit-handler.js";
export {
	getRomDocumentForPanel,
	handleTableOpen,
	registerPanel,
	setTableHandlerContext,
	setupTableWebview,
} from "./table-handler.js";

export { renderTableHtml } from "./webview.js";
