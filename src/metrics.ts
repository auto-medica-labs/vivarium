type RequestStatus = "success" | "error" | "timeout" | "rate_limited";

const DURATION_BUCKETS = [10, 50, 100, 500, 1000, 5000, 30000, 60000];

export class Metrics {
  private requestsTotal = new Map<RequestStatus, number>();
  private executionsTotal = 0;
  private durationBuckets = new Map<number, number>();
  private durationSum = 0;
  private durationCount = 0;

  constructor() {
    for (const status of ["success", "error", "timeout", "rate_limited"] as RequestStatus[]) {
      this.requestsTotal.set(status, 0);
    }
    for (const bucket of DURATION_BUCKETS) {
      this.durationBuckets.set(bucket, 0);
    }
  }

  incRequests(status: RequestStatus): void {
    this.requestsTotal.set(status, (this.requestsTotal.get(status) ?? 0) + 1);
  }

  incExecutions(): void {
    this.executionsTotal++;
  }

  observeDuration(ms: number): void {
    this.durationCount++;
    this.durationSum += ms;
    for (const [upper, count] of this.durationBuckets) {
      if (ms <= upper) {
        this.durationBuckets.set(upper, count + 1);
      }
    }
  }

  render(activeSessions: number): string {
    const lines: string[] = [];

    lines.push("# HELP vivarium_requests_total Total /exec requests by final status");
    lines.push("# TYPE vivarium_requests_total counter");
    for (const [status, count] of this.requestsTotal) {
      lines.push(`vivarium_requests_total{status="${status}"} ${count}`);
    }

    lines.push("# HELP vivarium_executions_total Total /exec invocations");
    lines.push("# TYPE vivarium_executions_total counter");
    lines.push(`vivarium_executions_total ${this.executionsTotal}`);

    lines.push("# HELP vivarium_active_sessions Number of active sessions");
    lines.push("# TYPE vivarium_active_sessions gauge");
    lines.push(`vivarium_active_sessions ${activeSessions}`);

    const heapUsed = process.memoryUsage().heapUsed;
    lines.push("# HELP vivarium_memory_usage_bytes Current heap memory usage in bytes");
    lines.push("# TYPE vivarium_memory_usage_bytes gauge");
    lines.push(`vivarium_memory_usage_bytes ${heapUsed}`);

    lines.push("# HELP vivarium_execution_duration_ms Execution duration distribution");
    lines.push("# TYPE vivarium_execution_duration_ms histogram");
    for (const upper of DURATION_BUCKETS) {
      const count = this.durationBuckets.get(upper) ?? 0;
      lines.push(`vivarium_execution_duration_ms_bucket{le="${upper}"} ${count}`);
    }
    lines.push(`vivarium_execution_duration_ms_bucket{le="+Inf"} ${this.durationCount}`);
    lines.push(`vivarium_execution_duration_ms_sum ${this.durationSum}`);
    lines.push(`vivarium_execution_duration_ms_count ${this.durationCount}`);

    return lines.join("\n") + "\n";
  }
}

export const metrics = new Metrics();
