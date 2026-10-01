import { GoogleGenAI } from '@google/genai';

/**
 * Model used first. Pinned rather than an alias so a transcription either
 * behaves the same as last week or fails loudly.
 */
export const PRIMARY_MODEL = 'gemini-3.6-flash';

/**
 * Tried in order once the primary has exhausted its attempts. 3.8 is the
 * newest Flash and the first to recover from a capacity block; 3.5 is the
 * most conservative fallback that still understands audio.
 */
export const FALLBACK_MODELS = ['gemini-3.8-flash', 'gemini-3.5-flash'];

/** Total attempts per model, including the first one. */
export const MAX_ATTEMPTS = 3;

/** Backoff before attempt 2 and attempt 3. */
export const RETRY_DELAYS_MS = [2000, 6000];

export const TRANSCRIBE_PROMPT =
	'Return the transcript of this file without timestamps and separated into neat paragraphs, Return only the transcript itself';

export interface StatusReporter {
	/** Human-readable progress line for the user. */
	info(message: string): void;
	/** Same, but for the last word when the request is over. */
	final(message: string): void;
}

export interface Completion<T> {
	value: T;
	/** Model that produced the value. */
	model: string;
	/** Failed attempts that preceded it, across every model tried. */
	failedAttempts: number;
}

/** HTTP statuses that mean "try again", as opposed to "this will never work". */
const RETRYABLE_STATUSES = [408, 429, 500, 502, 503, 504];

function errorStatus(error: unknown): number | undefined {
	if (typeof error === 'object' && error !== null) {
		const status: unknown = Reflect.get(error, 'status');
		if (typeof status === 'number') {
			return status;
		}
	}
	return undefined;
}

function errorMessage(error: unknown): string {
	const raw = error instanceof Error ? error.message : String(error);
	// The SDK surfaces API failures as a JSON string in `message`; show the
	// human sentence from it rather than the raw JSON.
	const match = raw.match(/"message"\s*:\s*"([^"]+)"/);
	const text = (match ? match[1] : raw).replace(/\s+/g, ' ');
	return text.slice(0, 200);
}

/**
 * A failure is worth repeating when the request never reached a verdict:
 * capacity, rate limits, or a dropped connection. A 400 or a 403 fails
 * identically on every model, so those stop the chain immediately.
 */
export function isRetryable(error: unknown): boolean {
	const status = errorStatus(error);
	if (status === undefined) {
		return true;
	}
	return RETRYABLE_STATUSES.indexOf(status) !== -1;
}

function sleep(ms: number): Promise<void> {
	// Not Promise.withResolvers: this project typechecks against the ES7 lib.
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export class GeminiClient {
	private readonly ai: GoogleGenAI;

	constructor(apiKey: string) {
		this.ai = new GoogleGenAI({ apiKey });
	}

	/**
	 * Runs `call` against each model in turn, retrying transient failures with
	 * a backoff before moving to the next model. Reports every step, so a slow
	 * transcription reads as progress instead of a hang.
	 */
	private async run<T>(
		call: (model: string) => Promise<T>,
		label: string,
		status: StatusReporter
	): Promise<Completion<T>> {
		const models = [PRIMARY_MODEL].concat(FALLBACK_MODELS);
		let failedAttempts = 0;
		let lastError: unknown;

		for (let m = 0; m < models.length; m++) {
			const model = models[m];
			const nextModel = models[m + 1];

			for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
				try {
					const value = await call(model);
					if (failedAttempts > 0) {
						const plural = failedAttempts === 1 ? '' : 's';
						status.final(`${label} done with ${model} after ${failedAttempts} failed attempt${plural}.`);
					}
					return { value, model, failedAttempts };
				} catch (error) {
					failedAttempts++;
					lastError = error;
					const reason = errorStatus(error) ?? 'network';

					if (!isRetryable(error)) {
						status.final(
							`${label} failed: ${errorMessage(error)} (${model}, attempt ${attempt}/${MAX_ATTEMPTS}). Not retrying.`
						);
						throw new Error(errorMessage(error));
					}

					if (attempt < MAX_ATTEMPTS) {
						const delayMs = RETRY_DELAYS_MS[attempt - 1];
						status.info(
							`${label}: ${model} unavailable (${reason}). Retry ${attempt + 1}/${MAX_ATTEMPTS} in ${Math.round(delayMs / 1000)}s.`
						);
						await sleep(delayMs);
					} else if (nextModel) {
						status.info(`${label}: ${model} still failing (${reason}). Falling back to ${nextModel}.`);
					} else {
						status.info(`${label}: ${model} still failing (${reason}). No models left, giving up.`);
					}
				}
			}
		}

		throw new Error(errorMessage(lastError));
	}

	async transcribe(
		audio: { mimeType: string; data: string },
		status: StatusReporter
	): Promise<{ text: string; model: string; failedAttempts: number }> {
		const result = await this.run<{ text?: string }>(
			(model) =>
				this.ai.models.generateContent({
					model,
					contents: [
						{
							role: 'user',
							parts: [{ text: TRANSCRIBE_PROMPT }, { inlineData: audio }],
						},
					],
				}),
			'Transcription',
			status
		);

		return {
			text: result.value.text ?? '',
			model: result.model,
			failedAttempts: result.failedAttempts,
		};
	}

	async title(transcript: string, status: StatusReporter): Promise<string> {
		const snippet = transcript.length > 1500 ? `${transcript.substring(0, 1500)}...` : transcript;
		const prompt =
			'Based on the following transcript, provide a very short, descriptive title ' +
			'(around 3-7 words) suitable for a heading. Do not use quotes in the title. ' +
			`Transcript snippet:\n\n"${snippet}"`;

		const result = await this.run<string>(
			(model) =>
				this.ai.models
					.generateContent({ model, contents: [{ role: 'user', parts: [{ text: prompt }] }] })
					.then((response) => (response.text ?? '').trim()),
			'Title',
			status
		);

		return result.value.replace(/^Title:\s*/i, '').replace(/["']/g, '');
	}
}