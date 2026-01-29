/**
 * Changelog Modal
 * Displays history of changes and allows undo
 */

import { App, Modal, Notice } from 'obsidian';
import { ChangelogService } from '../services/changelog-service';
import { ChangeEntry, ChangelogSession } from '../types/changelog';

export class ChangelogModal extends Modal {
	private changelogService: ChangelogService;
	private expandedChangeId: string | null = null;
	private viewMode: 'flat' | 'sessions' = 'flat';
	private expandedSessionId: string | null = null;

	constructor(app: App, changelogService: ChangelogService) {
		super(app);
		this.changelogService = changelogService;
	}

	onOpen() {
		this.modalEl.addClass('vault-steward-modal');
		this.render();
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}

	private render() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('vs-changelog');

		const sessions = this.changelogService.getSessions();

		// Header with view toggle
		const header = contentEl.createDiv({ cls: 'vs-changelog-header' });
		const headerRow = header.createDiv({ cls: 'vs-header-row' });
		headerRow.createEl('h2', { text: 'Change History' });

		// View mode toggle - styled as tabs
		const viewToggle = headerRow.createDiv({ cls: 'vs-view-toggle vs-tabs' });

		const flatBtn = viewToggle.createEl('button', {
			cls: `vs-tab ${this.viewMode === 'flat' ? 'vs-tab-active' : ''}`,
			text: 'Timeline'
		});
		flatBtn.onclick = () => {
			this.viewMode = 'flat';
			this.expandedSessionId = null; // Reset session expansion when switching views
			this.render();
		};

		const sessionBtn = viewToggle.createEl('button', {
			cls: `vs-tab ${this.viewMode === 'sessions' ? 'vs-tab-active' : ''}`,
			text: 'Sessions'
		});
		sessionBtn.onclick = () => {
			this.viewMode = 'sessions';
			this.render();
		};

		if (sessions.length === 0) {
			const emptyState = contentEl.createDiv({ cls: 'vs-empty-state' });
			emptyState.createEl('p', { text: 'No changes recorded yet.' });
			emptyState.createEl('p', {
				text: 'Changes will appear here as you process notes.',
				cls: 'vs-muted'
			});
			return;
		}

		// Stats summary
		const totalChanges = sessions.reduce((sum, s) => sum + s.changes.length, 0);
		const stats = contentEl.createDiv({ cls: 'vs-changelog-stats' });
		stats.createSpan({ text: `${totalChanges} changes across ${sessions.length} sessions`, cls: 'vs-muted' });

		// Content based on view mode
		const list = contentEl.createDiv({ cls: 'vs-changelog-list' });

