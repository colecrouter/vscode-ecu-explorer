import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import Chart from "../src/lib/views/Chart.svelte";
import { ChartState } from "../src/lib/views/chart-state.svelte";

/**
 * Mock getComputedStyle so that CSS variable strings returned by theme-colors.ts
 * (e.g. "var(--vscode-charts-green)") are resolved to test color values instead
 * of empty strings.  Plotly.js requires actual color values, not CSS variable
 * references, so Chart.svelte calls resolveCssColor() at render time.
 */
const CSS_VAR_MAP: Record<string, string> = {
	"--vscode-charts-green": "#22c55e",
	"--vscode-charts-yellow": "#eab308",
	"--vscode-charts-red": "#ef4444",
	"--vscode-editor-background": "#1e1e1e",
	"--vscode-editor-foreground": "#d4d4d4",
	"--vscode-charts-lines": "#444444",
};

describe("Chart Component", () => {
	let originalGetComputedStyle: typeof window.getComputedStyle;

	beforeEach(() => {
		originalGetComputedStyle = window.getComputedStyle;
		// Provide a mock that resolves known VSCode CSS variables to test colors
		window.getComputedStyle = vi.fn((_element: Element) => {
			return {
				getPropertyValue: (varName: string) => CSS_VAR_MAP[varName] ?? "",
			} as unknown as CSSStyleDeclaration;
		});
	});

	afterEach(() => {
		window.getComputedStyle = originalGetComputedStyle;
		vi.restoreAllMocks();
	});

	it("should render chart container", async () => {
		const chartState = new ChartState();
		chartState.snapshot = {
			kind: "table1d",
			name: "Test Chart",
			rows: 10,
			z: Array.from({ length: 10 }, (_, i) => i),
			x: Array.from({ length: 10 }, (_, i) => i * 10),
			unit: "rpm",
			xLabel: "RPM",
			zLabel: "Value",
		};

		const screen = render(Chart, { chartState });

		const container = screen.getByLabelText("Chart visualization");
		await expect.element(container).toBeInTheDocument();
	});

	it("should use line chart type when set externally via setChartType for table1d data", async () => {
		const chartState = new ChartState();
		chartState.snapshot = {
			kind: "table1d",
			name: "1D Table",
			rows: 5,
			z: [10, 20, 30, 40, 50],
			x: [1000, 2000, 3000, 4000, 5000],
			unit: "rpm",
			xLabel: "RPM",
			zLabel: "Boost",
		};

		// Set chart type externally (as the command-driven flow does)
		chartState.setChartType("line");

		expect(chartState.effectiveChartType).toBe("line");

		const screen = render(Chart, { chartState });
		const container = screen.getByLabelText("Chart visualization");
		await expect.element(container).toBeInTheDocument();
	});

	it("should use line chart type when set externally via setChartType for table2d data", async () => {
		const chartState = new ChartState();
		chartState.snapshot = {
			kind: "table2d",
			name: "2D Table",
			rows: 3,
			cols: 3,
			z: [
				[1, 2, 3],
				[4, 5, 6],
				[7, 8, 9],
			],
			x: [1000, 2000, 3000],
			y: [10, 20, 30],
			unit: "kPa",
			xLabel: "RPM",
			yLabel: "Load",
			zLabel: "Boost",
		};

		// Set chart type externally (as the open3DGraph command does)
		chartState.setChartType("line");

		expect(chartState.effectiveChartType).toBe("line");

		const screen = render(Chart, { chartState });
		const container = screen.getByLabelText("Chart visualization");
		await expect.element(container).toBeInTheDocument();
	});

	it("should resolve CSS variable colors via getComputedStyle when themeColors are provided", async () => {
		const chartState = new ChartState();
		chartState.snapshot = {
			kind: "table1d",
			name: "CSS Var Test",
			rows: 3,
			z: [1, 2, 3],
			x: [100, 200, 300],
			unit: "rpm",
			xLabel: "RPM",
			zLabel: "Value",
		};
		chartState.setChartType("line");

		// Provide theme colors as CSS variable strings (as theme-colors.ts returns)
		const themeColors = {
			gradient: {
				low: "var(--vscode-charts-green)",
				mid: "var(--vscode-charts-yellow)",
				high: "var(--vscode-charts-red)",
			},
			ui: {
				background: "var(--vscode-editor-background)",
				foreground: "var(--vscode-editor-foreground)",
				border: "var(--vscode-charts-lines)",
				inputBackground: "var(--vscode-input-background)",
				inputForeground: "var(--vscode-input-foreground)",
				inputBorder: "var(--vscode-input-border)",
				selectionBackground: "var(--vscode-list-activeSelectionBackground)",
				selectionForeground: "var(--vscode-list-activeSelectionForeground)",
				hoverBackground: "var(--vscode-list-hoverBackground)",
				focusBorder: "var(--vscode-focusBorder)",
				buttonBackground: "var(--vscode-button-background)",
				buttonForeground: "var(--vscode-button-foreground)",
				buttonHoverBackground: "var(--vscode-button-hoverBackground)",
			},
			isHighContrast: false,
		};

		const screen = render(Chart, { chartState, themeColors });
		const container = screen.getByLabelText("Chart visualization");
		await expect.element(container).toBeInTheDocument();

		// Verify getComputedStyle was called (CSS variable resolution was attempted)
		expect(window.getComputedStyle).toHaveBeenCalled();
	});
});
