# Manual Compilation Instructions

## Problem

WinGet installed WinLibs but didn't add it to the PATH. You need to either manually add it to PATH or use the compiler directly.

## Solution 1: Find and Use the Installed Compiler

WinLibs was installed by winget. Let's find it and use it directly:

### Step 1: Find WinLibs Installation

Open PowerShell and run:
```powershell
Get-ChildItem "C:\Program Files\" -Directory -Filter "*WinLibs*" -Recurse -ErrorAction SilentlyContinue | Select-Object FullName
```

Or search in these common locations:
- `C:\Program Files\WinLibs\`
- `C:\Program Files (x86)\WinLibs\`
- `C:\WinLibs\`
- User's home directory

### Step 2: Add GCC to PATH (Temporary)

Once you find the WinLibs folder (let's say it's at `C:\WinLibs\mingw64`):

```powershell
$env:Path += ";C:\WinLibs\mingw64\bin"
gcc --version
```

### Step 3: Compile the DLL

```powershell
cd tools\mock_j2534
gcc -shared -m32 -o op20pt32.dll op20pt32.c op20pt32.def -Wall
```

---

## Solution 2: Download MinGW Manually

### Step 1: Download WinLibs

1. Visit: https://winlibs.com/
2. Download: **GCC 14.2.0 + MinGW-w64 UCRT (Win64)** - POSIX threads
   - Direct link: https://github.com/brechtsanders/winlibs_mingw/releases/download/14.2.0posix-19.1.1-12.0.0-ucrt-r2/winlibs-x86_64-posix-seh-gcc-14.2.0-mingw-w64ucrt-12.0.0-r2.zip

### Step 2: Extract

Extract the ZIP to `C:\mingw64` (or your preferred location)

### Step 3: Compile

Open PowerShell:
```powershell
cd E:\Repos\github.com\colecrouter\vscode-ecu-explorer\tools\mock_j2534
C:\mingw64\bin\gcc.exe -shared -m32 -o op20pt32.dll op20pt32.c op20pt32.def -Wall
```

---

## Solution 3: Use Online Compiler

### Compiler Explorer (Godbolt)

1. Visit https://godbolt.org/
2. Select "C" language and "x86 gcc" compiler
3. Paste the contents of `op20pt32.c`
4. Add compile flags: `-shared -m32`
5. However, this won't produce a downloadable DLL easily

### Wandbox

Not ideal for DLL compilation.

---

## Solution 4: Request Precompiled DLL

Since compilation is problematic, you can:

1. Ask a colleague with a proper MinGW setup to compile it
2. Use a Linux/Mac machine with MinGW cross-compiler:
   ```bash
   i686-w64-mingw32-gcc -shared -m32 -o op20pt32.dll op20pt32.c op20pt32.def -Wall
   ```
3. Use WSL (Windows Subsystem for Linux) with MinGW:
   ```bash
   wsl --install
   # After WSL is installed:
   wsl
   sudo apt update
   sudo apt install mingw-w64
   cd /mnt/e/Repos/github.com/colecrouter/vscode-ecu-explorer/tools/mock_j2534
   i686-w64-mingw32-gcc -shared -m32 -o op20pt32.dll op20pt32.c op20pt32.def -Wall
   ```

---

## Solution 5: Use MSYS2 (Recommended)

MSYS2 provides a better-maintained MinGW environment for Windows.

### Step 1: Install MSYS2

1. Download from: https://www.msys2.org/
2. Run the installer: `msys2-x86_64-latest.exe`
3. Follow the installation wizard (default location: `C:\msys64`)

### Step 2: Install MinGW-w64 Toolchain

Open "MSYS2 MINGW32" from Start menu and run:
```bash
pacman -Syu
pacman -S mingw-w64-i686-toolchain
```

### Step 3: Compile

In MSYS2 MINGW32 terminal:
```bash
cd /e/Repos/github.com/colecrouter/vscode-ecu-explorer/tools/mock_j2534
gcc -shared -o op20pt32.dll op20pt32.c op20pt32.def -Wall
```

Or from Windows PowerShell:
```powershell
cd E:\Repos\github.com\colecrouter\vscode-ecu-explorer\tools\mock_j2534
C:\msys64\mingw32\bin\gcc.exe -shared -o op20pt32.dll op20pt32.c op20pt32.def -Wall
```

---

## Verification

After compiling, check the DLL:
```powershell
ls -l op20pt32.dll
```

You should see a file around 50-100 KB.

---

## Next Steps

Once you have the DLL:

1. Register it:
   ```cmd
   register_mock.bat
   ```

2. Verify registration:
   ```cmd
   check_registry.bat
   ```

3. Launch EcuFlash and select "OpenPort 2.0 (Mock)" device

4. Load EVO X ROM and initiate write

5. Check `C:\j2534_mock.log` for the key

---

## Troubleshooting

### "cannot find -lkernel32"

This means the compiler can't find Windows libraries. Use the correct MinGW variant:
- For 32-bit DLL: use `i686-w64-mingw32-gcc` or `mingw32\bin\gcc.exe`
- For 64-bit DLL: use `x86_64-w64-mingw32-gcc` or `mingw64\bin\gcc.exe`

### "undefined reference to '__imp__*'"

Add `-static-libgcc` to the compile command.

### DLL is too large (>1MB)

This is normal if debug symbols are included. Strip them:
```bash
strip op20pt32.dll
```

### EcuFlash doesn't load the DLL

Ensure it's 32-bit:
```powershell
dumpbin /headers op20pt32.dll | findstr machine
# Should show: 14C machine (x86)
```

If you don't have dumpbin, check the file size - it should be relatively small (<200 KB).
