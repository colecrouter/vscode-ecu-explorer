# Troubleshooting "No Vehicle Interface" in EcuFlash

## Common Issues and Solutions

### 1. DLL Not Registered in Windows Registry

**Symptoms:** EcuFlash shows "no vehicle interface" in the dropdown

**Solution:**
1. Open Command Prompt **as Administrator**
2. Navigate to this directory: `cd tools\mock_j2534`
3. Run: `register_mock.bat`
4. Restart EcuFlash

**Verify Registration:**
- Run `check_registry.bat` (doesn't need admin rights)
- You should see "OpenPort 2.0 Mock" listed with the FunctionLibrary path pointing to your op20pt32.dll

### 2. DLL Not Built or Missing

**Symptoms:** Registry script reports "ERROR: op20pt32.dll not found"

**Solution:**
```bash
# On macOS/Linux with MinGW cross-compiler:
cd tools/mock_j2534
i686-w64-mingw32-gcc -shared -m32 -o op20pt32.dll op20pt32.c op20pt32.def -Wall

# Or on Windows with MinGW:
gcc -shared -m32 -o op20pt32.dll op20pt32.c op20pt32.def -Wall
```

### 3. Path Issues in Registry

**Symptoms:** Device appears in EcuFlash but fails to connect

**Solution:**
- Verify the DLL path in registry points to the correct location
- Use `check_registry.bat` to view current registration
- Ensure path has no typos and file exists at that location
- Use absolute path, not relative path

### 4. 32-bit vs 64-bit Registry View

**Symptoms:** Device registered but EcuFlash doesn't see it

**Background:** EcuFlash is a 32-bit application. On 64-bit Windows, 32-bit apps look in `WOW6432Node` registry path.

**Solution:**
- `register_mock.bat` creates entries in BOTH locations
- Verify with `check_registry.bat` that you see entries in the WOW6432Node section

### 5. Permissions Issues

**Symptoms:** "Access denied" when running register_mock.bat

**Solution:**
- Right-click Command Prompt and select "Run as Administrator"
- Or right-click `register_mock.bat` and select "Run as Administrator"

### 6. EcuFlash Needs Restart

**Symptoms:** Device doesn't appear after registration

**Solution:**
- Close EcuFlash completely
- Reopen EcuFlash
- Check Settings → Port Settings → Device dropdown

### 7. Log File Not Created

**Symptoms:** Mock DLL is used but no log file appears

**The mock DLL writes to:** `C:\j2534_mock.log`

**Check:**
- Open `C:\j2534_mock.log` in Notepad
- If file doesn't exist, DLL may not have write permissions for C:\
- Alternatively, check stderr output if running from command line

### 8. Original OpenPort DLL Conflicts

**Symptoms:** EcuFlash uses real device instead of mock

**Solution:**
- The registry entry should point directly to the mock DLL
- Don't replace the original op20pt32.dll in the OpenPort installation folder
- Instead, register the mock as a separate device with a different name

## Step-by-Step Verification Process

1. **Build the DLL:**
   ```bash
   i686-w64-mingw32-gcc -shared -m32 -o op20pt32.dll op20pt32.c op20pt32.def -Wall
   ```

2. **Check that DLL exists:**
   ```cmd
   dir op20pt32.dll
   ```

3. **Register the device:**
   ```cmd
   REM As Administrator:
   register_mock.bat
   ```

4. **Verify registration:**
   ```cmd
   check_registry.bat
   ```
   
   Look for:
   ```
   HKEY_LOCAL_MACHINE\SOFTWARE\WOW6432Node\PassThruSupport.04.04\OpenPort 2.0 Mock
       FunctionLibrary    REG_SZ    E:\Repos\...\tools\mock_j2534\op20pt32.dll
       Name              REG_SZ    OpenPort 2.0 (Mock)
   ```

5. **Launch EcuFlash:**
   - Go to Settings → Port Settings
   - Device dropdown should show "OpenPort 2.0 (Mock)"
   - Select it

6. **Open a ROM file:**
   - Load an EVO X ROM

7. **Initiate Write:**
   - Click Write
   - Watch for SecurityAccess exchange

8. **Check log:**
   - Open `C:\j2534_mock.log`
   - Should see the key value

## Debugging Registry Issues

**View all J2534 devices registered on your system:**
```cmd
reg query "HKLM\SOFTWARE\PassThruSupport.04.04" /s
reg query "HKLM\SOFTWARE\WOW6432Node\PassThruSupport.04.04" /s
```

**Manually add registry entry:**
```cmd
REM As Administrator:
reg add "HKLM\SOFTWARE\WOW6432Node\PassThruSupport.04.04\OpenPort 2.0 Mock" /v FunctionLibrary /t REG_SZ /d "E:\Repos\github.com\colecrouter\vscode-ecu-explorer\tools\mock_j2534\op20pt32.dll" /f
reg add "HKLM\SOFTWARE\WOW6432Node\PassThruSupport.04.04\OpenPort 2.0 Mock" /v Name /t REG_SZ /d "OpenPort 2.0 (Mock)" /f
```

**Remove registry entry:**
```cmd
REM As Administrator:
unregister_mock.bat
```

## Still Having Issues?

1. **Check Event Viewer:**
   - Windows Logs → Application
   - Look for errors from EcuFlash

2. **Try Process Monitor (procmon):**
   - Download from Microsoft Sysinternals
   - Filter for ecuflash.exe
   - Watch for registry queries and file access
   - See what paths EcuFlash is checking

3. **Verify DLL architecture:**
   ```cmd
   dumpbin /headers op20pt32.dll | findstr machine
   REM Should show: 14C machine (x86)
   ```

4. **Test DLL loads:**
   - Use Dependency Walker (depends.exe) to check if DLL has missing dependencies
   - Ensure all J2534 functions are exported

## Expected Successful Output

When everything is working, you should see in `C:\j2534_mock.log`:

```
=== Mock op20pt32.dll loaded (ecuflash mitsucan security key interceptor) ===
Magic seed: 0x1234 — watch for key sent in 27 04 response
PassThruOpen called
PassThruConnect(proto=6, baud=500000)
TX (EcuFlash→ECU) [8 bytes]: 00 00 07 E0 02 10 03 00
  → DiagnosticSessionControl(0x03)
TX (EcuFlash→ECU) [8 bytes]: 00 00 07 E0 02 27 03 00
  → SecurityAccess requestSeed (write-level, subfunction 0x03)
  → Responding with seed = 0x12 0x34
TX (EcuFlash→ECU) [9 bytes]: 00 00 07 E0 04 27 04 XX YY
  → SecurityAccess sendKey (write-level, subfunction 0x04)
  *** WRITE SESSION KEY for seed=0x1234: KH=0xXX KL=0xYY (key=0xXXYY) ***
```
