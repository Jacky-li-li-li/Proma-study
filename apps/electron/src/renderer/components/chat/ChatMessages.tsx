/**
 * ChatMessages - 消息区域
 *
 * 使用 Conversation / ConversationContent / ConversationScrollButton 原语
 * 替代手动 scroll。支持上下文分隔线和并排模式切换。
 *
 * 功能：
 * - StickToBottom 自动滚动容器
 * - 遍历 messages → ChatMessageItem
 * - 消息间渲染 ContextDivider（根据 contextDividersAtom）
 * - streaming 时末尾显示临时 assistant 消息
 * - 并排模式切换到 ParallelChatMessages
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import { Loader2 } from 'lucide-react'
import { WelcomeEmptyState } from '@/components/welcome/WelcomeEmptyState'
import { ChatMessageItem, formatMessageTime } from './ChatMessageItem'
import type { InlineEditSubmitPayload } from './ChatMessageItem'
import { ChatToolActivityIndicator } from './ChatToolActivityIndicator'
import { ParallelChatMessages } from './ParallelChatMessages'
import {
  Message,
  MessageHeader,
  MessageContent,
  MessageLoading,
  MessageResponse,
  StreamingIndicator,
} from '@/components/ai-elements/message'
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation'
import { ScrollMinimap } from '@/components/ai-elements/scroll-minimap'
import type { MinimapItem } from '@/components/ai-elements/scroll-minimap'
import { useStickToBottomContext } from 'use-stick-to-bottom'
import { ContextDivider } from '@/components/ai-elements/context-divider'
import {
  Reasoning,
  ReasoningTrigger,
  ReasoningContent,
} from '@/components/ai-elements/reasoning'
import { useSmoothStream } from '@proma/ui'
import { ScrollPositionManager, ScrollToLatestOnSignal } from '@/hooks/useScrollPositionMemory'
import { useConversationParallelMode } from '@/hooks/useConversationSettings'
import { useVirtualizedList } from '@/hooks/useVirtualizedList'
import { getModelLogo } from '@/lib/model-logo'
import { estimateTextLayout } from '@/lib/pretext-metrics'
import { userProfileAtom } from '@/atoms/user-profile'
import type { ChatMessage, ChatToolActivity } from '@proma/shared'

// ===== 滚动到顶部加载更多 =====

interface LoadMoreResult {
  prependedMessages?: ChatMessage[]
}

interface ScrollTopLoaderProps {
  /** 是否还有更多历史消息 */
  hasMore: boolean
  /** 是否正在加载 */
  loading: boolean
  /** 加载更多回调 */
  onLoadMore: () => Promise<LoadMoreResult | void>
}

const PREPEND_ESTIMATE_FONT = '400 15px sans-serif'
const PREPEND_ESTIMATE_LINE_HEIGHT = 24
const PREPEND_ESTIMATE_TEXT_WIDTH_GUTTER = 120
const PREPEND_ESTIMATE_USER_CHROME = 50
const PREPEND_ESTIMATE_ASSISTANT_CHROME = 58
const PREPEND_ESTIMATE_REASONING_CHROME = 24
const PREPEND_ESTIMATE_MAX_MESSAGES = 120
const PREPEND_ESTIMATE_MAX_TEXT_LENGTH = 2000
const LIST_VIRTUALIZATION_THRESHOLD = 120
const LIST_VIRTUALIZATION_OVERSCAN = 960
const MESSAGE_ESTIMATE_FONT = '400 15px sans-serif'
const MESSAGE_ESTIMATE_LINE_HEIGHT = 24
const MESSAGE_ESTIMATE_TEXT_WIDTH_GUTTER = 120
const MESSAGE_ESTIMATE_USER_CHROME = 56
const MESSAGE_ESTIMATE_ASSISTANT_CHROME = 70
const MESSAGE_ESTIMATE_REASONING_CHROME = 28
const MESSAGE_ESTIMATE_ATTACHMENT_CHROME = 90

