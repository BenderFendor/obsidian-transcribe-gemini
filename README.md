# Transcribe Gemini Plugin

Transcribe Gemini is an Obsidian plugin that automatically transcribes audio files linked within your notes. Powered by Google’s Gemini generative AI model, this plugin converts supported audio files (currently `.m4a`, `.mp3`, `.mp4`) into text transcripts and appends them to your notes. It transcribes with `gemini-3.6-flash`, retrying and falling back to `gemini-3.8-flash` and `gemini-3.5-flash` when a model is at capacity.

## Key Features

- **Automatic Transcription:** Finds and transcribes linked audio files in your notes.
- **Seamless Integration:** Works within Obsidian’s interface, appending transcripts directly to your active file.
- **Reliable Transcription:** Retries busy models with a backoff, falls back to other Flash models, and tells you which model produced the transcript.
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


## Failure Handling

Gemini answers a request either with a transcript or with a verdict. This plugin treats the two differently:

- **Busy models are retried.** A capacity block (`503`), rate limit (`429`), server error (`5xx`) or dropped connection is retried up to 3 times per model with a 2s then 6s backoff.
- **Dead ends are not retried.** An invalid request (`400`), a bad key (`401`/`403`) or an unknown model (`404`) fails on the first attempt, because repeating it on another model only wastes time.
- **Other models are tried next.** After a model exhausts its retries, the request moves to the next Flash model in `FALLBACK_MODELS` in `gemini.ts`.
- **Every step is reported.** Each retry, fallback, success and failure is a notice naming the model and the reason, and each file ends with its own success or failure notice.
- **One bad file does not stop the rest.** Files are transcribed independently; the run finishes with a summary of what failed and why.

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
