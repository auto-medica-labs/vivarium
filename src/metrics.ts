type RequestStatus = "success" | "error" | "timeout" | "rate_limited";

const DURATION_BUCKETS = [10, 50, 100, 500, 1000, 5000, 30000, 60000];

// Init durations are typically 8-15 s, so use coarser buckets for the init histogram.
const INIT_BUCKETS = [1000, 5000, 10000, 15000, 30000, 60000];

export class Metrics {
  private requestsTotal = new Map<RequestStatus, number>();
  private executionsTotal = 0;
  private workerRespawns = 0;
  private durationBuckets = new Map<number, number>();
  private durationSum = 0;
  private durationCount = 0;
  private initBuckets = new Map<number, number>();
  private initSum = 0;
  private initCount = 0;
  private requestBuckets = new Map<number, number>();
  private requestSum = 0;
  private requestCount = 0;

  constructor() {
    for (const status of ["success", "error", "timeout", "rate_limited"] as RequestStatus[]) {
      this.requestsTotal.set(status, 0);
    }
    for (const bucket of DURATION_BUCKETS) {
      this.durationBuckets.set(bucket, 0);
    }
    for (const bucket of INIT_BUCKETS) {
      this.initBuckets.set(bucket, 0);
    }
    for (const bucket of DURATION_BUCKETS) {
      this.requestBuckets.set(bucket, 0);
    }
  }

  incRequests(status: RequestStatus): void {
    this.requestsTotal.set(status, (this.requestsTotal.get(status) ?? 0) + 1);
  }

  incExecutions(): void {
    this.executionsTotal++;
  }

  incWorkerRespawns(): void {
    this.workerRespawns++;
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

  observeInitDuration(ms: number): void {
    this.initCount++;
    this.initSum += ms;
    for (const [upper, count] of this.initBuckets) {
      if (ms <= upper) {
        this.initBuckets.set(upper, count + 1);
      }
    }
  }

  observeRequestDuration(ms: number): void {
    this.requestCount++;
    this.requestSum += ms;
    for (const [upper, count] of this.requestBuckets) {
      if (ms <= upper) {
        this.requestBuckets.set(upper, count + 1);
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

    lines.push("# HELP vivarium_worker_respawns_total Total worker terminations respawned");
    lines.push("# TYPE vivarium_worker_respawns_total counter");
    lines.push(`vivarium_worker_respawns_total ${this.workerRespawns}`);

    lines.push("# HELP vivarium_active_sessions Number of active sessions");
    lines.push("# TYPE vivarium_active_sessions gauge");
    lines.push(`vivarium_active_sessions ${activeSessions}`);

    const heapUsed = process.memoryUsage().heapUsed;
    lines.push("# HELP vivarium_memory_usage_bytes Current heap memory usage in bytes");
    lines.push("# TYPE vivarium_memory_usage_bytes gauge");
    lines.push(`vivarium_memory_usage_bytes ${heapUsed}`);

    lines.push("# HELP vivarium_execution_duration_ms Python execution duration distribution");
    lines.push("# TYPE vivarium_execution_duration_ms histogram");
    for (const upper of DURATION_BUCKETS) {
      const count = this.durationBuckets.get(upper) ?? 0;
      lines.push(`vivarium_execution_duration_ms_bucket{le="${upper}"} ${count}`);
    }
    lines.push(`vivarium_execution_duration_ms_bucket{le="+Inf"} ${this.durationCount}`);
    lines.push(`vivarium_execution_duration_ms_sum ${this.durationSum}`);
    lines.push(`vivarium_execution_duration_ms_count ${this.durationCount}`);

    lines.push("# HELP vivarium_worker_init_duration_ms Pyodide worker init duration distribution");
    lines.push("# TYPE vivarium_worker_init_duration_ms histogram");
    for (const upper of INIT_BUCKETS) {
      const count = this.initBuckets.get(upper) ?? 0;
      lines.push(`vivarium_worker_init_duration_ms_bucket{le="${upper}"} ${count}`);
    }
    lines.push(`vivarium_worker_init_duration_ms_bucket{le="+Inf"} ${this.initCount}`);
    lines.push(`vivarium_worker_init_duration_ms_sum ${this.initSum}`);
    lines.push(`vivarium_worker_init_duration_ms_count ${this.initCount}`);

    lines.push("# HELP vivarium_request_duration_ms Full /exec HTTP request duration distribution");
    lines.push("# TYPE vivarium_request_duration_ms histogram");
    for (const upper of DURATION_BUCKETS) {
      const count = this.requestBuckets.get(upper) ?? 0;
      lines.push(`vivarium_request_duration_ms_bucket{le="${upper}"} ${count}`);
    }
    lines.push(`vivarium_request_duration_ms_bucket{le="+Inf"} ${this.requestCount}`);
    lines.push(`vivarium_request_duration_ms_sum ${this.requestSum}`);
    lines.push(`vivarium_request_duration_ms_count ${this.requestCount}`);

    return lines.join("\n") + "\n";
  }
}

export const metrics = new Metrics();
