/*
 * Mock op20pt32.dll — OpenPort 2.0 J2534 DLL stub
 *
 * Purpose: intercept J2534 PassThru calls from ecuflash.exe,
 * respond with fake CAN frames for:
 *   - UDS DiagnosticSessionControl (10 03) → positive response (50 03)
 *   - UDS SecurityAccess requestSeed (27 03) → seed = 0x12 0x34
 *   - UDS SecurityAccess sendKey (27 04 KH KL) → LOG THE KEY and return positive (67 04)
 *
 * Magic seed: 0x1234 — fixed so we can predict the expected key
 * The key sent by EcuFlash in response to seed 0x1234 is the write-session key.
 *
 * Build: i686-w64-mingw32-gcc -shared -o op20pt32.dll op20pt32.c op20pt32.def
 *
 * Usage: Copy to ecuflash.exe directory, rename original op20pt32.dll.
 *        Run ecuflash.exe under Wine with an EVO X ROM loaded.
 *        Check /tmp/j2534_mock.log for the key value.
 */

#include <windows.h>
#include <stdio.h>
#include <string.h>
#include <stdarg.h>

/* J2534 API definitions */
#define STATUS_NOERROR 0
#define STATUS_ERR_FAILED 0x1F

#define ISO15765 6
#define ISO15765_PS 0x04

/* PASSTHRU_MSG structure */
typedef struct
{
	DWORD ProtocolID;
	DWORD RxStatus;
	DWORD TxFlags;
	DWORD Timestamp;
	DWORD DataSize;
	DWORD ExtraDataIndex;
	BYTE Data[4128];
} PASSTHRU_MSG;

static FILE *logfile = NULL;
static DWORD g_device_id = 1;
static DWORD g_channel_id = 1;

static void log_msg(const char *fmt, ...)
{
	if (!logfile)
	{
		logfile = fopen("C:\\j2534_mock.log", "a");
		if (!logfile)
			logfile = fopen("j2534_mock.log", "a");
	}
	if (logfile)
	{
		va_list ap;
		va_start(ap, fmt);
		vfprintf(logfile, fmt, ap);
		va_end(ap);
		fflush(logfile);
	}
	/* Also write to stderr for winedbg capture */
	va_list ap2;
	va_start(ap2, fmt);
	vfprintf(stderr, fmt, ap2);
	va_end(ap2);
}

static void log_bytes(const char *prefix, const BYTE *data, DWORD len)
{
	if (!logfile)
	{
		logfile = fopen("C:\\j2534_mock.log", "a");
		if (!logfile)
			logfile = fopen("j2534_mock.log", "a");
	}
	log_msg("%s [%lu bytes]: ", prefix, len);
	for (DWORD i = 0; i < len && i < 32; i++)
	{
		log_msg("%02X ", data[i]);
	}
	log_msg("\n");
}

/* Pending response to send back to EcuFlash */
static BYTE pending_response[sizeof(PASSTHRU_MSG)];
static DWORD pending_response_len = 0;
static int has_pending = 0;

/* Build an ISO 15765 CAN frame response */
static void build_can_response(PASSTHRU_MSG *msg, const BYTE *uds_payload, DWORD uds_len)
{
	memset(msg, 0, sizeof(PASSTHRU_MSG));
	msg->ProtocolID = ISO15765;
	/* First 4 bytes = CAN ID 0x7E8 little-endian in Data */
	msg->Data[0] = 0x00;
	msg->Data[1] = 0x00;
	msg->Data[2] = 0x07;
	msg->Data[3] = 0xE8;
	/* UDS payload starts at Data[4] */
	memcpy(msg->Data + 4, uds_payload, uds_len);
	msg->DataSize = 4 + uds_len;
	msg->RxStatus = 0;
}

BOOL WINAPI DllMain(HINSTANCE hinstDLL, DWORD fdwReason, LPVOID lpvReserved)
{
	if (fdwReason == DLL_PROCESS_ATTACH)
	{
		log_msg("=== Mock op20pt32.dll loaded (ecuflash mitsucan security key interceptor) ===\n");
		log_msg("Magic seed: 0x1234 — watch for key sent in 27 04 response\n");
	}
	return TRUE;
}

