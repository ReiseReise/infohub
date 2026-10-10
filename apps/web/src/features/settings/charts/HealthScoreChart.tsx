import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Skeleton } from '../../../components/ui/skeleton';

export interface HealthScoreDataPoint {
  range: string;
  count: number;
}

interface HealthScoreChartProps {
  data?: HealthScoreDataPoint[];
  loading?: boolean;
}

const SCORE_COLORS: Record<string, string> = {
  '0-20': '#ef4444',
  '20-40': '#f97316',
  '40-60': '#f59e0b',
  '60-80': '#10b981',
  '80-100': '#059669',
};

// TODO: 接入真实API — 从内容评分分布接口获取
function generateMockData(): HealthScoreDataPoint[] {
  return [
    { range: '0-20', count: 3 },
    { range: '20-40', count: 12 },
    { range: '40-60', count: 28 },
    { range: '60-80', count: 45 },
    { range: '80-100', count: 22 },
  ];
}

export function HealthScoreChart({ data, loading }: HealthScoreChartProps) {
  if (loading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">内容评分分布</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[200px] w-full" />
        </CardContent>
      </Card>
    );
  }

  const chartData = data && data.length > 0 ? data : generateMockData();
  const totalItems = chartData.reduce((sum, d) => sum + d.count, 0);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">
          内容评分分布
          {(!data || data.length === 0) && <span className="ml-2 text-[10px] font-normal text-zinc-400">(演示数据)</span>}
        </CardTitle>
        <p className="text-[11px] text-zinc-400">评分区间内容数量 · 共 {totalItems} 条</p>
      </CardHeader>
      <CardContent>
        {chartData.length === 0 ? (
          <div className="flex items-center justify-center h-[200px] text-sm text-zinc-400">暂无数据</div>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={chartData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" vertical={false} />
              <XAxis dataKey="range" tick={{ fontSize: 11 }} stroke="#a1a1aa" />
              <YAxis tick={{ fontSize: 11 }} stroke="#a1a1aa" />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(value) => [`${value} 条`, '数量']} />
              <Bar dataKey="count" name="条目数" radius={[4, 4, 0, 0]}>
                {chartData.map((entry, index) => (
                  <Cell key={index} fill={SCORE_COLORS[entry.range] || '#a1a1aa'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
