/**
 * Linking Engine
 * Handles intelligent link detection and creation between notes
 */

import { App, TFile } from 'obsidian';
import { ClaudeService } from '../services/claude-service';
import { VaultOperations } from '../services/vault-operations';
import { ChangelogService } from '../services/changelog-service';
import { SuggestedLink, VaultContext } from '../types';

export interface LinkingResult {
	/** Links that were applied */
	appliedLinks: SuggestedLink[];
	/** Links that were skipped (low confidence, already exists, etc.) */
	skippedLinks: SuggestedLink[];
	/** Whether any changes were made */
	modified: boolean;
}

export class LinkingEngine {
	private app: App;
	private claudeService: ClaudeService;
	private vaultOps: VaultOperations;
	private changelogService: ChangelogService;

	/** Minimum confidence to apply a link */
	private confidenceThreshold = 0.7;

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
	 * Set the confidence threshold for applying links
	 */
	setConfidenceThreshold(threshold: number): void {
		this.confidenceThreshold = Math.max(0, Math.min(1, threshold));
	}

	/**
	 * Process a note and add intelligent links
	 */
	async processNote(
		file: TFile,
		context: VaultContext
	): Promise<LinkingResult> {
		const result: LinkingResult = {
			appliedLinks: [],
			skippedLinks: [],
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

		// Filter and validate links
		const validLinks = this.filterLinks(
			analysis.suggestedLinks,
			originalContent,
			context.existingNotes
		);

		// Apply valid links
		if (validLinks.toApply.length > 0) {
			// Record before state
			const changeId = this.changelogService.recordBefore(file.path, originalContent);

			// Apply links
			const newContent = this.vaultOps.applyLinks(originalContent, validLinks.toApply);

			// Only write if content changed
			if (newContent !== originalContent) {
				await this.vaultOps.writeNote(file, newContent);

				// Record after state
				this.changelogService.recordAfter(
					changeId,
					newContent,
					'link_added',
					`Added ${validLinks.toApply.length} link(s) to ${file.basename}`,
					{
						type: 'link_added',
						originalText: validLinks.toApply.map(l => l.targetText).join(', '),
						linkTarget: validLinks.toApply.map(l => l.linkTarget).join(', '),
						position: { line: 0, start: 0, end: 0 } // Simplified
					}
				);

				result.modified = true;
			}

			result.appliedLinks = validLinks.toApply;
		}

		result.skippedLinks = validLinks.toSkip;
		return result;
	}

	/**
	 * Filter links based on validity and confidence
	 */
	private filterLinks(
		links: SuggestedLink[],
		content: string,
		existingNotes: string[]
	): { toApply: SuggestedLink[]; toSkip: SuggestedLink[] } {
		const toApply: SuggestedLink[] = [];
		const toSkip: SuggestedLink[] = [];

		for (const link of links) {
			// Check confidence threshold
			if (link.confidence < this.confidenceThreshold) {
				toSkip.push(link);
				continue;
			}

			// Check if target note exists
			if (!existingNotes.includes(link.linkTarget)) {
				toSkip.push(link);
				continue;
			}

			// Check if link already exists in content
			if (content.includes(`[[${link.linkTarget}]]`)) {
				toSkip.push(link);
				continue;
			}

			// Check if the target text exists in content
			if (!content.toLowerCase().includes(link.targetText.toLowerCase())) {
				toSkip.push(link);
				continue;
			}

			// Check if target text is already inside a link
			const linkRegex = /\[\[([^\]]+)\]\]/g;
			let isInsideLink = false;
			let match;
			while ((match = linkRegex.exec(content)) !== null) {
				if (match[0].toLowerCase().includes(link.targetText.toLowerCase())) {
					isInsideLink = true;
					break;
				}
			}
			if (isInsideLink) {
				toSkip.push(link);
				continue;
			}

			toApply.push(link);
		}

		return { toApply, toSkip };
	}

	/**
	 * Find notes that should be updated with backlinks to a new/modified note
	 */
	async findBacklinkCandidates(
		sourceFile: TFile,
		context: VaultContext
	): Promise<TFile[]> {
		const candidates: TFile[] = [];
		const sourceTitle = sourceFile.basename.toLowerCase();

		// Get all markdown files
		const files = this.app.vault.getMarkdownFiles();

		for (const file of files) {
			// Skip the source file
			if (file.path === sourceFile.path) continue;

			// Read content
			const content = await this.vaultOps.readNote(file);
			const lowerContent = content.toLowerCase();

			// Check if source title is mentioned but not linked
			if (
				lowerContent.includes(sourceTitle) &&
				!content.includes(`[[${sourceFile.basename}]]`)
			) {
				candidates.push(file);
			}
		}

		return candidates;
	}

	/**
	 * Process backlinks for related notes
	 */
	async processBacklinks(
		sourceFile: TFile,
		context: VaultContext
	): Promise<number> {
		const candidates = await this.findBacklinkCandidates(sourceFile, context);
		let updatedCount = 0;

		for (const file of candidates) {
			const content = await this.vaultOps.readNote(file);

			// Create a simple link suggestion for the source file
			const link: SuggestedLink = {
				targetText: sourceFile.basename,
				linkTarget: sourceFile.basename,
				reasoning: 'Backlink to recently created/modified note',
				confidence: 0.8
			};

			// Apply if target text exists
			if (content.toLowerCase().includes(sourceFile.basename.toLowerCase())) {
				const changeId = this.changelogService.recordBefore(file.path, content);
				const newContent = this.vaultOps.applyLinks(content, [link]);

				if (newContent !== content) {
					await this.vaultOps.writeNote(file, newContent);
					this.changelogService.recordAfter(
						changeId,
						newContent,
						'link_added',
						`Added backlink to ${sourceFile.basename} in ${file.basename}`,
						{
							type: 'link_added',
							originalText: sourceFile.basename,
							linkTarget: sourceFile.basename,
							position: { line: 0, start: 0, end: 0 }
						}
					);
					updatedCount++;
				}
			}
		}

		return updatedCount;
	}
}
