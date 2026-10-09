import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Skeleton } from '../../../components/ui/skeleton';

export interface FreshnessDataPoint {
  sourceName: string;
  hoursSinceLastFetch: number;
}

interface FreshnessChartProps {
  data?: FreshnessDataPoint[];
  loading?: boolean;
  /** 超过此小时数显示红色 (默认 24) */
  threshold?: number;
}

// TODO: 接入真实API — 从信源列表获取 lastFetchedAt 计算 freshness
function generateMockData(): FreshnessDataPoint[] {
  return [
    { sourceName: 'Hacker News', hoursSinceLastFetch: 2 },
    { sourceName: 'RSS Feed A', hoursSinceLastFetch: 8 },
    { sourceName: 'Twitter List', hoursSinceLastFetch: 18 },
    { sourceName: 'Reddit', hoursSinceLastFetch: 36 },
    { sourceName: 'Podcast', hoursSinceLastFetch: 72 },
    { sourceName: 'Newsletter', hoursSinceLastFetch: 12 },
  ];
}

export function FreshnessChart({ data, loading, threshold = 24 }: FreshnessChartProps) {
  if (loading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">信源新鲜度</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[200px] w-full" />
        </CardContent>
      </Card>
    );
  }

  const chartData = data && data.length > 0 ? data : generateMockData();

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">
          信源新鲜度
          {(!data || data.length === 0) && <span className="ml-2 text-[10px] font-normal text-zinc-400">(演示数据)</span>}
        </CardTitle>
        <p className="text-[11px] text-zinc-400">距最后抓取的小时数（红色 &gt; {threshold}h）</p>
      </CardHeader>
      <CardContent>
        {chartData.length === 0 ? (
          <div className="flex items-center justify-center h-[200px] text-sm text-zinc-400">暂无数据</div>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={chartData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11 }} stroke="#a1a1aa" unit="h" />
              <YAxis dataKey="sourceName" type="category" tick={{ fontSize: 10 }} stroke="#a1a1aa" width={80} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(value) => [`${value}h`, '距今']} />
              <Bar dataKey="hoursSinceLastFetch" name="小时" radius={[0, 4, 4, 0]}>
                {chartData.map((entry, index) => (
                  <Cell key={index} fill={entry.hoursSinceLastFetch > threshold ? '#ef4444' : '#10b981'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
