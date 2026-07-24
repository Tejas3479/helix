/**
 * Helix Quantum - Core Application Controller (GSAP & HITL Enabled)
 * Manages Server-Sent Events, HTML HITL modal gates, GSAP staggered layouts,
 * and compiles 3D spatialized panners linked to Three.js camera listeners.
 *
 * FIXES APPLIED (SDET report):
 *  - BUG-002: PIN validation removed from client-side — server is sole authority
 *  - BUG-003: XSS — chat bubble text now uses textContent (not innerHTML)
 *  - BUG-006: totalGridSlots now dynamic (matches slider max)
 *  - BUG-007: loadIncidentHistory() throttled — max 1 fetch per 5 seconds
 *  - BUG-008: drawMonitorLoop uses delta-time for monitorTime increment
 *  - BUG-009: Text scrambler setInterval cleared on mouseleave
 *  - FIX: stopAlarm() nulls alarmGainNode to release reference
 *  - FIX: SSE reconnect with exponential backoff
 *  - FIX: HITL POST failure re-shows modal with error feedback
 *  - FIX: handleAutoScaling upscales when FPS recovers above 55
 *  - FIX: activeNode key standardized (no more active_node fallback needed)
 */

class AppController {
    constructor() {
        this.audioContext = null;
        this.synthActive = false;
        this.alarmOsc = null;
        this.alarmLfo = null;
        this.lastFrameTime = performance.now();
        this.frameCount = 0;
        this.lastFPSUpdate = performance.now(); // Initialise lastFPSUpdate to prevent NaN frames
        this.lastActiveIdx = 0; // Prevent scrolling transition jitter
        // BUG-007 FIX: Throttle history fetch — last fetch timestamp
        this.lastHistoryFetch = 0;
        this.HISTORY_FETCH_INTERVAL = 5000; // ms between fetches
        // FIX: SSE reconnect backoff state
        this.sseReconnectDelay = 1000;
        this.sseReconnectMaxDelay = 30000;
        this.fpsList = [];
        this.eventSource = null;
        
        // Cache DOM elements
        this.loader = document.getElementById('loader');
        this.loaderProgress = document.getElementById('loader-progress');
        this.loaderStatus = document.getElementById('loader-status');
        this.scrollWrapper = document.getElementById('scroll-wrapper');
        this.sections = document.querySelectorAll('.hud-section');
        this.navLinks = document.querySelectorAll('.nav-link');
        
        // Cache Flowchart elements
        this.flowchartSteps = {
            detect: document.getElementById('flowchart-detect'),
            triage: document.getElementById('flowchart-triage'),
            rca: document.getElementById('flowchart-rca'),
            proposal: document.getElementById('flowchart-proposal'),
            hitl: document.getElementById('flowchart-hitl'),
            remediate: document.getElementById('flowchart-remediate')
        };
        this.flowchartArrows = document.querySelectorAll('.flowchart-arrow');
        
        this.audioBtn = document.getElementById('audio-toggle');
        this.fpsDisplay = document.getElementById('fps-display');
        this.metricFps = document.getElementById('metric-fps');
        this.metricLatency = document.getElementById('metric-latency');
        this.syncPercent = document.getElementById('sync_percent');
        this.systemStatusTag = document.getElementById('system-status-tag');
        this.teleBar = document.getElementById('tele-bar');
        
        // Concentric pod exploder & pinned HUD elements
        this.btnExitExplode = document.getElementById('btn-exit-explode');
        this.pinnedChartsContainer = document.getElementById('pinned-charts-container');
        this.costSavingsCanvas = document.getElementById('cost-savings-canvas');
        this.costSavingsCtx = this.costSavingsCanvas ? this.costSavingsCanvas.getContext('2d') : null;
        this.podRowsContainer = document.getElementById('pod-rows-container');
        
        // PIN Gate & History Panel Elements
        this.pinOverlay = document.getElementById('pin-gate-overlay');
        this.pinForm = document.getElementById('pin-gate-form');
        this.pinInput = document.getElementById('admin-pin-input');
        this.pinError = document.getElementById('pin-gate-error');
        this.historyBody = document.getElementById('history-body');
        
        // Node Details Card Elements
        this.nodeDetailsCard = document.getElementById('node-details-card');
        this.nodeDetailClose = document.getElementById('node-detail-close');
        this.currentNodeIdx = undefined;
        this.monitorCanvas = document.getElementById('node-monitor-canvas');
        this.monitorCtx = this.monitorCanvas ? this.monitorCanvas.getContext('2d') : null;
        this.monitorTag = document.getElementById('node-detail-monitor-tag');
        this.monitorScreenContainer = document.querySelector('.monitor-screen-container');
        this.monitorAnimationFrameId = null;
        this.monitorTime = 0;
        
        this.sessionToken = localStorage.getItem('helix_session_token') || '';
        
        // Sliders
        this.sliderSpeed = document.getElementById('slider-speed');
        this.sliderParticles = document.getElementById('slider-particles');
        this.sliderNoise = document.getElementById('slider-noise');
        
        this.valSpeed = document.getElementById('val-speed');
        this.valParticles = document.getElementById('val-particles');
        this.valNoise = document.getElementById('val-noise');

        this.isDraggingSpeed = false;
        this.isDraggingParticles = false;
        this.isDraggingNoise = false;
        
        // Command UI elements
        this.promptForm = document.getElementById('agent-command-form');
        this.promptInput = document.getElementById('agent-prompt');
        this.chatFeed = document.getElementById('agent-chat-feed');
        
        // Telemetry details in tuner
        this.metricNodes = document.getElementById('metric-nodes-total');
        this.metricCost = document.getElementById('metric-cost-monthly');
        
        // Node Grid
        this.nodeGrid = document.getElementById('node-cluster-grid');
        this.activeNodesCounter = document.getElementById('active-nodes-counter');
        
        // Launchers
        this.simDdosBtn = document.getElementById('sim-ddos');
        this.simDbBtn = document.getElementById('sim-db');
        this.simCostBtn = document.getElementById('sim-cost');
        
        // HITL Gate Modal elements
        this.hitlModal = document.getElementById('hitl-modal');
        this.hitlAgent = document.getElementById('hitl-agent');
        this.hitlAction = document.getElementById('hitl-action');
        this.hitlSource = document.getElementById('hitl-source');
        this.btnHitlApprove = document.getElementById('btn-hitl-approve');
        this.btnHitlDeny = document.getElementById('btn-hitl-deny');
        
        // Terminal output
        this.terminalOutput = document.getElementById('terminal-output');
        this.terminalBody = document.getElementById('terminal-body');

        // War Room Left Pane elements
        this.tabTicketInfo = document.getElementById('tab-ticket-info');
        this.tabGuardrailRules = document.getElementById('tab-guardrail-rules');
        this.contentTicketInfo = document.getElementById('content-ticket-info');
        this.contentGuardrailRules = document.getElementById('content-guardrail-rules');
        
        this.ticketIdVal = document.getElementById('ticket-id');
        this.ticketSeverityVal = document.getElementById('ticket-severity');
        this.ticketAlertVal = document.getElementById('ticket-alert');
        this.ticketBlastVal = document.getElementById('ticket-blast');
        
        this.btnDeployPolicy = document.getElementById('btn-deploy-policy');
        this.policyRulesInput = document.getElementById('policy-rules-input');
        this.policyAgentSelect = document.getElementById('policy-agent-select');
        
        // Detailed panel variables
        this.nodeNames = [
            "ingress-gateway-01", "ingress-gateway-02", "ingress-standby-01", "api-router-backup", // Layer 1 (0..3)
            "api-router-ingress", // Layer 2 (4)
            "auth-token-verify", "payment-worker-01", "payment-worker-02", "search-indexing-pod", // Layer 3 (5..8)
            "rabbitmq-broker-01", "vault-secrets-mgr", "jaeger-trace-collector", "prometheus-metrics", // Layer 3 (9..12)
            "grafana-dashboard-01", "k8s-dns-resolver", "billing-webhooks-pod", "rabbitmq-replica-01", // Layer 3 (13..16)
            "fluentd-log-shipper", "sentry-error-agent", "vault-backup-agent", "k8s-pod-scaler", // Layer 3 (17..20)
            "postgres-primary-db", "redis-cache-master", "user-profile-db", "postgres-standby-db", // Layer 4 (21..24)
            "redis-cache-replica", "user-profile-replica", "elasticsearch-data-01", "elasticsearch-data-02", // Scale/Replicas (25..28)
            "notification-sms", "notification-email", "autoscaling-controller", // Scale/Replicas (29..31)
            "k8s-kubelet-node-17", "k8s-kubelet-node-18", "k8s-kubelet-node-19", "k8s-kubelet-node-20", // Scale/Compute (32..35)
            "k8s-kubelet-node-21", "k8s-kubelet-node-22", "k8s-kubelet-node-23", "k8s-kubelet-node-24", // Scale/Compute (36..39)
            "k8s-kubelet-node-25", "k8s-kubelet-node-26", "k8s-kubelet-node-27", "k8s-kubelet-node-28", // Scale/Compute (40..43)
            "k8s-kubelet-node-29", "k8s-kubelet-node-30", "k8s-kubelet-node-31", "k8s-kubelet-node-32"  // Scale/Compute (44..47)
        ];
        this.nodeRoles = [
            "Ingress Load Balancer", "Ingress Traffic Controller", "Standby Ingress Gateway", "Standby API Router",
            "Core API Gateway Router",
            "OAuth JWT Validation Service", "Stripe Payment Processor", "Stripe Webhook Handler", "Elasticsearch Index Service",
            "RabbitMQ Task Queue Broker", "HashiCorp Vault Service", "Jaeger Distributed Tracing", "Prometheus Scraping Daemon",
            "Grafana Analytics Interface", "Kube-DNS Domain Name Resolver", "Billing Webhook Consumer", "RabbitMQ Standby Broker",
            "Fluentd DaemonSet Log Shipper", "Sentry Log Monitor Service", "Vault Backup Service", "HPA Container Scale-down Pool",
            "PostgreSQL Database Master", "Redis Session Cache", "MongoDB User Datastore", "PostgreSQL Hot Standby",
            "Redis Read Replica", "MongoDB Read Replica", "Elasticsearch Data Cluster Node", "Elasticsearch Replica Node",
            "Twilio SMS Dispatch Service", "SendGrid Email Dispatcher", "Cluster Scaling Orchestrator",
            "Kubernetes Core Compute Pool", "Kubernetes Core Compute Pool", "Kubernetes Core Compute Pool", "Kubernetes Core Compute Pool",
            "Kubernetes Core Compute Pool", "Kubernetes Core Compute Pool", "Kubernetes Core Compute Pool", "Kubernetes Core Compute Pool",
            "Kubernetes Core Compute Pool", "Kubernetes Core Compute Pool", "Kubernetes Core Compute Pool", "Kubernetes Core Compute Pool",
            "Kubernetes Core Compute Pool", "Kubernetes Core Compute Pool", "Kubernetes Core Compute Pool", "Kubernetes Core Compute Pool"
        ];
        this.lastSystemState = null;
        
        this.init();
    }

    init() {
        // 1. Initialise the 3D Engine
        this.space = new SpaceEngine();
        
        // 2. Setup loader simulation
        this.simulateLoading();

        // 3. Bind UI interactions
        this.bindEvents();
        
        // 4. Start FPS Diagnostics loop
        this.measureFPS();
        
        // 5. Connect to the real Node.js backend SSE stream
        this.connectBackendStream();
        
        // 6. Scramble title styling
        this.initTextScrambler();

        // 7. Security check
        this.checkAuth();
    }

