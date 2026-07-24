/**
 * Helix Quantum - 3D Command Bridge WebGL Engine (GSAP & Post-Processing Bloom)
 * Uses EffectComposer and UnrealBloomPass for sci-fi glow effects, renders
 * a 3D Causal Network Mesh, and synchronises Web Audio Listener coordinates.
 *
 * FIXES APPLIED (SDET report):
 *  - BUG-010: lastSystemState is assigned via setSystemState(state, fullState) — confirmed working
 *  - FIX: showTooltip() uses DOM createElement (no innerHTML with variable content)
 */

class SpaceEngine {
    constructor() {
        this.canvas = document.getElementById('webgl-canvas');
        this.currentDimension = 'nebula';
        this.systemState = 'nominal';
        this.coreSpeed = 1.0;
        this.particleCountSetting = 4500;
        this.noiseFreq = 0.5;
        this.clock = new THREE.Clock();
        
        // Mouse interaction state
        this.mouse = new THREE.Vector2(0, 0);
        this.targetMouse = new THREE.Vector2(0, 0);
        this.mouse3D = new THREE.Vector3(0, 0, 0);
        this.raycaster = new THREE.Raycaster();
        this.interactionPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
        
        // Camera path targets for scroll sections
        this.cameraTargets = [
            { pos: new THREE.Vector3(0, 0, 9), look: new THREE.Vector3(0, 0, 0) },      // Section 0: Command Bridge
            { pos: new THREE.Vector3(3.5, 1.5, 7.5), look: new THREE.Vector3(0, 0, 0) }, // Section 1: Agent Collab
            { pos: new THREE.Vector3(-5.5, -1.8, 6), look: new THREE.Vector3(-1, 0, 0) },// Section 2: Tuners
            { pos: new THREE.Vector3(0, 3.8, 10.5), look: new THREE.Vector3(0, 1, 0) }   // Section 3: Incidents
        ];
        
        this.scrollProxy = { value: 0 };
        
        this.init();
    }

    init() {
        // 1. Scene setup
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(0x020208, 0.018);

        // 2. Camera setup
        this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100);
        this.camera.position.copy(this.cameraTargets[0].pos);
        this.currentLookAt = this.cameraTargets[0].look.clone();

