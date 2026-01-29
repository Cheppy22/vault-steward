/**
 * Vault Steward Settings
 */

import { App, PluginSettingTab, Setting } from 'obsidian';
import VaultStewardPlugin from './main';
import { TokenUsageStats, TokenUsage } from './types';

export interface VaultStewardSettings {
	// API Configuration
	apiKey: string;

	// Processing Mode
	autoProcessOnSave: boolean;

	// Feature Toggles
	enableAutoLinking: boolean;
	enableAutoTagging: boolean;
	enableTagGeneration: boolean;

	// Confidence Thresholds
	linkConfidenceThreshold: number;
	tagConfidenceThreshold: number;

	// Tag Preferences
	preferredTagLocation: 'frontmatter' | 'inline';

	// Customization
	predefinedTags: string[];
	whitelistWords: string[];
	blacklistWords: string[];

	// Token Usage Tracking
	tokenUsage: TokenUsageStats;
}

export const DEFAULT_TOKEN_USAGE: TokenUsageStats = {
	totalInputTokens: 0,
	totalOutputTokens: 0,
	totalCalls: 0,
	history: [],
	trackingSince: Date.now(),
	lastReset: Date.now()
};

export const DEFAULT_SETTINGS: VaultStewardSettings = {
	apiKey: '',
	autoProcessOnSave: false,
	enableAutoLinking: true,
	enableAutoTagging: true,
	enableTagGeneration: true,
	linkConfidenceThreshold: 0.7,
	tagConfidenceThreshold: 0.7,
	preferredTagLocation: 'frontmatter',
	predefinedTags: [],
	whitelistWords: [],
	blacklistWords: [],
	tokenUsage: { ...DEFAULT_TOKEN_USAGE }
};

export class VaultStewardSettingTab extends PluginSettingTab {
	plugin: VaultStewardPlugin;
	private showRecentCalls: boolean = false;

