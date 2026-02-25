import type { TableDefinition } from "@ecu-explorer/core";
import * as vscode from "vscode";
import type { RomDocument } from "../rom/document";
import type { RomEditorProvider } from "../rom/editor-provider";
import type { WorkspaceState } from "../workspace-state";
import { RomTreeItem, type RomTreeItemData } from "./rom-tree-item";

/**
 * TreeDataProvider for ECU Explorer sidebar
 * Displays open ROMs and their tables in a hierarchical tree
 *
 * Phase 1: Displays ROM nodes, category nodes, and table nodes
 */
export class RomExplorerTreeProvider
	implements vscode.TreeDataProvider<RomTreeItem>
{
	// Event emitter for tree refresh
	private _onDidChangeTreeData = new vscode.EventEmitter<
		RomTreeItem | undefined | null
	>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	// State: Map of ROM URI → RomDocument
	private documents = new Map<string, RomDocument>();

	// Active table tracking: romUri -> tableName
	private activeTable: { romUri: string; tableName: string } | null = null;

	// Workspace state manager
	// private readonly stateManager: WorkspaceState;

	constructor(
		private readonly editorProvider: RomEditorProvider,
		_workspaceState: WorkspaceState,
	) {
		// this.stateManager = workspaceState;
		// Listen to document lifecycle events
		this.setupEventListeners();
	}

	/**
	 * Set up event listeners for document changes
	 */
	private setupEventListeners(): void {
		// Listen to CustomEditor document changes (for dirty state)
		this.editorProvider.onDidChangeCustomDocument(() => {
			// Refresh the entire tree to force VSCode to recreate TreeItem instances
			// with updated labels (including dirty indicator)
			this.refresh();
		});
	}

	/**
	 * Get tree item for display
	 * Called by VSCode for each visible tree item
	 */
	getTreeItem(element: RomTreeItem): vscode.TreeItem {
		return element;
	}

	/**
	 * Get children of a tree item
	 * Called by VSCode when expanding a node
	 *
	 * Phase 1: Returns ROM nodes at root, categories for ROM nodes, tables for category nodes
	 */
	async getChildren(element?: RomTreeItem): Promise<RomTreeItem[]> {
		if (!element) {
			// Root level: return all open ROM documents
			return this.getRomNodes();
		}

		// Handle different element types
		if (element.data.type === "rom") {
			// ROM node: return category nodes
			return this.getCategoryNodes(element.data.document);
		}

		if (element.data.type === "category") {
			// Category node: return table nodes
			return this.getTableNodes(element.data.categoryName, element.data.romUri);
		}

		// Table nodes are leaf nodes (no children)
		return [];
	}

	/**
	 * Get all ROM nodes (root level)
	 */
	private getRomNodes(): RomTreeItem[] {
		const items: RomTreeItem[] = [];

		for (const [uriString, document] of this.documents.entries()) {
			const uri = vscode.Uri.parse(uriString);
			const fileName = uri.path.split("/").pop() || uri.path;

			const data: RomTreeItemData = {
				id: uriString,
				label: fileName,
				type: "rom",
				documentUri: uri,
				document,
				...(document.definition?.name && {
					definitionName: document.definition.name,
				}),
			};

			// ROMs are expandable if they have a definition with tables
			const hasChildren =
				document.definition?.tables && document.definition.tables.length > 0;
			const collapsibleState = hasChildren
				? vscode.TreeItemCollapsibleState.Collapsed
				: vscode.TreeItemCollapsibleState.None;

			const item = new RomTreeItem(data, collapsibleState);
			items.push(item);
		}

		// Sort by filename
		items.sort((a, b) => {
			const labelA = typeof a.label === "string" ? a.label : "";
			const labelB = typeof b.label === "string" ? b.label : "";
			return labelA.localeCompare(labelB);
		});

		return items;
	}

	/**
	 * Extract and group tables by category from a ROM document
	 * Returns category nodes sorted alphabetically
	 */
	private getCategoryNodes(document: RomDocument): RomTreeItem[] {
		const items: RomTreeItem[] = [];

		// Handle missing definition
		if (!document.definition?.tables) {
			return items;
		}

		// Group tables by category
		const categoriesMap = this.groupTablesByCategory(
			document.definition.tables,
		);

		// Create category nodes
		for (const [categoryName, tables] of categoriesMap.entries()) {
			const categoryId = `${document.uri.toString()}:${categoryName}`;

			const data: RomTreeItemData = {
				id: categoryId,
				label: categoryName,
				type: "category",
				romUri: document.uri.toString(),
				categoryName,
				tableCount: tables.length,
			};

			// Categories are expandable if they have tables
			const collapsibleState =
				tables.length > 0
					? vscode.TreeItemCollapsibleState.Collapsed
					: vscode.TreeItemCollapsibleState.None;

			const item = new RomTreeItem(data, collapsibleState);
			items.push(item);
		}

		// Sort by category name
		items.sort((a, b) => {
			const labelA = typeof a.label === "string" ? a.label : "";
			const labelB = typeof b.label === "string" ? b.label : "";
			return labelA.localeCompare(labelB);
		});

		return items;
	}

	/**
	 * Get table nodes for a specific category
	 */
	private getTableNodes(categoryName: string, romUri: string): RomTreeItem[] {
		const items: RomTreeItem[] = [];

		// Find the document
		const document = this.documents.get(romUri);
		if (!document?.definition?.tables) {
			return items;
		}

		// Filter tables by category
		const tables = document.definition.tables.filter(
			(table) => (table.category || "Uncategorized") === categoryName,
		);

		// Create table nodes
		for (const table of tables) {
			const tableId = `${romUri}:${table.name}`;

			// Check if this table is the active table
			const isActive =
				this.activeTable?.romUri === romUri &&
				this.activeTable?.tableName === table.name;

			const data: RomTreeItemData = {
				id: tableId,
				label: table.name,
				type: "table",
				romUri,
				tableDef: table,
				isActive,
				...(table.category && { category: table.category }),
			};

			const item = new RomTreeItem(data, vscode.TreeItemCollapsibleState.None);
			items.push(item);
		}

		// Sort by table name
		items.sort((a, b) => {
			const labelA = typeof a.label === "string" ? a.label : "";
			const labelB = typeof b.label === "string" ? b.label : "";
			return labelA.localeCompare(labelB);
		});

		return items;
	}

	/**
	 * Group tables by category
	 * Returns a Map of category name → tables
	 */
	private groupTablesByCategory(
		tables: TableDefinition[],
	): Map<string, TableDefinition[]> {
		const categoriesMap = new Map<string, TableDefinition[]>();

		for (const table of tables) {
			const categoryName = table.category || "Uncategorized";

			let categoryTables = categoriesMap.get(categoryName);
			if (!categoryTables) {
				categoryTables = [];
				categoriesMap.set(categoryName, categoryTables);
			}

			categoryTables.push(table);
		}

		return categoriesMap;
	}

	/**
	 * Refresh tree view (entire tree or specific element)
	 */
	refresh(element?: RomTreeItem): void {
		this._onDidChangeTreeData.fire(element);
	}

	/**
	 * Add a ROM document to the tree
	 */
	addDocument(document: RomDocument): void {
		this.documents.set(document.uri.toString(), document);
		this.refresh();
	}

	/**
	 * Remove a ROM document from the tree
	 */
	removeDocument(uri: vscode.Uri): void {
		const uriString = uri.toString();
		this.documents.delete(uriString);
		if (this.activeTable?.romUri === uriString) {
			this.activeTable = null;
		}
		this.refresh();
	}

	/**
	 * Get all tracked documents
	 */
	getDocuments(): Map<string, RomDocument> {
		return new Map(this.documents);
	}

	/**
	 * Set the active table
	 * Updates the active table state and refreshes the tree
	 *
	 * @param romUri - URI of the ROM containing the table
	 * @param tableName - Name of the table to mark as active
	 */
	setActiveTable(romUri: string, tableName: string): void {
		this.activeTable = { romUri, tableName };
		// Refresh the entire tree to update active indicators
		this.refresh();
	}

	/**
	 * Clear the active table
	 * Removes the active table indicator and refreshes the tree
	 */
	clearActiveTable(): void {
		this.activeTable = null;
		// Refresh the entire tree to remove active indicators
		this.refresh();
	}

	/**
	 * Get the currently active table
	 *
	 * @returns Active table info or null if no table is active
	 */
	getActiveTable(): { romUri: string; tableName: string } | null {
		return this.activeTable;
	}
}