        // 3. Renderer setup
        this.renderer = new THREE.WebGLRenderer({
            canvas: this.canvas,
            antialias: true,
            alpha: false,
            powerPreference: "high-performance"
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.0;

        // 4. Lights
        this.ambientLight = new THREE.AmbientLight(0xffffff, 0.05);
        this.scene.add(this.ambientLight);

        this.pointLight1 = new THREE.PointLight(0x00f3ff, 2, 30);
        this.pointLight1.position.set(2, 3, 4);
        this.scene.add(this.pointLight1);

        this.pointLight2 = new THREE.PointLight(0xbc00dd, 2, 30);
        this.pointLight2.position.set(-2, -3, -4);
        this.scene.add(this.pointLight2);

        // 5. Build Scene Elements
        this.createCore();
        this.createNebulaParticles(this.particleCountSetting);
        this.createCyberGrid();
        this.createCausalMesh(); // Build the 3D server topology network
        
        // 6. Post-Processing Setup
        this.initPostProcessing();

        // 7. Listeners
        window.addEventListener('resize', this.onWindowResize.bind(this));
        window.addEventListener('mousemove', this.onMouseMove.bind(this));
        window.addEventListener('touchstart', this.onTouchMove.bind(this), { passive: true });
        window.addEventListener('touchmove', this.onTouchMove.bind(this), { passive: true });
        window.addEventListener('touchend', this.onTouchEnd.bind(this), { passive: true });
        window.addEventListener('click', this.onClick.bind(this));
        window.addEventListener('dblclick', this.onDoubleClick.bind(this));

        if (this.canvas) {
            this.canvas.addEventListener('webglcontextlost', this.onContextLost.bind(this), false);
            this.canvas.addEventListener('webglcontextrestored', this.onContextRestored.bind(this), false);
        }
        
        this.hoveredNode = null;
        this.explodedNodeIdx = undefined;
        this.isExplodedMode = false;
        this.isIntroAnimating = false;
        this.subSpheres = [];
        this.pinnedNodeIdx = null;

        // Upgrade States
        this.isCinematicTourActive = false;
        this.tourTimeline = null;
        this.currentPerfMode = 'high';
        this.currentTheme = 'nebula';
        this.incidentShockwaves = [];
        this.incidentBeams = [];
        this.isContextLost = false;
        this.lastTouchDist = null;
        
        this.animate();
        this.updateTelemetryCoords();
    }

    createCore() {
        this.coreGroup = new THREE.Group();
        this.scene.add(this.coreGroup);

        const outerGeo = new THREE.DodecahedronGeometry(1.5, 2);
        this.originalOuterVertices = outerGeo.attributes.position.clone();
        
        this.outerMaterial = new THREE.MeshPhysicalMaterial({
            color: 0x00f3ff,
            emissive: 0x001025,
            roughness: 0.12,
            metalness: 0.1,
            transparent: true,
            opacity: 0.45,
            transmission: 0.6,
            ior: 1.5,
            thickness: 1.5,
            clearcoat: 1.0,
            clearcoatRoughness: 0.1,
            flatShading: true
        });

        this.coreOuter = new THREE.Mesh(outerGeo, this.outerMaterial);
        this.coreGroup.add(this.coreOuter);

        const innerGeo = new THREE.DodecahedronGeometry(1.0, 1);
        this.innerMaterial = new THREE.MeshBasicMaterial({
            color: 0xbc00dd,
            wireframe: true,
            transparent: true,
            opacity: 0.8
        });
        this.coreInner = new THREE.Mesh(innerGeo, this.innerMaterial);
        this.coreGroup.add(this.coreInner);
    }

    createNebulaParticles(count) {
        this.particleCountSetting = count; // Ensure value remains synchronized
        if (this.nebulaParticles) {
            this.scene.remove(this.nebulaParticles);
        }

        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(count * 3);
        const originalPositions = new Float32Array(count * 3);
        const colors = new Float32Array(count * 3);
        const sizes = new Float32Array(count);
        this.particleVelocities = [];

        const colorCyan = new THREE.Color(0x00f3ff);
        const colorPurple = new THREE.Color(0xbc00dd);
        const colorBlue = new THREE.Color(0x00062a);

        const arms = 3;
        const armAngle = (2 * Math.PI) / arms;
        
        for (let i = 0; i < count; i++) {
            const r = Math.pow(Math.random(), 2.5) * 7.5 + 0.1;
            const arm = i % arms;
            
            const twist = 1.3;
            const theta = arm * armAngle + r * twist + (Math.random() - 0.5) * 0.4;
            
            const x = Math.cos(theta) * r;
            const z = Math.sin(theta) * r;
            const y = (Math.random() - 0.5) * 0.3 * (9.0 - r);
            
            const idx = i * 3;
            positions[idx] = x;
            positions[idx + 1] = y;
            positions[idx + 2] = z;

            originalPositions[idx] = x;
            originalPositions[idx + 1] = y;
            originalPositions[idx + 2] = z;

            let mixedColor = colorCyan.clone();
            if (r < 1.8) {
                mixedColor.lerp(colorCyan, 1.0);
            } else if (r < 4.5) {
                const ratio = (r - 1.8) / 2.7;
                mixedColor.lerp(colorPurple, ratio);
            } else {
                const ratio = Math.min((r - 4.5) / 3.0, 1.0);
                mixedColor.lerp(colorBlue, ratio);
            }

            colors[idx] = mixedColor.r;
            colors[idx + 1] = mixedColor.g;
            colors[idx + 2] = mixedColor.b;

            sizes[i] = (Math.random() * 0.08 + 0.02) * (r < 1.5 ? 2.5 : 1.0);

            this.particleVelocities.push({
                vx: 0,
                vy: 0,
                vz: 0,
                speedMultiplier: Math.random() * 0.45 + 0.2
            });
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

        const particleTexture = this.generateStarTexture();

        this.nebulaMaterial = new THREE.PointsMaterial({
            size: 0.16,
            map: particleTexture,
            vertexColors: true,
            transparent: true,
            opacity: 0.85,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        this.nebulaParticles = new THREE.Points(geometry, this.nebulaMaterial);
        this.originalParticlePositions = originalPositions;
        this.scene.add(this.nebulaParticles);
    }

    generateStarTexture() {
        const size = 64;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');

        const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
        grad.addColorStop(0, 'rgba(255,255,255,1)');
        grad.addColorStop(0.15, 'rgba(0,243,255,0.7)');
        grad.addColorStop(0.4, 'rgba(188,0,221,0.2)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');

        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, size, size);

        return new THREE.CanvasTexture(canvas);
    }

    createCyberGrid() {
        this.cyberGridGroup = new THREE.Group();
        this.scene.add(this.cyberGridGroup);

        this.gridNominal = new THREE.GridHelper(32, 32, 0xbc00dd, 0x00f3ff);
        this.gridNominal.position.y = -3.5;
        this.cyberGridGroup.add(this.gridNominal);

        this.gridWarning = new THREE.GridHelper(32, 32, 0xff0055, 0xff5500);
        this.gridWarning.position.y = -3.5;
        this.gridWarning.visible = false;
        this.cyberGridGroup.add(this.gridWarning);

        const sunGeo = new THREE.CircleGeometry(5, 32);
        this.sunMaterial = new THREE.MeshBasicMaterial({
            color: 0xbc00dd,
            transparent: true,
            opacity: 0.25,
            side: THREE.DoubleSide
        });
        this.sun = new THREE.Mesh(sunGeo, this.sunMaterial);
        this.sun.position.set(0, 0, -15);
        this.cyberGridGroup.add(this.sun);
    }

    getNodePosition(idx) {
        if (idx >= 0 && idx <= 3) {
            // Layer 1 (Ingress Gateways)
            const angle = (idx / 4) * Math.PI * 2;
            return new THREE.Vector3(Math.cos(angle) * 1.0, 2.0, Math.sin(angle) * 1.0);
        } else if (idx === 4) {
            // Layer 2 (API Gateway Router)
            return new THREE.Vector3(0, 1.0, 0);
        } else if (idx >= 5 && idx <= 20) {
            // Layer 3 (Microservices)
            const angle = ((idx - 5) / 16) * Math.PI * 2;
            return new THREE.Vector3(Math.cos(angle) * 3.2, 0.0, Math.sin(angle) * 3.2);
        } else if (idx >= 21 && idx <= 24) {
            // Layer 4 (Databases & Caches)
            const angle = ((idx - 21) / 4) * Math.PI * 2;
            return new THREE.Vector3(Math.cos(angle) * 2.2, -1.0, Math.sin(angle) * 2.2);
        } else if (idx >= 25 && idx <= 28) {
            // Additional Databases/Caches (Layer 4 scale)
            const angle = ((idx - 25) / 4) * Math.PI * 2 + Math.PI / 4;
            return new THREE.Vector3(Math.cos(angle) * 2.8, -1.0, Math.sin(angle) * 2.8);
        } else {
            // Additional Microservices & Compute nodes (Layer 3 scale)
            const angle = ((idx - 29) / 19) * Math.PI * 2;
            return new THREE.Vector3(Math.cos(angle) * 3.8, 0.0, Math.sin(angle) * 3.8);
        }
    }

    // 3D Causal Network Mesh representation of Kubernetes container hosts
    createCausalMesh() {
        this.networkGroup = new THREE.Group();
        this.scene.add(this.networkGroup);
        
        this.networkNodes = [];
        this.networkLines = [];
        
        const totalNodes = 48;
        
        for (let idx = 0; idx < totalNodes; idx++) {
            const pos = this.getNodePosition(idx);
            
            let geom;
            let nodeMat;
            let role;
            
            if (idx >= 0 && idx <= 3) {
                // Ingress Gateways: Torus/Ring
                geom = new THREE.TorusGeometry(0.065, 0.018, 8, 24);
                nodeMat = new THREE.MeshPhysicalMaterial({
                    color: 0x00f3ff,
                    roughness: 0.2,
                    metalness: 0.8,
                    transparent: true,
                    opacity: idx < 24 ? 0.9 : 0.05,
                    clearcoat: 1.0
                });
                role = 'ingress';
            } else if (idx === 4) {
                // API Gateway Router: Octahedron
                geom = new THREE.OctahedronGeometry(0.12, 0);
                nodeMat = new THREE.MeshPhysicalMaterial({
                    color: 0x00f3ff,
                    roughness: 0.1,
                    metalness: 0.9,
                    transparent: true,
                    opacity: idx < 24 ? 0.95 : 0.05,
                    clearcoat: 1.0,
                    transmission: 0.3
                });
                role = 'router';
            } else if ((idx >= 21 && idx <= 24) || (idx >= 25 && idx <= 28)) {
                // Databases & Caches
                const isCache = idx === 22 || idx === 25;
                if (isCache) {
                    // Cache: Cube/Box
                    geom = new THREE.BoxGeometry(0.1, 0.1, 0.1);
                    nodeMat = new THREE.MeshPhysicalMaterial({
                        color: 0xbc00dd, // Distinct purple/magenta for cache
                        roughness: 0.2,
                        metalness: 0.3,
                        transparent: true,
                        opacity: idx < 24 ? 0.9 : 0.05,
                        transmission: 0.8,
                        ior: 1.4
                    });
                    role = 'cache';
                } else {
                    // Database: Cylinder
                    geom = new THREE.CylinderGeometry(0.05, 0.05, 0.12, 16);
                    nodeMat = new THREE.MeshPhysicalMaterial({
                        color: 0x00f3ff,
                        roughness: 0.3,
                        metalness: 0.7,
                        transparent: true,
                        opacity: idx < 24 ? 0.9 : 0.05,
                        clearcoat: 0.5
                    });
                    role = 'database';
                }
            } else if (idx === 10 || idx === 18 || idx === 19) {
                // Security Agents: Pyramid (Cone with 4 radial segments)
                geom = new THREE.ConeGeometry(0.07, 0.12, 4);
                nodeMat = new THREE.MeshPhysicalMaterial({
                    color: 0x00f3ff,
                    roughness: 0.1,
                    metalness: 0.9,
                    transparent: true,
                    opacity: idx < 24 ? 0.95 : 0.05,
                    clearcoat: 1.0
                });
                role = 'security';
            } else {
                // Microservices: Sleek glassmorphic spheres
                geom = new THREE.SphereGeometry(0.065, 16, 16);
                nodeMat = new THREE.MeshPhysicalMaterial({
                    color: 0x00f3ff,
                    roughness: 0.1,
                    metalness: 0.1,
                    transparent: true,
                    opacity: idx < 24 ? 0.95 : 0.05,
                    transmission: 0.6,
                    ior: 1.5,
                    thickness: 0.5,
                    clearcoat: 1.0,
                    clearcoatRoughness: 0.1
                });
                role = 'microservice';
            }
            
            const nodeMesh = new THREE.Mesh(geom, nodeMat);
            nodeMesh.position.copy(pos);
            nodeMesh.originalPosition = nodeMesh.position.clone();
            nodeMesh.nodeRole = role;
            
            this.networkGroup.add(nodeMesh);
            this.networkNodes.push(nodeMesh);
        }

        // Generate custom hierarchical edge list
        this.edges = [];
        
        // 1. Ingress (0..3) to API Gateway Router (4)
        for (let i = 0; i < 4; i++) {
            this.edges.push({ from: i, to: 4 });
        }

        // 2. API Gateway Router (4) to Microservices (5..20)
        for (let m = 5; m <= 20; m++) {
            this.edges.push({ from: 4, to: m });
        }

        // 3. Microservices (5..20) to Databases & Caches (21..24)
        for (let m = 5; m <= 20; m++) {
            const dbIdx = 21 + (m - 5) % 4;
            this.edges.push({ from: m, to: dbIdx });
        }

        // 4. Standby / replica connections
        for (let m = 29; m <= 47; m++) {
            this.edges.push({ from: 4, to: m });
            const dbIdx = 25 + (m - 29) % 4;
            this.edges.push({ from: m, to: dbIdx });
        }
        for (let d = 25; d <= 28; d++) {
            this.edges.push({ from: d - 4, to: d });
        }

        // Draw edge connections with Flowing Dashed Lines
        this.edges.forEach(edge => {
            const fromNode = this.networkNodes[edge.from];
            const toNode = this.networkNodes[edge.to];
            
            const points = [];
            points.push(fromNode.position);
            points.push(toNode.position);
            
            const lineGeo = new THREE.BufferGeometry().setFromPoints(points);
            const lineMat = new THREE.LineDashedMaterial({
                color: 0x00f3ff,
                dashSize: 0.15,
                gapSize: 0.08,
                transparent: true,
                opacity: (edge.from < 24 && edge.to < 24) ? 0.25 : 0.02
            });
            const line = new THREE.Line(lineGeo, lineMat);
            line.computeLineDistances();
            this.networkGroup.add(line);
            this.networkLines.push(line);
        });
        
        this.createPacketParticles();
    }

    createPacketParticles() {
        this.maxPackets = 150;
        this.packets = [];
        
        const packetGeo = new THREE.BufferGeometry();
        const packetPositions = new Float32Array(this.maxPackets * 3);
        const packetColors = new Float32Array(this.maxPackets * 3);
        
        for (let i = 0; i < this.maxPackets; i++) {
            packetPositions[i * 3] = 9999;
            packetPositions[i * 3 + 1] = 9999;
            packetPositions[i * 3 + 2] = 9999;
            
            packetColors[i * 3] = 0.0;
            packetColors[i * 3 + 1] = 0.95;
            packetColors[i * 3 + 2] = 1.0;
        }
        
        packetGeo.setAttribute('position', new THREE.BufferAttribute(packetPositions, 3));
        packetGeo.setAttribute('color', new THREE.BufferAttribute(packetColors, 3));
        
        const packetTexture = this.generateStarTexture();
        this.packetMaterial = new THREE.PointsMaterial({
            size: 0.12,
            map: packetTexture,
            vertexColors: true,
            transparent: true,
            opacity: 0.9,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });
        
        this.packetPointsMesh = new THREE.Points(packetGeo, this.packetMaterial);
        this.networkGroup.add(this.packetPointsMesh);
        
        for (let i = 0; i < this.maxPackets; i++) {
            this.packets.push({
                edgeIdx: 0,
                progress: Math.random(),
                speed: 0.3 + Math.random() * 0.4
            });
        }
    }

    getCallPathNodes(nodeIdx) {
        const pathNodes = new Set([nodeIdx]);
        const queue = [nodeIdx];
        
        while (queue.length > 0) {
            const curr = queue.shift();
            for (const edge of this.edges) {
                if (edge.from === curr && !pathNodes.has(edge.to)) {
                    pathNodes.add(edge.to);
                    queue.push(edge.to);
                }
                if (edge.to === curr && !pathNodes.has(edge.from)) {
                    pathNodes.add(edge.from);
                    queue.push(edge.from);
                }
            }
        }
        return pathNodes;
    }

    highlightCallPath(nodeIdx) {
        if (this.isExplodedMode) return;
        const activeCount = this.activeNodesCount || 24;
        
        if (nodeIdx === null || nodeIdx === -1) {
            this.networkNodes.forEach((node, idx) => {
                const isActive = idx < activeCount;
                let baseOpacity = isActive ? 0.9 : 0.05;
                
                gsap.to(node.material, {
                    opacity: baseOpacity,
                    duration: 0.4
                });
                if (node !== this.hoveredNode) {
                    gsap.to(node.scale, { x: 1.0, y: 1.0, z: 1.0, duration: 0.4 });
                }
            });
            
            this.networkLines.forEach((line, idx) => {
                const edge = this.edges[idx];
                const fromActive = edge.from < activeCount;
                const toActive = edge.to < activeCount;
                let baseLineOpacity = (fromActive && toActive) ? 0.25 : 0.02;
                
                gsap.to(line.material, {
                    opacity: baseLineOpacity,
                    duration: 0.4
                });
            });
            return;
        }

        const pathNodes = this.getCallPathNodes(nodeIdx);

        this.networkNodes.forEach((node, idx) => {
            const isActive = idx < activeCount;
            const isHighlighted = pathNodes.has(idx);
            
            let targetOpacity = 0.02;
            if (isActive) {
                targetOpacity = isHighlighted ? 1.0 : 0.15;
            } else {
                targetOpacity = isHighlighted ? 0.3 : 0.02;
            }

            let targetScale = (isHighlighted && isActive) ? 1.4 : 0.8;
            if (idx === nodeIdx) targetScale = 1.8;
            
            gsap.to(node.material, {
                opacity: targetOpacity,
                duration: 0.3
            });
            gsap.to(node.scale, {
                x: targetScale,
                y: targetScale,
                z: targetScale,
                duration: 0.3
            });
        });

        this.networkLines.forEach((line, idx) => {
            const edge = this.edges[idx];
            const isHighlighted = pathNodes.has(edge.from) && pathNodes.has(edge.to);
            const fromActive = edge.from < activeCount;
            const toActive = edge.to < activeCount;
            
            let targetOpacity = 0.02;
            if (fromActive && toActive) {
                targetOpacity = isHighlighted ? 0.8 : 0.05;
            } else {
                targetOpacity = isHighlighted ? 0.2 : 0.01;
            }

            gsap.to(line.material, {
                opacity: targetOpacity,
                duration: 0.3
            });
        });
    }

    // EffectComposer Post-Processing setup (UnrealBloomPass)
    initPostProcessing() {
        const renderPass = new THREE.RenderPass(this.scene, this.camera);
        
        // bloomPass (resolution, strength, radius, threshold)
        this.bloomPass = new THREE.UnrealBloomPass(
            new THREE.Vector2(window.innerWidth, window.innerHeight),
            0.9,  // strength
            0.35, // radius
            0.82  // threshold
        );
        
        this.composer = new THREE.EffectComposer(this.renderer);
        this.composer.addPass(renderPass);
        this.composer.addPass(this.bloomPass);
    }

    onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.composer.setSize(window.innerWidth, window.innerHeight);
    }

    onMouseMove(e) {
        this.targetMouse.x = (e.clientX / window.innerWidth) * 2 - 1;
        this.targetMouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
        this.rawMouseEvent = e;
    }

    onTouchMove(e) {
        if (e.touches.length === 1) {
            const touch = e.touches[0];
            this.targetMouse.x = (touch.clientX / window.innerWidth) * 2 - 1;
            this.targetMouse.y = -(touch.clientY / window.innerHeight) * 2 + 1;
        } else if (e.touches.length === 2) {
            // Pinch-to-zoom & 2-finger panning for mobile/tablet judges
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            const dist = Math.hypot(dx, dy);
            if (this.lastTouchDist) {
                const delta = dist - this.lastTouchDist;
                this.camera.position.z = THREE.MathUtils.clamp(this.camera.position.z - delta * 0.025, 4.0, 16.0);
            }
            this.lastTouchDist = dist;
        }
    }

    onTouchEnd() {
        this.lastTouchDist = null;
    }

    // Priority #2: Adaptive Frame Guardian API
    setPerformancePreset(mode) {
        if (this.currentPerfMode === mode) return;
        this.currentPerfMode = mode;
        
        if (mode === 'low') {
            this.createNebulaParticles(1200);
            if (this.bloomPass) {
                this.bloomPass.strength = 0.5;
                this.bloomPass.radius = 0.3;
                this.bloomPass.threshold = 0.4;
            }
        } else if (mode === 'medium') {
            this.createNebulaParticles(2500);
            if (this.bloomPass) {
                this.bloomPass.strength = 0.8;
                this.bloomPass.radius = 0.5;
                this.bloomPass.threshold = 0.3;
            }
        } else { // 'high'
            this.createNebulaParticles(4500);
            if (this.bloomPass) {
                this.bloomPass.strength = 1.2;
                this.bloomPass.radius = 0.7;
                this.bloomPass.threshold = 0.2;
            }
        }
    }

    // Priority #8: Preset Theme Switcher
    setTheme(themeName) {
        this.currentTheme = themeName;
        const colorCyan = new THREE.Color();
        const colorPurple = new THREE.Color();
        const fogColor = new THREE.Color();

        if (themeName === 'solar') {
            colorCyan.setHex(0xffaa00);
            colorPurple.setHex(0xff4400);
            fogColor.setHex(0x0c0602);
        } else if (themeName === 'violet') {
            colorCyan.setHex(0x9d00ff);
            colorPurple.setHex(0xff00ab);
            fogColor.setHex(0x06020c);
        } else { // 'nebula' (default)
            colorCyan.setHex(0x00f3ff);
            colorPurple.setHex(0xbc00dd);
            fogColor.setHex(0x020208);
        }

        gsap.to(this.scene.fog.color, { r: fogColor.r, g: fogColor.g, b: fogColor.b, duration: 1.2 });
        gsap.to(this.pointLight1.color, { r: colorCyan.r, g: colorCyan.g, b: colorCyan.b, duration: 1.2 });
        gsap.to(this.pointLight2.color, { r: colorPurple.r, g: colorPurple.g, b: colorPurple.b, duration: 1.2 });
        
        if (this.gridNominal) {
            this.gridNominal.material.color.set(colorPurple);
        }
    }

    // Priority #3: 25-30s Cinematic Tour Demo Mode with CustomEvent Bridge
    startCinematicTour() {
        if (this.isCinematicTourActive) return;
        this.isCinematicTourActive = true;
        const tourBtn = document.getElementById('btn-cinematic-tour');
        if (tourBtn) {
            tourBtn.classList.add('active');
            tourBtn.querySelector('.btn-icon').textContent = '⏹️';
            tourBtn.querySelector('.btn-text').textContent = 'STOP TOUR';
        }

        this.tourTimeline = gsap.timeline({
            onComplete: () => this.stopCinematicTour()
        });

        // 0s - 5s: High bridge overview
        this.tourTimeline.to(this.camera.position, { x: 0, y: 3.5, z: 11, duration: 5, ease: 'power2.inOut' }, 0);
        
        // 5s - 12s: Agent Collab & Tuners sweep
        this.tourTimeline.to(this.camera.position, { x: 4, y: 1.8, z: 7.5, duration: 7, ease: 'power2.inOut' }, 5);
        
        // 12s - 18s: Auto-trigger DDoS incident visual + CustomEvent Bridge
        this.tourTimeline.add(() => {
            this.spawnIncidentShockwave(0);
            this.spawnIncidentShockwave(4);
            window.dispatchEvent(new CustomEvent('cinematicEvent', { detail: { type: 'incident', state: 'ddos' } }));
        }, 12);
        this.tourTimeline.to(this.camera.position, { x: -2.5, y: -0.5, z: 6, duration: 6, ease: 'power2.inOut' }, 12);

        // 18s - 24s: Zoom into affected Ingress Node & inspector tooltip
        this.tourTimeline.add(() => {
            if (this.networkNodes && this.networkNodes[0]) {
                this.showTooltip(this.networkNodes[0], { clientX: window.innerWidth * 0.4, clientY: window.innerHeight * 0.4 });
            }
        }, 18);
        this.tourTimeline.to(this.camera.position, { x: 0.8, y: 1.8, z: 3.2, duration: 6, ease: 'power2.inOut' }, 18);

        // 24s - 30s: Resolve incident + CustomEvent & return to overview
        this.tourTimeline.add(() => {
            this.hideTooltip();
            window.dispatchEvent(new CustomEvent('cinematicEvent', { detail: { type: 'resolve' } }));
        }, 24);
        this.tourTimeline.to(this.camera.position, { x: 0, y: 0, z: 9, duration: 6, ease: 'power2.inOut' }, 24);
    }

    stopCinematicTour() {
        if (!this.isCinematicTourActive) return;
        this.isCinematicTourActive = false;
        if (this.tourTimeline) {
            this.tourTimeline.kill();
            this.tourTimeline = null;
        }
        const tourBtn = document.getElementById('btn-cinematic-tour');
        if (tourBtn) {
            tourBtn.classList.remove('active');
            tourBtn.querySelector('.btn-icon').textContent = '▶️';
            tourBtn.querySelector('.btn-text').textContent = 'TOUR';
        }
        this.hideTooltip();
        gsap.to(this.camera.position, { x: 0, y: 0, z: 9, duration: 1.5, ease: 'power2.out' });
    }

    // Priority #4: Incident Energy Shockwaves & Lifecycle Disposal
    spawnIncidentShockwave(nodeIdx) {
        if (!this.networkNodes || !this.networkNodes[nodeIdx]) return;
        if (!this.incidentShockwaves) this.incidentShockwaves = [];

        const pos = this.networkNodes[nodeIdx].position;
        const ringGeo = new THREE.RingGeometry(0.1, 0.4, 32);
        const ringMat = new THREE.MeshBasicMaterial({
            color: 0xff0055,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.9,
            blending: THREE.AdditiveBlending
        });
        const ringMesh = new THREE.Mesh(ringGeo, ringMat);
        ringMesh.position.copy(pos);
        ringMesh.lookAt(this.camera.position);
        ringMesh.createdAt = performance.now();
        
        this.scene.add(ringMesh);
        this.incidentShockwaves.push(ringMesh);
    }

    updateIncidentShockwaves() {
        if (!this.incidentShockwaves) return;
        const now = performance.now();
        for (let i = this.incidentShockwaves.length - 1; i >= 0; i--) {
            const ring = this.incidentShockwaves[i];
            const age = (now - ring.createdAt) / 1000;
            if (age > 3.0) {
                this.scene.remove(ring);
                ring.geometry.dispose();
                ring.material.dispose();
                this.incidentShockwaves.splice(i, 1);
            } else {
                const scale = 1.0 + age * 2.5;
                ring.scale.set(scale, scale, scale);
                ring.material.opacity = Math.max(0, 0.9 - age / 3.0);
                ring.lookAt(this.camera.position);
            }
        }
    }

    // Priority #9: WebGL Context Loss & Full Restoration
    onContextLost(e) {
        e.preventDefault();
        this.isContextLost = true;
        const overlay = document.getElementById('webgl-context-overlay');
        if (overlay) overlay.classList.remove('hidden');
    }

    onContextRestored() {
        this.rebuildSceneAfterContextRestore();
        const overlay = document.getElementById('webgl-context-overlay');
        if (overlay) {
            setTimeout(() => overlay.classList.add('hidden'), 1000);
        }
    }

    rebuildSceneAfterContextRestore() {
        this.isContextLost = false;
        this.initPostProcessing();
        this.setTheme(this.currentTheme);
        this.setPerformancePreset(this.currentPerfMode);
    }

    // Animate active nodes count and connection colors dynamically
    updateActiveNodesVis(activeCount) {
        this.activeNodesCount = activeCount;
        if (!this.networkNodes) return;
        
        this.networkNodes.forEach((node, idx) => {
            const isActive = idx < activeCount;
            gsap.to(node.material, {
                opacity: isActive ? 0.9 : 0.05,
                duration: 0.8
            });
        });
        
        this.networkLines.forEach((line, idx) => {
            const edge = this.edges[idx];
            const fromActive = edge.from < activeCount;
            const toActive = edge.to < activeCount;
            gsap.to(line.material, {
                opacity: (fromActive && toActive) ? 0.25 : 0.02,
                duration: 0.8
            });
        });
    }

    setSystemState(state, fullState = null) {
        this.systemState = state;
        if (fullState) {
            this.lastSystemState = fullState;
        }
        const teleDim = document.getElementById('tele_dimension');
        
        if (state === 'nominal') {
            this.gridNominal.visible = true;
            this.gridWarning.visible = false;
            
            // GSAP smooth material interpolations
            gsap.to(this.outerMaterial.color, { r: 0.0, g: 0.95, b: 1.0, duration: 1.2, ease: 'power2.out' });
            gsap.to(this.outerMaterial, { roughness: 0.12, transmission: 0.6, clearcoat: 1.0, opacity: 0.45, duration: 1.2 });
            gsap.to(this.innerMaterial.color, { r: 0.74, g: 0.0, b: 0.87, duration: 1.2 });
            gsap.to(this.sunMaterial.color, { r: 0.74, g: 0.0, b: 0.87, duration: 1.2 });
            
            // GSAP smooth post-processing bloom adjustments
            gsap.to(this.bloomPass, { strength: 0.9, radius: 0.35, duration: 1.5 });
            
            // Elastic core scaling
            gsap.to(this.coreOuter.scale, { x: 1.0, y: 1.0, z: 1.0, duration: 1.5, ease: 'elastic.out(1, 0.6)' });
            
            gsap.to(this.scene.fog.color, { r: 0.008, g: 0.008, b: 0.03, duration: 1.5 });
            
            // Reset network lines to nominal cyan
            if (this.networkLines) {
                this.networkLines.forEach(line => {
                    gsap.to(line.material.color, { r: 0.0, g: 0.95, b: 1.0, duration: 1.2 });
                });
                this.networkNodes.forEach(node => {
                    gsap.to(node.material.color, { r: 0.0, g: 0.95, b: 1.0, duration: 1.2 });
                });
            }

            if (teleDim) {
                teleDim.textContent = "NOMINAL";
                teleDim.className = "value green";
            }
        } 
        else if (state === 'anomaly') {
            this.gridNominal.visible = false;
            this.gridWarning.visible = true;
            
            // GSAP warning red material parameters
            gsap.to(this.outerMaterial.color, { r: 1.0, g: 0.0, b: 0.33, duration: 0.4, ease: 'power1.out' });
            gsap.to(this.outerMaterial, { roughness: 0.02, transmission: 0.25, clearcoat: 0.2, opacity: 0.8, duration: 0.4 });
            gsap.to(this.innerMaterial.color, { r: 1.0, g: 0.66, b: 0.0, duration: 0.4 });
            gsap.to(this.sunMaterial.color, { r: 1.0, g: 0.0, b: 0.33, duration: 0.4 });
            
            // High post-processing bloom glow during alert states
            gsap.to(this.bloomPass, { strength: 2.3, radius: 0.6, duration: 0.4, ease: 'power1.out' });
            
            // Core expand and bounce alert
            gsap.to(this.coreOuter.scale, { x: 1.35, y: 1.35, z: 1.35, duration: 0.5, ease: 'bounce.out' });
            
            gsap.to(this.scene.fog.color, { r: 0.04, g: 0.004, b: 0.016, duration: 0.5 });
            
            // Turn active network segments warning red
            if (this.networkLines) {
                this.networkLines.forEach((line, idx) => {
                    // Turn only active nodes' segments red
                    if (line.material.opacity > 0.1) {
                        gsap.to(line.material.color, { r: 1.0, g: 0.0, b: 0.33, duration: 0.5 });
                        gsap.to(this.networkNodes[idx].material.color, { r: 1.0, g: 0.0, b: 0.33, duration: 0.5 });
                    }
                });
            }

            if (teleDim) {
                teleDim.textContent = "CRITICAL LIMIT";
                teleDim.className = "value red";
            }
        } 
        else if (state === 'resolving') {
            this.gridNominal.visible = true;
            this.gridWarning.visible = false;
            
            // Healing green settings
            gsap.to(this.outerMaterial.color, { r: 0.0, g: 1.0, b: 0.5, duration: 1.0 });
            gsap.to(this.outerMaterial, { roughness: 0.2, transmission: 0.8, clearcoat: 0.8, opacity: 0.5, duration: 1.0 });
            gsap.to(this.innerMaterial.color, { r: 0.0, g: 0.95, b: 1.0, duration: 1.0 });
            gsap.to(this.sunMaterial.color, { r: 0.0, g: 1.0, b: 0.5, duration: 1.0 });
            
            gsap.to(this.bloomPass, { strength: 1.4, radius: 0.45, duration: 1.0 });
            
            gsap.to(this.coreOuter.scale, { x: 0.85, y: 0.85, z: 0.85, duration: 1.0, ease: 'power2.out' });
            
            gsap.to(this.scene.fog.color, { r: 0.004, g: 0.03, b: 0.016, duration: 1.2 });
            
            // Turn network segments resolving green
            if (this.networkLines) {
                this.networkLines.forEach((line, idx) => {
                    if (line.material.opacity > 0.1) {
                        gsap.to(line.material.color, { r: 0.0, g: 1.0, b: 0.5, duration: 0.8 });
                        gsap.to(this.networkNodes[idx].material.color, { r: 0.0, g: 1.0, b: 0.5, duration: 0.8 });
                    }
                });
            }

            if (teleDim) {
                teleDim.textContent = "RESOLVING...";
                teleDim.className = "value yellow";
            }
        }
    }

    updateScroll(progress) {
        gsap.to(this.scrollProxy, {
            value: progress,
            duration: 0.8,
            ease: 'power2.out',
            overwrite: 'auto'
        });
    }

    updateTelemetryCoords() {
        const teleCoords = document.getElementById('tele_coords');
        if (teleCoords) {
            if (this.systemState === 'nominal') {
                teleCoords.textContent = "HOSTS: 24/24 [100%]";
            } else if (this.systemState === 'anomaly') {
                teleCoords.textContent = "HOSTS: 15/24 [CRITICAL]";
            } else {
                teleCoords.textContent = "HOSTS: 21/24 [HEALTHY]";
            }
        }
    }

    playIntroFlyIn() {
        this.isIntroAnimating = true;
        this.camera.position.set(0, 4, 32);
        
        gsap.to(this.camera.position, {
            x: this.cameraTargets[0].pos.x,
            y: this.cameraTargets[0].pos.y,
            z: this.cameraTargets[0].pos.z,
            duration: 2.2,
            ease: 'power3.out',
            onComplete: () => {
                this.isIntroAnimating = false;
            }
        });
    }

    createParticleBurst(worldPos, colorHex = 0x00f3ff, count = 35) {
        const burstGeo = new THREE.BufferGeometry();
        const positions = new Float32Array(count * 3);
        const velocities = [];

        for (let i = 0; i < count; i++) {
            positions[i * 3] = worldPos.x;
            positions[i * 3 + 1] = worldPos.y;
            positions[i * 3 + 2] = worldPos.z;

            const theta = Math.random() * Math.PI * 2;
            const phi = Math.random() * Math.PI;
            const speed = 0.8 + Math.random() * 1.5;

            velocities.push({
                vx: Math.sin(phi) * Math.cos(theta) * speed,
                vy: Math.sin(phi) * Math.sin(theta) * speed,
                vz: Math.cos(phi) * speed
            });
        }

        burstGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

        const burstMat = new THREE.PointsMaterial({
            size: 0.18,
            color: colorHex,
            map: this.generateStarTexture(),
            transparent: true,
            opacity: 1.0,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        const burstMesh = new THREE.Points(burstGeo, burstMat);
        this.scene.add(burstMesh);

        const startTime = performance.now();
        const animateBurst = () => {
            const elapsed = (performance.now() - startTime) / 1000;
            if (elapsed > 0.8) {
                this.scene.remove(burstMesh);
                burstGeo.dispose();
                burstMat.dispose();
                return;
            }

            const posArr = burstGeo.attributes.position.array;
            for (let i = 0; i < count; i++) {
                posArr[i * 3] += velocities[i].vx * 0.016;
                posArr[i * 3 + 1] += velocities[i].vy * 0.016;
                posArr[i * 3 + 2] += velocities[i].vz * 0.016;
            }
            burstGeo.attributes.position.needsUpdate = true;
            burstMat.opacity = 1.0 - (elapsed / 0.8);

            requestAnimationFrame(animateBurst);
        };
        animateBurst();
    }

    animate() {
        requestAnimationFrame(this.animate.bind(this));
        if (this.isContextLost) return;

        const delta = this.clock.getDelta();
        const time = this.clock.getElapsedTime();

        // Update active incident shockwave animations & lifecycle
        this.updateIncidentShockwaves();

        // 1. Mouse Lerping
        this.mouse.x += (this.targetMouse.x - this.mouse.x) * 0.08;
        this.mouse.y += (this.targetMouse.y - this.mouse.y) * 0.08;

        // 2. Camera scroll pathing utilizing GSAP scrollProxy (smooth scroll inertia)
        const currentTargetIndex = Math.min(Math.floor(this.scrollProxy.value), this.cameraTargets.length - 1);
        const nextTargetIndex = Math.min(currentTargetIndex + 1, this.cameraTargets.length - 1);
        const sectionProgress = this.scrollProxy.value % 1.0;

        const targetCamPos = new THREE.Vector3().copy(this.cameraTargets[currentTargetIndex].pos)
            .lerp(this.cameraTargets[nextTargetIndex].pos, sectionProgress);
        const targetCamLook = new THREE.Vector3().copy(this.cameraTargets[currentTargetIndex].look)
            .lerp(this.cameraTargets[nextTargetIndex].look, sectionProgress);

        if (!this.isExplodedMode && !this.isIntroAnimating) {
            this.camera.position.x += (targetCamPos.x + this.mouse.x * 1.2 - this.camera.position.x) * 0.06;
            this.camera.position.y += (targetCamPos.y + this.mouse.y * 1.2 - this.camera.position.y) * 0.06;
            this.camera.position.z += (targetCamPos.z - this.camera.position.z) * 0.06;

            this.currentLookAt.lerp(targetCamLook, 0.08);
            this.camera.lookAt(this.currentLookAt);
        } else {
            this.camera.lookAt(this.currentLookAt);
        }

        // 3. Update Web Audio listener coordinates (Spatial Audio Sync)
        if (window.app && window.app.audioContext) {
            const listener = window.app.audioContext.listener;
            const cp = this.camera.position;
            const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
            const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
            
            if (listener.positionX) {
                listener.positionX.setValueAtTime(cp.x, this.audioContextTimeProxy || time);
                listener.positionY.setValueAtTime(cp.y, this.audioContextTimeProxy || time);
                listener.positionZ.setValueAtTime(cp.z, this.audioContextTimeProxy || time);
                listener.forwardX.setValueAtTime(forward.x, this.audioContextTimeProxy || time);
                listener.forwardY.setValueAtTime(forward.y, this.audioContextTimeProxy || time);
                listener.forwardZ.setValueAtTime(forward.z, this.audioContextTimeProxy || time);
                listener.upX.setValueAtTime(up.x, this.audioContextTimeProxy || time);
                listener.upY.setValueAtTime(up.y, this.audioContextTimeProxy || time);
                listener.upZ.setValueAtTime(up.z, this.audioContextTimeProxy || time);
            } else {
                listener.setPosition(cp.x, cp.y, cp.z);
                listener.setOrientation(forward.x, forward.y, forward.z, up.x, up.y, up.z);
            }
        }

        this.updateTelemetryCoords();

        // 3D Raycasting check for node hover states
        if (!this.isExplodedMode) {
            this.raycaster.setFromCamera(this.mouse, this.camera);
            const intersects = this.raycaster.intersectObjects(this.networkNodes);
            
            if (this.hoveredNode) {
                let stillHovered = false;
                if (intersects.length > 0 && intersects[0].object === this.hoveredNode) {
                    stillHovered = true;
                }
                if (!stillHovered) {
                    gsap.to(this.hoveredNode.scale, { x: 1.0, y: 1.0, z: 1.0, duration: 0.2 });
                    this.hoveredNode = null;
                    this.highlightCallPath(this.pinnedNodeIdx !== null ? this.pinnedNodeIdx : null); // Revert to pinned call path highlight
                    this.hideTooltip(); // Hide hover tooltip
                }
            }
            
            if (intersects.length > 0) {
                const hitNode = intersects[0].object;
                if (hitNode !== this.hoveredNode) {
                    this.hoveredNode = hitNode;
                    const nodeIdx = this.networkNodes.indexOf(hitNode);
                    this.highlightCallPath(nodeIdx); // Highlight call path
                    this.showTooltip(nodeIdx, this.rawMouseEvent); // Render tooltip
                    if (window.app && typeof window.app.playBeep === 'function') {
                        window.app.playBeep(1200, 0.05, 0.01);
                    }
                } else {
                    this.updateTooltipPosition(this.rawMouseEvent); // Slide tooltip
                }
            }
        }

        // 4. Core rotations
        if (this.coreGroup) {
            let speedFactor = this.coreSpeed;
            let currentNoiseFreq = this.noiseFreq;
            
            if (this.systemState === 'anomaly') {
                speedFactor *= 4.5;
                currentNoiseFreq *= 3.0;
            } else if (this.systemState === 'resolving') {
                speedFactor *= 0.5;
            }

            const speed = delta * 0.22 * speedFactor;
            this.coreOuter.rotation.x += speed;
            this.coreOuter.rotation.y += speed * 1.4;
            this.coreInner.rotation.x -= speed * 1.1;
            this.coreInner.rotation.z -= speed * 0.7;

            const positionAttribute = this.coreOuter.geometry.attributes.position;
            const vertexCount = positionAttribute.count;

            for (let i = 0; i < vertexCount; i++) {
                const ox = this.originalOuterVertices.getX(i);
                const oy = this.originalOuterVertices.getY(i);
                const oz = this.originalOuterVertices.getZ(i);

                const noise = Math.sin(ox * currentNoiseFreq + time * 2.2) *
                              Math.cos(oy * currentNoiseFreq + time * 1.9) *
                              Math.sin(oz * currentNoiseFreq + time * 2.5) * 
                              (this.systemState === 'anomaly' ? 0.35 : 0.12);

                const nx = ox + ox * noise;
                const ny = oy + oy * noise;
                const nz = oz + oz * noise;

                positionAttribute.setXYZ(i, nx, ny, nz);
            }
            positionAttribute.needsUpdate = true;
        }

        // 5. Causal Graph Network rotation
        if (this.networkGroup) {
            if (!this.isExplodedMode) {
                this.networkGroup.rotation.y += delta * 0.05 * this.coreSpeed;
            }
            
            // Animate flowing request segments representing traffic load speed
            if (this.networkLines) {
                const throughput = this.lastSystemState ? this.lastSystemState.throughput : 1250;
                const lineFlowSpeed = (throughput / 1250) * 0.3;
                this.networkLines.forEach(line => {
                    if (line.material && line.material.type === 'LineDashedMaterial') {
                        line.material.dashOffset -= delta * lineFlowSpeed;
                    }
                });
            }

            // Animate individual nodes based on their type & sinusoidal bobbing motion
            this.networkNodes.forEach((node, idx) => {
                if (node.basePosY === undefined) node.basePosY = node.position.y;
                const bobOffset = Math.sin(time * 2.0 + idx * 0.4) * 0.04;
                node.position.y = node.basePosY + bobOffset;

                if (node.nodeRole === 'ingress') {
                    node.rotation.x += delta * 0.6;
                    node.rotation.y += delta * 0.3;
                } else if (node.nodeRole === 'router') {
                    node.rotation.x -= delta * 0.4;
                    node.rotation.y += delta * 0.8;
                } else if (node.nodeRole === 'database') {
                    node.rotation.y += delta * 0.5;
                } else if (node.nodeRole === 'cache') {
                    node.rotation.x += delta * 0.3;
                    node.rotation.y += delta * 0.5;
                } else if (node.nodeRole === 'security') {
                    node.rotation.x += delta * 0.4;
                    node.rotation.y += delta * 0.4;
                }
            });
            
            // Update flowing request packet particles
            if (this.packetPointsMesh && this.packets && this.edges) {
                const activeCount = this.activeNodesCount || 24;
                const throughput = this.lastSystemState ? this.lastSystemState.throughput : 1250;
                const flowSpeedMultiplier = Math.max(0.2, throughput / 1250.0);
                
                const positions = this.packetPointsMesh.geometry.attributes.position.array;
                const colors = this.packetPointsMesh.geometry.attributes.color.array;
                
                const activeEdges = [];
                this.edges.forEach((edge, idx) => {
                    if (edge.from < activeCount && edge.to < activeCount) {
                        activeEdges.push(idx);
                    }
                });
                
                for (let i = 0; i < this.maxPackets; i++) {
                    const p = this.packets[i];
                    const idx = i * 3;
                    
                    if (activeEdges.length === 0) {
                        positions[idx] = 9999;
                        positions[idx + 1] = 9999;
                        positions[idx + 2] = 9999;
                        continue;
                    }
                    
                    p.progress += delta * p.speed * flowSpeedMultiplier;
                    
                    if (p.progress >= 1.0) {
                        p.progress = 0.0;
                        p.edgeIdx = activeEdges[Math.floor(Math.random() * activeEdges.length)];
                        p.speed = 0.3 + Math.random() * 0.5;
                    }
                    
                    const edge = this.edges[p.edgeIdx];
                    const fromNode = this.networkNodes[edge.from];
                    const toNode = this.networkNodes[edge.to];
                    
                    if (fromNode && toNode) {
                        const pPos = new THREE.Vector3().copy(fromNode.position).lerp(toNode.position, p.progress);
                        positions[idx] = pPos.x;
                        positions[idx + 1] = pPos.y;
                        positions[idx + 2] = pPos.z;
                        
                        if (this.systemState === 'anomaly') {
                            colors[idx] = 1.0;
                            colors[idx + 1] = 0.1;
                            colors[idx + 2] = 0.3;
                        } else if (this.systemState === 'resolving') {
                            colors[idx] = 0.0;
                            colors[idx + 1] = 1.0;
                            colors[idx + 2] = 0.5;
                        } else {
                            colors[idx] = 0.0;
                            colors[idx + 1] = 0.95;
                            colors[idx + 2] = 1.0;
                        }
                    } else {
                        positions[idx] = 9999;
                        positions[idx + 1] = 9999;
                        positions[idx + 2] = 9999;
                    }
                }
                this.packetPointsMesh.geometry.attributes.position.needsUpdate = true;
                this.packetPointsMesh.geometry.attributes.color.needsUpdate = true;
            }
            
            // Glitch Jitter effect & Blast Radius Propagation wave on under-attack nodes
            if (this.systemState === 'anomaly' && !this.isExplodedMode) {
                const activeCount = this.activeNodesCount || 24;
                const incident = this.lastSystemState ? this.lastSystemState.activeIncident : null;
                
                let rootNodes = [];
                if (incident === 'ddos') rootNodes = [0, 1, 2, 3];
                else if (incident === 'db') rootNodes = [21];
                
                this.networkNodes.forEach((node, idx) => {
                    if (idx < activeCount) {
                        const ox = node.originalPosition.x;
                        const oy = node.originalPosition.y;
                        const oz = node.originalPosition.z;
                        
                        // Positional jitter
                        node.position.x = ox + (Math.random() - 0.5) * 0.05;
                        node.position.y = oy + (Math.random() - 0.5) * 0.05;
                        node.position.z = oz + (Math.random() - 0.5) * 0.05;
                        
                        // Blast Radius pulse and warning wave
                        if (rootNodes.includes(idx)) {
                            const rootPulse = 1.7 + 0.35 * Math.sin(time * 8.0);
                            node.scale.set(rootPulse, rootPulse, rootPulse);
                            node.material.color.setRGB(1.0, 0.0, 0.2);
                        } else {
                            let tierIdx = 0;
                            if (idx >= 0 && idx <= 3) tierIdx = 0;
                            else if (idx === 4) tierIdx = 1;
                            else if (idx >= 21 && idx <= 28) tierIdx = 3;
                            else tierIdx = 2;
                            
                            let distance = 0;
                            if (incident === 'ddos') distance = tierIdx;
                            else if (incident === 'db') distance = 3 - tierIdx;
                            
                            const wave = Math.sin(time * 8.0 - distance * 1.6);
                            if (wave > 0.1) {
                                node.material.color.setRGB(1.0, 0.15, 0.35);
                                node.scale.set(1.2, 1.2, 1.2);
                            } else {
                                node.material.color.setRGB(0.7, 0.0, 0.1);
                                node.scale.set(0.9, 0.9, 0.9);
                            }
                        }
                    }
                });
                
                // Track node positions inside connections and propagate wave color
                this.networkLines.forEach((line, idx) => {
                    const edge = this.edges[idx];
                    const fromPos = this.networkNodes[edge.from].position;
                    const toPos = this.networkNodes[edge.to].position;
                    line.geometry.setFromPoints([fromPos, toPos]);
                    line.geometry.attributes.position.needsUpdate = true;
                    
                    let tierIdx = 0;
                    if (edge.from >= 0 && edge.from <= 3) tierIdx = 0;
                    else if (edge.from === 4) tierIdx = 1;
                    else if (edge.from >= 21 && edge.from <= 28) tierIdx = 3;
                    else tierIdx = 2;
                    
                    let distance = 0;
                    if (incident === 'ddos') distance = tierIdx;
                    else if (incident === 'db') distance = 3 - tierIdx;
                    
                    const wave = Math.sin(time * 8.0 - distance * 1.6);
                    if (wave > 0.1) {
                         line.material.color.setRGB(1.0, 0.15, 0.35);
                         line.material.opacity = 0.6;
                    } else {
                         line.material.color.setRGB(0.6, 0.0, 0.1);
                         line.material.opacity = 0.15;
                    }
                });
            } else if (!this.isExplodedMode) {
                // Return to static coordinates
                let needsLineUpdate = false;
                this.networkNodes.forEach((node) => {
                    if (node.originalPosition && !node.position.equals(node.originalPosition)) {
                        node.position.copy(node.originalPosition);
                        needsLineUpdate = true;
                    }
                });
                
                if (needsLineUpdate) {
                    this.networkLines.forEach((line, idx) => {
                        const edge = this.edges[idx];
                        const fromPos = this.networkNodes[edge.from].position;
                        const toPos = this.networkNodes[edge.to].position;
                        line.geometry.setFromPoints([fromPos, toPos]);
                        line.geometry.attributes.position.needsUpdate = true;
                    });
                }
            }
        }
        
        // Animate exploded concentric process rotation
        if (this.isExplodedMode && this.subSpheres) {
            const rotTime = this.clock.getElapsedTime();
            this.subSpheres.forEach(sub => {
                const subAngle = rotTime * sub.speed;
                sub.mesh.position.x = Math.cos(subAngle) * sub.radius;
                sub.mesh.position.z = Math.sin(subAngle) * sub.radius;
                sub.mesh.position.y = 0;
            });
        }

        // 6. Particle physics vectors
        if (this.nebulaParticles) {
            const positions = this.nebulaParticles.geometry.attributes.position.array;
            const count = positions.length / 3; // Source of truth from actual geometry allocation
            
            this.raycaster.setFromCamera(this.mouse, this.camera);
            this.raycaster.ray.intersectPlane(this.interactionPlane, this.mouse3D);

            for (let i = 0; i < count; i++) {
                const idx = i * 3;
                let px = positions[idx];
                let py = positions[idx + 1];
                let pz = positions[idx + 2];

                const ox = this.originalParticlePositions[idx];
                const oy = this.originalParticlePositions[idx + 1];
                const oz = this.originalParticlePositions[idx + 2];

                const vel = this.particleVelocities[i];
                
                let speedMultiplier = 1.0;
                if (this.systemState === 'anomaly') {
                    speedMultiplier = 3.5;
                } else if (this.systemState === 'resolving') {
                    speedMultiplier = 0.6;
                }

                const rotSpeed = 0.05 * vel.speedMultiplier * this.coreSpeed * speedMultiplier;
                
                const cosA = Math.cos(rotSpeed);
                const sinA = Math.sin(rotSpeed);
                
                const newOx = ox * cosA - oz * sinA;
                const newOz = ox * sinA + oz * cosA;
                this.originalParticlePositions[idx] = newOx;
                this.originalParticlePositions[idx + 2] = newOz;

                const dx = px - this.mouse3D.x;
                const dy = py - this.mouse3D.y;
                const dz = pz - this.mouse3D.z;
                const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

                if (dist < 2.2) {
                    const pushFactor = this.systemState === 'anomaly' ? -0.035 : 0.015;
                    const force = (2.2 - dist) * pushFactor;
                    vel.vx += dx * force;
                    vel.vy += dy * force;
                    vel.vz += dz * force;
                }

                vel.vx *= 0.94;
                vel.vy *= 0.94;
                vel.vz *= 0.94;

                positions[idx] = newOx + vel.vx;
                positions[idx + 1] = oy + vel.vy;
                positions[idx + 2] = newOz + vel.vz;
            }
            this.nebulaParticles.geometry.attributes.position.needsUpdate = true;
        }

        // 7. Render via Post-Processing composer instead of standard renderer
        this.renderer.setClearColor(this.scene.fog.color, 1);
        this.composer.render();
    }

    onClick(e) {
        if (this.isExplodedMode) return;
        if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT' || e.target.tagName === 'BUTTON' || e.target.closest('#telemetry-sidebar') || e.target.closest('.glass-card') || e.target.closest('.hitl-modal-overlay') || e.target.closest('.pin-gate-overlay') || e.target.closest('#node-details-card') || e.target.closest('.control-btn'))) {
            return;
        }
        this.raycaster.setFromCamera(this.mouse, this.camera);
        const intersects = this.raycaster.intersectObjects(this.networkNodes);
        
        if (intersects.length > 0) {
            const hitNode = intersects[0].object;
            const nodeIdx = this.networkNodes.indexOf(hitNode);
            if (nodeIdx !== -1) {
                const worldPos = new THREE.Vector3().copy(hitNode.position).applyMatrix4(this.networkGroup.matrixWorld);
                const burstColor = (this.systemState === 'anomaly') ? 0xff007f : (this.systemState === 'resolving' ? 0x39ff14 : 0x00f3ff);
                this.createParticleBurst(worldPos, burstColor, 35);

                if (this.pinnedNodeIdx === nodeIdx) {
                    this.pinnedNodeIdx = null;
                    this.highlightCallPath(this.hoveredNode ? this.networkNodes.indexOf(this.hoveredNode) : null);
                } else {
                    this.pinnedNodeIdx = nodeIdx;
                    this.highlightCallPath(nodeIdx);
                }
                
                if (window.app && typeof window.app.showNodeDetails === 'function') {
                    window.app.showNodeDetails(nodeIdx);
                }
            }
        } else {
            // Clicked empty space
            if (this.pinnedNodeIdx !== null) {
                this.pinnedNodeIdx = null;
                this.highlightCallPath(this.hoveredNode ? this.networkNodes.indexOf(this.hoveredNode) : null);
                if (window.app && typeof window.app.hideNodeDetails === 'function') {
                    window.app.hideNodeDetails();
                }
            }
        }
    }

    onDoubleClick(e) {
        if (this.isExplodedMode) return;
        if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT' || e.target.tagName === 'BUTTON' || e.target.closest('#telemetry-sidebar') || e.target.closest('.glass-card') || e.target.closest('.hitl-modal-overlay') || e.target.closest('.pin-gate-overlay') || e.target.closest('#node-details-card') || e.target.closest('.control-btn'))) {
            return;
        }
        this.raycaster.setFromCamera(this.mouse, this.camera);
        const intersects = this.raycaster.intersectObjects(this.networkNodes);
        if (intersects.length > 0) {
            const hitNode = intersects[0].object;
            const nodeIdx = this.networkNodes.indexOf(hitNode);
            const activeCount = this.activeNodesCount || 24;
            if (nodeIdx !== -1 && nodeIdx < activeCount) {
                this.explodeNode(nodeIdx);
            }
        }
    }

    explodeNode(nodeIdx) {
        if (this.explodedNodeIdx !== undefined) return;
        this.explodedNodeIdx = nodeIdx;
        this.hideTooltip();
        
        const node = this.networkNodes[nodeIdx];
        const targetPos = new THREE.Vector3().copy(node.position).applyMatrix4(this.networkGroup.matrixWorld);
        
        const camTargetPos = new THREE.Vector3().copy(targetPos).add(new THREE.Vector3(0, 0.6, 2.2));
        
        gsap.to(this.camera.position, {
            x: camTargetPos.x,
            y: camTargetPos.y,
            z: camTargetPos.z,
            duration: 1.2,
            ease: 'power3.inOut'
        });
        
        gsap.to(this.currentLookAt, {
            x: targetPos.x,
            y: targetPos.y,
            z: targetPos.z,
            duration: 1.2,
            ease: 'power3.inOut'
        });
        
        // Hide standard components
        this.networkNodes.forEach(n => {
            gsap.to(n.material, { opacity: 0.0, duration: 0.5 });
        });
        this.networkLines.forEach(l => {
            gsap.to(l.material, { opacity: 0.0, duration: 0.5 });
        });
        if (this.packetMaterial) {
            gsap.to(this.packetMaterial, { opacity: 0.0, duration: 0.5 });
        }
        
        this.isExplodedMode = true;
        
        // Build Concentric Process Substructures
        this.explodeGroup = new THREE.Group();
        this.explodeGroup.position.copy(node.position);
        this.networkGroup.add(this.explodeGroup);
        
        // Concentric Ring 1: Processes
        const ringGeo1 = new THREE.RingGeometry(0.24, 0.26, 32);
        const ringMat1 = new THREE.MeshBasicMaterial({ color: 0xbc00dd, side: THREE.DoubleSide, transparent: true, opacity: 0.8 });
        const ring1 = new THREE.Mesh(ringGeo1, ringMat1);
        ring1.rotation.x = Math.PI / 2;
        this.explodeGroup.add(ring1);
        
        // Concentric Ring 2: Ports
        const ringGeo2 = new THREE.RingGeometry(0.44, 0.46, 32);
        const ringMat2 = new THREE.MeshBasicMaterial({ color: 0x00f3ff, side: THREE.DoubleSide, transparent: true, opacity: 0.8 });
        const ring2 = new THREE.Mesh(ringGeo2, ringMat2);
        ring2.rotation.x = Math.PI / 2;
        this.explodeGroup.add(ring2);
        
        // Add tiny processes/ports sub-nodes
        const subGeo = new THREE.SphereGeometry(0.02, 6, 6);
        const subMat = new THREE.MeshBasicMaterial({ color: 0x39ff14 });
        
        this.subSpheres = [];
        for (let i = 0; i < 3; i++) {
            const sphere = new THREE.Mesh(subGeo, subMat);
            this.explodeGroup.add(sphere);
            this.subSpheres.push({ mesh: sphere, radius: 0.25 + i * 0.1, speed: 0.8 + i * 0.4 });
        }
        
        // Reveal zoom out button
        const backBtn = document.getElementById('btn-exit-explode');
        if (backBtn) {
            backBtn.classList.remove('hidden');
            gsap.fromTo(backBtn, { opacity: 0, scale: 0.8 }, { opacity: 1, scale: 1.0, duration: 0.5 });
        }
        
        if (window.app && typeof window.app.showNodeDetails === 'function') {
            window.app.showNodeDetails(nodeIdx);
        }
        
        this.playBeep(880, 0.3, 0.05);
    }

    exitExplodeNode() {
        if (this.explodedNodeIdx === undefined) return;
        
        const currentTargetIndex = Math.min(Math.floor(this.scrollProxy.value), this.cameraTargets.length - 1);
        const targetCamPos = this.cameraTargets[currentTargetIndex].pos;
        const targetCamLook = this.cameraTargets[currentTargetIndex].look;
        
        gsap.to(this.camera.position, {
            x: targetCamPos.x,
            y: targetCamPos.y,
            z: targetCamPos.z,
            duration: 1.2,
            ease: 'power3.inOut'
        });
        
        gsap.to(this.currentLookAt, {
            x: targetCamLook.x,
            y: targetCamLook.y,
            z: targetCamLook.z,
            duration: 1.2,
            ease: 'power3.inOut',
            onComplete: () => {
                this.isExplodedMode = false;
            }
        });
        this.updateActiveNodesVis(this.activeNodesCount || 24);
        if (this.packetMaterial) {
            gsap.to(this.packetMaterial, { opacity: 0.9, duration: 0.5 });
        }
        
        if (this.explodeGroup) {
            this.networkGroup.remove(this.explodeGroup);
            this.explodeGroup = null;
            this.subSpheres = [];
        }
        
        this.explodedNodeIdx = undefined;
        
        const backBtn = document.getElementById('btn-exit-explode');
        if (backBtn) {
            gsap.to(backBtn, {
                opacity: 0,
                scale: 0.8,
                duration: 0.3,
                onComplete: () => backBtn.classList.add('hidden')
            });
        }
        
        if (window.app && typeof window.app.hideNodeDetails === 'function') {
            window.app.hideNodeDetails();
        }
        
        this.playBeep(440, 0.2, 0.04);
    }

    showTooltip(target, e) {
        const tooltip = document.getElementById('webgl-tooltip');
        if (!tooltip) return;
        
        let nodeIdx = typeof target === 'number' ? target : (this.networkNodes ? this.networkNodes.indexOf(target) : 0);
        if (nodeIdx < 0) nodeIdx = 0;

        let name = "Worker Service";
        let cpu = "32%";
        let ram = "45%";
        let pod = "k8s-service-pod";
        let resp = "2.4ms";
        let threat = "None";
        let isAnomaly = false;

        // Priority #7: Layer-specific procedural pod telemetry
        if (nodeIdx >= 0 && nodeIdx <= 3) {
            pod = `k8s-ingress-gateway-${nodeIdx}`;
            ram = (40 + (nodeIdx * 3)) + "%";
        } else if (nodeIdx === 4) {
            pod = "k8s-api-router";
            ram = "72%";
        } else if (nodeIdx >= 5 && nodeIdx <= 20) {
            pod = `k8s-microservice-${nodeIdx}`;
            ram = (45 + (nodeIdx % 10) * 2) + "%";
        } else {
            pod = `k8s-db-cluster-${nodeIdx - 20}`;
            ram = (70 + (nodeIdx % 5) * 3) + "%";
        }
        
        if (window.app) {
            name = (window.app.nodeNames && window.app.nodeNames[nodeIdx]) ? window.app.nodeNames[nodeIdx] : `node-${nodeIdx}`;
            const activeNodes = window.app.lastSystemState ? window.app.lastSystemState.nodes : 24;
            const systemStatus = window.app.lastSystemState ? window.app.lastSystemState.status : 'nominal';
            const activeIncident = window.app.lastSystemState ? window.app.lastSystemState.activeIncident : null;
            
            if (nodeIdx >= activeNodes) {
                cpu = "0%";
                ram = "0%";
                resp = "Offline";
                threat = "None";
            } else if (systemStatus === 'anomaly') {
                if (activeIncident === 'ddos' && nodeIdx < 12) {
                    cpu = "96%";
                    resp = "540ms";
                    threat = "DDoS Botnet (High)";
                    isAnomaly = true;
                } else if (activeIncident === 'db' && nodeIdx === 21) {
                    cpu = "100%";
                    resp = "IO Timeout";
                    threat = "IOPS Flatline (Critical)";
                    isAnomaly = true;
                }
            } else {
                cpu = (30 + (nodeIdx % 15)) + "%";
                resp = (1.5 + (nodeIdx % 5) * 0.8).toFixed(1) + "ms";
            }
        }
        
        tooltip.className = isAnomaly ? 'webgl-tooltip anomaly' : 'webgl-tooltip';
        tooltip.innerHTML = '';

        const nameDiv = document.createElement('div');
        nameDiv.style.cssText = 'font-weight:bold;color:var(--accent-cyan);margin-bottom:0.25rem;font-family:var(--font-heading);font-size:0.65rem;';
        nameDiv.textContent = String(name).toUpperCase();
        tooltip.appendChild(nameDiv);

        const podDiv = document.createElement('div');
        podDiv.style.cssText = 'font-size:0.55rem;color:var(--text-secondary);margin-bottom:0.25rem;';
        podDiv.textContent = `POD: ${pod}`;
        tooltip.appendChild(podDiv);

        const cpuDiv = document.createElement('div');
        cpuDiv.textContent = 'CPU Load: ';
        const cpuSpan = document.createElement('span');
        cpuSpan.style.color = '#fff';
        cpuSpan.textContent = cpu;
        cpuDiv.appendChild(cpuSpan);
        tooltip.appendChild(cpuDiv);

        const ramDiv = document.createElement('div');
        ramDiv.textContent = 'RAM Usage: ';
        const ramSpan = document.createElement('span');
        ramSpan.style.color = '#fff';
        ramSpan.textContent = ram;
        ramDiv.appendChild(ramSpan);
        tooltip.appendChild(ramDiv);

        const latDiv = document.createElement('div');
        latDiv.textContent = 'Latency: ';
        const latSpan = document.createElement('span');
        latSpan.style.color = '#fff';
        latSpan.textContent = resp;
        latDiv.appendChild(latSpan);
        tooltip.appendChild(latDiv);

        const threatDiv = document.createElement('div');
        threatDiv.textContent = 'Threat Level: ';
        const threatSpan = document.createElement('span');
        threatSpan.style.color = isAnomaly ? 'var(--accent-pink)' : 'var(--accent-green)';
        threatSpan.textContent = threat;
        threatDiv.appendChild(threatSpan);
        tooltip.appendChild(threatDiv);
        
        tooltip.classList.remove('hidden');
        this.updateTooltipPosition(e);
    }

    updateTooltipPosition(e) {
        const tooltip = document.getElementById('webgl-tooltip');
        if (tooltip && e) {
            tooltip.style.left = (e.clientX + 15) + 'px';
            tooltip.style.top = (e.clientY + 15) + 'px';
        }
    }

    hideTooltip() {
        const tooltip = document.getElementById('webgl-tooltip');
        if (tooltip) tooltip.classList.add('hidden');
    }

    playBeep(frequency, duration, volume = 0.04) {
        if (window.app && typeof window.app.playBeep === 'function') {
            window.app.playBeep(frequency, duration, volume);
        }
    }
}
