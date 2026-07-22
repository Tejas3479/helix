import os
import json
import asyncio
import time
import random
from typing import List, Dict, Any, Optional, Union, TypedDict
from fastapi import FastAPI, Request, Response, HTTPException, status, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, FileResponse, JSONResponse
from sse_starlette.sse import EventSourceResponse
from pydantic import BaseModel

import psutil
import httpx

# Import LangChain / LangGraph components
from langgraph.graph import StateGraph, END
from langgraph.checkpoint.memory import MemorySaver
from langchain_google_genai import ChatGoogleGenerativeAI

try:
    import networkx as nx
except ImportError:
    nx = None

app = FastAPI(title="Helix Quantum - SRE Command Center Backend")

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Content Security Policy & Security Headers Middleware
@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["Content-Security-Policy"] = (
        "default-src 'self' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://fonts.googleapis.com https://fonts.gstatic.com; "
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
        "img-src 'self' data:; media-src 'self' data:; connect-src 'self';"
    )
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response

# Rate Limiting: 1 request per second per IP
request_limits = {}

# Try to initialize Redis connection
redis_client = None
try:
    import redis
    redis_client = redis.Redis(host='localhost', port=6379, db=0, socket_timeout=1.0, decode_responses=True)
    redis_client.ping()
    print("[REDIS] Connected successfully to redis://localhost:6379")
except (ImportError, Exception) as e:
    redis_client = None
    print(f"[REDIS] Bypassed (offline/fallback active): {e}")

def check_rate_limit(request: Request):
    client_ip = request.client.host
    now = time.time()
    
    if redis_client:
        try:
            key = f"rate:{client_ip}"
            last_time_str = redis_client.get(key)
            if last_time_str and (now - float(last_time_str)) < 1.0:
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail="Too many requests. Please wait."
                )
            redis_client.setex(key, 10, str(now))
            return
        except HTTPException:
            raise
        except Exception as e:
            print(f"[REDIS] Rate limiter fallback to in-memory: {e}")
            
    # Cleanup expired rate limit entries to prevent memory leak
    expired_ips = [ip for ip, last_time in request_limits.items() if now - last_time > 10.0]
    for ip in expired_ips:
        del request_limits[ip]

    if client_ip in request_limits and (now - request_limits[client_ip]) < 1.0:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many requests. Please wait."
        )
    request_limits[client_ip] = now

# Authentication Dynamic Token Store
active_tokens = {} # token -> expiry timestamp

# Authentication PIN Gate Check
def check_auth_gate(request: Request):
    if request.method == "GET" and request.url.path != "/api/history":
        return
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unauthorized: Invalid Admin PIN"
        )
    token = auth_header[7:]
    
    # Validate against expected admin PIN directly (used by frontend client as token)
    expected_pin = os.environ.get("ADMIN_PIN", "1234")
    if token == expected_pin:
        return
        
    now = time.time()
    
    if redis_client:
        try:
            key = f"token:{token}"
            expiry = redis_client.get(key)
            if expiry and float(expiry) >= now:
                return
            if expiry:
                redis_client.delete(key)
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Unauthorized: Session Expired or Invalid PIN"
            )
        except HTTPException:
            raise
        except Exception as e:
            print(f"[REDIS] Auth check fallback to in-memory: {e}")

    if token not in active_tokens or active_tokens[token] < now:
        if token in active_tokens:
            del active_tokens[token]
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unauthorized: Session Expired or Invalid PIN"
        )

# State Storage Configuration
STATE_FILE = "state.json"

# Global System State
system_state = {
    "status": "nominal", # nominal, anomaly, resolving
    "nodes": 24,
    "latency": 48,
    "throughput": 1250,
    "activeIncident": None,
    "cost": 2500,
    "waitingApproval": False,
    "approvalDetails": None,
    "activeNode": None,
    "speed": 1.0,
    "costLimit": 2500,
    "blastRadius": [],
    "nodeMetrics": []
}

incident_history = []

