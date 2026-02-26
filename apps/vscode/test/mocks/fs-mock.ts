/**
 * Mock file system operations for testing
 */

export function createMockFileSystem() {
	const files = new Map<string, Uint8Array>();

	const readFile = async (path: string) => {
		const data = files.get(path);
		if (!data) {
			throw new Error(`File not found: ${path}`);
		}
		return data;
	};

	const writeFile = async (path: string, data: Uint8Array) => {
		files.set(path, data);
	};

	const deleteFile = async (path: string) => {
		if (!files.has(path)) {
			throw new Error(`File not found: ${path}`);
		}
		files.delete(path);
	};

	return {
		readFile,
		writeFile,
		deleteFile,
		exists: (path: string) => files.has(path),
		readFileAsString: async (path: string) => {
			const data = await readFile(path);
			return new TextDecoder().decode(data);
		},
		writeFileAsString: async (path: string, content: string) => {
			const data = new TextEncoder().encode(content);
			await writeFile(path, data);
		},
		listFiles: (directory: string) => {
			const prefix = directory.endsWith("/") ? directory : `${directory}/`;
			return Array.from(files.keys()).filter((path) => path.startsWith(prefix));
		},
		_files: files,
	};
}

export function createMockFileSystemWithFiles(
	initialFiles: Record<string, string | Uint8Array> = {},
) {
	const fs = createMockFileSystem();

	for (const [path, content] of Object.entries(initialFiles)) {
		if (typeof content === "string") {
			fs._files.set(path, new TextEncoder().encode(content));
		} else {
			fs._files.set(path, content);
		}
	}

	return fs;
}
