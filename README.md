# 🛡️ Helix Quantum — Autonomous Cloud Operations & SRE Command Center

[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](https://opensource.org/licenses/ISC)
[![Node.js](https://img.shields.io/badge/Node.js-v18%2B-green.svg)](https://nodejs.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.110.0-009688.svg)](https://fastapi.tiangolo.com/)
[![Three.js](https://img.shields.io/badge/Three.js-r128%2B-black.svg)](https://threejs.org/)
[![LangGraph](https://img.shields.io/badge/LangGraph-0.0.26-orange.svg)](https://python.langchain.com/)

Helix Quantum is an **Autonomous Cloud Infrastructure & SRE Command Center**. It combines a high-performance **3D WebGL cluster topology visualizer**, **multi-agent AI workflow reasoning** (via LangGraph & Gemini), **Server-Sent Events (SSE)** telemetry, **Prometheus observability**, and a strict **Human-In-The-Loop (HITL)** approval gate for high-consequence cloud operations.

---

## 🎯 Why This Is Perfect for the 3D Websites Hackathon

This project was built specifically with the hackathon's goals in mind:
- **🌌 Immersive 3D Experience:** Interactive 48-node (expandable to 64) 3D cluster visualization with glowing nodes, particle effects, and camera orbiting
- **💫 Beautiful Aesthetics:** Glassmorphic UI, Orbitron typography, neon glows, and smooth GSAP animations
- **✨ Unforgettable Interaction:** Trigger realistic incident simulations (DDoS, database failure, cost optimization), interact with the 3D mesh, and approve AI-driven mitigations
- **🛠️ Uses All Allowed Tech:** Three.js, WebGL, GSAP, and vanilla web tech (no heavy frameworks, just pure creativity)
- **🤖 AI-Powered (Optional):** Optional Python backend with LangGraph and Gemini for real multi-agent reasoning (but fully functional with just Node.js)

---

## 🌟 Key Features

- 🌌 **3D WebGL Command Bridge (`space3d.js`):** Interactive 24-node cluster matrix powered by Three.js with UnrealBloom post-processing glow, sinusoidal node bobbing, packet flow streams, and camera inertia.
- 🤖 **Multi-Agent SRE Intelligence (`server.py` & `server.js`):** Directed state-graph SRE playbooks featuring 4 specialized AI agents:
  - **Sentry-01 (Monitoring Agent):** Detects telemetry anomalies and traffic spikes.
  - **Vanguard-01 (Security Agent):** Audits vulnerabilities, DDoS attacks, and compliance guardrails.
  - **Tecton-01 (Auto-Scaler Agent):** Manages dynamic cluster node capacity and cost optimization.
  - **Orchestrator-Core:** Coordinates multi-agent workflows and enforces HITL authorization gates.
- 🔐 **Human-In-The-Loop (HITL) Authorization Gate:** Multi-agent autonomous remediation proposals require explicit human PIN approval (`ADMIN_PIN`) before any destructive or costly cluster mutation occurs (e.g. node drain, restart, scaling).
- 📊 **Prometheus & Health Observability:** Endpoints `/api/health` and `/metrics` export real-time cluster status, active nodes, network latency, throughput, monthly cost, and SSE client counts.
- 🔊 **Spatial Audio Synthesizer:** Native WebAudio API spatial panners render 3D acoustic pings and anomaly alert sirens synced to the 3D camera matrix.

---

## 🏗️ Tech Stack

| Layer | Component | Description |
| :--- | :--- | :--- |
| **Frontend UI** | HTML5 / Vanilla CSS | Glassmorphic dark design system with Orbitron typography and micro-interactions |
| **3D Rendering** | Three.js (r128+) | WebGL visualizer with UnrealBloomPass and raycaster hover tooltips |
| **Gateway Server** | Node.js / Express (5.2.1) | Non-blocking SSE streaming server, rate limiting, and PIN auth gate |
| **AI Workflows** | FastAPI / LangGraph | State-machine multi-agent framework powered by Google Gemini |
| **Observability** | Prometheus / JSON Health | Standard `/metrics` exporter and `/api/health` probes |

---

## 🚀 Quick Start

### 1. Prerequisites
- **Node.js:** v18.x or higher
- **Python:** 3.10 or higher (for LangGraph AI backend)

### 2. Installation
Clone the repository and install dependencies:
```bash
git clone https://github.com/Tejas3479/helix.git
cd helix
npm install
pip install -r requirements.txt
```

### 3. Environment Setup (Optional)
Set the Admin Authorization PIN and optional Gemini AI API key (defaults to `gemini-3.6-flash` model):
```bash
# Windows PowerShell
$env:ADMIN_PIN="1234"
$env:GEMINI_API_KEY="your-gemini-api-key"
$env:GEMINI_MODEL="gemini-3.6-flash" # or gemini-3.5-flash-lite

# Bash / Linux / macOS
export ADMIN_PIN="1234"
export GEMINI_API_KEY="your-gemini-api-key"
export GEMINI_MODEL="gemini-3.6-flash" # or gemini-3.5-flash-lite
```

### 4. Running the Server

#### Option A: Node.js Express Gateway
```bash
npm start
# Server runs at http://localhost:8080
```

#### Option B: Python FastAPI LangGraph Backend
```bash
python server.py
# Server runs at http://localhost:8080
```

---

## 📡 API Reference

### Health & Metrics
- **`GET /api/health`**: Returns JSON readiness status, node count, and uptime.
- **`GET /metrics`**: Exports Prometheus-formatted gauges (`helix_system_status`, `helix_active_nodes`, `helix_latency_ms`, `helix_throughput_req_sec`, `helix_monthly_cost_usd`).

### Real-Time Streaming & Control
- **`GET /api/stream`**: SSE endpoint broadcasting cluster state changes and agent chat traces.
- **`POST /api/command`**: Submit natural language prompt commands to Orchestrator.
- **`POST /api/incident`**: Trigger incident simulations (`ddos`, `db`, `cost`).
- **`POST /api/approve`**: Submit HITL approval/denial decision (`{ "approved": true }`).
- **`POST /api/tuner`**: Update cluster capacity, execution speed, and budget limits.

---

## 📄 License
This project is licensed under the [ISC License](LICENSE).