def load_state():
    global system_state, incident_history
    if os.path.exists(STATE_FILE):
        try:
            with open(STATE_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                system_state.update(data.get("systemState", {}))
                # Reset ephemeral locks on startup
                system_state["waitingApproval"] = False
                system_state["approvalDetails"] = None
                incident_history = data.get("incidentHistory", [])
        except Exception as e:
            print(f"Failed to load state: {e}")

def save_state():
    try:
        with open(STATE_FILE, "w", encoding="utf-8") as f:
            json.dump({"systemState": system_state, "incidentHistory": incident_history}, f, indent=2)
    except Exception as e:
        print(f"Failed to save state: {e}")

# Load persisted states
load_state()

# SSE Active Listeners
sse_listeners: List[asyncio.Queue] = []

def broadcast_event(event_type: str, payload: dict):
    if event_type == "state":
        save_state()
    
    event_data = json.dumps({"type": event_type, **payload})
    for queue in sse_listeners:
        queue.put_nowait(event_data)

# SRE Incident Playbook Pause Callbacks (Scoped registry)
active_thread_ids: Dict[str, str] = {}

def log_incident_start(incident_type: str):
    # Abort currently active logs
    for item in incident_history:
        if item.get("status") == "active":
            item["status"] = "aborted"
            item["resolvedAt"] = datetime_now()

    incident_history.append({
        "id": int(time.time() * 1000),
        "type": incident_type,
        "timestamp": datetime_now(),
        "status": "active",
        "actionApproved": None
    })
    save_state()

def log_incident_resolve(incident_type: str, approved: bool):
    for item in incident_history:
        if item.get("type") == incident_type and item.get("status") == "active":
            item["status"] = "resolved"
            item["actionApproved"] = approved
            item["resolvedAt"] = datetime_now()
            break
    save_state()

def datetime_now():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

# SRE Telemetry & Orchestration Helpers
PROMETHEUS_URL = "http://prometheus-k8s:9090"

async def query_prometheus(query: str) -> Optional[float]:
    try:
        async with httpx.AsyncClient(timeout=0.5) as client:
            response = await client.get(f"{PROMETHEUS_URL}/api/v1/query", params={"query": query})
            if response.status_code == 200:
                data = response.json()
                results = data.get("data", {}).get("result", [])
                if results:
                    return float(results[0].get("value", [0, 0])[1])
    except Exception:
        pass
    return None

async def query_prometheus_range(query: str, start: int, end: int, step: int) -> Optional[List[List[Any]]]:
    try:
        async with httpx.AsyncClient(timeout=0.8) as client:
            response = await client.get(
                f"{PROMETHEUS_URL}/api/v1/query_range",
                params={"query": query, "start": start, "end": end, "step": step}
            )
            if response.status_code == 200:
                data = response.json()
                result = data.get("data", {}).get("result", [])
                if result:
                    values = result[0].get("values", [])
                    return [[int(v[0]), float(v[1])] for v in values]
    except Exception:
        pass
    return None

def scale_k8s_deployment(replicas: int):
    try:
        from kubernetes import client, config
        try:
            config.load_incluster_config()
        except Exception:
            config.load_kube_config()
        k8s_api = client.AppsV1Api()
        k8s_api.patch_namespaced_deployment_scale(
            name="helix-web-deployment", namespace="default", body={"spec": {"replicas": replicas}}
        )
        print(f"[K8s] Successfully patched deployment scale to {replicas} replicas.")
    except Exception as e:
        print(f"[K8s] Scaling command bypassed (offline / fallback active): {e}")

async def periodic_telemetry_generator():
    while True:
        try:
            # 1. Query live Prometheus parameters if active
            prometheus_cpu = await query_prometheus('sum(rate(container_cpu_usage_seconds_total{namespace="default"}[5m]))')
            prometheus_tput = await query_prometheus('sum(rate(http_requests_total[5m]))')
            
            # 2. Local offline system telemetry fallback (psutil)
            local_cpu = psutil.cpu_percent()
            local_mem = psutil.virtual_memory().percent
            
            is_anomaly = system_state["status"] == "anomaly"
            active_inc = system_state["activeIncident"]
            active_nodes = system_state["nodes"]
            
            # Throughput
            if prometheus_tput is not None:
                system_state["throughput"] = int(prometheus_tput)
            else:
                if is_anomaly and active_inc == "ddos":
                    system_state["throughput"] = 18450 + int(local_cpu * 10)
                else:
                    system_state["throughput"] = 1200 + int(local_cpu * 5)
            
            # Latency
            if is_anomaly:
                if active_inc == "ddos":
                    system_state["latency"] = 540 + int(local_cpu)
                elif active_inc == "db":
                    system_state["latency"] = 380 + int(local_cpu)
            else:
                system_state["latency"] = 40 + int(local_cpu * 0.5)
                
            # Dynamic metrics for all 48 nodes
            node_metrics_list = []
            for idx in range(48):
                if idx >= active_nodes:
                    node_metrics_list.append({
                        "idx": idx,
                        "cpu": 0,
                        "mem": 0,
                        "status": "offline"
                    })
                    continue
                
                node_cpu = local_cpu
                node_mem = local_mem
                node_status = "healthy"
                
                if is_anomaly:
                    if active_inc == "ddos" and idx < 12:
                        node_cpu = max(92, min(99, int(92 + (idx % 8))))
                        node_mem = max(85, min(95, int(85 + (idx % 10))))
                        node_status = "overloaded"
                    elif active_inc == "db" and idx == 21:
                        node_cpu = 100
                        node_mem = 98
                        node_status = "critical"
                else:
                    node_cpu = max(5, min(95, int(local_cpu + (idx % 15) - 7)))
                    node_mem = max(10, min(95, int(local_mem + (idx % 20) - 10)))
                    
                node_metrics_list.append({
                    "idx": idx,
                    "cpu": int(node_cpu),
                    "mem": int(node_mem),
                    "status": node_status
                })
                
            system_state["nodeMetrics"] = node_metrics_list
            
            # Synchronize costs dynamically
            if active_nodes == 48:
                system_state["cost"] = 5000
            elif active_nodes == 16:
                system_state["cost"] = 1700
            else:
                system_state["cost"] = 2500
                
            broadcast_event("state", {"state": system_state})
        except Exception as e:
            print(f"Error in telemetry generator task: {e}")
            
        await asyncio.sleep(2.0)

@app.on_event("startup")
async def startup_event():
    asyncio.create_task(periodic_telemetry_generator())

# SERVICE TOPOLOGY DAG DEFINITION
SERVICE_DAG = {
    # Ingress Gateways -> API Router
    0: [4], 1: [4], 2: [4], 3: [4],
    # API Router -> Microservices
    4: list(range(5, 21)) + list(range(29, 48)),
    # Microservices -> DB / Caches
    5: [22],  # auth -> redis cache
    6: [21],  # payment -> postgres
    7: [21],  # billing -> postgres
    8: [23],  # search -> mongodb
    9: [24],  # rabbitmq -> rabbitmq replica
    10: [22], # vault -> redis cache
    11: [21], # jaeger -> postgres
    12: [23], # prometheus -> mongodb
    13: [22], # grafana -> redis cache
    14: [22], # dns -> redis cache
    15: [24], # api-router-backup -> standby db
    16: [24], # rabbitmq standby -> standby db
    17: [21], # fluentd -> postgres
    18: [23], # sentry -> mongodb
    19: [22], # vault backup -> redis cache
    20: [21], # pod-scaler -> postgres
}

# DB Primaries -> DB Replicas
for d in range(25, 29):
    SERVICE_DAG[d-4] = [d]

# Scale Compute Nodes -> Replicas
for m in range(29, 48):
    SERVICE_DAG[m] = [25 + (m % 4)]

def calculate_blast_radius(failed_node: int) -> List[int]:
    if nx:
        try:
            G = nx.DiGraph()
            for parent, children in SERVICE_DAG.items():
                for child in children:
                    G.add_edge(parent, child)
            # Upstream microservices that depend on failed_node are its ancestors
            affected = nx.ancestors(G, failed_node)
            return sorted(list(affected))
        except Exception as e:
            print(f"[Causal AI] networkx ancestors query failed: {e}. Falling back.")
            
    inverse_dag = {}
    for parent, children in SERVICE_DAG.items():
        for child in children:
            if child not in inverse_dag:
                inverse_dag[child] = []
            inverse_dag[child].append(parent)
            
    affected = set()
    queue = [failed_node]
    while queue:
        curr = queue.pop(0)
        parents = inverse_dag.get(curr, [])
        for p in parents:
            if p not in affected:
                affected.add(p)
                queue.append(p)
    return sorted(list(affected))

def calculate_shortest_propagation_path(source: int, target: int) -> List[int]:
    if nx:
        try:
            G = nx.DiGraph()
            for parent, children in SERVICE_DAG.items():
                for child in children:
                    G.add_edge(parent, child)
            return nx.shortest_path(G, source=source, target=target)
        except Exception as e:
            print(f"[Causal AI] networkx shortest_path failed: {e}. Falling back.")
            
    queue = [[source]]
    visited = {source}
    while queue:
        path = queue.pop(0)
        node = path[-1]
        if node == target:
            return path
        for child in SERVICE_DAG.get(node, []):
            if child not in visited:
                visited.add(child)
                new_path = list(path)
                new_path.append(child)
                queue.append(new_path)
    return []

def calculate_linear_forecast(coordinates: List[List[Union[int, float]]], future_points: int = 10) -> List[List[Union[int, float]]]:
    if not coordinates or len(coordinates) < 2:
        return []
    n = len(coordinates)
    x = [float(pt[0]) for pt in coordinates]
    y = [float(pt[1]) for pt in coordinates]
    sum_x = sum(x)
    sum_y = sum(y)
    sum_xy = sum(x[i] * y[i] for i in range(n))
    sum_x_sq = sum(val * val for val in x)
    denominator = (n * sum_x_sq - sum_x * sum_x)
    if denominator == 0:
        slope = 0.0
        intercept = sum_y / n
    else:
        slope = (n * sum_xy - sum_x * sum_y) / denominator
        intercept = (sum_y - slope * sum_x) / n
    last_t = coordinates[-1][0]
    step = (x[1] - x[0]) if n > 1 else 30
    forecast = []
    for i in range(1, future_points + 1):
        future_t = last_t + i * step
        future_v = slope * future_t + intercept
        # Clamp appropriately depending on expected metric ranges
        future_v = max(0.0, future_v)
        forecast.append([int(future_t), round(future_v, 2)])
    return forecast

# SRE Diagnostic & Remediation Tools
from langchain_core.tools import tool

@tool
def query_k8s_logs(pod_name: str) -> str:
    """Query Kubernetes stdout logs for a specific pod name to look for exceptions or stack traces."""
    try:
        from kubernetes import client, config
        try:
            config.load_incluster_config()
        except Exception:
            config.load_kube_config()
        v1 = client.CoreV1Api()
        pods = v1.list_namespaced_pod(namespace="default")
        target_pod = None
        for pod in pods.items:
            if pod_name in pod.metadata.name:
                target_pod = pod.metadata.name
                break
        if target_pod:
            logs = v1.read_namespaced_pod_log(name=target_pod, namespace="default", tail_lines=50)
            return logs
    except Exception as e:
        print(f"[K8s Logs] live query bypassed: {e}")
    
    is_anomaly = system_state["status"] == "anomaly"
    active_inc = system_state["activeIncident"]
    if is_anomaly:
        if active_inc == "ddos" and ("ingress" in pod_name or "gateway" in pod_name or "auth" in pod_name):
            return "[ERROR] Ingress flood. HttpRequestsOverflow: 18,450 req/s. TCP connection queue full. Connection pool exhausted."
        elif active_inc == "db" and ("postgres" in pod_name or "db" in pod_name):
            return "[CRITICAL] postgres-primary-db write lock timeout. IOPS: 0. ConnectionPoolExhausted: Active connections = 500/500."
    return f"[INFO] Log stdout normal for pod {pod_name}. Service listening on port 8080. Zero errors."

@tool
def fetch_prometheus_metrics(metric: str, node_idx: int) -> dict:
    """Fetch Prometheus telemetry metrics (cpu, memory, latency) for a specific node index."""
    is_anomaly = system_state["status"] == "anomaly"
    active_inc = system_state["activeIncident"]
    
    cpu = random.randint(15, 45)
    mem = random.randint(30, 60)
    latency = random.uniform(1.5, 3.5)
    
    if is_anomaly:
        if active_inc == "ddos" and node_idx < 12:
            cpu = random.randint(92, 99)
            mem = random.randint(85, 95)
            latency = random.uniform(500, 600)
        elif active_inc == "db" and node_idx == 21:
            cpu = 100
            mem = 98
            latency = 30000.0  # Timeout
            
    return {"cpu": f"{cpu}%", "memory": f"{mem}%", "latency": f"{latency:.2f}ms"}

@tool
def reboot_pod(node_idx: int) -> str:
    """Reboot a container pod node by its index to clear locks or memory pressure."""
    try:
        from kubernetes import client, config
        try:
            config.load_incluster_config()
        except Exception:
            config.load_kube_config()
        v1 = client.CoreV1Api()
        pods = v1.list_namespaced_pod(namespace="default")
        target_pod = None
        for pod in pods.items:
            if f"node-{node_idx}" in pod.metadata.name:
                target_pod = pod.metadata.name
                break
        if target_pod:
            v1.delete_namespaced_pod(name=target_pod, namespace="default")
            return f"[SUCCESS] Deleted pod {target_pod} in default namespace. K8s will spin up a replica."
    except Exception as e:
        print(f"[K8s Reboot] live reboot bypassed: {e}")
    
    return f"[SUCCESS] Container node-{node_idx} rebooted successfully."

@tool
def apply_rate_limit(rate: int) -> str:
    """Deploy edge Ingress rate-limiting rules at a specified rate (req/s per IP)."""
    return f"[SUCCESS] Edge Ingress rate-limiting deployed at {rate} req/s per IP. Ingress traffic filtered."

# Keep original function hooks for backward compatibility
def tool_inspect_metrics(node_idx: int) -> dict:
    return fetch_prometheus_metrics.invoke({"metric": "cpu", "node_idx": node_idx})

def tool_inspect_logs(node_idx: int) -> str:
    return query_k8s_logs.invoke({"pod_name": f"node-{node_idx}"})

def tool_apply_rate_limit(rate: int) -> str:
    return apply_rate_limit.invoke({"rate": rate})

def tool_restart_pod(node_idx: int) -> str:
    return reboot_pod.invoke({"node_idx": node_idx})


# Define graph state definition for LangGraph SRE workflow
class SreGraphState(TypedDict):
    messages: List[Dict[str, str]]
    status: str
    nodes: int
    latency: int
    throughput: int
    cost: int
    active_incident: Optional[str]
    waiting_approval: bool
    approval_details: Optional[Dict[str, str]]
    user_input: Optional[str]
    step: int
    active_node: Optional[str]
    replanned: bool

# Helper function for Gemini calls with timeout & async-safe execution
async def call_gemini(llm, messages, timeout=8.0, tools=None):
    try:
        if tools:
            llm_with_tools = llm.bind_tools(tools)
            response = await asyncio.wait_for(
                asyncio.to_thread(llm_with_tools.invoke, messages),
                timeout=timeout
            )
        else:
            response = await asyncio.wait_for(
                asyncio.to_thread(llm.invoke, messages),
                timeout=timeout
            )
        return response
    except asyncio.TimeoutError:
        print("[GEMINI] API call timed out.")
        raise
    except Exception as e:
        print(f"[GEMINI] API call failed: {e}")
        raise

# Define graph node functions (as async def to support non-blocking execution)
async def entry_node(state: SreGraphState) -> SreGraphState:
    state["step"] = 1
    state["active_node"] = "detect"
    state["replanned"] = False
    global system_state
    system_state["activeNode"] = "detect"
    broadcast_event("state", {"state": system_state})
    await asyncio.sleep(1.2)
    return state

async def audit_node(state: SreGraphState) -> SreGraphState:
    global system_state
    state["active_node"] = "triage"
    system_state["activeNode"] = "triage"
    broadcast_event("state", {"state": system_state})
    await asyncio.sleep(1.2)
    
    state["active_node"] = "rca"
    system_state["activeNode"] = "rca"
    broadcast_event("state", {"state": system_state})
    await asyncio.sleep(1.2)
    
    inc_type = state["active_incident"]
    failed_node = 0 if inc_type == "ddos" else 21
    system_state["blastRadius"] = calculate_blast_radius(failed_node)
    broadcast_event("state", {"state": system_state})
    
    gemini_key = os.environ.get("GEMINI_API_KEY")
    if gemini_key:
        try:
            llm = ChatGoogleGenerativeAI(model="gemini-1.5-flash", google_api_key=gemini_key, temperature=0.0)
            
            # 1. Sentry Agent ReAct Loop for RCA
            diagnostic_tools = [query_k8s_logs, fetch_prometheus_metrics]
            tools_map = {t.name: t for t in diagnostic_tools}
            
            messages = [
                {"role": "system", "content": "You are Sentry SRE Agent. Your job is to diagnose the incident by calling fetch_prometheus_metrics and query_k8s_logs, then output a technical alert starting with '[ALERT]' or '[CRITICAL]'."},
                {"role": "user", "content": f"Incident: {inc_type}. Affected node: {failed_node}. Call tools to check metrics and logs, analyze, and output summary."}
            ]
            
            for iter in range(3):
                response = await call_gemini(llm, messages, tools=diagnostic_tools)
                if response.tool_calls:
                    messages.append(response)
                    for tool_call in response.tool_calls:
                        name = tool_call["name"]
                        args = tool_call["args"]
                        tool_func = tools_map.get(name)
                        if tool_func:
                            broadcast_event("chat", {"agent": "Sentry", "text": f"[TOOL_CALL] Querying {name} with args {args}"})
                            res = tool_func.invoke(args)
                            broadcast_event("chat", {"agent": "Sentry", "text": f"[TOOL_RESPONSE] {name} output: {res}"})
                            messages.append({
                                "role": "tool",
                                "name": name,
                                "tool_call_id": tool_call["id"],
                                "content": str(res)
                            })
                else:
                    summary_text = response.content.strip()
                    broadcast_event("chat", {"agent": "Sentry", "text": summary_text})
                    break
            else:
                summary_text = "[ALERT] Diagnosis completed. Node metrics and logs show active anomalies."
                broadcast_event("chat", {"agent": "Sentry", "text": summary_text})
                
            # 2. Orchestrator SRE Agent Action Planning
            orch_messages = [
                {"role": "system", "content": "You are Orchestrator SRE Agent. Read the diagnosis and give a short command instruction to Tecton to resolve the issue."},
                {"role": "user", "content": f"Diagnosis: {summary_text}"}
            ]
            response2 = await call_gemini(llm, orch_messages)
            broadcast_event("chat", {"agent": "Orchestrator", "text": response2.content.strip()})
            
            # 3. Vanguard Security Verification
            security_logs = query_k8s_logs.invoke({"pod_name": f"gateway-{failed_node}"})
            vanguard_messages = [
                {"role": "system", "content": "You are Vanguard Security Agent. Inspect these logs and summarize security audit starting with '[SECURITY]'."},
                {"role": "user", "content": f"Logs: {security_logs}"}
            ]
            response3 = await call_gemini(llm, vanguard_messages)
            broadcast_event("chat", {"agent": "Vanguard", "text": response3.content.strip()})
            
            if inc_type == "ddos":
                state["status"] = "anomaly"
                state["latency"] = 540
                state["throughput"] = 18450
            elif inc_type == "db":
                state["status"] = "anomaly"
                state["latency"] = 380
            elif inc_type == "cost":
                state["status"] = "resolving"
            return state
        except Exception as e:
            print(f"Gemini dynamic ReAct diagnosis failed: {e}. Falling back to rule-based.")
            
    # Local Rule-based Fallback
    if inc_type == "ddos":
        state["status"] = "anomaly"
        state["latency"] = 540
        state["throughput"] = 18450
        broadcast_event("chat", {
            "agent": "Sentry",
            "text": "[ALERT] Ingress DDoS breach detected! Latency spiked to 540ms. Payload rate: 18,450 req/s. Traffic flood zone: EU-WEST-1."
        })
        broadcast_event("chat", {
            "agent": "Orchestrator",
            "text": "[COMMAND] Alert confirmed. Vanguard-01, deploy packet isolation. Tecton-01, prepare cluster scaling limits."
        })
        broadcast_event("chat", {
            "agent": "Vanguard",
            "text": "[SECURITY] Botnet payload traced. Deploying Cloudflare Ingress IP Block. Filtering 4,200 malicious IPs."
        })
    elif inc_type == "db":
        state["status"] = "anomaly"
        state["latency"] = 380
        broadcast_event("chat", {
            "agent": "Sentry",
            "text": "[CRITICAL] Database write timeout on primary node \"postgres-primary-db\". Replication synchronization: Broken. IOPS flatlined."
        })
        broadcast_event("chat", {
            "agent": "Orchestrator",
            "text": "[COMMAND] Confirm database status. Tecton-01, isolate node \"postgres-primary-db\" and promote Standby \"postgres-standby-db\" to Master."
        })
    elif inc_type == "cost":
        state["status"] = "resolving"
        broadcast_event("chat", {
            "agent": "Orchestrator",
            "text": "[AUDIT] Budget threshold set to $2,500. Currently projected: $3,200. Cost optimization needed. Sentry, audit resource utilisation."
        })
        broadcast_event("chat", {
            "agent": "Sentry",
            "text": "[MONITOR] Auditing cluster metrics. 8/24 container nodes are in \"idle\" state. CPU load averages 8.4%. Memory usage: 14.5%."
        })
    return state

async def proposal_node(state: SreGraphState) -> SreGraphState:
    global system_state
    state["active_node"] = "proposal"
    system_state["activeNode"] = "proposal"
    broadcast_event("state", {"state": system_state})
    await asyncio.sleep(1.2)
    
    inc_type = state["active_incident"]
    state["waiting_approval"] = True
    
    if inc_type == "ddos":
        state["approval_details"] = {
            "agent": "Tecton-01 (Autoscaling)",
            "action": "Scale Kubernetes node capacity 24 -> 48 hosts (+100% cost scale)",
            "source": "DDoS Traffic Infiltration"
        }
        broadcast_event("chat", {
            "agent": "Tecton",
            "text": "[AUTOSCALE] Scaling node limit is required to load-balance traffic. Proposing: Scale 24 -> 48 hosts (+50% capacity)."
        })
    elif inc_type == "db":
        state["approval_details"] = {
            "agent": "Tecton-01 (Ops Controller)",
            "action": "Isolate db-master-01 & Promote db-replica-01 to Master (Standby promotion)",
            "source": "Database IOPS Flatline"
        }
    elif inc_type == "cost":
        state["approval_details"] = {
            "agent": "Tecton-01 (Ops Controller)",
            "action": "Deprovision 8 idle hosts Node-17 to Node-24 (Reduce projected cost: $2,500 -> $1,700)",
            "source": "Routine Cost Audit"
        }
    
    state["active_node"] = "hitl"
    return state

async def mitigate_node(state: SreGraphState) -> SreGraphState:
    global system_state
    state["active_node"] = "remediate"
    system_state["activeNode"] = "remediate"
    broadcast_event("state", {"state": system_state})
    await asyncio.sleep(1.2)
    
    user_input = state.get("user_input")
    inc_type = state["active_incident"]
    
    state["waiting_approval"] = False
    state["approval_details"] = None
    
    is_alternative = state.get("replanned", False)
    
    if user_input == "approve":
        # Mitigation execution using SRE tools
        gemini_key = os.environ.get("GEMINI_API_KEY")
        if gemini_key:
            try:
                llm = ChatGoogleGenerativeAI(model="gemini-1.5-flash", google_api_key=gemini_key, temperature=0.0)
                mitigation_tools = [reboot_pod, apply_rate_limit]
                tools_map = {t.name: t for t in mitigation_tools}
                
                mitigation_cmd = ""
                if inc_type == "ddos":
                    mitigation_cmd = "Apply rate limiting of 500 req/s to edge ingress" if is_alternative else "Scale deployment nodes to 48"
                elif inc_type == "db":
                    mitigation_cmd = "Reboot pod at node 21" if is_alternative else "Reboot database node 21 and check replication"
                elif inc_type == "cost":
                    mitigation_cmd = "deprovision idle containers Node 17 to 24"
                
                messages = [
                    {"role": "system", "content": "You are SRE Mitigation Agent. You execute recommended playbook remediations by invoking reboot_pod, apply_rate_limit, or scaling deployments."},
                    {"role": "user", "content": f"Mitigation Action requested: '{mitigation_cmd}'. Run the appropriate tools and output the execution logs."}
                ]
                
                response = await call_gemini(llm, messages, tools=mitigation_tools)
                if response.tool_calls:
                    for tool_call in response.tool_calls:
                        name = tool_call["name"]
                        args = tool_call["args"]
                        tool_func = tools_map.get(name)
                        if tool_func:
                            broadcast_event("chat", {"agent": "Tecton", "text": f"[MITIGATION_RUN] Invoking tool {name}"})
                            res = tool_func.invoke(args)
                            broadcast_event("chat", {"agent": "Tecton", "text": f"[MITIGATION_SUCCESS] {res}"})
            except Exception as e:
                print(f"Gemini mitigation run failed: {e}")
                
        # Update metrics states
        if inc_type == "ddos":
            if is_alternative:
                state["nodes"] = 24
                state["cost"] = 2500
                state["status"] = "resolving"
                state["latency"] = 180
                scale_k8s_deployment(24)
                broadcast_event("chat", {
                    "agent": "Vanguard",
                    "text": "[SECURITY] Edge Ingress Rate-Limiting deployed. DDoS traffic isolated. CPU load stabilizing. Latency: 180ms."
                })
            else:
                state["nodes"] = 48
                state["cost"] = 5000
                state["status"] = "resolving"
                state["latency"] = 120
                scale_k8s_deployment(48)
                broadcast_event("chat", {
                    "agent": "Tecton",
                    "text": "[SCALING] Scaling node limit to accommodate load. Adjusting parameters: 24 -> 48 hosts active. Spin-up complete."
                })
                broadcast_event("chat", {
                    "agent": "Sentry",
                    "text": "[MONITOR] Traffic stabilization reported. Latency dropping to 120ms. Ingress payload filtered."
                })
        elif inc_type == "db":
            if is_alternative:
                state["nodes"] = 24
                state["status"] = "resolving"
                state["latency"] = 95
                scale_k8s_deployment(24)
                broadcast_event("chat", {
                    "agent": "Tecton",
                    "text": "[OPS] Restarted 'db-master-01' container service. Resetting connection pools. Client lockouts cleared. Latency: 95ms."
                })
            else:
                state["nodes"] = 23
                scale_k8s_deployment(23)
                broadcast_event("chat", {
                    "agent": "Tecton",
                    "text": "[OPS] Fencing compromised \"db-master-01\" container. Running master promotion scripting on \"db-replica-01\". Connection strings re-routed."
                })
                broadcast_event("chat", {
                    "agent": "Vanguard",
                    "text": "[SECURITY] Audited new database connection string. Standby credentials verified. Data integrity verification: 100% OK."
                })
                state["status"] = "resolving"
                state["latency"] = 95
                state["nodes"] = 24
                scale_k8s_deployment(24)
        elif inc_type == "cost":
            if is_alternative:
                state["nodes"] = 24
                state["cost"] = 2000
                state["status"] = "nominal"
                scale_k8s_deployment(24)
                broadcast_event("chat", {
                    "agent": "Tecton",
                    "text": "[OPS] Optimized CPU limit values across all pods (-20% margin). Projected cost down to $2,000/mo."
                })
            else:
                state["nodes"] = 16
                scale_k8s_deployment(16)
                broadcast_event("chat", {
                    "agent": "Tecton",
                    "text": "[OPS] Shutting down idle hosts Node-17 to Node-24. Scale-down sequence deployed. Deprovisioning containers."
                })
                broadcast_event("chat", {
                    "agent": "Sentry",
                    "text": "[MONITOR] Scale-down verified. 16/16 remaining containers stable. CPU load balanced at 46.2%. Output nominal."
                })
                state["status"] = "nominal"
    else:
        # Operator denied! Check if we can offer an alternative replanning proposal
        if not state.get("replanned", False):
            state["replanned"] = True
            state["waiting_approval"] = True
            
            if inc_type == "ddos":
                state["approval_details"] = {
                    "agent": "Vanguard-01 (Security)",
                    "action": "Deploy Ingress Rate-Limiting rules to 500 req/s per IP (+0% cost scale)",
                    "source": "Autoscaling Denied"
                }
                broadcast_event("chat", {
                    "agent": "Orchestrator",
                    "text": "[WARN] Autoscaling proposal denied by operator. Deploying adaptive replanning..."
                })
                broadcast_event("chat", {
                    "agent": "Vanguard",
                    "text": "[REPLAN] Re-evaluating threat. Proposing fallback: Deploy edge Ingress Rate-Limiting rules to 500 req/s per IP."
                })
            elif inc_type == "db":
                state["approval_details"] = {
                    "agent": "Tecton-01 (Ops Controller)",
                    "action": "Restart primary database container db-master-01 (+0ms failover lag)",
                    "source": "Failover Denied"
                }
                broadcast_event("chat", {
                    "agent": "Orchestrator",
                    "text": "[WARN] Database failover proposal denied by operator. Deploying adaptive replanning..."
                })
                broadcast_event("chat", {
                    "agent": "Tecton",
                    "text": "[REPLAN] Proposing alternative runbook: Restart primary database container db-master-01 and clear thread locks."
                })
            elif inc_type == "cost":
                state["approval_details"] = {
                    "agent": "Tecton-01 (Ops Controller)",
                    "action": "Optimize CPU limits for all workloads, resizing limits by -20% (+15% packing efficiency)",
                    "source": "Deprovisioning Denied"
                }
                broadcast_event("chat", {
                    "agent": "Orchestrator",
                    "text": "[WARN] Host shutdown proposal denied by operator. Deploying adaptive replanning..."
                })
                broadcast_event("chat", {
                    "agent": "Tecton",
                    "text": "[REPLAN] Proposing alternative runbook: Rescale and optimize CPU limits for all container workloads (-20% limit adjustment)."
                })
            
            state["active_node"] = "hitl"
        else:
            state["waiting_approval"] = False
            state["approval_details"] = None
            
            if inc_type == "ddos":
                broadcast_event("chat", {
                    "agent": "Sentry",
                    "text": "[CRITICAL] Alternative rate-limiting denied. DDoS threat active. Ingress capacity overloaded."
                })
            elif inc_type == "db":
                broadcast_event("chat", {
                    "agent": "Sentry",
                    "text": "[CRITICAL] Database restart denied. System remains offline. Database synchronization: FAILED."
                })
            elif inc_type == "cost":
                broadcast_event("chat", {
                    "agent": "Orchestrator",
                    "text": "[AUDIT] Resizing denied. Budget target exceeded. Projected cost remains $3,200/mo."
                })
            state["status"] = "anomaly"
            
    return state

async def exit_node(state: SreGraphState) -> SreGraphState:
    global system_state
    state["active_node"] = "exit"
    system_state["activeNode"] = "exit"
    broadcast_event("state", {"state": system_state})
    await asyncio.sleep(1.2)
    
    user_input = state.get("user_input")
    inc_type = state["active_incident"]
    is_alternative = state.get("replanned", False)
    
    if user_input == "approve":
        scale_k8s_deployment(state.get("nodes", 24))
        if inc_type == "ddos":
            state["status"] = "nominal"
            state["latency"] = 48
            state["throughput"] = 1250
            state["nodes"] = 24
            state["cost"] = 2500
            broadcast_event("chat", {
                "agent": "Orchestrator",
                "text": "[COMMAND] System state healing. Vanguard, lock filter profiles. Tecton, verify container replication pools."
            })
            broadcast_event("chat", {
                "agent": "Sentry",
                "text": "[MONITOR] Target metrics reached. Latency: 42ms. Active hosts: 24/24. Threat level: NOMINAL. Alarm cancelled."
            })
        elif inc_type == "db":
            state["status"] = "nominal"
            state["latency"] = 48
            broadcast_event("chat", {
                "agent": "Orchestrator",
                "text": "[RESOLVING] Playbook complete. Re-routing telemetry pipelines to nominal state."
            })
        elif inc_type == "cost":
            state["status"] = "nominal"
            broadcast_event("chat", {
                "agent": "Orchestrator",
                "text": f"[AUDIT] Cost optimization playbook complete. Projected cost optimized to ${state['cost']}/mo. Budget limit satisfied."
            })
            
    state["active_incident"] = None
    state["active_node"] = None
    state["replanned"] = False
    system_state["activeNode"] = None
    return state

# Build the LangGraph Multi-Agent Flow
workflow = StateGraph(SreGraphState)

workflow.add_node("entry_node", entry_node)
workflow.add_node("audit_node", audit_node)
workflow.add_node("proposal_node", proposal_node)
workflow.add_node("mitigate_node", mitigate_node)
workflow.add_node("exit_node", exit_node)

workflow.set_entry_point("entry_node")
workflow.add_edge("entry_node", "audit_node")

def route_after_audit(state: SreGraphState):
    if state.get("active_incident"):
        return "proposal_node"
    return "exit_node"

def route_after_mitigate(state: SreGraphState):
    # If mitigate node requested alternative approval (replanned), loop back to mitigate
    if state.get("waiting_approval"):
        return "mitigate_node"
    return "exit_node"

workflow.add_conditional_edges(
    "audit_node",
    route_after_audit,
    {
        "proposal_node": "proposal_node",
        "exit_node": "exit_node"
    }
)

workflow.add_edge("proposal_node", "mitigate_node")

workflow.add_conditional_edges(
    "mitigate_node",
    route_after_mitigate,
    {
        "mitigate_node": "mitigate_node",
        "exit_node": "exit_node"
    }
)

workflow.add_edge("exit_node", END)

memory = MemorySaver()

# Compile the graph injecting the HITL breakpoint right before the mitigate_node execution!
compiled_graph = workflow.compile(checkpointer=memory, interrupt_before=["mitigate_node"])

# Update system state values based on graph variables
def update_system_state_from_graph(values: dict):
    global system_state
    system_state["status"] = values.get("status", system_state["status"])
    system_state["nodes"] = values.get("nodes", system_state["nodes"])
    system_state["latency"] = values.get("latency", system_state["latency"])
    system_state["throughput"] = values.get("throughput", system_state["throughput"])
    system_state["cost"] = values.get("cost", system_state["cost"])
    system_state["activeIncident"] = values.get("active_incident", system_state["activeIncident"])
    system_state["waitingApproval"] = values.get("waiting_approval", system_state["waitingApproval"])
    system_state["approvalDetails"] = values.get("approval_details", system_state["approvalDetails"])
    system_state["activeNode"] = values.get("active_node", system_state.get("activeNode"))

# Background tasks runners
async def run_sre_graph_task(initial_state: dict, thread_id: str):
    thread = {"configurable": {"thread_id": thread_id}}
    try:
        log_incident_start(initial_state["active_incident"])
        inc_type = initial_state["active_incident"]
        if inc_type == "ddos":
            system_state["blastRadius"] = calculate_blast_radius(4)
        elif inc_type == "db":
            system_state["blastRadius"] = calculate_blast_radius(21)
        else:
            system_state["blastRadius"] = []
        
        async for event in compiled_graph.astream(initial_state, thread):
            graph_state = compiled_graph.get_state(thread)
            update_system_state_from_graph(graph_state.values)
            broadcast_event("state", {"state": system_state})
            await asyncio.sleep(0.5)
            
        graph_state = compiled_graph.get_state(thread)
        update_system_state_from_graph(graph_state.values)
        broadcast_event("state", {"state": system_state})
    except Exception as e:
        print(f"Error running SRE graph: {e}")

async def resume_sre_graph_task(thread_id: str, approved: bool):
    thread = {"configurable": {"thread_id": thread_id}}
    decision_str = "approve" if approved else "deny"
    
    compiled_graph.update_state(thread, {"user_input": decision_str})
    
    try:
        async for event in compiled_graph.astream(None, thread):
            graph_state = compiled_graph.get_state(thread)
            update_system_state_from_graph(graph_state.values)
            broadcast_event("state", {"state": system_state})
            await asyncio.sleep(0.5)
            
        graph_state = compiled_graph.get_state(thread)
        update_system_state_from_graph(graph_state.values)
        
        if graph_state.next:
            # Under interrupted state (alternative approval loop)
            # update_system_state_from_graph already set the new proposal and waitingApproval
            broadcast_event("state", {"state": system_state})
        else:
            log_incident_resolve(system_state["activeIncident"], approved)
            
            system_state["activeIncident"] = None
            system_state["waitingApproval"] = False
            system_state["approvalDetails"] = None
            system_state["activeNode"] = None
            system_state["blastRadius"] = []
            broadcast_event("state", {"state": system_state})
    except Exception as e:
        print(f"Error resuming SRE graph: {e}")

# Dynamic agent responses based on semantic checks (Local CLI command triggers)
async def run_agent_reasoning(cmd: str):
    await asyncio.sleep(0.8)
    
    # Optional LangSmith Observability Integration
    if os.environ.get("LANGSMITH_API_KEY"):
        os.environ["LANGCHAIN_TRACING_V2"] = "true"
        os.environ["LANGCHAIN_ENDPOINT"] = "https://api.smith.langchain.com"
        os.environ["LANGCHAIN_API_KEY"] = os.environ.get("LANGSMITH_API_KEY")
        if not os.environ.get("LANGCHAIN_PROJECT"):
            os.environ["LANGCHAIN_PROJECT"] = "helix-quantum-sre"

    if any(k in cmd for k in ["scale", "nodes", "capacity"]):
        broadcast_event("chat", {
            "agent": "Tecton",
            "text": f"[AUTOSCALING] Running cluster audit. Operating nodes count: {system_state['nodes']}. Cost limits verified."
        })
    elif any(k in cmd for k in ["security", "audit", "firewall", "pin"]):
        broadcast_event("chat", {
            "agent": "Vanguard",
            "text": "[SECURITY] Checking active host certificates and connection vectors. All node firewalls reported normal. Zero threats detected."
        })
    elif any(k in cmd for k in ["latency", "status", "metrics", "iops"]):
        broadcast_event("chat", {
            "agent": "Sentry",
            "text": f"[MONITORING] Ping response: {system_state['latency']}ms. Memory usage: 42.4%. System status reports: {system_state['status'].upper()}."
        })
    elif any(k in cmd for k in ["ddos", "attack", "incident", "simulation"]):
        thread_id = f"sre_session_{int(time.time())}"
        active_thread_ids["ddos"] = thread_id
        
        initial_state = {
            "messages": [],
            "status": "nominal",
            "nodes": system_state["nodes"],
            "latency": system_state["latency"],
            "throughput": system_state["throughput"],
            "cost": system_state["cost"],
            "active_incident": "ddos",
            "waiting_approval": False,
            "approval_details": None,
            "user_input": None,
            "step": 0,
            "active_node": "detect"
        }
        asyncio.create_task(run_sre_graph_task(initial_state, thread_id))
    elif any(k in cmd for k in ["reset", "clear", "nominal"]):
        system_state.update({
            "status": "nominal",
            "nodes": 24,
            "latency": 48,
            "throughput": 1250,
            "cost": 2500,
            "activeIncident": None,
            "waitingApproval": False,
            "approvalDetails": None,
            "activeNode": None,
            "blastRadius": []
        })
        active_thread_ids.clear()
        scale_k8s_deployment(24)
        
        for item in incident_history:
            if item.get("status") == "active":
                item["status"] = "aborted"
                item["resolvedAt"] = datetime_now()
        save_state()

        broadcast_event("state", {"state": system_state})
        broadcast_event("chat", {
            "agent": "Orchestrator",
            "text": "[SYSTEM_HEAL] Command directive executed. Manual state reset by administrator. All alarm sirens silenced. Telemetry coordinates nominal."
        })
    else:
        # Check if this matches a pod query
        pod_map = {
            "auth": "auth-token-verify",
            "payment": "payment-worker-01",
            "database": "postgres-primary-db",
            "db": "postgres-primary-db",
            "cache": "redis-cache-master",
            "ingress": "ingress-gateway-01",
            "gateway": "ingress-gateway-01"
        }
        
        matched_pod = None
        for key, pod_name in pod_map.items():
            if key in cmd:
                matched_pod = pod_name
                break
                
        if matched_pod:
            # Determine metric
            metric_type = None
            if "latency" in cmd or "response" in cmd or "time" in cmd:
                metric_type = "latency"
            elif "cpu" in cmd or "load" in cmd or "util" in cmd:
                metric_type = "cpu"
            elif "mem" in cmd or "ram" in cmd:
                metric_type = "memory"
                
            if metric_type:
                promql = ""
                val_str = ""
                status_str = "NOMINAL"
                
                is_anomaly = system_state["status"] == "anomaly"
                active_inc = system_state["activeIncident"]
                val_seed = sum(ord(c) for c in matched_pod)
                
                # Rule-based PromQL fallbacks
                if metric_type == "latency":
                    promql = f'histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket{{pod="{matched_pod}"}}[5m])) by (le))'
                    if is_anomaly and active_inc == "ddos" and ("ingress" in matched_pod or "auth" in matched_pod):
                        val_str = "540ms"
                        status_str = "CRITICAL (OVERLOAD)"
                    elif is_anomaly and active_inc == "db" and "db" in matched_pod:
                        val_str = "IO Timeout (30s)"
                        status_str = "FATAL"
                    else:
                        val_str = f"{round(1.5 + (val_seed % 3) * 0.4, 2)}ms"
                elif metric_type == "cpu":
                    promql = f'sum(rate(container_cpu_usage_seconds_total{{pod="{matched_pod}"}}[5m])) by (pod)'
                    if is_anomaly and active_inc == "ddos" and ("ingress" in matched_pod or "auth" in matched_pod):
                        val_str = "96%"
                        status_str = "CRITICAL"
                    elif is_anomaly and active_inc == "db" and "db" in matched_pod:
                        val_str = "100%"
                        status_str = "CRITICAL"
                    else:
                        val_str = f"{25 + (val_seed % 20)}%"
                elif metric_type == "memory":
                    promql = f'container_memory_working_set_bytes{{pod="{matched_pod}"}}'
                    if is_anomaly and active_inc == "ddos" and ("ingress" in matched_pod or "auth" in matched_pod):
                        val_str = "920Mi"
                        status_str = "WARNING"
                    elif is_anomaly and active_inc == "db" and "db" in matched_pod:
                        val_str = "7.9Gi"
                        status_str = "CRITICAL"
                    else:
                        val_str = f"{128 + (val_seed % 256)}Mi"

                # Conversational Gemini translation if API key is set
                gemini_key = os.environ.get("GEMINI_API_KEY")
                if gemini_key:
                    try:
                        llm = ChatGoogleGenerativeAI(model="gemini-1.5-flash", google_api_key=gemini_key, temperature=0.0)
                        prompt = f"Translate the following SRE request for pod '{matched_pod}' into a single line PromQL query: '{cmd}'. Only output the raw PromQL query, no markdown, no backticks, no explanations."
                        response = await asyncio.wait_for(llm.ainvoke(prompt), timeout=5.0)
                        gemini_query = response.content.strip().replace("`", "")
                        if gemini_query and len(gemini_query) > 5:
                            promql = gemini_query
                    except Exception as e:
                        print(f"Gemini PromQL compilation bypassed: {e}")

                # Generate dynamic time-series coordinate array (30 points, -15 minutes to now)
                now_ts = int(time.time())
                coordinates = None

                # Attempt to query live Prometheus telemetry range coordinates
                try:
                    coordinates = await query_prometheus_range(promql, now_ts - 900, now_ts, 30)
                except Exception as range_err:
                    print(f"Prometheus query_range failed: {range_err}")

                # Fallback to local system metrics generator if Prometheus is offline
                if not coordinates:
                    coordinates = []
                    for i in range(30):
                        t = now_ts - (30 - i) * 30
                        v = 25.0
                        if metric_type == "latency":
                            if is_anomaly and active_inc == "ddos" and ("ingress" in matched_pod or "auth" in matched_pod):
                                v = 80 + (i * 15) if i > 15 else 80 + random.randint(-5, 5)
                            elif is_anomaly and active_inc == "db" and "db" in matched_pod:
                                v = 2.2 if i < 18 else 30.0
                            else:
                                v = 2.0 + random.uniform(-0.5, 0.5)
                        elif metric_type == "cpu":
                            if is_anomaly and active_inc == "ddos" and ("ingress" in matched_pod or "auth" in matched_pod):
                                v = 30 + (i * 2.2) if i > 15 else 30 + random.randint(-5, 5)
                            elif is_anomaly and active_inc == "db" and "db" in matched_pod:
                                v = 25 if i < 18 else 100
                            else:
                                v = 25 + random.randint(-5, 5)
                        elif metric_type == "memory":
                            if is_anomaly and active_inc == "ddos" and ("ingress" in matched_pod or "auth" in matched_pod):
                                v = 256 + (i * 20) if i > 15 else 256 + random.randint(-10, 10)
                            elif is_anomaly and active_inc == "db" and "db" in matched_pod:
                                v = 1024 if i < 18 else 8192
                            else:
                                v = 128 + random.randint(-20, 20)
                        coordinates.append([t, round(v, 2)])

                broadcast_event("chat", {
                    "agent": "Orchestrator",
                    "text": "[COMPILER] Compiling NL prompt to PromQL MQL query..."
                })
                await asyncio.sleep(0.6)
                broadcast_event("chat", {
                    "agent": "Orchestrator",
                    "text": f"[COMPILER] Deployed query:\n```promql\n{promql}\n```"
                })
                await asyncio.sleep(0.6)
                forecast = calculate_linear_forecast(coordinates, 10)
                broadcast_event("chat", {
                    "agent": "Sentry",
                    "text": f"[QUERY_ENGINE] Query resolved. Result: `{val_str}` ({status_str}).",
                    "chartData": {
                        "coordinates": coordinates,
                        "forecast": forecast,
                        "metric": metric_type,
                        "pod": matched_pod,
                        "status": status_str
                    }
                })
                return

        broadcast_event("chat", {
            "agent": "Sentry",
            "text": f"[ANALYSIS] Request logged: \"{cmd}\". Routing packet. Sentry monitoring nominal."
        })

# SSE Streaming Endpoint
@app.get("/api/stream")
async def sse_stream(request: Request):
    async def event_generator():
        queue = asyncio.Queue()
        sse_listeners.append(queue)
        
        init_data = json.dumps({"type": "init", "state": system_state})
        yield {"data": init_data}
        
        try:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    data = await asyncio.wait_for(queue.get(), timeout=20.0)
                    yield {"data": data}
                except asyncio.TimeoutError:
                    yield {"comment": "ping"}
        except asyncio.CancelledError:
            pass
        finally:
            sse_listeners.remove(queue)

    return EventSourceResponse(event_generator())

class CommandRequest(BaseModel):
    command: str

@app.post("/api/command", dependencies=[Depends(check_rate_limit), Depends(check_auth_gate)])
async def execute_command(req: CommandRequest):
    cmd_text = req.command
    clean_cmd = cmd_text.strip().lower()

    broadcast_event("chat", {
        "agent": "Orchestrator",
        "text": f"[COMMAND_DECRYPTED] User prompted: \"{cmd_text}\". Dispatching optimization vectors..."
    })

    asyncio.create_task(run_agent_reasoning(clean_cmd))
    return {"status": "queued"}

class IncidentRequest(BaseModel):
    type: str

class LoginRequest(BaseModel):
    pin: str

@app.post("/api/login")
async def login(req: LoginRequest):
    expected_pin = os.environ.get("ADMIN_PIN", "1234")
    if req.pin == expected_pin:
        import secrets
        token = secrets.token_hex(16)
        
        if redis_client:
            try:
                redis_client.setex(f"token:{token}", 24 * 3600, str(time.time() + 24 * 3600))
                return {"token": token}
            except Exception as e:
                print(f"[REDIS] Login token storage failed, fallback to in-memory: {e}")

        active_tokens[token] = time.time() + 24 * 3600  # 24 hours
        return {"token": token}
    else:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid PIN"
        )

