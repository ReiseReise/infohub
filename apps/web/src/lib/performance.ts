import { onCLS, onINP, onLCP, onFCP, onTTFB, type MetricType } from 'web-vitals';

const THRESHOLDS: Record<string, number> = {
  LCP: 2500,
  INP: 200,
  CLS: 0.1,
  FCP: 1800,
  TTFB: 800,
};

function reportMetric(metric: MetricType) {
  // 开发环境 console 输出
  if (import.meta.env.DEV) {
    const threshold = THRESHOLDS[metric.name];
    const status = threshold && metric.value > threshold ? '⚠️' : '✓';
    console.log(`[Perf] ${status} ${metric.name}: ${metric.value.toFixed(1)}ms`);
  }
  // TODO: 生产环境可接入上报服务
}

export function initPerformanceMonitoring() {
  onCLS(reportMetric);
  onINP(reportMetric);
  onLCP(reportMetric);
  onFCP(reportMetric);
  onTTFB(reportMetric);
}
