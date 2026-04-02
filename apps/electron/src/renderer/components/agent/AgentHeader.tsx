import * as React from 'react'

/** AgentHeader：标题展示已交由顶部 TabBar 统一处理。 */
interface AgentHeaderProps {
  sessionId: string
}

export function AgentHeader({ sessionId }: AgentHeaderProps): React.ReactElement | null {
  if (!sessionId) return null
  return null
}

