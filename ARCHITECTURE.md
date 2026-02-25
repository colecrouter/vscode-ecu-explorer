# System Architecture

This document describes the high-level system design, component interactions, and data flow for the ECU Explorer project.

## Monorepo Structure

ECU Explorer is organized as a monorepo with four main packages:

```
vscode-ecu-explorer/
├── packages/
│   ├── core/                    # Isomorphic TypeScript core
│   │   ├── src/
│   │   │   ├── binary.ts        # Binary I/O utilities
│   │   │   ├── definition/      # Definition types and providers
│   │   │   ├── view/            # TableView for reading/writing
│   │   │   └── units.ts         # Unit definitions
│   │   └── dist/                # Compiled output
│   ├── providers/
│   │   └── ecuflash/            # ECUFlash XML provider (Node.js only)
│   │       ├── src/index.ts     # Provider implementation
│   │       └── test/            # Provider tests
│   └── ui/                      # Svelte UI components (browser only)
│       ├── src/
│       │   ├── lib/
│       │   │   ├── views/       # TableGrid, TableCell, colorMap
│       │   │   └── types/       # UI type definitions
│       │   └── routes/          # SvelteKit routes
│       └── dist/                # Packaged components
└── apps/
    └── vscode/                  # VS Code extension host
        ├── src/
        │   └── extension.ts     # Extension entry point
        └── dist/                # Bundled extension
```

## Package Responsibilities

### @repo/core

**Purpose**: Isomorphic TypeScript library for types, binary I/O, and table operations.

**Key Exports**:
- [`binary.ts`](packages/core/src/binary.ts): Binary reading/writing with endianness support
- [`definition/table.ts`](packages/core/src/definition/table.ts): Table definition types (Table1D, Table2D, Table3D)
- [`definition/provider.ts`](packages/core/src/definition/provider.ts): DefinitionProvider interface
- [`view/table.ts`](packages/core/src/view/table.ts): TableView class for reading/writing table data
- [`units.ts`](packages/core/src/units.ts): Unit definitions and conversions

**Responsibilities**:
- Define normalized table schema (AxisDefinition, ZDataDefinition, TableDefinition)
- Provide binary I/O utilities (readScalar, writeScalar with endianness)
- Implement TableView for safe read/write operations with scaling
- Define DefinitionProvider interface for pluggable providers
- Export types for use by UI and extension packages

### @repo/definitions-ecuflash

**Purpose**: Node.js-only provider for discovering and parsing ECUFlash XML definitions.

**Key Exports**:
- [`index.ts`](packages/definitions/ecuflash/src/index.ts): EcuFlashProvider class

**Responsibilities**:
- Discover XML definition files from ECUFlash installation directory
- Parse XML files and extract ROM fingerprints for matching
- Merge base/child XML definitions (include resolution)
- Convert ECUFlash scaling expressions to affine transformations
- Build template index for axis and table inheritance

**Key Methods**:
- `discoverDefinitionUris()`: Find all XML files in ECUFlash directory
- `peek(definitionUri)`: Extract fingerprints without full parsing
- `parse(definitionUri)`: Full parse with include resolution and table extraction

### @repo/ui

**Purpose**: Browser-only Svelte components for table visualization and editing.

**Key Components**:

*Table Components*:
- [`TableGrid.svelte`](packages/ui/src/lib/views/TableGrid.svelte): Main table grid component
- [`TableCell.svelte`](packages/ui/src/lib/views/TableCell.svelte): Individual cell renderer
- [`table.svelte.ts`](packages/ui/src/lib/views/table.svelte.ts): Table state management
- [`table.ts`](packages/ui/src/lib/views/table.ts): Table utilities

*Chart Components*:
- [`Chart.svelte`](packages/ui/src/lib/views/Chart.svelte): Main chart visualization component
- [`ChartControls.svelte`](packages/ui/src/lib/views/ChartControls.svelte): Chart control panel
- [`ChartTooltip.svelte`](packages/ui/src/lib/views/ChartTooltip.svelte): Hover tooltip component
- [`chart.svelte.ts`](packages/ui/src/lib/views/chart.svelte.ts): Chart state management (ChartState class)
- [`chartUtils.ts`](packages/ui/src/lib/views/chartUtils.ts): Chart utilities (downsampling, formatting)

