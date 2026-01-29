/**
 * Types for changelog and change tracking
 */

export interface ChangeEntry {
	/** Unique identifier for this change */
	id: string;
	/** Timestamp when change was made */
	timestamp: number;
	/** Type of change */
	type: 'link_added' | 'tag_added' | 'content_modified' | 'file_renamed' | 'file_moved';
	/** Path to the affected file */
	filePath: string;
	/** Description of what changed */
	description: string;
	/** Content before the change (for rollback) */
	beforeContent?: string;
	/** Content after the change */
	afterContent?: string;
	/** Specific details about the change */
	details: ChangeDetails;
}

export type ChangeDetails =
	| LinkAddedDetails
	| TagAddedDetails
	| ContentModifiedDetails
	| FileRenamedDetails
	| FileMovedDetails;

export interface LinkAddedDetails {
	type: 'link_added';
	/** The text that was converted to a link */
	originalText: string;
	/** The link target */
	linkTarget: string;
	/** Position in the document */
	position: { line: number; start: number; end: number };
}

export interface TagAddedDetails {
	type: 'tag_added';
	/** The tag that was added */
	tag: string;
	/** Where the tag was added */
	location: 'frontmatter' | 'inline';
}

export interface ContentModifiedDetails {
	type: 'content_modified';
	/** Summary of modifications */
	summary: string;
}

export interface FileRenamedDetails {
	type: 'file_renamed';
	/** Original filename */
	oldName: string;
	/** New filename */
	newName: string;
}

export interface FileMovedDetails {
	type: 'file_moved';
	/** Original path */
	oldPath: string;
	/** New path */
	newPath: string;
}

export interface ChangelogSession {
	/** Session identifier */
	sessionId: string;
	/** When the session started */
	startTime: number;
	/** When the session ended (if applicable) */
	endTime?: number;
	/** All changes in this session */
	changes: ChangeEntry[];
}

export interface ChangelogStorage {
	/** Current version of changelog format */
	version: number;
	/** All sessions */
	sessions: ChangelogSession[];
}
