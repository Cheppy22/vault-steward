/**
 * Vault Steward - AI-powered note organization for Obsidian
 *
 * This plugin uses Claude AI to intelligently link and tag notes.
 */

import { Plugin, Notice, TFile, debounce } from 'obsidian';
import { VaultStewardSettings, DEFAULT_SETTINGS, VaultStewardSettingTab, DEFAULT_TOKEN_USAGE } from './settings';
import { claudeService } from './services/claude-service';
import { VaultOperations } from './services/vault-operations';
import { ChangelogService } from './services/changelog-service';
import { PreferencesEngine } from './engines/preferences-engine';
import { VaultContext, NoteAnalysisResult, SuggestedLink, SuggestedTag } from './types';
import { ChangelogModal } from './ui/changelog-modal';
import { PromptOptions } from './prompts/analysis-prompts';

// Debug logging utility
const DEBUG_PREFIX = 'Vault Steward';
const debug = {
	log: (...args: unknown[]) => console.log(`[${DEBUG_PREFIX}]`, ...args),
	warn: (...args: unknown[]) => console.warn(`[${DEBUG_PREFIX}]`, ...args),
	error: (...args: unknown[]) => console.error(`[${DEBUG_PREFIX}]`, ...args),
	info: (...args: unknown[]) => console.info(`[${DEBUG_PREFIX}]`, ...args),
	group: (label: string) => console.group(`[${DEBUG_PREFIX}] ${label}`),
	groupEnd: () => console.groupEnd(),
	table: (data: unknown) => console.table(data)
};

export default class VaultStewardPlugin extends Plugin {
	settings: VaultStewardSettings;
	private vaultOps: VaultOperations;
	private changelog: ChangelogService;
	private preferences: PreferencesEngine;
	private statusBar: HTMLElement;
	private processingFiles: Set<string> = new Set();
	private progressEl: HTMLElement | null = null;

	async onload() {
		await this.loadSettings();

		// Initialize services (lazy - no heavy work here)
		this.vaultOps = new VaultOperations(this.app);
		this.changelog = new ChangelogService(this.app);
		this.preferences = new PreferencesEngine(this.app, this.vaultOps);

		// Initialize Claude service with API key
		claudeService.setApiKey(this.settings.apiKey);

		// Initialize changelog and preferences (creates folders if needed)
		this.changelog.initialize().catch(err => {
			console.error('Failed to initialize changelog:', err);
		});
		this.preferences.initialize().catch(err => {
			console.error('Failed to initialize preferences:', err);
		});

		// Ribbon icon for quick access
		this.addRibbonIcon('wand-2', 'Vault Steward: Process current note', () => {
			this.processCurrentNote();
		});

		// Command: Process current note
		this.addCommand({
			id: 'process-current-note',
			name: 'Process current note',
			callback: () => this.processCurrentNote(),
		});

		// Command: Process entire vault
		this.addCommand({
			id: 'process-entire-vault',
			name: 'Process entire vault',
			callback: () => this.processEntireVault(),
		});

		// Command: Analyze vault and learn preferences
		this.addCommand({
			id: 'analyze-vault',
			name: 'Analyze vault and learn preferences',
			callback: () => this.analyzeVaultPreferences(),
		});

		// Command: Open changelog
		this.addCommand({
			id: 'open-changelog',
			name: 'Open changelog',
			callback: () => this.openChangelog(),
		});

		// Command: Process backlinks for current note
		this.addCommand({
			id: 'process-backlinks',
			name: 'Add backlinks to current note',
			callback: () => this.processBacklinks(),
		});

		// Command: Show debug info
		this.addCommand({
			id: 'show-debug-info',
			name: 'Show debug info',
			callback: () => this.showDebugInfo(),
		});

		// Settings tab
		this.addSettingTab(new VaultStewardSettingTab(this.app, this));

		// Status bar
		this.statusBar = this.addStatusBarItem();
		this.statusBar.setText('Steward: Ready');

		// Auto-process on save (debounced) - always register, checks setting at runtime
		this.registerAutoProcess();

		console.log('Vault Steward loaded');
	}

	onunload() {
		// Clean up progress bar if it exists
		this.hideProgress();
		console.log('Vault Steward unloaded');
	}