function estimatePrependMessagesHeight(messages: ChatMessage[], containerWidth: number): number {
  const sampledMessages = messages.slice(0, PREPEND_ESTIMATE_MAX_MESSAGES)
  const textWidth = Math.max(120, containerWidth - PREPEND_ESTIMATE_TEXT_WIDTH_GUTTER)
  let total = 0

  for (const message of sampledMessages) {
    const main = estimateTextLayout({
      text: (message.content || '').slice(0, PREPEND_ESTIMATE_MAX_TEXT_LENGTH),
      maxWidth: textWidth,
      font: PREPEND_ESTIMATE_FONT,
      lineHeight: PREPEND_ESTIMATE_LINE_HEIGHT,
      whiteSpace: message.role === 'user' ? 'pre-wrap' : 'normal',
    })
    total += main.height

    if (message.reasoning) {
      const reasoning = estimateTextLayout({
        text: message.reasoning.slice(0, PREPEND_ESTIMATE_MAX_TEXT_LENGTH),
        maxWidth: textWidth,
        font: PREPEND_ESTIMATE_FONT,
        lineHeight: PREPEND_ESTIMATE_LINE_HEIGHT,
        whiteSpace: 'normal',
      })
      total += reasoning.height + PREPEND_ESTIMATE_REASONING_CHROME
    }

    total += message.role === 'assistant'
      ? PREPEND_ESTIMATE_ASSISTANT_CHROME
      : PREPEND_ESTIMATE_USER_CHROME
  }

  return total
}

function estimateMessageIntrinsicHeight(message: ChatMessage, containerWidth: number): number {
  const textWidth = Math.max(120, containerWidth - MESSAGE_ESTIMATE_TEXT_WIDTH_GUTTER)
  const main = estimateTextLayout({
    text: (message.content || '').slice(0, PREPEND_ESTIMATE_MAX_TEXT_LENGTH),
    maxWidth: textWidth,
    font: MESSAGE_ESTIMATE_FONT,
    lineHeight: MESSAGE_ESTIMATE_LINE_HEIGHT,
    whiteSpace: message.role === 'user' ? 'pre-wrap' : 'normal',
  })

  let total = main.height + (
    message.role === 'assistant'
      ? MESSAGE_ESTIMATE_ASSISTANT_CHROME
      : MESSAGE_ESTIMATE_USER_CHROME
  )

  if (message.reasoning) {
    const reasoning = estimateTextLayout({
      text: message.reasoning.slice(0, PREPEND_ESTIMATE_MAX_TEXT_LENGTH),
      maxWidth: textWidth,
      font: MESSAGE_ESTIMATE_FONT,
      lineHeight: MESSAGE_ESTIMATE_LINE_HEIGHT,
      whiteSpace: 'normal',
    })
    total += reasoning.height + MESSAGE_ESTIMATE_REASONING_CHROME
  }

  if (message.attachments && message.attachments.length > 0) {
    total += MESSAGE_ESTIMATE_ATTACHMENT_CHROME
  }

  return Math.max(total, 44)
}

interface StandardMessageListProps {
  conversationId: string
  messages: ChatMessage[]
  contextDividers: string[]
  streaming: boolean
  smoothContent: string
  smoothReasoning: string
  streamingModel: string | null
  startedAt?: number
  toolActivities: ChatToolActivity[]
  inlineEditingMessageId?: string | null
  onDeleteMessage?: (messageId: string) => Promise<void>
  onResendMessage?: (message: ChatMessage) => Promise<void>
  onStartInlineEdit?: (message: ChatMessage) => void
  onSubmitInlineEdit?: (message: ChatMessage, payload: InlineEditSubmitPayload) => Promise<void>
  onCancelInlineEdit?: () => void
  onDeleteDivider?: (messageId: string) => void
  onVirtualScrollToItemChange?: (handler?: (id: string) => void) => void
}

