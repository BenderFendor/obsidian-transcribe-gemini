# Transcribe Gemini Plugin

Transcribe Gemini is an Obsidian plugin that automatically transcribes audio files linked within your notes. Powered by Google’s Gemini generative AI model, this plugin converts supported audio files (currently `.m4a`) into text transcripts and appends them to your notes.

## Key Features

- **Automatic Transcription:** Finds and transcribes linked audio files in your notes.
- **Seamless Integration:** Works within Obsidian’s interface, appending transcripts directly to your active file.
- **Easy Configuration:** Set your Gemini API key in the plugin settings.
- **Built with TypeScript:** Enjoy type checking and in-editor documentation.

## Getting Started

### Installation

1. **Clone or copy the repository:**

   - Place the plugin folder (e.g. `obsidian-transcribe-gemini`) in your vault’s `.obsidian/plugins/` directory.

2. **Install Dependencies:**

   ```sh
   npm install
   ```

3. **Development Mode:**

   - To compile the plugin in watch mode, run:
   
     ```sh
     npm run dev
     ```
   
   - Reload Obsidian after making changes.

4. **Production Build:**

   - To compile the production build, run:
   
     ```sh
     npm run build
     ```

### Setup

- Open the Obsidian settings and navigate to the plugin settings.
- Enter your Gemini API key from Google AI Studio into the provided field.
- Enable the plugin to start transcribing linked audio files (currently `.m4a`).

## Usage

- Open a note and include links to audio files using double square brackets (e.g. `[[example.m4a]]`).
- Run the "Transcribe linked audio files" command:
  - The plugin checks the active note for linked audio.
  - It locates the audio files in your vault.
  - It sends the audio content for transcription and appends the transcript directly in your note.

## Releasing New Versions

1. **Update Version Numbers:**
   - Update the `version` field in `manifest.json` and `package.json`.
   - Update the `minAppVersion` in `manifest.json` if required.

2. **Update Versions List:**
   - Run the version bump script:
   
     ```sh
     npm version patch   # or minor/major as needed
     ```
     
     This command updates `manifest.json`, bumps the version in `versions.json`, and stages those changes.

3. **Create a Release:**
   - Create a new GitHub release with the updated version.
   - Upload `manifest.json`, `main.js`, and `styles.css`.

## Development and Testing

- **Linting:** Run ESLint to analyze your code for improvements:
  
  ```sh
  eslint main.ts
  ```

- **Type Checking:** The project uses TypeScript. Ensure type safety during development with:
  
  ```sh
  tsc --noEmit
  ```

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
