# Agent target path compatibility

Asked: 2026-11-02   Version context: current official Cursor, Cline, and Devin documentation, including the legacy Windsurf import path.

## Answer

Cursor's current project/global skill directories and project/global subagent directories match the package adapter, and its subagent format accepts Markdown with `name` and `description` frontmatter. Cline documents project and global skill and agent directories; its first-party SDK example reads Markdown agent presets with YAML frontmatter, but that example is a plugin rather than proof of built-in Cline dispatch. Current Devin documentation, which now hosts the old Windsurf Cascade docs, documents `.windsurf/skills` as a legacy project skills path, `~/.codeium/windsurf/skills` for the stable global channel, and `.devin/agents` plus `~/.config/devin/agents` for current custom subagents. The Windsurf adapter now follows those paths.

## Evidence

- Cursor lists `.cursor/skills/`, `~/.cursor/skills/`, `.cursor/agents/`, and `~/.cursor/agents/`, and documents Markdown subagent files with YAML frontmatter: [Cursor Agent Skills](https://cursor.com/docs/context/skills) and [Cursor Subagents](https://cursor.com/docs/agent/subagents), accessed 2026-11-02.
- Cline documents `.cline/skills/`, `~/.cline/skills/`, `.cline/agents/`, and `~/.cline/agents/`: [Cline configuration directory layout](https://docs.cline.bot/getting-started/config), accessed 2026-11-02.
- Cline's first-party agents-squad example reads Markdown files with YAML frontmatter from global and project agent directories: [Cline agents-squad README](https://github.com/cline/cline/blob/main/sdk/examples/plugins/agents-squad/README.md) and [implementation](https://github.com/cline/cline/blob/main/sdk/examples/plugins/agents-squad/index.ts), accessed 2026-11-02.
- Devin CLI documents custom subagents in `.devin/agents/` and `~/.config/devin/agents/`, using Markdown with YAML frontmatter: [Devin CLI subagents](https://docs.devin.ai/cli/subagents).
- Devin CLI imports legacy project skills from `.windsurf/skills/` and legacy global skills from the channel-specific Codeium directory; stable Windsurf uses `~/.codeium/windsurf/skills/`: [Devin configuration import](https://docs.devin.ai/cli/reference/configuration/read-config-from.md) and [Devin Skills overview](https://docs.devin.ai/cli/extensibility/skills/overview.md), accessed 2026-11-02.

## Unverified

- Cline's app config documentation names its `agents/` directories, but this pass did not confirm whether Cline's built-in UI/CLI loads arbitrary library agent definitions in the exact way this package expects. The Markdown preset behavior verified above is implemented by the optional Cline SDK agents-squad plugin.
- Devin's docs provide modern and legacy locations, but this pass did not test a real Windsurf or Devin environment.
- Windows and non-stable Windsurf channels were not tested. Current path mapping targets the documented stable channel.

## Not checked

- External skill installer support for these agents. The package currently limits scanned external installation to OpenCode and Claude Code.
