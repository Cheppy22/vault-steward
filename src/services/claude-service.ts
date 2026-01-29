/**
 * Claude API Service
 * Handles all communication with the Anthropic API using Obsidian's requestUrl
 */

import { requestUrl, RequestUrlResponse } from 'obsidian';
import {
	NoteAnalysisResult,
	VaultContext,
	ClaudeRequestOptions,
	ClaudeError,
	TokenUsage
} from '../types';
import {
	getAnalysisSystemPrompt,
	getAnalysisUserPrompt,
	PromptOptions
} from '../prompts/analysis-prompts';

// Debug logging utility
const DEBUG_PREFIX = 'Vault Steward';
const debug = {
	log: (...args: unknown[]) => console.log(`[${DEBUG_PREFIX}]`, ...args),
	error: (...args: unknown[]) => console.error(`[${DEBUG_PREFIX}]`, ...args)
};

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-sonnet-4-20250514';
const DEFAULT_MAX_TOKENS = 2048;
const DEFAULT_TEMPERATURE = 0.3;
const ANTHROPIC_VERSION = '2023-06-01';

interface AnthropicResponse {
	id: string;
	type: string;
	role: string;
	content: Array<{
		type: string;
		text?: string;
	}>;
	model: string;
	stop_reason: string;
	usage: {
		input_tokens: number;
		output_tokens: number;
	};
}

interface AnthropicErrorResponse {
	type: string;
	error: {
		type: string;
		message: string;
	};
}

export interface AnalysisResultWithUsage {
	result: NoteAnalysisResult;
	usage: TokenUsage;
}

export class ClaudeService {
	private apiKey: string = '';
	private lastUsage: TokenUsage | null = null;

	/**
	 * Initialize or update the API key
	 */
	setApiKey(apiKey: string): void {
		this.apiKey = apiKey;
	}

	/**
	 * Check if the service is configured with an API key
	 */
	isConfigured(): boolean {
		return this.apiKey.length > 0;
	}

	/**
	 * Get the last recorded token usage
	 */
	getLastUsage(): TokenUsage | null {
		return this.lastUsage;
	}