    simulateLoading() {
        let progress = 0;
        const statusPhrases = [
            "BOOTING CORE TELEMETRY...",
            "ESTABLISHING SECURE AGENT MATRIX...",
            "SYNCHRONIZING VECTOR HORIZONS...",
            "CONNECTING NODE ENDPOINTS...",
            "ALL AGENTS SECURED. PORTAL STANDBY."
        ];

        const interval = setInterval(() => {
            progress += Math.floor(Math.random() * 8) + 4;
            if (progress >= 100) {
                progress = 100;
                clearInterval(interval);
                gsap.to(this.loaderProgress, { width: '100%', duration: 0.1, overwrite: 'auto', ease: 'none' });
                this.loaderStatus.textContent = statusPhrases[4];
                
                setTimeout(() => {
                    this.loader.classList.add('fade-out');
                    this.playBeep(880, 0.15, 0.05);
                    if (this.space && typeof this.space.playIntroFlyIn === 'function') {
                        this.space.playIntroFlyIn();
                    }
                }, 800);
            } else {
                gsap.to(this.loaderProgress, { width: progress + '%', duration: 0.04, overwrite: 'auto', ease: 'none' });
                const phraseIdx = Math.min(Math.floor(progress / 25), statusPhrases.length - 1);
                this.loaderStatus.textContent = statusPhrases[phraseIdx];
            }
        }, 40);
    }

    connectBackendStream() {
        // Close any existing connection
        if (this.eventSource) {
            this.eventSource.close();
        }

        this.eventSource = new EventSource('/api/stream');
        
        this.eventSource.addEventListener('message', (e) => {
            // Successful message — reset reconnect backoff
            this.sseReconnectDelay = 1000;

            let data;
            try {
                data = JSON.parse(e.data);
            } catch (parseErr) {
                console.error('SSE parse error:', parseErr);
                return;
            }
            
            if (data.type === 'init' || data.type === 'state') {
                this.syncSystemState(data.state);
            } 
            else if (data.type === 'chat') {
                this.addChatBubble(data.agent, data.text, data.chartData);
            }
        });
        
        // FIX: SSE reconnect with exponential backoff
        this.eventSource.onerror = (err) => {
            console.error("SSE stream error. Reconnecting in", this.sseReconnectDelay, "ms...");
            this.eventSource.close();

            // Show reconnect status in sidebar
            const agentsMini = document.getElementById('active-agents-mini');
            if (agentsMini) {
                const warnMsg = document.createElement('p');
                warnMsg.innerHTML = `&gt; stream: <span class="red">RECONNECTING...</span>`;
                agentsMini.appendChild(warnMsg);
            }

            setTimeout(() => {
                this.sseReconnectDelay = Math.min(this.sseReconnectDelay * 2, this.sseReconnectMaxDelay);
                this.connectBackendStream();
            }, this.sseReconnectDelay);
        };
    }

    syncSystemState(state) {
        const previousIncident = this.lastSystemState ? this.lastSystemState.activeIncident : null;
        const previousStatus = this.lastSystemState ? this.lastSystemState.status : null;
        const previousApproval = this.lastSystemState ? this.lastSystemState.waitingApproval : null;

        this.lastSystemState = state;
        
        // 1. Set space engine state
        this.space.setSystemState(state.status, state);
        this.space.updateActiveNodesVis(state.nodes);
        
        // FIX: Sync active agent pipeline flowchart — standardized key 'activeNode'
        this.syncFlowchartStep(state.activeNode);
        
        // 2. Alarm siren triggers
        if (state.status === 'anomaly') {
            document.body.classList.add('alarm-active');
            this.startAlarm();
            this.systemStatusTag.textContent = `SYSTEM STATUS: CRITICAL [${state.activeIncident.toUpperCase()}]`;
            if (this.terminalOutput) this.terminalOutput.classList.remove('hidden');
            this.addTerminalLine(`CRITICAL SECURITY ANOMALY TRIGGERED [${state.activeIncident.toUpperCase()}]`, 'anomaly');
            
            this.scrollWrapper.scrollTo({
                top: window.innerHeight,
                behavior: 'smooth'
            });
        } else if (state.status === 'resolving') {
            document.body.classList.remove('alarm-active');
            this.stopAlarm();
            this.systemStatusTag.textContent = `SYSTEM STATUS: RESOLVING INCIDENT`;
            if (this.terminalOutput) this.terminalOutput.classList.remove('hidden');
            this.addTerminalLine(`Autonomous healing runbook active...`, 'resolving');
        } else {
            document.body.classList.remove('alarm-active');
            this.stopAlarm();
            this.systemStatusTag.textContent = "SYSTEM STATUS: NOMINAL";
            this.addTerminalLine(`Cluster metrics normalized. Status: NOMINAL.`, 'nominal');
        }
        
        // 3. Left Sidebar text sync
        document.getElementById('tele_coords').textContent = `HOSTS: ${state.nodes}/24`;
        document.getElementById('tele_flux').textContent = `${state.latency} ms`;
        document.getElementById('tele_particles').textContent = `${state.throughput.toLocaleString()} req/s`;
        
        if (this.teleBar) {
            let targetWidth = '100%';
            this.teleBar.className = 'bar-progress';
            if (state.status === 'anomaly') {
                targetWidth = '35%';
                this.teleBar.classList.add('anomaly');
            } else if (state.status === 'resolving') {
                targetWidth = '70%';
                this.teleBar.classList.add('resolving');
            } else {
                this.teleBar.classList.add('nominal');
            }
            gsap.to(this.teleBar, { width: targetWidth, duration: 1.0, ease: 'power2.out' });
        }
        
        // 4. Calibration metrics
        this.metricNodes.textContent = state.nodes;
        this.metricCost.textContent = `$${state.cost.toLocaleString()}`;
        
        if (document.activeElement !== this.sliderParticles && !this.isDraggingParticles) {
            const previousNodes = parseInt(this.sliderParticles.value);
            this.sliderParticles.value = state.nodes;
            this.valParticles.textContent = state.nodes + ' Nodes';
            if (previousNodes !== parseInt(state.nodes)) {
                this.space.createNebulaParticles(parseInt(state.nodes) * 250);
            }
        }
        if (state.speed !== undefined && document.activeElement !== this.sliderSpeed && !this.isDraggingSpeed) {
            this.sliderSpeed.value = state.speed;
            this.valSpeed.textContent = parseFloat(state.speed).toFixed(1) + 'x';
            this.space.coreSpeed = parseFloat(state.speed);
        }
        if (state.costLimit !== undefined && document.activeElement !== this.sliderNoise && !this.isDraggingNoise) {
            this.sliderNoise.value = state.costLimit;
            this.valNoise.textContent = '$' + parseInt(state.costLimit).toLocaleString();
        }
        
        // 5. Redraw LED Node Grid
        this.renderNodeGrid(state.nodes, state.status);
        
        // 6. Handle Human-in-the-Loop (HITL) Gate Trigger
        if (state.waitingApproval) {
            this.showHITLModal(state.approvalDetails);
        } else {
            this.hideHITLModal();
        }

        // 7. Sync persistent history logs only on state transition changes
        if (state.activeIncident !== previousIncident || state.status !== previousStatus || state.waitingApproval !== previousApproval) {
            this.loadIncidentHistory();
        }
        
        // Sync Workload Recommendations and Cost Graph
        this.renderPodWorkloadGrid();
        this.drawCostSavingsForecast();

        // Sync Active Incident Ticket details
        if (this.ticketIdVal) {
            if (state.activeIncident) {
                this.ticketIdVal.textContent = `#INC-2026-${state.activeIncident.toUpperCase()}-${state.nodes}`;
                this.ticketSeverityVal.textContent = state.status === 'anomaly' ? "CRITICAL" : "RESOLVING";
                this.ticketSeverityVal.className = state.status === 'anomaly' ? "val red-text flashing" : "val yellow-text";
                this.ticketAlertVal.textContent = `${state.activeIncident.toUpperCase()} ANOMALY TRIGGERED`;
                if (state.blastRadius && state.blastRadius.length > 0) {
                    this.ticketBlastVal.textContent = `${state.blastRadius.length} Nodes`;
                } else {
                    this.ticketBlastVal.textContent = state.activeIncident === 'db' ? "23 Nodes" : "4 Nodes";
                }
            } else {
                this.ticketIdVal.textContent = "N/A";
                this.ticketSeverityVal.textContent = "NOMINAL";
                this.ticketSeverityVal.className = "val green-text";
                this.ticketAlertVal.textContent = "None";
                this.ticketBlastVal.textContent = "0 Nodes";
            }
        }

        // 8. Refresh open node detailed matrix dynamically
        if (this.currentNodeIdx !== undefined) {
            this.showNodeDetails(this.currentNodeIdx, true);
        }
    }

    syncFlowchartStep(activeNode) {
        const stepsOrder = ["detect", "triage", "rca", "proposal", "hitl", "remediate"];
        const activeIndex = stepsOrder.indexOf(activeNode);
        
        stepsOrder.forEach((stepName, idx) => {
            const stepEl = this.flowchartSteps[stepName];
            if (!stepEl) return;
            
            stepEl.classList.remove('active', 'completed');
            
            if (idx < activeIndex) {
                stepEl.classList.add('completed');
            } else if (idx === activeIndex) {
                stepEl.classList.add('active');
            }
        });
        
        if (this.flowchartArrows) {
            this.flowchartArrows.forEach((arrow, idx) => {
                arrow.classList.remove('completed');
                if (idx < activeIndex) {
                    arrow.classList.add('completed');
                }
            });
        }
    }

    showHITLModal(details) {
        this.hitlAgent.textContent = details.agent;
        this.hitlAction.textContent = details.action;
        this.hitlSource.textContent = details.source;
        // FIX: Cache last approval details so modal can be re-shown on POST failure
        this.lastApprovalDetails = details;
        
        // Fade in via GSAP
        this.hitlModal.classList.remove('hidden');
        gsap.fromTo(this.hitlModal.querySelector('.hitl-modal-card'), 
            { scale: 0.8, opacity: 0 }, 
            { scale: 1.0, opacity: 1, duration: 0.5, ease: 'back.out(1.5)' }
        );
        
        // Pulsing warning sound sweep
        this.playBeep(330, 0.4, 0.08);
    }

    hideHITLModal() {
        if (!this.hitlModal.classList.contains('hidden')) {
            gsap.to(this.hitlModal.querySelector('.hitl-modal-card'), {
                scale: 0.8,
                opacity: 0,
                duration: 0.35,
                ease: 'power2.in',
                onComplete: () => {
                    this.hitlModal.classList.add('hidden');
                }
            });
        }
    }

