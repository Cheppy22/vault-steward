/**
 * Vault Operations Service
 * Handles all file operations within the Obsidian vault
 */

import { App, TFile, TFolder, Vault, MetadataCache } from 'obsidian';
import { VaultContext, SuggestedLink, SuggestedTag } from '../types';

// Debug logging utility
const DEBUG_PREFIX = 'Vault Steward';
const debug = {
	log: (...args: unknown[]) => console.log(`[${DEBUG_PREFIX}]`, ...args),
	error: (...args: unknown[]) => console.error(`[${DEBUG_PREFIX}]`, ...args)
};

export class VaultOperations {
	private app: App;
	private vault: Vault;
	private metadataCache: MetadataCache;

	constructor(app: App) {
		this.app = app;
		this.vault = app.vault;
		this.metadataCache = app.metadataCache;
	}

	/**
	 * Get context about the vault for Claude analysis
	 */
	getVaultContext(settings: {
		predefinedTags: string[];
		whitelistWords: string[];
		blacklistWords: string[];
	}): VaultContext {
		return {
			existingNotes: this.getAllNoteTitles(),
			existingTags: this.getAllTags(),
			predefinedTags: settings.predefinedTags,
			whitelistWords: settings.whitelistWords,
			blacklistWords: settings.blacklistWords
		};
	}

	/**
	 * Get all markdown note titles in the vault
	 */
	getAllNoteTitles(): string[] {
		return this.vault.getMarkdownFiles()
			.map(file => file.basename)
			.sort();
	}

	/**
	 * Get all tags used in the vault
	 */
	getAllTags(): string[] {
		const tags = new Set<string>();

		// Get tags from metadata cache
		const allFiles = this.vault.getMarkdownFiles();
		for (const file of allFiles) {
			const cache = this.metadataCache.getFileCache(file);
			if (cache?.tags) {
				cache.tags.forEach(t => tags.add(t.tag));
			}
			if (cache?.frontmatter?.tags) {
				const fmTags = cache.frontmatter.tags;
				if (Array.isArray(fmTags)) {
					fmTags.forEach(t => tags.add(`#${t}`));
				} else if (typeof fmTags === 'string') {
					tags.add(`#${fmTags}`);
				}
			}
		}

		return Array.from(tags).sort();
	}

	/**
	 * Read the content of a note
	 */
	async readNote(file: TFile): Promise<string> {
		return await this.vault.read(file);
	}

	/**
	 * Write content to a note
	 */
	async writeNote(file: TFile, content: string): Promise<void> {
		await this.vault.modify(file, content);
	}

	/**
	 * Apply suggested links to note content
	 */
	applyLinks(content: string, links: SuggestedLink[]): string {
		let result = content;
		debug.log('VaultOps.applyLinks: Starting with', links.length, 'links');

		// Sort links by position (process from end to start to preserve positions)
		const sortedLinks = [...links].sort((a, b) => {
			const posA = result.toLowerCase().indexOf(a.targetText.toLowerCase());
			const posB = result.toLowerCase().indexOf(b.targetText.toLowerCase());
			return posB - posA; // Reverse order
		});

		for (const link of sortedLinks) {
			debug.log('VaultOps.applyLinks: Processing link:', {
				targetText: link.targetText,
				linkTarget: link.linkTarget,
				confidence: link.confidence
			});

			// Skip if target note is already linked anywhere in document
			if (result.includes(`[[${link.linkTarget}]]`) || result.includes(`[[${link.linkTarget}|`)) {
				debug.log('VaultOps.applyLinks: Skipping - already linked');
				continue;
			}

			// Skip if the target text is already inside a wiki-link
			const alreadyLinkedRegex = new RegExp(`\\[\\[[^\\]]*${this.escapeRegex(link.targetText)}[^\\]]*\\]\\]`, 'i');
			if (alreadyLinkedRegex.test(result)) {
				debug.log('VaultOps.applyLinks: Skipping - text already inside a link');
				continue;
			}

			// Find the target text (case-insensitive)
			const regex = new RegExp(this.escapeRegex(link.targetText), 'gi');
			const match = regex.exec(result);

			if (match) {
				debug.log('VaultOps.applyLinks: Found match at index', match.index, ':', match[0]);

				// Replace first occurrence with wiki-link
				const before = result.slice(0, match.index);
				const after = result.slice(match.index + match[0].length);

				// Create the wiki-link - use pipe syntax if display text differs from target
				const displayText = match[0].toLowerCase() !== link.linkTarget.toLowerCase()
					? `${link.linkTarget}|${match[0]}`
					: link.linkTarget;

				result = `${before}[[${displayText}]]${after}`;
				debug.log('VaultOps.applyLinks: Applied link [[' + displayText + ']]');
			} else {
				debug.log('VaultOps.applyLinks: No match found for targetText:', link.targetText);
			}
		}

		debug.log('VaultOps.applyLinks: Content changed:', result !== content);
		return result;
	}

