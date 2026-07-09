# 组件复用

当需要把原型映射到当前项目的前端组件时，使用这份参考。

## 优先复用

创建新的 UI 元素前，先查找项目中是否已有这些实现：

```text
Button
IconButton
Input
Textarea
Select
Checkbox
Radio
Switch
Tabs
Table
DataGrid
Card
Panel
Modal
Dialog
Drawer
Dropdown
Popover
Tooltip
Badge
Tag
Avatar
Breadcrumb
Pagination
EmptyState
Loading
Skeleton
Toast
```

优先搜索常见组件目录：

```text
src/components/
src/shared/
src/ui/
components/
app/components/
```

然后检查相近业务模块，寻找筛选栏、汇总卡片、操作菜单、详情面板等业务组合组件。

## 映射规则

将原型元素映射到项目已有基础组件：

```text
主要操作 -> 现有 primary Button 变体
次要操作 -> 现有 secondary/ghost Button 变体
纯图标操作 -> 现有 IconButton，或带 icon 的 Button 变体
数据列表 -> 现有 Table、DataGrid 或 List 模式
筛选区域 -> 现有 SearchForm、FilterBar 或表单控件
指标区块 -> 现有 Stat、SummaryCard、Card 或 Panel
状态文本 -> 现有 Badge、Tag、Pill 或状态组件
浮层 -> 现有 Modal、Dialog、Drawer、Popover 或 Dropdown
导航 -> 现有 Tabs、Sidebar、Breadcrumb 或路由布局
加载状态 -> 现有 Spinner、Skeleton 或页面加载模式
空数据 -> 现有 EmptyState 模式
```

如果没有完全匹配的组件，先用最接近的已有基础组件组合，再考虑新增基础组件。

## 新增组件

只有满足以下条件时才新增组件：

1. 同一种 UI 模式会在多个地方出现。
2. 现有基础组件无法清晰表达所需行为或结构。
3. 新组件能放入项目当前的组件组织方式中。

新增组件时，匹配项目现有约定：

```text
文件命名
导出方式
prop 命名
variant 命名
CSS 或样式方案
测试文件位置
Storybook 或 demo 位置，如果项目使用了它们
```

除非用户明确要求，不要为了实现一个原型而引入新的组件库、样式框架、图标库或 token 体系。

## 视觉一致性

使用已有 token 和变体表达：

```text
颜色
间距
字号
字重
行高
圆角
边框
阴影
焦点态
悬停态
禁用态
```

当原型的精确像素值与项目节奏冲突时，不要机械复制。保留原型的信息层级，同时匹配项目已有系统。
