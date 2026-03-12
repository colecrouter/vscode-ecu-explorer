# Undo/Redo Redesign Plan

## Objective

Replace the current split undo/redo behavior with a host-authoritative, type-safe system that is reusable outside the VS Code extension.

Primary outcomes:

- one authoritative history per table session
- no duplicated undo/redo execution paths
- save-point and dirty-state behavior centralized in one place
- pure history core reusable without VS Code APIs

## Design Direction

- Use a `Map<TableSessionId, TableEditSession>` for the authoritative session registry.
- Do not use `WeakMap` for the primary registry because the system needs enumeration for save-point fanout, active-session routing, and deterministic cleanup.
- Keep the history core independent of VS Code APIs.
- Put the pure history engine in shared code and keep VS Code-specific execution, document updates, and webview routing in `apps/vscode`.

## Work Breakdown

1. Extract a pure history core
2. Add execution interfaces and VS Code adapters
3. Introduce host-side table sessions
4. Route all host undo/redo through sessions
5. Remove webview-owned committed history
6. Migrate edit producers to typed transactions
7. Centralize save-point and dirty-state handling
8. Add seam-focused tests and remove duplicate-path regressions

## Step 1

Create a pure shared history module with:

- `Edit`
- `EditTransaction`
- `HistoryState`
- `HistoryStack`
- save-point tracking
- bounded history support

This layer must not depend on `vscode`, `RomDocument`, or webview APIs.

Commit boundary:

- shared history types and implementation exist
- exported for reuse
- covered by unit tests

## Step 2

Add an execution contract and VS Code adapter:

- pure executor interface for apply/revert
- VS Code adapter that applies bytes to ROM data and updates `RomDocument`
- dirty-state and save-point semantics live here

Commit boundary:

- execution adapter exists
- pure core remains VS Code-free

## Step 3

Introduce `TableSessionId` and `TableEditSession` in `apps/vscode`:

- owns table definition, ROM/document references, panel sink, and history
- session registry uses `Map`
- optional reverse lookup may use `WeakMap<object, TableSessionId>`

Commit boundary:

- sessions exist but old undo/redo paths may still remain

## Step 4

Replace duplicated host undo/redo logic:

- `extension.ts`
- `handlers/table-handler.ts`
- `commands/edit-commands.ts`

All entry points call session methods instead of replaying bytes inline.

Commit boundary:

- one host undo path
- one host redo path

## Step 5

Make the webview a thin client for committed history:

- stop using `TableView.undo()` and `TableView.redo()` as the authoritative path
- webview sends intent only
- host sends back authoritative updates

Commit boundary:

- no client-first committed undo/redo

## Step 6

Convert edit producers to typed transactions:

- cell edits
- math operations
- CSV import
- future batch operations

Commit boundary:

- all committed edits enter history as typed transactions

## Step 7

Centralize save-point behavior:

- save marks the current history state
- undo to save point clears dirty
- redo away from save point marks dirty
- all open sessions for the saved ROM receive save-point updates

Commit boundary:

- save-point behavior is session-driven, not manager-driven

## Step 8

Add tests around the real failure seams:

- no double undo
- active-tab routing correctness
- save-point correctness
- batch transaction behavior
- graph and table update sync

Commit boundary:

- host/webview drift regressions are covered by integration tests