*Layout Components*:
- [`SplitView.svelte`](packages/ui/src/lib/views/SplitView.svelte): Resizable split layout

*Shared Utilities*:
- [`colorMap.ts`](packages/ui/src/lib/views/colorMap.ts): Heatmap color computation
- [`rom.svelte.ts`](packages/ui/src/lib/views/rom.svelte.ts): ROM state management

**Responsibilities**:
- Render table grids with row/column headers
- Render interactive charts (1D line plots, 2D heatmaps, 3D layer views)
- Compute heatmap colors for 2D/3D visualization
- Handle cell editing and user interactions
- Manage table and chart state with reactive updates
- Provide zoom, pan, and layer navigation controls
- Integrate chart selection with table grid
- Optimize rendering for large datasets (downsampling, debouncing)
- Provide type-safe messaging with extension host

### vscode-rom-explorer

**Purpose**: VS Code extension host managing ROM files, definitions, and webview communication.

**Key Files**:
- [`extension.ts`](apps/vscode/src/extension.ts): Extension entry point and command registration

**Responsibilities**:
- Register VS Code commands (ROM: Open, ROM: Select Definition, etc.)
- Manage ROM file loading and caching
- Coordinate definition discovery and matching
- Host webviews for table editing and visualization
- Implement type-safe messaging between host and webview
- Handle ROM saving with checksum recomputation

## Data Flow

### ROM Open → Definition Discovery → Table Display

```
User opens .hex/.bin file
    ↓
Extension reads ROM bytes into Uint8Array
    ↓
Provider.peek() extracts fingerprints (fast, no full parse)
    ↓
Fingerprint matching scores definitions by similarity
    ↓
User selects definition (or auto-matched)
    ↓
Provider.parse() loads full definition with includes
    ↓
Extension builds RomInstance { bytes, definition, dirty regions }
    ↓
Webview requests table snapshot
    ↓
TableView.readAll() decodes table data with scaling
    ↓
UI renders TableGrid with axis labels and heatmap colors
```

### Table Edit → Save → ROM Update

```
User edits cell in TableGrid
    ↓
Webview sends edit message: { r, c, newValue, mode }
    ↓
Extension receives message in CustomEditorProvider
    ↓
TableView.set() writes scaled value to ROM bytes
    ↓
Extension marks ROM as dirty, broadcasts update to all webviews
    ↓
Webview receives update patch, re-renders affected cells
    ↓
User clicks Save
    ↓
Extension recomputes checksums for dirty regions
    ↓
Extension writes ROM bytes to file
    ↓
Extension clears dirty flag
```

## Component Interactions

### Dependency Graph

```
vscode-rom-explorer (extension host)
    ├── depends on: @repo/core, @repo/definitions-ecuflash
    └── hosts webview: @repo/ui

@repo/ui (Svelte components)
    └── depends on: @repo/core

@repo/definitions-ecuflash (ECUFlash provider)
    └── depends on: @repo/core

@repo/core (types and utilities)
    └── no dependencies (isomorphic)
```

### Type-Safe Messaging

The extension and webview communicate via a type-safe messaging protocol:

**Host → Webview**:
- `init(tableSnapshot)`: Send initial table data
- `update(patch)`: Send cell updates from other editors
- `status(message)`: Send status notifications

**Webview → Host**:
- `request-init(tableName)`: Request table data
- `edit(patch)`: Send cell edits
- `apply-math(operation)`: Apply math operations (add, multiply, clamp)
- `find-replace(query)`: Find and replace values
- `save`: Trigger ROM save
- `view-graph`: Request graph visualization

## Design Patterns

### TableView Pattern

**Purpose**: Encapsulate table read/write operations with scaling and layout handling.

**Location**: [`packages/core/src/view/table.ts`](packages/core/src/view/table.ts)

**Key Methods**:
- `get(r, c, mode)`: Read cell value (raw or physical)
- `set(r, c, value, mode)`: Write cell value with scaling
- `readAll(mode)`: Read entire table as 2D array
- `readAxis(axis)`: Read axis labels with scaling
- `applyPatch(cells)`: Apply multiple edits atomically

