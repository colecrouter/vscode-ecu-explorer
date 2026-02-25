# DEVELOPMENT

> [!IMPORTANT]
> This list serves only as a pre-development checklist of MVP features. For all new features, improvements, and bug fixes, please refer to the [GitHub Issues](https://github.com/colecrouter/ecu-explorer/issues)

## Feature Progress Tracking

### v1 - ⏳

**Target**: Major release

- [x] Table editing hotkeys for ranges (=, +, -, *, /)
- [ ] Table navigation hotkeys
- [x] Fix event capturing for table interactions (currently most events are captured by input element) (handlers should ideally exist at the document level?)
- [x] Remove tracked state from graphs (currently interaction is broken)
- [x] Migrate graphs to commands w/ context-aware graph types (including 3D graph)
- [ ] Explore tree-shaking plotly
- [x] Logs integration
- [x] USB device support
- [x] "Open Graph" opens wrong graph, should open graph for active table/doc
- [ ] ROM flash/readback via OpenPort 2.0
- [x] MCP tools integration
- [x] Mark edited tables with Git-like indicators in tree view
- [x] Workspace settings (definition folders, provider config) - **Completed 2026-02-22**
- [x] Table variants grouping (fuel/ignition, etc.)
- [x] Tables show in command palette
- [x] Tables open the same in tree vs command palette (title bar is currently different)
- [x] Opening table should open existing editor if already open (currently opens new editor)
- [x] Opening table in tree view should attempt to open "temp" editor
- [x] Remove debug logging
- [x] Ensure all component tests properly mount a component via browser testing
- [x] Substitute mocking with package or other solution, remove/refactor useless tests
- [x] Implement mitsucan checksum algorithm for Mitsubishi ROMs
- [x] Fix Windows path compatibility in tests
- [x] Fix EcuFlash checksum logic
- [x] Narrow cell width (rounded values in input elements?)
- [x] Standardize naming to "ECU Explorer" throughout codebase
- [x] ROM write diffs before flashing
- [x] Math operations don't undo (flashes undo but then immediately reverted, then undo stack is broken)
- [x] Cross-reference RomRaider code, make sure we support all the same vehicle models (Subaru), and include a comprehensive list of models/ECUs in the README for clarity on what is supported
- [x] Port Subaru/Denso ROM checksum and SSM protocol checksum algorithms from RomRaider
- [x] Port Nissan ROM checksum algorithms from RomRaider (`nissan-std`, `nissan-alt`, `nissan-alt2`, `ncsChecksum`, `ncsCrc16`)
- [x] Callbacks for all ECU operations (read/write) for progress reporting, error handling, etc.
- [x] MCP `read_table` and `patch_table` incorrect table name should search for close matches and suggest alternatives instead of just erroring
- [x] Provide MCP context as to which ROMs/tables are open by the user
- [x] Need to update tables/graphs when MCP edits are made, currently only updates when user edits in the UI
- [x] Units in table headers
- [x] Fix CSS variable usage
- [x] CSS-based text contrast in table cells - **Completed 2026-02-24**
- [ ] Remove per-test mock resets (mocks should be reset by Vitest config already), document this pattern
- [ ] Standardize mocks across tests, remove redundant mocks, document this pattern
- [x] Document that `patch_table` rounds to nearest value, otherwise LLMs panic when 42 becomes 41.9
- [ ] Document that the test ROM is _not_ Intel hex, it's raw binary
- [ ] Subaru seed-key algorithm(?) what does this mean? SSMKO, SSMK1, SSMK2, SSMK3, SSMK4, SSMK5, SSMCANO, SSMCAN1 (default), SSMCAN2, SSMCAN3, SSMCAN4, SSMCAN5, SSMCAN9
- [ ] Checksum module: "subarudbw" "subarudiesel" "subaruhitachi" "mitsucan" "mitsuh8"
- [ ] Flashing tool: "wrx02", "wrx04", "sti04", "sti05", "mitsucan", "mitsukernel", "mitsukernelocp", "mitsubootloader", "shbootmode", "shaudmode", "subarucan", "subarucand", "subarubrz", "subaruhitachi", 
- [ ] Extract proper device support tables from EcuFlash and RomRaider
- [ ] Revisit `list_tables` (how will LLM know categories?)

**Status**: In Progress

**Related specs**:

- [`specs/logging.md`](specs/logging.md) - Logging design specification

---

### v1.x - [0/4 complete] ❌

- [ ] Advanced search and filtering
- [ ] Ensure maximum Svelte integration with UI components and state management (for performance)
- [ ] Make UI have no direct VSCode dependencies
- [ ] Advanced expressions for math operations (TODO research best approach)
- [ ] Type-safe message types, for exhaustive handling in webview and host
- [ ] Fix all remaining linting warnings across the repo, document this pattern
**Status**: Not started

**Dependencies**:

- v1 must be complete
- External dependencies (OpenPort 2.0, MCP)

**Related specs**:

- [`specs/KNOWN_ISSUES.md`](specs/KNOWN_ISSUES.md) - No logging integration
---

### v2+ - [0/2 complete] ❌

- [ ] Additional providers (TunerPro, WinOLS)
- [ ] DTC code reading

**Status**: Not started

**Dependencies**:

- v1 must be complete
- Provider implementations

**Related specs**:

- [`specs/PROVIDER_GUIDE.md`](specs/PROVIDER_GUIDE.md) - How to implement new providers
