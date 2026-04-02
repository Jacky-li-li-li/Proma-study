/**
 * AgentMessages — Agent 消息列表
 *
 * 复用 Chat 的 Conversation/Message 原语组件，
 * 流式输出通过 SDK 渲染路径（MessageGroupRenderer）展示工具活动。
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import { Bot, FileText, FileImage, RotateCw, AlertTriangle, ChevronDown, ChevronRight, Plus, Minimize2, Download } from 'lucide-react'
import { WelcomeEmptyState } from '@/components/welcome/WelcomeEmptyState'
import {
  Message,
  MessageHeader,
  MessageContent,
  MessageActions,
  MessageResponse,
  UserMessageContent,
} from '@/components/ai-elements/message'
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation'
import { ScrollMinimap } from '@/components/ai-elements/scroll-minimap'
import type { MinimapItem } from '@/components/ai-elements/scroll-minimap'
import { UserAvatar } from '@/components/chat/UserAvatar'
import { CopyButton } from '@/components/chat/CopyButton'
import { formatMessageTime } from '@/components/chat/ChatMessageItem'
import { Button } from '@/components/ui/button'
import { getModelLogo, resolveModelDisplayName } from '@/lib/model-logo'
import { ToolActivityList } from './ToolActivityItem'
import { userProfileAtom } from '@/atoms/user-profile'
import { channelsAtom } from '@/atoms/chat-atoms'
import { conversationDisplayModeAtom } from '@/atoms/conversation-display-mode'
import { ScrollPositionManager, ScrollToLatestOnSignal, StreamingViewportManager, type StreamingViewportPhase } from '@/hooks/useScrollPositionMemory'
import { useVirtualizedList } from '@/hooks/useVirtualizedList'
import { cn } from '@/lib/utils'
import { Spinner } from '@/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { groupIntoTurns, MessageGroupRenderer, getGroupId, getGroupPreview, type MessageGroup } from './SDKMessageRenderer'
import { estimateTextLayout } from '@/lib/pretext-metrics'
import type { AgentMessage, AgentEventUsage, RetryAttempt, SDKMessage } from '@proma/shared'
import type { ToolActivity, AgentStreamState } from '@/atoms/agent-atoms'
import { useStickToBottomContext } from 'use-stick-to-bottom'

/** AgentMessages 属性接口 */
interface AgentMessagesProps {
  sessionId: string
  messages: AgentMessage[]
  /** 消息是否已完成首次加载（避免空数组初始化误触发滚动恢复） */
  messagesLoaded?: boolean
  /** Phase 4: 持久化的 SDKMessage（新格式） */
  persistedSDKMessages?: SDKMessage[]
  streaming: boolean
  streamState?: AgentStreamState
  /** Phase 2: 实时 SDKMessage 列表（流式期间累积） */
  liveMessages?: SDKMessage[]
  /** 当前会话工作目录，用于解析相对文件路径 */
  sessionPath?: string | null
  /** 最后一轮是否被用户中断 */
  stoppedByUser?: boolean
  onRetry?: () => void
  onRetryInNewSession?: () => void
  onFork?: (upToMessageUuid: string) => void
  onCompact?: () => void
}

const AGENT_ESTIMATE_FONT = '400 15px sans-serif'
const AGENT_ESTIMATE_LINE_HEIGHT = 24
const AGENT_ESTIMATE_TEXT_WIDTH_GUTTER = 120
const AGENT_ESTIMATE_USER_CHROME = 56
const AGENT_ESTIMATE_ASSISTANT_CHROME = 78
const AGENT_ESTIMATE_SYSTEM_CHROME = 28
const AGENT_ESTIMATE_MAX_TEXT_LENGTH = 2200
const AGENT_LIST_VIRTUALIZATION_THRESHOLD = 120
const AGENT_LIST_VIRTUALIZATION_OVERSCAN = 1000

function estimateAgentMessageIntrinsicHeight(message: AgentMessage, containerWidth: number): number {
  const textWidth = Math.max(120, containerWidth - AGENT_ESTIMATE_TEXT_WIDTH_GUTTER)
  const result = estimateTextLayout({
    text: (message.content || '').slice(0, AGENT_ESTIMATE_MAX_TEXT_LENGTH),
    maxWidth: textWidth,
    font: AGENT_ESTIMATE_FONT,
    lineHeight: AGENT_ESTIMATE_LINE_HEIGHT,
    whiteSpace: message.role === 'user' ? 'pre-wrap' : 'normal',
  })

  let chrome = AGENT_ESTIMATE_ASSISTANT_CHROME
  if (message.role === 'user') chrome = AGENT_ESTIMATE_USER_CHROME
  if (message.role === 'status') chrome = AGENT_ESTIMATE_SYSTEM_CHROME

  return Math.max(44, result.height + chrome)
}