    renderNodeGrid(activeCount, status) {
        // BUG-006 FIX: totalGridSlots dynamically matches the slider max (64)
        const sliderMax = this.sliderParticles ? parseInt(this.sliderParticles.max) : 64;
        const totalGridSlots = Math.max(48, sliderMax);
        this.activeNodesCounter.textContent = `ACTIVE: ${activeCount}/${totalGridSlots}`;
        const existingBlocks = this.nodeGrid.querySelectorAll('.node-block');
        
        if (existingBlocks.length === totalGridSlots) {
            // Update existing elements in place to save CPU cycles and prevent layout thrashing
            for (let i = 0; i < totalGridSlots; i++) {
                const block = existingBlocks[i];
                const wasActive = !block.classList.contains('offline');
                const isActive = i < activeCount;
                
                block.className = 'node-block';
                if (isActive) {
                    if (status === 'anomaly') {
                        block.classList.add('attack');
                    } else if (status === 'resolving' && i >= 24) {
                        block.classList.add('booting');
                    }
                } else {
                    block.classList.add('offline');
                }
                
                // Play a micro-scale flash animation only if active state toggled
                if (wasActive !== isActive) {
                    gsap.fromTo(block, { scale: 0.7 }, { scale: 1.0, duration: 0.3, ease: 'back.out(1.5)' });
                }
            }
        } else {
            // Initial populate
            this.nodeGrid.innerHTML = '';
            const fragment = document.createDocumentFragment();
            
            for (let i = 0; i < totalGridSlots; i++) {
                const block = document.createElement('div');
                
                if (i < activeCount) {
                    block.className = 'node-block';
                    if (status === 'anomaly') {
                        block.classList.add('attack');
                    } else if (status === 'resolving' && i >= 24) {
                        block.classList.add('booting');
                    }
                } else {
                    block.className = 'node-block offline';
                }
                
                fragment.appendChild(block);
            }
            
            this.nodeGrid.appendChild(fragment);
            
            gsap.from(this.nodeGrid.querySelectorAll('.node-block'), {
                opacity: 0,
                scale: 0.4,
                duration: 0.4,
                stagger: {
                    amount: 0.25,
                    grid: [4, 16],
                    from: 'center'
                },
                ease: 'power2.out'
            });
        }
    }

