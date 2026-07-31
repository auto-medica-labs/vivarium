# Vivarium Security Improvement Plan

Estimates assume one engineer and exclude organizational review time.

## Phase 0 — Safe Deployment Defaults

**Effort:** Hours
**Target:** 5–6/10

- Use hardened Docker settings:
  - read-only root filesystem
  - all Linux capabilities dropped
  - `no-new-privileges`
  - CPU, memory, and PID limits
  - restricted `/tmp`
- Never mount host directories or `/var/run/docker.sock`.
- Bind only to an internal interface.
- Pin the image by digest instead of `latest`.
- Run the container on a host without sensitive credentials.

### Acceptance criteria

- Container runs as non-root.
- Capability bounding set is empty.
- Root filesystem is read-only.
- Resource exhaustion kills or restarts only the container.
- Host-canary isolation test passes.

## Phase 1 — Authentication and Endpoint Lockdown

**Effort:** 1–2 days
**Target:** 6/10

Put Vivarium behind an authenticated reverse proxy or company API gateway.

- Require TLS and company SSO or API credentials.
- Do not expose port `3080` directly.
- Protect every endpoint, including:
  - `/exec`
  - `/sessions`
  - `/metrics`
  - `/health`
- Permit health and metrics only from monitoring networks.
- Add request-body limits at the proxy.
- Add per-user and global rate limits.

### Acceptance criteria

- Unauthenticated requests receive `401`.
- Users cannot reach the container directly.
- Metrics and session information are inaccessible to normal users.
- Authentication identity is recorded without logging tokens.

## Phase 2 — Session Ownership and Tenant Isolation

**Effort:** 3–5 days
**Target:** 7/10

The current client-selected `sessionId` model is unsafe for multiple users.

- Associate every session with an authenticated principal.

- Derive an internal key such as:

  ```text
  authenticated-user-id + client-session-id
  ```

- Never trust a user-provided identity header unless it is inserted by the
  trusted proxy.

- Change `/sessions` so users only see their own sessions.

- Add explicit session deletion.

- Apply per-user session and execution limits.

- Prevent one user from attaching to another user’s session.

### Acceptance criteria

- User A cannot list, execute within, delete, or inspect User B’s sessions.
- Guessing another session ID provides no access.
- Automated cross-tenant tests pass.

**This is the minimum recommended phase before general internal company use.**

## Phase 3 — Network and Resource Containment

**Effort:** 3–7 days
**Target:** 7–8/10

- Deny outbound container traffic using host firewall rules, Kubernetes
  `NetworkPolicy`, or an equivalent platform policy.
- Keep only the required inbound path from the proxy.
- Add:
  - per-user concurrent execution limits
  - global execution queue limits
  - memory monitoring and restart thresholds
  - container restart policies
- Run containers on dedicated worker nodes.
- Ensure worker nodes cannot access:
  - cloud metadata endpoints
  - internal databases
  - control-plane APIs
  - company secrets

Do not simply use `--network none` with direct port publishing—it can also
remove the network path required to reach the service.

### Acceptance criteria

- Python and the container process cannot reach the internet, metadata services,
  or internal systems.
- CPU and memory attacks affect only the sandbox service.
- Saturation produces controlled `429` or `503` responses.

## Phase 4 — Security Regression Suite and Supply Chain

**Effort:** 1–2 weeks
**Target:** 8/10

Expand automated tests for:

- host filesystem access
- JavaScript and prototype-chain escapes
- subprocess and shell execution
- network access
- package installation
- filesystem backend re-enablement
- session ownership
- malformed uploads and filenames
- memory and output exhaustion
- timeout recovery

Add supply-chain controls:

- Generate an SBOM.
- Scan images and dependencies in CI.
- Pin Bun, Pyodide, and base-image versions.
- Sign published images.
- Verify signatures during deployment.
- Add automated vulnerability update alerts.
- Run the host-canary test against the built image in CI.

### Acceptance criteria

- Security tests block releases on failure.
- Deployments use verified image digests.
- Critical dependency vulnerabilities have a documented patch SLA.

## Phase 5 — Container per Session or Job

**Effort:** 2–6 weeks
**Target:** 8–9/10

Replace multiple workers in one shared container with an isolated runtime per
session or execution.

Suggested model:

1. The API authenticates and validates the request.
1. The request enters a bounded queue.
1. An orchestrator creates an ephemeral hardened container.
1. Code executes with strict cgroup and network limits.
1. Approved output is copied out.
1. The container is destroyed.

Use:

- a non-root user
- a read-only image
- an empty capability set
- a custom seccomp or AppArmor profile
- an ephemeral tmpfs workspace
- no host mounts
- no service-account credentials
- a strict execution deadline
- per-job memory and CPU quotas

### Benefits

- A compromised interpreter does not expose other sessions.
- Per-user resource accounting becomes straightforward.
- Container destruction reliably clears state.

**Trade-off:** Higher startup latency and operational complexity.

## Phase 6 — Strong Isolation with gVisor or MicroVMs

**Effort:** 1–3 months
**Target:** 9/10

For intentionally hostile code or sensitive company data, move the execution
layer to:

- gVisor
- Kata Containers
- Firecracker microVMs
- another managed isolated-code platform

Add:

- dedicated sandbox hosts
- no shared kernel with application infrastructure
- disposable VM filesystems
- a strict egress proxy
- short-lived credentials—or preferably none
- an audited control plane
- automatic instance destruction
- a host reimaging and patch cadence

Use this phase when:

- users are mutually untrusted
- code may be intentionally malicious
- regulated or highly sensitive data is involved
- sandbox escape impact must be minimal

## Phase 7 — Independent Security Validation

**Effort:** Ongoing
**Target:** Confidence rather than a numeric increase

- Produce a formal threat model.
- Commission a penetration test focused on Pyodide-to-JavaScript escape.
- Fuzz the API, worker protocol, filenames, and base64 handling.
- Review Docker, proxy, and network configurations.
- Create incident-response and emergency-disable procedures.
- Reassess after every major Bun or Pyodide update.

## Recommended Stopping Points

| Usage                                    |                     Minimum phase |
| ---------------------------------------- | --------------------------------: |
| Small trusted engineering team           |                           Phase 2 |
| General internal company sandbox         |                           Phase 4 |
| Mutually untrusted internal users        |                           Phase 5 |
| Hostile code or sensitive regulated data | Phase 6 plus an independent audit |

The highest-value sequence is **hardened deployment → authentication → session
ownership → network isolation**. These steps address the largest current risks
before undertaking architectural changes.