function estimateGroupIntrinsicHeight(group: MessageGroup, containerWidth: number): number {
  const preview = getGroupPreview(group)
  const textWidth = Math.max(120, containerWidth - AGENT_ESTIMATE_TEXT_WIDTH_GUTTER)
  const result = estimateTextLayout({
    text: preview.slice(0, AGENT_ESTIMATE_MAX_TEXT_LENGTH),
    maxWidth: textWidth,
    font: AGENT_ESTIMATE_FONT,
    lineHeight: AGENT_ESTIMATE_LINE_HEIGHT,
    whiteSpace: group.type === 'user' ? 'pre-wrap' : 'normal',
  })

  if (group.type === 'system') {
    return Math.max(32, result.height + AGENT_ESTIMATE_SYSTEM_CHROME)
  }
  if (group.type === 'assistant-turn') {
    const turnBonus = Math.min(120, (group.assistantMessages.length - 1) * 14)
    return Math.max(44, result.height + AGENT_ESTIMATE_ASSISTANT_CHROME + turnBonus)
  }
  return Math.max(44, result.height + AGENT_ESTIMATE_USER_CHROME)
}

/** 空状态引导 — 使用 WelcomeEmptyState */
function EmptyState(): React.ReactElement {
  return <WelcomeEmptyState />
}

function AssistantLogo({ model }: { model?: string }): React.ReactElement {
  if (model) {
    return (
      <img
        src={getModelLogo(model)}
        alt={model}
        className="size-[35px] rounded-[25%] object-cover"
      />
    )
  }
  return (
    <div className="size-[35px] rounded-[25%] bg-primary/10 flex items-center justify-center">
      <Bot size={18} className="text-primary" />
    </div>
  )
}

/** 单张工具结果图片（内联显示） */
function InlineImage({ attachment }: { attachment: { localPath: string; filename: string; mediaType: string } }): React.ReactElement {
  const [imageSrc, setImageSrc] = React.useState<string | null>(null)

  React.useEffect(() => {
    window.electronAPI
      .readAttachment(attachment.localPath)
      .then((base64) => {
        setImageSrc(`data:${attachment.mediaType};base64,${base64}`)
      })
      .catch((error) => {
        console.error('[InlineImage] 读取附件失败:', error)
      })
  }, [attachment.localPath, attachment.mediaType])

  const handleSave = React.useCallback((): void => {
    window.electronAPI.saveImageAs(attachment.localPath, attachment.filename)
  }, [attachment.localPath, attachment.filename])

  if (!imageSrc) {
    return <div className="size-[280px] rounded-lg bg-muted/30 animate-pulse shrink-0" />
  }

  return (
    <div className="relative group inline-block">
      <img
        src={imageSrc}
        alt={attachment.filename}
        className="size-[280px] rounded-lg object-cover shrink-0"
      />
      <button
        type="button"
        onClick={handleSave}
        className="absolute bottom-2 right-2 p-1.5 rounded-md bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/70"
        title="保存图片"
      >
        <Download className="size-4" />
      </button>
    </div>
  )
}

/** 从工具活动中提取并内联显示所有生成的图片 */
function ToolResultInlineImages({ activities }: { activities: ToolActivity[] }): React.ReactElement | null {
  const allImages = activities.flatMap((a) => a.imageAttachments ?? [])
  if (allImages.length === 0) return null

  return (
    <div className="flex flex-wrap gap-2 mb-3">
      {allImages.map((img, i) => (
        <InlineImage key={`${img.localPath}-${i}`} attachment={img} />
      ))}
    </div>
  )
}

/** 从持久化事件中提取工具活动列表 */
function extractToolActivities(events: AgentMessage['events']): ToolActivity[] {
  if (!events) return []

  const activities: ToolActivity[] = []
  for (const event of events) {
    if (event.type === 'tool_start') {
      const existingIdx = activities.findIndex((t) => t.toolUseId === event.toolUseId)
      if (existingIdx >= 0) {
        activities[existingIdx] = {
          ...activities[existingIdx]!,
          input: event.input,
          intent: event.intent || activities[existingIdx]!.intent,
          displayName: event.displayName || activities[existingIdx]!.displayName,
        }
      } else {
        activities.push({
          toolUseId: event.toolUseId,
          toolName: event.toolName,
          input: event.input,
          intent: event.intent,
          displayName: event.displayName,
          done: true,
          parentToolUseId: event.parentToolUseId,
        })
      }
    } else if (event.type === 'tool_result') {
      const idx = activities.findIndex((t) => t.toolUseId === event.toolUseId)
      if (idx >= 0) {
        activities[idx] = {
          ...activities[idx]!,
          result: event.result,
          isError: event.isError,
          done: true,
          imageAttachments: event.imageAttachments,
        }
      }
    } else if (event.type === 'task_backgrounded') {
      const idx = activities.findIndex((t) => t.toolUseId === event.toolUseId)
      if (idx >= 0) {
        activities[idx] = { ...activities[idx]!, isBackground: true, taskId: event.taskId }
      }
    } else if (event.type === 'shell_backgrounded') {
      const idx = activities.findIndex((t) => t.toolUseId === event.toolUseId)
      if (idx >= 0) {
        activities[idx] = { ...activities[idx]!, isBackground: true, shellId: event.shellId }
      }
    } else if (event.type === 'task_progress') {
      const idx = activities.findIndex((t) => t.toolUseId === event.toolUseId)
      if (idx >= 0) {
        activities[idx] = { ...activities[idx]!, elapsedSeconds: event.elapsedSeconds }
      }
    } else if (event.type === 'task_started' && event.toolUseId) {
      const idx = activities.findIndex((t) => t.toolUseId === event.toolUseId)
      if (idx >= 0) {
        activities[idx] = { ...activities[idx]!, intent: event.description, taskId: event.taskId }
      }
    }
  }
  return activities
}

