# OpenCode configurable capabilities

Asked: 2026-11-09. Version context: OpenCode **V2** (`opencode v2.2.6` installed here), public docs at `https://opencode.ai/docs/`. All URLs accessed **2026-11-09** unless marked otherwise.

Method: read the public V2 docs index, then every relevant V2 page. No config was edited, nothing was installed, no MCP server was started, and no OpenCode command that changes state was run. Source IDs (`S1`…`S28`) are resolved with full URLs in [Sources](#sources).

## Summary

OpenCode V2 is configured by one JSON/JSONC file (`opencode.json(c)`) plus a separate terminal-client file (`cli.json`). The configurable surfaces are: `$schema`, `shell`, `model`, `default_agent`, `update`, `username`, `permissions`, `policies`, `agents`, `snapshots`, `watcher`, `formatter`, `media`, `tool_output`, `websearch`, `mcp`, `compaction`, `warming`, `skills`, `commands`, `instructions`, `references`, `worktree`, `plugins`, `providers`, and `experimental` (S2).

Three findings shape everything else:

1. **V2's default posture is permissive.** Every agent starts from a base policy whose first rule is allow-everything, and `external_directory` is allowed by default. A deny-by-default posture has to be written explicitly (S5, S3).
2. **There is no official catalog of MCP servers or plugins.** opencode.ai documents the mechanisms and a PR-submitted community ecosystem list. It does not publish a vetted server list, and "include all MCP servers" has no vendor-defined set to include (S8, S24).
3. **Most of this repo's current `opencode.json` is V1-shaped.** V2 still reads it, but recommends `permissions`, `agents`, `providers`, `plugins`, and `mcp.servers`. V1-only keys such as `tools`, `permission`, `autoupdate`, and `lsp` are accepted-but-inert or translated, so a file can look fully configured while some fields do nothing (S3).

## Version warning: V2 vs the file in this repo

| Fact | Evidence |
|---|---|
| Installed CLI is V2.2.6 | `opencode --version` → `opencode v2.2.6` (local check, 2026-11-09) |
| V2 docs are the current docs | Docs index titled "OpenCode V2 Documentation" (S26) |
| `opencode.json` here uses `"permission"` (singular, tool→path→effect map) | repo `opencode.json` lines 6–1234 |
| V2 says use `permissions`, `shell`, `subagent` instead of `permission`, `bash`, `task` | S5, warning callout |
| V2 also accepts V1 fields and normalizes them in memory | S3, "Use your existing configuration" |

The migration page states that supported V1 configuration is intended to keep working (S3). It does **not** publish a field-by-field guarantee for the V1 `permission` map, so the current file should be treated as *deprecated but probably loading*. I did not run a live permission prompt to prove the translation (see [Not checked](#not-checked)).

## Configurable surfaces (V2 `opencode.json(c)`)

`$schema` value: `https://opencode.ai/config.json` (S2). The terminal client uses a separate schema, `https://opencode.ai/v2/cli.json` (S20).

| Key | Values / shape | What it does | Source |
|---|---|---|---|
| `$schema` | URL string | Editor validation + autocomplete. Docs call the schema the source of truth for fields and nested shapes. | S2 |
| `shell` | string path | Shell used by the terminal and `shell` tool. | S2 |
| `model` | `"provider/model"` | Default model for new work; root value keeps no `#variant`. | S2, S13 |
| `default_agent` | agent ID | Primary agent when a session does not select one. Must exist, be visible, and support primary mode, else falls back to `build`. | S2, S11 |
| `update` | `"disable"` \| `"notify"` \| `"auto"` (default `notify`) | Update checks/installs. Global only; project values ignored. Auto-install does not restart the server. Replaces V1 `autoupdate`. | S2, S3 |
| `username` | string | Accepted; not displayed in conversations. | S2 |
| `permissions` | array of `{action, resource, effect}` | Ordered per-agent tool rules; `effect` = `allow` \| `ask` \| `deny`; last match wins. Replaces V1 `permission`. | S2, S5 |
| `policies` | array of `{action, resource, effect}` | Binary, never prompts, only tightens. Actions: `provider.use`, `tool.use`, `integration.connect`, `integration.use`, `mcp.use`, `skill.use`, `plugin.use`, `websearch.use`. `effect` = `allow` \| `deny`. | S2, S6 |
| `agents` | map of agent ID → agent object | Override built-ins or define custom agents. Fields: `description`, `mode`, `model`, `system`, `permissions`, `steps`, `hidden`, `color`, `disabled`, `request`. Replaces V1 `agent`/`mode` maps. | S2, S11 |
| `snapshots` | boolean | Filesystem snapshots used by undo/revert. Replaces V1 `snapshot`. | S2, S3 |
| `watcher` | `{ignore: string[]}` | Paths that must not trigger filesystem updates. | S2 |
| `formatter` | `true` \| `false` \| object | Format after `write`/`edit`/`patch`. Object can disable or add named formatters (`command`, `extensions`, `environment`, `disabled`). Disabled unless configured. | S2, S16 |
| `media` | `{image:{auto_resize,max_width,max_height,max_base64_bytes}}` | Resize/reject oversized images read by `read`. Replaces V1 `attachment`. | S2, S3 |
| `tool_output` | `{max_lines, max_bytes}` | Cap retained tool-result output. | S2 |
| `websearch` | `{provider}` or `false` | Pick/auto-pick (`"random"`) a search provider, or remove the `websearch` tool entirely. Provider IDs: `exa`, `firecrawl`, `parallel`, `tavily`, `tinyfish`, or Console `opencode`. | S2, S18 |
| `mcp` | `{timeout:{startup,catalog,execution}, servers:{...}}` | MCP servers. **V2 nests under `mcp.servers`**; server names are not direct children of `mcp`. | S2, S8 |
| `compaction` | `{auto, keep:{tokens}, buffer}` | Automatic context compaction. `buffer` is a token count or percentage string. Native provider compaction is opted into per provider/model via `settings.compaction`. | S2 |
| `warming` | `{prompt, interval, duration}` | Periodic cache-warming requests. Disabled by default. | S2 |
| `skills` | array of local paths and/or `http(s)` catalog URLs | Extra skill sources. V2 combines V1 `skills.paths` + `skills.urls` into one array. | S2, S7, S3 |
| `commands` | map of name → `{template, description, agent, model, subagent}` | Reusable slash-command prompt templates. Replaces V1 `command`; `subtask` → `subagent`. | S2, S14, S3 |
| `instructions` | array of files, globs, `~/` paths, or HTTP(S) URLs | Extra instruction sources loaded after `AGENTS.md`. | S2, S15 |
| `references` | map alias → `{path}` \| `{repository, branch}` \| string shorthand | Named local or Git context outside the project. Replaces V1 `reference`. | S2, S17 |
| `worktree` | `{directory}` | Parent directory for new local worktrees. | S2 |
| `plugins` | array of package strings, local dirs, `file://`, or `{package, options}` | Load server/TUI/GUI plugins. `-id` disables, `*` wildcard, `.*` prefix. Replaces V1 `plugin`. | S2, S9, S3 |
| `providers` | map provider ID → `{name, env, package, canonical, compatibility, settings, headers, body, models}` | Configure credentials, endpoints, runtime package, and model overrides. Replaces V1 `provider`. | S2, S12, S3 |
| `experimental` | object | `todo`, `subagent_depth`, `background_compaction`, `image_generate`, `location_idle_timeout`, deprecated `policies`. Warned as unstable. | S2 |

Variables usable inside any string: `{env:NAME}` (unset → empty string) and `{file:path}` (missing → empty string). Useful for keys kept outside the file (S2).

### Legacy / inert keys (accepted, do not rely on)

| Key | V2 status | Source |
|---|---|---|
| `permission` | V1 form; use `permissions`. | S5, S3 |
| `tools` | V1 form; disable a tool with a `permissions` `deny` instead. | S3, S11 |
| `agent`, `command`, `provider`, `plugin`, `reference`, `snapshot`, `attachment` | Singular V1 forms; renamed in V2. | S3 |
| `autoupdate` | Becomes `update`. | S3 |
| `lsp` | **Accepted and preserved but inert**: V2 does not run language servers, expose LSP tools, or produce diagnostics. Also not a V2 permission action. | S3, S5 |
| `share` | Not a V2 config surface. Sharing is discontinued; the SDK `session.share` endpoint returns an error. | S27 |
| `server`, `logLevel`, top-level `subagent_depth` | Accepted-but-unsupported: ignored with a warning. | S3 |
| `small_model`, `enabled_providers`, `disabled_providers` | Replaced by `agents.title.model` and `provider.use` policies. | S3, S6 |
| `enterprise` | Named as a field that needs no migration; not documented in the V2 config page. | S3 |

## Built-in tools

V2 has **no top-level `tools` map**. A tool is enabled unless a `permissions` rule denies it; `ask` keeps it enabled but gates each use. `websearch: false` is the one documented shorthand that removes a tool (S18).

| Tool name (config action) | Purpose | Safe recommendation | Source |
|---|---|---|---|
| `read` | Read a file or non-recursive directory listing (text, images, PDF; 2,000 lines / 50 KiB per page). | `allow`, with `deny` on secret paths. | S4 |
| `glob` | Find paths by pattern; 100 default limit, 30 s timeout. | `allow`. | S4 |
| `grep` | Search file contents; resource is the pattern, not the path. | `allow`. | S4 |
| `edit` | Replace text in an existing file. | `allow` inside project; `deny` secrets; `deny` `external_directory`. | S4 |
| `write` | Create or fully replace a file. Uses the **`edit`** permission action. | Same as `edit`. | S4 |
| `patch` | Multi-file add/update/move/delete. Uses **`edit`** for every affected path; GPT-only surface. | Same as `edit`. | S4 |
| `shell` | Run a command in the host user's shell (foreground 2 min default, background optional). Has the host user's filesystem, process, and network authority. | `ask` always; hard-deny destructive verbs via `policies`. | S4 |
| `webfetch` | Fetch one HTTP(S) URL as markdown/text/html. | `ask`, or an allowlist of doc hosts. | S4 |
| `websearch` | Search via the configured provider. | `ask`; provider choice is a separate decision. | S4, S18 |
| `experimental_image_generate` | Generate/edit images; needs an image model. | `ask` or `deny`. | S4 |
| `question` | Pause and ask the user a structured question. | `allow`. | S4 |
| `skill` | Load one skill's instructions by exact ID. | `allow` (content is still permission-gated downstream). | S4 |
| `subagent` | Start a child session with a subagent; default nesting depth 1. | `ask`, or `allow` only named local agents. | S4, S11 |
| `execute` | Run JavaScript in Code Mode to compose catalog tools. Deny removes Code Mode and tools reached only through it. | `allow` only if Code Mode is wanted; nested tools keep their own rules. | S4 |
| `session_rename`, `session_move` | Code Mode session utilities (`opencode` namespace). | No documented permission action. | S4 |
| `worktree_create`, `worktree_list`, `worktree_remove` | Worktree management. `worktree_remove` uses `edit` with the worktree dir. | `worktree_remove` gated by `edit`. | S4 |
| `browser` (namespace) | Desktop-app browser: tabs, click, form fill, screenshots, console/network, Lighthouse. **Issues no per-operation prompts**, so a `deny` with `*` removes the whole catalog. Page content is untrusted data. | `deny` unless explicitly needed. | S4 |
| `opencode_list_mcp_resources`, `opencode_read_mcp_resource` | Read MCP resources. | `ask`; no servers configured by default. | S4, S8 |
| `<server>_<tool>` | Every MCP tool, resource `*`. | Only after a server is deliberately added. | S4, S8 |
| `todowrite` | Todo tracking. Off by default; enabled by `experimental.todo: true`. | Leave off unless wanted. | S2, S4 |

### Skills: layout and discovery

- **Layout.** `<source>/<id>/SKILL.md`, with `scripts/`, `references/`, and templates beside it; paths inside a skill resolve relative to the directory containing `SKILL.md`. A flat `<source>/<id>.md` is also valid, but only at the source root. Files named exactly `SKILL.md` may be nested in grouping dirs. A directory containing `SKILL.md` is one skill; OpenCode does not search inside it for more (S7).
- **Limits.** Hidden files/dirs and `node_modules` are skipped, and search stops six directories below the source root (S7).
- **Automatic sources.** Global: `~/.config/opencode/skills`; compatibility: `~/.claude/skills`, `~/.agents/skills`. Project: `.opencode/skills`, `.claude/skills`, `.agents/skills`, searched from the current directory up to the project root (S7).
- **Precedence (low → high):** built-in skills → `.claude/skills` → `.agents/skills` → `~/.config/opencode/skills` → project `.opencode/skills` → explicit `skills` array in config order. Later sources win on duplicate IDs (S7).
- **IDs** come from the path, not frontmatter `name`: `git-release/SKILL.md` → `git-release`; `teams/release/SKILL.md` → `release`. IDs are exact and case-sensitive (S7).
- **Frontmatter:** `name` (display), `description` (required for the model to see it), `metadata.opencode/autoinvoke: false` (hide from the model list but keep loadable by ID), `disable-model-invocation: true` (same). `license`/`compatibility` are accepted but not interpreted (S7).
- **HTTP catalogs:** a base URL with `index.json` listing `name`, `version`, `files`; files download from `<base>/<name>/<file>`, paths must be relative and same-origin, and `version` must change for OpenCode to refresh its cache (S7).
- **Permissions:** action `skill`, resource is the ID; `deny` hides the skill from the model and rejects loading (S7).

### Providers and models

- **Built in.** OpenCode ships a provider/model catalog sourced from models.dev, plus built-in local discovery for Ollama (`127.0.0.1:11434`), LM Studio (`:1234`), and vLLM (`:8000`) (S12, S13).
- **Credentials.** Connect interactively with `/connect` or `opencode auth login`; or supply a supported environment variable on the server process. Saved API keys/OAuth tokens live in the server's SQLite database, not in `opencode.json`; env-based connections are not accounts and cannot be logged out (S12, S23).
- **Custom providers.** `providers.<id>` takes `env`, `package`, `canonical`, `compatibility`, `settings`, `headers`, `body`, `models`. `package` picks the runtime: a `@opencode/ai/providers/*` native package, an npm package, or a `file://` path — npm and file packages are third-party code (S12).
- **Models.** `providers.<id>.models.<id>` takes `modelID`, `name`, `family`, `type`, `releaseDate`, `package`, `settings`, `headers`, `body`, `capabilities`, `compatibility`, `variants`, `cost`, `limit`, `disabled` (S12, S13).
- **Gating.** `provider.use` policies decide which providers are usable at all, however they became known (S6).

## Permissions and policies: exact semantics

**Rule shape.** `{action, resource, effect}`. `effect` is `allow`, `deny`, or `ask` (S5).

**Matching.** Whole-value wildcards: `*` matches zero or more characters *including `/`*, `?` matches exactly one. The pattern matches the entire normalized path; backslashes normalize to `/`; Windows matching is case-insensitive. A shell pattern ending in ` *` also matches the bare command (`git status *` matches `git status`) (S5).

**Order.** "Last matching rule wins." Configuration is combined lowest-precedence first; agent rules are appended after global rules and do not replace them (S5).

**Multi-resource operations.** Any `deny` denies; otherwise any `ask` asks; otherwise allowed (S5).

**Default.** The documented fallback is `ask` when no rule matches, **but** every agent starts from a base policy whose first rule is allow-everything:

```jsonc
[
  { "action": "*", "resource": "*", "effect": "allow" },
  { "action": "read", "resource": "*.env", "effect": "ask" },
  { "action": "read", "resource": "*.env.*", "effect": "ask" },
  { "action": "read", "resource": "*.env.example", "effect": "allow" }
]
```

So the practical V2 default is *allow*, with `.env` reads asking. `external_directory` is also allowed by default (V1 asked). A leading `{"action":"*","resource":"*","effect":"ask"}` rule is required for deny-by-default behavior (S5, S3).

**Agents.** Shared rules go at top level; narrower rules go under `agents.<id>.permissions` and are appended. A custom subagent uses **its own** permissions, not a subset of its parent's, so a subagent can be more permissive than the agent that launches it (S5, S11).

**Approvals.** `ask` responses are `once`, `always`, `reject`. `always` saves durable, project-scoped allow rules and can propose a broad pattern. Saved approvals never override a configured `deny` (S5).

**Policies are the hard stop.** `tool.use` hard-denies a permission check *after* rules and saved approvals, and `allow` never grants access — it only lifts an earlier broader deny. This is the only documented mechanism that survives a user pressing "Allow always" (S6).

**Shell caveat.** The shell scanner analyzes Bash/Zsh/POSIX sh/PowerShell and errors on unanalyzable syntax, but directory inference is explicitly "best effort"; the docs recommend a narrow allowlist over patterns meant to catch every dangerous command (S5).

**Command shell blocks bypass all of this.** `` !`cmd` `` in a command template runs when the command is evaluated, "outside the agent's tool permission flow" (S14). Treat command files as executable configuration.

## MCP, plugins, and skills: official vs third-party vs not provided

| Surface | Provided by opencode.ai? | Third-party? | Finding | Source |
|---|---|---|---|---|
| MCP protocol support | **Yes, first-party** | — | Local (stdio) and remote (Streamable HTTP), OAuth by default for remote, `{env:}` headers, timeouts, `protocol` revisions, connection pooling. | S8 |
| MCP server catalog | **No** | — | There is no published list of servers to "include". Docs show example servers only (`context7`, `sentry`, `cloudflare`, `playwright`, `@modelcontextprotocol/server-everything`). | S8 |
| MCP via Console workspace | Yes, as a delivery mechanism | Servers themselves are third-party | A connected Console workspace can deliver MCP servers/config; `integration.use` / `mcp.use` govern them. | S6 |
| Local MCP `type` | `"local"` | command is third-party code | Fields: `command`, `cwd`, `environment`, `disabled`, `codemode`, `timeout`, `protocol`, `pool`. | S8 |
| Remote MCP `type` | `"remote"` | endpoint is third-party | Fields: `url`, `headers`, `oauth`, `disabled`, `codemode`, `timeout`, `protocol`, `pool`. OAuth fields are snake_case (`client_id`, `client_secret`, `scope`, `callback_port`, `redirect_uri`). | S8 |
| MCP tool naming | First-party convention | — | `<server>_<tool>`; non-alphanumerics become `_`; permission action is the same name with resource `*`. | S8 |
| Code Mode for MCP | First-party | — | `codemode` defaults `true`; set `false` to expose tools directly on the provider tool list. | S8 |
| Plugin system | **Yes, first-party** | — | Server/TUI/GUI/RPC parts, hooks, added tools/commands/agents. | S9, S10 |
| Plugin registry / vetted marketplace | **No** | — | No reviewed registry. `opencode plugin add` installs npm names, tags, ranges, or Git specs. | S9 |
| Community plugin list | Listed by opencode.ai, not vetted | **Yes** | `/docs/ecosystem` is a PR-submitted list ("Want to add your project? Submit a PR"), alongside links to `awesome-opencode` and `opencode.cafe`. | S24 |
| Built-in plugins | **Yes** | — | `opencode.config.policy` and `opencode.provider.opencode` cannot be removed; also `opencode.provider.openai-context-caps`, `opencode.provider.ollama`/`lmstudio`/`vllm`, and TUI `opencode.notifications`. | S6, S9, S12, S20 |
| Plugin auto-discovery | First-party behavior | **Repo-supplied code** | Any `.opencode/plugins/*.ts|js` and immediate package dirs are loaded automatically, and `~/.config/opencode/plugins/` globally. | S9 |
| Skills system | **Yes, first-party** | — | `SKILL.md`, path-derived IDs, frontmatter, on-demand loading via the `skill` tool. | S7 |
| Official skills catalog | **No** | — | No official skill pack or registry is documented. Skills come from your files, `.claude`/`.agents` compatibility dirs, explicit `skills` entries, or a Console workspace. | S7 |
| `opencode` skill | In-session built-in (observed); not enumerated publicly | — | Available in this session with base directory `skill://opencode`. The V2 skills page lists "Built-in skills" as the lowest-precedence source but does **not** list them, so origin beyond "present as a built-in skill" is **unverified**. | S7, S28 |
| Custom tools (`.opencode/tools/*.ts`) | Documented on a V1 page | Author-supplied code | The page (`/docs/custom-tools`) uses the V1 navigation and the `@opencode-ai/plugin` package; V2's plugin "Server" part is the documented way to add tools. Treat `.opencode/tools/` as **V1-only until verified** in V2. | S25, S10 |

## What "include all tools, skills, mcp, etc." can safely mean

A literal "enable everything" is not safe, and for MCP/plugins it is not even well-defined because opencode.ai ships no catalog (S8, S24). The defensible reading:

**Safe to enable broadly (first-party, no credentials, no network egress):**

- All built-in file/discovery tools: `read`, `glob`, `grep`, `edit`/`write`/`patch` — scoped to the project with secret-path denies.
- `question`, `skill`, `session_*`, `worktree_create/list`.
- All local skills under the project's own skill directories.
- Built-in agents (`build`, `plan`, `general`, `explore`) and the project's own agents (S11).

**Enable only behind an explicit prompt (`ask`):**

- `shell` — host authority, best-effort scanning (S5).
- `webfetch`, `websearch` — network egress and prompt-injectable content (S4, S18).
- `subagent` — child sessions can carry different permissions (S5).
- `experimental_image_generate` — costs money and sends prompts to an image provider (S4).
- `execute` — gateway to Code Mode; fine alone, but it is how MCP tools are reached (S4).

**Do not enable by default:**

| Item | Why |
|---|---|
| Remote MCP servers | Third-party endpoint receives prompts/tool args; OAuth grants a live session; server instructions are injected into the system prompt (S8). |
| Local MCP servers | `command` is arbitrary code started on your machine; `npx -y` pulls and runs a package (S8). |
| Third-party plugins | Arbitrary server/TUI/GUI code with no sandbox; docs only say policies "do not sandbox plugin code" (S6, S9). |
| Repo-local `.opencode/plugins/` in untrusted repos | Auto-loaded on project open — opening a repo is enough to run its plugin code (S9). |
| Credential-bearing providers/integrations | Credentials live in the server DB or env; custom `package` runtimes are third-party code (S12, S23). |
| `browser` namespace | Desktop browser control with **no per-operation prompts** (S4). |
| HTTP skill catalogs / HTTP `instructions` | Remote text becomes model instructions with no review step (S7, S15). |
| Formatters on an untrusted repo | Runs the project's formatter binary/dependency (S16). |
| `share` | Discontinued in V2 (S27). |

**Best available way to express "everything, but gated":** a leading catch-all `ask` rule, then explicit `allow` for read/glob/grep/edit inside the project, then `deny` for secrets and `external_directory`, then `policies` `tool.use` hard-denies for destructive shell verbs. Policies are the only layer a user cannot click through (S5, S6).

## Recommended safe `opencode.json` shape

Proposal only. **Not applied** — `opencode.json` is unchanged. JSONC (comments allowed, S2). This uses V2-native keys; it deliberately does not mix in V1 `permission`.

```jsonc
{
  "$schema": "https://opencode.ai/config.json",

  // Keep the project's routing entry point. The agent must exist (file-based
  // under ~/.config/opencode/agents or .opencode/agents) or OpenCode falls
  // back to `build`.
  "default_agent": "orchestrator",

  // Local skill sources only. No http(s) catalogs: remote text would become
  // model instructions with no review step.
  "skills": [
    "{env:HOME}/.config/junamis/skills/skills",
    "{env:HOME}/.agents/skills"
  ],

  // Shared docs installed by junamis-skills.
  "instructions": ["{env:HOME}/.config/junamis/skills/*.md"],

  // Global-only. Never auto-install; auto-install cannot restart the server.
  "update": "notify",

  // Formatters execute project tooling. Opt in per project, not globally.
  "formatter": false,

  // No third-party plugins. Built-in plugins are unaffected by this array.
  "plugins": [],

  // No MCP servers by default. Add one only as a reviewed decision; see the
  // commented template at the end.
  "mcp": {
    "servers": {}
  },

  "permissions": [
    // 1. Baseline: everything not matched below asks. Required because the
    //    implicit base policy starts with allow-everything.
    { "action": "*", "resource": "*", "effect": "ask" },

    // 2. Local discovery and reads.
    { "action": "read", "resource": "*", "effect": "allow" },
    { "action": "glob", "resource": "*", "effect": "allow" },
    { "action": "grep", "resource": "*", "effect": "allow" },

    // 3. Secret material is unreadable. `*` matches `/`, so these cover
    //    nested paths too.
    { "action": "read", "resource": "*.env*", "effect": "deny" },
    { "action": "read", "resource": "*.pem", "effect": "deny" },
    { "action": "read", "resource": "*.key", "effect": "deny" },
    { "action": "read", "resource": "*.p12", "effect": "deny" },
    { "action": "read", "resource": "*.pfx", "effect": "deny" },
    { "action": "read", "resource": "*.jks", "effect": "deny" },
    { "action": "read", "resource": "*.keystore", "effect": "deny" },
    { "action": "read", "resource": "*.ppk", "effect": "deny" },
    { "action": "read", "resource": "id_*", "effect": "deny" },
    { "action": "read", "resource": "*credentials*", "effect": "deny" },
    { "action": "read", "resource": "*service-account*", "effect": "deny" },
    { "action": "read", "resource": "*secret*", "effect": "deny" },
    { "action": "read", "resource": "*token*", "effect": "deny" },
    { "action": "read", "resource": ".npmrc", "effect": "deny" },
    { "action": "read", "resource": ".netrc", "effect": "deny" },
    { "action": "read", "resource": ".pypirc", "effect": "deny" },
    { "action": "read", "resource": ".git-credentials", "effect": "deny" },
    { "action": "read", "resource": "*.tfvars", "effect": "deny" },
    { "action": "read", "resource": "*.tfstate*", "effect": "deny" },
    { "action": "read", "resource": "*kubeconfig*", "effect": "deny" },
    { "action": "read", "resource": ".aws/*", "effect": "deny" },
    { "action": "read", "resource": ".gcp/*", "effect": "deny" },
    { "action": "read", "resource": ".azure/*", "effect": "deny" },
    // Re-allow the committed templates after the broad denies above.
    { "action": "read", "resource": "*.env.example", "effect": "allow" },
    { "action": "read", "resource": "*.env.sample", "effect": "allow" },
    { "action": "read", "resource": "*.env.template", "effect": "allow" },

    // 4. Edits inside the project only.
    { "action": "edit", "resource": "*", "effect": "allow" },
    { "action": "edit", "resource": "*.env*", "effect": "deny" },
    { "action": "edit", "resource": "*.pem", "effect": "deny" },
    { "action": "edit", "resource": "*.key", "effect": "deny" },
    { "action": "edit", "resource": "id_*", "effect": "deny" },
    { "action": "edit", "resource": "*credentials*", "effect": "deny" },
    { "action": "edit", "resource": "*secret*", "effect": "deny" },
    { "action": "edit", "resource": "*.env.example", "effect": "allow" },
    // V2 allows external paths by default; restore an explicit wall.
    { "action": "external_directory", "resource": "*", "effect": "deny" },

    // 5. Shell always asks. Destructive verbs are hard-denied in `policies`.
    { "action": "shell", "resource": "*", "effect": "ask" },

    // 6. Network tools ask. Narrow to an allowlist if the team wants.
    { "action": "webfetch", "resource": "*", "effect": "ask" },
    { "action": "websearch", "resource": "*", "effect": "ask" },

    // 7. Interaction and automation.
    { "action": "question", "resource": "*", "effect": "allow" },
    { "action": "skill", "resource": "*", "effect": "allow" },
    { "action": "subagent", "resource": "*", "effect": "ask" },
    { "action": "execute", "resource": "*", "effect": "allow" },

    // 8. Desktop browser has no per-op prompts; keep the catalog off.
    { "action": "browser", "resource": "*", "effect": "deny" },
    { "action": "experimental_image_generate", "resource": "*", "effect": "ask" }
  ],

  // Hard denials. These survive "Allow always" and cannot be lifted by an
  // agent rule. Patterns are literal command strings, so they are best-effort:
  // the `ask` gate above is the primary control.
  "policies": [
    { "action": "tool.use", "resource": "shell:git push *", "effect": "deny" },
    { "action": "tool.use", "resource": "shell:git reset --hard *", "effect": "deny" },
    { "action": "tool.use", "resource": "shell:git clean *", "effect": "deny" },
    { "action": "tool.use", "resource": "shell:sudo *", "effect": "deny" },
    { "action": "tool.use", "resource": "shell:rm -rf *", "effect": "deny" },
    { "action": "tool.use", "resource": "shell:npm publish *", "effect": "deny" },
    { "action": "tool.use", "resource": "shell:pnpm publish *", "effect": "deny" },
    { "action": "tool.use", "resource": "shell:vercel * --prod*", "effect": "deny" },
    { "action": "tool.use", "resource": "shell:kubectl delete *", "effect": "deny" },
    { "action": "tool.use", "resource": "shell:terraform apply *", "effect": "deny" },
    { "action": "tool.use", "resource": "shell:terraform destroy *", "effect": "deny" },
    { "action": "tool.use", "resource": "edit:*.env", "effect": "deny" },

    // Optional belt-and-braces. Uncomment only after checking the Console
    // interaction: a broad deny also blocks workspace-delivered servers.
    // { "action": "mcp.use", "resource": "*", "effect": "deny" },
    // { "action": "plugin.use", "resource": "*", "effect": "deny" }
  ],

  "agents": {
    // Example: keep the router from launching arbitrary subagents.
    "orchestrator": {
      "description": "Routes requests and dispatches one step at a time",
      "mode": "primary",
      "permissions": [
        { "action": "subagent", "resource": "*", "effect": "deny" },
        { "action": "subagent", "resource": "reviewer", "effect": "allow" }
      ]
    }
  }

  // MCP template. Enable only after a decision to trust the endpoint:
  // "mcp": {
  //   "servers": {
  //     "example": {
  //       "type": "remote",
  //       "url": "https://mcp.example.com/mcp",
  //       "disabled": true
  //     }
  //   }
  // }
}
```

Notes on that shape:

- The leading `*` → `ask` rule is load-bearing. Without it the built-in base policy allows everything (S5).
- `edit` covers `write` and `patch`; there is no separate action for them (S5).
- `external_directory` `deny` is stricter than V1's `ask` and much stricter than V2's default `allow` (S5, S3).
- Policy denies are string-pattern based. `rm -fr`, `rm --recursive --force`, `git -C x push`, and shell wrappers will not match; that is why they supplement, not replace, `ask` (S6).
- If the team wants a single switch for "no MCP at all", use the `mcp.use` policy. Do not rely on an empty `mcp.servers` object alone, because a Console workspace or a higher-precedence config can add servers (S6, S8).

## Risks and decisions needed

1. **Migrate `permission` → `permissions`, or keep the V1 block?** The current file is V1-shaped; V2 documents it as deprecated. A half-migrated file is the worst case: readers assume a deny is active while it is expressed in a form the docs no longer recommend (S5, S3).
2. **Allow `external_directory`?** V2 defaults to allow; the current file denies. Denying breaks any workflow that reads outside the project, including some references and MCP paths (S5, S3).
3. **Remote MCP servers: none, allowlist, or all?** Each adds a third-party endpoint, OAuth session, and system-prompt instructions. There is no official vetted list to pick from (S8).
4. **Third-party plugins: none, pinned allowlist, or open?** Plugins are unsandboxed code. Also decide whether to block repo-local `.opencode/plugins/` auto-load for untrusted checkouts (S9, S6).
5. **Network tools:** `webfetch`/`websearch` `ask`, allowlist, or deny? And which search provider — five need API keys, Console needs an account (S18, S12).
6. **Shell posture:** always `ask` (usable, noisy) vs a command allowlist (quiet, easy to get wrong). Shell has host authority and inference is best-effort (S5).
7. **Providers and credentials:** which providers are in scope, and are custom `package` runtimes (npm/`file://`) allowed? A custom provider package is third-party code running in the server (S12, S23).
8. **Skills via HTTP catalogs:** allow remote `skills` URLs and HTTP `instructions`? Both inject unreviewed remote text into prompts (S7, S15).
9. **`execute` / Code Mode:** keep it (needed to reach MCP tools by default) or deny it and accept losing Code Mode (S4).
10. **Desktop `browser` tool:** deny, or allow for reviewers/frontend work? It has no per-operation prompts (S4).
11. **`update`:** `notify` (recommended), `disable`, or `auto`? Auto-install never restarts the server, so a running session stays on the old binary (S2).
12. **Formatter:** off globally, or on for trusted repos only? It executes project tooling (S16).
13. **Hard-deny MCP and plugins with policies?** Safer, but a broad `mcp.use` deny also blocks workspace-delivered servers, and a broad `plugin.use` deny interacts with Console's built-in plugins (S6).
14. **Subagents:** which agent IDs may the orchestrator launch, and do any subagents carry broader permissions than the parent? (S5, S11).

## Not checked

- I did not fetch `https://opencode.ai/config.json` or `https://opencode.ai/v2/cli.json` to enumerate fields, because the `opencode` skill instructs against using the schema to determine the V2 shape. Field coverage here comes from the docs pages, so a schema-only field could be missing.
- I did not run a live permission prompt, so I did not verify that the current V1 `permission` map is translated exactly as written.
- I did not start an MCP server, install a plugin, or test the `browser` namespace.
- I did not enumerate the built-in skills list; the docs do not publish it.
- I did not inspect the Console workspace catalog of providers/MCP servers; only the policy mechanics are documented.
- `/docs/ecosystem` and `/docs/custom-tools` are served with the V1 navigation. The ecosystem list is version-agnostic in content, but per-plugin V2 compatibility is not stated. Custom tools are documented as V1 and are treated as unverified for V2.
- `share` is evidenced only by the SDK page statement that sharing is discontinued; there is no V2 config page for it either way.

## Sources

All accessed 2026-11-09.

| ID | URL | Page |
|---|---|---|
| S1 | https://opencode.ai/docs/ | Intro |
| S2 | https://opencode.ai/docs/config/ | Config |
| S3 | https://opencode.ai/docs/migrate-v1/ | Migrate from V1 |
| S4 | https://opencode.ai/docs/tools/ | Tools |
| S5 | https://opencode.ai/docs/permissions/ | Permissions |
| S6 | https://opencode.ai/docs/policies/ | Policies |
| S7 | https://opencode.ai/docs/skills/ | Skills |
| S8 | https://opencode.ai/docs/mcp-servers/ | MCP servers |
| S9 | https://opencode.ai/docs/plugins/ | Plugins (configure) |
| S10 | https://opencode.ai/docs/build/plugins/ | Build plugins overview |
| S11 | https://opencode.ai/docs/agents/ | Agents |
| S12 | https://opencode.ai/docs/providers/ | Providers |
| S13 | https://opencode.ai/docs/models/ | Models |
| S14 | https://opencode.ai/docs/commands/ | Commands |
| S15 | https://opencode.ai/docs/instructions/ | Instructions |
| S16 | https://opencode.ai/docs/formatters/ | Formatters |
| S17 | https://opencode.ai/docs/references/ | References |
| S18 | https://opencode.ai/docs/websearch/ | Web search |
| S19 | https://opencode.ai/docs/network/ | Network |
| S20 | https://opencode.ai/docs/cli/config/ | CLI settings |
| S21 | https://opencode.ai/docs/cli/keybinds/ | Keybinds |
| S22 | https://opencode.ai/docs/themes/ | Themes |
| S23 | https://opencode.ai/docs/cli/providers/ | CLI providers / auth |
| S24 | https://opencode.ai/docs/ecosystem/ | Ecosystem (V1 nav) |
| S25 | https://opencode.ai/docs/custom-tools/ | Custom tools (V1 nav) |
| S26 | https://opencode.ai/docs/llms.txt | Documentation index |
| S27 | https://opencode.ai/docs/sdk | SDK (V1 nav; share discontinued) |
| S28 | `skill://opencode` (local session) | `opencode` skill, observed 2026-11-09; no public URL |

## Applied decisions (2026-11-09)

The user chose these settings after this research. They are applied in `opencode.json` and enforced by `scripts/check-opencode-config.mjs` and `test/config.test.js`.

- **V2-native config:** `permissions`, `policies`, `mcp.servers`, and `plugins`. The V1 `permission` map and all V1-only keys are removed.
- **File discovery:** `glob` and `grep` were migrated from V1 with the same secret-path denies. `list` was not carried over because V2 has no documented `list` tool and uses `read` for directory listings.
- **MCP:** `{ "servers": {} }`. There is no official catalog, so the reviewed allowlist stays empty.
- **Plugins:** none (`[]`).
- **Network:** keep the existing documentation-host `webfetch` allowlist (it already includes `opencode.ai`); `websearch` asks by default and allows queries containing `opencode.ai`.
- **Shell:** ask every command, plus hard-deny `policies` for destructive verbs.
- **Code Mode:** `execute` allow.
- **Desktop `browser`:** deny.
- **Secondary defaults:** `update: "notify"`, `formatter: false`, `external_directory` deny, local skills and instructions only, existing auth only (no `providers`).

## Handoff

```yaml
agent: researcher
job: Map the OpenCode V2 configurable surface (config, tools, skills, MCP, plugins, agents, providers, permissions) from opencode.ai docs and recommend a safe "enable everything" shape.
status: complete
artifacts:
  - path: docs/research/2026-11-09-opencode-capabilities.md
    kind: created
  - path: opencode.json
    kind: read-only
  - path: AGENTS.md
    kind: read-only
findings:
  - id: F1
    severity: critical
    summary: V2 defaults to allow-everything (base policy `*` allow) and allows external_directory; a deny-by-default posture must be written explicitly.
    evidence: https://opencode.ai/docs/permissions/ "Defaults"; https://opencode.ai/docs/migrate-v1/ callout "V2 does not: external_directory is allowed by default"
  - id: F2
    severity: high
    summary: Repo-local `.opencode/plugins/` is auto-loaded on project open, so opening an untrusted repo can execute its plugin code with no sandbox.
    evidence: https://opencode.ai/docs/plugins/ "Discover"; https://opencode.ai/docs/policies/ "Policies ... do not sandbox plugin code"
  - id: F3
    severity: high
    summary: opencode.ai publishes no vetted catalog of MCP servers or plugins, so "include all MCP/plugins" has no vendor-defined set; only a PR-submitted ecosystem list exists.
    evidence: https://opencode.ai/docs/mcp-servers/ (examples only); https://opencode.ai/docs/ecosystem/ ("Want to add your project to this list? Submit a PR")
  - id: F4
    severity: high
    summary: Command `` !`shell` `` blocks run outside the agent permission flow, and shell runs with the host user's authority with best-effort command inference.
    evidence: https://opencode.ai/docs/commands/ warning "outside the agent's tool permission flow"; https://opencode.ai/docs/tools/ "Shell has the host user's filesystem, process, and network authority"
  - id: F5
    severity: medium
    summary: V2 has no `tools` map; disabling is a `permissions` deny, `lsp` is accepted but inert, and `share`/`autoupdate`/`server` are gone or renamed, so V1 keys can look active while doing nothing.
    evidence: https://opencode.ai/docs/migrate-v1/ "Permissions and tools", "Accepted but unsupported fields"; https://opencode.ai/docs/sdk ('Sharing has been discontinued')
decisions_owed:
  - Migrate the current V1 `permission` block to V2 `permissions`, or leave V1 compatibility in place?
  - Should `external_directory` be `deny` (current file), `ask` (V1 behavior), or `allow` (V2 default)?
  - Which remote MCP servers, if any, are approved, and who reviews each endpoint?
  - Are third-party plugins allowed at all, and should repo-local `.opencode/plugins/` auto-load be blocked by policy?
  - Should `webfetch` and `websearch` be `ask`, allowlisted, or denied, and which search provider is funded?
  - Is shell always-`ask` acceptable, or does the team want a command allowlist?
  - Which providers and credentials are in scope, and are custom provider `package` runtimes allowed?
  - Should remote HTTP `skills` catalogs and HTTP `instructions` be allowed?
  - Keep `execute`/Code Mode, or deny it?
  - Allow the desktop `browser` tool?
  - Set `update` to `notify`, `disable`, or `auto`?
  - Enable `formatter` globally or only per trusted repo?
  - Should `mcp.use *` and `plugin.use *` be hard-denied in `policies`?
  - Which subagent IDs may the orchestrator launch, and do any carry broader permissions than the parent?
next: user
```
