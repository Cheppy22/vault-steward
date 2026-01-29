/**
 * Preferences Engine
 * Learns and adapts to user's organizational patterns
 */

import { App, TFile } from 'obsidian';
import { VaultOperations } from '../services/vault-operations';
import {
	UserPreferences,
	DEFAULT_PREFERENCES,
	TagUsage,
	ConceptFrequency
} from '../types/preferences';

const PREFERENCES_FOLDER = '.vault-steward';
const PREFERENCES_FILE = 'preferences.json';

export class PreferencesEngine {
	private app: App;
	private vaultOps: VaultOperations;
	private preferences: UserPreferences;

	constructor(app: App, vaultOps: VaultOperations) {
		this.app = app;
		this.vaultOps = vaultOps;
		this.preferences = { ...DEFAULT_PREFERENCES };
	}

	/**
	 * Initialize the preferences engine
	 */
	async initialize(): Promise<void> {
		await this.ensureFolder();
		await this.loadPreferences();
	}

	/**
	 * Get current preferences
	 */
	getPreferences(): UserPreferences {
		return { ...this.preferences };
	}

	/**
	 * Analyze the vault and update preferences
	 */
	async analyzeVault(): Promise<void> {
		const files = this.app.vault.getMarkdownFiles();

		// Reset counters
		const tagCounts = new Map<string, TagUsage>();
		const conceptCounts = new Map<string, ConceptFrequency>();
		let totalTags = 0;
		let totalLinks = 0;
		let frontmatterTagCount = 0;
		let inlineTagCount = 0;

		for (const file of files) {
			const content = await this.vaultOps.readNote(file);

			// Analyze tags
			const { tags, isFrontmatter } = this.extractTags(content);
			for (const tag of tags) {
				const existing = tagCounts.get(tag) || {
					tag,
					count: 0,
					lastUsed: 0,
					noteCount: 0
				};
				existing.count++;
				existing.noteCount++;
				existing.lastUsed = Date.now();
				tagCounts.set(tag, existing);

				if (isFrontmatter) frontmatterTagCount++;
				else inlineTagCount++;
			}
			totalTags += tags.length;

			// Analyze links
			const links = this.extractLinks(content);
			totalLinks += links.length;

			// Extract concepts (simple word frequency analysis)
			const concepts = this.extractConcepts(content);
			for (const concept of concepts) {
				const existing = conceptCounts.get(concept) || {
					concept,
					occurrences: 0,
					notes: []
				};
				existing.occurrences++;
				if (!existing.notes.includes(file.basename)) {
					existing.notes.push(file.basename);
				}
				conceptCounts.set(concept, existing);
			}
		}

		// Update preferences
		this.preferences.frequentTags = Array.from(tagCounts.values())
			.sort((a, b) => b.count - a.count)
			.slice(0, 50);

		this.preferences.frequentConcepts = Array.from(conceptCounts.values())
			.filter(c => c.occurrences > 2 && c.notes.length > 1)
			.sort((a, b) => b.occurrences - a.occurrences)
			.slice(0, 100);

		this.preferences.avgTagsPerNote = files.length > 0
			? totalTags / files.length
			: 0;

		this.preferences.avgLinksPerNote = files.length > 0
			? totalLinks / files.length
			: 0;

		this.preferences.preferredTagLocation =
			frontmatterTagCount > inlineTagCount * 2 ? 'frontmatter' :
				inlineTagCount > frontmatterTagCount * 2 ? 'inline' : 'mixed';

		// Extract vocabulary (unique terms used frequently)
		this.preferences.vocabulary = this.preferences.frequentConcepts
			.filter(c => c.occurrences > 5)
			.map(c => c.concept);

		this.preferences.lastUpdated = Date.now();

		await this.savePreferences();
	}

	/**
	 * Extract tags from content
	 */
	private extractTags(content: string): { tags: string[]; isFrontmatter: boolean } {
		const tags: string[] = [];
		let isFrontmatter = false;

		// Check frontmatter
		const frontmatterRegex = /^---\n([\s\S]*?)\n---/;
		const fmMatch = content.match(frontmatterRegex);
		if (fmMatch) {
			const tagsMatch = fmMatch[1].match(/^tags:\s*\[?(.*?)\]?$/m);
			if (tagsMatch) {
				const fmTags = tagsMatch[1]
					.split(',')
					.map(t => t.trim())
					.filter(t => t.length > 0)
					.map(t => t.startsWith('#') ? t : `#${t}`);
				tags.push(...fmTags);
				isFrontmatter = true;
			}
		}

		// Check inline tags
		const inlineTagRegex = /#[\w-]+/g;
		let match;
		while ((match = inlineTagRegex.exec(content)) !== null) {
			if (!tags.includes(match[0])) {
				tags.push(match[0]);
			}
		}

		return { tags, isFrontmatter };
	}

