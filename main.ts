import { App, Plugin, Notice, Setting, PluginSettingTab, TFile } from 'obsidian';
import { GeminiClient, StatusReporter } from './gemini';

interface MyPluginSettings {
	apiKey: string;
}

const DEFAULT_SETTINGS: MyPluginSettings = {
	apiKey: '',
};

const NOTICE_INFO_MS = 8000;
const NOTICE_FINAL_MS = 12000;

export default class MyPlugin extends Plugin {
	settings: MyPluginSettings;

	async onload() {
		await this.loadSettings();

		// Add setting tab for API key
		this.addSettingTab(new SettingTab(this.app, this));

		// Add command to transcribe linked audio files
		this.addCommand({
			id: 'transcribe-audio',
			name: 'Transcribe linked audio files',
			callback: () => {
				this.transcribeAudio().catch((error: unknown) => {
					this.debug('Transcribe command crashed', { error });
					new Notice(`Transcription aborted: ${error instanceof Error ? error.message : String(error)}`, NOTICE_FINAL_MS);
				});
			},
		});
	}

	async transcribeAudio() {
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) {
			new Notice('No active file');
			return;
		}

		this.debug('Transcribe command started', { file: activeFile.path });

		if (!this.settings.apiKey) {
			new Notice('API key is not set. Please set it in the plugin settings.');
			return;
		}

		const content = await this.app.vault.read(activeFile);
		const audioLinks = this.extractAudioLinks(content);
		this.debug('Audio links detected', { count: audioLinks.length });

		if (audioLinks.length === 0) {
			new Notice('No linked audio files found in this note.');
			return;
		}

		const failures: string[] = [];
		let transcribed = 0;

		for (const link of audioLinks) {
			const basename = link.split('/').pop() || link;
			try {
				const audioFile = await this.findAudioFile(link, activeFile);
				if (!(audioFile instanceof TFile)) {
					throw new Error('not found in the vault');
				}
				const audioContent = await this.app.vault.readBinary(audioFile);
				const transcript = await this.getTranscript(new Uint8Array(audioContent), audioFile.extension, basename);
				await this.appendTranscript(activeFile, link, transcript);
				transcribed++;
			} catch (error) {
				// One unusable file must not abandon the rest of the note.
				const reason = error instanceof Error ? error.message : String(error);
				this.debug('Transcription failed', { link, error });
				console.error('[transcribe-gemini] failed', basename, error);
				failures.push(`${basename} (${reason})`);
				new Notice(`Failed: ${basename} — ${reason}`, NOTICE_FINAL_MS);
			}
		}