	/**
	 * Apply suggested tags to note content
	 */
	applyTags(content: string, tags: SuggestedTag[]): string {
		debug.log('VaultOps.applyTags: Starting with', tags.length, 'tags');

		// Extract all existing tags from content (both frontmatter and inline)
		const existingTags = this.extractExistingTags(content);
		debug.log('VaultOps.applyTags: Existing tags in note:', existingTags);

		const frontmatterTags: string[] = [];
		const inlineTags: string[] = [];

		for (const tag of tags) {
			// Normalize tag name (without #, lowercase for comparison)
			const tagName = tag.tag.startsWith('#') ? tag.tag.slice(1) : tag.tag;
			const tagNameLower = tagName.toLowerCase();

			debug.log('VaultOps.applyTags: Processing tag:', tagName, 'location:', tag.location);

			// Skip if tag already exists (case-insensitive check)
			if (existingTags.some(t => t.toLowerCase() === tagNameLower)) {
				debug.log('VaultOps.applyTags: Skipping - tag already exists');
				continue;
			}

			if (tag.location === 'frontmatter') {
				frontmatterTags.push(tagName);
			} else {
				inlineTags.push(`#${tagName}`);
			}
		}

		let result = content;

		// Add frontmatter tags
		if (frontmatterTags.length > 0) {
			debug.log('VaultOps.applyTags: Adding frontmatter tags:', frontmatterTags);
			result = this.addFrontmatterTags(result, frontmatterTags);
		}

		// Add inline tags at the end of the document
		if (inlineTags.length > 0) {
			debug.log('VaultOps.applyTags: Adding inline tags:', inlineTags);
			const tagLine = inlineTags.join(' ');
			result = result.trimEnd() + '\n\n' + tagLine;
		}

		debug.log('VaultOps.applyTags: Content changed:', result !== content);
		return result;
	}

	/**
	 * Extract all existing tags from content (frontmatter and inline)
	 */
	private extractExistingTags(content: string): string[] {
		const tags: string[] = [];

		// Extract frontmatter tags
		const frontmatterRegex = /^---\n([\s\S]*?)\n---/;
		const fmMatch = content.match(frontmatterRegex);
		if (fmMatch) {
			const tagsLineMatch = fmMatch[1].match(/^tags:\s*(\[.*?\]|.*?)$/m);
			if (tagsLineMatch) {
				const parsed = this.parseFrontmatterTags(tagsLineMatch[1]);
				tags.push(...parsed);
			}
		}

		// Extract inline tags (matches #tagname but not inside links or code)
		const inlineTagRegex = /(?:^|[\s])#([a-zA-Z][a-zA-Z0-9_/-]*)/g;
		let match;
		while ((match = inlineTagRegex.exec(content)) !== null) {
			tags.push(match[1]);
		}

		return tags;
	}

	/**
	 * Add tags to frontmatter
	 */
	private addFrontmatterTags(content: string, tags: string[]): string {
		const frontmatterRegex = /^---\n([\s\S]*?)\n---/;
		const match = content.match(frontmatterRegex);

		if (match) {
			// Existing frontmatter - parse and add tags
			let frontmatter = match[1];
			const tagsMatch = frontmatter.match(/^tags:\s*(\[.*?\]|.*?)$/m);

			if (tagsMatch) {
				// Tags field exists - merge with case-insensitive deduplication
				const existingTags = this.parseFrontmatterTags(tagsMatch[1]);
				const existingLower = new Set(existingTags.map(t => t.toLowerCase()));

				// Only add tags that don't already exist (case-insensitive)
				const newTags = tags.filter(t => !existingLower.has(t.toLowerCase()));
				const allTags = [...existingTags, ...newTags];

				const newTagsLine = `tags: [${allTags.join(', ')}]`;
				frontmatter = frontmatter.replace(/^tags:.*$/m, newTagsLine);
			} else {
				// No tags field - add one
				frontmatter += `\ntags: [${tags.join(', ')}]`;
			}

			return content.replace(frontmatterRegex, `---\n${frontmatter}\n---`);
		} else {
			// No frontmatter - create one
			const newFrontmatter = `---\ntags: [${tags.join(', ')}]\n---\n\n`;
			return newFrontmatter + content;
		}
	}

	/**
	 * Parse tags from frontmatter value
	 */
	private parseFrontmatterTags(value: string): string[] {
		// Handle array format: [tag1, tag2]
		if (value.startsWith('[')) {
			return value
				.slice(1, -1)
				.split(',')
				.map(t => t.trim())
				.filter(t => t.length > 0);
		}
		// Handle single value
		return [value.trim()].filter(t => t.length > 0);
	}

	/**
	 * Escape special regex characters
	 */
	private escapeRegex(str: string): string {
		return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	}

	/**
	 * Get file by path
	 */
	getFileByPath(path: string): TFile | null {
		const file = this.vault.getAbstractFileByPath(path);
		return file instanceof TFile ? file : null;
	}

	/**
	 * Ensure a folder exists, creating it if necessary
	 */
	async ensureFolder(path: string): Promise<TFolder> {
		const existing = this.vault.getAbstractFileByPath(path);
		if (existing instanceof TFolder) {
			return existing;
		}

		await this.vault.createFolder(path);
		return this.vault.getAbstractFileByPath(path) as TFolder;
	}
}
