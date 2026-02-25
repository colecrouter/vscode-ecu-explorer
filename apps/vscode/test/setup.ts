import { vi } from "vitest";

// Mock the vscode module
vi.mock("vscode", async () => {
	const { createVSCodeMock } =
		await vi.importActual<typeof import("jest-mock-vscode")>(
			"jest-mock-vscode",
		);

	// Create the vscode mock using jest-mock-vscode
	const mock = createVSCodeMock(vi);

	// Add proposed/newer APIs not included in jest-mock-vscode
	// vscode.lm — Language Model / MCP APIs (used by mcp-provider.ts)
	const mockAsAny = mock as Record<string, unknown>;
	mockAsAny["lm"] = {
		registerMcpServerDefinitionProvider: vi
			.fn()
			.mockReturnValue({ dispose: vi.fn() }),
	};

	// vscode.RelativePattern — used by per-document file watchers
	if (!mockAsAny["RelativePattern"]) {
		mockAsAny["RelativePattern"] = class RelativePattern {
			base: import("vscode").Uri | import("vscode").WorkspaceFolder;
			pattern: string;
			constructor(
				base: import("vscode").Uri | import("vscode").WorkspaceFolder,
				pattern: string,
			) {
				this.base = base;
				this.pattern = pattern;
			}
		};
	}

	return mock;
});