		if (failures.length > 0) {
			new Notice(`Transcribed ${transcribed} of ${audioLinks.length}. Failed: ${failures.join(' | ')}`, NOTICE_FINAL_MS);
		}
	}

	extractAudioLinks(content: string): string[] {
		const regex = /!?\[\[([^\]]+)\]\]/g; // Updated regex to find [[link]] or ![[link]]
		const links: string[] = [];
		let match;

		const audioExtensions = ['.m4a', '.mp3', '.mp4']; // Supported audio file extensions

		while ((match = regex.exec(content)) !== null) {
			const filename = match[1];


			for (const ext of audioExtensions) {
				if (filename.toLowerCase().endsWith(ext)) {
					links.push(filename);
					break; // Stop checking other extensions once a match is found
				}
			}
		}
		return links;
	}

	async findAudioFile(link: string, activeFile: TFile | null): Promise<TFile | null> {
		// Try direct path first
		const abstractFile = this.app.vault.getAbstractFileByPath(link);
		if (abstractFile instanceof TFile) {
			return abstractFile;
		}

		// Fallback: search vault recursively by basename
		const basename = link.split('/').pop() || link; // Get filename without path
		const candidates = this.findFilesByName(basename);
		if (candidates.length === 0) {
			return null;
		}

		// Prefer a file in the same folder as the active note, matching how
		// Obsidian resolves [[links]] relative to the note.
		if (activeFile && activeFile.parent) {
			const sameFolder = candidates.find((file) => file.parent?.path === activeFile.parent?.path);
			if (sameFolder) {
				new Notice(`Found ${basename} at ${sameFolder.path}`);
				return sameFolder;
			}
		}

		// When multiple files share a basename, skip candidates whose content
		// does not match an audio container (corrupt/encrypted files). Sending
		// non-audio bytes with an audio mime type makes the API reject the
		// request with INVALID_ARGUMENT.
		for (const candidate of candidates) {
			if (await this.hasValidAudioHeader(candidate)) {
				new Notice(`Found ${basename} at ${candidate.path}`);
				return candidate;
			}
		}

		// No candidate has a recognizable audio header; let the API decide.
		new Notice(`Found ${basename} at ${candidates[0].path}`);
		return candidates[0];
	}

	findFilesByName(filename: string): TFile[] {
		return this.app.vault.getFiles().filter(
			(file) => file.name.toLowerCase() === filename.toLowerCase()
		);
	}

	async hasValidAudioHeader(file: TFile): Promise<boolean> {
		try {
			const data = await this.app.vault.readBinary(file);
			const bytes = new Uint8Array(data, 0, 12);
			const header = String.fromCharCode(...bytes);
			// MP4/M4A container: a size field followed by "ftyp" at offset 4
			if (header.substring(4, 8) === 'ftyp') {
				return true;
			}
			// MP3 with an ID3 tag, or a raw MPEG frame sync (0xFF 0xEx)
			if (header.startsWith('ID3')) {
				return true;
			}
			if (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) {
				return true;
			}
			return false;
		} catch {
			return false;
		}
	}

	async getTranscript(audioData: Uint8Array, extension: string, label: string): Promise<string> {
		const mimeType = `audio/${extension === 'm4a' ? 'mp4' : extension}`; // Use mp4 for m4a files
		const client = new GeminiClient(this.settings.apiKey);
		const status: StatusReporter = {
			info: (message: string) => {
				this.debug(message);
				new Notice(message, NOTICE_INFO_MS);
			},
			final: (message: string) => {
				this.debug(message);
				new Notice(message, NOTICE_FINAL_MS);
			},
		};

		new Notice(`Transcribing ${label}...`, NOTICE_INFO_MS);
		this.debug('Sending audio to Gemini', { label, mimeType, bytes: audioData.length });

		const result = await client.transcribe({ mimeType, data: uint8ArrayToBase64(audioData) }, status);
		this.debug('Transcript received', {
			label,
			model: result.model,
			length: result.text.length,
			failedAttempts: result.failedAttempts,
		});

		if (result.text.trim().length === 0) {
			throw new Error(`${result.model} returned an empty transcript`);
		}
		return result.text;
	}

	async generateDescriptiveTitle(transcript: string): Promise<string> {
		if (!this.settings.apiKey) {
			console.warn('API key not set, cannot generate descriptive title.');
			return ''; // Return empty if no API key
		}
		if (!transcript || transcript.trim().length === 0) {
			return ''; // Return empty if no transcript
		}

		// A missing title only costs a generic heading, so failures stay quiet
		// apart from a console warning.
		const quiet: StatusReporter = {
			info: (message: string) => this.debug(message),
			final: (message: string) => this.debug(message),
		};

		try {
			const client = new GeminiClient(this.settings.apiKey);
			this.debug('Generating title', { transcriptLength: transcript.length });
			return await client.title(transcript, quiet);
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			console.warn('[transcribe-gemini] descriptive title failed:', reason);
			return ''; // Fallback to empty on error
		}
	}

	async appendTranscript(file: TFile, link: string, transcript: string) {
		let currentFileContent = await this.app.vault.read(file);
		const basename = link.split('/').pop() || link; // Original filename for the audio link embed in the new section

		// Generate the descriptive title from the transcript content
		const descriptiveTitle = await this.generateDescriptiveTitle(transcript);

		// Determine the header text
		const headerText = descriptiveTitle ? `Transcript about ${descriptiveTitle}` : `Transcript for ${basename}`;

		// Format for the audio file link (as an embed) in the new transcript section
		const audioFileEmbedInNewSection = `![[${basename}]]`;

		// Construct the new transcript section to be appended
		const newTranscriptSection = `\n\n# ${headerText}\n${audioFileEmbedInNewSection}\n\n${transcript}`;

		// Define the markdown for the original link to be removed.
		// 'link' is the exact string extracted from between the brackets by extractAudioLinks.
		const originalNonEmbedLinkMarkdown = `[[${link}]]`;
		const originalEmbedLinkMarkdown = `![[${link}]]`;

		// Remove the original link from the current file content.
		// Try removing the embed version first, then the non-embed version.
		// This replaces only the first occurrence found during this specific call.
		let contentAfterRemoval = currentFileContent;
		if (contentAfterRemoval.includes(originalEmbedLinkMarkdown)) {
			contentAfterRemoval = contentAfterRemoval.replace(originalEmbedLinkMarkdown, '');
		} else if (contentAfterRemoval.includes(originalNonEmbedLinkMarkdown)) {
			contentAfterRemoval = contentAfterRemoval.replace(originalNonEmbedLinkMarkdown, '');
		}
		// The removed link leaves a hole; close it so the heading does not start
		// after a run of blank lines.
		const finalContent = contentAfterRemoval.replace(/\s+$/, '') + newTranscriptSection;

		await this.app.vault.modify(file, finalContent);
		new Notice(`Transcript added for ${basename}`);
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	private debug(message: string, data?: unknown) {
		if (data === undefined) {
			console.debug(`[transcribe-gemini] ${message}`);
			return;
		}
		console.debug(`[transcribe-gemini] ${message}`, data);
	}
}

/**
 * Convert a Uint8Array to a base64 string in chunks.
 * Chunking avoids call-stack overflow and is much faster than
 * concatenating one character at a time for large audio files.
 */
function uint8ArrayToBase64(bytes: Uint8Array): string {
	let binary = '';
	const chunkSize = 0x8000;
	for (let i = 0; i < bytes.length; i += chunkSize) {
		binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
	}
	return btoa(binary);
}

class SettingTab extends PluginSettingTab {
	plugin: MyPlugin;

	constructor(app: App, plugin: MyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl('h2', { text: 'Audio Transcription Settings' });

		new Setting(containerEl)
			.setName('Gemini API Key')
			.setDesc('Enter your Gemini API key from Google AI Studio')
			.addText((text) =>
				text
					.setPlaceholder('Enter API key')
					.setValue(this.plugin.settings.apiKey)
					.onChange(async (value) => {
						this.plugin.settings.apiKey = value;
						await this.plugin.saveSettings();
					})
			);
	}
}