**Benefits**:
- Encapsulates endianness, scaling, and layout complexity
- Provides consistent interface for 1D/2D/3D tables
- Supports custom indexers for non-standard layouts

### ColorMap Pattern

**Purpose**: Compute heatmap colors for table visualization.

**Location**: [`packages/ui/src/lib/views/colorMap.ts`](packages/ui/src/lib/views/colorMap.ts)

**Key Functions**:
- `computeMinMax()`: Find min/max values in matrix
- `normalizeValue()`: Map value to [0, 1] range
- `interpolateColor()`: Interpolate color at normalized position
- `computeColorMap()`: Generate color map for entire matrix

**Benefits**:
- Perceptually uniform Viridis-inspired palette
- Handles 1D/2D/3D arrays uniformly
- Supports custom scaling and offset

### Chart Visualization Pattern

**Purpose**: Interactive chart visualization for table data with zoom, pan, and cell selection in separate windows.

**Architecture**: Separate webview panels managed by GraphPanelManager (v0.7+)

**Location**: [`packages/ui/src/lib/views/`](packages/ui/src/lib/views/) and [`apps/vscode/src/`](apps/vscode/src/)

**Key Components**:

1. **GraphPanelManager** ([`apps/vscode/src/graph-panel-manager.ts`](apps/vscode/src/graph-panel-manager.ts))
   - Manages lifecycle of graph webview panels
   - Tracks panels per ROM + table (nested Maps)
   - Broadcasts snapshot updates to relevant panels
   - Synchronizes cell selection between graph and table
   - Handles panel disposal and cleanup
   - Provides panel registry for lookup

2. **GraphPanelSerializer** ([`apps/vscode/src/graph-panel-serializer.ts`](apps/vscode/src/graph-panel-serializer.ts))
   - Implements WebviewPanelSerializer for persistence
   - Restores graph panels after VSCode reload
   - Deserializes saved state (romPath, tableId, tableName)
   - Reloads ROM document and table snapshot
   - Re-registers restored panels with GraphPanelManager

3. **ChartViewerApp** ([`apps/vscode/src/webview/ChartViewerApp.svelte`](apps/vscode/src/webview/ChartViewerApp.svelte))
   - Standalone chart viewer webview (separate from table editor)
   - Receives table snapshots via postMessage
   - Sends cell selection events to extension host
   - Persists state for VSCode reload
   - Uses ChartState and Chart components

4. **ChartState Class** ([`packages/ui/src/lib/views/chart.svelte.ts`](packages/ui/src/lib/views/chart.svelte.ts))
   - Manages chart state (zoom, pan, layer, chart type)
   - Converts table snapshots to chart data
   - Handles user interactions (zoom, pan, layer navigation)
   - Provides reactive state updates via Svelte runes

5. **Chart Component** ([`packages/ui/src/lib/views/Chart.svelte`](packages/ui/src/lib/views/Chart.svelte))
   - Renders charts using Plotly.js (lazy loaded)
   - Supports 1D line plots, 2D heatmaps, 3D layer views
   - Canvas rendering for performance
   - Click-to-select cell integration
   - Hover tooltips with axis and value information

6. **ChartControls Component** ([`ChartControls.svelte`](packages/ui/src/lib/views/ChartControls.svelte))
   - Zoom controls (in/out/reset)
   - Pan controls (directional arrows)
   - Layer selector for 3D tables
   - View options (grid, tooltips)
   - Keyboard shortcut support

7. **ChartTooltip Component** ([`ChartTooltip.svelte`](packages/ui/src/lib/views/ChartTooltip.svelte))
   - Displays hover information
   - Shows X/Y axis values with labels
   - Shows Z value (data value) with formatting
   - Smooth fade in/out transitions

**Key Utilities** ([`chartUtils.ts`](packages/ui/src/lib/views/chartUtils.ts)):
- `downsampleData()`: Largest-triangle-three-buckets (LTTB) algorithm for large datasets
- `formatAxisValue()`: Format axis values with appropriate precision
- `debounce()`: Debounce function for performance optimization