function StandardMessageList({
  conversationId,
  messages,
  contextDividers,
  streaming,
  smoothContent,
  smoothReasoning,
  streamingModel,
  startedAt,
  toolActivities,
  inlineEditingMessageId,
  onDeleteMessage,
  onResendMessage,
  onStartInlineEdit,
  onSubmitInlineEdit,
  onCancelInlineEdit,
  onDeleteDivider,
  onVirtualScrollToItemChange,
}: StandardMessageListProps): React.ReactElement {
  const { scrollRef } = useStickToBottomContext()
  const messageListRef = React.useRef<HTMLDivElement>(null)
  const [messageListWidth, setMessageListWidth] = React.useState(0)
  const dividerSet = React.useMemo(() => new Set(contextDividers), [contextDividers])

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
  }, [messages.length, streaming])

  const estimatedHeightsById = React.useMemo(() => {
    const map = new Map<string, number>()
    const width = messageListWidth > 0 ? messageListWidth : 720
    for (const message of messages) {
      map.set(message.id, estimateMessageIntrinsicHeight(message, width))
    }
    return map
  }, [messages, messageListWidth])

  const messageKeys = React.useMemo(() => messages.map((message) => message.id), [messages])
  const virtualizeEnabled = messages.length >= LIST_VIRTUALIZATION_THRESHOLD

  const estimateSize = React.useCallback((key: string, index: number): number => {
    const message = messages[index]
    if (!message) return 200
    const base = estimatedHeightsById.get(key) ?? 200
    const dividerExtra = dividerSet.has(key) ? 28 : 0
    return base + dividerExtra
  }, [dividerSet, estimatedHeightsById, messages])

  const {
    enabled: virtualizationActive,
    topPadding,
    bottomPadding,
    virtualItems,
    measureElement,
    scrollToKey,
  } = useVirtualizedList({
    keys: messageKeys,
    estimateSize,
    scrollRef,
    enabled: virtualizeEnabled,
    overscanPx: LIST_VIRTUALIZATION_OVERSCAN,
  })

  React.useEffect(() => {
    onVirtualScrollToItemChange?.((id: string) => {
      scrollToKey(id, 'center')
    })
  }, [onVirtualScrollToItemChange, scrollToKey])

  React.useEffect(() => {
    return () => onVirtualScrollToItemChange?.(undefined)
  }, [onVirtualScrollToItemChange])

  const renderedIndexes = virtualizationActive
    ? virtualItems.map((item) => item.index)
    : messages.map((_, index) => index)

  return (
    <div ref={messageListRef}>
      {virtualizationActive && topPadding > 0 && (
        <div aria-hidden style={{ height: topPadding }} />
      )}

      {renderedIndexes.map((index) => {
        const message = messages[index]
        if (!message) return null

        const estimatedHeight = (estimatedHeightsById.get(message.id) ?? 200) + (dividerSet.has(message.id) ? 28 : 0)
        return (
          <div
            key={message.id}
            data-message-id={message.id}
            ref={virtualizationActive ? measureElement(message.id) : undefined}
            style={{
              containIntrinsicSize: `auto ${Math.ceil(estimatedHeight)}px`,
            }}
          >
            <ChatMessageItem
              message={message}
              conversationId={conversationId}
              isStreaming={false}
              isLastAssistant={false}
              allMessages={messages}
              onDeleteMessage={onDeleteMessage}
              onResendMessage={onResendMessage}
              onStartInlineEdit={onStartInlineEdit}
              onSubmitInlineEdit={onSubmitInlineEdit}
              onCancelInlineEdit={onCancelInlineEdit}
              isInlineEditing={message.id === inlineEditingMessageId}
            />
            {dividerSet.has(message.id) && (
              <ContextDivider
                messageId={message.id}
                onDelete={onDeleteDivider}
              />
            )}
          </div>
        )
      })}

      {virtualizationActive && bottomPadding > 0 && (
        <div aria-hidden style={{ height: bottomPadding }} />
      )}

      {(streaming || smoothContent || smoothReasoning) && (
        <Message from="assistant">
          <MessageHeader
            model={streamingModel ?? undefined}
            time={formatMessageTime(Date.now())}
            logo={
              <img
                src={getModelLogo(streamingModel ?? '')}
                alt="AI"
                className="size-[35px] rounded-[25%] object-cover"
              />
            }
          />
          <MessageContent>
            <ChatToolActivityIndicator activities={toolActivities} isStreaming={streaming} />

            {smoothReasoning && (
              <Reasoning
                isStreaming={streaming && !smoothContent}
                defaultOpen={true}
              >
                <ReasoningTrigger />
                <ReasoningContent>{smoothReasoning}</ReasoningContent>
              </Reasoning>
            )}

            {smoothContent ? (
              <>
                <MessageResponse>{smoothContent}</MessageResponse>
                {streaming && <StreamingIndicator />}
              </>
            ) : (
              streaming && !smoothReasoning && <MessageLoading startedAt={startedAt} />
            )}
          </MessageContent>
        </Message>
      )}
    </div>
  )
}

/**
 * 滚动到顶部自动加载更多历史消息
 *
 * 挂在 Conversation（StickToBottom）内部，通过 context 获取滚动容器 ref，
 * 监听 scroll 事件，当滚动到顶部附近时触发加载。
 * 加载后恢复滚动位置，保证用户视角不变。
 */
