/**
 * UsageStatsSettings - 设置页模型用量统计
 *
 * 支持：
 * - 来源切换：全部 / 仅 Chat / 仅 Agent
 * - 时间范围：近 7 / 30 / 90 天
 * - 按模型堆叠柱状图（Top 6 + 其他）
 * - 柱状图 tooltip 明细
 */

import * as React from 'react'
import { BarChart3, Loader2, RefreshCw } from 'lucide-react'
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  Legend,
} from 'recharts'
import type { ModelUsageStats, UsageRangeDays, UsageScope } from '@proma/shared'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  SettingsSection,
  SettingsCard,
  SettingsSegmentedControl,
} from './primitives'

const TOP_N_MODELS = 6
const OTHER_MODEL_KEY = '其他'

const SERIES_COLORS = [
  '#3b82f6',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#06b6d4',
  '#84cc16',
  '#6b7280',
]

interface ChartRow {
  rawDate: string
  totalTokens: number
  [key: string]: string | number
}

function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`
  return `${tokens}`
}

function toDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatAxisDate(dateKey: string): string {
  return dateKey.slice(5).replace('-', '/')
}

function buildDateKeys(days: UsageRangeDays): string[] {
  const end = new Date()
  end.setHours(0, 0, 0, 0)
  const start = new Date(end)
  start.setDate(start.getDate() - days + 1)

  const keys: string[] = []
  for (let i = 0; i < days; i++) {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    keys.push(toDateKey(d))
  }
  return keys
}

function UsageChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: Array<{ dataKey?: string | number; value?: number; color?: string; payload?: ChartRow }>
  label?: string
}): React.ReactElement | null {
  if (!active || !payload || payload.length === 0) return null

  const rows = payload
    .map((item) => ({
      model: String(item.dataKey ?? ''),
      value: typeof item.value === 'number' ? item.value : 0,
      color: item.color,
    }))
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value)

  if (rows.length === 0) return null

  const totalTokensFromPayload = payload[0]?.payload?.totalTokens
  const totalTokens = typeof totalTokensFromPayload === 'number'
    ? totalTokensFromPayload
    : rows.reduce((sum, item) => sum + item.value, 0)

  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 shadow-md min-w-[220px]">
      <div className="text-xs font-medium text-foreground">{label}</div>
      <div className="mt-1 text-xs text-muted-foreground">
        总计: <span className="text-foreground font-medium">{totalTokens.toLocaleString()} tokens</span>
      </div>
      <div className="mt-2 space-y-1">
        {rows.map((row) => (
          <div key={row.model} className="flex items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-1.5 min-w-0">
              <span
                className="h-2 w-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: row.color }}
              />
              <span className="truncate">{row.model}</span>
            </div>
            <span className="tabular-nums text-foreground">{row.value.toLocaleString()}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function UsageStatsSettings(): React.ReactElement {
  const [scope, setScope] = React.useState<UsageScope>('all')
  const [rangeDays, setRangeDays] = React.useState<UsageRangeDays>(7)
  const [stats, setStats] = React.useState<ModelUsageStats | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [refreshing, setRefreshing] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const loadStats = React.useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true)
    } else {
      setLoading(true)
    }
    setError(null)

    try {
      const data = await window.electronAPI.getModelUsageStats()
      setStats(data)
    } catch (err) {
      const message = err instanceof Error ? err.message : '加载失败'
      setError(message)
    } finally {
      if (isRefresh) {
        setRefreshing(false)
      } else {
        setLoading(false)
      }
    }
  }, [])

  React.useEffect(() => {
    void loadStats(false)
  }, [loadStats])

  const derived = React.useMemo(() => {
    const scopeStats = stats?.scopes[scope]
    if (!scopeStats) {
      return {
        chartData: [] as ChartRow[],
        seriesKeys: [] as string[],
        hasOther: false,
        rangeTotalTokens: 0,
        scopedAllTimeTotalTokens: 0,
        modelCount: 0,
      }
    }

    const dateKeys = buildDateKeys(rangeDays)
    const dailyMap = new Map(scopeStats.daily.map((day) => [day.date, day]))
    const rangeModelTotals = new Map<string, number>()

    let rangeTotalTokens = 0
    for (const dateKey of dateKeys) {
      const day = dailyMap.get(dateKey)
      if (!day) continue
      rangeTotalTokens += day.totalTokens
      for (const [model, tokens] of Object.entries(day.models)) {
        if (tokens <= 0) continue
        rangeModelTotals.set(model, (rangeModelTotals.get(model) ?? 0) + tokens)
      }
    }

    const sortedModels = Array.from(rangeModelTotals.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([model]) => model)

    const topModels = sortedModels.slice(0, TOP_N_MODELS)
    const hasOther = sortedModels.length > TOP_N_MODELS
    const seriesKeys = hasOther ? [...topModels, OTHER_MODEL_KEY] : topModels

    const chartData: ChartRow[] = dateKeys.map((dateKey) => {
      const day = dailyMap.get(dateKey)
      const row: ChartRow = {
        rawDate: dateKey,
        totalTokens: day?.totalTokens ?? 0,
      }

      let topTokens = 0
      for (const model of topModels) {
        const value = day?.models[model] ?? 0
        row[model] = value
        topTokens += value
      }

      if (hasOther) {
        const otherTokens = Math.max(0, (day?.totalTokens ?? 0) - topTokens)
        row[OTHER_MODEL_KEY] = otherTokens
      }

      return row
    })

    return {
      chartData,
      seriesKeys,
      hasOther,
      rangeTotalTokens,
      scopedAllTimeTotalTokens: scopeStats.allTimeTotalTokens,
      modelCount: sortedModels.length,
    }
  }, [stats, scope, rangeDays])

  if (loading && !stats) {
    return (
      <div className="flex h-56 items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="ml-2 text-sm">正在加载用量统计...</span>
      </div>
    )
  }

  if (!stats) {
    return (
      <div className="space-y-4">
        <SettingsCard divided={false}>
          <div className="px-4 py-6 text-sm text-destructive">
            加载用量统计失败：{error ?? '未知错误'}
          </div>
        </SettingsCard>
        <Button variant="outline" size="sm" onClick={() => void loadStats(false)}>
          <RefreshCw className="h-3.5 w-3.5" />
          重试
        </Button>
      </div>
    )
  }

  const hasRangeData = derived.rangeTotalTokens > 0
  const allTimeTotalTokens = stats.scopes.all.allTimeTotalTokens

  return (
    <div className="space-y-6">
      <SettingsSection
        title="模型用量统计"
        description="按模型查看每天 token 用量（Top 6 + 其他）"
        action={(
          <Button
            variant="outline"
            size="sm"
            onClick={() => void loadStats(true)}
            disabled={refreshing}
          >
            {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            刷新
          </Button>
        )}
      >
        <SettingsCard divided={false}>
          <SettingsSegmentedControl
            label="统计范围"
            description="切换全部、仅 Chat 或仅 Agent"
            value={scope}
            onValueChange={(value) => setScope(value as UsageScope)}
            options={[
              { value: 'all', label: '全部' },
              { value: 'chat', label: '仅 Chat' },
              { value: 'agent', label: '仅 Agent' },
            ]}
          />
          <div className="border-t border-border/50" />
          <SettingsSegmentedControl
            label="时间范围"
            description="默认近 7 天，可切换到近 30 或 90 天"
            value={String(rangeDays)}
            onValueChange={(value) => setRangeDays(Number(value) as UsageRangeDays)}
            options={[
              { value: '7', label: '近 7 天' },
              { value: '30', label: '近 30 天' },
              { value: '90', label: '近 90 天' },
            ]}
          />
        </SettingsCard>
      </SettingsSection>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          最近一次刷新失败：{error}
        </div>
      )}

      <SettingsSection title="总计用量" description="同时展示全历史与当前范围总计">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <SettingsCard divided={false}>
            <div className="px-4 py-4">
              <div className="text-xs text-muted-foreground">全历史总计</div>
              <div className="mt-1 text-xl font-semibold text-foreground tabular-nums">
                {allTimeTotalTokens.toLocaleString()}
              </div>
              <div className="text-xs text-muted-foreground">
                tokens · 全部来源 / 全部时间
              </div>
              {scope !== 'all' && (
                <div className="mt-1 text-xs text-muted-foreground">
                  当前来源全历史：{derived.scopedAllTimeTotalTokens.toLocaleString()} tokens
                </div>
              )}
            </div>
          </SettingsCard>
          <SettingsCard divided={false}>
            <div className="px-4 py-4">
              <div className="text-xs text-muted-foreground">当前范围总计（近 {rangeDays} 天）</div>
              <div className="mt-1 text-xl font-semibold text-foreground tabular-nums">
                {derived.rangeTotalTokens.toLocaleString()}
              </div>
              <div className="text-xs text-muted-foreground">
                tokens · {derived.modelCount} 个模型
              </div>
            </div>
          </SettingsCard>
        </div>
      </SettingsSection>

      <SettingsSection
        title="每日模型用量（堆叠）"
        description={cn(
          '图例仅展示当前范围 Top 6 模型，剩余合并为“其他”',
          !derived.hasOther && '当前范围内模型数不超过 Top 6'
        )}
      >
        <SettingsCard divided={false}>
          <div className="px-4 py-4">
            {!hasRangeData ? (
              <div className="flex h-64 flex-col items-center justify-center text-muted-foreground">
                <BarChart3 className="h-8 w-8 mb-2 opacity-70" />
                <p className="text-sm">当前范围内暂无可统计的 token 用量</p>
              </div>
            ) : (
              <div className="h-[340px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={derived.chartData} margin={{ top: 8, right: 12, left: 0, bottom: 6 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis
                      dataKey="rawDate"
                      tickFormatter={formatAxisDate}
                      tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                      axisLine={{ stroke: 'hsl(var(--border))' }}
                      tickLine={{ stroke: 'hsl(var(--border))' }}
                    />
                    <YAxis
                      tickFormatter={formatTokenCount}
                      tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                      axisLine={{ stroke: 'hsl(var(--border))' }}
                      tickLine={{ stroke: 'hsl(var(--border))' }}
                    />
                    <RechartsTooltip
                      cursor={{ fill: 'hsl(var(--muted) / 0.25)' }}
                      content={<UsageChartTooltip />}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    {derived.seriesKeys.map((seriesKey, index) => (
                      <Bar
                        key={seriesKey}
                        dataKey={seriesKey}
                        stackId="usage"
                        fill={SERIES_COLORS[index % SERIES_COLORS.length]}
                        radius={index === derived.seriesKeys.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                      />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </SettingsCard>
      </SettingsSection>
    </div>
  )
}
