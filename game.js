(function () {
    'use strict';

    // ==================== CONFIG ====================
    const CONFIG = {
        // Physics
        gravity: -25,
        flapForce: 9,
        maxFallSpeed: -15,
        baseForwardSpeed: 12,
        maxForwardSpeed: 24,

        // Pipes
        basePipeGap: 5.5,
        minPipeGap: 3.5,
        pipeWidth: 2.0,
        pipeDepth: 1.5,
        pipeSpacing: 18,
        pipeCount: 8,
        pipeHeightRange: { min: -3.5, max: 3.5 },

        // Difficulty — every N points speed/gap change
        difficultyInterval: 5,
        speedPerLevel: 0.7,
        gapPerLevel: 0.15,

        // Boost
        boostDuration: 3,
        boostSpeedMul: 2.2,
        boostOrbChance: 0.075,

        // World
        areaWidth: 20,
        groundY: -8,
        ceilingY: 8,

        // Camera (third-person)
        cameraFOV: 60,
        camZ: 8,
        camY: 2.5,
        camLookZ: -8,
        camSmooth: 4,
        shakeIntensity: 0.06,

        // Collision — intentionally smaller than visual bird
        collisionRadius: 0.25,

        // Colors
        skyColor: 0x4ec5f1,
        pipeColor: 0x4ecd52,
        pipeEmissive: 0x1a5c1d,
        groundColor: 0xdeb887,
        fogColor: 0x87ceeb,
        fogNear: 35,
        fogFar: 100,
    };

    // Nyan Cat rainbow bands (left → right): red, orange, yellow, green, blue, violet
    const NYAN_BANDS = [0xff0000, 0xff8800, 0xffff00, 0x00ff00, 0x0099ff, 0x6633ff];
    const BAND_COUNT = NYAN_BANDS.length;
    const BAND_W = 0.28;   // width of each vertical stripe
    const BAND_GAP = 0.30; // horizontal spacing between stripes

    // ==================== STATE ====================
    let state = {
        phase: 'menu', // menu | playing | dead
        playerY: 0,
        velocity: 0,
        score: 0,
        bestScore: parseInt(localStorage.getItem('nyanbird_best') || '0', 10),
        distance: 0,
        shakeTimer: 0,
        // difficulty
        forwardSpeed: CONFIG.baseForwardSpeed,
        pipeGap: CONFIG.basePipeGap,
        diffLevel: 0,
        // boost
        boostTimer: 0,
        boostActive: false,
        boostTargetY: 0,
        // camera
        camSmoothY: CONFIG.camY,
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
    const boostIndicator = document.getElementById('boost-indicator');
    const flashOverlay = document.getElementById('flash-overlay');

    // ==================== THREE.JS SETUP ====================
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(CONFIG.fogColor, CONFIG.fogNear, CONFIG.fogFar);
    scene.background = new THREE.Color(CONFIG.skyColor);

    const camera = new THREE.PerspectiveCamera(
        CONFIG.cameraFOV,
        window.innerWidth / window.innerHeight,
        0.1,
        200
    );

    // ==================== LIGHTING ====================
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffeedd, 0.8);
    dirLight.position.set(5, 15, -10);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 1024;
    dirLight.shadow.mapSize.height = 1024;
    scene.add(dirLight);

    const pointLight = new THREE.PointLight(0xffffff, 0.15, 20);
    scene.add(pointLight);

    // ==================== MATERIALS ====================
    const pipeMat = new THREE.MeshPhongMaterial({
        color: CONFIG.pipeColor,
        emissive: CONFIG.pipeEmissive,
        emissiveIntensity: 0.2,
        shininess: 30,
        specular: 0x224422,
    });
    const pipeCapMat = new THREE.MeshPhongMaterial({
        color: 0x3ab53e,
        emissive: 0x145a16,
        emissiveIntensity: 0.2,
        shininess: 40,
        specular: 0x224422,
    });
    const groundMat = new THREE.MeshPhongMaterial({
        color: CONFIG.groundColor,
        emissive: 0x5a4a30,
        emissiveIntensity: 0.1,
    });

    // ==================== GROUND + GRID ====================
    const groundGeo = new THREE.PlaneGeometry(400, CONFIG.areaWidth);
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.rotation.z = -Math.PI / 2;
    ground.position.y = CONFIG.groundY;
    ground.receiveShadow = true;
    scene.add(ground);

    // Grass strip — solid box sitting on top of ground
    const grassMat = new THREE.MeshPhongMaterial({
        color: 0x5abf2e,
        emissive: 0x2a6f10,
        emissiveIntensity: 0.15,
    });
    const grassGeo = new THREE.BoxGeometry(CONFIG.areaWidth, 0.3, 400);
    const grass = new THREE.Mesh(grassGeo, grassMat);
    grass.position.y = CONFIG.groundY + 0.15;
    scene.add(grass);

    // Grass tufts — small cones sitting on the grass strip, scroll with the world
    const grassTufts = [];
    const tuftMats = [
        new THREE.MeshPhongMaterial({ color: 0x3da51a }),
        new THREE.MeshPhongMaterial({ color: 0x4fc832 }),
        new THREE.MeshPhongMaterial({ color: 0x2e8b15 }),
    ];
    for (let i = 0; i < 60; i++) {
        const h = 0.2 + Math.random() * 0.35;
        const r = 0.1 + Math.random() * 0.15;
        const tuftGeo = new THREE.ConeGeometry(r, h, 5);
        const tuft = new THREE.Mesh(tuftGeo, tuftMats[i % 3]);
        tuft.position.set(
            (Math.random() - 0.5) * 8,
            CONFIG.groundY + 0.3 + h / 2,
            -(Math.random() * 200)
        );
        scene.add(tuft);
        grassTufts.push(tuft);
    }

    const gridLines = [];
    for (let i = 0; i < 50; i++) {
        const geo = new THREE.PlaneGeometry(CONFIG.areaWidth, 0.08);
        const mat = new THREE.MeshBasicMaterial({
            color: 0xc4a265,
            transparent: true,
            opacity: 0.35,
        });
        const line = new THREE.Mesh(geo, mat);
        line.rotation.x = -Math.PI / 2;
        line.position.y = CONFIG.groundY + 0.01;
        line.position.z = -i * 4;
        scene.add(line);
        gridLines.push(line);
    }

    // ==================== CLOUDS ====================
    const clouds = [];

    function createCloud(x, y, z) {
        const group = new THREE.Group();
        const mat = new THREE.MeshPhongMaterial({
            color: 0xffffff,
            emissive: 0xdddddd,
            emissiveIntensity: 0.05,
            transparent: true,
            opacity: 0.85,
        });
        const count = 4 + Math.floor(Math.random() * 4);
        for (let i = 0; i < count; i++) {
            const r = 0.6 + Math.random() * 1.8;
            const geo = new THREE.SphereGeometry(r, 8, 6);
            const sphere = new THREE.Mesh(geo, mat);
            sphere.position.set(
                (Math.random() - 0.5) * 3,
                (Math.random() - 0.5) * 0.6,
                (Math.random() - 0.5) * 1.5
            );
            sphere.scale.y = 0.55;
            group.add(sphere);
        }
        group.position.set(x, y, z);
        return group;
    }

    function initClouds() {
        clouds.forEach((c) => scene.remove(c));
        clouds.length = 0;
        for (let i = 0; i < 18; i++) {
            const x = (Math.random() - 0.5) * 35;
            const y = 5 + Math.random() * 8;
            const z = -Math.random() * 130;
            const cloud = createCloud(x, y, z);
            scene.add(cloud);
            clouds.push(cloud);
        }
    }

    // ==================== BIRD ====================
    function createBird() {
        const group = new THREE.Group();

        // Body
        const bodyGeo = new THREE.SphereGeometry(0.4, 16, 12);
        const bodyMat = new THREE.MeshPhongMaterial({
            color: 0xf7dc6f,
            emissive: 0xb8860b,
            emissiveIntensity: 0.1,
            shininess: 30,
        });
        const body = new THREE.Mesh(bodyGeo, bodyMat);
        body.scale.set(1.0, 0.9, 1.1);
        body.castShadow = true;
        group.add(body);

        // Belly (lighter)
        const bellyGeo = new THREE.SphereGeometry(0.33, 12, 8);
        const bellyMat = new THREE.MeshPhongMaterial({ color: 0xfdebd0 });
        const belly = new THREE.Mesh(bellyGeo, bellyMat);
        belly.position.set(0, -0.08, -0.05);
        belly.scale.set(0.9, 0.85, 1.0);
        group.add(belly);

        // Eyes
        const eyeWhiteGeo = new THREE.SphereGeometry(0.13, 8, 8);
        const eyeWhiteMat = new THREE.MeshPhongMaterial({ color: 0xffffff });
        const pupilGeo = new THREE.SphereGeometry(0.065, 8, 8);
        const pupilMat = new THREE.MeshPhongMaterial({ color: 0x111111 });

        const rEye = new THREE.Mesh(eyeWhiteGeo, eyeWhiteMat);
        rEye.position.set(0.17, 0.12, -0.3);
        group.add(rEye);
        const rPupil = new THREE.Mesh(pupilGeo, pupilMat);
        rPupil.position.set(0.2, 0.13, -0.41);
        group.add(rPupil);

        const lEye = new THREE.Mesh(eyeWhiteGeo, eyeWhiteMat);
        lEye.position.set(-0.17, 0.12, -0.3);
        group.add(lEye);
        const lPupil = new THREE.Mesh(pupilGeo, pupilMat);
        lPupil.position.set(-0.2, 0.13, -0.41);
        group.add(lPupil);

        // Beak
        const beakGeo = new THREE.ConeGeometry(0.1, 0.22, 4);
        const beakMat = new THREE.MeshPhongMaterial({
            color: 0xe74c3c,
            emissive: 0x8b0000,
            emissiveIntensity: 0.1,
        });
        const beak = new THREE.Mesh(beakGeo, beakMat);
        beak.rotation.x = Math.PI / 2;
        beak.position.set(0, 0.0, -0.5);
        group.add(beak);

        // Wings (with pivots for flapping)
        const wingGeo = new THREE.BoxGeometry(0.45, 0.06, 0.28);
        const wingMat = new THREE.MeshPhongMaterial({
            color: 0xf0c040,
            emissive: 0x6b5a1e,
            emissiveIntensity: 0.1,
        });

        const rWingPivot = new THREE.Group();
        const rWing = new THREE.Mesh(wingGeo, wingMat);
        rWing.position.x = 0.22;
        rWingPivot.add(rWing);
        rWingPivot.position.set(0.2, 0.05, 0.05);
        group.add(rWingPivot);

        const lWingPivot = new THREE.Group();
        const lWing = new THREE.Mesh(wingGeo, wingMat);
        lWing.position.x = -0.22;
        lWingPivot.add(lWing);
        lWingPivot.position.set(-0.2, 0.05, 0.05);
        group.add(lWingPivot);

        // Tail
        const tailGeo = new THREE.BoxGeometry(0.18, 0.12, 0.1);
        const tailMat = new THREE.MeshPhongMaterial({ color: 0xe8c43a });
        const tail = new THREE.Mesh(tailGeo, tailMat);
        tail.position.set(0, 0.08, 0.42);
        tail.rotation.x = -0.3;
        group.add(tail);

        // Boost glow aura (invisible by default)
        const auraGeo = new THREE.SphereGeometry(0.7, 16, 12);
        const auraMat = new THREE.MeshBasicMaterial({
            color: 0xffdd00,
            transparent: true,
            opacity: 0,
        });
        const aura = new THREE.Mesh(auraGeo, auraMat);
        group.add(aura);

        group.userData = { rWing: rWingPivot, lWing: lWingPivot, aura, auraMat };
        group.scale.setScalar(1.2);
        return group;
    }

    const bird = createBird();
    scene.add(bird);
    let flapSquish = 0; // squish timer for flap animation

    // ==================== PIPES ====================
    const pipes = [];
    const boostOrbs = [];

    const pipeRadius = CONFIG.pipeWidth / 2;
    const capRadius = pipeRadius + 0.2;

    function createPipe(zPos) {
        const group = new THREE.Group();
        const gap = state.pipeGap;
        const gapCenter =
            CONFIG.pipeHeightRange.min +
            Math.random() * (CONFIG.pipeHeightRange.max - CONFIG.pipeHeightRange.min);
        const halfGap = gap / 2;

        // Bottom pipe
        const botH = gapCenter - halfGap - CONFIG.groundY;
        if (botH > 0.1) {
            const geo = new THREE.CylinderGeometry(pipeRadius, pipeRadius, botH, 16);
            const mesh = new THREE.Mesh(geo, pipeMat);
            mesh.position.y = CONFIG.groundY + botH / 2;
            mesh.castShadow = true;
            group.add(mesh);

            // Cap — wider cylinder lip
            const capGeo = new THREE.CylinderGeometry(capRadius, capRadius, 0.4, 16);
            const cap = new THREE.Mesh(capGeo, pipeCapMat);
            cap.position.y = CONFIG.groundY + botH;
            group.add(cap);

            // Dark inner ring at cap top
            const rimGeo = new THREE.TorusGeometry(pipeRadius - 0.05, 0.06, 8, 16);
            const rimMat = new THREE.MeshBasicMaterial({ color: 0x1a4a1d });
            const rim = new THREE.Mesh(rimGeo, rimMat);
            rim.rotation.x = Math.PI / 2;
            rim.position.y = CONFIG.groundY + botH + 0.2;
            group.add(rim);
        }

        // Top pipe
        const topH = CONFIG.ceilingY - (gapCenter + halfGap);
        if (topH > 0.1) {
            const geo = new THREE.CylinderGeometry(pipeRadius, pipeRadius, topH, 16);
            const mesh = new THREE.Mesh(geo, pipeMat);
            mesh.position.y = CONFIG.ceilingY - topH / 2;
            mesh.castShadow = true;
            group.add(mesh);

            const capGeo = new THREE.CylinderGeometry(capRadius, capRadius, 0.4, 16);
            const cap = new THREE.Mesh(capGeo, pipeCapMat);
            cap.position.y = CONFIG.ceilingY - topH;
            group.add(cap);

            const rimGeo = new THREE.TorusGeometry(pipeRadius - 0.05, 0.06, 8, 16);
            const rimMat = new THREE.MeshBasicMaterial({ color: 0x1a4a1d });
            const rim = new THREE.Mesh(rimGeo, rimMat);
            rim.rotation.x = Math.PI / 2;
            rim.position.y = CONFIG.ceilingY - topH - 0.2;
            group.add(rim);
        }

        // Glow ring at gap center — vertical target ring facing the bird
        const ringGeo = new THREE.TorusGeometry(gap / 2 - 0.2, 0.06, 8, 24);
        const ringMat = new THREE.MeshBasicMaterial({
            color: 0x88ffaa,
            transparent: true,
            opacity: 0.35,
        });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.position.y = gapCenter;
        group.add(ring);

        // Second inner ring for depth
        const ring2Geo = new THREE.TorusGeometry(gap / 2 - 0.5, 0.04, 8, 24);
        const ring2Mat = new THREE.MeshBasicMaterial({
            color: 0xaaffcc,
            transparent: true,
            opacity: 0.2,
        });
        const ring2 = new THREE.Mesh(ring2Geo, ring2Mat);
        ring2.position.y = gapCenter;
        group.add(ring2);

        group.position.z = zPos;
        group.userData = { gapCenter, passed: false };
        scene.add(group);

        return group;
    }

    function spawnBoostOrb(z, y) {
        const group = new THREE.Group();

        // Outer glow sphere
        const glowGeo = new THREE.SphereGeometry(0.7, 12, 12);
        const glowMat = new THREE.MeshBasicMaterial({
            color: 0xffdd00,
            transparent: true,
            opacity: 0.2,
        });
        group.add(new THREE.Mesh(glowGeo, glowMat));

        // Spinning particle ring
        const ringGeo = new THREE.TorusGeometry(0.55, 0.04, 8, 24);
        const ringMat = new THREE.MeshBasicMaterial({
            color: 0xffee66,
            transparent: true,
            opacity: 0.6,
        });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        group.add(ring);

        // Second ring (perpendicular)
        const ring2 = new THREE.Mesh(ringGeo, ringMat.clone());
        ring2.rotation.y = Math.PI / 2;
        group.add(ring2);

        // Inner star — octahedron
        const orbGeo = new THREE.OctahedronGeometry(0.3, 0);
        const orbMat = new THREE.MeshPhongMaterial({
            color: 0xffcc00,
            emissive: 0xff8800,
            emissiveIntensity: 0.8,
            shininess: 120,
        });
        group.add(new THREE.Mesh(orbGeo, orbMat));

        // Tiny sparkle particles around orb
        const sparkGeo = new THREE.BufferGeometry();
        const sparkPos = new Float32Array(24 * 3);
        for (let i = 0; i < 24; i++) {
            const a = (i / 24) * Math.PI * 2;
            const r = 0.5 + Math.random() * 0.3;
            sparkPos[i * 3] = Math.cos(a) * r;
            sparkPos[i * 3 + 1] = (Math.random() - 0.5) * 0.6;
            sparkPos[i * 3 + 2] = Math.sin(a) * r;
        }
        sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
        const sparkMat = new THREE.PointsMaterial({
            color: 0xffffff,
            size: 0.08,
            transparent: true,
            opacity: 0.7,
            sizeAttenuation: true,
        });
        group.add(new THREE.Points(sparkGeo, sparkMat));

        group.position.set(0, y, z);
        group.userData = { collected: false };
        scene.add(group);
        boostOrbs.push(group);
    }

    // Spawn orb BETWEEN two pipes, off the optimal flight line
    function maybeSpawnOrbBetween(pipeA, pipeB) {
        if (Math.random() > CONFIG.boostOrbChance) return;

        // Optimal flight line goes from gapA center to gapB center.
        // We place the orb between the two pipes along Z, but at a Y
        // that's in the middle of the screen — NOT on the straight line
        // between gap centers. Player must detour vertically to grab it.

        // Z: midway between pipes (between obstacles along flight path)
        const midZ = (pipeA.position.z + pipeB.position.z) / 2;

        // The Y that the "optimal" straight line would pass through at midZ
        const optimalY = (pipeA.userData.gapCenter + pipeB.userData.gapCenter) / 2;

        // Pick an orb Y that's in a comfortable middle band [-2, 2]
        // but at least 2 units away from the optimal line
        let orbY;
        for (let attempt = 0; attempt < 10; attempt++) {
            orbY = -2 + Math.random() * 4; // range [-2, 2]
            if (Math.abs(orbY - optimalY) >= 2) break;
        }

        // If optimal Y is in the middle too, push orb to an edge of the band
        if (Math.abs(orbY - optimalY) < 2) {
            orbY = optimalY > 0 ? -2.5 - Math.random() : 2.5 + Math.random();
            orbY = Math.max(CONFIG.groundY + 1.5, Math.min(CONFIG.ceilingY - 1.5, orbY));
        }

        spawnBoostOrb(midZ, orbY);
    }

    function initPipes() {
        pipes.forEach((p) => scene.remove(p));
        pipes.length = 0;
        boostOrbs.forEach((o) => scene.remove(o));
        boostOrbs.length = 0;

        for (let i = 0; i < CONFIG.pipeCount; i++) {
            pipes.push(createPipe(-(20 + i * CONFIG.pipeSpacing)));
        }
        // Spawn orbs between consecutive pipe pairs
        for (let i = 0; i < pipes.length - 1; i++) {
            maybeSpawnOrbBetween(pipes[i], pipes[i + 1]);
        }
    }

    function recyclePipe(pipe, newZ) {
        scene.remove(pipe);
        const idx = pipes.indexOf(pipe);
        const newPipe = createPipe(newZ);
        pipes[idx] = newPipe;

        // Try to spawn orb between this new pipe and the nearest pipe ahead of it
        let nearest = null;
        let nearestDist = Infinity;
        for (const p of pipes) {
            if (p === newPipe) continue;
            const d = Math.abs(p.position.z - newZ);
            if (d < nearestDist && d > 1) {
                nearestDist = d;
                nearest = p;
            }
        }
        if (nearest && nearestDist < CONFIG.pipeSpacing * 1.5) {
            maybeSpawnOrbBetween(newPipe, nearest);
        }
    }

    // ==================== NYAN RAINBOW TRAIL ====================
    const SEGS_PER_BAND = 28;
    const trail = [];

    function initTrail() {
        // Each band is a tall vertical stripe (narrow X, tall Y)
        const geo = new THREE.PlaneGeometry(BAND_W, 0.7);
        for (let b = 0; b < BAND_COUNT; b++) {
            const mat = new THREE.MeshBasicMaterial({
                color: NYAN_BANDS[b],
                transparent: true,
                opacity: 0,
                side: THREE.DoubleSide,
            });
            for (let i = 0; i < SEGS_PER_BAND; i++) {
                const mesh = new THREE.Mesh(geo, mat.clone());
                mesh.visible = false;
                scene.add(mesh);
                trail.push({ mesh, life: 0, on: false, band: b });
            }
        }
    }

    function spawnTrailSegment(birdY, z) {
        // Spawn one segment per band — 6 vertical stripes spread left-to-right
        const leftX = -(BAND_COUNT - 1) * BAND_GAP / 2;
        for (let b = 0; b < BAND_COUNT; b++) {
            for (const p of trail) {
                if (!p.on && p.band === b) {
                    p.mesh.position.set(leftX + b * BAND_GAP, birdY, z);
                    p.mesh.material.opacity = 1.0;
                    p.mesh.visible = true;
                    p.on = true;
                    p.life = 1.0;
                    break;
                }
            }
        }
    }

    function updateTrail(dt, dz) {
        for (const p of trail) {
            if (p.on) {
                p.mesh.position.z += dz;
                p.life -= dt * 0.45;
                p.mesh.material.opacity = Math.max(0, p.life);
                if (p.life <= 0) {
                    p.on = false;
                    p.mesh.visible = false;
                }
            }
        }
    }

    function clearTrail() {
        for (const p of trail) {
            p.on = false;
            p.mesh.visible = false;
        }
    }

    // ==================== SPEED LINES (boost effect) ====================
    const SPEED_LINE_N = 40;
    const speedLines = [];

    function initSpeedLines() {
        // Thin planes stretched along Z axis — look like motion streaks
        const geo = new THREE.PlaneGeometry(0.04, 3);
        for (let i = 0; i < SPEED_LINE_N; i++) {
            const mat = new THREE.MeshBasicMaterial({
                color: 0xffffff,
                transparent: true,
                opacity: 0,
                side: THREE.DoubleSide,
            });
            const mesh = new THREE.Mesh(geo, mat);
            // Rotate so the long axis aligns with Z (depth)
            mesh.rotation.x = Math.PI / 2;
            mesh.visible = false;
            scene.add(mesh);
            speedLines.push(mesh);
        }
    }

    function updateSpeedLines(dt, now, playerY, active) {
        for (let i = 0; i < SPEED_LINE_N; i++) {
            const line = speedLines[i];
            if (active) {
                if (!line.visible || line.position.z > 5) {
                    // Respawn ahead of the bird at random spread
                    line.position.set(
                        (Math.random() - 0.5) * 14,
                        playerY + (Math.random() - 0.5) * 10,
                        -(Math.random() * 40 + 8)
                    );
                    line.visible = true;
                    line.material.opacity = 0.5 + Math.random() * 0.3;
                }
                line.position.z += 45 * dt;
                // Fade as it approaches camera
                if (line.position.z > 0) {
                    line.material.opacity *= 0.9;
                }
            } else {
                if (line.visible) {
                    line.material.opacity -= dt * 4;
                    if (line.material.opacity <= 0) line.visible = false;
                }
            }
        }
    }

    // ==================== AMBIENT PARTICLES ====================
    const PARTICLE_N = 250;
    const pGeo = new THREE.BufferGeometry();
    const pPos = new Float32Array(PARTICLE_N * 3);

    for (let i = 0; i < PARTICLE_N; i++) {
        pPos[i * 3] = (Math.random() - 0.5) * CONFIG.areaWidth;
        pPos[i * 3 + 1] =
            CONFIG.groundY + Math.random() * (CONFIG.ceilingY - CONFIG.groundY);
        pPos[i * 3 + 2] = -Math.random() * 100;
    }
    pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));

    const pMat = new THREE.PointsMaterial({
        color: 0xffffff,
        size: 0.12,
        transparent: true,
        opacity: 0.4,
        sizeAttenuation: true,
    });
    const ambientParticles = new THREE.Points(pGeo, pMat);
    scene.add(ambientParticles);

    // ==================== AUDIO ====================
    let audioCtx = null;

    function initAudio() {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
    }

    function playTone(freq, dur, type, vol) {
        if (!audioCtx) return;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = type || 'square';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(vol || 0.1, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + dur);
    }

    function flapSound() {
        playTone(440, 0.1, 'sine', 0.08);
        playTone(580, 0.08, 'sine', 0.05);
    }

    function scoreSound() {
        playTone(660, 0.1, 'square', 0.06);
        setTimeout(() => playTone(880, 0.15, 'square', 0.06), 80);
    }

    function hitSound() {
        playTone(150, 0.3, 'sawtooth', 0.1);
        playTone(100, 0.4, 'square', 0.08);
    }

    function boostPickupSound() {
        playTone(880, 0.15, 'sine', 0.08);
        setTimeout(() => playTone(1100, 0.15, 'sine', 0.08), 100);
        setTimeout(() => playTone(1320, 0.2, 'sine', 0.08), 200);
    }

    let boostMusicTimer = null;
    let boostAudio = null;

    function startBoostMusic() {
        stopBoostMusic();
        // Play the real Nyan Cat OGG file
        boostAudio = new Audio('nyancat.ogg');
        boostAudio.volume = 0.5;
        // Start from a random point between 2–6 seconds
        boostAudio.currentTime = 2 + Math.random() * 4;
        boostAudio.play().catch(() => {});
    }

    function stopBoostMusic() {
        if (boostMusicTimer) {
            clearInterval(boostMusicTimer);
            boostMusicTimer = null;
        }
        if (boostAudio) {
            boostAudio.pause();
            boostAudio.currentTime = 0;
            boostAudio = null;
        }
    }

    // ==================== SCREEN FLASH ====================
    function flash(color, duration) {
        if (!flashOverlay) return;
        flashOverlay.style.backgroundColor = color;
        flashOverlay.style.opacity = '0.35';
        setTimeout(() => { flashOverlay.style.opacity = '0'; }, duration || 150);
    }

    // ==================== GAME LOGIC ====================
    function resetGame() {
        state.playerY = 0;
        state.velocity = 0;
        state.score = 0;
        state.distance = 0;
        state.shakeTimer = 0;
        state.forwardSpeed = CONFIG.baseForwardSpeed;
        state.pipeGap = CONFIG.basePipeGap;
        state.diffLevel = 0;
        state.boostTimer = 0;
        state.boostActive = false;
        state.camSmoothY = CONFIG.camY;
        stopBoostMusic();
        scoreDisplay.textContent = '0';
        if (boostIndicator) boostIndicator.classList.add('hidden');
        clearTrail();
        initPipes();
        // Restore sky color
        scene.background.setHex(CONFIG.skyColor);
        scene.fog.color.setHex(CONFIG.fogColor);
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
        stopBoostMusic();
        state.boostActive = false;
        if (boostIndicator) boostIndicator.classList.add('hidden');

        flash('#ff0000', 200);

        if (state.score > state.bestScore) {
            state.bestScore = state.score;
            localStorage.setItem('nyanbird_best', state.bestScore.toString());
        }

        state.shakeTimer = 0.5;

        setTimeout(() => {
            hud.classList.add('hidden');
            gameoverScreen.classList.remove('hidden');
            finalScoreValue.textContent = state.score;
            bestScoreValue.textContent = state.bestScore;
        }, 700);
    }

    function flap() {
        if (state.phase === 'playing' && !state.boostActive) {
            state.velocity = CONFIG.flapForce;
            flapSound();
            flapSquish = 0.15; // trigger squish animation
        }
    }

    function updateDifficulty() {
        const lvl = Math.floor(state.score / CONFIG.difficultyInterval);
        if (lvl > state.diffLevel) {
            state.diffLevel = lvl;
            state.forwardSpeed = Math.min(
                CONFIG.maxForwardSpeed,
                CONFIG.baseForwardSpeed + lvl * CONFIG.speedPerLevel
            );
            state.pipeGap = Math.max(
                CONFIG.minPipeGap,
                CONFIG.basePipeGap - lvl * CONFIG.gapPerLevel
            );
        }
    }

    function activateBoost() {
        state.boostActive = true;
        state.boostTimer = CONFIG.boostDuration;
        boostPickupSound();
        startBoostMusic();
        flash('#ffdd00', 200);
        if (boostIndicator) boostIndicator.classList.remove('hidden');
    }

    // ==================== POST-BOOST PIPE CLEARANCE ====================
    const RAINBOW_COLORS = [0xff0000, 0xff8800, 0xffff00, 0x00ff00, 0x0088ff, 0x8800ff];

    function clearPipesAfterBoost() {
        // Mark nearby pipes as rainbow ghosts instead of removing them
        const safeDistance = CONFIG.pipeSpacing * 1.2;
        for (const pipe of pipes) {
            const z = pipe.position.z;
            if (z < 0 && z > -safeDistance) {
                pipe.userData.rainbow = true;
                pipe.userData.rainbowTime = 0;
                // Make all child meshes transparent and rainbow-ready
                pipe.traverse((child) => {
                    if (child.isMesh) {
                        // Clone material so we don't affect other pipes
                        child.material = child.material.clone();
                        child.material.transparent = true;
                    }
                });
            }
        }
    }

    function updateRainbowPipes(dt, now) {
        for (const pipe of pipes) {
            if (!pipe.userData.rainbow) continue;
            pipe.userData.rainbowTime += dt;

            // Cycle rainbow hue + pulse opacity between 0.15 and 0.6
            const t = pipe.userData.rainbowTime;
            const opacity = 0.15 + 0.45 * (0.5 + 0.5 * Math.sin(t * 12));
            const colorIdx = Math.floor((now * 6) % RAINBOW_COLORS.length);

            pipe.traverse((child) => {
                if (child.isMesh) {
                    child.material.color.setHex(RAINBOW_COLORS[(colorIdx + (child.id % 3)) % RAINBOW_COLORS.length]);
                    child.material.opacity = opacity;
                }
            });

            // After 3 seconds, restore to normal solid pipe
            if (t > 3) {
                pipe.userData.rainbow = false;
                pipe.traverse((child) => {
                    if (child.isMesh) {
                        child.material.color.setHex(CONFIG.pipeColor);
                        child.material.opacity = 1;
                        child.material.transparent = false;
                    }
                });
            }
        }
    }

    // ==================== COLLISION ====================
    function checkCollision() {
        if (state.boostActive) return false;

        const r = CONFIG.collisionRadius;
        const py = state.playerY;

        // Ground / ceiling
        if (py - r <= CONFIG.groundY || py + r >= CONFIG.ceilingY) return true;

        // Pipes (skip rainbow ghost pipes)
        for (const pipe of pipes) {
            if (pipe.userData.rainbow) continue;
            const pz = pipe.position.z;
            const halfDepth = CONFIG.pipeDepth / 2 + r;

            if (pz - halfDepth < 0 && pz + halfDepth > 0) {
                const gap = pipe.userData.gapCenter;
                const halfGap = state.pipeGap / 2 - r;
                if (py < gap - halfGap || py > gap + halfGap) return true;
            }
        }
        return false;
    }

    function checkOrbCollection() {
        for (let i = boostOrbs.length - 1; i >= 0; i--) {
            const orb = boostOrbs[i];
            if (orb.userData.collected) continue;
            // Generous hitbox: ±1.8 on Z (covers high-speed traversal),
            // ±1.5 on Y (matches visual glow perception from 3rd person camera)
            if (Math.abs(orb.position.z) < 1.8 && Math.abs(orb.position.y - state.playerY) < 1.5) {
                orb.userData.collected = true;
                scene.remove(orb);
                boostOrbs.splice(i, 1);
                if (!state.boostActive) activateBoost();
            }
        }
    }

    // ==================== MAIN LOOP ====================
    let lastTime = 0;

    function gameLoop(time) {
        requestAnimationFrame(gameLoop);
        const now = time / 1000;
        const dt = Math.min(now - lastTime, 0.05);
        lastTime = now;

        // ===== MENU =====
        if (state.phase === 'menu') {
            bird.position.y = Math.sin(now * 0.8) * 1.5;
            bird.rotation.x = Math.sin(now * 0.8) * 0.1;

            const wa = Math.sin(now * 5) * 0.4;
            bird.userData.rWing.rotation.z = -wa;
            bird.userData.lWing.rotation.z = wa;

            // Move clouds gently
            for (const c of clouds) {
                c.position.z += 1 * dt;
                if (c.position.z > 20) {
                    c.position.z -= 150;
                    c.position.x = (Math.random() - 0.5) * 35;
                }
            }

            const tgtY = bird.position.y + CONFIG.camY;
            state.camSmoothY += (tgtY - state.camSmoothY) * 0.1;
            camera.position.set(0, state.camSmoothY, CONFIG.camZ);
            camera.lookAt(0, bird.position.y + 0.5, CONFIG.camLookZ);

            renderer.render(scene, camera);
            return;
        }

        // ===== PLAYING =====
        if (state.phase === 'playing') {
            // --- Boost autopilot ---
            if (state.boostActive) {
                state.boostTimer -= dt;

                // Find next pipe to navigate towards
                let tgtZ = -Infinity;
                let tgtY = state.playerY;
                for (const pipe of pipes) {
                    if (pipe.position.z < -0.5 && pipe.position.z > tgtZ) {
                        tgtZ = pipe.position.z;
                        tgtY = pipe.userData.gapCenter;
                    }
                }

                const diff = tgtY - state.playerY;
                state.velocity = Math.max(-10, Math.min(10, diff * 6));

                if (state.boostTimer <= 0) {
                    state.boostActive = false;
                    state.velocity = 2; // gentle upward after boost
                    stopBoostMusic();
                    if (boostIndicator) boostIndicator.classList.add('hidden');
                    // Restore sky
                    scene.background.setHex(CONFIG.skyColor);
                    scene.fog.color.setHex(CONFIG.fogColor);
                    // Clear nearby pipes so player has reaction time
                    clearPipesAfterBoost();
                }

                // Rainbow sky shift
                if (state.boostActive) {
                    const hue = (now * 0.4) % 1;
                    const c = new THREE.Color().setHSL(hue, 0.25, 0.65);
                    scene.background = c;
                    scene.fog.color.copy(c);
                }
            } else {
                // --- Normal physics ---
                state.velocity += CONFIG.gravity * dt;
                if (state.velocity < CONFIG.maxFallSpeed) {
                    state.velocity = CONFIG.maxFallSpeed;
                }
            }

            state.playerY += state.velocity * dt;

            // Clamp during boost
            if (state.boostActive) {
                state.playerY = Math.max(
                    CONFIG.groundY + 1,
                    Math.min(CONFIG.ceilingY - 1, state.playerY)
                );
            }

            // Forward movement
            const speed = state.boostActive
                ? state.forwardSpeed * CONFIG.boostSpeedMul
                : state.forwardSpeed;
            const dz = speed * dt;
            state.distance += dz;

            // Move pipes
            for (const pipe of pipes) {
                pipe.position.z += dz;

                // Score
                if (!pipe.userData.passed && pipe.position.z > 0) {
                    pipe.userData.passed = true;
                    state.score++;
                    scoreDisplay.textContent = state.score;
                    scoreSound();
                    updateDifficulty();
                }

                // Recycle
                if (pipe.position.z > 15) {
                    const furthestZ = pipes.reduce(
                        (m, p) => Math.min(m, p.position.z),
                        Infinity
                    );
                    recyclePipe(pipe, furthestZ - CONFIG.pipeSpacing);
                }
            }

            // Move boost orbs
            for (let i = boostOrbs.length - 1; i >= 0; i--) {
                boostOrbs[i].position.z += dz;
                if (boostOrbs[i].position.z > 15) {
                    scene.remove(boostOrbs[i]);
                    boostOrbs.splice(i, 1);
                }
            }

            // Move grid lines
            for (const line of gridLines) {
                line.position.z += dz;
                if (line.position.z > 10) line.position.z -= 200;
            }

            // Move grass tufts
            for (const tuft of grassTufts) {
                tuft.position.z += dz;
                if (tuft.position.z > 10) {
                    tuft.position.z -= 210;
                    tuft.position.x = (Math.random() - 0.5) * 8;
                }
            }

            // Move clouds
            for (const c of clouds) {
                c.position.z += dz * 0.3; // parallax — slower
                if (c.position.z > 25) {
                    c.position.z -= 155;
                    c.position.x = (Math.random() - 0.5) * 35;
                }
            }

            // Move ambient particles
            const pos = ambientParticles.geometry.attributes.position.array;
            for (let i = 0; i < PARTICLE_N; i++) {
                pos[i * 3 + 2] += dz;
                if (pos[i * 3 + 2] > 5) {
                    pos[i * 3 + 2] -= 105;
                    pos[i * 3] = (Math.random() - 0.5) * CONFIG.areaWidth;
                    pos[i * 3 + 1] =
                        CONFIG.groundY +
                        Math.random() * (CONFIG.ceilingY - CONFIG.groundY);
                }
            }
            ambientParticles.geometry.attributes.position.needsUpdate = true;

            // Animate rainbow ghost pipes
            updateRainbowPipes(dt, now);

            // Collision
            if (checkCollision()) gameOver();

            // Boost orb collection
            checkOrbCollection();

            // Speed lines during boost
            updateSpeedLines(dt, now, state.playerY, state.boostActive);

            // Ambient particles color shift during boost
            if (state.boostActive) {
                const hue = (now * 1.5) % 1;
                pMat.color.setHSL(hue, 0.8, 0.7);
                pMat.size = 0.2;
                pMat.opacity = 0.6;
            } else {
                pMat.color.setHex(0xffffff);
                pMat.size = 0.12;
                pMat.opacity = 0.4;
            }

            // Nyan rainbow trail
            if (state.boostActive) {
                spawnTrailSegment(state.playerY, 0.7);
            }
            updateTrail(dt, dz);
        }

        // ===== DEAD — bird falls =====
        if (state.phase === 'dead') {
            state.velocity += CONFIG.gravity * dt;
            state.playerY += state.velocity * dt;
            if (state.playerY < CONFIG.groundY) {
                state.playerY = CONFIG.groundY;
                state.velocity = 0;
            }
            updateTrail(dt, 0);
        }

        // ===== BIRD VISUAL =====
        bird.position.y = state.playerY;

        // Tilt
        const tiltTarget = state.velocity * 0.05;
        const tiltClamped = Math.max(-0.7, Math.min(0.5, tiltTarget));
        bird.rotation.x += (tiltClamped - bird.rotation.x) * Math.min(1, 8 * dt);

        // Squish on flap (stretch Y, squash X/Z)
        if (flapSquish > 0) {
            flapSquish -= dt;
            const s = flapSquish / 0.15; // 1→0
            bird.scale.set(1.2 * (1 - s * 0.15), 1.2 * (1 + s * 0.25), 1.2 * (1 - s * 0.15));
        } else {
            bird.scale.setScalar(1.2);
        }

        // Boost aura glow
        const auraMat = bird.userData.auraMat;
        if (state.boostActive) {
            auraMat.opacity = 0.25 + 0.15 * Math.sin(now * 10);
            const hue = (now * 2) % 1;
            auraMat.color.setHSL(hue, 1, 0.6);
        } else {
            auraMat.opacity = Math.max(0, auraMat.opacity - dt * 3);
        }

        // Wings
        const flapSpd = state.boostActive ? 30 : state.phase === 'playing' ? 15 : 5;
        const wAngle = Math.sin(now * flapSpd) * 0.6;
        bird.userData.rWing.rotation.z = -wAngle;
        bird.userData.lWing.rotation.z = wAngle;

        // ===== CAMERA =====
        const camTgtY = state.playerY + CONFIG.camY;
        state.camSmoothY += (camTgtY - state.camSmoothY) * Math.min(1, CONFIG.camSmooth * dt);
        camera.position.set(0, state.camSmoothY, CONFIG.camZ);

        // Shake
        if (state.shakeTimer > 0) {
            state.shakeTimer -= dt;
            const int = CONFIG.shakeIntensity * (state.shakeTimer / 0.5);
            camera.position.x += (Math.random() - 0.5) * int * 2;
            camera.position.y += (Math.random() - 0.5) * int * 2;
        }

        camera.lookAt(0, state.playerY + 0.5, CONFIG.camLookZ);

        // Lights follow bird
        pointLight.position.set(0, state.playerY + 2, -6);
        dirLight.position.set(5, 15, -10);

        // Animate boost orbs
        for (const orb of boostOrbs) {
            orb.rotation.y += dt * 3;
            orb.rotation.x += dt * 1.5;
            const pulse = 1 + Math.sin(now * 6) * 0.2;
            orb.scale.setScalar(pulse);
            // Spin inner rings independently
            if (orb.children[1]) orb.children[1].rotation.x += dt * 4;
            if (orb.children[2]) orb.children[2].rotation.z += dt * 3;
        }

        // Animate pipe gap rings
        for (const pipe of pipes) {
            pipe.children.forEach((c) => {
                if (c.geometry && c.geometry.type === 'TorusGeometry' && c.position.y === pipe.userData.gapCenter) {
                    c.rotation.z += dt * 1.5;
                    const dist = Math.abs(pipe.position.z);
                    c.material.opacity = dist < 25 ? 0.35 + 0.2 * Math.sin(now * 3 + pipe.position.z) : 0.1;
                }
            });
        }

        renderer.render(scene, camera);
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

    document.addEventListener('keydown', (e) => {
        if (e.code === 'Space' || e.code === 'Enter') {
            if (state.phase === 'menu') {
                startGame();
            } else if (
                state.phase === 'dead' &&
                !gameoverScreen.classList.contains('hidden')
            ) {
                startGame();
            }
        }
    });

    // ==================== TWO-FINGER SWIPE UP CHEAT ====================
    let twoFingerStartY = null;

    canvas.addEventListener('touchstart', (e) => {
        if (e.touches.length === 2) {
            twoFingerStartY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        } else {
            twoFingerStartY = null;
        }
    }, { passive: true });

    canvas.addEventListener('touchmove', (e) => {
        if (twoFingerStartY === null || e.touches.length !== 2) return;
        const currentY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        const dy = twoFingerStartY - currentY; // positive = swipe up
        if (dy > 60) {
            twoFingerStartY = null;
            if (state.phase === 'playing' && !state.boostActive) {
                activateBoost();
            }
        }
    }, { passive: true });

    canvas.addEventListener('touchend', () => {
        twoFingerStartY = null;
    }, { passive: true });

    // ==================== RESIZE ====================
    window.addEventListener('resize', () => {
        renderer.setSize(window.innerWidth, window.innerHeight);
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
    });

    // ==================== INIT ====================
    bestScoreValue.textContent = state.bestScore;
    initTrail();
    initSpeedLines();
    initClouds();
    initPipes();
    requestAnimationFrame(gameLoop);
})();