		if (this.viewMode === 'flat') {
			this.renderFlatView(list, sessions);
		} else {
			this.renderSessionsView(list, sessions);
		}
	}

	private renderFlatView(list: HTMLElement, sessions: ChangelogSession[]) {
		// Flatten all changes and sort by time (newest first)
		const allChanges: { change: ChangeEntry; session: ChangelogSession }[] = [];
		for (const session of sessions) {
			for (const change of session.changes) {
				allChanges.push({ change, session });
			}
		}
		allChanges.sort((a, b) => b.change.timestamp - a.change.timestamp);

		// Render each change
		for (const { change } of allChanges) {
			this.renderChangeItem(list, change);
		}
	}

	private renderSessionsView(list: HTMLElement, sessions: ChangelogSession[]) {
		// Sort sessions by start time (newest first)
		const sortedSessions = [...sessions].sort((a, b) => b.startTime - a.startTime);

		for (const session of sortedSessions) {
			this.renderSessionGroup(list, session);
		}
	}

	private renderSessionGroup(container: HTMLElement, session: ChangelogSession) {
		const isExpanded = this.expandedSessionId === session.sessionId;
		const sessionDiv = container.createDiv({ cls: `vs-session-group ${isExpanded ? 'vs-session-expanded' : ''}` });

		// Session header - fully clickable
		const header = sessionDiv.createDiv({ cls: 'vs-session-header' });
		header.onclick = () => {
			this.expandedSessionId = isExpanded ? null : session.sessionId;
			this.render();
		};

		// Chevron indicator
		const chevron = header.createSpan({ cls: 'vs-session-chevron' });
		chevron.setText(isExpanded ? '▼' : '▶');

		const headerLeft = header.createDiv({ cls: 'vs-session-info' });
		const date = new Date(session.startTime);
		const dateStr = date.toLocaleDateString(undefined, {
			weekday: 'short',
			month: 'short',
			day: 'numeric'
		});
		const timeStr = date.toLocaleTimeString(undefined, {
			hour: '2-digit',
			minute: '2-digit'
		});

		headerLeft.createDiv({ cls: 'vs-session-date', text: `${dateStr} at ${timeStr}` });
		headerLeft.createDiv({
			cls: 'vs-session-summary vs-muted',
			text: `${session.changes.length} change${session.changes.length > 1 ? 's' : ''}`
		});

		// Session actions
		const headerRight = header.createDiv({ cls: 'vs-session-actions' });

		// Undo All button for session
		const hasUndoable = session.changes.some(c => c.beforeContent);
		if (hasUndoable) {
			const undoAllBtn = headerRight.createEl('button', {
				cls: 'vs-btn vs-btn-small vs-btn-warning',
				text: 'Undo All'
			});
			undoAllBtn.onclick = async (e) => {
				e.stopPropagation();
				const confirmed = await this.confirmUndoAll(session.changes.length);
				if (confirmed) {
					const count = await this.changelogService.rollbackSession(session.sessionId);
					if (count > 0) {
						new Notice(`Undone ${count} change${count > 1 ? 's' : ''}`);
						this.render();
					} else {
						new Notice('Failed to undo changes');
					}
				}
			};
		}

		// Expanded content - show changes when expanded
		if (isExpanded) {
			const changesContainer = sessionDiv.createDiv({ cls: 'vs-session-changes' });
			for (const change of session.changes) {
				this.renderChangeItem(changesContainer, change);
			}
		}
	}

	private renderChangeItem(container: HTMLElement, change: ChangeEntry) {
		const item = container.createDiv({ cls: 'vs-change-item' });
		const isExpanded = this.expandedChangeId === change.id;

		// Main row (always visible)
		const row = item.createDiv({ cls: 'vs-change-row' });

		// Left side: icon + description
		const left = row.createDiv({ cls: 'vs-change-left' });
		const icon = left.createSpan({ cls: 'vs-change-icon' });
		icon.setText(this.getChangeIcon(change.type));

		const info = left.createDiv({ cls: 'vs-change-info' });
		const desc = info.createDiv({ cls: 'vs-change-desc' });
		desc.setText(change.description);

		const meta = info.createDiv({ cls: 'vs-change-meta' });
		const fileName = change.filePath.split('/').pop() || change.filePath;
		meta.setText(`${fileName} • ${this.formatTime(change.timestamp)}`);

		// Right side: actions
		const right = row.createDiv({ cls: 'vs-change-actions' });

		if (change.beforeContent && change.afterContent) {
			const toggleBtn = right.createEl('button', {
				cls: 'vs-btn vs-btn-secondary',
				text: isExpanded ? 'Hide Change' : 'Show Change'
			});
			toggleBtn.onclick = (e) => {
				e.stopPropagation();
				this.expandedChangeId = isExpanded ? null : change.id;
				this.render();
			};
		}

		if (change.beforeContent) {
			const undoBtn = right.createEl('button', {
				cls: 'vs-btn vs-btn-warning',
				text: 'Undo'
			});
			undoBtn.onclick = async (e) => {
				e.stopPropagation();
				const confirmed = await this.confirmUndo(change.description);
				if (confirmed) {
					const success = await this.changelogService.rollbackChange(change.id);
					if (success) {
						new Notice('Change undone');
						this.render();
					} else {
						new Notice('Failed to undo change');
					}
				}
			};
		}

		// Expanded diff view
		if (isExpanded && change.beforeContent && change.afterContent) {
			const diffSection = item.createDiv({ cls: 'vs-diff-section' });
			this.renderDiff(diffSection, change.beforeContent, change.afterContent);
		}
	}

	private renderDiff(container: HTMLElement, before: string, after: string) {
		const beforeLines = before.split('\n');
		const afterLines = after.split('\n');

		// Find only the changed lines
		const changes: { type: 'add' | 'remove' | 'context'; line: string }[] = [];
		const maxLen = Math.max(beforeLines.length, afterLines.length);

		let lastChangeIdx = -10;
		for (let i = 0; i < maxLen; i++) {
			const bLine = beforeLines[i];
			const aLine = afterLines[i];

			if (bLine !== aLine) {
				// Add context line before if not adjacent
				if (i > lastChangeIdx + 3 && i > 0 && beforeLines[i - 1]) {
					if (changes.length > 0) {
						changes.push({ type: 'context', line: '...' });
					}
					changes.push({ type: 'context', line: beforeLines[i - 1] });
				}

				if (bLine !== undefined && bLine !== aLine) {
					changes.push({ type: 'remove', line: bLine });
				}
				if (aLine !== undefined && aLine !== bLine) {
					changes.push({ type: 'add', line: aLine });
				}
				lastChangeIdx = i;
			}
		}

		// Render diff
		const diffEl = container.createEl('pre', { cls: 'vs-diff' });

		if (changes.length === 0) {
			diffEl.createDiv({ cls: 'vs-diff-line vs-muted', text: 'No visible changes' });
			return;
		}

		for (const change of changes.slice(0, 30)) {
			const lineEl = diffEl.createDiv({ cls: `vs-diff-line vs-diff-${change.type}` });
			const prefix = change.type === 'add' ? '+' : change.type === 'remove' ? '-' : ' ';
			lineEl.setText(`${prefix} ${change.line}`);
		}

		if (changes.length > 30) {
			diffEl.createDiv({
				cls: 'vs-diff-line vs-muted',
				text: `... ${changes.length - 30} more lines`
			});
		}
	}

	private getChangeIcon(type: ChangeEntry['type']): string {
		switch (type) {
			case 'link_added': return '🔗';
			case 'tag_added': return '🏷';
			case 'content_modified': return '✏️';
			case 'file_renamed': return '📝';
			case 'file_moved': return '📁';
			default: return '•';
		}
	}

	private formatTime(timestamp: number): string {
		const date = new Date(timestamp);
		const now = new Date();
		const isToday = date.toDateString() === now.toDateString();

		if (isToday) {
			return date.toLocaleTimeString(undefined, {
				hour: '2-digit',
				minute: '2-digit'
			});
		}

		return date.toLocaleDateString(undefined, {
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	private async confirmUndo(description: string): Promise<boolean> {
		return new Promise((resolve) => {
			const modal = new ConfirmModal(this.app, description, resolve);
			modal.open();
		});
	}

	private async confirmUndoAll(count: number): Promise<boolean> {
		return new Promise((resolve) => {
			const description = `This will undo ${count} change${count > 1 ? 's' : ''} from this session.`;
			const modal = new ConfirmModal(this.app, description, resolve, 'Undo All');
			modal.open();
		});
	}
}

/**
 * Confirmation modal for undo
 */
class ConfirmModal extends Modal {
	private description: string;
	private callback: (confirmed: boolean) => void;
	private confirmText: string;

	constructor(
		app: App,
		description: string,
		callback: (confirmed: boolean) => void,
		confirmText: string = 'Undo'
	) {
		super(app);
		this.description = description;
		this.callback = callback;
		this.confirmText = confirmText;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.addClass('vs-confirm-modal');

		contentEl.createEl('h3', { text: 'Undo Change?' });

		const desc = contentEl.createEl('p', { cls: 'vs-confirm-desc' });
		desc.setText(this.description);

		const btnContainer = contentEl.createDiv({ cls: 'vs-confirm-buttons' });

		const cancelBtn = btnContainer.createEl('button', {
			cls: 'vs-btn',
			text: 'Cancel'
		});
		cancelBtn.onclick = () => {
			this.callback(false);
			this.close();
		};

		const confirmBtn = btnContainer.createEl('button', {
			cls: 'vs-btn vs-btn-warning',
			text: this.confirmText
		});
		confirmBtn.onclick = () => {
			this.callback(true);
			this.close();
		};
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
