# General Skills

一个面向 AI 编程工具的通用 Skills 仓库。这里的 `skills/` 是技能源码目录，npm 包只发布轻量级命令行工具 `gskills`，不会把 `skills/` 打进包里。这样后续新增或更新技能后，用户不需要升级 npm 包，也可以从 GitHub 仓库实时拉取最新技能。

默认远程源：

```text
zhy15608103017/generalSkills@main
```

## 通过 npm 使用

不全局安装，直接使用：

```powershell
npx general-skills list
npx general-skills add my-skill another-skill
```

全局安装后使用：

```powershell
npm install -g general-skills
gskills list
gskills aicodings
gskills add my-skill another-skill
gskills remove my-skill --aicoding claude
```

当 `gskills add` 或 `gskills remove` 在交互式终端中运行，并且没有传入 `--aicoding` 时，会出现 AI 编程工具选择列表。默认选项是 `default`，安装目录是 `.agents/skills`。在 CI 或脚本等非交互环境中，会自动使用 `default`，避免命令卡住。

## 支持的 AI 编程工具

```powershell
gskills aicodings
```

当前目标：

| 目标 | 安装目录 |
| --- | --- |
| `default` | `.agents/skills` |
| `codex` | `.agents/skills` |
| `claude` | `.claude/skills` |
| `cursor` | `.cursor/skills` |
| `trae` | `.trae/skills` |
| `windsurf` | `.windsurf/skills` |
| `gemini` | `.gemini/skills` |
| `opencode` | `.opencode/skills` |

也可以直接指定目标：

```powershell
gskills add my-skill --aicoding default
gskills add my-skill --aicoding codex
gskills add my-skill --aicoding claude
gskills add my-skill --aicoding cursor
gskills add my-skill --aicoding trae
gskills add my-skill --aicoding windsurf
gskills add my-skill --aicoding gemini
gskills add my-skill --aicoding opencode
gskills add my-skill --aicoding all
```

`--tool` 仍然保留为 `--aicoding` 的兼容别名。

## 切换远程源

使用其他仓库或分支：

```powershell
gskills list --source owner/repo --ref main
gskills add my-skill --source https://github.com/owner/repo.git --ref main
```

也可以通过环境变量覆盖默认值：

```powershell
$env:GSKILLS_SOURCE = "owner/repo"
$env:GSKILLS_REF = "main"
gskills list
```

## 仓库结构

```text
skills/                  # 技能源码目录，每个技能一个文件夹
  example-skill/
    SKILL.md             # 必需：包含 name 和 description frontmatter
    scripts/             # 可选：可重复执行的脚本
    references/          # 可选：按需加载的参考文档
    assets/              # 可选：模板、图片、示例文件等资源
scripts/                 # 仓库维护脚本
bin/                     # 发布到 npm 的 gskills 命令
templates/               # 新技能模板
docs/                    # 兼容性和设计文档
```

请把 `skills/` 作为唯一手写源码目录。发布到 npm 时，`package.json` 的 `files` 白名单会排除 `skills/`，确保安装包保持轻量。

## 创建新技能

```powershell
npm run new-skill -- my-skill --description "Use when doing a specific repeatable task." --resources references,scripts
```

该命令会创建 `skills/my-skill/SKILL.md`，并按需创建 `references/`、`scripts/`、`assets/` 等资源目录。

## 校验技能

```powershell
npm run validate
npm test
```

`npm run validate` 会校验技能目录命名和 `SKILL.md` frontmatter。`npm test` 会运行命令行工具和安装逻辑的自动化测试。

## 本地开发时安装技能

如果技能还没有推送到 GitHub `main`，`gskills add` 看不到它。此时可以使用本仓库的本地安装脚本：

```powershell
npm run install-skills -- --aicoding default --dest D:\path\to\project --skills my-skill
```

安装到所有支持目标：

```powershell
npm run install-skills -- --aicoding all --dest D:\path\to\project --skills my-skill,another-skill
```

安装到当前仓库用于本地测试：

```powershell
npm run install-skills -- --aicoding default --dest . --skills code-review-loop
```

兼容旧用法时仍可使用 `--tool`，但新文档和示例优先使用 `--aicoding`。

发布后的用户使用方式仍然推荐：

```powershell
gskills add my-skill
gskills remove my-skill
```

## 发布前检查

```powershell
npm test
npm run validate
npm pack --dry-run
```

`npm pack --dry-run` 的输出中不应包含 `skills/`。