/** 解析的附件引用 */
interface AttachedFileRef {
  filename: string
  path: string
}

/** 解析消息中的 <attached_files> 块，返回文件列表和剩余文本 */
function parseAttachedFiles(content: string): { files: AttachedFileRef[]; text: string } {
  const regex = /<attached_files>\n?([\s\S]*?)\n?<\/attached_files>\n*/
  const match = content.match(regex)
  if (!match) return { files: [], text: content }

  const files: AttachedFileRef[] = []
  const lines = match[1]!.split('\n')
  for (const line of lines) {
    // 格式: - filename: /path/to/file
    const lineMatch = line.match(/^-\s+(.+?):\s+(.+)$/)
    if (lineMatch) {
      files.push({ filename: lineMatch[1]!.trim(), path: lineMatch[2]!.trim() })
    }
  }

  const text = content.replace(regex, '').trim()
  return { files, text }
}

/** 判断文件是否为图片类型 */
function isImageFile(filename: string): boolean {
  return /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i.test(filename)
}

/** 附件引用芯片 */
function AttachedFileChip({ file }: { file: AttachedFileRef }): React.ReactElement {
  const isImg = isImageFile(file.filename)
  const Icon = isImg ? FileImage : FileText

  return (
    <div className="inline-flex items-center gap-1.5 rounded-md bg-muted/60 px-2.5 py-1 text-[12px] text-muted-foreground">
      <Icon className="size-3.5 shrink-0" />
      <span className="truncate max-w-[200px]">{file.filename}</span>
    </div>
  )
}

