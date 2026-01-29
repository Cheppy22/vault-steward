/**
 * Tagging Engine
 * Handles intelligent tag application to notes
 */

import { App, TFile } from 'obsidian';
import { ClaudeService } from '../services/claude-service';
import { VaultOperations } from '../services/vault-operations';
import { ChangelogService } from '../services/changelog-service';
import { SuggestedTag, VaultContext } from '../types';

export interface TaggingResult {
	/** Tags that were applied */
	appliedTags: SuggestedTag[];
	/** Tags that were skipped */
	skippedTags: SuggestedTag[];
	/** Whether any changes were made */
	modified: boolean;
}

export class TaggingEngine {
	private app: App;
	private claudeService: ClaudeService;
	private vaultOps: VaultOperations;
	private changelogService: ChangelogService;

	/** Minimum confidence to apply a tag */
	private confidenceThreshold = 0.7;

	/** Whether to allow generation of new tags */
	private allowNewTags = true;

	constructor(
		app: App,
		claudeService: ClaudeService,
		vaultOps: VaultOperations,
		changelogService: ChangelogService
	) {
		this.app = app;
		this.claudeService = claudeService;
		this.vaultOps = vaultOps;
		this.changelogService = changelogService;
	}

	/**
	 * Set the confidence threshold for applying tags
	 */
	setConfidenceThreshold(threshold: number): void {
		this.confidenceThreshold = Math.max(0, Math.min(1, threshold));
	}

	/**
	 * Set whether new tags can be generated
	 */
	setAllowNewTags(allow: boolean): void {
		this.allowNewTags = allow;
	}

	/**
	 * Process a note and add intelligent tags
	 */
	async processNote(
		file: TFile,
		context: VaultContext
	): Promise<TaggingResult> {
		const result: TaggingResult = {
			appliedTags: [],
			skippedTags: [],
			modified: false
		};

		// Read current content
		const originalContent = await this.vaultOps.readNote(file);

		// Get suggestions from Claude
		const analysis = await this.claudeService.analyzeNote(
			file.basename,
			originalContent,
			context
		);

		// Filter and validate tags
		const validTags = this.filterTags(
			analysis.suggestedTags,
			originalContent,
			context
		);

		// Apply valid tags
		if (validTags.toApply.length > 0) {
			// Record before state
			const changeId = this.changelogService.recordBefore(file.path, originalContent);

			// Apply tags
			const newContent = this.vaultOps.applyTags(originalContent, validTags.toApply);

			// Only write if content changed
			if (newContent !== originalContent) {
				await this.vaultOps.writeNote(file, newContent);

				// Record after state
				const tagNames = validTags.toApply.map(t => t.tag).join(', ');
				this.changelogService.recordAfter(
					changeId,
					newContent,
					'tag_added',
					`Added tags (${tagNames}) to ${file.basename}`,
					{
						type: 'tag_added',
						tag: tagNames,
						location: validTags.toApply[0]?.location || 'frontmatter'
					}
				);

				result.modified = true;
			}

			result.appliedTags = validTags.toApply;
		}

		result.skippedTags = validTags.toSkip;
		return result;
	}

	/**
	 * Filter tags based on validity and confidence
	 */
	private filterTags(
		tags: SuggestedTag[],
		content: string,
		context: VaultContext
	): { toApply: SuggestedTag[]; toSkip: SuggestedTag[] } {
		const toApply: SuggestedTag[] = [];
		const toSkip: SuggestedTag[] = [];

		for (const tag of tags) {
			// Normalize tag
			const normalizedTag = tag.tag.startsWith('#') ? tag.tag : `#${tag.tag}`;

			// Check confidence threshold
			if (tag.confidence < this.confidenceThreshold) {
				toSkip.push(tag);
				continue;
			}

			// Check if tag already exists in content
			if (content.includes(normalizedTag)) {
				toSkip.push(tag);
				continue;
			}

			// Check if tag is in frontmatter
			if (this.isTagInFrontmatter(content, normalizedTag.slice(1))) {
				toSkip.push(tag);
				continue;
			}

			// Check if tag is blacklisted
			if (context.blacklistWords.some(w =>
				normalizedTag.toLowerCase().includes(w.toLowerCase())
			)) {
				toSkip.push(tag);
				continue;
			}

			// If not allowing new tags, check if it exists in vault or predefined
			if (!this.allowNewTags) {
				const existsInVault = context.existingTags.includes(normalizedTag);
				const isPredefined = context.predefinedTags.some(
					p => p.toLowerCase() === normalizedTag.toLowerCase() ||
						p.toLowerCase() === normalizedTag.slice(1).toLowerCase()
				);

				if (!existsInVault && !isPredefined) {
					toSkip.push(tag);
					continue;
				}
			}

			toApply.push(tag);
		}

		return { toApply, toSkip };
	}

	/**
	 * Check if a tag exists in frontmatter
	 */
	private isTagInFrontmatter(content: string, tagWithoutHash: string): boolean {
		const frontmatterRegex = /^---\n([\s\S]*?)\n---/;
		const match = content.match(frontmatterRegex);

		if (!match) return false;

		const frontmatter = match[1];
		const tagsMatch = frontmatter.match(/^tags:\s*(.*)$/m);

		if (!tagsMatch) return false;

		const tagsLine = tagsMatch[1];
		return tagsLine.toLowerCase().includes(tagWithoutHash.toLowerCase());
	}

	/**
	 * Suggest tags for a note without applying them
	 */
	async suggestTags(
		file: TFile,
		context: VaultContext
	): Promise<SuggestedTag[]> {
		const content = await this.vaultOps.readNote(file);

		const analysis = await this.claudeService.analyzeNote(
			file.basename,
			content,
			context
		);

		return analysis.suggestedTags;
	}

	/**
	 * Get all unique tags used across the vault
	 */
	getVaultTags(): string[] {
		return this.vaultOps.getAllTags();
	}

	/**
	 * Analyze tag distribution across the vault
	 */
	async analyzeTagDistribution(): Promise<Map<string, number>> {
		const distribution = new Map<string, number>();
		const files = this.app.vault.getMarkdownFiles();

		for (const file of files) {
			const content = await this.vaultOps.readNote(file);

			// Find inline tags
			const inlineTagRegex = /#[\w-]+/g;
			let match;
			while ((match = inlineTagRegex.exec(content)) !== null) {
				const tag = match[0];
				distribution.set(tag, (distribution.get(tag) || 0) + 1);
			}

			// Find frontmatter tags
			const frontmatterRegex = /^---\n([\s\S]*?)\n---/;
			const fmMatch = content.match(frontmatterRegex);
			if (fmMatch) {
				const tagsMatch = fmMatch[1].match(/^tags:\s*\[?(.*?)\]?$/m);
				if (tagsMatch) {
					const tags = tagsMatch[1]
						.split(',')
						.map(t => t.trim())
						.filter(t => t.length > 0);

					for (const tag of tags) {
						const normalizedTag = tag.startsWith('#') ? tag : `#${tag}`;
						distribution.set(normalizedTag, (distribution.get(normalizedTag) || 0) + 1);
					}
				}
			}
		}

		return distribution;
	}
}