/* PassThruOpen */
__declspec(dllexport) LONG __stdcall PassThruOpen(LPVOID pName, DWORD *pDeviceID)
{
	log_msg("PassThruOpen called\n");
	if (pDeviceID)
		*pDeviceID = g_device_id;
	return STATUS_NOERROR;
}

/* PassThruClose */
__declspec(dllexport) LONG __stdcall PassThruClose(DWORD DeviceID)
{
	log_msg("PassThruClose(%lu)\n", DeviceID);
	return STATUS_NOERROR;
}

/* PassThruConnect */
__declspec(dllexport) LONG __stdcall PassThruConnect(
	DWORD DeviceID, DWORD ProtocolID, DWORD Flags,
	DWORD BaudRate, DWORD *pChannelID)
{
	log_msg("PassThruConnect(proto=%lu, baud=%lu)\n", ProtocolID, BaudRate);
	if (pChannelID)
		*pChannelID = g_channel_id;
	return STATUS_NOERROR;
}

/* PassThruDisconnect */
__declspec(dllexport) LONG __stdcall PassThruDisconnect(DWORD ChannelID)
{
	log_msg("PassThruDisconnect(%lu)\n", ChannelID);
	return STATUS_NOERROR;
}

/* PassThruWriteMsgs — EcuFlash sends requests here */
__declspec(dllexport) LONG __stdcall PassThruWriteMsgs(
	DWORD ChannelID, PASSTHRU_MSG *pMsg, DWORD *pNumMsgs, DWORD Timeout)
{

	if (!pMsg || !pNumMsgs || *pNumMsgs == 0)
		return STATUS_NOERROR;

	PASSTHRU_MSG *m = &pMsg[0];
	BYTE *data = m->Data;
	DWORD len = m->DataSize;

	log_bytes("TX (EcuFlash→ECU)", data, len);

	/* data[0..3] = CAN ID (0x7E0 for tester), data[4..] = UDS payload */
	/* UDS payload: data[4] = length byte (ISO 15765 SF), data[5..] = UDS */
	if (len >= 6)
	{
		BYTE uds_svc = data[5]; /* UDS service ID */
		BYTE uds_sf = data[6];	/* subfunction */

		/* DiagnosticSessionControl (0x10) → respond with 50 03 */
		if (uds_svc == 0x10)
		{
			log_msg("  → DiagnosticSessionControl(0x%02X)\n", uds_sf);
			BYTE resp[] = {0x02, 0x50, uds_sf};
			build_can_response((PASSTHRU_MSG *)pending_response, resp, 3);
			pending_response_len = sizeof(PASSTHRU_MSG);
			has_pending = 1;
		}
		/* SecurityAccess requestSeed (0x27 0x03) → respond with 67 03 12 34 */
		else if (uds_svc == 0x27 && uds_sf == 0x03)
		{
			log_msg("  → SecurityAccess requestSeed (write-level, subfunction 0x03)\n");
			log_msg("  → Responding with seed = 0x12 0x34\n");
			BYTE resp[] = {0x04, 0x67, 0x03, 0x12, 0x34};
			build_can_response((PASSTHRU_MSG *)pending_response, resp, 5);
			pending_response_len = sizeof(PASSTHRU_MSG);
			has_pending = 1;
		}
		/* SecurityAccess sendKey (0x27 0x04 KH KL) → LOG KEY and respond with 67 04 */
		else if (uds_svc == 0x27 && uds_sf == 0x04 && len >= 8)
		{
			BYTE kh = data[7];
			BYTE kl = data[8];
			WORD key = ((WORD)kh << 8) | kl;

			log_msg("  → SecurityAccess sendKey (write-level, subfunction 0x04)\n");
			log_msg("  *** WRITE SESSION KEY for seed=0x1234: KH=0x%02X KL=0x%02X (key=0x%04X) ***\n",
					kh, kl, key);
			log_msg("  *** key16 = 0x%04X ***\n", key);

			/* Also try read-session formula to see if same: (0x1234 * 0x4081 + 0x1234) & 0xFFFF */
			DWORD read_key = ((DWORD)0x1234 * 0x4081 + 0x1234) & 0xFFFF;
			log_msg("  (Read-session formula gives: 0x%04lX — %s)\n",
					read_key,
					(key == (WORD)read_key) ? "MATCHES read-session!" : "DIFFERENT from read-session");

			/* Accept the key — respond positive */
			BYTE resp[] = {0x02, 0x67, 0x04};
			build_can_response((PASSTHRU_MSG *)pending_response, resp, 3);
			pending_response_len = sizeof(PASSTHRU_MSG);
			has_pending = 1;
		}
		/* RequestDownload (0x34) → respond with positive (74 20 0F FA) */
		else if (uds_svc == 0x34)
		{
			log_msg("  → RequestDownload\n");
			BYTE resp[] = {0x03, 0x74, 0x20, 0x0F};
			build_can_response((PASSTHRU_MSG *)pending_response, resp, 4);
			pending_response_len = sizeof(PASSTHRU_MSG);
			has_pending = 1;
		}
		/* Everything else → generic positive response */
		else
		{
			log_msg("  → Unknown UDS service 0x%02X, sending generic positive\n", uds_svc);
			BYTE resp[] = {0x02, (BYTE)(uds_svc + 0x40), uds_sf};
			build_can_response((PASSTHRU_MSG *)pending_response, resp, 3);
			pending_response_len = sizeof(PASSTHRU_MSG);
			has_pending = 1;
		}
	}

	return STATUS_NOERROR;
}

