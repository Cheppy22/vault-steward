/**
 * Types for user preferences and learning
 */

export interface TagUsage {
	/** The tag */
	tag: string;
	/** Number of times used */
	count: number;
	/** Last time used */
	lastUsed: number;
	/** Notes this tag appears in */
	noteCount: number;
}

export interface LinkPattern {
	/** Source concept/topic */
	source: string;
	/** Target concept/topic */
	target: string;
	/** How often this connection is made */
	frequency: number;
	/** Last time this pattern was observed */
	lastSeen: number;
}

export interface ConceptFrequency {
	/** The concept/term */
	concept: string;
	/** Number of occurrences */
	occurrences: number;
	/** Notes where this appears */
	notes: string[];
}

export interface UserPreferences {
	/** Version of the preferences format */
	version: number;

	/** Most frequently used tags */
	frequentTags: TagUsage[];

	/** Common linking patterns */
	linkPatterns: LinkPattern[];

	/** Frequently referenced concepts */
	frequentConcepts: ConceptFrequency[];

	/** User's vocabulary (custom terms they use) */
	vocabulary: string[];

	/** Topics the user writes about most */
	topTopics: string[];

	/** Preference for frontmatter vs inline tags */
	preferredTagLocation: 'frontmatter' | 'inline' | 'mixed';

	/** Average tags per note */
	avgTagsPerNote: number;

	/** Average links per note */
	avgLinksPerNote: number;

	/** Last time preferences were updated */
	lastUpdated: number;
}

export const DEFAULT_PREFERENCES: UserPreferences = {
	version: 1,
	frequentTags: [],
	linkPatterns: [],
	frequentConcepts: [],
	vocabulary: [],
	topTopics: [],
	preferredTagLocation: 'frontmatter',
	avgTagsPerNote: 0,
	avgLinksPerNote: 0,
	lastUpdated: 0
};
