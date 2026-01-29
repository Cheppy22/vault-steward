/**
 * Prompt templates for Claude API calls
 */

import { VaultContext } from '../types';

export interface PromptOptions {
	/** Whether new tags can be generated (vs only using existing ones) */
	allowNewTags?: boolean;
	/** Whether linking is enabled */
	enableLinking?: boolean;
	/** Whether tagging is enabled */
	enableTagging?: boolean;
}

/**
 * Generate the system prompt for note analysis
 */
export function getAnalysisSystemPrompt(options?: PromptOptions): string {
	const tagInstruction = options?.allowNewTags === false
		? '- ONLY use tags from the existing tags list or predefined tags - do NOT suggest new tags'
		: '- You may suggest new tags when appropriate, but prefer existing/predefined tags';

	return `You are Vault Steward, an AI assistant that helps organize an Obsidian vault by intelligently creating links between notes and applying relevant tags.

Your role is to analyze note content and suggest:
1. Wiki-links ([[note-name]]) to connect related notes
2. Tags (#tag) to categorize the note

Guidelines:
- Only suggest links to notes that actually exist in the vault
- Prefer user's predefined tags when they fit
${tagInstruction}
- Be conservative - only suggest high-confidence connections
- Respect the user's whitelist and blacklist words
- Never suggest links or tags for blacklisted words
- Return structured JSON responses only

You will receive the note content and context about the vault (existing notes, tags, user preferences).`;
}

/**
 * Generate the user prompt for analyzing a note
 */
export function getAnalysisUserPrompt(
	noteTitle: string,
	noteContent: string,
	context: VaultContext
): string {
	return `Analyze this note and suggest links and tags.

## Note Title
${noteTitle}

## Note Content
${noteContent}

## Vault Context

### Existing Notes (can link to these)
${context.existingNotes.slice(0, 100).join('\n')}
${context.existingNotes.length > 100 ? `\n... and ${context.existingNotes.length - 100} more notes` : ''}

### Existing Tags in Vault
${context.existingTags.slice(0, 50).join(', ')}

### User's Predefined Tags (prefer these)
${context.predefinedTags.join(', ') || 'None specified'}

### Whitelist Words (always consider)
${context.whitelistWords.join(', ') || 'None'}

### Blacklist Words (never link/tag)
${context.blacklistWords.join(', ') || 'None'}

## Response Format
Respond with valid JSON only, no other text:
{
  "suggestedLinks": [
    {
      "targetText": "text in note to make a link",
      "linkTarget": "existing note name",
      "reasoning": "why this connection makes sense",
      "confidence": 0.85
    }
  ],
  "suggestedTags": [
    {
      "tag": "#tag-name",
      "location": "frontmatter",
      "reasoning": "why this tag fits",
      "confidence": 0.9
    }
  ],
  "keyConcepts": ["concept1", "concept2"],
  "summary": "Brief summary of the note"
}`;
}

/**
 * Generate prompt for batch note analysis (more efficient)
 */
export function getBatchAnalysisPrompt(
	notes: { title: string; content: string }[],
	context: VaultContext
): string {
	const notesSection = notes
		.map((n, i) => `### Note ${i + 1}: ${n.title}\n${n.content.slice(0, 500)}${n.content.length > 500 ? '...' : ''}`)
		.join('\n\n');

	return `Analyze these notes and suggest links and tags for each.

## Notes to Analyze
${notesSection}

## Vault Context
Existing notes: ${context.existingNotes.slice(0, 50).join(', ')}
Existing tags: ${context.existingTags.slice(0, 30).join(', ')}
Predefined tags: ${context.predefinedTags.join(', ') || 'None'}

## Response Format
Respond with valid JSON array, one result per note:
[
  {
    "noteTitle": "Note 1 title",
    "suggestedLinks": [...],
    "suggestedTags": [...],
    "keyConcepts": [...],
    "summary": "..."
  }
]`;
}