function ScrollTopLoader({ hasMore, loading, onLoadMore }: ScrollTopLoaderProps): React.ReactElement | null {
  const { scrollRef } = useStickToBottomContext()
  const triggeredRef = React.useRef(false)

  // hasMore 变化时重置触发标记（例如切换对话）
  React.useEffect(() => {
    triggeredRef.current = false
  }, [hasMore])

  React.useEffect(() => {
    const el = scrollRef.current
    if (!el || !hasMore || triggeredRef.current) return

    const handleScroll = (): void => {
      // 滚动到顶部 100px 以内时触发
      if (el.scrollTop < 100 && !triggeredRef.current) {
        triggeredRef.current = true
        const prevHeight = el.scrollHeight

        onLoadMore().then((result) => {
          const prependedMessages = result?.prependedMessages ?? []
          if (prependedMessages.length > 0) {
            const estimatedHeight = estimatePrependMessagesHeight(prependedMessages, el.clientWidth)
            if (estimatedHeight > 0) {
              el.scrollTop += estimatedHeight
            }
          }

          // 加载完成后恢复滚动位置：新内容插入顶部，保持用户视角不变
          requestAnimationFrame(() => {
            el.scrollTop = el.scrollHeight - prevHeight
          })
        })
      }
    }

    el.addEventListener('scroll', handleScroll, { passive: true })
    return () => el.removeEventListener('scroll', handleScroll)
  }, [scrollRef, hasMore, onLoadMore])

  if (!hasMore) return null

  if (loading) {
    return (
      <div className="flex justify-center py-3">
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return null
}

// ===== 主组件 =====

interface ChatMessagesProps {
  /** 当前对话 ID */
  conversationId: string
  /** 消息列表 */
  messages: ChatMessage[]
  /** 消息是否已完成首次加载（避免空数组初始化误触发滚动恢复） */
  messagesLoaded?: boolean
  /** 是否正在流式生成 */
  streaming: boolean
  /** 流式累积内容 */
  streamingContent: string
  /** 流式推理内容 */
  streamingReasoning: string
  /** 流式消息绑定的模型 */
  streamingModel: string | null
  /** 流式开始时间戳 */
  startedAt?: number
  /** 工具活动列表 */
  toolActivities: ChatToolActivity[]
  /** 上下文分隔线 */
  contextDividers: string[]
  /** 是否还有更多历史消息 */
  hasMore: boolean
  /** 删除消息回调 */
  onDeleteMessage?: (messageId: string) => Promise<void>
  /** 重新发送消息回调 */
  onResendMessage?: (message: ChatMessage) => Promise<void>
  /** 开始原地编辑消息 */
  onStartInlineEdit?: (message: ChatMessage) => void
  /** 提交原地编辑 */
  onSubmitInlineEdit?: (message: ChatMessage, payload: InlineEditSubmitPayload) => Promise<void>
  /** 取消原地编辑 */
  onCancelInlineEdit?: () => void
  /** 当前正在编辑的消息 ID */
  inlineEditingMessageId?: string | null
  /** 删除分隔线回调 */
  onDeleteDivider?: (messageId: string) => void
  /** 加载更多历史消息回调 */
  onLoadMore?: () => Promise<LoadMoreResult | void>
}

/** 空状态引导 — 使用 WelcomeEmptyState */
function EmptyState(): React.ReactElement {
  return <WelcomeEmptyState />
}

export function ChatMessages({
  conversationId,
  messages,
  messagesLoaded = true,
  streaming,
  streamingContent,
  streamingReasoning,
  streamingModel,
  startedAt,
  toolActivities,
  contextDividers,
  hasMore,
  onDeleteMessage,
  onResendMessage,
  onStartInlineEdit,
  onSubmitInlineEdit,
  onCancelInlineEdit,
  inlineEditingMessageId,
  onDeleteDivider,
  onLoadMore,
}: ChatMessagesProps): React.ReactElement {
  const userProfile = useAtomValue(userProfileAtom)

  // 平滑流式输出：将高频更新转为逐字渲染
  const { displayedContent: smoothContent } = useSmoothStream({
    content: streamingContent,
    isStreaming: streaming,
  })
  const { displayedContent: smoothReasoning } = useSmoothStream({
    content: streamingReasoning,
    isStreaming: streaming,
  })
  const [parallelMode] = useConversationParallelMode()

  /** 是否正在加载更多历史 */
  const [loadingMore, setLoadingMore] = React.useState(false)
  const virtualScrollToItemRef = React.useRef<((id: string) => void) | undefined>(undefined)
  const handleVirtualScrollToItemChange = React.useCallback((handler?: (id: string) => void) => {
    virtualScrollToItemRef.current = handler
  }, [])
  const handleMinimapScrollToItem = React.useCallback((id: string) => {
    virtualScrollToItemRef.current?.(id)
  }, [])

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
    if (streamingContent || smoothContent) {
      setTransitioning(true)
      return
    }
    const timer = setTimeout(() => setTransitioning(false), 150)
    return () => clearTimeout(timer)
  }, [streaming, streamingContent, smoothContent])

  /**
   * 淡入控制：切换对话时先隐藏，等 StickToBottom 定位完成后再显示。
   * 避免 "先看到顶部消息再跳到底部" 的闪烁。
   */
  const [ready, setReady] = React.useState(false)
  const prevConversationIdRef = React.useRef<string | null>(null)

  // 对话切换时立即隐藏
  React.useEffect(() => {
    if (conversationId !== prevConversationIdRef.current) {
      prevConversationIdRef.current = conversationId
      setReady(false)
    }
  }, [conversationId])

  // 消息渲染 + StickToBottom 定位完成后淡入
  React.useEffect(() => {
    if (ready) return
    if (!messagesLoaded) return

    // 空对话直接显示
    if (messages.length === 0 && !streaming) {
      setReady(true)
      return
    }

    // 双 rAF：确保 DOM 渲染和 StickToBottom 滚动都完成
    let cancelled = false
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!cancelled) setReady(true)
      })
    })
    return () => { cancelled = true }
  }, [messagesLoaded, messages, streaming, ready])

  /** 加载更多历史消息 */
  const handleLoadMore = React.useCallback(async (): Promise<LoadMoreResult | void> => {
    if (!onLoadMore || loadingMore || !hasMore) return

    setLoadingMore(true)
    try {
      return await onLoadMore()
    } finally {
      setLoadingMore(false)
    }
  }, [onLoadMore, loadingMore, hasMore])

  // 并排模式：自动加载全部历史消息（并排视图需要完整上下文）
  React.useEffect(() => {
    if (parallelMode && hasMore) {
      handleLoadMore()
    }
  }, [parallelMode, hasMore, handleLoadMore])

  // 迷你地图数据（必须在所有条件分支之前调用，遵守 hooks 规则）
  const minimapItems: MinimapItem[] = React.useMemo(
    () => messages.map((m) => ({
      id: m.id,
      role: m.role as MinimapItem['role'],
      preview: m.content.slice(0, 200),
      avatar: m.role === 'user' ? userProfile.avatar : undefined,
      model: m.model,
    })),
    [messages, userProfile.avatar]
  )

  // 并排模式
  if (parallelMode) {
    return (
      <ParallelChatMessages
        messages={messages}
        conversationId={conversationId}
        streaming={streaming}
        streamingContent={smoothContent}
        streamingReasoning={smoothReasoning}
        startedAt={startedAt}
        contextDividers={contextDividers}
        onDeleteDivider={onDeleteDivider}
        onDeleteMessage={onDeleteMessage}
        onResendMessage={onResendMessage}
        onStartInlineEdit={onStartInlineEdit}
        onSubmitInlineEdit={onSubmitInlineEdit}
        onCancelInlineEdit={onCancelInlineEdit}
        inlineEditingMessageId={inlineEditingMessageId}
        loadingMore={loadingMore}
      />
    )
  }

  return (
    <Conversation resize={ready && !transitioning ? 'smooth' : 'instant'} className={ready ? 'opacity-100 transition-opacity duration-200' : 'opacity-0'}>
      <ScrollPositionManager id={conversationId} ready={ready} />
      <ScrollToLatestOnSignal id={conversationId} ready={ready} />
      {/* 滚动到顶部时自动加载更多历史 */}
      <ScrollTopLoader
        hasMore={hasMore}
        loading={loadingMore}
        onLoadMore={handleLoadMore}
      />
      <ConversationContent>
        {messages.length === 0 && !streaming ? (
          <EmptyState />
        ) : (
          <StandardMessageList
            conversationId={conversationId}
            messages={messages}
            contextDividers={contextDividers}
            streaming={streaming}
            smoothContent={smoothContent}
            smoothReasoning={smoothReasoning}
            streamingModel={streamingModel}
            startedAt={startedAt}
            toolActivities={toolActivities}
            inlineEditingMessageId={inlineEditingMessageId}
            onDeleteMessage={onDeleteMessage}
            onResendMessage={onResendMessage}
            onStartInlineEdit={onStartInlineEdit}
            onSubmitInlineEdit={onSubmitInlineEdit}
            onCancelInlineEdit={onCancelInlineEdit}
            onDeleteDivider={onDeleteDivider}
            onVirtualScrollToItemChange={handleVirtualScrollToItemChange}
          />
        )}
      </ConversationContent>
      <ScrollMinimap items={minimapItems} onScrollToItem={handleMinimapScrollToItem} />
      <ConversationScrollButton />
    </Conversation>
  )
}
