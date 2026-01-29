# Vault Steward

AI-powered assistant that creates intelligent connections between your Obsidian notes via links, tags, and organization.

## Features

- **Intelligent Auto-Linking**: Automatically detects and creates `[[wiki-links]]` to related notes in your vault
- **Smart Auto-Tagging**: Applies relevant tags based on note content analysis
- **Tag Generation**: Creates new tags when appropriate, or restrict to predefined/existing tags only
- **Backlink Discovery**: Find and link notes that mention the current note
- **Vault Analysis**: Learn your tagging and linking preferences from existing patterns
- **Full Change History**: View and rollback any changes made by the assistant
- **Token Usage Tracking**: Monitor your API usage with detailed statistics
- **Customizable Confidence Thresholds**: Control how aggressive linking and tagging should be

## Requirements

- Obsidian v1.0.0 or higher
- Anthropic API key (Claude)

## Installation

### Manual Installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/Cheppy22/vault-steward/releases)
2. Create a folder named `vault-steward` in your vault's `.obsidian/plugins/` directory
3. Copy the downloaded files into the folder
4. Restart Obsidian
5. Enable the plugin in Settings > Community Plugins

### From Obsidian Community Plugins

*Coming soon*

## Configuration

### API Key Setup

1. Get an API key from [Anthropic Console](https://console.anthropic.com/)
2. Open Obsidian Settings > Vault Steward
3. Paste your API key in the "Anthropic API Key" field
4. The key is stored locally and never synced

### Settings

| Setting | Description | Default |
|---------|-------------|---------|
| Auto-process on save | Automatically analyze notes when saved | Off |
| Enable auto-linking | Create wiki-links to related notes | On |
| Enable auto-tagging | Apply tags based on content | On |
| Enable tag generation | Allow creation of new tags | On |
| Link confidence threshold | Minimum confidence to create a link (0.5-1.0) | 0.7 |
| Tag confidence threshold | Minimum confidence to add a tag (0.5-1.0) | 0.7 |
| Preferred tag location | Where to add tags (frontmatter/inline) | Frontmatter |
| Predefined tags | Tags to prefer when categorizing | Empty |
| Whitelist words | Words that should always be considered for linking | Empty |
| Blacklist words | Words that should never be linked or tagged | Empty |

## Usage

### Commands

Access these commands via the Command Palette (Ctrl/Cmd + P):

| Command | Description |
|---------|-------------|
| `Vault Steward: Process current note` | Analyze and update the active note |
| `Vault Steward: Process entire vault` | Batch process all notes (shows progress bar) |
| `Vault Steward: Add backlinks to current note` | Link notes that mention this note |
| `Vault Steward: Open changelog` | View history and rollback changes |
| `Vault Steward: Analyze vault and learn preferences` | Learn from your existing patterns |
| `Vault Steward: Show debug info` | Log diagnostic info to console |

### Quick Access

- Click the wand icon in the ribbon to quickly process the current note

### Workflow Tips

1. **Start with Analysis**: Run "Analyze vault and learn preferences" first to help the assistant understand your organizational style
2. **Use Predefined Tags**: Add your commonly used tags to the predefined list for consistent categorization
3. **Review Changes**: Use the changelog to review what changes were made and rollback if needed
4. **Adjust Thresholds**: If you're getting too many/few suggestions, adjust the confidence thresholds

## Cost Considerations

Vault Steward uses the Claude API which has usage-based pricing. Estimated costs:

| Usage Pattern | Monthly Cost |
|---------------|--------------|
| Light (manual, ~5 notes/day) | $1-3 |
| Medium (auto-process, ~20 saves/day) | $5-12 |
| Heavy (auto-process, ~50 saves/day) | $11-30 |

**Tips to reduce costs:**
- Use manual processing instead of auto-process on save
- Set higher confidence thresholds
- Process notes individually rather than entire vault

Monitor your usage in Settings > Vault Steward > API Token Usage.

## Changelog & Rollback

All changes are tracked and can be undone:

1. Open the changelog via command palette or settings
2. Switch between "Timeline" view (all changes) and "Sessions" view (grouped by processing session)
3. Click "Show Change" to see a diff of what changed
4. Click "Undo" to revert a single change, or "Undo All" to revert an entire session

## Troubleshooting

### Common Issues

**API Key Not Working**
- Verify your API key starts with `sk-ant-`
- Try re-entering the key from the Anthropic console

**No Suggestions Found**
- Check that auto-linking and auto-tagging are enabled
- Try lowering the confidence thresholds
- Ensure the note has enough content to analyze

**Changes Not Saving**
- Check the console for errors (Ctrl/Cmd + Shift + I)
- Verify the file isn't open in another editor

### Debug Mode

Run "Vault Steward: Show debug info" and check the browser console for detailed diagnostic information.

## Security

- API key is stored locally using Obsidian's secure plugin data storage
- All file operations go through Obsidian's vault API (sandboxed)
- Note content is only sent to Anthropic's API for analysis
- No telemetry or analytics

## License

MIT License - see [LICENSE](LICENSE) for details.

## Author

Created by Cheppy

## Support

Report issues at [GitHub Issues](https://github.com/Cheppy22/vault-steward/issues)
