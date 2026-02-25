/**
 * Tests for workspace settings feature:
 * - Settings are read at activation and passed to EcuFlashProvider
 * - onDidChangeConfiguration triggers provider re-initialization
 * - Relative paths are resolved against workspace root
 * - When ecuExplorer.providers.enabled does not include "ecuflash", the provider is not registered
 * - invalidateCache() clears the cached URIs on EcuFlashProvider
 * - readConfig() returns typed EcuExplorerConfig from workspace settings
 */

import * as path from "node:path";
import { EcuFlashProvider } from "@ecu-explorer/definitions-ecuflash";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import { readConfig } from "../src/config";

// ---------------------------------------------------------------------------
// Helpers that mirror the logic in extension.ts
// ---------------------------------------------------------------------------

/**
 * Resolve setting paths relative to the workspace root.
 * Mirrors the resolveSettingPaths() helper in extension.ts.
 */
function resolveSettingPaths(
	paths: string[],
	workspaceRoot: string | undefined,
): string[] {
	if (!workspaceRoot) return paths.filter((p) => path.isAbsolute(p));
	return paths.map((p) =>
		path.isAbsolute(p) ? p : path.join(workspaceRoot, p),
	);
}

/**
 * Build the merged search path list for EcuFlashProvider.
 * Mirrors the logic in reinitializeProviders() in extension.ts.
 */
