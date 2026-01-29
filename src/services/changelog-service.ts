/**
 * Changelog Service
 * Tracks all changes made by Vault Steward for rollback capability
 */

import { App, TFile } from 'obsidian';
import {
	ChangeEntry,
	ChangelogSession,
	ChangelogStorage,
	ChangeDetails
} from '../types/changelog';

// Debug logging utility
const DEBUG_PREFIX = 'Vault Steward';
const debug = {
	log: (...args: unknown[]) => console.log(`[${DEBUG_PREFIX}]`, ...args),
	error: (...args: unknown[]) => console.error(`[${DEBUG_PREFIX}]`, ...args)
};

const CHANGELOG_FOLDER = '.vault-steward';
const CHANGELOG_FILE = 'changelog.json';
const MAX_SESSIONS = 50; // Keep last 50 sessions

export class ChangelogService {
	private app: App;
	private currentSession: ChangelogSession | null = null;
	private storage: ChangelogStorage;

	constructor(app: App) {
		this.app = app;
		this.storage = { version: 1, sessions: [] };
	}

	/**
	 * Initialize the changelog service
	 */
	async initialize(): Promise<void> {
		await this.ensureChangelogFolder();
		await this.loadChangelog();
	}

	/**
	 * Start a new changelog session
	 */
	startSession(): string {
		const sessionId = this.generateId();
		this.currentSession = {
			sessionId,
			startTime: Date.now(),
			changes: []
		};
		return sessionId;
	}

	/**
	 * End the current session
	 */
	async endSession(): Promise<void> {
		if (this.currentSession) {
			this.currentSession.endTime = Date.now();

			// Only save if there were changes
			if (this.currentSession.changes.length > 0) {
				this.storage.sessions.push(this.currentSession);

				// Prune old sessions
				if (this.storage.sessions.length > MAX_SESSIONS) {
					this.storage.sessions = this.storage.sessions.slice(-MAX_SESSIONS);
				}

				await this.saveChangelog();
			}

			this.currentSession = null;
		}
	}

	/**
	 * Record a change before it's made (capture original state)
	 */
	recordBefore(filePath: string, content: string): string {
		const changeId = this.generateId();

		if (this.currentSession) {
			// Store temporarily - will be completed with recordAfter
			this.currentSession.changes.push({
				id: changeId,
				timestamp: Date.now(),
				type: 'content_modified',
				filePath,
				description: 'Pending...',
				beforeContent: content,
				details: { type: 'content_modified', summary: '' }
			});
		}

		return changeId;
	}

	/**
	 * Complete a change record after modification
	 */
	recordAfter(
		changeId: string,
		afterContent: string,
		type: ChangeEntry['type'],
		description: string,
		details: ChangeDetails
	): void {
		if (!this.currentSession) return;

		const change = this.currentSession.changes.find(c => c.id === changeId);
		if (change) {
			change.afterContent = afterContent;
			change.type = type;
			change.description = description;
			change.details = details;
		}
	}

	/**
	 * Record a complete change in one call
	 */
	recordChange(
		filePath: string,
		type: ChangeEntry['type'],
		description: string,
		details: ChangeDetails,
		beforeContent?: string,
		afterContent?: string
	): string {
		const changeId = this.generateId();

		if (this.currentSession) {
			this.currentSession.changes.push({
				id: changeId,
				timestamp: Date.now(),
				type,
				filePath,
				description,
				beforeContent,
				afterContent,
				details
			});
		}

		return changeId;
	}

	/**
	 * Get all sessions
	 */
	getSessions(): ChangelogSession[] {
		return [...this.storage.sessions];
	}

	/**
	 * Get a specific session by ID
	 */
	getSession(sessionId: string): ChangelogSession | undefined {
		return this.storage.sessions.find(s => s.sessionId === sessionId);
	}

	/**
	 * Get recent changes across all sessions
	 */
	getRecentChanges(limit: number = 50): ChangeEntry[] {
		const allChanges: ChangeEntry[] = [];

		for (const session of this.storage.sessions) {
			allChanges.push(...session.changes);
		}

		return allChanges
			.sort((a, b) => b.timestamp - a.timestamp)
			.slice(0, limit);
	}

	/**
	 * Rollback a specific change (undo)
	 * Does NOT create a new changelog entry - just removes the change
	 */
	async rollbackChange(changeId: string): Promise<boolean> {
		// Find the change and its session
		let targetChange: ChangeEntry | null = null;
		let targetSession: ChangelogSession | null = null;

		for (const session of this.storage.sessions) {
			const change = session.changes.find(c => c.id === changeId);
			if (change) {
				targetChange = change;
				targetSession = session;
				break;
			}
		}

		if (!targetChange || !targetChange.beforeContent || !targetSession) {
			return false;
		}

		// Get the file
		const file = this.app.vault.getAbstractFileByPath(targetChange.filePath);
		if (!(file instanceof TFile)) {
			return false;
		}

		// Restore the content
		await this.app.vault.modify(file, targetChange.beforeContent);

		// Remove the change from the session (don't record a new entry)
		targetSession.changes = targetSession.changes.filter(c => c.id !== changeId);

		// Remove empty sessions
		this.storage.sessions = this.storage.sessions.filter(s => s.changes.length > 0);

		// Save updated changelog
		await this.saveChangelog();

		return true;
	}

	/**
	 * Rollback all changes in a session (undo all)
	 */
	async rollbackSession(sessionId: string): Promise<number> {
		const session = this.getSession(sessionId);
		if (!session) return 0;

		let rolledBack = 0;

		// Rollback in reverse order (newest first)
		// Make a copy of changes since we're modifying the array
		const changesToRollback = [...session.changes].reverse();

		for (const change of changesToRollback) {
			if (change.beforeContent) {
				const file = this.app.vault.getAbstractFileByPath(change.filePath);
				if (file instanceof TFile) {
					await this.app.vault.modify(file, change.beforeContent);
					rolledBack++;
				}
			}
		}

		// Remove the entire session
		this.storage.sessions = this.storage.sessions.filter(s => s.sessionId !== sessionId);

		// Save updated changelog
		await this.saveChangelog();

		return rolledBack;
	}

	/**
	 * Ensure the changelog folder exists
	 */
	private async ensureChangelogFolder(): Promise<void> {
		try {
			const folder = this.app.vault.getAbstractFileByPath(CHANGELOG_FOLDER);
			if (!folder) {
				await this.app.vault.createFolder(CHANGELOG_FOLDER);
			}
		} catch (error) {
			// Folder might already exist - that's fine
			debug.log('Changelog folder already exists or created');
		}
	}

	/**
	 * Load changelog from disk
	 */
	private async loadChangelog(): Promise<void> {
		const path = `${CHANGELOG_FOLDER}/${CHANGELOG_FILE}`;
		const file = this.app.vault.getAbstractFileByPath(path);

		if (file instanceof TFile) {
			try {
				const content = await this.app.vault.read(file);
				this.storage = JSON.parse(content);
			} catch (error) {
				debug.error('Failed to load changelog:', error);
				this.storage = { version: 1, sessions: [] };
			}
		}
	}

	/**
	 * Save changelog to disk
	 */
	private async saveChangelog(): Promise<void> {
		const path = `${CHANGELOG_FOLDER}/${CHANGELOG_FILE}`;
		const content = JSON.stringify(this.storage, null, 2);

		const file = this.app.vault.getAbstractFileByPath(path);
		if (file instanceof TFile) {
			await this.app.vault.modify(file, content);
		} else {
			await this.app.vault.create(path, content);
		}
	}

	/**
	 * Generate a unique ID
	 */
	private generateId(): string {
		return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
	}
}