@app.post("/api/incident", dependencies=[Depends(check_rate_limit), Depends(check_auth_gate)])
async def launch_incident(req: IncidentRequest):
    if system_state["activeIncident"]:
        return JSONResponse(
            status_code=400,
            content={"error": "An incident is currently active"}
        )

    inc_type = req.type
    if inc_type not in ["ddos", "db", "cost"]:
        raise HTTPException(status_code=400, detail="Invalid incident type")

    thread_id = f"sre_session_{int(time.time())}"
    active_thread_ids[inc_type] = thread_id
    
    initial_state = {
        "messages": [],
        "status": "nominal",
        "nodes": system_state["nodes"],
        "latency": system_state["latency"],
        "throughput": system_state["throughput"],
        "cost": system_state["cost"],
        "active_incident": inc_type,
        "waiting_approval": False,
        "approval_details": None,
        "user_input": None,
        "step": 0,
        "active_node": "detect"
    }
    
    asyncio.create_task(run_sre_graph_task(initial_state, thread_id))
    return {"status": "initiated"}

class ApprovalRequest(BaseModel):
    approved: bool

@app.post("/api/approve", dependencies=[Depends(check_auth_gate)])
async def process_approval(req: ApprovalRequest):
    if not system_state["waitingApproval"]:
        return JSONResponse(
            status_code=400,
            content={"error": "No action is waiting approval"}
        )

    approved = req.approved
    active_inc = system_state["activeIncident"]
    system_state["waitingApproval"] = False
    system_state["approvalDetails"] = None
    broadcast_event("state", {"state": system_state})

    if approved:
        broadcast_event("chat", {
            "agent": "Orchestrator",
            "text": "[DECISION] Administrator APPROVED the proposed runbook action. Resuming automated mitigation..."
        })
    else:
        broadcast_event("chat", {
            "agent": "Orchestrator",
            "text": "[DECISION] Administrator DENIED the proposed runbook. Halting autonomous playbooks."
        })

    thread_id = active_thread_ids.get(active_inc) if active_inc else None
    if thread_id:
        asyncio.create_task(resume_sre_graph_task(thread_id, approved))

    return {"status": "processed"}