    bindEvents() {
        // Close Node Details overlay panel
        if (this.nodeDetailClose) {
            this.nodeDetailClose.addEventListener('click', () => {
                this.hideNodeDetails();
            });
        }

        // PIN Gate submission
        if (this.pinForm) {
            this.pinForm.addEventListener('submit', (e) => {
                this.submitPin(e);
            });
        }

        // Scroll navigation link mapping
        this.scrollWrapper.addEventListener('scroll', () => {
            const scrollTop = this.scrollWrapper.scrollTop;
            const height = window.innerHeight;
            const progress = scrollTop / height;
            
            this.space.updateScroll(progress);
            
            // Determine active section based on boundingClientRect intersection (supports variable heights)
            let activeIdx = 0;
            let minDiff = Infinity;
            
            this.sections.forEach((sec, idx) => {
                const rect = sec.getBoundingClientRect();
                const diff = Math.abs(rect.top); // Distance of section top from viewport top
                if (diff < minDiff) {
                    minDiff = diff;
                    activeIdx = idx;
                }
            });
            
            if (activeIdx !== this.lastActiveIdx) {
                this.lastActiveIdx = activeIdx;
                this.sections.forEach((sec, idx) => {
                    if (idx === activeIdx) {
                        if (!sec.classList.contains('active')) {
                            sec.classList.add('active');
                            this.playBeep(440, 0.05, 0.02);
                        }
                    } else {
                        sec.classList.remove('active');
                    }
                });

                this.navLinks.forEach((link, idx) => {
                    if (idx === activeIdx) {
                        link.classList.add('active');
                    } else {
                        link.classList.remove('active');
                    }
                });
            }
        });

        // Top Navigation clicks
        this.navLinks.forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const sectionIdx = parseInt(link.getAttribute('data-section'));
                const targetSection = this.sections[sectionIdx];
                if (targetSection) {
                    this.scrollWrapper.scrollTo({
                        top: targetSection.offsetTop,
                        behavior: 'smooth'
                    });
                }
                
                this.playBeep(660, 0.08, 0.03);
            });
        });

        // Audio toggle click
        this.audioBtn.addEventListener('click', () => {
            this.toggleAudio();
        });

        // Sliders
        // Slider drag tracking and value synchronization
        const updateTunerBackend = () => {
            const nodes = parseInt(this.sliderParticles.value);
            const speed = parseFloat(this.sliderSpeed.value);
            const costLimit = parseInt(this.sliderNoise.value);
            
            fetch('/api/tuner', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.sessionToken}`
                },
                body: JSON.stringify({ nodes, speed, costLimit })
            })
            .then(res => {
                if (res.status === 401) {
                    this.checkAuth();
                }
            })
            .catch(err => console.error("Error updating tuner:", err));
        };

        // Speed Slider Listeners
        this.sliderSpeed.addEventListener('mousedown', () => { this.isDraggingSpeed = true; });
        this.sliderSpeed.addEventListener('touchstart', () => { this.isDraggingSpeed = true; });
        this.sliderSpeed.addEventListener('mouseup', () => { this.isDraggingSpeed = false; });
        this.sliderSpeed.addEventListener('touchend', () => { this.isDraggingSpeed = false; });
        this.sliderSpeed.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            this.valSpeed.textContent = val.toFixed(1) + 'x';
            this.space.coreSpeed = val;
            this.playBeep(220 + val * 50, 0.02, 0.015);
        });
        this.sliderSpeed.addEventListener('change', () => {
            this.isDraggingSpeed = false;
            updateTunerBackend();
        });

        // Particles Slider Listeners
        this.sliderParticles.addEventListener('mousedown', () => { this.isDraggingParticles = true; });
        this.sliderParticles.addEventListener('touchstart', () => { this.isDraggingParticles = true; });
        this.sliderParticles.addEventListener('mouseup', () => { this.isDraggingParticles = false; });
        this.sliderParticles.addEventListener('touchend', () => { this.isDraggingParticles = false; });
        this.sliderParticles.addEventListener('input', (e) => {
            const val = parseInt(e.target.value);
            this.valParticles.textContent = val + ' Nodes';
            this.metricNodes.textContent = val;
            
            const projectedCost = 100 * val + 100;
            this.metricCost.textContent = '$' + projectedCost.toLocaleString();
        });
        this.sliderParticles.addEventListener('change', (e) => {
            this.isDraggingParticles = false;
            const val = parseInt(e.target.value);
            const particleCount = val * 250;
            this.space.createNebulaParticles(particleCount);
            
            this.renderNodeGrid(val, this.space.systemState);
            this.playBeep(330, 0.15, 0.03);
            updateTunerBackend();
        });

        // Noise/Budget Slider Listeners
        this.sliderNoise.addEventListener('mousedown', () => { this.isDraggingNoise = true; });
        this.sliderNoise.addEventListener('touchstart', () => { this.isDraggingNoise = true; });
        this.sliderNoise.addEventListener('mouseup', () => { this.isDraggingNoise = false; });
        this.sliderNoise.addEventListener('touchend', () => { this.isDraggingNoise = false; });
        this.sliderNoise.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            this.valNoise.textContent = '$' + val.toLocaleString();
            this.playBeep(440 - val * 0.02, 0.02, 0.01);
        });
        this.sliderNoise.addEventListener('change', () => {
            this.isDraggingNoise = false;
            updateTunerBackend();
        });

        // Prompt Console POST
        this.promptForm.addEventListener('submit', (e) => {
            e.preventDefault();
            this.submitPromptCommand();
        });

        // Simulator Launchers POST
        this.simDdosBtn.addEventListener('click', () => {
            this.postSimulationTrigger('ddos');
        });
        
        this.simDbBtn.addEventListener('click', () => {
            this.postSimulationTrigger('db');
        });

        this.simCostBtn.addEventListener('click', () => {
            this.postSimulationTrigger('cost');
        });

        const handleCardKey = (e, incidentType) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                this.postSimulationTrigger(incidentType);
            }
        };

        this.simDdosBtn.addEventListener('keydown', (e) => handleCardKey(e, 'ddos'));
        this.simDbBtn.addEventListener('keydown', (e) => handleCardKey(e, 'db'));
        this.simCostBtn.addEventListener('keydown', (e) => handleCardKey(e, 'cost'));

        // HITL Gate Approval POST clicks
        this.btnHitlApprove.addEventListener('click', () => {
            this.submitHITLDecision(true);
        });

        this.btnHitlDeny.addEventListener('click', () => {
            this.submitHITLDecision(false);
        });
        
        // Pinned HUD metrics handler
        document.addEventListener('click', (e) => {
            if (e.target && e.target.classList.contains('chat-chart-pin-btn')) {
                const chartId = e.target.getAttribute('data-chart-id');
                this.pinChartToHUD(chartId);
            }
        });
        
        // Back to Cluster zoom dblclick reset
        if (this.btnExitExplode) {
            this.btnExitExplode.addEventListener('click', () => {
                if (this.space && typeof this.space.exitExplodeNode === 'function') {
                    this.space.exitExplodeNode();
                }
            });
        }

        // SRE Left sidebar tabs toggle
        if (this.tabTicketInfo && this.tabGuardrailRules) {
            this.tabTicketInfo.addEventListener('click', () => {
                this.tabTicketInfo.classList.add('active');
                this.tabGuardrailRules.classList.remove('active');
                this.contentTicketInfo.classList.remove('hidden');
                this.contentGuardrailRules.classList.add('hidden');
                this.playBeep(440, 0.05, 0.02);
            });
            this.tabGuardrailRules.addEventListener('click', () => {
                this.tabGuardrailRules.classList.add('active');
                this.tabTicketInfo.classList.remove('active');
                this.contentGuardrailRules.classList.remove('hidden');
                this.contentTicketInfo.classList.add('hidden');
                this.playBeep(440, 0.05, 0.02);
            });
        }
        
        // SRE policy deployment simulation
        if (this.btnDeployPolicy) {
            this.btnDeployPolicy.addEventListener('click', () => {
                const rules = this.policyRulesInput.value.trim() || "Default behavior constraints";
                const agent = this.policyAgentSelect.value;
                this.addTerminalLine(`[SECURITY] Compiling runtime guardrail rules for agent ${agent}...`, 'sentry');
                this.playBeep(880, 0.1, 0.04);
                
                setTimeout(() => {
                    this.addTerminalLine(`[SECURITY] POLICY DEPLOYED: "${rules}" applied to runtime. permissions verified.`, 'nominal');
                    this.playBeep(1200, 0.15, 0.05);
                }, 800);
            });
        }
        
        window.addEventListener('click', () => {
            if (this.audioContext && this.audioContext.state === 'suspended') {
                this.audioContext.resume();
            }
        });
    }

    /**
     * Web Audio API Synthesizer Core (Spatial Sound Fields)
     */
    initAudio() {
        try {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            this.audioContext = new AudioContextClass();
            
            this.mainOutput = this.audioContext.createGain();
            this.mainOutput.gain.setValueAtTime(0.0, this.audioContext.currentTime);
            this.mainOutput.connect(this.audioContext.destination);

            // Space Drone Synth setup
            this.synthDroneOsc1 = this.audioContext.createOscillator();
            this.synthDroneOsc2 = this.audioContext.createOscillator();
            this.synthDroneFilter = this.audioContext.createBiquadFilter();
            this.synthDroneGain = this.audioContext.createGain();

            this.synthDroneOsc1.type = 'sawtooth';
            this.synthDroneOsc1.frequency.setValueAtTime(55.0, this.audioContext.currentTime);
            
            this.synthDroneOsc2.type = 'triangle';
            this.synthDroneOsc2.frequency.setValueAtTime(82.4, this.audioContext.currentTime);

            this.synthDroneFilter.type = 'lowpass';
            this.synthDroneFilter.frequency.setValueAtTime(120, this.audioContext.currentTime);
            this.synthDroneFilter.Q.setValueAtTime(4.0, this.audioContext.currentTime);

            this.lfo = this.audioContext.createOscillator();
            this.lfoGain = this.audioContext.createGain();
            this.lfo.frequency.setValueAtTime(0.15, this.audioContext.currentTime);
            this.lfoGain.gain.setValueAtTime(40, this.audioContext.currentTime);

            this.lfo.connect(this.lfoGain);
            this.lfoGain.connect(this.synthDroneFilter.frequency);

            this.synthDroneGain.gain.setValueAtTime(0.04, this.audioContext.currentTime);

            this.synthDroneOsc1.connect(this.synthDroneFilter);
            this.synthDroneOsc2.connect(this.synthDroneFilter);
            this.synthDroneFilter.connect(this.synthDroneGain);
            this.synthDroneGain.connect(this.mainOutput);

            this.synthDroneOsc1.start();
            this.synthDroneOsc2.start();
            this.lfo.start();

        } catch (e) {
            console.error("Web Audio API not supported on this platform: ", e);
        }
    }

    toggleAudio() {
        if (!this.audioContext) {
            this.initAudio();
        }

        if (this.audioContext.state === 'suspended') {
            this.audioContext.resume();
        }

        const btnText = this.audioBtn.querySelector('.btn-text');

        if (this.synthActive) {
            this.mainOutput.gain.exponentialRampToValueAtTime(0.0001, this.audioContext.currentTime + 0.5);
            this.audioBtn.classList.remove('playing');
            btnText.textContent = "MUTED";
            this.synthActive = false;
        } else {
            this.mainOutput.gain.linearRampToValueAtTime(1.0, this.audioContext.currentTime + 0.3);
            this.audioBtn.classList.add('playing');
            btnText.textContent = "ACTIVE";
            this.synthActive = true;
            this.playBeep(220, 0.4, 0.08);
        }
    }

    playBeep(frequency, duration, volume = 0.04) {
        if (!this.audioContext || !this.synthActive) return;

        const osc = this.audioContext.createOscillator();
        const gain = this.audioContext.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(frequency, this.audioContext.currentTime);
        osc.frequency.exponentialRampToValueAtTime(frequency * 0.4, this.audioContext.currentTime + duration);

        gain.gain.setValueAtTime(volume, this.audioContext.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, this.audioContext.currentTime + duration);

        osc.connect(gain);
        gain.connect(this.mainOutput);

        osc.start();
        osc.stop(this.audioContext.currentTime + duration);
    }

    startAlarm() {
        if (!this.audioContext || !this.synthActive || this.alarmOsc) return;

        this.alarmOsc = this.audioContext.createOscillator();
        this.alarmLfo = this.audioContext.createOscillator();
        const alarmLfoGain = this.audioContext.createGain();
        this.alarmGainNode = this.audioContext.createGain();

        this.alarmOsc.type = 'sawtooth';
        this.alarmOsc.frequency.setValueAtTime(240, this.audioContext.currentTime);

        this.alarmLfo.type = 'sine';
        this.alarmLfo.frequency.setValueAtTime(1.8, this.audioContext.currentTime);
        alarmLfoGain.gain.setValueAtTime(60, this.audioContext.currentTime);

        this.alarmGainNode.gain.setValueAtTime(0.04, this.audioContext.currentTime);

        this.alarmLfo.connect(alarmLfoGain);
        alarmLfoGain.connect(this.alarmOsc.frequency);

        this.alarmOsc.connect(this.alarmGainNode);
        this.alarmGainNode.connect(this.mainOutput);

        this.alarmOsc.start();
        this.alarmLfo.start();
    }

    stopAlarm() {
        if (this.alarmOsc) {
            try { this.alarmOsc.stop(); } catch (_) {}
            try { this.alarmLfo.stop(); } catch (_) {}
            this.alarmOsc = null;
            this.alarmLfo = null;
            // FIX: null alarmGainNode to release audio graph reference
            this.alarmGainNode = null;
        }
    }

    // 3D Spatial Audio Panner generation. Sets coordinate positions of panners
    // relative to the listener's camera matrix.
    playAgentPing(agentName) {
        if (!this.audioContext || !this.synthActive) return;
        
        const osc = this.audioContext.createOscillator();
        const gain = this.audioContext.createGain();
        const panner = this.audioContext.createPanner();
        
        // Define audio coordinates relative to 3D causal mesh node layout
        let x = 0, y = -0.5, z = 0;
        let frequency = 440;
        
        if (agentName === 'Orchestrator') {
            frequency = 523.25; // Center core (0,0,0)
        } else if (agentName === 'Sentry') {
            frequency = 659.25;
            x = 3.5; // Right node
        } else if (agentName === 'Vanguard') {
            frequency = 783.99;
            x = -3.5; // Left node
        } else if (agentName === 'Tecton') {
            frequency = 880.00;
            z = 3.5; // Front node
        }
        
        // Configure Panner Node for spatial decay
        panner.panningModel = 'HRTF';
        panner.distanceModel = 'inverse';
        panner.refDistance = 1;
        panner.maxDistance = 50;
        panner.rolloffFactor = 1.2;
        
        if (panner.positionX) {
            panner.positionX.setValueAtTime(x, this.audioContext.currentTime);
            panner.positionY.setValueAtTime(y, this.audioContext.currentTime);
            panner.positionZ.setValueAtTime(z, this.audioContext.currentTime);
        } else {
            panner.setPosition(x, y, z);
        }
        
        osc.type = 'sine';
        osc.frequency.setValueAtTime(frequency, this.audioContext.currentTime);
        osc.frequency.exponentialRampToValueAtTime(frequency * 0.4, this.audioContext.currentTime + 0.2);
        
        gain.gain.setValueAtTime(0.06, this.audioContext.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, this.audioContext.currentTime + 0.2);
        
        osc.connect(gain);
        gain.connect(panner);
        panner.connect(this.mainOutput);
        
        osc.start();
        osc.stop(this.audioContext.currentTime + 0.2);
    }

    /**
     * BUG-003 FIX: Safe HTML escaping helper — prevents XSS from server text
     */
    escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    formatMessageText(text) {
        if (!text) return '';
        let escaped = this.escapeHtml(text);

        // Parse code blocks: ```lang ... ```
        escaped = escaped.replace(/```(?:[a-zA-Z0-9_-]+)?\n([\s\S]+?)\n```/g, (match, code) => {
            return `<pre><code>${code}</code></pre>`;
        });

        // Parse inline code: `code`
        escaped = escaped.replace(/`([^`]+)`/g, (match, code) => {
            return `<code>${code}</code>`;
        });

        return escaped;
    }

    addTerminalLine(text, type = 'info') {
        if (!this.terminalBody) return;
        const p = document.createElement('p');
        const timeStr = new Date().toLocaleTimeString();
        let colorClass = 'cyan';
        if (type === 'anomaly' || type === 'critical' || type === 'attack' || type === 'vanguard') colorClass = 'red';
        if (type === 'resolving' || type === 'sentry') colorClass = 'yellow';
        if (type === 'nominal' || type === 'tecton') colorClass = 'green';
        
        p.innerHTML = `<span style="color: var(--text-secondary); font-family: monospace;">[${timeStr}]</span> <span class="${colorClass}">&gt; ${this.escapeHtml(text)}</span>`;
        this.terminalBody.appendChild(p);
        this.terminalBody.scrollTop = this.terminalBody.scrollHeight;
    }

    /**
     * Agent Console Communication
     */
    addChatBubble(agentName, text, chartData = null) {
        const placeholder = this.chatFeed.querySelector('.chat-placeholder');
        if (placeholder) {
            placeholder.remove();
        }

        const bubble = document.createElement('div');
        // Sanitize agentName for safe class usage
        const lowerName = String(agentName).toLowerCase().replace(/[^a-z]/g, '');
        bubble.className = `chat-bubble ${lowerName}`;

        // BUG-003 FIX: Build DOM nodes manually — NO innerHTML with server data
        const agentNameEl = document.createElement('span');
        agentNameEl.className = 'agent-name';
        agentNameEl.textContent = `${String(agentName).toUpperCase()} // AGENT_ONLINE`;
        bubble.appendChild(agentNameEl);

        const messageEl = document.createElement('span');
        messageEl.className = 'message-text';
        messageEl.innerHTML = this.formatMessageText(text);
        bubble.appendChild(messageEl);

        const hasMetrics = text.includes('Latency') || text.includes('IOPS') || text.includes('utilisation') || text.includes('timeout') || text.includes('breach') || (chartData && chartData.type === 'trace');
        let chartId = '';
        if (hasMetrics) {
            chartId = `chat-chart-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
            const chartWrapper = document.createElement('div');
            chartWrapper.className = 'chat-chart-wrapper';
            chartWrapper.style.cssText = 'position:relative; margin-top: 0.5rem;';

            const chartCanvas = document.createElement('canvas');
            chartCanvas.id = chartId;
            chartCanvas.className = 'chat-bubble-chart';
            chartCanvas.width = 300;
            if (chartData && chartData.type === 'trace') {
                chartCanvas.height = Math.max(60, chartData.spans.length * 14 + 10);
            } else {
                chartCanvas.height = 60;
            }
            chartWrapper.appendChild(chartCanvas);

            // Hide Pin button for traces
            if (!chartData || chartData.type !== 'trace') {
                const pinBtn = document.createElement('button');
                pinBtn.className = 'chat-chart-pin-btn';
                pinBtn.setAttribute('data-chart-id', chartId);
                pinBtn.textContent = 'PIN TO HUD';
                chartWrapper.appendChild(pinBtn);

                const scrubVal = document.createElement('div');
                scrubVal.className = 'chat-chart-scrub-val hidden';
                scrubVal.id = `scrub-${chartId}`;
                chartWrapper.appendChild(scrubVal);
            }

            bubble.appendChild(chartWrapper);
        }

        this.chatFeed.appendChild(bubble);
        
        // Print to log terminal — textContent is already safe
        this.addTerminalLine(`[${String(agentName).toUpperCase()}] ${text}`, lowerName);
        
        // Render chart inside chat bubble if needed
        if (hasMetrics && chartId) {
            setTimeout(() => {
                const chartCanvas = document.getElementById(chartId);
                if (chartCanvas) {
                    this.drawChatBubbleChart(chartCanvas, text, -1, chartData);
                }
            }, 50);
        }

        // GSAP entrance animation
        gsap.from(bubble, {
            opacity: 0,
            y: 20,
            duration: 0.35,
            ease: 'power2.out'
        });
        
        this.chatFeed.scrollTop = this.chatFeed.scrollHeight;
        
        // Trigger 3D spatial ping sound
        this.playAgentPing(agentName);
    }

    drawChatBubbleChart(canvas, text, scrubIndex = -1, chartData = null) {
        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;
        
        let type = 'nominal';
        if (text.includes('DDoS') || text.includes('Latency') || text.includes('latency')) type = 'ddos';
        else if (text.includes('timeout') || text.includes('flatlined') || text.includes('IOPS')) type = 'flatline';
        else if (text.includes('idle') || text.includes('utilisation')) type = 'scale-down';
        
        ctx.clearRect(0, 0, width, height);
        
        if (chartData && chartData.type === 'trace') {
            const spans = chartData.spans;
            const maxDuration = Math.max(...spans.map(s => s.start + s.duration));
            const barHeight = 8;
            const spacing = 6;
            
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.02)';
            ctx.lineWidth = 0.5;
            for (let i = 0; i < height; i += 12) {
                ctx.beginPath();
                ctx.moveTo(0, i);
                ctx.lineTo(width, i);
                ctx.stroke();
            }

            spans.forEach((span, idx) => {
                const y = 8 + idx * (barHeight + spacing);
                const xStart = (span.start / maxDuration) * (width - 150);
                const xWidth = (span.duration / maxDuration) * (width - 150);
                
                if (span.level > 0) {
                    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
                    ctx.lineWidth = 0.5;
                    ctx.beginPath();
                    const parentY = y - (barHeight + spacing) / 2 - barHeight / 2;
                    ctx.moveTo(xStart + 2, parentY);
                    ctx.lineTo(xStart + 2, y + barHeight / 2);
                    ctx.lineTo(xStart + 8, y + barHeight / 2);
                    ctx.stroke();
                }

                ctx.fillStyle = span.status === 'error' ? 'rgba(255, 0, 127, 0.75)' : 'rgba(57, 255, 20, 0.75)';
                ctx.fillRect(xStart + 10, y, Math.max(3, xWidth), barHeight);
                
                ctx.fillStyle = '#8a8a9f';
                ctx.font = '6.5px monospace';
                ctx.fillText(`${span.service} (${span.duration}ms)`, xStart + xWidth + 16, y + 6);
            });
            return;
        }
        
        // Subtle grid lines
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
        ctx.lineWidth = 0.5;
        for (let i = 0; i < width; i += 30) {
            ctx.beginPath();
            ctx.moveTo(i, 0);
            ctx.lineTo(i, height);
            ctx.stroke();
        }
        for (let i = 0; i < height; i += 15) {
            ctx.beginPath();
            ctx.moveTo(0, i);
            ctx.lineTo(width, i);
            ctx.stroke();
        }
        
        const points = [];
        let strokeColor = '#00f3ff';
        if (type === 'ddos' || type === 'flatline') strokeColor = '#ff007f';
        else if (type === 'scale-down') strokeColor = '#ffea00';

        const forecastPoints = [];
        let combinedPoints = [];
        if (chartData && chartData.coordinates && chartData.coordinates.length > 0) {
            const coords = chartData.coordinates;
            const forecast = chartData.forecast || [];
            const allCoords = coords.concat(forecast);
            
            const count = coords.length;
            const totalCount = allCoords.length;
            const step = width / (totalCount - 1);
            
            const vals = allCoords.map(c => c[1]);
            const minVal = Math.min(...vals);
            const maxVal = Math.max(...vals);
            const valRange = maxVal - minVal || 1.0;
            
            for (let i = 0; i < count; i++) {
                const val = coords[i][1];
                const pct = (val - minVal) / valRange;
                const y = height - 5 - pct * (height - 10);
                points.push({ x: i * step, y: Math.max(2, Math.min(height - 2, y)) });
            }
            
            if (forecast.length > 0) {
                // Connect forecast start from the last historical point
                forecastPoints.push(points[points.length - 1]);
                for (let i = 0; i < forecast.length; i++) {
                    const val = forecast[i][1];
                    const pct = (val - minVal) / valRange;
                    const y = height - 5 - pct * (height - 10);
                    forecastPoints.push({ x: (count + i) * step, y: Math.max(2, Math.min(height - 2, y)) });
                }
            }
            
            combinedPoints = points.concat(forecastPoints.slice(1));
            
            if (chartData.metric === 'latency' || type === 'ddos') strokeColor = '#ff007f';
            else if (chartData.metric === 'cpu' && type === 'scale-down') strokeColor = '#ffea00';
            else if (chartData.metric === 'cpu') strokeColor = '#ff007f';
        } else {
            const count = 40;
            const step = width / (count - 1);
            
            for (let i = 0; i < count; i++) {
                let y = 0;
                const progress = i / (count - 1);
                
                if (type === 'ddos') {
                    if (progress < 0.6) {
                        y = height * 0.7 + Math.sin(progress * 15) * 3 + (Math.random() - 0.5) * 2;
                    } else {
                        const spikeProg = (progress - 0.6) / 0.4;
                        y = height * 0.7 - spikeProg * (height * 0.6) + Math.sin(progress * 30) * 4 + (Math.random() - 0.5) * 2;
                    }
                } else if (type === 'flatline') {
                    if (progress < 0.4) {
                        y = height * 0.3 + Math.sin(progress * 25) * 4 + (Math.random() - 0.5) * 2;
                    } else if (progress < 0.6) {
                        const dropProg = (progress - 0.4) / 0.2;
                        y = height * 0.3 + dropProg * (height * 0.5) + (Math.random() - 0.5) * 2;
                    } else {
                        y = height * 0.85 + (Math.random() - 0.5) * 0.5;
                    }
                } else if (type === 'scale-down') {
                    if (progress < 0.5) {
                        y = height * 0.35 + Math.sin(progress * 20) * 2;
                    } else {
                        y = height * 0.65 + Math.sin(progress * 20) * 2;
                    }
                } else {
                    y = height * 0.5 + Math.sin(progress * 12) * 8 + (Math.random() - 0.5) * 1.5;
                }
                
                points.push({ x: i * step, y: Math.max(2, Math.min(height - 2, y)) });
            }
            combinedPoints = points;
        }
        
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 1.5;
        ctx.shadowColor = strokeColor;
        ctx.shadowBlur = 6;
        
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) {
            ctx.lineTo(points[i].x, points[i].y);
        }
        ctx.stroke();
        
        // Draw forecast dashed line
        if (forecastPoints.length > 0) {
            ctx.shadowBlur = 3;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(forecastPoints[0].x, forecastPoints[0].y);
            for (let i = 1; i < forecastPoints.length; i++) {
                ctx.lineTo(forecastPoints[i].x, forecastPoints[i].y);
            }
            ctx.stroke();
            ctx.setLineDash([]);
        }
        
        ctx.shadowBlur = 0;
        
        const grad = ctx.createLinearGradient(0, 0, 0, height);
        let gradColor = 'rgba(0, 243, 255, 0.15)';
        if (strokeColor === '#ff007f') gradColor = 'rgba(255, 0, 127, 0.15)';
        else if (strokeColor === '#ffea00') gradColor = 'rgba(255, 234, 0, 0.15)';
        
        grad.addColorStop(0, gradColor);
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(combinedPoints[0].x, height);
        for (let i = 0; i < combinedPoints.length; i++) {
            ctx.lineTo(combinedPoints[i].x, combinedPoints[i].y);
        }
        ctx.lineTo(combinedPoints[combinedPoints.length - 1].x, height);
        ctx.closePath();
        ctx.fill();

        // Render vertical cursor and dot if scrubIndex is active
        if (scrubIndex >= 0 && scrubIndex < combinedPoints.length) {
            const pt = combinedPoints[scrubIndex];
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
            ctx.lineWidth = 1;
            ctx.setLineDash([2, 2]);
            ctx.beginPath();
            ctx.moveTo(pt.x, 0);
            ctx.lineTo(pt.x, height);
            ctx.stroke();
            ctx.setLineDash([]);

            ctx.fillStyle = strokeColor;
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, 3.5, 0, Math.PI * 2);
            ctx.fill();
        }

        // Setup scrubbing listeners if they are not already active on this canvas
        if (!canvas.hasScrubListeners) {
            canvas.hasScrubListeners = true;
            
            const handleMouseMove = (e) => {
                const rect = canvas.getBoundingClientRect();
                const mouseX = e.clientX - rect.left;
                const coords = (chartData && chartData.coordinates) ? chartData.coordinates : [];
                const forecast = (chartData && chartData.forecast) ? chartData.forecast : [];
                const allCoords = coords.concat(forecast);
                const pointsCount = allCoords.length || 40;
                const idx = Math.max(0, Math.min(pointsCount - 1, Math.round((mouseX / rect.width) * (pointsCount - 1))));
                
                // Redraw with vertical line
                this.drawChatBubbleChart(canvas, text, idx, chartData);
                
                // Update scrub value tooltip
                let scrubValDiv = document.getElementById(`scrub-${canvas.id}`);
                if (!scrubValDiv) {
                    scrubValDiv = document.createElement('div');
                    scrubValDiv.id = `scrub-${canvas.id}`;
                    scrubValDiv.className = 'chat-chart-scrub-val';
                    canvas.parentElement.appendChild(scrubValDiv);
                }
                
                if (allCoords.length > 0 && allCoords[idx]) {
                    const val = allCoords[idx][1];
                    const timeSec = allCoords[idx][0];
                    const timeStr = new Date(timeSec * 1000).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'});
                    const isForecast = idx >= coords.length;
                    const label = isForecast ? ' (FORECAST)' : '';
                    scrubValDiv.textContent = `${chartData.pod.toUpperCase()} ${chartData.metric.toUpperCase()}${label}: ${val} (${timeStr})`;
                } else {
                    const progress = idx / (pointsCount - 1);
                    scrubValDiv.textContent = this.getMetricScrubValue(type, progress);
                }
                
                scrubValDiv.classList.remove('hidden');
                
                // Position overlay
                scrubValDiv.style.left = `${mouseX + 10}px`;
                scrubValDiv.style.top = `${e.clientY - rect.top - 20}px`;
            };
            
            const handleMouseLeave = () => {
                this.drawChatBubbleChart(canvas, text, -1, chartData);
                const scrubValDiv = document.getElementById(`scrub-${canvas.id}`);
                if (scrubValDiv) {
                    scrubValDiv.classList.add('hidden');
                }
            };
            
            canvas.addEventListener('mousemove', handleMouseMove);
            canvas.addEventListener('mouseleave', handleMouseLeave);
        }
    }

    getMetricScrubValue(type, progress) {
        if (type === 'ddos') {
            let val = 0;
            if (progress < 0.6) {
                val = Math.round(48 + Math.sin(progress * 15) * 3);
            } else {
                const spikeProg = (progress - 0.6) / 0.4;
                val = Math.round(48 + spikeProg * (540 - 48) + Math.sin(progress * 30) * 4);
            }
            return `Latency: ${val} ms`;
        } else if (type === 'flatline') {
            let val = 0;
            if (progress < 0.4) {
                val = Math.round(1200 + Math.sin(progress * 25) * 40);
            } else if (progress < 0.6) {
                const dropProg = (progress - 0.4) / 0.2;
                val = Math.round(1200 * (1 - dropProg));
            } else {
                val = 0;
            }
            return `IOPS: ${val}`;
        } else if (type === 'scale-down') {
            let val = 0;
            if (progress < 0.5) {
                val = (8.4 + Math.sin(progress * 20) * 0.4).toFixed(1);
            } else {
                val = (4.2 + Math.sin(progress * 20) * 0.2).toFixed(1);
            }
            return `CPU: ${val}%`;
        } else {
            let val = Math.round(48 + Math.sin(progress * 12) * 8);
            return `Latency: ${val} ms`;
        }
    }


    submitPromptCommand() {
        const cmd = this.promptInput.value.trim();
        if (!cmd) return;
        this.promptInput.value = '';

        if (this.space && typeof this.space.createParticleBurst === 'function') {
            this.space.createParticleBurst(new THREE.Vector3(0, 1.0, 0), 0x00f3ff, 50);
        }

        fetch('/api/command', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.sessionToken}`
            },
            body: JSON.stringify({ command: cmd })
        })
        .then(res => {
            if (res.status === 401) {
                this.sessionToken = '';
                localStorage.removeItem('helix_session_token');
                this.checkAuth();
            }
        })
        .catch(err => console.error("Error submitting command: ", err));
    }

    postSimulationTrigger(incidentType) {
        if (this.terminalOutput) {
            this.terminalOutput.classList.remove('hidden');
        }
        fetch('/api/incident', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.sessionToken}`
            },
            body: JSON.stringify({ type: incidentType })
        })
        .then(async res => {
            if (res.status === 401) {
                this.sessionToken = '';
                localStorage.removeItem('helix_session_token');
                this.checkAuth();
            } else if (!res.ok) {
                const data = await res.json();
                this.addTerminalLine(`[ERROR] ${data.error || 'Trigger failed'}`, 'anomaly');
            }
        })
        .catch(err => console.error(`Error launching simulation ${incidentType}: `, err));
    }

    // Submit HITL Decision to the backend SRE pipeline
    submitHITLDecision(approved) {
        // FIX: Hide modal optimistically, restore on failure
        this.hideHITLModal();
        
        // Play positive approval chirp or negative denial click
        if (approved) {
            this.playBeep(660, 0.25, 0.05); // High chirp
        } else {
            this.playBeep(180, 0.3, 0.05); // Low buzz
        }

        fetch('/api/approve', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.sessionToken}`
            },
            body: JSON.stringify({ approved })
        })
        .then(async res => {
            if (res.status === 401) {
                this.checkAuth();
            } else if (!res.ok) {
                // FIX: POST failed — re-show modal so user can retry
                const data = await res.json().catch(() => ({}));
                this.addTerminalLine(`[ERROR] Approval submission failed: ${data.error || res.statusText}`, 'anomaly');
                // Re-show the modal for retry
                if (this.lastApprovalDetails) {
                    this.showHITLModal(this.lastApprovalDetails);
                }
            }
        })
        .catch(err => {
            console.error("Error submitting approval decision: ", err);
            this.addTerminalLine('[ERROR] Network error submitting HITL decision.', 'anomaly');
        });
    }

    /**
     * FPS Metrics
     */
    measureFPS() {
        const calculateFPS = () => {
            const time = performance.now();
            this.frameCount++;
            
            const frameLatency = time - this.lastFrameTime;
            
            // Pass audio context time to SpaceEngine to schedule listeners
            if (this.audioContext && this.space) {
                this.space.audioContextTimeProxy = this.audioContext.currentTime;
            }
            
            if (time >= this.lastFPSUpdate + 1000) {
                const fps = Math.round((this.frameCount * 1000) / (time - this.lastFPSUpdate));
                
                this.fpsDisplay.textContent = `FPS: ${fps}`;
                this.metricFps.textContent = fps;
                if (this.metricLatency) {
                    this.metricLatency.textContent = frameLatency.toFixed(1) + 'ms';
                }
                
                const syncVal = (99 + Math.random() * 0.99).toFixed(2);
                if (this.syncPercent) {
                    this.syncPercent.textContent = `${syncVal}%`;
                }
                
                this.handleAutoScaling(fps);

                this.frameCount = 0;
                this.lastFPSUpdate = time;
            }

            this.lastFrameTime = time;
            requestAnimationFrame(calculateFPS);
        };

        this.lastFPSUpdate = performance.now();
        requestAnimationFrame(calculateFPS);
    }

    handleAutoScaling(fps) {
        this.fpsList.push(fps);
        if (this.fpsList.length > 5) this.fpsList.shift();
        
        if (this.fpsList.length === 5) {
            const avg = this.fpsList.reduce((a, b) => a + b) / 5;
            
            // Downscale when avg FPS < 35 and particles are above minimum
            if (avg < 35 && this.space.particleCountSetting > 1500) {
                const currentCount = this.space.particleCountSetting;
                const newCount = Math.max(1500, Math.floor(currentCount * 0.7));
                
                this.space.particleCountSetting = newCount;
                this.space.createNebulaParticles(newCount);

                const terminalMini = document.getElementById('active-agents-mini');
                if (terminalMini) {
                    const warnMsg = document.createElement('p');
                    warnMsg.innerHTML = `&gt; core_optimizer: <span class="red">AUTO_DOWNSCALE [${newCount}]</span>`;
                    terminalMini.appendChild(warnMsg);
                }
                
                this.playBeep(220, 0.4, 0.05); 
                this.fpsList = [];
            }
            // FIX: Upscale recovery — if avg FPS > 55 and below target particle count
            else if (avg > 55 && this.space.particleCountSetting < 4500) {
                const currentCount = this.space.particleCountSetting;
                const newCount = Math.min(4500, Math.floor(currentCount * 1.3));

                this.space.particleCountSetting = newCount;
                this.space.createNebulaParticles(newCount);

                const terminalMini = document.getElementById('active-agents-mini');
                if (terminalMini) {
                    const warnMsg = document.createElement('p');
                    warnMsg.innerHTML = `&gt; core_optimizer: <span class="green">AUTO_UPSCALE [${newCount}]</span>`;
                    terminalMini.appendChild(warnMsg);
                }

                this.fpsList = [];
            }
        }
    }

    /**
     * Text Scrambler Animation
     * BUG-009 FIX: setInterval is now tracked and cleared on mouseleave
     */
    initTextScrambler() {
        const targets = document.querySelectorAll('.main-title, #loader-title, .sidebar-header h2, .hud-section h2');
        
        targets.forEach(el => {
            const originalText = el.textContent;
            const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_#@$*";
            let scrambleInterval = null; // BUG-009 FIX: track interval reference
            
            el.addEventListener('mouseenter', () => {
                // Clear any previous in-flight scramble
                if (scrambleInterval) {
                    clearInterval(scrambleInterval);
                    scrambleInterval = null;
                }
                let iterations = 0;
                scrambleInterval = setInterval(() => {
                    el.textContent = originalText.split("")
                        .map((char, index) => {
                            if (char === " " || char === "/" || char === "." || char === ":") return char;
                            if (index < iterations) return originalText[index];
                            return letters[Math.floor(Math.random() * letters.length)];
                        })
                        .join("");
                    
                    if (iterations >= originalText.length) {
                        clearInterval(scrambleInterval);
                        scrambleInterval = null;
                        el.textContent = originalText;
                    }
                    
                    iterations += 1 / 3;
                }, 30);
            });

            // BUG-009 FIX: Cancel scramble and restore text if mouse leaves early
            el.addEventListener('mouseleave', () => {
                if (scrambleInterval) {
                    clearInterval(scrambleInterval);
                    scrambleInterval = null;
                    el.textContent = originalText;
                }
            });
        });
    }

    /**
     * BUG-002 FIX: PIN validation is now entirely server-side.
     * The client sends the PIN as a Bearer token; the server validates it.
     * Client-side never compares against a hardcoded value.
     */
    checkAuth() {
        if (!this.sessionToken) {
            // No token stored — show PIN gate
            if (this.pinOverlay) this.pinOverlay.classList.remove('hidden');
            return;
        }
        // Validate token by making an authenticated request to the server
        fetch('/api/history', {
            headers: { 'Authorization': `Bearer ${this.sessionToken}` }
        })
        .then(res => {
            if (res.ok) {
                if (this.pinOverlay) this.pinOverlay.classList.add('hidden');
                return res.json();
            } else {
                // Token invalid — clear storage and show gate
                this.sessionToken = '';
                localStorage.removeItem('helix_session_token');
                if (this.pinOverlay) this.pinOverlay.classList.remove('hidden');
                return null;
            }
        })
        .then(history => {
            if (history) this.renderIncidentHistory(history);
        })
        .catch(err => {
            console.error('Auth check failed (network error):', err);
            // On network error, optimistically keep session if token exists
            if (this.sessionToken && this.pinOverlay) {
                this.pinOverlay.classList.add('hidden');
            }
        });
    }

    submitPin(e) {
        e.preventDefault();
        const pin = this.pinInput.value.trim();
        if (!pin) return;

        // BUG-002 FIX: Validate PIN against the server, not client-side hardcode
        fetch('/api/history', {
            headers: { 'Authorization': `Bearer ${pin}` }
        })
        .then(res => {
            if (res.ok) {
                // Server accepted the PIN — store session token
                this.sessionToken = pin;
                localStorage.setItem('helix_session_token', pin);
                if (this.pinError) this.pinError.classList.add('hidden');
                
                // Fade out overlay via GSAP
                gsap.to(this.pinOverlay, {
                    opacity: 0,
                    duration: 0.4,
                    ease: 'power2.inOut',
                    onComplete: () => {
                        this.pinOverlay.classList.add('hidden');
                        this.pinOverlay.style.opacity = 1; // Reset opacity for next triggers
                    }
                });
                
                this.playBeep(880, 0.2, 0.06);
                return res.json();
            } else {
                // Server rejected — wrong PIN
                if (this.pinError) this.pinError.classList.remove('hidden');
                this.pinInput.value = '';
                this.playBeep(150, 0.4, 0.08); // Error low buzz
                return null;
            }
        })
        .then(history => {
            if (history) this.renderIncidentHistory(history);
        })
        .catch(err => {
            console.error('PIN submission failed:', err);
            if (this.pinError) {
                this.pinError.textContent = '❌ NETWORK ERROR — CANNOT REACH SERVER';
                this.pinError.classList.remove('hidden');
            }
        });
    }

    // Incident History logs loaders
    // BUG-007 FIX: Incident History fetch — throttled to max 1 request per 5 seconds
    loadIncidentHistory() {
        const now = Date.now();
        if (now - this.lastHistoryFetch < 5000) {
            return; // Throttled — skip this call
        }
        this.lastHistoryFetch = now;

        fetch('/api/history', {
            headers: { 'Authorization': `Bearer ${this.sessionToken}` }
        })
        .then(res => {
            if (res.status === 401) {
                this.checkAuth();
                return null;
            }
            return res.json();
        })
        .then(history => {
            if (history) this.renderIncidentHistory(history);
        })
        .catch(err => console.error("Failed to load incident history: ", err));
    }

    renderIncidentHistory(history) {
        if (!this.historyBody) return;
        if (!history || history.length === 0) {
            this.historyBody.innerHTML = '<div class="history-placeholder">No incident logs found.</div>';
            return;
        }

        this.historyBody.innerHTML = '';
        const fragment = document.createDocumentFragment();
        
        // Show newest events first
        const sorted = [...history].reverse();
        
        sorted.forEach(item => {
            const row = document.createElement('div');
            row.className = 'history-row';
            
            const timeStr = new Date(item.timestamp).toLocaleTimeString();
            const dateStr = new Date(item.timestamp).toLocaleDateString();
            // FIX: Use textContent for all server-sourced data — no XSS
            const typeLabel = String(item.type).toUpperCase();
            
            let statusText = String(item.status).toUpperCase();
            if (item.status === 'resolved') {
                statusText = item.actionApproved ? 'APPROVED RESOLUTION' : 'DENIED RESOLUTION';
            } else if (item.status === 'active') {
                statusText = 'RUNNING';
            }

            // Build DOM safely — no innerHTML with server data
            const timeEl = document.createElement('span');
            timeEl.className = 'history-time';
            timeEl.textContent = `${dateStr} ${timeStr}`;

            const nameEl = document.createElement('span');
            nameEl.className = 'history-name';
            nameEl.textContent = `${typeLabel} SIMULATION`;

            const statusEl = document.createElement('span');
            statusEl.className = `history-status ${String(item.status).replace(/[^a-z]/g, '')}`;
            statusEl.textContent = statusText;

            row.appendChild(timeEl);
            row.appendChild(nameEl);
            row.appendChild(statusEl);
            fragment.appendChild(row);
        });
        
        this.historyBody.appendChild(fragment);
    }

    showNodeDetails(nodeIdx, silent = false) {
        if (!this.nodeDetailsCard) return;
        
        if (this.monitorAnimationFrameId) {
            cancelAnimationFrame(this.monitorAnimationFrameId);
            this.monitorAnimationFrameId = null;
        }
        
        this.currentNodeIdx = nodeIdx;
        
        const name = this.nodeNames[nodeIdx] || `k8s-pod-node-${nodeIdx + 1}`;
        const ip = `10.244.1.${100 + nodeIdx}`;
        
        let statusText = "HEALTHY (NOMINAL)";
        let statusClass = "green-text";
        let isAnomaly = false;
        let cpu = Math.floor(Math.random() * 20) + 25; // 25-45% nominal
        let mem = Math.floor(Math.random() * 25) + 40; // 40-65% nominal
        let logs = `> Node initialized successfully.\n> Cluster state sync: nominal.\n> Port 8080 active. Ping 1.2ms.`;
        
        const activeNodes = this.lastSystemState ? this.lastSystemState.nodes : 24;
        const systemStatus = this.lastSystemState ? this.lastSystemState.status : 'nominal';
        const activeIncident = this.lastSystemState ? this.lastSystemState.activeIncident : null;
        
        if (this.lastSystemState && this.lastSystemState.nodeMetrics && this.lastSystemState.nodeMetrics[nodeIdx]) {
            const m = this.lastSystemState.nodeMetrics[nodeIdx];
            cpu = m.cpu;
            mem = m.mem;
            if (m.status === 'offline') {
                statusText = "OFFLINE (STANDBY)";
                statusClass = "purple-text";
                cpu = 0;
                mem = 0;
                logs = `> Host deprovisioned.\n> Standby limit active.\n> System cost boundaries optimal.`;
            } else if (m.status === 'overloaded') {
                statusText = "OVERLOADED (DDOS BREACH)";
                statusClass = "red-text";
                isAnomaly = true;
                logs = `> [ALERT] DDoS Traffic Flood detected.\n> Ingress Packets: 18,450/s.\n> Buffer overflow warnings.`;
            } else if (m.status === 'critical') {
                statusText = "CRITICAL (IOPS TIMEOUT)";
                statusClass = "red-text";
                isAnomaly = true;
                logs = `> [CRITICAL] db-master-01 write flatline.\n> [CRITICAL] Database replica sync broken.\n> IO timeout after 30s.`;
            }
        } else {
            // Fallback
            if (nodeIdx >= activeNodes) {
                statusText = "OFFLINE (STANDBY)";
                statusClass = "purple-text";
                cpu = 0;
                mem = 0;
                logs = `> Host deprovisioned.\n> Standby limit active.\n> System cost boundaries optimal.`;
            } else if (systemStatus === 'anomaly') {
                if (activeIncident === 'ddos' && nodeIdx < 12) {
                    statusText = "OVERLOADED (DDOS BREACH)";
                    statusClass = "red-text";
                    isAnomaly = true;
                    cpu = Math.floor(Math.random() * 8) + 92; // 92-99%
                    mem = Math.floor(Math.random() * 10) + 85; // 85-95%
                    logs = `> [ALERT] DDoS Traffic Flood detected.\n> Ingress Packets: 18,450/s.\n> Buffer overflow warnings.`;
                } else if (activeIncident === 'db' && nodeIdx === 21) {
                    statusText = "CRITICAL (IOPS TIMEOUT)";
                    statusClass = "red-text";
                    isAnomaly = true;
                    cpu = 100;
                    mem = 98;
                    logs = `> [CRITICAL] db-master-01 write flatline.\n> [CRITICAL] Database replica sync broken.\n> IO timeout after 30s.`;
                }
            }
        }
        
        // Update DOM
        document.getElementById('node-detail-id').textContent = name;
        document.getElementById('node-detail-ip').textContent = ip;
        document.getElementById('node-detail-role').textContent = this.nodeRoles[nodeIdx] || "Worker Microservice";
        
        const statusEl = document.getElementById('node-detail-status');
        statusEl.textContent = statusText;
        statusEl.className = `val ${statusClass}`;
        
        const indicator = document.getElementById('node-detail-status-indicator');
        indicator.className = 'node-status-indicator';
        if (nodeIdx >= activeNodes) {
            indicator.classList.add('resolving');
        } else if (isAnomaly) {
            indicator.classList.add('anomaly');
        }
        
        // Update live monitor tag details
        if (this.monitorTag) {
            this.monitorTag.textContent = `LIVE FEED // ${name.toUpperCase()} // ${statusText}`;
        }
        if (this.monitorScreenContainer) {
            this.monitorScreenContainer.className = 'monitor-screen-container';
            if (isAnomaly) {
                this.monitorScreenContainer.classList.add('anomaly');
            }
        }
        
        document.getElementById('node-detail-cpu-val').textContent = cpu + "%";
        document.getElementById('node-detail-mem-val').textContent = mem + "%";
        
        const cpuFill = document.getElementById('node-detail-cpu-fill');
        const memFill = document.getElementById('node-detail-mem-fill');
        
        cpuFill.className = 'meter-bar-fill';
        memFill.className = 'meter-bar-fill';
        if (isAnomaly) {
            cpuFill.classList.add('anomaly');
            memFill.classList.add('anomaly');
        }
        
        gsap.to(cpuFill, { width: cpu + "%", duration: 0.6, ease: "power2.out" });
        gsap.to(memFill, { width: mem + "%", duration: 0.6, ease: "power2.out" });
        
        document.getElementById('node-detail-log-pre').textContent = logs;
        
        // Show panel
        this.nodeDetailsCard.classList.remove('hidden');
        gsap.fromTo(this.nodeDetailsCard, 
            { x: '120%', opacity: 0 }, 
            { x: '0%', opacity: 1, duration: 0.5, ease: 'power3.out', overwrite: 'auto' }
        );
        
        // Initialize monitor loops
        this.drawMonitorLoop(nodeIdx);
        
        if (!silent) {
            this.playBeep(660, 0.1, 0.03);
        }
    }

    hideNodeDetails() {
        if (!this.nodeDetailsCard) return;
        this.currentNodeIdx = undefined;
        
        if (this.space) {
            this.space.pinnedNodeIdx = null;
            this.space.highlightCallPath(null);
        }
        
        if (this.monitorAnimationFrameId) {
            cancelAnimationFrame(this.monitorAnimationFrameId);
            this.monitorAnimationFrameId = null;
        }
        
        gsap.to(this.nodeDetailsCard, {
            x: '120%',
            opacity: 0,
            duration: 0.4,
            ease: 'power3.in',
            onComplete: () => {
                this.nodeDetailsCard.classList.add('hidden');
            }
        });
        this.playBeep(440, 0.08, 0.02);
    }

    drawMonitorLoop(nodeIdx) {
        if (!this.monitorCtx || !this.monitorCanvas) return;
        
        const ctx = this.monitorCtx;
        const canvas = this.monitorCanvas;
        const width = canvas.width;
        const height = canvas.height;
        
        const activeNodes = this.lastSystemState ? this.lastSystemState.nodes : 24;
        const systemStatus = this.lastSystemState ? this.lastSystemState.status : 'nominal';
        const activeIncident = this.lastSystemState ? this.lastSystemState.activeIncident : null;
        
        const isOffline = nodeIdx >= activeNodes;
        let isAnomaly = false;
        
        if (systemStatus === 'anomaly') {
            if (activeIncident === 'ddos' && nodeIdx < 12) isAnomaly = true;
            else if (activeIncident === 'db' && nodeIdx === 21) isAnomaly = true;
        }

        // BUG-008 FIX: Track previous timestamp for delta-time correction
        let lastTickTime = performance.now();
        
        const applyCRTDistortion = (x, y) => {
            const cx = width / 2;
            const cy = height / 2;
            const dx = x - cx;
            const dy = y - cy;
            const distSq = dx * dx + dy * dy;
            const factor = 1.0 + 0.00008 * distSq; // Barrel distortion bulge
            return [cx + dx * factor, cy + dy * factor];
        };

        const tick = (now) => {
            if (this.currentNodeIdx !== nodeIdx) return;
            // BUG-008 FIX: Compute delta-time from rAF timestamp — frame-rate independent
            const dt = (now - lastTickTime) / 1000; // seconds elapsed since last frame
            lastTickTime = now;
            this.monitorTime += dt * 2.4; // 2.4 = visual speed constant (~0.04 at 60fps)
            
            // Clear buffer with slow decay trail (phosphor persistence)
            ctx.fillStyle = 'rgba(1, 8, 14, 0.06)';
            ctx.fillRect(0, 0, width, height);
            
            let color = '#00f3ff'; // Cyan
            if (isOffline) {
                color = '#bc00dd'; // Purple
            } else if (isAnomaly) {
                color = '#ff007f'; // Pink/Red
            }
            
            // Draw visual matrix grid lines (curved CRT lines)
            ctx.strokeStyle = isAnomaly ? 'rgba(255, 0, 127, 0.04)' : 'rgba(0, 243, 255, 0.04)';
            ctx.lineWidth = 0.8;
            for (let i = 0; i < width; i += 20) {
                ctx.beginPath();
                for (let j = 0; j <= height; j += 10) {
                    const [px, py] = applyCRTDistortion(i, j);
                    if (j === 0) ctx.moveTo(px, py);
                    else ctx.lineTo(px, py);
                }
                ctx.stroke();
            }
            for (let i = 0; i < height; i += 20) {
                ctx.beginPath();
                for (let j = 0; j <= width; j += 10) {
                    const [px, py] = applyCRTDistortion(j, i);
                    if (j === 0) ctx.moveTo(px, py);
                    else ctx.lineTo(px, py);
                }
                ctx.stroke();
            }
            
            // 3D wireframe cube vertices & edges
            const points3d = [
                [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
                [-1, -1, 1],  [1, -1, 1],  [1, 1, 1],  [-1, 1, 1]
            ];
            const edges = [
                [0, 1], [1, 2], [2, 3], [3, 0],
                [4, 5], [5, 6], [6, 7], [7, 4],
                [0, 4], [1, 5], [2, 6], [3, 7]
            ];
            
            let radX = this.monitorTime * 0.4;
            let radY = this.monitorTime * 0.6;
            
            if (isOffline) {
                radX = 0.25;
                radY = 0.25;
            } else if (isAnomaly) {
                radX = this.monitorTime * 1.6 + Math.sin(this.monitorTime * 4) * 0.4;
                radY = this.monitorTime * 2.2 + Math.cos(this.monitorTime * 3) * 0.4;
            }
            
            const projected = [];
            points3d.forEach(p => {
                let x1 = p[0] * Math.cos(radY) - p[2] * Math.sin(radY);
                let z1 = p[0] * Math.sin(radY) + p[2] * Math.cos(radY);
                let y2 = p[1] * Math.cos(radX) - z1 * Math.sin(radX);
                let z2 = p[1] * Math.sin(radX) + z1 * Math.cos(radX);
                
                const scale = 2.0 / (2.0 + z2 * 0.3);
                const px = 60 + x1 * 26 * scale;
                const py = 65 + y2 * 26 * scale;
                projected.push([px, py]);
            });
            
            edges.forEach(e => {
                const p1 = projected[e[0]];
                const p2 = projected[e[1]];
                
                // Chromatic Aberration: Red shift
                ctx.strokeStyle = isOffline ? 'rgba(188, 0, 221, 0.4)' : (isAnomaly ? 'rgba(255, 0, 127, 0.6)' : 'rgba(255, 0, 50, 0.5)');
                ctx.lineWidth = 1.0;
                ctx.beginPath();
                const [r1x, r1y] = applyCRTDistortion(p1[0] - 1.0, p1[1]);
                const [r2x, r2y] = applyCRTDistortion(p2[0] - 1.0, p2[1]);
                ctx.moveTo(r1x, r1y);
                ctx.lineTo(r2x, r2y);
                ctx.stroke();

                // Chromatic Aberration: Cyan/Green shift
                ctx.strokeStyle = color;
                ctx.lineWidth = 1.2;
                ctx.beginPath();
                const [g1x, g1y] = applyCRTDistortion(p1[0] + 1.0, p1[1]);
                const [g2x, g2y] = applyCRTDistortion(p2[0] + 1.0, p2[1]);
                ctx.moveTo(g1x, g1y);
                ctx.lineTo(g2x, g2y);
                ctx.stroke();
            });
            
            // Drawing telemetry wave line in right panel (red channel)
            ctx.strokeStyle = isOffline ? 'rgba(188, 0, 221, 0.4)' : (isAnomaly ? 'rgba(255, 0, 127, 0.6)' : 'rgba(255, 0, 50, 0.5)');
            ctx.lineWidth = 1.0;
            ctx.beginPath();
            for (let x = 140; x < 320; x += 2) {
                let y = 65;
                if (isOffline) {
                    y = 65;
                } else if (isAnomaly) {
                    y = 65 + Math.sin((x + this.monitorTime * 120) * 0.12) * 22 + (Math.random() < 0.12 ? (Math.random() - 0.5) * 35 : 0);
                } else {
                    y = 65 + Math.sin((x + this.monitorTime * 60) * 0.05) * 14;
                }
                const [rx, ry] = applyCRTDistortion(x - 1.0, y);
                if (x === 140) ctx.moveTo(rx, ry);
                else ctx.lineTo(rx, ry);
            }
            ctx.stroke();

            // Telemetry wave (cyan/green channel)
            ctx.strokeStyle = color;
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            for (let x = 140; x < 320; x += 2) {
                let y = 65;
                if (isOffline) {
                    y = 65;
                } else if (isAnomaly) {
                    y = 65 + Math.sin((x + this.monitorTime * 120) * 0.12) * 22 + (Math.random() < 0.12 ? (Math.random() - 0.5) * 35 : 0);
                } else {
                    y = 65 + Math.sin((x + this.monitorTime * 60) * 0.05) * 14;
                }
                const [gx, gy] = applyCRTDistortion(x + 1.0, y);
                if (x === 140) ctx.moveTo(gx, gy);
                else ctx.lineTo(gx, gy);
            }
            ctx.stroke();
            
            // Write text info stats overlays
            ctx.fillStyle = color;
            ctx.font = '7px monospace';
            ctx.shadowColor = color;
            ctx.shadowBlur = 3;
            ctx.shadowOffsetX = 0.5;
            ctx.shadowOffsetY = 0.5;

            if (isOffline) {
                ctx.fillText("STATUS: OFF", 145, 25);
                ctx.fillText("CAPACITY: 0%", 145, 37);
            } else if (isAnomaly) {
                ctx.fillText("STATUS: ATTACKED", 145, 25);
                ctx.fillText("CAPACITY: OVERFLOW", 145, 37);
                
                if (Math.floor(this.monitorTime * 2) % 2 === 0) {
                    ctx.font = 'bold 8px Orbitron, sans-serif';
                    ctx.fillStyle = '#ff007f';
                    ctx.shadowColor = '#ff007f';
                    ctx.fillText("WARN: METRIC OUTLIER", 145, 110);
                }
            } else {
                ctx.fillText("STATUS: NOMINAL", 145, 25);
                ctx.fillText("HEALTH: 100%", 145, 37);
            }
            ctx.shadowBlur = 0;
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 0;
            
            // Random horizontal static scan overlay lines
            if (isAnomaly && Math.random() < 0.15) {
                ctx.fillStyle = 'rgba(255, 0, 127, 0.35)';
                ctx.fillRect(Math.random() * width, Math.random() * height, Math.random() * 80 + 30, Math.random() * 4 + 1);
            }
            
            this.monitorAnimationFrameId = requestAnimationFrame(tick);
        };
        
        this.monitorAnimationFrameId = requestAnimationFrame(tick);
    }

    pinChartToHUD(chartId) {
        const sourceCanvas = document.getElementById(chartId);
        if (!sourceCanvas) return;
        
        if (this.pinnedChartsContainer.querySelector('p')) {
            this.pinnedChartsContainer.innerHTML = '';
        }
        
        const pinId = `pinned-${chartId}`;
        if (document.getElementById(pinId)) return; // already pinned
        
        const pinBox = document.createElement('div');
        pinBox.className = 'pinned-chart-box';
        pinBox.id = pinId;
        
        const parentBubble = sourceCanvas.closest('.chat-bubble');
        const agentName = parentBubble ? parentBubble.querySelector('.agent-name').textContent.split(' // ')[0] : 'SENTRY';
        const messageText = parentBubble ? parentBubble.querySelector('.message-text').textContent : 'System Metrics';
        
        pinBox.innerHTML = `
            <div class="pinned-title">
                <span>${agentName} // HUD</span>
                <button class="btn-close-pinned" data-pin-id="${pinId}">✕</button>
            </div>
            <canvas class="pinned-chart-canvas" id="canvas-${pinId}" width="220" height="45"></canvas>
        `;
        
        this.pinnedChartsContainer.appendChild(pinBox);
        
        setTimeout(() => {
            const pinCanvas = document.getElementById(`canvas-${pinId}`);
            if (pinCanvas) {
                this.drawChatBubbleChart(pinCanvas, messageText);
            }
        }, 50);
        
        const closeBtn = pinBox.querySelector('.btn-close-pinned');
        closeBtn.addEventListener('click', () => {
            pinBox.remove();
            if (this.pinnedChartsContainer.children.length === 0) {
                this.pinnedChartsContainer.innerHTML = '<p style="font-size:0.6rem; color: var(--text-secondary); font-style:italic;">No pinned widgets. Click \'PIN TO HUD\' in alert bubbles.</p>';
            }
        });
        
        this.playBeep(880, 0.15, 0.05);
    }

    drawCostSavingsForecast() {
        if (!this.costSavingsCtx || !this.costSavingsCanvas) return;
        const ctx = this.costSavingsCtx;
        const canvas = this.costSavingsCanvas;
        const width = canvas.width;
        const height = canvas.height;
        
        ctx.clearRect(0, 0, width, height);
        
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
        ctx.lineWidth = 0.5;
        for (let i = 0; i < width; i += 40) {
            ctx.beginPath();
            ctx.moveTo(i, 0);
            ctx.lineTo(i, height);
            ctx.stroke();
        }
        for (let i = 0; i < height; i += 20) {
            ctx.beginPath();
            ctx.moveTo(0, i);
            ctx.lineTo(width, i);
            ctx.stroke();
        }
        
        const pointsProjected = [];
        const pointsOptimized = [];
        
        const count = 30;
        const step = width / (count - 1);
        
        const systemStateVal = this.lastSystemState ? this.lastSystemState.status : 'nominal';
        const currentCost = this.lastSystemState ? this.lastSystemState.cost : 2500;
        
        for (let i = 0; i < count; i++) {
            const prog = i / (count - 1);
            let projY = height * 0.4 + Math.sin(prog * 10) * 5;
            let optY = height * 0.7 + Math.sin(prog * 10) * 3;
            
            if (systemStateVal === 'anomaly') {
                projY = height * 0.2 + Math.sin(prog * 15) * 8;
                optY = height * 0.5 + Math.sin(prog * 10) * 4;
            } else if (systemStateVal === 'resolving') {
                projY = height * 0.4 - (prog * (height * 0.15)) + Math.sin(prog * 12) * 3;
                optY = height * 0.65 + Math.sin(prog * 10) * 2;
            }
            
            pointsProjected.push({ x: i * step, y: projY });
            pointsOptimized.push({ x: i * step, y: optY });
        }
        
        ctx.strokeStyle = '#bc00dd';
        ctx.lineWidth = 1.2;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(pointsProjected[0].x, pointsProjected[0].y);
        for (let i = 1; i < pointsProjected.length; i++) {
            ctx.lineTo(pointsProjected[i].x, pointsProjected[i].y);
        }
        ctx.stroke();
        ctx.setLineDash([]);
        
        ctx.strokeStyle = '#39ff14';
        ctx.lineWidth = 2.0;
        ctx.shadowColor = '#39ff14';
        ctx.shadowBlur = 4;
        ctx.beginPath();
        ctx.moveTo(pointsOptimized[0].x, pointsOptimized[0].y);
        for (let i = 1; i < pointsOptimized.length; i++) {
            ctx.lineTo(pointsOptimized[i].x, pointsOptimized[i].y);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;
        
        ctx.fillStyle = '#bc00dd';
        ctx.font = '6px Orbitron, sans-serif';
        ctx.fillText("PROJECTED FORECAST: $3,200", 15, 20);
        
        ctx.fillStyle = '#39ff14';
        ctx.fillText(`OPTIMIZED ACTUAL: $${currentCost}`, 15, 30);
    }

    renderPodWorkloadGrid() {
        if (!this.podRowsContainer) return;
        
        const pods = [
            { name: "auth-token-verify", req: "500m / 512Mi", util: "145m / 185Mi", rec: "200m / 256Mi" },
            { name: "payment-worker-01", req: "1000m / 1Gi", util: "310m / 420Mi", rec: "400m / 512Mi" },
            { name: "redis-cache-master", req: "2000m / 2Gi", util: "420m / 1.1Gi", rec: "800m / 1.5Gi" },
            { name: "postgres-primary-db", req: "4000m / 8Gi", util: "3200m / 6.8Gi", rec: "3500m / 7.5Gi" },
            { name: "ingress-gateway-01", req: "1500m / 1Gi", util: "120m / 220Mi", rec: "300m / 512Mi" }
        ];
        
        const activeIncident = this.lastSystemState ? this.lastSystemState.activeIncident : null;
        const systemStatus = this.lastSystemState ? this.lastSystemState.status : 'nominal';
        
        if (systemStatus === 'anomaly') {
            if (activeIncident === 'ddos') {
                pods[4].util = "1420m / 920Mi";
                pods[4].rec = "2000m / 2Gi (Scale!)";
            } else if (activeIncident === 'db') {
                pods[3].util = "4000m / 7.9Gi";
                pods[3].rec = "6000m / 12Gi (Reboot!)";
            }
        }
        
        this.podRowsContainer.innerHTML = '';
        pods.forEach(pod => {
            const row = document.createElement('div');
            row.className = 'pod-row data';
            row.innerHTML = `
                <span style="flex:2; text-align:left;">${pod.name}</span>
                <span style="flex:1; text-align:right;">${pod.req}</span>
                <span style="flex:1; text-align:right;">${pod.util}</span>
                <span style="flex:1; text-align:right;" class="green-text">${pod.rec}</span>
            `;
            this.podRowsContainer.appendChild(row);
        });
    }
}

window.addEventListener('DOMContentLoaded', () => {
    window.app = new AppController();
});
