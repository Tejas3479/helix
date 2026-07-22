# 🏛️ Architecture Specification — Helix Quantum

Helix Quantum is architected as a **modular dual-engine monolith** designed to provide high-throughput real-time telemetry streaming and state-machine multi-agent AI reasoning.

---

## 📐 System Architecture Diagram

```mermaid
graph TD
    subgraph Client Layer
        HUD[SRE Command HUD / Browser]
        GL[Three.js 3D WebGL Canvas]
        AUDIO[WebAudio Spatial Synth]
    end

    subgraph Dual-Engine Backend Layer
        EXPRESS[Node.js Express Gateway / server.js]
        FASTAPI[Python FastAPI Engine / server.py]
        STATE[(state.json Storage)]
    end

    subgraph AI & Infrastructure Layer
        LANGGRAPH[LangGraph StateGraph Workflow]
        GEMINI[Google Gemini LLM API]
        REDIS[(Redis Distributed Cache / Rate Limiter)]
        PROM[Prometheus Metrics Exporter]
    end

    HUD <-->|REST API / Bearer PIN| EXPRESS
    HUD <-->|SSE Stream / /api/stream| EXPRESS
    GL <-->|3D Node Matrix & Raycaster| HUD
    EXPRESS <-->|Save / Load State| STATE
    FASTAPI <-->|State Graph Execution| LANGGRAPH
    LANGGRAPH <-->|LLM Reasoning| GEMINI
    EXPRESS <-->|Rate Limit Fallback| REDIS
    EXPRESS -->|/metrics| PROM
    FASTAPI -->|/metrics| PROM
```

---

## 🤖 Multi-Agent Workflow State Machine

The SRE incident remediation graph executes through 6 sequential lifecycle phases:

```mermaid
stateDiagram-v2
    [*] --> DETECT: Telemetry Alert Triggered
    DETECT --> TRIAGE: Sentry-01 Analyzes Spikes
    TRIAGE --> RCA: Vanguard-01 Audits Logs & Blast Radius
    RCA --> PROPOSAL: Tecton-01 Computes Mitigation Runbook
    PROPOSAL --> HITL_GATE: Waiting for Operator Approval
    
    state HITL_GATE {
        [*] --> PendingApproval
        PendingApproval --> Approved: Operator Inputs PIN & Approves
        PendingApproval --> Denied: Operator Denies Proposal
    }

    Approved --> REMEDIATE: Execute Autonomous Healing Actions
    Denied --> HALT: Halt Playbook & Log Security Audit
    REMEDIATE --> [*]: Return System Status to NOMINAL
    HALT --> [*]: System Remains in Anomaly State
```

---

## 🔒 Security Architecture: Human-In-The-Loop (HITL) PIN Gate

To protect production infrastructure from unauthorized or incorrect AI actions, Helix Quantum implements a strict zero-trust gate pattern:

1. **Server-Side PIN Validation:** Handled by middleware (`authGate`) via HTTP `Authorization: Bearer <ADMIN_PIN>` headers.
2. **Client-Side PIN Modal Interceptor:** If an unauthenticated request receives `401 Unauthorized`, `app.js` renders `#pin-gate-overlay` to securely solicit the PIN from the SRE operator.
3. **Optimistic Locking:** Transient SRE approval locks (`waitingApproval`) are maintained in `systemState` and persisted to `state.json`.

---

## 📊 Observability & Metrics Specification

Prometheus metrics exposed at `/metrics`:

- `helix_system_status`: Gauge indicating system state (`0 = nominal`, `1 = anomaly`, `2 = resolving`).
- `helix_active_nodes`: Operational virtual host count (`1..64`).
- `helix_latency_ms`: Real-time traffic latency in milliseconds.
- `helix_throughput_req_sec`: System throughput in requests per second.
- `helix_monthly_cost_usd`: Infrastructure monthly cost tracking.
- `helix_sse_connected_clients`: Active Server-Sent Events client connection count.