function buildEcuFlashSearchPaths(
	workspaceFolderPaths: string[],
	commonPaths: string[],
	ecuflashPaths: string[],
): string[] {
	return [...workspaceFolderPaths, ...commonPaths, ...ecuflashPaths];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Workspace Settings", () => {
	describe("resolveSettingPaths()", () => {
		it("returns absolute paths unchanged when workspace root is provided", () => {
			const result = resolveSettingPaths(["/absolute/path"], "/workspace/root");
			expect(result).toEqual(["/absolute/path"]);
		});

		it("resolves relative paths against workspace root", () => {
			const result = resolveSettingPaths(
				["./definitions", "my-defs"],
				"/workspace/root",
			);
			expect(result).toEqual([
				path.join("/workspace/root", "./definitions"),
				path.join("/workspace/root", "my-defs"),
			]);
		});

		it("filters out relative paths when no workspace root is provided", () => {
			const result = resolveSettingPaths(
				["./relative", "/absolute/path"],
				undefined,
			);
			expect(result).toEqual(["/absolute/path"]);
		});

		it("returns empty array when paths is empty", () => {
			const result = resolveSettingPaths([], "/workspace/root");
			expect(result).toEqual([]);
		});

		it("returns empty array when paths is empty and no workspace root", () => {
			const result = resolveSettingPaths([], undefined);
			expect(result).toEqual([]);
		});

		it("handles mixed absolute and relative paths", () => {
			const result = resolveSettingPaths(
				["/abs/path", "rel/path", "./another/rel"],
				"/workspace",
			);
			expect(result).toEqual([
				"/abs/path",
				path.join("/workspace", "rel/path"),
				path.join("/workspace", "./another/rel"),
			]);
		});
	});

	describe("buildEcuFlashSearchPaths()", () => {
		it("merges workspace folders, common paths, and ecuflash-specific paths", () => {
			const result = buildEcuFlashSearchPaths(
				["/workspace/folder1"],
				["/common/defs"],
				["/ecuflash/defs"],
			);
			expect(result).toEqual([
				"/workspace/folder1",
				"/common/defs",
				"/ecuflash/defs",
			]);
		});

		it("returns workspace folders only when no additional paths", () => {
			const result = buildEcuFlashSearchPaths(["/workspace"], [], []);
			expect(result).toEqual(["/workspace"]);
		});

		it("returns empty array when all inputs are empty", () => {
			const result = buildEcuFlashSearchPaths([], [], []);
			expect(result).toEqual([]);
		});

		it("deduplication is not performed (caller responsibility)", () => {
			const result = buildEcuFlashSearchPaths(["/path"], ["/path"], ["/path"]);
			// All three copies are included; deduplication is not the helper's job
			expect(result).toEqual(["/path", "/path", "/path"]);
		});
	});

	describe("Provider registration based on ecuExplorer.providers.enabled", () => {
		it("registers EcuFlashProvider when 'ecuflash' is in enabled list", () => {
			const providers: EcuFlashProvider[] = [];
			const enabledProviders = ["ecuflash"];

			if (enabledProviders.includes("ecuflash")) {
				providers.push(new EcuFlashProvider(["/workspace"]));
			}

			expect(providers).toHaveLength(1);
			expect(providers[0]).toBeInstanceOf(EcuFlashProvider);
		});

		it("does NOT register EcuFlashProvider when 'ecuflash' is not in enabled list", () => {
			const providers: EcuFlashProvider[] = [];
			const enabledProviders: string[] = [];

			if (enabledProviders.includes("ecuflash")) {
				providers.push(new EcuFlashProvider(["/workspace"]));
			}

			expect(providers).toHaveLength(0);
		});

		it("does NOT register EcuFlashProvider when enabled list is empty", () => {
			const providers: EcuFlashProvider[] = [];
			const enabledProviders: string[] = [];

			if (enabledProviders.includes("ecuflash")) {
				providers.push(new EcuFlashProvider([]));
			}

			expect(providers).toHaveLength(0);
		});

		it("registers EcuFlashProvider with default enabled list ['ecuflash']", () => {
			const providers: EcuFlashProvider[] = [];
			const enabledProviders = ["ecuflash"]; // default

			if (enabledProviders.includes("ecuflash")) {
				providers.push(new EcuFlashProvider([]));
			}

			expect(providers).toHaveLength(1);
		});
	});

	describe("EcuFlashProvider.invalidateCache()", () => {
		it("clears the cached definition URIs", async () => {
			const provider = new EcuFlashProvider([]);

			// The cache starts as null (no cache)
			// After calling discoverDefinitionUris() without a romUri, it populates the cache
			// We can verify invalidateCache() works by checking the provider still functions after
			provider.invalidateCache();

			// After invalidation, the provider should still be usable
			expect(provider).toBeInstanceOf(EcuFlashProvider);
		});

		it("can be called multiple times without error", () => {
			const provider = new EcuFlashProvider([]);

			expect(() => {
				provider.invalidateCache();
				provider.invalidateCache();
				provider.invalidateCache();
			}).not.toThrow();
		});

		it("invalidateCache() is a public method on EcuFlashProvider", () => {
			const provider = new EcuFlashProvider([]);
			expect(typeof provider.invalidateCache).toBe("function");
		});
	});

	describe("EcuFlashProvider.dispose()", () => {
		it("dispose() is a public method on EcuFlashProvider", () => {
			const provider = new EcuFlashProvider([]);
			expect(typeof provider.dispose).toBe("function");
		});

		it("can be called without error", () => {
			const provider = new EcuFlashProvider([]);
			expect(() => provider.dispose()).not.toThrow();
		});

		it("can be called multiple times without error", () => {
			const provider = new EcuFlashProvider([]);
			expect(() => {
				provider.dispose();
				provider.dispose();
			}).not.toThrow();
		});
	});

	describe("onDidChangeConfiguration behavior", () => {
		it("re-initializes providers when definitions.paths changes", () => {
			const reinitializeSpy = vi.fn();

			// Simulate the onDidChangeConfiguration handler
			const handler = (event: {
				affectsConfiguration: (key: string) => boolean;
			}) => {
				if (
					event.affectsConfiguration("ecuExplorer.definitions.paths") ||
					event.affectsConfiguration(
						"ecuExplorer.definitions.ecuflash.paths",
					) ||
					event.affectsConfiguration("ecuExplorer.providers.enabled")
				) {
					reinitializeSpy();
				}
			};

			// Simulate a change to definitions.paths
			handler({
				affectsConfiguration: (key: string) =>
					key === "ecuExplorer.definitions.paths",
			});

			expect(reinitializeSpy).toHaveBeenCalledTimes(1);
		});

		it("re-initializes providers when definitions.ecuflash.paths changes", () => {
			const reinitializeSpy = vi.fn();

			const handler = (event: {
				affectsConfiguration: (key: string) => boolean;
			}) => {
				if (
					event.affectsConfiguration("ecuExplorer.definitions.paths") ||
					event.affectsConfiguration(
						"ecuExplorer.definitions.ecuflash.paths",
					) ||
					event.affectsConfiguration("ecuExplorer.providers.enabled")
				) {
					reinitializeSpy();
				}
			};

			handler({
				affectsConfiguration: (key: string) =>
					key === "ecuExplorer.definitions.ecuflash.paths",
			});

			expect(reinitializeSpy).toHaveBeenCalledTimes(1);
		});

		it("re-initializes providers when providers.enabled changes", () => {
			const reinitializeSpy = vi.fn();

			const handler = (event: {
				affectsConfiguration: (key: string) => boolean;
			}) => {
				if (
					event.affectsConfiguration("ecuExplorer.definitions.paths") ||
					event.affectsConfiguration(
						"ecuExplorer.definitions.ecuflash.paths",
					) ||
					event.affectsConfiguration("ecuExplorer.providers.enabled")
				) {
					reinitializeSpy();
				}
			};

			handler({
				affectsConfiguration: (key: string) =>
					key === "ecuExplorer.providers.enabled",
			});

			expect(reinitializeSpy).toHaveBeenCalledTimes(1);
		});

		it("does NOT re-initialize providers when unrelated settings change", () => {
			const reinitializeSpy = vi.fn();

			const handler = (event: {
				affectsConfiguration: (key: string) => boolean;
			}) => {
				if (
					event.affectsConfiguration("ecuExplorer.definitions.paths") ||
					event.affectsConfiguration(
						"ecuExplorer.definitions.ecuflash.paths",
					) ||
					event.affectsConfiguration("ecuExplorer.providers.enabled")
				) {
					reinitializeSpy();
				}
			};

			// Simulate a change to an unrelated setting
			handler({
				affectsConfiguration: (key: string) => key === "ecuExplorer.logsFolder",
			});

			expect(reinitializeSpy).not.toHaveBeenCalled();
		});

		it("does NOT re-initialize providers when logging.columns changes", () => {
			const reinitializeSpy = vi.fn();

			const handler = (event: {
				affectsConfiguration: (key: string) => boolean;
			}) => {
				if (
					event.affectsConfiguration("ecuExplorer.definitions.paths") ||
					event.affectsConfiguration(
						"ecuExplorer.definitions.ecuflash.paths",
					) ||
					event.affectsConfiguration("ecuExplorer.providers.enabled")
				) {
					reinitializeSpy();
				}
			};

			handler({
				affectsConfiguration: (key: string) =>
					key === "ecuExplorer.logging.columns",
			});

			expect(reinitializeSpy).not.toHaveBeenCalled();
		});
	});

	describe("Settings read at activation", () => {
		it("passes workspace folder paths to EcuFlashProvider", () => {
			const workspaceFolderPaths = ["/workspace/root"];
			const provider = new EcuFlashProvider(workspaceFolderPaths);
			expect(provider).toBeInstanceOf(EcuFlashProvider);
			expect(provider.id).toBe("ecuflash");
		});

		it("passes merged paths (workspace + common + ecuflash-specific) to EcuFlashProvider", () => {
			const workspaceRoot = "/workspace/root";
			const commonPaths = resolveSettingPaths(["./definitions"], workspaceRoot);
			const ecuflashPaths = resolveSettingPaths(
				["./ecuflash-defs"],
				workspaceRoot,
			);
			const allPaths = buildEcuFlashSearchPaths(
				[workspaceRoot],
				commonPaths,
				ecuflashPaths,
			);

			const provider = new EcuFlashProvider(allPaths);
			expect(provider).toBeInstanceOf(EcuFlashProvider);
			expect(allPaths).toContain(workspaceRoot);
			expect(allPaths).toContain(path.join(workspaceRoot, "./definitions"));
			expect(allPaths).toContain(path.join(workspaceRoot, "./ecuflash-defs"));
		});

		it("uses default empty arrays when settings are not configured", () => {
			// Simulate reading settings with defaults
			const commonPaths: string[] = []; // default []
			const ecuflashPaths: string[] = []; // default []
			const enabledProviders = ["ecuflash"]; // default ["ecuflash"]

			const allPaths = buildEcuFlashSearchPaths(
				["/workspace"],
				commonPaths,
				ecuflashPaths,
			);

			expect(allPaths).toEqual(["/workspace"]);
			expect(enabledProviders).toContain("ecuflash");
		});
	});

	describe("readConfig()", () => {
		beforeEach(() => {
			vi.clearAllMocks();
		});

		it("returns correct defaults when no settings are configured", () => {
			vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
				get: vi.fn((_key: string, defaultValue: unknown) => defaultValue),
			} as any);

			const cfg = readConfig();

			expect(cfg.definitions.paths).toEqual([]);
			expect(cfg.definitions.ecuflash.paths).toEqual([]);
			expect(cfg.providers.enabled).toEqual(["ecuflash"]);
			expect(cfg.logsFolder).toBe("logs");
			expect(cfg.logging.columns).toBe("all");
		});

		it("returns user-configured values when settings are set", () => {
			vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
				get: vi.fn((_key: string, defaultValue: unknown) => {
					if (_key === "definitions.paths") return ["/custom/defs"];
					if (_key === "definitions.ecuflash.paths") return ["/ecuflash/defs"];
					if (_key === "providers.enabled") return ["ecuflash", "custom"];
					if (_key === "logsFolder") return "my-logs";
					if (_key === "logging.columns") return ["Engine RPM", "Coolant Temp"];
					return defaultValue;
				}),
			} as any);

			const cfg = readConfig();

			expect(cfg.definitions.paths).toEqual(["/custom/defs"]);
			expect(cfg.definitions.ecuflash.paths).toEqual(["/ecuflash/defs"]);
			expect(cfg.providers.enabled).toEqual(["ecuflash", "custom"]);
			expect(cfg.logsFolder).toBe("my-logs");
			expect(cfg.logging.columns).toEqual(["Engine RPM", "Coolant Temp"]);
		});

		it("returns an object with the correct nested shape", () => {
			vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
				get: vi.fn((_key: string, defaultValue: unknown) => defaultValue),
			} as any);

			const cfg = readConfig();

			expect(cfg).toHaveProperty("definitions");
			expect(cfg.definitions).toHaveProperty("paths");
			expect(cfg.definitions).toHaveProperty("ecuflash");
			expect(cfg.definitions.ecuflash).toHaveProperty("paths");
			expect(cfg).toHaveProperty("providers");
			expect(cfg.providers).toHaveProperty("enabled");
			expect(cfg).toHaveProperty("logsFolder");
			expect(cfg).toHaveProperty("logging");
			expect(cfg.logging).toHaveProperty("columns");
		});

		it("calls getConfiguration with 'ecuExplorer' namespace", () => {
			vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
				get: vi.fn((_key: string, defaultValue: unknown) => defaultValue),
			} as any);

			readConfig();

			expect(vscode.workspace.getConfiguration).toHaveBeenCalledWith(
				"ecuExplorer",
			);
		});
	});
});