	constructor(app: App, plugin: VaultStewardPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.addClass('vault-steward-settings');

		// Header
		containerEl.createEl('h1', { text: 'Vault Steward Settings' });

		// Quick Start / Commands & Tips - Collapsible at top
		this.renderQuickStartSection(containerEl);

		// API Configuration Section
		containerEl.createEl('h2', { text: 'API Configuration' });

		new Setting(containerEl)
			.setName('Anthropic API Key')
			.setDesc('Your Claude API key. Stored locally, not synced across devices.')
			.addText(text => {
				text.inputEl.type = 'password';
				text.setPlaceholder('sk-ant-...')
					.setValue(this.plugin.settings.apiKey)
					.onChange(async (value) => {
						this.plugin.settings.apiKey = value;
						await this.plugin.saveSettings();
					});
			});

		// Processing Mode Section
		containerEl.createEl('h2', { text: 'Processing Mode' });

		const autoProcessSetting = new Setting(containerEl)
			.setName('Auto-process on save')
			.setDesc('Automatically analyze and update notes when you save them. Uses a 2-second debounce.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.autoProcessOnSave)
				.onChange(async (value) => {
					this.plugin.settings.autoProcessOnSave = value;
					await this.plugin.saveSettings();
				}));

		// Add disclaimer warning
		const disclaimer = autoProcessSetting.settingEl.createDiv({ cls: 'vs-disclaimer' });
		disclaimer.setText('Warning: This will consume API tokens on every save. May result in significant token usage for frequent edits.');

		// Feature Toggles Section
		containerEl.createEl('h2', { text: 'Features' });

		new Setting(containerEl)
			.setName('Enable auto-linking')
			.setDesc('Automatically detect and create [[wiki-links]] to related notes.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableAutoLinking)
				.onChange(async (value) => {
					this.plugin.settings.enableAutoLinking = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Enable auto-tagging')
			.setDesc('Automatically apply relevant tags to notes.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableAutoTagging)
				.onChange(async (value) => {
					this.plugin.settings.enableAutoTagging = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Enable tag generation')
			.setDesc('Allow creation of new tags beyond predefined ones. Disable to only use existing vault tags or predefined tags.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableTagGeneration)
				.onChange(async (value) => {
					this.plugin.settings.enableTagGeneration = value;
					await this.plugin.saveSettings();
				}));

		// Confidence Section
		containerEl.createEl('h2', { text: 'Confidence Thresholds' });
		containerEl.createEl('p', {
			text: 'Higher thresholds mean fewer but more accurate suggestions. Lower thresholds mean more suggestions but potential false positives.',
			cls: 'setting-item-description'
		});

		new Setting(containerEl)
			.setName('Link confidence threshold')
			.setDesc('Minimum confidence (0-1) required to create a link. Default: 0.7')
			.addSlider(slider => slider
				.setLimits(0.5, 1, 0.05)
				.setValue(this.plugin.settings.linkConfidenceThreshold)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.linkConfidenceThreshold = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Tag confidence threshold')
			.setDesc('Minimum confidence (0-1) required to add a tag. Default: 0.7')
			.addSlider(slider => slider
				.setLimits(0.5, 1, 0.05)
				.setValue(this.plugin.settings.tagConfidenceThreshold)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.tagConfidenceThreshold = value;
					await this.plugin.saveSettings();
				}));

		// Tag Preferences Section
		containerEl.createEl('h2', { text: 'Tag Preferences' });

		new Setting(containerEl)
			.setName('Preferred tag location')
			.setDesc('Where to add new tags when processing notes.')
			.addDropdown(dropdown => dropdown
				.addOption('frontmatter', 'Frontmatter (YAML)')
				.addOption('inline', 'Inline (end of document)')
				.setValue(this.plugin.settings.preferredTagLocation)
				.onChange(async (value: 'frontmatter' | 'inline') => {
					this.plugin.settings.preferredTagLocation = value;
					await this.plugin.saveSettings();
				}));

		// Customization Section
		containerEl.createEl('h2', { text: 'Customization' });

		new Setting(containerEl)
			.setName('Predefined tags')
			.setDesc('Tags the assistant should prefer when categorizing. One per line. Include the # symbol.')
			.addTextArea(text => {
				text.inputEl.rows = 6;
				text.setPlaceholder('#project\n#reference\n#idea\n#todo')
					.setValue(this.plugin.settings.predefinedTags.join('\n'))
					.onChange(async (value) => {
						this.plugin.settings.predefinedTags = value
							.split('\n')
							.map(t => t.trim())
							.filter(t => t.length > 0);
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName('Whitelist words')
			.setDesc('Words/phrases that should always be considered for linking. One per line.')
			.addTextArea(text => {
				text.inputEl.rows = 4;
				text.setPlaceholder('important concept\nkey term')
					.setValue(this.plugin.settings.whitelistWords.join('\n'))
					.onChange(async (value) => {
						this.plugin.settings.whitelistWords = value
							.split('\n')
							.map(w => w.trim())
							.filter(w => w.length > 0);
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName('Blacklist words')
			.setDesc('Words that should never be linked or tagged. One per line.')
			.addTextArea(text => {
				text.inputEl.rows = 4;
				text.setPlaceholder('common word\nignore this')
					.setValue(this.plugin.settings.blacklistWords.join('\n'))
					.onChange(async (value) => {
						this.plugin.settings.blacklistWords = value
							.split('\n')
							.map(w => w.trim())
							.filter(w => w.length > 0);
						await this.plugin.saveSettings();
					});
			});

		// Token Usage Section - at bottom
		this.renderTokenUsageSection(containerEl);
	}

	/**
	 * Render the Quick Start / Commands & Tips collapsible section
	 */
	private renderQuickStartSection(containerEl: HTMLElement) {
		const collapsible = containerEl.createDiv({ cls: 'vs-collapsible vs-expanded' });

		const header = collapsible.createDiv({ cls: 'vs-collapsible-header' });
		const chevron = header.createSpan({ cls: 'vs-collapsible-chevron', text: '▶' });
		header.createSpan({ cls: 'vs-collapsible-title', text: 'Quick Start: Commands & Tips' });

		const content = collapsible.createDiv({ cls: 'vs-collapsible-content' });

		// Commands
		content.createEl('h3', { text: 'Available Commands', attr: { style: 'margin-top: 0;' } });
		content.createEl('p', {
			text: 'Use the command palette (Ctrl/Cmd + P) to access these commands:',
			cls: 'vs-muted'
		});

		const commandList = content.createEl('ul');
		commandList.createEl('li', { text: 'Vault Steward: Process current note - Analyze and update the active note' });
		commandList.createEl('li', { text: 'Vault Steward: Process entire vault - Batch process all notes' });
		commandList.createEl('li', { text: 'Vault Steward: Add backlinks to current note - Link notes that mention this note' });
		commandList.createEl('li', { text: 'Vault Steward: Open changelog - View history and rollback changes' });
		commandList.createEl('li', { text: 'Vault Steward: Analyze vault and learn preferences - Learn from your existing patterns' });
		commandList.createEl('li', { text: 'Vault Steward: Show debug info - Log diagnostic info to console' });

		// Tips
		content.createEl('h3', { text: 'Tips' });
		const tipsList = content.createEl('ul');
		tipsList.createEl('li', { text: 'Click the wand icon in the ribbon to quickly process the current note' });
		tipsList.createEl('li', { text: 'Run "Analyze vault" first to help the assistant learn your preferences' });
		tipsList.createEl('li', { text: 'Use the changelog to review and rollback any unwanted changes' });
		tipsList.createEl('li', { text: 'Predefined tags help maintain consistent categorization across your vault' });

		// Toggle behavior
		header.onclick = () => {
			collapsible.toggleClass('vs-expanded', !collapsible.hasClass('vs-expanded'));
		};
	}

	/**
	 * Render the Token Usage section with expandable recent calls
	 */
	private renderTokenUsageSection(containerEl: HTMLElement) {
		containerEl.createEl('h2', { text: 'API Token Usage' });

		const usage = this.plugin.settings.tokenUsage;
		const totalTokens = usage.totalInputTokens + usage.totalOutputTokens;

		// Usage stats display
		const usageContainer = containerEl.createDiv({ cls: 'vs-usage-stats' });

		const statsGrid = usageContainer.createDiv({ cls: 'vs-stats-grid' });

		// Total calls
		const callsStat = statsGrid.createDiv({ cls: 'vs-stat' });
		callsStat.createDiv({ cls: 'vs-stat-value', text: usage.totalCalls.toLocaleString() });
		callsStat.createDiv({ cls: 'vs-stat-label', text: 'API Calls' });

		// Input tokens
		const inputStat = statsGrid.createDiv({ cls: 'vs-stat' });
		inputStat.createDiv({ cls: 'vs-stat-value', text: usage.totalInputTokens.toLocaleString() });
		inputStat.createDiv({ cls: 'vs-stat-label', text: 'Input Tokens' });

		// Output tokens
		const outputStat = statsGrid.createDiv({ cls: 'vs-stat' });
		outputStat.createDiv({ cls: 'vs-stat-value', text: usage.totalOutputTokens.toLocaleString() });
		outputStat.createDiv({ cls: 'vs-stat-label', text: 'Output Tokens' });

		// Total tokens
		const totalStat = statsGrid.createDiv({ cls: 'vs-stat' });
		totalStat.createDiv({ cls: 'vs-stat-value', text: totalTokens.toLocaleString() });
		totalStat.createDiv({ cls: 'vs-stat-label', text: 'Total Tokens' });

		// Tracking info
		const trackingInfo = usageContainer.createDiv({ cls: 'vs-tracking-info' });
		const trackingSince = new Date(usage.trackingSince);
		trackingInfo.createSpan({
			text: `Tracking since: ${trackingSince.toLocaleDateString()}`,
			cls: 'vs-muted'
		});

		// Recent usage - expandable dropdown
		if (usage.history.length > 0) {
			const recentCollapsible = usageContainer.createDiv({
				cls: `vs-collapsible ${this.showRecentCalls ? 'vs-expanded' : ''}`
			});

			const recentHeader = recentCollapsible.createDiv({ cls: 'vs-collapsible-header' });
			const chevron = recentHeader.createSpan({ cls: 'vs-collapsible-chevron', text: '▶' });
			recentHeader.createSpan({
				cls: 'vs-collapsible-title',
				text: `Recent API calls (${Math.min(usage.history.length, 10)} of ${usage.history.length})`
			});

			recentHeader.onclick = () => {
				this.showRecentCalls = !this.showRecentCalls;
				recentCollapsible.toggleClass('vs-expanded', this.showRecentCalls);
			};

			const recentContent = recentCollapsible.createDiv({ cls: 'vs-collapsible-content' });
			const recentList = recentContent.createDiv({ cls: 'vs-recent-list' });
			const recentCalls = usage.history.slice(-10).reverse();

			for (const call of recentCalls) {
				const callDiv = recentList.createDiv({ cls: 'vs-recent-call' });
				const time = new Date(call.timestamp);
				const timeStr = time.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
				const dateStr = time.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

				callDiv.createSpan({ text: `${dateStr} ${timeStr}`, cls: 'vs-call-time' });
				callDiv.createSpan({ text: `${call.totalTokens} tokens`, cls: 'vs-call-tokens' });
				callDiv.createSpan({ text: `(${call.inputTokens} in / ${call.outputTokens} out)`, cls: 'vs-muted' });
			}
		}

		// Reset button
		new Setting(containerEl)
			.setName('Reset token usage')
			.setDesc('Clear all token usage history and start fresh.')
			.addButton(btn => btn
				.setButtonText('Reset Stats')
				.setWarning()
				.onClick(async () => {
					this.plugin.settings.tokenUsage = {
						totalInputTokens: 0,
						totalOutputTokens: 0,
						totalCalls: 0,
						history: [],
						trackingSince: Date.now(),
						lastReset: Date.now()
					};
					await this.plugin.saveSettings();
					this.display(); // Refresh the display
				}));
	}
}