	/**
	 * Extract wiki-links from content
	 */
	private extractLinks(content: string): string[] {
		const links: string[] = [];
		const linkRegex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
		let match;
		while ((match = linkRegex.exec(content)) !== null) {
			links.push(match[1]);
		}
		return links;
	}

	/**
	 * Extract significant concepts from content
	 */
	private extractConcepts(content: string): string[] {
		// Remove frontmatter
		const withoutFrontmatter = content.replace(/^---\n[\s\S]*?\n---\n?/, '');

		// Remove links, tags, and markdown formatting
		const plainText = withoutFrontmatter
			.replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, '$1') // Keep link text
			.replace(/#[\w-]+/g, '') // Remove tags
			.replace(/[#*_`~\[\]()]/g, '') // Remove markdown
			.replace(/https?:\/\/\S+/g, ''); // Remove URLs

		// Split into words and filter
		const words = plainText
			.toLowerCase()
			.split(/\s+/)
			.filter(w => w.length > 4) // Only words longer than 4 chars
			.filter(w => !this.isStopWord(w));

		// Count word frequency in this document
		const wordCounts = new Map<string, number>();
		for (const word of words) {
			wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
		}

		// Return words that appear more than once
		return Array.from(wordCounts.entries())
			.filter(([, count]) => count > 1)
			.map(([word]) => word);
	}

	/**
	 * Check if a word is a common stop word
	 */
	private isStopWord(word: string): boolean {
		const stopWords = new Set([
			'about', 'above', 'after', 'again', 'against', 'being', 'below',
			'between', 'both', 'could', 'during', 'each', 'from', 'further',
			'have', 'having', 'here', 'itself', 'just', 'more', 'most', 'only',
			'other', 'same', 'should', 'some', 'such', 'than', 'that', 'their',
			'them', 'then', 'there', 'these', 'they', 'this', 'those', 'through',
			'under', 'until', 'very', 'what', 'when', 'where', 'which', 'while',
			'will', 'with', 'would', 'your', 'into', 'also', 'been', 'were',
			'does', 'doing', 'done', 'going', 'make', 'made', 'many', 'much',
			'need', 'want', 'work', 'working', 'first', 'last', 'well', 'back',
			'even', 'still', 'way', 'ways', 'because', 'however', 'therefore'
		]);
		return stopWords.has(word);
	}

	/**
	 * Get recommended tags based on content and preferences
	 */
	getRecommendedTags(concepts: string[]): string[] {
		const recommendations: string[] = [];

		// Find tags that match user's frequent concepts
		for (const concept of concepts) {
			for (const tagUsage of this.preferences.frequentTags) {
				const tagName = tagUsage.tag.replace('#', '').toLowerCase();
				if (tagName.includes(concept) || concept.includes(tagName)) {
					if (!recommendations.includes(tagUsage.tag)) {
						recommendations.push(tagUsage.tag);
					}
				}
			}
		}

		return recommendations.slice(0, 5);
	}

	/**
	 * Get the preferred tag location based on user patterns
	 */
	getPreferredTagLocation(): 'frontmatter' | 'inline' {
		return this.preferences.preferredTagLocation === 'mixed'
			? 'frontmatter'
			: this.preferences.preferredTagLocation;
	}

	/**
	 * Record a user action for learning
	 */
	recordTagUsage(tag: string): void {
		const existing = this.preferences.frequentTags.find(t => t.tag === tag);
		if (existing) {
			existing.count++;
			existing.lastUsed = Date.now();
		} else {
			this.preferences.frequentTags.push({
				tag,
				count: 1,
				lastUsed: Date.now(),
				noteCount: 1
			});
		}
	}

	/**
	 * Ensure the preferences folder exists
	 */
	private async ensureFolder(): Promise<void> {
		const folder = this.app.vault.getAbstractFileByPath(PREFERENCES_FOLDER);
		if (!folder) {
			await this.app.vault.createFolder(PREFERENCES_FOLDER);
		}
	}

	/**
	 * Load preferences from disk
	 */
	private async loadPreferences(): Promise<void> {
		const path = `${PREFERENCES_FOLDER}/${PREFERENCES_FILE}`;
		const file = this.app.vault.getAbstractFileByPath(path);

		if (file instanceof TFile) {
			try {
				const content = await this.app.vault.read(file);
				this.preferences = {
					...DEFAULT_PREFERENCES,
					...JSON.parse(content)
				};
			} catch (error) {
				console.error('Failed to load preferences:', error);
				this.preferences = { ...DEFAULT_PREFERENCES };
			}
		}
	}

	/**
	 * Save preferences to disk
	 */
	private async savePreferences(): Promise<void> {
		const path = `${PREFERENCES_FOLDER}/${PREFERENCES_FILE}`;
		const content = JSON.stringify(this.preferences, null, 2);

		const file = this.app.vault.getAbstractFileByPath(path);
		if (file instanceof TFile) {
			await this.app.vault.modify(file, content);
		} else {
			await this.app.vault.create(path, content);
		}
	}
}
