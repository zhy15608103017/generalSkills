# 风格发现

当需要读取项目 UI 参考资料，或需要从现有前端代码库中推断风格时，使用这份参考。

## 固定参考目录

始终先从仓库根目录检查：

```text
.ui-reference/
```

这个目录是项目差异化 UI 参考的固定位置。它可以包含 Markdown 说明、截图、原型导出、示例页面、token 描述或组件使用说明。

如果存在这些内容，按以下顺序阅读：

1. `.ui-reference/style.md`
2. `.ui-reference/tokens.md`
3. `.ui-reference/components.md`
4. `.ui-reference/pages/`
5. `.ui-reference/screenshots/`
6. `.ui-reference/prototypes/`
7. `.ui-reference/` 下其它明显相关的文件

将 `.ui-reference/` 视为“这个项目希望如何生成 UI”的主要指导。它不替代真实代码库；编辑前仍要在源码中确认组件名、导入方式和 token 用法。

## 回退扫描代码库

如果 `.ui-reference/` 不存在或信息不足，就从项目代码中推断风格。优先检查这些文件和目录：

```text
package.json
tailwind.config.*
theme.*
tokens.*
design-system.*
src/styles/
src/theme/
src/components/
src/shared/
src/ui/
components/
app/
pages/
layouts/
styles/
```

使用 `rg` 查找重复出现的样式 token 和组件名称。常用搜索包括：

```bash
rg "border-radius|radius|rounded-|--radius" .
rg "#[0-9a-fA-F]{3,8}|rgb\\(|hsl\\(|oklch\\(" .
rg "--color|colors:|primary|secondary|accent|neutral" .
rg "Button|Card|Modal|Dialog|Table|Input|Select|Badge|Tag" .
```

## 风格摘要

实现前，在内部形成一份简短风格摘要，包含这些字段：

```text
风格来源:
颜色方案:
圆角体系:
间距密度:
字体排版:
边框与阴影:
布局模式:
组件库:
图标体系:
可复用组件:
CSS 体系:
原型适配说明:
```

除非用户要求，不要把完整摘要放进最终回复。它主要用于指导实现决策。

## 冲突处理

当不同来源冲突时：

1. 当前用户对目标页面的明确指令优先。
2. `.ui-reference/` 优先于宽泛的代码库推断。
3. token 和主题文件优先于孤立组件里的硬编码值。
4. 共享组件优先于一次性的页面实现。
5. 相似已有页面优先于无关示例。

如果原型的视觉语言与项目冲突，保留原型的产品结构和交互意图，同时将颜色、圆角、间距、字体和控件适配为项目风格。
