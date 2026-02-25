import type { TableDefinition } from "@ecu-explorer/core";
import * as vscode from "vscode";
import type { RomDocument } from "../rom/document";

/**
 * Base interface for all tree items
 */
interface RomTreeItemBase {
	/** Unique identifier for this tree item */
	id: string;
	/** Display label */
	label: string;
	/** Item type discriminator */
	type: "root" | "rom" | "category" | "table";
}

/**
 * Root node (not used in Phase 1, but included for future phases)
 */
interface RootTreeItemData extends RomTreeItemBase {
	type: "root";
}

/**
 * ROM node in tree (top-level)
 */
interface RomTreeItemDataType extends RomTreeItemBase {
	type: "rom";
	/** URI of the ROM document */
	documentUri: vscode.Uri;
	/** Reference to RomDocument */
	document: RomDocument;
	/** ROM definition name (if loaded) */
	definitionName?: string;
}

/**
 * Category node (groups tables by category)
 * Represents a collapsible group of related tables within a ROM
 */
interface CategoryTreeItemData extends RomTreeItemBase {
	type: "category";
	/** Parent ROM URI */
	romUri: string;
	/** Category name from table definition (e.g., "Fuel", "Ignition", "Boost") */
	categoryName: string;
	/** Number of tables in this category */
	tableCount: number;
}

/**
 * Table node (leaf node)
 */
interface TableTreeItemData extends RomTreeItemBase {
	type: "table";
	/** Parent ROM URI */
	romUri: string;
	/** Table definition */
	tableDef: TableDefinition;
	/** Whether this table is currently open in a webview */
	isActive: boolean;
	/** Category this table belongs to */
	category?: string;
}

/**
 * Union type for all tree item data
 */
export type RomTreeItemData =
	| RootTreeItemData
	| RomTreeItemDataType
	| CategoryTreeItemData
	| TableTreeItemData;

/**
 * Tree item for ECU Explorer
 * Wraps data and provides VSCode TreeItem properties
 */
export class RomTreeItem extends vscode.TreeItem {
	constructor(
		public readonly data: RomTreeItemData,
		collapsibleState: vscode.TreeItemCollapsibleState,
	) {
		// Build label with dirty indicator before calling super
		const label = RomTreeItem.buildLabel(data);
		super(label, collapsibleState);

		// Set properties based on item type
		this.id = data.id;
		this.contextValue = data.type;
		if (data.type === "table") {
			this.contextValue = `table:${data.tableDef.kind}`;
		}
		this.tooltip = this.buildTooltip();

		const icon = this.getIcon();
		if (icon !== undefined) {
			this.iconPath = icon;
		}

		const description = this.getDescription();
		if (description !== undefined) {
			this.description = description;
		}

		const command = this.getCommand();
		if (command !== undefined) {
			this.command = command;
		}
	}

	/**
	 * Build label (static method to use before super())
	 */
	private static buildLabel(data: RomTreeItemData): string {
		return data.label;
	}

	/**
	 * Build tooltip text
	 */
	private buildTooltip(): string {
		switch (this.data.type) {
			case "root":
				return "ECU Explorer";

			case "rom": {
				const rom = this.data as RomTreeItemDataType;
				return `${rom.definitionName || "No definition"}\n${rom.documentUri.fsPath}`;
			}

			case "category": {
				const cat = this.data as CategoryTreeItemData;
				return `${cat.tableCount} table${cat.tableCount !== 1 ? "s" : ""}`;
			}

			case "table": {
				const table = this.data as TableTreeItemData;
				return `${table.tableDef.kind} - ${table.tableDef.name}${table.isActive ? "\n✓ Currently open" : ""}`;
			}
		}
	}

	/**
	 * Get icon for tree item
	 */
	private getIcon():
		| vscode.ThemeIcon
		| { light: vscode.Uri; dark: vscode.Uri }
		| undefined {
		switch (this.data.type) {
			case "root":
				return new vscode.ThemeIcon("file-binary");

			case "rom":
				return new vscode.ThemeIcon("file-binary");

			case "category":
				return new vscode.ThemeIcon("folder");

			case "table": {
				const table = this.data as TableTreeItemData;
				if (table.isActive) {
					return new vscode.ThemeIcon(
						"check",
						new vscode.ThemeColor("charts.green"),
					);
				}
				// Select icon based on table kind
				switch (table.tableDef.kind) {
					case "table1d":
						return new vscode.ThemeIcon("graph-line");
					case "table2d":
						return new vscode.ThemeIcon("table");
					case "table3d":
						return new vscode.ThemeIcon("cube");
					default:
						return new vscode.ThemeIcon("graph");
				}
			}
		}
	}

	/**
	 * Get description (shown after label)
	 */
	private getDescription(): string | undefined {
		if (this.data.type === "category") {
			const cat = this.data as CategoryTreeItemData;
			return `${cat.tableCount} table${cat.tableCount !== 1 ? "s" : ""}`;
		}

		return undefined;
	}

	/**
	 * Get command to execute on click
	 */
	private getCommand(): vscode.Command | undefined {
		if (this.data.type === "table") {
			const table = this.data as TableTreeItemData;
			const cmd = {
				command: "ecuExplorer.openTable",
				title: "Open Table",
				arguments: [table.romUri, table.tableDef.name],
			};
			return cmd;
		}
		return undefined;
	}
}