	async loadSettings() {
		const loaded = await this.loadData();
		this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded);

		// Ensure tokenUsage exists (for upgrades from older versions)
		if (!this.settings.tokenUsage) {
			this.settings.tokenUsage = { ...DEFAULT_TOKEN_USAGE };
		}
	}

	async saveSettings() {
		const wasAutoProcessEnabled = this.settings.autoProcessOnSave;
		await this.saveData(this.settings);
		// Update Claude service with new API key
		claudeService.setApiKey(this.settings.apiKey);

		// Handle auto-process toggle (note: we can't unregister events easily,
		// so we track state in the handler itself)
	}

	/**
	 * Process the currently active note
	 */
	async processCurrentNote() {
		const activeFile = this.app.workspace.getActiveFile();

		if (!activeFile) {
			new Notice('No active note to process');
			return;
		}

		if (activeFile.extension !== 'md') {
			new Notice('Active file is not a markdown note');
			return;
		}

		if (!this.settings.apiKey) {
			new Notice('Please configure your Anthropic API key in settings');
			return;
		}

		new Notice(`Processing: ${activeFile.basename}...`);

		try {
			// Read note content
			const originalContent = await this.app.vault.read(activeFile);
			debug.log('Original content length:', originalContent.length);

			// Build vault context
			const context = this.buildVaultContext();
			debug.log('Vault context - notes:', context.existingNotes.length, 'tags:', context.existingTags.length);

			// Build prompt options based on settings
			const promptOptions: PromptOptions = {
				allowNewTags: this.settings.enableTagGeneration,
				enableLinking: this.settings.enableAutoLinking,
				enableTagging: this.settings.enableAutoTagging
			};

			// Call Claude API
			const result = await claudeService.analyzeNote(
				activeFile.basename,
				originalContent,
				context,
				undefined,
				promptOptions
			);

			// Track token usage
			await this.trackTokenUsage();

			// Filter suggestions based on confidence thresholds and feature toggles
			const linksToApply = this.settings.enableAutoLinking
				? result.suggestedLinks.filter(l => l.confidence >= this.settings.linkConfidenceThreshold)
				: [];
			const tagsToApply = this.settings.enableAutoTagging
				? result.suggestedTags.filter(t => t.confidence >= this.settings.tagConfidenceThreshold)
				: [];

			// Apply preferred tag location from settings
			const tagsWithLocation = tagsToApply.map(tag => ({
				...tag,
				location: this.settings.preferredTagLocation
			}));

			debug.log('Filtered suggestions -',
				'links:', linksToApply.length, '/', result.suggestedLinks.length,
				'tags:', tagsWithLocation.length, '/', result.suggestedTags.length,
				'threshold:', this.settings.linkConfidenceThreshold
			);

			// Apply changes if there are any
			let appliedCount = { links: 0, tags: 0 };
			if (linksToApply.length > 0 || tagsWithLocation.length > 0) {
				appliedCount = await this.applyChanges(activeFile, originalContent, linksToApply, tagsWithLocation);
			}

			// Display results
			this.displayAnalysisResults(activeFile.basename, result, appliedCount.links, appliedCount.tags);

		} catch (error) {
			debug.error('Error processing note:', error);
			if (error && typeof error === 'object' && 'message' in error) {
				new Notice(`Error: ${(error as { message: string }).message}`);
			} else {
				new Notice('Error processing note. Check console for details.');
			}
		}
	}

	/**
	 * Apply links and tags to a note with changelog tracking
	 * Returns the count of actually applied changes
	 */
	private async applyChanges(
		file: TFile,
		originalContent: string,
		links: SuggestedLink[],
		tags: SuggestedTag[]
	): Promise<{ links: number; tags: number }> {
		debug.log('applyChanges: Starting for', file.basename);

		// Start changelog session
		this.changelog.startSession();

		// Record the before state
		const changeId = this.changelog.recordBefore(file.path, originalContent);

		// Apply links
		let modifiedContent = originalContent;
		let contentAfterLinks = originalContent;
		if (links.length > 0) {
			contentAfterLinks = this.vaultOps.applyLinks(modifiedContent, links);
			modifiedContent = contentAfterLinks;
		}

		// Apply tags
		let contentAfterTags = modifiedContent;
		if (tags.length > 0) {
			contentAfterTags = this.vaultOps.applyTags(modifiedContent, tags);
			modifiedContent = contentAfterTags;
		}

		// Count actual changes by comparing content
		const linksApplied = contentAfterLinks !== originalContent ? links.length : 0;
		const tagsApplied = contentAfterTags !== contentAfterLinks ? tags.length : 0;

		debug.log('applyChanges: Content changed:', modifiedContent !== originalContent);
		debug.log('applyChanges: Links applied:', linksApplied, 'Tags applied:', tagsApplied);

		// Only write if content changed
		if (modifiedContent !== originalContent) {
			debug.log('applyChanges: Writing modified content to file');
			await this.app.vault.modify(file, modifiedContent);

			// Record the change details
			const linkSummary = linksApplied > 0 ? `${linksApplied} link(s)` : '';
			const tagSummary = tagsApplied > 0 ? `${tagsApplied} tag(s)` : '';
			const summary = [linkSummary, tagSummary].filter(Boolean).join(', ');

			this.changelog.recordAfter(
				changeId,
				modifiedContent,
				'content_modified',
				`Added ${summary} to ${file.basename}`,
				{
					type: 'content_modified',
					summary: `Applied: ${summary}`
				}
			);
		} else {
			debug.log('applyChanges: No changes to write');
		}

		// End session
		await this.changelog.endSession();

		return { links: linksApplied, tags: tagsApplied };
	}

	/**
	 * Build context about the vault for Claude
	 */
	private buildVaultContext(): VaultContext {
		// Get all markdown files
		const files = this.app.vault.getMarkdownFiles();
		const existingNotes = files.map(f => f.basename);

		// Get all tags from the vault
		const existingTags = this.getAllVaultTags();

		return {
			existingNotes,
			existingTags,
			predefinedTags: this.settings.predefinedTags,
			whitelistWords: this.settings.whitelistWords,
			blacklistWords: this.settings.blacklistWords,
		};
	}

	/**
	 * Get all unique tags used in the vault
	 */
	private getAllVaultTags(): string[] {
		const tags = new Set<string>();
		const files = this.app.vault.getMarkdownFiles();

		for (const file of files) {
			const cache = this.app.metadataCache.getFileCache(file);
			if (cache?.tags) {
				for (const tag of cache.tags) {
					tags.add(tag.tag);
				}
			}
			// Also get frontmatter tags
			if (cache?.frontmatter?.tags) {
				const fmTags = cache.frontmatter.tags;
				if (Array.isArray(fmTags)) {
					for (const tag of fmTags) {
						tags.add(tag.startsWith('#') ? tag : `#${tag}`);
					}
				} else if (typeof fmTags === 'string') {
					tags.add(fmTags.startsWith('#') ? fmTags : `#${fmTags}`);
				}
			}
		}

		return Array.from(tags);
	}

	/**
	 * Display analysis results to the user
	 */
	private displayAnalysisResults(
		noteTitle: string,
		result: NoteAnalysisResult,
		appliedLinks: number = 0,
		appliedTags: number = 0
	) {
		const totalSuggested = result.suggestedLinks.length + result.suggestedTags.length;

		if (totalSuggested === 0) {
			new Notice(`${noteTitle}: No suggestions found`);
			return;
		}

		// Log detailed results to console
		debug.log('Analysis Results:', {
			note: noteTitle,
			links: result.suggestedLinks,
			tags: result.suggestedTags,
			concepts: result.keyConcepts,
			summary: result.summary,
			applied: { links: appliedLinks, tags: appliedTags }
		});

		// Show summary notice
		const appliedParts: string[] = [];
		if (appliedLinks > 0) appliedParts.push(`${appliedLinks} link${appliedLinks > 1 ? 's' : ''}`);
		if (appliedTags > 0) appliedParts.push(`${appliedTags} tag${appliedTags > 1 ? 's' : ''}`);

		if (appliedParts.length > 0) {
			new Notice(`${noteTitle}: Applied ${appliedParts.join(' and ')}`);
		} else {
			new Notice(`${noteTitle}: Found ${totalSuggested} suggestion(s) but none met threshold`);
		}
	}

	/**
	 * Open the changelog modal
	 */
	openChangelog() {
		const modal = new ChangelogModal(this.app, this.changelog);
		modal.open();
	}

	/**
	 * Process all markdown files in the vault
	 */
	async processEntireVault() {
		if (!this.settings.apiKey) {
			new Notice('Please configure your Anthropic API key in settings');
			return;
		}

		const allFiles = this.app.vault.getMarkdownFiles();
		// Filter out hidden files upfront
		const files = allFiles.filter(f => !f.path.startsWith('.'));
		const totalFiles = files.length;

		debug.log('Starting vault processing:', { totalFiles, allFilesCount: allFiles.length });

		if (totalFiles === 0) {
			new Notice('No notes found to process');
			return;
		}

		new Notice(`Processing ${totalFiles} notes... This may take a while.`);

		// Show progress bar
		this.showProgress(0, totalFiles, 'Starting...');

		let processed = 0;
		let modified = 0;
		let errors = 0;

		for (const file of files) {
			try {
				debug.log(`Processing file ${processed + 1}/${totalFiles}: ${file.basename}`);
				this.updateProgress(processed, totalFiles, file.basename);

				const result = await this.processFile(file);
				if (result.modified) {
					modified++;
					debug.log(`  -> Modified: ${file.basename}`);
				} else {
					debug.log(`  -> No changes: ${file.basename}`);
				}
				processed++;

				this.statusBar.setText(`Steward: Processing ${processed}/${totalFiles}`);

				// Small delay between files to avoid rate limiting
				await this.delay(500);
			} catch (error) {
				errors++;
				debug.error(`Error processing ${file.basename}:`, error);
				// Continue with next file instead of stopping
				processed++;
			}
		}

		// Hide progress bar
		this.hideProgress();

		this.statusBar.setText('Steward: Ready');

		// Show detailed results
		let resultMessage = `Vault processing complete: ${modified} of ${processed} notes modified`;
		if (errors > 0) {
			resultMessage += ` (${errors} error${errors > 1 ? 's' : ''})`;
		}
		new Notice(resultMessage);

		debug.log('Vault processing complete:', { processed, modified, errors, totalFiles });
	}

	/**
	 * Show the floating progress bar
	 */
	private showProgress(current: number, total: number, status: string) {
		// Remove existing progress bar if any
		this.hideProgress();

		// Create progress container
		this.progressEl = document.body.createDiv({ cls: 'vs-progress-container' });

		const header = this.progressEl.createDiv({ cls: 'vs-progress-header' });
		header.createSpan({ cls: 'vs-progress-title', text: 'Processing Vault' });
		header.createSpan({ cls: 'vs-progress-count', text: `${current}/${total}` });

		const barContainer = this.progressEl.createDiv({ cls: 'vs-progress-bar' });
		const fill = barContainer.createDiv({ cls: 'vs-progress-fill' });
		fill.style.width = `${(current / total) * 100}%`;

		this.progressEl.createDiv({ cls: 'vs-progress-status', text: status });
	}

	/**
	 * Update the progress bar
	 */
	private updateProgress(current: number, total: number, status: string) {
		if (!this.progressEl) return;

		const countEl = this.progressEl.querySelector('.vs-progress-count');
		if (countEl) countEl.textContent = `${current + 1}/${total}`;

		const fillEl = this.progressEl.querySelector('.vs-progress-fill') as HTMLElement;
		if (fillEl) fillEl.style.width = `${((current + 1) / total) * 100}%`;

		const statusEl = this.progressEl.querySelector('.vs-progress-status');
		if (statusEl) statusEl.textContent = status;
	}

	/**
	 * Hide and remove the progress bar
	 */
	private hideProgress() {
		if (this.progressEl) {
			this.progressEl.remove();
			this.progressEl = null;
		}
	}

	/**
	 * Process a single file (used by both processCurrentNote and processEntireVault)
	 */
	private async processFile(file: TFile): Promise<{ modified: boolean }> {
		const originalContent = await this.app.vault.read(file);
		const context = this.buildVaultContext();

		// Build prompt options based on settings
		const promptOptions: PromptOptions = {
			allowNewTags: this.settings.enableTagGeneration,
			enableLinking: this.settings.enableAutoLinking,
			enableTagging: this.settings.enableAutoTagging
		};

		const result = await claudeService.analyzeNote(
			file.basename,
			originalContent,
			context,
			undefined, // default request options
			promptOptions
		);

		// Track token usage from this API call
		await this.trackTokenUsage();

		// Filter suggestions based on confidence thresholds and feature toggles
		const linksToApply = this.settings.enableAutoLinking
			? result.suggestedLinks.filter(l => l.confidence >= this.settings.linkConfidenceThreshold)
			: [];
		const tagsToApply = this.settings.enableAutoTagging
			? result.suggestedTags.filter(t => t.confidence >= this.settings.tagConfidenceThreshold)
			: [];

		// Apply preferred tag location from settings
		const tagsWithLocation = tagsToApply.map(tag => ({
			...tag,
			location: this.settings.preferredTagLocation
		}));

		let modified = false;
		if (linksToApply.length > 0 || tagsWithLocation.length > 0) {
			const appliedCount = await this.applyChanges(file, originalContent, linksToApply, tagsWithLocation);
			modified = appliedCount.links > 0 || appliedCount.tags > 0;
		}

		return { modified };
	}

	/**
	 * Analyze the vault and learn user preferences
	 */
	async analyzeVaultPreferences() {
		new Notice('Analyzing vault to learn your preferences...');
		this.statusBar.setText('Steward: Analyzing...');

		try {
			await this.preferences.analyzeVault();

			const prefs = this.preferences.getPreferences();
			new Notice(
				`Analysis complete!\n` +
				`Found ${prefs.frequentTags.length} frequent tags\n` +
				`Avg ${prefs.avgTagsPerNote.toFixed(1)} tags per note\n` +
				`Avg ${prefs.avgLinksPerNote.toFixed(1)} links per note`
			);

			debug.log('Preferences:', prefs);
		} catch (error) {
			debug.error('Error analyzing vault:', error);
			new Notice('Error analyzing vault. Check console for details.');
		}

		this.statusBar.setText('Steward: Ready');
	}

	/**
	 * Register auto-process on file modify event
	 */
	private registerAutoProcess() {
		// Debounced handler to avoid processing while user is still typing
		const debouncedProcess = debounce(
			async (file: TFile) => {
				// Check setting at runtime (allows dynamic enable/disable)
				if (!this.settings.autoProcessOnSave) return;

				// Skip if already processing this file
				if (this.processingFiles.has(file.path)) return;

				// Skip non-markdown files
				if (file.extension !== 'md') return;

				// Skip hidden files
				if (file.path.startsWith('.')) return;

				// Skip if no API key
				if (!this.settings.apiKey) return;

				this.processingFiles.add(file.path);

				try {
					debug.log('Auto-processing', file.basename);
					await this.processFile(file);
				} catch (error) {
					debug.error('Auto-process error:', error);
				} finally {
					this.processingFiles.delete(file.path);
				}
			},
			2000, // 2 second debounce
			true  // Run on leading edge = false, trailing = true
		);

		this.registerEvent(
			this.app.vault.on('modify', (file) => {
				if (file instanceof TFile) {
					debouncedProcess(file);
				}
			})
		);
	}

	/**
	 * Helper to add delay between API calls
	 */
	private delay(ms: number): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, ms));
	}

	/**
	 * Track token usage from the last API call
	 */
	private async trackTokenUsage(): Promise<void> {
		const usage = claudeService.getLastUsage();
		if (!usage) return;

		// Update cumulative stats
		this.settings.tokenUsage.totalInputTokens += usage.inputTokens;
		this.settings.tokenUsage.totalOutputTokens += usage.outputTokens;
		this.settings.tokenUsage.totalCalls += 1;

		// Add to history (keep last 100 entries)
		this.settings.tokenUsage.history.push(usage);
		if (this.settings.tokenUsage.history.length > 100) {
			this.settings.tokenUsage.history = this.settings.tokenUsage.history.slice(-100);
		}

		// Save settings (debounced to avoid excessive writes)
		await this.saveData(this.settings);
	}

	/**
	 * Process backlinks - find notes that mention the current note and link them
	 */
	async processBacklinks() {
		const activeFile = this.app.workspace.getActiveFile();

		if (!activeFile) {
			new Notice('No active note to process backlinks for');
			return;
		}

		if (activeFile.extension !== 'md') {
			new Notice('Active file is not a markdown note');
			return;
		}

		new Notice(`Finding backlinks for: ${activeFile.basename}...`);
		this.statusBar.setText('Steward: Finding backlinks...');

		try {
			const sourceTitle = activeFile.basename.toLowerCase();
			const files = this.app.vault.getMarkdownFiles();
			let updatedCount = 0;

			// Start a changelog session for all backlink updates
			this.changelog.startSession();

			for (const file of files) {
				// Skip the source file and hidden files
				if (file.path === activeFile.path || file.path.startsWith('.')) continue;

				const content = await this.app.vault.read(file);
				const lowerContent = content.toLowerCase();

				// Check if source title is mentioned but not linked
				if (
					lowerContent.includes(sourceTitle) &&
					!content.includes(`[[${activeFile.basename}]]`) &&
					!content.includes(`[[${activeFile.basename}|`)
				) {
					// Create a link suggestion
					const link: SuggestedLink = {
						targetText: activeFile.basename,
						linkTarget: activeFile.basename,
						reasoning: 'Backlink to note',
						confidence: 0.8
					};

					const changeId = this.changelog.recordBefore(file.path, content);
					const newContent = this.vaultOps.applyLinks(content, [link]);

					if (newContent !== content) {
						await this.app.vault.modify(file, newContent);
						this.changelog.recordAfter(
							changeId,
							newContent,
							'link_added',
							`Added backlink to ${activeFile.basename} in ${file.basename}`,
							{
								type: 'link_added',
								originalText: activeFile.basename,
								linkTarget: activeFile.basename,
								position: { line: 0, start: 0, end: 0 }
							}
						);
						updatedCount++;
						debug.log(`Added backlink in ${file.basename}`);
					}
				}
			}

			await this.changelog.endSession();

			this.statusBar.setText('Steward: Ready');
			if (updatedCount > 0) {
				new Notice(`Added backlinks in ${updatedCount} note${updatedCount > 1 ? 's' : ''}`);
			} else {
				new Notice('No notes found that mention this note without linking');
			}
		} catch (error) {
			debug.error('Error processing backlinks:', error);
			new Notice('Error processing backlinks. Check console for details.');
			this.statusBar.setText('Steward: Ready');
		}
	}

	/**
	 * Show debug information about the plugin state
	 */
	showDebugInfo() {
		debug.group('Vault Steward Debug Info');

		// Settings (without API key)
		const safeSettings = { ...this.settings, apiKey: this.settings.apiKey ? '***configured***' : '***NOT SET***' };
		debug.log('Settings:', safeSettings);

		// Vault stats
		const files = this.app.vault.getMarkdownFiles();
		const tags = this.getAllVaultTags();
		debug.log('Vault Stats:', {
			totalNotes: files.length,
			totalTags: tags.length,
			predefinedTags: this.settings.predefinedTags.length,
			whitelistWords: this.settings.whitelistWords.length,
			blacklistWords: this.settings.blacklistWords.length
		});

		// Token usage
		debug.log('Token Usage:', {
			totalCalls: this.settings.tokenUsage.totalCalls,
			totalInputTokens: this.settings.tokenUsage.totalInputTokens,
			totalOutputTokens: this.settings.tokenUsage.totalOutputTokens,
			historyLength: this.settings.tokenUsage.history.length
		});

		// Changelog stats
		const sessions = this.changelog.getSessions();
		const totalChanges = sessions.reduce((sum, s) => sum + s.changes.length, 0);
		debug.log('Changelog Stats:', {
			totalSessions: sessions.length,
			totalChanges: totalChanges
		});

		// Last few API calls
		if (this.settings.tokenUsage.history.length > 0) {
			debug.log('Recent API calls:');
			debug.table(this.settings.tokenUsage.history.slice(-5).reverse());
		}

		debug.groupEnd();

		new Notice('Debug info logged to console (Ctrl/Cmd + Shift + I to open)');
	}
}
