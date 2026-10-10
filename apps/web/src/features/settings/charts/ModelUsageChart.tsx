import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Skeleton } from '../../../components/ui/skeleton';

export interface ModelUsageDataPoint {
  model: string;
  tokens: number;
}

interface ModelUsageChartProps {
  data?: ModelUsageDataPoint[];
  loading?: boolean;
}

const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4'];

// TODO: 接入真实API — 从AI处理统计接口获取各模型token消耗
function generateMockData(): ModelUsageDataPoint[] {
  return [
    { model: 'GPT-4o', tokens: 128000 },
    { model: 'Claude 3.5', tokens: 95000 },
    { model: 'GPT-4o-mini', tokens: 210000 },
    { model: 'Deepseek', tokens: 67000 },
  ];
}

export function ModelUsageChart({ data, loading }: ModelUsageChartProps) {
  if (loading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">AI 模型用量</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[200px] w-full" />
        </CardContent>
      </Card>
    );
  }

  const chartData = data && data.length > 0 ? data : generateMockData();
  const totalTokens = chartData.reduce((sum, d) => sum + d.tokens, 0);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">
          AI 模型用量
          {(!data || data.length === 0) && <span className="ml-2 text-[10px] font-normal text-zinc-400">(演示数据)</span>}
        </CardTitle>
        <p className="text-[11px] text-zinc-400">Token 消耗占比 · 总计 {(totalTokens / 1000).toFixed(0)}K</p>
      </CardHeader>
      <CardContent>
        {chartData.length === 0 ? (
          <div className="flex items-center justify-center h-[200px] text-sm text-zinc-400">暂无数据</div>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie
                data={chartData}
                dataKey="tokens"
                nameKey="model"
                cx="50%"
                cy="50%"
                outerRadius={70}
                innerRadius={40}
                paddingAngle={2}
                label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
                labelLine={false}
                style={{ fontSize: 10 }}
              >
                {chartData.map((_, index) => (
                  <Cell key={index} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{ fontSize: 12, borderRadius: 8 }}
                formatter={(value) => [`${(Number(value) / 1000).toFixed(1)}K tokens`, '消耗']}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
            </PieChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