/** 重试提示组件 - 折叠式 */
function RetryingNotice({ retrying }: { retrying: NonNullable<AgentStreamState['retrying']> }): React.ReactElement {
  const [expanded, setExpanded] = React.useState(false)
  const [countdown, setCountdown] = React.useState(0)

  // 倒计时逻辑
  React.useEffect(() => {
    if (retrying.failed || retrying.history.length === 0) {
      setCountdown(0)
      return
    }

    const lastAttempt = retrying.history[retrying.history.length - 1]
    if (!lastAttempt) return

    // 计算倒计时
    const updateCountdown = (): void => {
      const elapsed = (Date.now() - lastAttempt.timestamp) / 1000 // 已过去的秒数
      const remaining = Math.max(0, lastAttempt.delaySeconds - elapsed)
      setCountdown(Math.ceil(remaining))

      if (remaining <= 0) {
        setCountdown(0)
      }
    }

    // 立即更新一次
    updateCountdown()

    // 每 100ms 更新一次倒计时
    const timer = setInterval(updateCountdown, 100)
    return () => clearInterval(timer)
  }, [retrying.failed, retrying.history])

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/20 p-3 mb-3">
      {/* 头部：简洁状态 */}
      <button
        type="button"
        className="flex items-center gap-2 w-full text-left hover:opacity-80 transition-opacity"
        onClick={() => setExpanded(!expanded)}
      >
        {retrying.failed ? (
          <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400 shrink-0" />
        ) : (
          <RotateCw className="size-4 animate-spin text-amber-600 dark:text-amber-400 shrink-0" />
        )}
        <span className="text-sm text-amber-900 dark:text-amber-100 flex-1">
          {retrying.failed
            ? `重试失败 (${retrying.currentAttempt}/${retrying.maxAttempts})`
            : countdown > 0
              ? `重试倒计时 ${countdown}秒 (${retrying.currentAttempt}/${retrying.maxAttempts})`
              : `重试中 (${retrying.currentAttempt}/${retrying.maxAttempts})`}
          {retrying.history.length > 0 && ` · ${retrying.history[retrying.history.length - 1]?.reason}`}
        </span>
        {expanded ? (
          <ChevronDown className="size-4 text-amber-600 dark:text-amber-400 shrink-0" />
        ) : (
          <ChevronRight className="size-4 text-amber-600 dark:text-amber-400 shrink-0" />
        )}
      </button>

      {/* 展开内容：重试历史 */}
      {expanded && retrying.history.length > 0 && (
        <div className="mt-3 space-y-3 border-t border-amber-200 dark:border-amber-800 pt-3">
          <div className="text-xs font-medium text-amber-900 dark:text-amber-100">
            尝试历史：
          </div>
          {retrying.history.map((attempt, index) => (
            <RetryAttemptItem
              key={attempt.timestamp}
              attempt={attempt}
              isLatest={index === retrying.history.length - 1}
              isFailed={retrying.failed && index === retrying.history.length - 1}
            />
          ))}
          {!retrying.failed && (
            <div className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-300 pl-6">
              {countdown > 0 ? (
                <>
                  <RotateCw className="size-3 animate-spin" />
                  <span>等待 {countdown} 秒后开始第 {retrying.currentAttempt} 次尝试</span>
                </>
              ) : (
                <>
                  <RotateCw className="size-3 animate-spin" />
                  <span>正在进行第 {retrying.currentAttempt} 次尝试...</span>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** 单条重试尝试记录 */
function RetryAttemptItem({
  attempt,
  isLatest,
  isFailed,
}: {
  attempt: RetryAttempt
  isLatest: boolean
  isFailed: boolean
}): React.ReactElement {
  const [showStderr, setShowStderr] = React.useState(false)
  const [showStack, setShowStack] = React.useState(false)

  const time = new Date(attempt.timestamp).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })

  return (
    <div className={cn('pl-6 space-y-2', isLatest && 'font-medium')}>
      {/* 尝试头部 */}
      <div className="flex items-start gap-2">
        <span className="text-destructive shrink-0">❌</span>
        <div className="flex-1 min-w-0 space-y-1">
          <div className="text-xs text-amber-900 dark:text-amber-100">
            第 {attempt.attempt} 次 ({time}) - {attempt.reason}
          </div>
          <div className="text-xs text-amber-700 dark:text-amber-300 font-mono break-words">
            {attempt.errorMessage}
          </div>

          {/* 环境信息 */}
          {attempt.environment && (
            <div className="text-[11px] text-amber-600 dark:text-amber-400 space-y-0.5">
              <div>运行时: {attempt.environment.runtime}</div>
              <div>平台: {attempt.environment.platform}</div>
              <div>模型: {attempt.environment.model}</div>
              {attempt.environment.workspace && <div>工作区: {attempt.environment.workspace}</div>}
            </div>
          )}

          {/* 可展开的 stderr */}
          {attempt.stderr && (
            <div className="mt-2">
              <button
                type="button"
                className="text-[11px] text-amber-700 dark:text-amber-300 hover:underline flex items-center gap-1"
                onClick={() => setShowStderr(!showStderr)}
              >
                {showStderr ? (
                  <ChevronDown className="size-3" />
                ) : (
                  <ChevronRight className="size-3" />
                )}
                显示 stderr 输出
              </button>
              {showStderr && (
                <pre className="mt-1 text-[10px] text-amber-800 dark:text-amber-200 bg-amber-100 dark:bg-amber-900/30 p-2 rounded overflow-x-auto max-h-[200px] overflow-y-auto">
                  {attempt.stderr}
                </pre>
              )}
            </div>
          )}

          {/* 可展开的堆栈跟踪 */}
          {attempt.stack && (
            <div className="mt-2">
              <button
                type="button"
                className="text-[11px] text-amber-700 dark:text-amber-300 hover:underline flex items-center gap-1"
                onClick={() => setShowStack(!showStack)}
              >
                {showStack ? (
                  <ChevronDown className="size-3" />
                ) : (
                  <ChevronRight className="size-3" />
                )}
                显示堆栈跟踪
              </button>
              {showStack && (
                <pre className="mt-1 text-[10px] text-amber-800 dark:text-amber-200 bg-amber-100 dark:bg-amber-900/30 p-2 rounded overflow-x-auto max-h-[200px] overflow-y-auto">
                  {attempt.stack}
                </pre>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** AgentMessageItem 属性接口 */
interface AgentMessageItemProps {
  message: AgentMessage
  sessionPath?: string | null
  onRetry?: () => void
  onRetryInNewSession?: () => void
  onCompact?: () => void
}

function AgentMessageItem({ message, sessionPath, onRetry, onRetryInNewSession, onCompact }: AgentMessageItemProps): React.ReactElement | null {
  const userProfile = useAtomValue(userProfileAtom)
  const channels = useAtomValue(channelsAtom)
  const conversationDisplayMode = useAtomValue(conversationDisplayModeAtom)
  const isDistributedUserLayout = conversationDisplayMode === 'distributed'

  if (message.role === 'user') {
    const { files: attachedFiles, text: messageText } = parseAttachedFiles(message.content)

    return (
      <Message from="user">
        <div className={cn('flex items-start gap-2.5 mb-2.5', isDistributedUserLayout && 'justify-end')}>
          {isDistributedUserLayout ? (
            <>
              <div className="flex flex-col justify-between h-[35px] text-right">
                <span className="text-sm font-semibold text-foreground/60 leading-none">{userProfile.userName}</span>
                <span className="text-[10px] text-foreground/[0.38] leading-none">{formatMessageTime(message.createdAt)}</span>
              </div>
              <UserAvatar avatar={userProfile.avatar} size={35} />
            </>
          ) : (
            <>
              <UserAvatar avatar={userProfile.avatar} size={35} />
              <div className="flex flex-col justify-between h-[35px]">
                <span className="text-sm font-semibold text-foreground/60 leading-none">{userProfile.userName}</span>
                <span className="text-[10px] text-foreground/[0.38] leading-none">{formatMessageTime(message.createdAt)}</span>
              </div>
            </>
          )}
        </div>
        <MessageContent className={cn(isDistributedUserLayout && 'pl-0 pr-[46px]')}>
          {attachedFiles.length > 0 && (
            <div className={cn('flex flex-wrap gap-1.5 mb-2', isDistributedUserLayout && 'ml-auto')}>
              {attachedFiles.map((file) => (
                <AttachedFileChip key={file.path} file={file} />
              ))}
            </div>
          )}
          {messageText && (
            <UserMessageContent className={cn(isDistributedUserLayout && 'ml-auto')}>{messageText}</UserMessageContent>
          )}
        </MessageContent>
        {/* 操作按钮（hover 时可见） */}
        {messageText && (
          <MessageActions className={cn('mt-0.5 w-full', isDistributedUserLayout ? 'pr-[46px] justify-end' : 'pl-[46px]')}>
            <CopyButton content={messageText} />
          </MessageActions>
        )}
      </Message>
    )
  }

  if (message.role === 'assistant') {
    const toolActivities = extractToolActivities(message.events)

    return (
      <Message from="assistant">
        <MessageHeader
          model={message.model ? resolveModelDisplayName(message.model, channels) : undefined}
          time={formatMessageTime(message.createdAt)}
          logo={<AssistantLogo model={message.model} />}
        />
        <MessageContent>
          {toolActivities.length > 0 && (
            <div className="mb-3">
              <ToolActivityList activities={toolActivities} />
            </div>
          )}
          <ToolResultInlineImages activities={toolActivities} />
          {message.content && (
            <MessageResponse basePath={sessionPath || undefined}>{message.content}</MessageResponse>
          )}
        </MessageContent>
        {/* 操作栏：左侧靠左排列 */}
        {(message.durationMs != null || message.content) && (
          <MessageActions className="pl-[46px] mt-0.5 w-full justify-start gap-2.5">
            {message.durationMs != null && <DurationBadge durationMs={message.durationMs} usage={message.usage} />}
            {message.content && <CopyButton content={message.content} />}
            {getTotalTokens(message.usage) != null && (
              <span className="ml-1 text-[15px] font-light text-foreground/50 tabular-nums select-none">
                token: {formatTokenCount(getTotalTokens(message.usage)!)}
              </span>
            )}
          </MessageActions>
        )}
      </Message>
    )
  }

  if (message.role === 'status' && message.errorCode) {
    // TypedError 消息 - 复用普通消息格式，简单显示错误
    return (
      <Message from="assistant">
        <MessageHeader
          model={undefined}
          time={formatMessageTime(message.createdAt)}
          logo={
            <div className="size-[35px] rounded-[25%] bg-destructive/10 flex items-center justify-center">
              <AlertTriangle size={18} className="text-destructive" />
            </div>
          }
        />
        <MessageContent>
          <div className="text-destructive">
            <MessageResponse basePath={sessionPath || undefined}>{message.content}</MessageResponse>
          </div>
          {/* 错误操作按钮 */}
          <div className="flex items-center gap-2 mt-3">
            {message.errorCode === 'prompt_too_long' && onCompact && (
              <Button size="sm" onClick={onCompact}>
                <Minimize2 className="size-3.5 mr-1.5" />
                压缩上下文
              </Button>
            )}
            {onRetry && (
              <Button size="sm" variant={message.errorCode === 'prompt_too_long' ? 'outline' : 'default'} onClick={onRetry}>
                <RotateCw className="size-3.5 mr-1.5" />
                重试
              </Button>
            )}
            {onRetryInNewSession && (
              <Button size="sm" variant="outline" onClick={onRetryInNewSession}>
                <Plus className="size-3.5 mr-1.5" />
                在新会话中重试
              </Button>
            )}
          </div>
        </MessageContent>
        {/* 操作按钮（hover 时可见） */}
        <MessageActions className="pl-[46px] mt-0.5">
          <CopyButton content={message.content} />
        </MessageActions>
      </Message>
    )
  }

  return null
}

/** 格式化耗时（毫秒 → 可读字符串） */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}m ${s.toFixed(0)}s`
}

export function formatTokenCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return `${value}`
}

function getTotalTokens(usage?: AgentEventUsage): number | undefined {
  if (!usage) return undefined
  const input = usage.inputTokens || 0
  const output = usage.outputTokens || 0
  const total = input + output
  return total > 0 ? total : undefined
}

/** 构建 usage tooltip 多行文本 */
export function buildUsageTooltip(durationMs: number, usage?: AgentEventUsage): string {
  const lines: string[] = []
  lines.push(`耗时: ${formatDuration(durationMs)}`)
  const totalTokens = getTotalTokens(usage)
  if (totalTokens != null) lines.push(`总 Token: ${totalTokens.toLocaleString()}`)

  if (usage) {
    const pureInput = usage.inputTokens - (usage.cacheReadTokens ?? 0) - (usage.cacheCreationTokens ?? 0)
    if (pureInput > 0) lines.push(`输入: ${pureInput.toLocaleString()}`)
    if (usage.outputTokens) lines.push(`输出: ${usage.outputTokens.toLocaleString()}`)
    if (usage.cacheCreationTokens) lines.push(`缓存写入: ${usage.cacheCreationTokens.toLocaleString()}`)
    if (usage.cacheReadTokens) lines.push(`缓存读取: ${usage.cacheReadTokens.toLocaleString()}`)
  }

  return lines.join('\n')
}

/** 耗时徽章 — 悬浮显示 token 用量明细 */
export function DurationBadge({ durationMs, usage }: { durationMs: number; usage?: AgentEventUsage }): React.ReactElement {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center gap-2 text-[15px] tabular-nums font-light cursor-default">
          {formatDuration(durationMs)}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">
        <p className="whitespace-pre-line text-left">{buildUsageTooltip(durationMs, usage)}</p>
      </TooltipContent>
    </Tooltip>
  )
}

/** Agent 运行指示器 — Shimmer Spinner + 无括号的运行时间 */
function AgentRunningIndicator({ startedAt }: { startedAt?: number }): React.ReactElement {
  const [elapsed, setElapsed] = React.useState(0)

  React.useEffect(() => {
    const start = startedAt ?? Date.now()
    const update = (): void => setElapsed((Date.now() - start) / 1000)
    update()
    const timer = setInterval(update, 100)
    return () => clearInterval(timer)
  }, [startedAt])

  const formatTime = (seconds: number): string => {
    if (seconds < 60) return `${seconds.toFixed(1)}s`
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${m}m ${s.toFixed(1)}s`
  }

  return (
    <div className="flex items-center gap-2 min-h-[28px]">
      <Spinner size="sm" className="text-primary/50" />
      <span className="text-[13px] font-light text-muted-foreground/50 tabular-nums">Agent Running {formatTime(elapsed)}</span>
    </div>
  )
}

function VirtualScrollHostBridge({ onHostChange }: { onHostChange: (element: HTMLElement | null) => void }): React.ReactElement | null {
  const { scrollRef } = useStickToBottomContext()
  const currentScrollHost = scrollRef.current as HTMLElement | null

  React.useLayoutEffect(() => {
    onHostChange(currentScrollHost)
  }, [currentScrollHost, onHostChange])

  React.useEffect(() => {
    return () => onHostChange(null)
  }, [onHostChange])

  return null
}

export function AgentMessages({
  sessionId,
  messages,
  messagesLoaded = true,
  persistedSDKMessages,
  streaming,
  streamState,
  liveMessages,
  sessionPath,
  stoppedByUser,
  onRetry,
  onRetryInNewSession,
  onFork,
  onCompact,
}: AgentMessagesProps): React.ReactElement {
  const userProfile = useAtomValue(userProfileAtom)
  const channels = useAtomValue(channelsAtom)
  const [viewportPhase, setViewportPhase] = React.useState<StreamingViewportPhase>('idle')
  const messageListRef = React.useRef<HTMLDivElement>(null)
  const virtualScrollRef = React.useRef<HTMLElement | null>(null)
  const [messageListWidth, setMessageListWidth] = React.useState(0)
  const virtualScrollToItemRef = React.useRef<((id: string) => void) | undefined>(undefined)
  const handleVirtualScrollToItemChange = React.useCallback((handler?: (id: string) => void) => {
    virtualScrollToItemRef.current = handler
  }, [])
  const handleMinimapScrollToItem = React.useCallback((id: string) => {
    virtualScrollToItemRef.current?.(id)
  }, [])
  const handleVirtualScrollHostChange = React.useCallback((element: HTMLElement | null): void => {
    virtualScrollRef.current = element
  }, [])

  /**
   * 淡入控制：切换会话时先隐藏，等布局完成后再显示。
   */
  const [ready, setReady] = React.useState(false)
  const prevSessionIdRef = React.useRef<string | null>(null)

  React.useEffect(() => {
    if (sessionId !== prevSessionIdRef.current) {
      prevSessionIdRef.current = sessionId
      setReady(false)
    }
  }, [sessionId])

  React.useEffect(() => {
    if (ready) return
    if (!messagesLoaded) return
    if (messages.length === 0 && (!persistedSDKMessages || persistedSDKMessages.length === 0) && !streaming) {
      setReady(true)
      return
    }
    let cancelled = false
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!cancelled) setReady(true)
      })
    })
    return () => { cancelled = true }
  }, [messagesLoaded, messages, persistedSDKMessages, streaming, ready])

  React.useEffect(() => {
    const element = messageListRef.current
    if (!element) return

    const updateWidth = (): void => {
      const nextWidth = Math.max(0, Math.round(element.clientWidth * 100) / 100)
      setMessageListWidth((prev) => (prev === nextWidth ? prev : nextWidth))
    }

    updateWidth()
    const observer = new ResizeObserver(updateWidth)
    observer.observe(element)
    return () => observer.disconnect()
  }, [ready, messages.length, persistedSDKMessages?.length, streaming, liveMessages?.length])

  // 从 streamState 属性中计算派生值
  const streamingContent = streamState?.content ?? ''
  const retrying = streamState?.retrying
  const startedAt = streamState?.startedAt

  /**
   * 流式完成过渡：streaming 结束到持久化消息加载完成之间，
   * 强制 resize="instant" 避免中间高度变化触发平滑滚动动画。
   */
  const [transitioning, setTransitioning] = React.useState(false)
  React.useEffect(() => {
    if (streaming) {
      setTransitioning(false)
      return
    }
    if (streamingContent) {
      setTransitioning(true)
      return
    }
    const timer = setTimeout(() => setTransitioning(false), 150)
    return () => clearTimeout(timer)
  }, [streaming, streamingContent])

  // 判断是否使用新的 SDKMessage 渲染路径
  const useSDKRenderer = persistedSDKMessages && persistedSDKMessages.length > 0
  const hasContent = useSDKRenderer ? persistedSDKMessages.length > 0 : messages.length > 0

  // 合并持久化 + 实时 SDKMessage（供 ContentBlock 内查找工具结果）
  const allSDKMessages = React.useMemo(() => {
    const persisted = persistedSDKMessages ?? []
    const live = liveMessages ?? []
    return [...persisted, ...live]
  }, [persistedSDKMessages, liveMessages])

  // Turn 分组（持久化消息按 turn 分组渲染）
  const persistedGroups = React.useMemo(() => {
    if (!persistedSDKMessages || persistedSDKMessages.length === 0) return []
    return groupIntoTurns(persistedSDKMessages)
  }, [persistedSDKMessages])

  // Turn 分组（实时消息同样按 turn 分组，避免多个气泡最终合并的跳变）
  const liveGroups = React.useMemo(() => {
    if (!liveMessages || liveMessages.length === 0) return []
    return groupIntoTurns(liveMessages)
  }, [liveMessages])

  // 迷你地图数据 — 复用 persistedGroups / liveGroups，确保 getGroupId 对同一对象引用返回一致的 ID
  const minimapItems: MinimapItem[] = React.useMemo(
    () => {
      if (useSDKRenderer) {
        // 去重：liveGroups 中可能包含与 persistedGroups 相同的消息
        const seenIds = new Set(persistedGroups.map(getGroupId))
        const allGroups = [...persistedGroups, ...liveGroups.filter((g) => {
          const id = getGroupId(g)
          if (seenIds.has(id)) return false
          seenIds.add(id)
          return true
        })]
        return allGroups.map((group) => ({
          id: getGroupId(group),
          role: group.type === 'user' ? 'user' as const
            : group.type === 'system' ? 'status' as const
            : 'assistant' as const,
          preview: getGroupPreview(group),
          avatar: group.type === 'user' ? userProfile.avatar : undefined,
          model: group.type === 'assistant-turn' ? group.model : undefined,
        }))
      }
      // 旧格式回退
      return messages.map((m, i) => ({
        id: m.id || `msg-${i}`,
        role: m.role === 'status' ? 'status' as const : m.role as MinimapItem['role'],
        preview: (m.content ?? '').replace(/<attached_files>[\s\S]*?<\/attached_files>\n*/, '').slice(0, 200),
        avatar: m.role === 'user' ? userProfile.avatar : undefined,
        model: m.model,
      }))
    },
    [useSDKRenderer, persistedGroups, liveGroups, messages, userProfile.avatar]
  )

  const renderedGroups = React.useMemo(() => {
    const persistedIds = new Set(persistedGroups.map((group) => getGroupId(group)))
    return [
      ...persistedGroups,
      ...liveGroups.filter((group) => !persistedIds.has(getGroupId(group))),
    ]
  }, [persistedGroups, liveGroups])

  const liveGroupIds = React.useMemo(() => new Set(liveGroups.map((group) => getGroupId(group))), [liveGroups])
  const stoppedBadgeGroupId = React.useMemo(() => {
    if (!useSDKRenderer || !stoppedByUser || streaming) return null
    for (let i = renderedGroups.length - 1; i >= 0; i -= 1) {
      const group = renderedGroups[i]
      if (group?.type === 'assistant-turn') return getGroupId(group)
    }
    return null
  }, [useSDKRenderer, stoppedByUser, streaming, renderedGroups])
  const estimatedWidth = messageListWidth > 0 ? messageListWidth : 720

  const estimatedMessageHeights = React.useMemo(() => {
    const map = new Map<string, number>()
    for (const message of messages) {
      map.set(message.id, estimateAgentMessageIntrinsicHeight(message, estimatedWidth))
    }
    return map
  }, [messages, estimatedWidth])

  const estimatedGroupHeights = React.useMemo(() => {
    const map = new Map<string, number>()
    for (const group of renderedGroups) {
      map.set(getGroupId(group), estimateGroupIntrinsicHeight(group, estimatedWidth))
    }
    return map
  }, [renderedGroups, estimatedWidth])

  const virtualizationKeys = React.useMemo(() => {
    if (useSDKRenderer) return renderedGroups.map((group) => getGroupId(group))
    return messages.map((message) => message.id)
  }, [messages, renderedGroups, useSDKRenderer])

  const estimateVirtualSize = React.useCallback((key: string, index: number): number => {
    if (useSDKRenderer) {
      return estimatedGroupHeights.get(key) ?? 220
    }
    const message = messages[index]
    return estimatedMessageHeights.get(message?.id ?? key) ?? 200
  }, [estimatedGroupHeights, estimatedMessageHeights, messages, useSDKRenderer])

  const {
    enabled: virtualizationActive,
    topPadding,
    bottomPadding,
    virtualItems,
    measureElement,
    scrollToKey,
  } = useVirtualizedList({
    keys: virtualizationKeys,
    estimateSize: estimateVirtualSize,
    scrollRef: virtualScrollRef,
    enabled: virtualizationKeys.length >= AGENT_LIST_VIRTUALIZATION_THRESHOLD,
    overscanPx: AGENT_LIST_VIRTUALIZATION_OVERSCAN,
  })

  React.useEffect(() => {
    handleVirtualScrollToItemChange((id: string) => {
      scrollToKey(id, 'center')
    })
  }, [handleVirtualScrollToItemChange, scrollToKey])

  React.useEffect(() => {
    return () => handleVirtualScrollToItemChange(undefined)
  }, [handleVirtualScrollToItemChange])

  const renderedIndexes = virtualizationActive
    ? virtualItems.map((item) => item.index)
    : virtualizationKeys.map((_, index) => index)
  const hasStreamingText = streamingContent.trim().length > 0
  const viewportActive = streaming || hasStreamingText || liveGroupIds.size > 0

  return (
    <Conversation resize={ready && viewportPhase === 'idle' && !transitioning ? 'smooth' : 'instant'} className={ready ? 'opacity-100 transition-opacity duration-200' : 'opacity-0'}>
      <VirtualScrollHostBridge onHostChange={handleVirtualScrollHostChange} />
      <ScrollPositionManager id={sessionId} ready={ready} />
      <ScrollToLatestOnSignal id={sessionId} ready={ready} />
      <StreamingViewportManager active={viewportActive} ready={ready} onPhaseChange={setViewportPhase} />
      <ConversationContent>
        <div ref={messageListRef}>
        {((useSDKRenderer && renderedGroups.length === 0) || (!useSDKRenderer && !hasContent)) && !streaming ? (
          <EmptyState />
        ) : (
          <>
            {virtualizationActive && topPadding > 0 && (
              <div aria-hidden style={{ height: topPadding }} />
            )}

            {/* 持久化消息渲染 */}
            {useSDKRenderer ? (
              renderedIndexes.map((index) => {
                const group = renderedGroups[index]
                if (!group) return null
                const groupId = getGroupId(group)
                const showStoppedByUserBadge = group.type === 'assistant-turn' && groupId === stoppedBadgeGroupId && !liveGroupIds.has(groupId)
                return (
                  <MessageGroupRenderer
                    key={groupId}
                    group={group}
                    allMessages={allSDKMessages}
                    basePath={sessionPath || undefined}
                    onFork={onFork}
                    isStreaming={liveGroupIds.has(groupId)}
                    stoppedByUser={showStoppedByUserBadge || undefined}
                    estimatedHeight={estimatedGroupHeights.get(groupId)}
                    measureRef={virtualizationActive ? measureElement(groupId) : undefined}
                  />
                )
              })
            ) : (
              // 旧格式回退 — AgentMessageItem
              renderedIndexes.map((index) => {
                const msg = messages[index]
                if (!msg) return null
                return (
                  <div
                    key={msg.id}
                    data-message-id={msg.id}
                    ref={virtualizationActive ? measureElement(msg.id) : undefined}
                    style={{
                      containIntrinsicSize: `auto ${Math.ceil(estimatedMessageHeights.get(msg.id) ?? 200)}px`,
                    }}
                  >
                    <AgentMessageItem
                      message={msg}
                      sessionPath={sessionPath}
                      onRetry={onRetry}
                      onRetryInNewSession={onRetryInNewSession}
                      onCompact={onCompact}
                    />
                  </div>
                )
              })
            )}

            {virtualizationActive && bottomPadding > 0 && (
              <div aria-hidden style={{ height: bottomPadding }} />
            )}

            {/* 流式状态指示器：统一在消息列表底部显示 */}
            {(streaming || retrying) && (
              <div className="pl-[56px] mt-0.5">
                {retrying && <RetryingNotice retrying={retrying} />}
                {streaming && <AgentRunningIndicator startedAt={startedAt} />}
              </div>
            )}

          </>
        )}
        </div>
      </ConversationContent>
      <ScrollMinimap items={minimapItems} onScrollToItem={handleMinimapScrollToItem} />
      <ConversationScrollButton />
    </Conversation>
  )
}
