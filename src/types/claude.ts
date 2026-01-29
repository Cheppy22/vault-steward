/**
 * Types for Claude API integration
 */

export interface SuggestedLink {
	/** The text that should become a link */
	targetText: string;
	/** The note to link to (without [[brackets]]) */
	linkTarget: string;
	/** Why this link was suggested */
	reasoning: string;
	/** Confidence score 0-1 */
	confidence: number;
}

export interface SuggestedTag {
	/** The tag (with or without #) */
	tag: string;
	/** Whether to add to frontmatter or inline */
	location: 'frontmatter' | 'inline';
	/** Why this tag was suggested */
	reasoning: string;
	/** Confidence score 0-1 */
	confidence: number;
}

export interface NoteAnalysisResult {
	/** Suggested links to create */
	suggestedLinks: SuggestedLink[];
	/** Suggested tags to apply */
	suggestedTags: SuggestedTag[];
	/** Key concepts identified in the note */
	keyConcepts: string[];
	/** Brief summary of the note's content */
	summary: string;
}

export interface VaultContext {
	/** List of all note titles in the vault */
	existingNotes: string[];
	/** All tags currently used in the vault */
	existingTags: string[];
	/** User's predefined tags from settings */
	predefinedTags: string[];
	/** Words to always consider */
	whitelistWords: string[];
	/** Words to never link/tag */
	blacklistWords: string[];
}

export interface ClaudeRequestOptions {
	/** Maximum tokens to generate */
	maxTokens?: number;
	/** Temperature for response variation */
	temperature?: number;
}

export interface ClaudeError {
	type: 'api_error' | 'rate_limit' | 'invalid_key' | 'network' | 'unknown';
	message: string;
	retryAfter?: number;
}

export interface TokenUsage {
	/** Input tokens consumed */
	inputTokens: number;
	/** Output tokens generated */
	outputTokens: number;
	/** Total tokens (input + output) */
	totalTokens: number;
	/** When this usage was recorded */
	timestamp: number;
}

export interface TokenUsageStats {
	/** Total input tokens consumed (all time) */
	totalInputTokens: number;
	/** Total output tokens generated (all time) */
	totalOutputTokens: number;
	/** Total API calls made */
	totalCalls: number;
	/** Usage history (last 100 calls) */
	history: TokenUsage[];
	/** When tracking started */
	trackingSince: number;
	/** Last reset date */
	lastReset: number;
}
