import * as React from 'react'

/**
 * 读取并订阅当前窗口全屏状态。
 */
export function useWindowFullscreen(): boolean {
  const [isFullscreen, setIsFullscreen] = React.useState(false)

  React.useEffect(() => {
    let mounted = true
    const api = window.electronAPI as unknown as {
      getWindowFullscreen?: () => Promise<boolean>
      onWindowFullscreenChanged?: (callback: (isFullscreen: boolean) => void) => () => void
    }

    if (typeof api.getWindowFullscreen === 'function') {
      api.getWindowFullscreen()
        .then((value) => {
          if (mounted) setIsFullscreen(value)
        })
        .catch(console.error)
    } else {
      // 兼容 preload 尚未热更新到最新 API 的场景
      setIsFullscreen(false)
    }

    const cleanup = typeof api.onWindowFullscreenChanged === 'function'
      ? api.onWindowFullscreenChanged((value) => {
        setIsFullscreen(value)
      })
      : () => {}

    return () => {
      mounted = false
      cleanup()
    }
  }, [])

  return isFullscreen
}