	/**
	 * Analyze a note and return suggestions for links and tags
	 */
	async analyzeNote(
		noteTitle: string,
		noteContent: string,
		context: VaultContext,
		options?: ClaudeRequestOptions,
		promptOptions?: PromptOptions
	): Promise<NoteAnalysisResult> {
		if (!this.apiKey) {
			throw this.createError('invalid_key', 'API key not configured');
		}

		try {
			const response = await requestUrl({
				url: ANTHROPIC_API_URL,
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'x-api-key': this.apiKey,
					'anthropic-version': ANTHROPIC_VERSION
				},
				body: JSON.stringify({
					model: DEFAULT_MODEL,
					max_tokens: options?.maxTokens ?? DEFAULT_MAX_TOKENS,
					temperature: options?.temperature ?? DEFAULT_TEMPERATURE,
					system: getAnalysisSystemPrompt(promptOptions),
					messages: [
						{
							role: 'user',
							content: getAnalysisUserPrompt(noteTitle, noteContent, context)
						}
					]
				})
			});

			return this.handleResponse(response);

		} catch (error) {
			throw this.handleError(error);
		}
	}

	/**
	 * Handle the API response
	 */
	private handleResponse(response: RequestUrlResponse): NoteAnalysisResult {
		if (response.status !== 200) {
			const errorData = response.json as AnthropicErrorResponse;

			if (response.status === 429) {
				throw this.createError(
					'rate_limit',
					'Rate limited. Please wait before making more requests.',
					60
				);
			}
			if (response.status === 401) {
				throw this.createError('invalid_key', 'Invalid API key');
			}

			throw this.createError(
				'api_error',
				errorData?.error?.message || `API error: ${response.status}`
			);
		}

		const data = response.json as AnthropicResponse;

		// Capture token usage
		this.lastUsage = {
			inputTokens: data.usage.input_tokens,
			outputTokens: data.usage.output_tokens,
			totalTokens: data.usage.input_tokens + data.usage.output_tokens,
			timestamp: Date.now()
		};

		debug.log('Token usage -',
			'input:', data.usage.input_tokens,
			'output:', data.usage.output_tokens,
			'total:', data.usage.input_tokens + data.usage.output_tokens
		);

		// Extract text content from response
		const textContent = data.content.find(block => block.type === 'text');
		if (!textContent || !textContent.text) {
			throw this.createError('api_error', 'No text response from Claude');
		}

		// Parse JSON response
		return this.parseAnalysisResponse(textContent.text);
	}

	/**
	 * Parse the JSON response from Claude
	 */
	private parseAnalysisResponse(responseText: string): NoteAnalysisResult {
		try {
			// Try to extract JSON from the response (in case there's extra text)
			const jsonMatch = responseText.match(/\{[\s\S]*\}/);
			if (!jsonMatch) {
				throw new Error('No JSON found in response');
			}

			const parsed = JSON.parse(jsonMatch[0]);

			// Validate and return with defaults
			return {
				suggestedLinks: Array.isArray(parsed.suggestedLinks)
					? parsed.suggestedLinks.map(this.validateLink)
					: [],
				suggestedTags: Array.isArray(parsed.suggestedTags)
					? parsed.suggestedTags.map(this.validateTag)
					: [],
				keyConcepts: Array.isArray(parsed.keyConcepts)
					? parsed.keyConcepts
					: [],
				summary: typeof parsed.summary === 'string'
					? parsed.summary
					: ''
			};
		} catch (error) {
			debug.error('Failed to parse Claude response:', responseText);
			// Return empty result on parse failure
			return {
				suggestedLinks: [],
				suggestedTags: [],
				keyConcepts: [],
				summary: ''
			};
		}
	}

	/**
	 * Validate a suggested link object
	 */
	private validateLink(link: unknown): { targetText: string; linkTarget: string; reasoning: string; confidence: number } {
		const l = link as Record<string, unknown>;
		// Clamp confidence to 0-1 range
		const rawConfidence = typeof l.confidence === 'number' ? l.confidence : 0.5;
		const confidence = Math.min(1, Math.max(0, rawConfidence));
		return {
			targetText: typeof l.targetText === 'string' ? l.targetText : '',
			linkTarget: typeof l.linkTarget === 'string' ? l.linkTarget : '',
			reasoning: typeof l.reasoning === 'string' ? l.reasoning : '',
			confidence
		};
	}

	/**
	 * Validate a suggested tag object
	 */
	private validateTag(tag: unknown): { tag: string; location: 'frontmatter' | 'inline'; reasoning: string; confidence: number } {
		const t = tag as Record<string, unknown>;
		// Clamp confidence to 0-1 range
		const rawConfidence = typeof t.confidence === 'number' ? t.confidence : 0.5;
		const confidence = Math.min(1, Math.max(0, rawConfidence));
		return {
			tag: typeof t.tag === 'string' ? t.tag : '',
			location: t.location === 'inline' ? 'inline' : 'frontmatter',
			reasoning: typeof t.reasoning === 'string' ? t.reasoning : '',
			confidence
		};
	}

	/**
	 * Handle API errors and convert to ClaudeError
	 */
	private handleError(error: unknown): ClaudeError {
		if (error && typeof error === 'object' && 'type' in error) {
			// Already a ClaudeError
			return error as ClaudeError;
		}

		if (error instanceof Error) {
			if (error.message.includes('network') || error.message.includes('fetch') || error.message.includes('Failed to fetch')) {
				return this.createError('network', 'Network error. Check your connection.');
			}
			return this.createError('unknown', error.message);
		}

		return this.createError('unknown', 'An unknown error occurred');
	}

	/**
	 * Create a ClaudeError object
	 */
	private createError(
		type: ClaudeError['type'],
		message: string,
		retryAfter?: number
	): ClaudeError {
		return { type, message, retryAfter };
	}
}

// Export singleton instance
export const claudeService = new ClaudeService();
