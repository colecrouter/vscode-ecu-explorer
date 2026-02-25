# Feature Comparison Matrix

High-level feature overview across vehicle platforms and implementation status.

---

## Feature Summary by Vehicle

### Mitsubishi (EVO X / 4B11T)

| Feature | Method | Status | Details |
|---------|--------|--------|---------|
| **ROM Identification** | Fingerprint matching | ✅ | Auto-detect via ROM header |
| **ROM Read** | UDS (0x23) or Bootloader | ✅ | 1 MB read in ~2-5 minutes |
| **ROM Write** | Bootloader recommended* | ✅ | Sector-by-sector flashing |
| **Real-Time Engine Data** | RAX blocks (K-line) | ⏳ | 48 parameters; awaiting K-line testing |
| **Checksum Update** | Mitsucan autocompute | ✅ | Automatic on save |
| **Graph Visualization** | Heat map / 3D surface | ✅ | Heatmap and 3D rendering |
| **Parameter Export** | CSV 1D/2D/3D | ✅ | Wide format with units |
| **Table Editing** | Grid + validation | ✅ | Full keyboard support + math ops |
| **Math Operations** | Add/×/clamp/smooth/interpolate | ✅ | 5 operations on selection |
| **Undo/Redo** | Transaction support | ✅ | Full history with checksum sync |
| **Workspace Settings** | Definition paths, provider config | ✅ | Per-workspace configuration |
| **MCP Integration** | Stdio transport | ✅ | 5 tools for LLM access |

*MUT-III ROM write blocked on unknown write-session key; use Bootloader method instead.

---

### Subaru (WRX/STI/Forester)

| Feature | Method | Status | Details |
|---------|--------|--------|---------|
| **ROM Identification** | Fingerprint matching | ✅ | Auto-detect via ROM header |
| **ROM Read** | KWP2000 (S-box auth) | ✅ | 1 MB read in ~2-5 minutes |
| **ROM Write** | KWP2000 erase + download | ✅ | Sector-by-sector flashing |
| **Real-Time Engine Data** | SSM protocol (K-line) | ⏳ | OBD-II support; K-line parameters ready |
| **Real-Time Transmission Data** | SST blocks (K-line) | ⏳ | 100+ parameters; awaiting K-line testing |
| **Checksum Update** | Subaru/Denso autocompute | ✅ | Automatic on save |
| **Graph Visualization** | Heat map / 3D surface | ✅ | Same as Mitsubishi |
| **Parameter Export** | CSV 1D/2D/3D | ✅ | Wide format with units |
| **Table Editing** | Grid + validation | ✅ | Full keyboard support + math ops |
| **Math Operations** | Add/×/clamp/smooth/interpolate | ✅ | Same as Mitsubishi |
| **Undo/Redo** | Transaction support | ✅ | Same as Mitsubishi |
| **Workspace Settings** | Definition paths, provider config | ✅ | Same as Mitsubishi |
| **MCP Integration** | Stdio transport | ✅ | Same as Mitsubishi |

---

### OBD-II (Generic, Any Vehicle)

| Feature | Method | Status | Details |
|---------|--------|--------|---------|
| **ROM Identification** | N/A | ❌ | OBD-II doesn't allow ROM access |
| **ROM Read** | N/A | ❌ | Not in OBD-II standard |
| **ROM Write** | N/A | ❌ | Not in OBD-II standard |
| **Real-Time Data** | Standard Mode 01 PIDs | ✅ | 8 core parameters (RPM, speed, temps) |
| **Checksum Update** | N/A | ❌ | N/A (ROM not accessible) |
| **Graph Visualization** | Charts / trends | ✅ | Live data plotting |
| **Parameter Export** | CSV (wide format) | ✅ | Timestamp + 8 PIDs |
| **Table Editing** | N/A | ❌ | No ROM = no tables |
| **Math Operations** | N/A | ❌ | N/A |
| **Undo/Redo** | N/A | ❌ | N/A |
| **Workspace Settings** | Basic config | ✅ | Log folder + column filtering |
| **MCP Integration** | Via log querying | ⏳ | Read-only log analysis |

---

## Capability Comparison Table

| Capability | Mitsubishi | Subaru | OBD-II | Notes |
|------------|------------|--------|--------|-------|
| **ROM Operations** | ✅ Full | ✅ Full | ❌ None | Mitsubishi write blocked on algorithm |
| **Real-Time Logging** | ⏳ 48 params | ⏳ 100+ params | ✅ 8 PIDs | K-line transport is blocker for Mitsu/Subaru |
| **Data Visualization** | ✅ Full | ✅ Full | ✅ Partial | 3D graphs for Mitsu/Subaru; charts for OBD-II |
| **CSV Export** | ✅ Full | ✅ Full | ✅ Full | Wide format across all |
| **Math Operations** | ✅ Yes | ✅ Yes | ❌ No | ROM editing feature |
| **Checksum Protection** | ✅ Yes | ✅ Yes | ❌ N/A | Auto-fix on save |
| **Multi-Device** | ✅ Yes | ✅ Yes | ✅ Yes | Via DeviceManager |
| **Hardware Support** | ✅ OpenPort 2.0 | ✅ OpenPort 2.0 | ✅ OpenPort 2.0 | CAN; K-line pending |