**Benefits**:
- **Separate Windows**: Graphs open in independent VSCode panels
- **Multi-Monitor Support**: Place graphs on secondary displays
- **Multiple Graphs**: View graphs from different tables simultaneously
- **Automatic Synchronization**: Real-time updates on cell edits
- **Bidirectional Selection**: Click in graph selects cell in table
- **Persistence**: Graph windows survive VSCode reloads
- **Better Screen Utilization**: Full table editor space + separate graph windows
- **Performance Isolation**: Chart rendering doesn't block table editing
- Interactive exploration of table data
- Performance optimized for large datasets (>10,000 points)
- Keyboard-accessible controls
- Lazy loading of Plotly.js for fast initial load

**Webview Architecture**:
- **Dual Bundle Build**: Separate bundles for table editor and chart viewer
  - `table.js`: Table editor webview ([`TableApp.svelte`](apps/vscode/src/webview/TableApp.svelte))
  - `chart.js`: Chart viewer webview ([`ChartViewerApp.svelte`](apps/vscode/src/webview/ChartViewerApp.svelte))
- **Message Protocol**: Extension host communicates with both webviews via postMessage
- **Panel Lifecycle**: GraphPanelManager tracks and manages all graph panels
- **State Synchronization**: Snapshot updates broadcast to all relevant panels

**Performance Optimizations**:
- Downsampling for datasets >10,000 points
- Debounced updates (100ms) to prevent excessive redraws
- Canvas rendering instead of SVG
- Lazy loading of Plotly.js library
- Efficient state management with Svelte runes
- Separate webview processes for table and chart (isolation)

### MCP Context Tracking Pattern

**Purpose**: Provide the MCP server with real-time context about which ROMs and tables are currently open in VS Code, enabling LLMs to understand the user's current work state.

**Location**:
- VS Code Extension: [`apps/vscode/src/open-context-tracker.ts`](apps/vscode/src/open-context-tracker.ts)
- MCP Server: [`packages/mcp/src/context-ipc.ts`](packages/mcp/src/context-ipc.ts)
- Integration: [`apps/vscode/src/mcp-provider.ts`](apps/vscode/src/mcp-provider.ts)

**Architecture**:

1. **OpenContextTracker** ([`apps/vscode/src/open-context-tracker.ts`](apps/vscode/src/open-context-tracker.ts))
   - Tracks lifecycle of open ROM and table documents via `addRomDocument()` and `addTableDocument()` methods
   - Monitors changes via document event listeners (`onDidChange`, `onDidDispose`)
   - Debounces context updates (100ms) to minimize overhead
   - Maintains two Maps: `roms` (URI → OpenRomState) and `tables` (URI → OpenTableState)
   - Provides `onContextUpdate()` subscription for listeners to react to context changes
   - Manages focus timestamps (`setRomFocused()`, `setTableFocused()`)

2. **Context Data Model**:
   - **OpenRomState**: Captures ROM metadata (URI, file path, name, size, definition, dirty state, editor count, focus timestamp)
   - **OpenTableState**: Captures table metadata (URI, table ID, parent ROM path, kind/dimensions, unit, definition URI, editor count, focus timestamp)
   - **OpenDocumentsContext**: Versioned container with timestamp, array of open ROMs, and array of open tables

3. **IPC Transport** ([`packages/mcp/src/context-ipc.ts`](packages/mcp/src/context-ipc.ts))
   - Extension sends context updates as JSON on stdin: `{"type": "context-update", "data": {...}}`
   - MCP server's `setupContextIpc()` hooks into stdin and parses JSON messages
   - Gracefully ignores non-JSON or non-context-update messages (MCP protocol operates on same stdin)
   - Callback handler receives parsed context data for storage and tool access

4. **Integration** ([`apps/vscode/src/mcp-provider.ts`](apps/vscode/src/mcp-provider.ts))
   - MCP provider instantiates `OpenContextTracker` on extension activation
   - Subscribes to context updates via `tracker.onContextUpdate()`
   - Sends updates to MCP server process via stdin as JSON lines

**Benefits**:
- **LLM Awareness**: MCP tools can query which files/tables are in focus without re-parsing
- **Context Awareness**: LLMs understand the user's current editing context
- **Efficient Updates**: Debouncing prevents excessive IPC traffic
- **Real-Time Sync**: Context automatically stays current with VS Code editor state
- **Tool Integration**: MCP tools can provide context-aware suggestions based on open documents

