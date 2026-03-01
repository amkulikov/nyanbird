(function () {
    'use strict';

    // ==================== CONFIG ====================
    const CONFIG = {
        // Physics
        gravity: -25,
        flapForce: 9,
        maxFallSpeed: -15,
        forwardSpeed: 12,

        // Pipes
        pipeGap: 5.5,
        pipeWidth: 2.0,
        pipeDepth: 1.5,
        pipeSpacing: 18,
        pipeCount: 8,
        pipeHeightRange: { min: -3.5, max: 3.5 },

        // World
        tunnelWidth: 14,
        tunnelHeight: 16,
        groundY: -8,
        ceilingY: 8,

        // Camera
        cameraFOV: 75,
        cameraTilt: 0.15,
        cameraShakeIntensity: 0.03,

        // Colors
        skyTop: 0x1a1a2e,
        skyBottom: 0x16213e,
        pipeColor: 0x4ecd52,
        pipeEmissive: 0x1a5c1d,
        groundColor: 0x2d5a27,
        fogColor: 0x1a1a2e,
        fogNear: 30,
        fogFar: 90,
    };

    // ==================== STATE ====================
    let state = {
        phase: 'menu', // menu | playing | dead
        playerY: 0,
        velocity: 0,
        score: 0,
        bestScore: parseInt(localStorage.getItem('flappy3d_best') || '0', 10),
        distance: 0,
        nextPipeIndex: 0,
        pipesPassed: new Set(),
        shakeTimer: 0,
    };

    // ==================== DOM ====================
    const canvas = document.getElementById('gameCanvas');
    const startScreen = document.getElementById('start-screen');
    const gameoverScreen = document.getElementById('gameover-screen');
    const hud = document.getElementById('hud');
    const scoreDisplay = document.getElementById('score-display');
    const finalScoreValue = document.getElementById('final-score-value');
    const bestScoreValue = document.getElementById('best-score-value');
    const startBtn = document.getElementById('start-btn');
    const restartBtn = document.getElementById('restart-btn');

    // ==================== THREE.JS SETUP ====================
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(CONFIG.fogColor, CONFIG.fogNear, CONFIG.fogFar);
    scene.background = new THREE.Color(CONFIG.skyTop);

    const camera = new THREE.PerspectiveCamera(
        CONFIG.cameraFOV,
        window.innerWidth / window.innerHeight,
        0.1,
        200
    );

    // ==================== LIGHTING ====================
    const ambientLight = new THREE.AmbientLight(0x6688cc, 0.5);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffeedd, 0.8);
    dirLight.position.set(5, 10, 5);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 1024;
    dirLight.shadow.mapSize.height = 1024;
    scene.add(dirLight);

    const pointLight = new THREE.PointLight(0x4ecd52, 0.4, 30);
    scene.add(pointLight);

    // ==================== MATERIALS ====================
    const pipeMaterial = new THREE.MeshPhongMaterial({
        color: CONFIG.pipeColor,
        emissive: CONFIG.pipeEmissive,
        emissiveIntensity: 0.3,
        shininess: 80,
        specular: 0x88ff88,
    });

    const pipeCapMaterial = new THREE.MeshPhongMaterial({
        color: 0x3ab53e,
        emissive: 0x145a16,
        emissiveIntensity: 0.3,
        shininess: 100,
        specular: 0x88ff88,
    });

    const groundMaterial = new THREE.MeshPhongMaterial({
        color: CONFIG.groundColor,
        emissive: 0x0a2a08,
        emissiveIntensity: 0.2,
    });

    const wallMaterial = new THREE.MeshPhongMaterial({
        color: 0x2a2a4a,
        emissive: 0x0a0a1e,
        emissiveIntensity: 0.1,
        transparent: true,
        opacity: 0.3,
    });

    // ==================== GEOMETRY ====================
    // Ground
    const groundGeo = new THREE.PlaneGeometry(400, CONFIG.tunnelWidth);
    const ground = new THREE.Mesh(groundGeo, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.rotation.z = -Math.PI / 2;
    ground.position.y = CONFIG.groundY;
    ground.receiveShadow = true;
    scene.add(ground);

    // Ceiling
    const ceiling = new THREE.Mesh(groundGeo, groundMaterial);
    ceiling.rotation.x = Math.PI / 2;
    ceiling.rotation.z = Math.PI / 2;
    ceiling.position.y = CONFIG.ceilingY;
    scene.add(ceiling);

    // Side walls (translucent)
    const wallGeo = new THREE.PlaneGeometry(400, CONFIG.tunnelHeight);
    const leftWall = new THREE.Mesh(wallGeo, wallMaterial);
    leftWall.rotation.y = Math.PI / 2;
    leftWall.position.x = -CONFIG.tunnelWidth / 2;
    leftWall.position.y = (CONFIG.groundY + CONFIG.ceilingY) / 2;
    scene.add(leftWall);

    const rightWall = new THREE.Mesh(wallGeo, wallMaterial);
    rightWall.rotation.y = -Math.PI / 2;
    rightWall.position.x = CONFIG.tunnelWidth / 2;
    rightWall.position.y = (CONFIG.groundY + CONFIG.ceilingY) / 2;
    scene.add(rightWall);

    // Ground grid lines for sense of speed
    const gridLines = [];
    for (let i = 0; i < 50; i++) {
        const lineGeo = new THREE.PlaneGeometry(CONFIG.tunnelWidth, 0.05);
        const lineMat = new THREE.MeshBasicMaterial({
            color: 0x3a6a34,
            transparent: true,
            opacity: 0.5,
        });
        const line = new THREE.Mesh(lineGeo, lineMat);
        line.rotation.x = -Math.PI / 2;
        line.position.y = CONFIG.groundY + 0.01;
        line.position.z = -i * 4;
        scene.add(line);
        gridLines.push(line);
    }

    // ==================== PIPES ====================
    const pipes = [];

    function createPipe(zPos) {
        const group = new THREE.Group();

        const gapCenter =
            CONFIG.pipeHeightRange.min +
            Math.random() * (CONFIG.pipeHeightRange.max - CONFIG.pipeHeightRange.min);
        const halfGap = CONFIG.pipeGap / 2;

        // Bottom pipe
        const bottomHeight = gapCenter - halfGap - CONFIG.groundY;
        if (bottomHeight > 0.1) {
            const bottomGeo = new THREE.BoxGeometry(
                CONFIG.pipeWidth,
                bottomHeight,
                CONFIG.pipeDepth
            );
            const bottomPipe = new THREE.Mesh(bottomGeo, pipeMaterial);
            bottomPipe.position.y = CONFIG.groundY + bottomHeight / 2;
            bottomPipe.castShadow = true;
            group.add(bottomPipe);

            // Bottom cap
            const capGeo = new THREE.BoxGeometry(
                CONFIG.pipeWidth + 0.4,
                0.4,
                CONFIG.pipeDepth + 0.4
            );
            const cap = new THREE.Mesh(capGeo, pipeCapMaterial);
            cap.position.y = CONFIG.groundY + bottomHeight;
            group.add(cap);
        }

        // Top pipe
        const topHeight = CONFIG.ceilingY - (gapCenter + halfGap);
        if (topHeight > 0.1) {
            const topGeo = new THREE.BoxGeometry(
                CONFIG.pipeWidth,
                topHeight,
                CONFIG.pipeDepth
            );
            const topPipe = new THREE.Mesh(topGeo, pipeMaterial);
            topPipe.position.y = CONFIG.ceilingY - topHeight / 2;
            topPipe.castShadow = true;
            group.add(topPipe);

            // Top cap
            const capGeo = new THREE.BoxGeometry(
                CONFIG.pipeWidth + 0.4,
                0.4,
                CONFIG.pipeDepth + 0.4
            );
            const cap = new THREE.Mesh(capGeo, pipeCapMaterial);
            cap.position.y = CONFIG.ceilingY - topHeight;
            group.add(cap);
        }

        // Glow ring around gap
        const ringGeo = new THREE.TorusGeometry(
            CONFIG.pipeGap / 2 - 0.3,
            0.08,
            8,
            4
        );
        const ringMat = new THREE.MeshBasicMaterial({
            color: 0x88ff88,
            transparent: true,
            opacity: 0.4,
        });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.position.y = gapCenter;
        ring.rotation.y = Math.PI / 4;
        group.add(ring);

        group.position.z = zPos;
        group.userData = {
            gapCenter,
            passed: false,
            baseZ: zPos,
        };

        scene.add(group);
        return group;
    }

    function initPipes() {
        pipes.forEach((p) => scene.remove(p));
        pipes.length = 0;
        for (let i = 0; i < CONFIG.pipeCount; i++) {
            const z = -(20 + i * CONFIG.pipeSpacing);
            pipes.push(createPipe(z));
        }
    }

    // ==================== PARTICLES ====================
    const particleCount = 200;
    const particleGeo = new THREE.BufferGeometry();
    const particlePositions = new Float32Array(particleCount * 3);
    const particleSizes = new Float32Array(particleCount);

    for (let i = 0; i < particleCount; i++) {
        particlePositions[i * 3] = (Math.random() - 0.5) * CONFIG.tunnelWidth;
        particlePositions[i * 3 + 1] =
            CONFIG.groundY + Math.random() * (CONFIG.ceilingY - CONFIG.groundY);
        particlePositions[i * 3 + 2] = -Math.random() * 100;
        particleSizes[i] = Math.random() * 3 + 1;
    }

    particleGeo.setAttribute(
        'position',
        new THREE.BufferAttribute(particlePositions, 3)
    );
    particleGeo.setAttribute(
        'size',
        new THREE.BufferAttribute(particleSizes, 1)
    );

    const particleMat = new THREE.PointsMaterial({
        color: 0x88ffaa,
        size: 0.1,
        transparent: true,
        opacity: 0.4,
        sizeAttenuation: true,
    });
    const particles = new THREE.Points(particleGeo, particleMat);
    scene.add(particles);

    // ==================== CROSSHAIR (nose indicator) ====================
    const crosshairGroup = new THREE.Group();

    const ringCrosshair = new THREE.RingGeometry(0.06, 0.08, 16);
    const ringMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.5,
        side: THREE.DoubleSide,
    });
    crosshairGroup.add(new THREE.Mesh(ringCrosshair, ringMat));
    scene.add(crosshairGroup);

    // ==================== SOUND (Web Audio API) ====================
    let audioCtx = null;

    function initAudio() {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
    }

    function playSound(freq, duration, type, volume) {
        if (!audioCtx) return;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = type || 'square';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(volume || 0.1, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(
            0.001,
            audioCtx.currentTime + duration
        );
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + duration);
    }

    function flapSound() {
        playSound(440, 0.1, 'sine', 0.08);
        playSound(580, 0.08, 'sine', 0.05);
    }

    function scoreSound() {
        playSound(660, 0.1, 'square', 0.06);
        setTimeout(() => playSound(880, 0.15, 'square', 0.06), 80);
    }

    function hitSound() {
        playSound(150, 0.3, 'sawtooth', 0.1);
        playSound(100, 0.4, 'square', 0.08);
    }

    // ==================== GAME LOGIC ====================
    function resetGame() {
        state.playerY = 0;
        state.velocity = 0;
        state.score = 0;
        state.distance = 0;
        state.pipesPassed = new Set();
        state.shakeTimer = 0;
        scoreDisplay.textContent = '0';
        initPipes();
    }

    function startGame() {
        initAudio();
        resetGame();
        state.phase = 'playing';
        startScreen.classList.add('hidden');
        gameoverScreen.classList.add('hidden');
        hud.classList.remove('hidden');
    }

    function gameOver() {
        state.phase = 'dead';
        hitSound();

        if (state.score > state.bestScore) {
            state.bestScore = state.score;
            localStorage.setItem('flappy3d_best', state.bestScore.toString());
        }

        state.shakeTimer = 0.4;

        setTimeout(() => {
            hud.classList.add('hidden');
            gameoverScreen.classList.remove('hidden');
            finalScoreValue.textContent = state.score;
            bestScoreValue.textContent = state.bestScore;
        }, 600);
    }

    function flap() {
        if (state.phase === 'playing') {
            state.velocity = CONFIG.flapForce;
            flapSound();
        }
    }

    // ==================== COLLISION ====================
    function checkCollision() {
        const playerRadius = 0.4;
        const py = state.playerY;

        // Ground / Ceiling
        if (py - playerRadius <= CONFIG.groundY || py + playerRadius >= CONFIG.ceilingY) {
            return true;
        }

        // Pipe collision
        for (const pipe of pipes) {
            const pz = pipe.position.z;
            const halfDepth = CONFIG.pipeDepth / 2 + playerRadius;

            // Check if player is within pipe's z range
            if (pz - halfDepth < 0 && pz + halfDepth > 0) {
                const halfWidth = CONFIG.pipeWidth / 2 + playerRadius;

                // Check x range (player is at x=0)
                if (-halfWidth < 0 && halfWidth > 0) {
                    const gap = pipe.userData.gapCenter;
                    const halfGap = CONFIG.pipeGap / 2 - playerRadius;

                    if (py < gap - halfGap || py > gap + halfGap) {
                        return true;
                    }
                }
            }
        }

        return false;
    }

    // ==================== UPDATE ====================
    let lastTime = 0;

    function update(time) {
        requestAnimationFrame(update);

        const now = time / 1000;
        const dt = Math.min(now - lastTime, 0.05);
        lastTime = now;

        if (state.phase === 'playing') {
            // Physics
            state.velocity += CONFIG.gravity * dt;
            if (state.velocity < CONFIG.maxFallSpeed) {
                state.velocity = CONFIG.maxFallSpeed;
            }
            state.playerY += state.velocity * dt;

            // Move forward
            const dz = CONFIG.forwardSpeed * dt;
            state.distance += dz;

            // Move pipes towards camera
            for (const pipe of pipes) {
                pipe.position.z += dz;

                // Score check
                if (!pipe.userData.passed && pipe.position.z > 0) {
                    pipe.userData.passed = true;
                    state.score++;
                    scoreDisplay.textContent = state.score;
                    scoreSound();
                }

                // Recycle pipe
                if (pipe.position.z > 15) {
                    const furthestZ = pipes.reduce(
                        (min, p) => Math.min(min, p.position.z),
                        Infinity
                    );
                    recyclePipe(pipe, furthestZ - CONFIG.pipeSpacing);
                }
            }

            // Move ground lines
            for (const line of gridLines) {
                line.position.z += dz;
                if (line.position.z > 10) {
                    line.position.z -= 200;
                }
            }

            // Move particles
            const positions = particles.geometry.attributes.position.array;
            for (let i = 0; i < particleCount; i++) {
                positions[i * 3 + 2] += dz;
                if (positions[i * 3 + 2] > 5) {
                    positions[i * 3 + 2] -= 105;
                    positions[i * 3] = (Math.random() - 0.5) * CONFIG.tunnelWidth;
                    positions[i * 3 + 1] =
                        CONFIG.groundY +
                        Math.random() * (CONFIG.ceilingY - CONFIG.groundY);
                }
            }
            particles.geometry.attributes.position.needsUpdate = true;

            // Collision
            if (checkCollision()) {
                gameOver();
            }
        }

        // Camera
        const targetY = state.playerY;
        camera.position.set(0, targetY, 0);
        camera.rotation.set(0, 0, 0);

        // Slight downward tilt based on velocity
        if (state.phase === 'playing') {
            const tiltAngle =
                (-state.velocity / CONFIG.flapForce) * CONFIG.cameraTilt;
            camera.rotation.x = Math.max(-0.4, Math.min(0.2, tiltAngle));
        }

        // Camera shake on death
        if (state.shakeTimer > 0) {
            state.shakeTimer -= dt;
            const intensity =
                CONFIG.cameraShakeIntensity * (state.shakeTimer / 0.4);
            camera.position.x += (Math.random() - 0.5) * intensity * 2;
            camera.position.y += (Math.random() - 0.5) * intensity * 2;
        }

        // Point light follows camera
        pointLight.position.set(0, targetY, 2);

        // Update crosshair
        crosshairGroup.position.set(0, targetY, -2);

        // Pipe glow ring animation
        for (const pipe of pipes) {
            const ring = pipe.children.find(
                (c) => c.geometry && c.geometry.type === 'TorusGeometry'
            );
            if (ring) {
                ring.rotation.z += dt * 1.5;
                const dist = Math.abs(pipe.position.z);
                ring.material.opacity = dist < 20 ? 0.6 : 0.2;
            }
        }

        // Direction light follows player
        dirLight.position.z = -state.distance;

        camera.lookAt(0, targetY + camera.rotation.x * 2, -10);

        renderer.render(scene, camera);
    }

    function recyclePipe(pipe, newZ) {
        scene.remove(pipe);
        const idx = pipes.indexOf(pipe);
        const newPipe = createPipe(newZ);
        pipes[idx] = newPipe;
    }

    // ==================== INPUT ====================
    function handleInput(e) {
        if (state.phase === 'playing') {
            e.preventDefault();
            flap();
        }
    }

    document.addEventListener('keydown', (e) => {
        if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') {
            handleInput(e);
        }
    });

    canvas.addEventListener('mousedown', handleInput);
    canvas.addEventListener('touchstart', handleInput, { passive: false });

    startBtn.addEventListener('click', startGame);
    restartBtn.addEventListener('click', startGame);

    // Keyboard shortcuts for menu
    document.addEventListener('keydown', (e) => {
        if (e.code === 'Space' || e.code === 'Enter') {
            if (state.phase === 'menu') {
                startGame();
            } else if (state.phase === 'dead' && !gameoverScreen.classList.contains('hidden')) {
                startGame();
            }
        }
    });

    // ==================== RESIZE ====================
    window.addEventListener('resize', () => {
        const w = window.innerWidth;
        const h = window.innerHeight;
        renderer.setSize(w, h);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
    });

    // ==================== INIT ====================
    bestScoreValue.textContent = state.bestScore;
    camera.position.set(0, 0, 0);
    camera.lookAt(0, 0, -10);

    // Idle animation on menu
    function menuAnimation(time) {
        if (state.phase !== 'menu') return;
        const t = time / 1000;
        camera.position.y = Math.sin(t * 0.8) * 1.5;
        camera.lookAt(0, camera.position.y, -10);
        renderer.render(scene, camera);
        requestAnimationFrame(menuAnimation);
    }

    initPipes();
    requestAnimationFrame(menuAnimation);
    requestAnimationFrame(update);
})();