class TunerRequest(BaseModel):
    nodes: Optional[int] = None
    speed: Optional[float] = None
    costLimit: Optional[int] = None

@app.post("/api/tuner", dependencies=[Depends(check_auth_gate)])
async def update_tuner(req: TunerRequest):
    global system_state
    if req.nodes is not None:
        system_state["nodes"] = req.nodes
    if req.speed is not None:
        system_state["speed"] = req.speed
    if req.costLimit is not None:
        system_state["costLimit"] = req.costLimit
    
    save_state()
    broadcast_event("state", {"state": system_state})
    return {"status": "success", "state": system_state}

@app.get("/api/history", dependencies=[Depends(check_auth_gate)])
async def get_history():
    # Prune history to last 100 logs
    global incident_history
    if len(incident_history) > 100:
        incident_history = incident_history[-100:]
    return incident_history

@app.get("/api/health")
async def get_health():
    return {
        "status": "healthy",
        "systemStatus": system_state.get("status", "nominal"),
        "activeNodes": system_state.get("nodes", 24),
        "timestamp": time.time()
    }

@app.get("/metrics", response_class=Response)
async def get_metrics():
    metrics = [
        "# HELP helix_system_status System status code (0=nominal, 1=anomaly, 2=resolving)",
        "# TYPE helix_system_status gauge",
        f"helix_system_status {0 if system_state.get('status') == 'nominal' else (1 if system_state.get('status') == 'anomaly' else 2)}",
        "# HELP helix_active_nodes Number of operational cluster nodes",
        "# TYPE helix_active_nodes gauge",
        f"helix_active_nodes {system_state.get('nodes', 24)}",
        "# HELP helix_latency_ms Network traffic latency in milliseconds",
        "# TYPE helix_latency_ms gauge",
        f"helix_latency_ms {system_state.get('latency', 48)}",
        "# HELP helix_throughput_req_sec System throughput requests per second",
        "# TYPE helix_throughput_req_sec gauge",
        f"helix_throughput_req_sec {system_state.get('throughput', 1250)}",
        "# HELP helix_monthly_cost_usd Infrastructure monthly cost",
        "# TYPE helix_monthly_cost_usd gauge",
        f"helix_monthly_cost_usd {system_state.get('cost', 2500)}",
        "# HELP helix_sse_connected_clients Count of connected SSE clients",
        "# TYPE helix_sse_connected_clients gauge",
        f"helix_sse_connected_clients {len(sse_clients)}"
    ]
    return Response(content="\n".join(metrics) + "\n", media_type="text/plain; version=0.0.4")

# Serve Frontend static routes
@app.get("/")
async def get_index():
    return FileResponse("index.html")

@app.get("/styles.css")
async def get_styles():
    return FileResponse("styles.css")

@app.get("/app.js")
async def get_app_js():
    return FileResponse("app.js")

@app.get("/space3d.js")
async def get_space3d_js():
    return FileResponse("space3d.js")

# Catch-All wildcard SPA route (must be registered last)
@app.get("/{path_name:path}")
async def catch_all_static(path_name: str):
    full_path = os.path.join(os.getcwd(), path_name)
    if os.path.exists(full_path) and os.path.isfile(full_path):
        return FileResponse(full_path)
    return FileResponse("index.html")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="127.0.0.1", port=8080, log_level="info")