**Data Flow**:
```
ROM/Table opened in VS Code
    ↓
Document event caught by tracker
    ↓
Context state updated (Maps)
    ↓
Debounce timer initiates
    ↓
After 100ms silence, emitContextUpdate() called
    ↓
Listeners notified with OpenDocumentsContext
    ↓
mcp-provider sends JSON to MCP server stdin
    ↓
MCP server's setupContextIpc() parses message
    ↓
Context stored in memory for tool access
```

**Example Context Update Message**:
```json
{
  "type": "context-update",
  "data": {
    "version": 1,
    "timestamp": "2026-02-23T23:18:00.000Z",
    "roms": [
      {
        "uri": "file:///path/to/rom.bin",
        "path": "/path/to/rom.bin",
        "name": "rom.bin",
        "sizeBytes": 1048576,
        "definition": {
          "name": "2011 Lancer Evo X",
          "uri": "file:///path/to/definitions/evo-x.xml"
        },
        "isDirty": true,
        "activeEditors": 1,
        "lastFocusedAt": "2026-02-23T23:18:00.000Z"
      }
    ],
    "tables": [
      {
        "uri": "ecu-rom://table/fuel...",
        "tableId": "fuel-table",
        "romPath": "/path/to/rom.bin",
        "romUri": "file:///path/to/rom.bin",
        "kind": "table2d",
        "dimensions": { "rows": 16, "cols": 16 },
        "unit": "mg/stroke",
        "definitionUri": "file:///path/to/definitions/evo-x.xml",
        "activeEditors": 1,
        "lastFocusedAt": "2026-02-23T23:17:55.000Z"
      }
    ]
  }
}
```

### DefinitionProvider Interface

**Purpose**: Pluggable provider system for different definition formats.

**Location**: [`packages/core/src/definition/provider.ts`](packages/core/src/definition/provider.ts)

**Key Methods**:
- `discoverDefinitionUris()`: Find available definitions
- `peek(uri)`: Extract fingerprints for matching
- `parse(uri)`: Full parse to ROMDefinition

**Benefits**:
- Extensible to support TunerPro, WinOLS, etc.
- Separates discovery from parsing for performance
- Enables fingerprint-based matching

### Webview Messaging Pattern

**Purpose**: Type-safe communication between extension host and webview.

**Key Principles**:
- All messages are typed and validated
- Bidirectional: host can push updates, webview can request data
- Supports multiple webviews bound to same table
- Broadcasts updates to all connected clients

**Benefits**:
- Prevents runtime errors from message mismatches
- Enables reactive updates across multiple editors
- Supports collaborative editing scenarios

## Key Interfaces and Contracts

### Table Definition Types

```typescript
// From packages/core/src/definition/table.ts

interface AxisDefinition {
  kind: "static" | "dynamic";
  name: string;
  unit?: Unit;
  // dynamic: address, length, dtype, scale, offset
  // static: values[]
}

interface ZDataDefinition {
  address: number;
  dtype: ScalarType;  // u8, i8, u16, i16, u32, i32, f32
  endianness?: "le" | "be";
  scale?: number;
  offset?: number;
  rowStrideBytes?: number;
  colStrideBytes?: number;
  indexer?: (r: number, c: number) => number;
}

type TableDefinition = Table1DDefinition | Table2DDefinition | Table3DDefinition;

interface Table1DDefinition {
  kind: "table1d";
  name: string;
  rows: number;
  z: ZDataDefinition;
  x?: AxisDefinition;  // optional axis labels
}

interface Table2DDefinition {
  kind: "table2d";
  name: string;
  rows: number;
  cols: number;
  x?: AxisDefinition;  // column axis
  y?: AxisDefinition;  // row axis
  z: ZDataDefinition;
}
```

### ROM Definition

```typescript
interface ROMDefinition {
  uri: string;
  name: string;
  fingerprints: ROMFingerprint[];
  platform: {
    make?: string;
    model?: string;
    year?: number;
    // ...
  };
  tables: TableDefinition[];
}

interface ROMFingerprint {
  reads: { address: number; length: number }[];
  expectedHex: string[];
  description: string;
}
```

