import { describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import TableCell from "../src/lib/views/TableCell.svelte";

describe("TableCell Component", () => {
	const bytes = new Uint8Array([42]);

	it("renders formatted text in navigation mode", async () => {
		const screen = render(TableCell, {
			bytes,
			dtype: "u8",
			scale: 1,
			offset: 0,
			isActive: true,
			isEditing: false,
		});

		const display = screen.getByText("42");
		await expect.element(display).toBeVisible();
		expect(screen.queryByRole("spinbutton")).toBeNull();
	});

	it("renders an input in edit mode", async () => {
		const screen = render(TableCell, {
			bytes,
			dtype: "u8",
			scale: 1,
			offset: 0,
			isEditing: true,
		});

		const input = screen.getByRole("spinbutton");
		await expect.element(input).toHaveValue(42);
	});

	it("seeds the edit draft when editSeed is provided", async () => {
		const screen = render(TableCell, {
			bytes,
			dtype: "u8",
			scale: 1,
			offset: 0,
			isEditing: true,
			editSeed: "7",
		});

		const input = screen.getByRole("spinbutton");
		await expect.element(input).toHaveValue(7);
	});

	it("commits value on Enter in edit mode", async () => {
		const onCommit = vi.fn();
		const screen = render(TableCell, {
			bytes,
			dtype: "u8",
			scale: 1,
			offset: 0,
			isEditing: true,
			oncommit: onCommit,
		});

		const input = screen.getByRole("spinbutton");
		await input.click();
		await input.fill("50");
		await userEvent.keyboard("{Enter}");

		expect(onCommit).toHaveBeenCalledTimes(1);
	});

	it("cancels edit on Escape", async () => {
		const onCancel = vi.fn();
		const screen = render(TableCell, {
			bytes,
			dtype: "u8",
			scale: 1,
			offset: 0,
			isEditing: true,
			oncancel: onCancel,
		});

		const input = screen.getByRole("spinbutton");
		await input.click();
		await input.fill("12");
		await userEvent.keyboard("{Escape}");

		expect(onCancel).toHaveBeenCalledTimes(1);
	});

	it("shows validation error for out of range values", async () => {
		const screen = render(TableCell, {
			bytes,
			dtype: "u8",
			scale: 1,
			offset: 0,
			isEditing: true,
		});

		const input = screen.getByRole("spinbutton");
		await input.fill("300");

		const error = screen.getByText(/out of range/i);
		await expect.element(error).toBeVisible();
	});
});
