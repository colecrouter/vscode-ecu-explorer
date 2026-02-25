/**
 * Theme color provider for VSCode theme integration
 *
 * Reads VSCode theme colors and provides them to webviews for consistent theming.
 * Uses git decoration colors for data visualization gradients.
 */

import * as vscode from "vscode";

/**
 * Theme colors structure for VSCode theme integration
 */
export interface ThemeColors {
	gradient: {
		low: string;
		mid: string;
		high: string;
	};
	ui: {
		background: string;
		foreground: string;
		border: string;
		inputBackground: string;
		inputForeground: string;
		inputBorder: string;
		selectionBackground: string;
		selectionForeground: string;
		hoverBackground: string;
		focusBorder: string;
		buttonBackground: string;
		buttonForeground: string;
		buttonHoverBackground: string;
	};
	isHighContrast: boolean;
}

/**
 * Get theme colors from VSCode active color theme
 *
 * Reads theme colors using VSCode API.
 * Uses git decoration colors for data visualization gradient.
 *
 * @returns ThemeColors object with gradient and UI colors
 *
 * @example
 * ```typescript
 * const colors = getThemeColors();
 * console.log(colors.gradient.low); // "#22c55e" or theme color
 * ```
 */
export function getThemeColors(): ThemeColors {
	const theme = vscode.window.activeColorTheme;

	// Detect high contrast mode (handle undefined theme in tests)
	const isHighContrast =
		theme?.kind === vscode.ColorThemeKind.HighContrast || false;

	const getColor = (tokenName: string): string => `var(${tokenName})`;

	return {
		gradient: {
			low: getColor("--vscode-charts-green"),
			mid: getColor("--vscode-charts-yellow"),
			high: getColor("--vscode-charts-red"),
		},
		ui: {
			background: getColor("--vscode-editor-background"),
			foreground: getColor("--vscode-editor-foreground"),
			border: getColor("--vscode-charts-lines"),
			inputBackground: getColor("--vscode-input-background"),
			inputForeground: getColor("--vscode-input-foreground"),
			inputBorder: getColor("--vscode-input-border"),
			selectionBackground: getColor("--vscode-list-activeSelectionBackground"),
			selectionForeground: getColor("--vscode-list-activeSelectionForeground"),
			hoverBackground: getColor("--vscode-list-hoverBackground"),
			focusBorder: getColor("--vscode-focusBorder"),
			buttonBackground: getColor("--vscode-button-background"),
			buttonForeground: getColor("--vscode-button-foreground"),
			buttonHoverBackground: getColor("--vscode-button-hoverBackground"),
		},
		isHighContrast,
	};
}
