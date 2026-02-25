# Quickstart Guide

Below contains instructions and example files to get you started with ECU Explorer for tuning and analysis.

## Files

- [**`56890009_2011_USDM_5MT.hex`** - 2011 Mitsubishi Lancer Evolution X (4B11T, 5MT)](https://norcalmotorsports.org/users/bryan/mods/EVO/tech/ROMs/Evo10/56890009_2011_USDM_5MT.hex)
- [**`56890009 2011 USDM Lancer Evolution X 5MT.xml`** - ECUFlash definition for EVO X 5MT](https://raw.githubusercontent.com/ripnet/evo/refs/heads/master/ROM-XMLs/56890009%202011%20USDM%20Lancer%20Evolution%20X%205MT.xml)
- [**`evo10base.xml`** - Base definition for Mitsubishi Lancer Evolution X platform](https://raw.githubusercontent.com/ripnet/evo/refs/heads/master/ROM-XMLs/evo10base.xml)

## Usage

ECU Explorer scans for definitions in the following locations (in order):

1. **Your open workspace folders** (scanned automatically)
2. **Configured definition paths** (settings):
   - `ecuExplorer.definitions.paths` — Common definition folder(s)
   - `ecuExplorer.definitions.ecuflash.paths` — ECUFlash-specific folder(s)

### To Use These Example Files

**Option A: Copy to workspace folder** (easiest)
1. Copy these files to any folder within your open VS Code workspace
2. ECU Explorer will find them automatically

**Option B: Configure a custom definitions folder**
1. Copy these files to a dedicated folder (e.g., `~/ecu-definitions/`)
2. Open VS Code settings (Cmd+, on Mac, Ctrl+, on Windows/Linux)
3. Search for `ecuExplorer.definitions.ecuflash.paths`
4. Add your folder path to the list
5. Reload VS Code

Open the ROM file (`56890009_2011_USDM_5MT.hex`) and ECU Explorer will auto-match the definition.

## Legal and Attribution

> [!NOTE]
> These files are provided for **educational and testing purposes only**.

### Disclaimers

- These are reverse-engineered ECU definitions and ROM images, not intellectual property of the original manufacturers
- Modifying ECU software can affect vehicle performance, emissions, and safety
- **You are responsible** for any consequences resulting from ECU modifications
- Always consult your vehicle's manufacturer documentation and local regulations

### Community and Open-Source Acknowledgments

This project builds upon the work of:

- [RomRaider](https://romraider.com/) - ROM editing and analysis tools
- [EcuFlash](https://www.tactrix.com/) - ECU definition platform
- [EvoScan](https://www.evoscan.com/) - Real-time ECU monitoring
- The broader automotive tuning community

---

## Contact / Attribution Updates

If you are the original author of any definitions or ROM configurations and would like proper attribution or have concerns about inclusion, please open an issue in the repository.