### Provider Interface

```typescript
interface ROMDefinitionProvider {
  id: string;
  label: string;
  discoverDefinitionUris(): Promise<string[]>;
  peek(definitionUri: string): Promise<ROMDefinitionStub>;
  parse(definitionUri: string): Promise<ROMDefinition>;
}
```

## Technology Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Extension Host** | VS Code API | Extension lifecycle, commands, webviews |
| **Extension Bundler** | esbuild | Bundle extension for distribution |
| **Core Library** | TypeScript | Type-safe binary I/O and table operations |
| **XML Parsing** | fast-xml-parser | Parse ECUFlash XML definitions |
| **Expression Evaluation** | expr-eval | Safely evaluate scaling expressions |
| **UI Framework** | Svelte 5 | Reactive components for table grid |
| **UI Bundler** | Vite + SvelteKit | Bundle UI components for webview |
| **Visualization** | Plotly.js | 3D surface plots and heatmaps |
| **Testing** | Vitest | Unit and integration tests |
| **Type Checking** | TypeScript | Static type safety |
| **Linting** | Biome | Code quality and formatting |

## Performance Considerations

### Lazy Loading

- Definitions are peeked (fingerprints only) before full parse
- Tables are loaded on-demand when user opens them
- Axis values are cached after first read

### Virtualization

- Large tables use virtualized grid rendering
- Only visible rows/columns are rendered in DOM
- Scrolling updates visible range efficiently

### Debouncing

- Graph re-renders are debounced during rapid edits
- Color map computation is cached when data unchanged
- Status updates are throttled to prevent excessive renders

### Memory Management

- ROM bytes stored as single Uint8Array (shared buffer)
- Table snapshots are shallow copies of metadata
- Patches are applied in-place to ROM bytes

## Extension Points

### Adding a New Provider

1. Implement `ROMDefinitionProvider` interface
2. Register in extension's provider registry
3. Add to `romViewer.providers.enabled` setting

### Adding a New Table Type

1. Extend `TableDefinition` union type
2. Update `TableView` to handle new layout
3. Add UI component for visualization

### Adding a New Scaling Expression

1. Update `tryParseAffineToExpr()` in ECUFlash provider
2. Add test cases for new expression format
3. Document in [`specs/TABLE_SCHEMA.md`](specs/TABLE_SCHEMA.md)

## Testing Patterns

### Windows Path Compatibility
To ensure tests pass on both Unix-like and Windows systems, use the `normalizePath` utility pattern when comparing file paths or URIs:

```typescript
function normalizePath(p: string): string {
    return p.replace(/\\/g, "/");
}

// Usage in tests
expect(normalizePath(uri.fsPath)).toBe(normalizePath(expectedPath));
```

This handles the discrepancy between backslashes (`\`) used by Windows and forward slashes (`/`) used by URI schemes and Unix-like systems.

## Checksum Implementation Details

### Mitsubishi CAN (mitsucan)
The `mitsucan` algorithm used in many Mitsubishi ECUs (like the Evo X) is a **32-bit big-endian word sum** over the entire 1MB ROM.
- **Range**: `0x000000` to `0x0FFFFF`
- **Fixup Address**: `0x0BFFF0` (4 bytes, big-endian)
- **Target Sum**: `0x5AA55AA5`
- **Implementation**: [`packages/core/src/checksum/algorithms.ts`](packages/core/src/checksum/algorithms.ts)

## Design Patterns

- **Provider pattern**: Pluggable definition providers
- **Message passing**: Host ↔ webview communication
- **Snapshot pattern**: Immutable table snapshots
- **Discriminated unions**: Type-safe message handling

## Related Documentation

- **Setup Guide**: [`SETUP.md`](SETUP.md) - Development environment and build procedures
- **Table Schema**: [`specs/TABLE_SCHEMA.md`](specs/TABLE_SCHEMA.md) - XML definition format and table structure
- **Testing Guide**: [`specs/TESTING.md`](specs/TESTING.md) - Testing guidelines and patterns
- **Development Plan**: [`DEVELOPMENT.md`](DEVELOPMENT.md) - Roadmap and feature planning
