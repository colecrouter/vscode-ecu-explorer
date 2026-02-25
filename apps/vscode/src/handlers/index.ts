/**
 * Handlers Module
 *
 * Exports all handler functions for extension.ts
 */

export { handleCellEdit, setCellEditHandlerContext } from "./cell-edit-handler";
export {
	getRomDocumentForPanel,
	handleTableOpen,
	registerPanel,
	setTableHandlerContext,
	setupTableWebview,
} from "./table-handler";

export { renderTableHtml } from "./webview";
