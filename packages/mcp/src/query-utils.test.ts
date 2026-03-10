import { describe, expect, it } from "vitest";
import {
	buildAliasedObject,
	buildFieldAliasMap,
	detectUnknownFieldFragments,
	rewriteExpressionWithAliases,
} from "./query-utils.js";

describe("query utils", () => {
	it("rewrites overlapping field names without clobbering longer names", () => {
		const { fieldToAlias } = buildFieldAliasMap(["Load", "Load Avg"], "__q_");
		const rewritten = rewriteExpressionWithAliases(
			"Load > 1.0 && Load Avg < 1.1",
			fieldToAlias,
		);

		expect(rewritten).toContain("__q_0 > 1.0");
		expect(rewritten).toContain("__q_1 < 1.1");
		expect(rewritten).not.toContain("Load Avg Avg");
	});

	it("preserves phrase-level unknown fragments with spaces", () => {
		const fragments = detectUnknownFieldFragments(
			"Engine RPm > 2500 && KnockCount > 0",
			["Engine RPM", "Knock Sum"],
		);

		expect(fragments).toEqual(["Engine RPm", "KnockCount"]);
	});

	it("builds aliased evaluation objects only for present fields", () => {
		const { fieldToAlias } = buildFieldAliasMap(["Load", "Load Avg"], "__q_");
		const aliased = buildAliasedObject({ Load: 1.2 }, fieldToAlias);

		expect(aliased).toEqual({ __q_0: 1.2 });
	});
});
