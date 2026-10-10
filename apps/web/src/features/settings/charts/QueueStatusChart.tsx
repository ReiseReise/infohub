import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Skeleton } from '../../../components/ui/skeleton';

export interface QueueStatusDataPoint {
  date: string;
  pending: number;
  processing: number;
  completed: number;
  failed: number;
}

interface QueueStatusChartProps {
  data?: QueueStatusDataPoint[];
  loading?: boolean;
}

// TODO: 接入真实API — 当后端提供队列历史时序数据后替换此mock
function generateMockData(): QueueStatusDataPoint[] {
  const now = new Date();
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now);
    d.setDate(d.getDate() - (6 - i));
    return {
      date: `${d.getMonth() + 1}/${d.getDate()}`,
      pending: Math.floor(Math.random() * 20) + 5,
      processing: Math.floor(Math.random() * 10) + 2,
      completed: Math.floor(Math.random() * 80) + 40,
      failed: Math.floor(Math.random() * 5),
    };
  });
}

export function QueueStatusChart({ data, loading }: QueueStatusChartProps) {
  if (loading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">队列处理趋势</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[200px] w-full" />
        </CardContent>
      </Card>
    );
  }

  const chartData = data && data.length > 0 ? data : generateMockData();

  if (!data || data.length === 0) {
    // Using mock data - show indicator
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">
          队列处理趋势
          {(!data || data.length === 0) && <span className="ml-2 text-[10px] font-normal text-zinc-400">(演示数据)</span>}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={chartData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="#a1a1aa" />
            <YAxis tick={{ fontSize: 11 }} stroke="#a1a1aa" />
            <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line type="monotone" dataKey="completed" name="已完成" stroke="#10b981" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="pending" name="等待" stroke="#f59e0b" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="processing" name="处理中" stroke="#3b82f6" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="failed" name="失败" stroke="#ef4444" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
