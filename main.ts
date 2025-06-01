import { App, Plugin, Notice, Setting, PluginSettingTab, TFile } from 'obsidian';
import { GoogleGenerativeAI } from '@google/generative-ai';

interface MyPluginSettings {
  apiKey: string;
}

const DEFAULT_SETTINGS: MyPluginSettings = {
  apiKey: '',
};

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
      callback: () => this.transcribeAudio(),
    });
  }

  async transcribeAudio() {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) {
      new Notice('No active file');
      return;
    }

    if (!this.settings.apiKey) {
      new Notice('API key is not set. Please set it in the plugin settings.');
      return;
    }

    const content = await this.app.vault.read(activeFile);
    const audioLinks = this.extractAudioLinks(content);

    for (const link of audioLinks) {
      const audioFile = await this.findAudioFile(link);
      if (audioFile && audioFile instanceof TFile) {
        const audioContent = await this.app.vault.readBinary(audioFile);
        const transcript = await this.getTranscript(new Uint8Array(audioContent), audioFile.extension);
        await this.appendTranscript(activeFile, link, transcript);
      } else {
        new Notice(`Audio file not found: ${link}`);
      }
    }
  }

  extractAudioLinks(content: string): string[] {
    const regex = /\[\[([^\]]+)\]\]/g;
    const links: string[] = [];
    let match;
    while ((match = regex.exec(content)) !== null) {
      const filename = match[1];
      if (filename.toLowerCase().endsWith('.m4a')) {
        links.push(filename);
      }
    }
    return links;
  }

  async findAudioFile(link: string): Promise<TFile | null> {
    // Try direct path first
    const abstractFile = this.app.vault.getAbstractFileByPath(link);
    if (abstractFile instanceof TFile) {
      return abstractFile;
    }

    // Fallback: search vault recursively by basename
    const basename = link.split('/').pop() || link; // Get filename without path
    const fileByName = this.findFileByName(basename);
    if (fileByName) {
      new Notice(`Found ${basename} at ${fileByName.path}`);
      return fileByName;
    }

    return null;
  }

  findFileByName(filename: string): TFile | null {
    const files = this.app.vault.getFiles();
    for (const file of files) {
      if (file.name.toLowerCase() === filename.toLowerCase() && file instanceof TFile) {
        return file; // Return first match
      }
    }
    return null;
  }

  async getTranscript(audioData: Uint8Array, extension: string): Promise<string> {
    try {
      new Notice('Transcribing audio...'); // Notify user of transcription start
      const genAI = new GoogleGenerativeAI(this.settings.apiKey); // Removed apiKey option for simplicity
      const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' }); // Use a model that supports audio

      // Convert Uint8Array to a binary string
      let binaryString = '';
      for (let i = 0; i < audioData.byteLength; i++) {
        binaryString += String.fromCharCode(audioData[i]);
      }
      // Encode the binary string to base64
      const base64AudioData = btoa(binaryString);

      const audioPart = {
        inlineData: {
          mimeType: `audio/${extension === 'm4a' ? 'mp4' : extension}`,
          data: base64AudioData, // Use the new base64 string
        },
      };
      const result = await model.generateContent([
        { text: 'Return the transcript of this file without timestamps and separated into neat paragraphs' },
        audioPart,
      ]);
      return result.response.text();
    } catch (error) {
      new Notice(`Transcription error: ${error.message}`);
      throw error;
    }
  }

  async appendTranscript(file: TFile, link: string, transcript: string) {
    let content = await this.app.vault.read(file);
    const basename = link.split('/').pop() || link; // Use basename for readability
    content += `\n\n## Transcript for ${basename}\n\n${transcript}`;
    await this.app.vault.modify(file, content);
    new Notice(`Transcript added for ${basename}`);
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
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