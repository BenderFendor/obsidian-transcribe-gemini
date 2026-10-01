import fs from 'fs';
import path from 'path';
import { GeminiClient } from './gemini.ts';

const cfg = JSON.parse(fs.readFileSync('data.json', 'utf8'));
const client = new GeminiClient(cfg.apiKey);

// Usage: node repro.mjs [audio-path]
const audioPath = process.argv[2] ?? "/home/bender/Documents/Jordan's Notes/Jordan's Notes/Audio/Recording 20250603062731.m4a";
const audioData = new Uint8Array(fs.readFileSync(audioPath));
console.log('file:', path.basename(audioPath), 'size:', audioData.length);

let binary = '';
const chunkSize = 0x8000;
for (let i = 0; i < audioData.length; i += chunkSize) {
	binary += String.fromCharCode(...audioData.subarray(i, i + chunkSize));
}

const status = {
	info: (message) => console.log('INFO ', message),
	final: (message) => console.log('FINAL', message),
};

const started = Date.now();
try {
	const result = await client.transcribe({ mimeType: 'audio/mp4', data: btoa(binary) }, status);
	console.log(
		'OK in',
		((Date.now() - started) / 1000).toFixed(1) + 's',
		'| model:',
		result.model,
		'| transcript length:',
		result.text.length,
		'| failed attempts:',
		result.failedAttempts
	);
} catch (error) {
	console.log('ERROR:', error.message);
	process.exitCode = 1;
}