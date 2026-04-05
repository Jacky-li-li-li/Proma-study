# Plan: Chat/Agent 输入框按钮调整

## 任务目标

1. **Chat 输入框**：将模型选择按钮（ModelSelector）调整为第一个按钮（在附件按钮之后）
2. **Agent 输入框**：删除提示词选择按钮（AgentPromptSelector），该功能只在设置页面进行切换

## 修改文件

### 1. ChatInput.tsx
**路径**: `apps/electron/src/renderer/components/chat/ChatInput.tsx`

**当前顺序** (行 275-326):
```
附件 → ModelSelector → 思考模式 → 飞书通知 → 语音 → 工具选择 → 上下文设置 → 清除上下文
```

**修改为**:
```
附件 → ModelSelector → 思考模式 → 飞书通知 → 语音 → 工具选择 → 上下文设置 → 清除上下文
```
（顺序已正确，无需调整）

---

### 2. AgentView.tsx
**路径**: `apps/electron/src/renderer/components/agent/AgentView.tsx`

**当前顺序** (行 1318-1382):
```tsx
<div className="flex items-center gap-1.5 flex-1 min-w-0">
  <AgentPromptSelector />           // 删除此行
  <ModelSelector ... />
  <PermissionModeSelector ... />
  ...
</div>
```

**修改为**:
```tsx
<div className="flex items-center gap-1.5 flex-1 min-w-0">
  <ModelSelector ... />
  <PermissionModeSelector ... />
  ...
</div>
```

**需要删除的导入**（如果不再使用）:
- `AgentPromptSelector` 的导入（行 110 左右）

---

## 实施步骤

1. 修改 `AgentView.tsx`：
   - 删除 `<AgentPromptSelector />` 组件调用（行 1321）
   - 移除 `AgentPromptSelector` 的导入语句

2. 更新组件注释（可选）：
   - 更新 `AgentView.tsx` 中相关区域的注释说明