/* PassThruReadMsgs — EcuFlash reads responses here */
__declspec(dllexport) LONG __stdcall PassThruReadMsgs(
	DWORD ChannelID, PASSTHRU_MSG *pMsg, DWORD *pNumMsgs, DWORD Timeout)
{

	if (!pMsg || !pNumMsgs)
		return STATUS_NOERROR;

	if (has_pending && *pNumMsgs > 0)
	{
		memcpy(&pMsg[0], pending_response, sizeof(PASSTHRU_MSG));
		PASSTHRU_MSG *m = &pMsg[0];
		log_bytes("RX (ECU→EcuFlash)", m->Data, m->DataSize);
		*pNumMsgs = 1;
		has_pending = 0;
		return STATUS_NOERROR;
	}

	*pNumMsgs = 0;
	return STATUS_NOERROR;
}

/* PassThruStartMsgFilter */
__declspec(dllexport) LONG __stdcall PassThruStartMsgFilter(
	DWORD ChannelID, DWORD FilterType, PASSTHRU_MSG *pMaskMsg,
	PASSTHRU_MSG *pPatternMsg, PASSTHRU_MSG *pFlowControlMsg, DWORD *pFilterID)
{
	log_msg("PassThruStartMsgFilter\n");
	if (pFilterID)
		*pFilterID = 1;
	return STATUS_NOERROR;
}

/* PassThruStopMsgFilter */
__declspec(dllexport) LONG __stdcall PassThruStopMsgFilter(DWORD ChannelID, DWORD FilterID)
{
	return STATUS_NOERROR;
}

/* PassThruSetProgrammingVoltage */
__declspec(dllexport) LONG __stdcall PassThruSetProgrammingVoltage(DWORD DeviceID, DWORD PinNumber, DWORD Voltage)
{
	return STATUS_NOERROR;
}

/* PassThruReadVersion */
__declspec(dllexport) LONG __stdcall PassThruReadVersion(
	DWORD DeviceID, char *pFirmwareVersion, char *pDllVersion, char *pApiVersion)
{
	if (pFirmwareVersion)
		strcpy(pFirmwareVersion, "2.0.0");
	if (pDllVersion)
		strcpy(pDllVersion, "2.0.0-mock");
	if (pApiVersion)
		strcpy(pApiVersion, "04.04");
	return STATUS_NOERROR;
}

/* PassThruGetLastError */
__declspec(dllexport) LONG __stdcall PassThruGetLastError(char *pErrorDescription)
{
	if (pErrorDescription)
		strcpy(pErrorDescription, "No error");
	return STATUS_NOERROR;
}

/* PassThruIoctl */
__declspec(dllexport) LONG __stdcall PassThruIoctl(
	DWORD HandleID, DWORD IoctlID, void *pInput, void *pOutput)
{
	log_msg("PassThruIoctl(id=%lu)\n", IoctlID);
	return STATUS_NOERROR;
}