---

## Feature Status by Category

### ROM Operations (Editing & Flashing)

| Feature | Mitsbishi | Subaru | Status |
|---------|-----------|--------|--------|
| **Read (CAN)** | ✅ UDS 0x23 | ✅ KWP2000 | Complete for both |
| **Read (K-Line)** | ⏳ Not prioritized | ⏳ Not prioritized | Optional |
| **Write (CAN)** | ❌ Unknown key | ✅ KWP2000 | Works for Subaru; blocker for Mitsu |
| **Write (Bootloader)** | ✅ 0x55 handshake | N/A | Only for EVO X |
| **Checksum Compute** | ✅ Mitsucan | ✅ Subaru/Denso | Both implemented |
| **Sector Erase** | ✅ Computed delta | ✅ Computed delta | Both optimized |
| **Write Verification** | ✅ Yes | ✅ Yes | Both verify |

### Real-Time Data Streaming

| Feature | Mitsubishi | Subaru | OBD-II | Notes |
|---------|------------|--------|--------|-------|
| **Parameter Registry** | ✅ 48 defined | ✅ 100+ defined | ✅ 8 standard | OBD-II complete; others await K-line |
| **Bit Extraction** | ✅ Tools ready | ✅ Tools ready | ✅ No bits | OBD-II uses standard decoding |
| **Live Streaming** | ⏳ Ready | ⏳ Ready | ✅ Works | K-line blocks Mitsu/Subaru |
| **CSV Logging** | ✅ Infrastructure | ✅ Infrastructure | ✅ Infrastructure | All use same generic logger |
| **Real-Time UI** | ✅ Grid display | ✅ Grid display | ✅ Grid display | All have live data panel |
| **Performance** | ~5-20 Hz | ~5-20 Hz | ~1-10 Hz | K-line slower due to baud rate |

### Data Analysis & Visualization

| Feature | Mitsubishi | Subaru | OBD-II | Common |
|---------|------------|--------|--------|--------|
| **Heatmap** | ✅ Full 2D | ✅ Full 2D | ⏳ Future | For calibration tables |
| **3D Surface** | ✅ Full 3D | ✅ Full 3D | N/A | For 3D fuel/timing maps |
| **CSV Export** | ✅ All formats | ✅ All formats | ✅ Wide | Unified format |
| **CSV Import** | ✅ All formats | ✅ All formats | ✅ Wide | Roundtrip support |
| **Graph Panels** | ✅ Yes | ✅ Yes | ✅ Yes | Real-time + export |
| **Table Diff** | ⏳ Planned | ⏳ Planned | N/A | v1.x feature |
| **Comparison View** | ⏳ Planned | ⏳ Planned | N/A | v1.x feature |

### Table Editing & Safety

| Feature | Mitsubishi | Subaru | OBD-II | Status |
|---------|------------|--------|--------|--------|
| **Multi-Cell Select** | ✅ Mouse + KB | ✅ Mouse + KB | ❌ N/A | ROM-only feature |
| **Math Operations** | ✅ 5 ops | ✅ 5 ops | ❌ N/A | ROM-only feature |
| **Range Validation** | ✅ Yes | ✅ Yes | ❌ N/A | ROM-only feature |
| **Data Type Checking** | ✅ Yes | ✅ Yes | ❌ N/A | ROM-only feature |
| **Undo/Redo** | ✅ Full | ✅ Full | ❌ N/A | ROM-only feature |
| **Clipboard (Copy/Cut)** | ✅ TSV | ✅ TSV | ❌ N/A | ROM-only feature |
| **Axis Editing** | ❌ Locked | ❌ Locked | ❌ N/A | v1 feature (validation pending) |
| **Scalar Editing** | ✅ Limited | ✅ Limited | ❌ N/A | ROM-only feature |

### Developer Integration

| Feature | Support | Status | Details |
|---------|---------|--------|---------|
| **MCP Server** | ✅ Yes | ✅ Complete | 5 tools: list_tables, process_table, rom_info, list_logs, query_logs |
| **Context Tracking** | ✅ Yes | ✅ Complete | Real-time awareness of open ROMs/tables |
| **Stdio Transport** | ✅ Yes | ✅ Complete | MCP server runs standalone; Python/Node can hook it |
| **Settings API** | ✅ Yes | ✅ Complete | Workspace-aware definition paths + provider config |
| **Extension API** | N/A | ⏳ Future | Hooks for custom providers/protocols |

---

## Protocol Support Reference

| Protocol | Vehicle(s) | ROM | Real-Time | Transport | Status |
|----------|------------|-----|-----------|-----------|--------|
| **UDS (MUT-III)** | Mitsubishi | ✅ Read | ⏳ 48 params | CAN + K-line* | Partial |
| **Bootloader** | Mitsubishi | ✅ R/W | ❌ | CAN | Complete |
| **KWP2000** | Subaru | ✅ R/W | ⏳ SST | CAN + K-line* | Partial |
| **OBD-II** | Any OBD-II | ❌ | ✅ 8 PIDs | CAN | Complete |
| **NCS K-line** | Nissan (older) | ❌ | ❌ | K-line* | Not Started |

*K-line transport in Phase 2/3 testing
