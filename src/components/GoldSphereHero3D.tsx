import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

function createBrushedGoldMaps(): {
  colorMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
  bumpMap: THREE.CanvasTexture;
} {
  const size = 512;
  const colorCanvas = document.createElement('canvas');
  colorCanvas.width = size;
  colorCanvas.height = size;
  const cCtx = colorCanvas.getContext('2d');

  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = size;
  roughCanvas.height = size;
  const rCtx = roughCanvas.getContext('2d');

  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = size;
  bumpCanvas.height = size;
  const bCtx = bumpCanvas.getContext('2d');

  if (cCtx && rCtx && bCtx) {
    // Rich metallic champagne-to-bullion gold base gradient
    const baseGrad = cCtx.createLinearGradient(0, 0, size, size);
    baseGrad.addColorStop(0, '#f3d982');
    baseGrad.addColorStop(0.35, '#e2b646');
    baseGrad.addColorStop(0.7, '#cfa02c');
    baseGrad.addColorStop(1, '#f0d276');
    cCtx.fillStyle = baseGrad;
    cCtx.fillRect(0, 0, size, size);

    rCtx.fillStyle = '#343434';
    rCtx.fillRect(0, 0, size, size);
    bCtx.fillStyle = '#808080';
    bCtx.fillRect(0, 0, size, size);

    // Fine horizontal lathe brushing
    for (let y = 0; y < size; y++) {
      const streak = Math.floor(26 + (Math.sin(y * 0.45) * 0.5 + 0.5) * 34);
      rCtx.fillStyle = `rgb(${streak},${streak},${streak})`;
      rCtx.fillRect(0, y, size, 1);

      const bump = Math.floor(118 + Math.sin(y * 0.7) * 14);
      bCtx.fillStyle = `rgb(${bump},${bump},${bump})`;
      bCtx.fillRect(0, y, size, 1);
    }

    // Longitudinal engraved meridian flutes + high-contrast gold specular facets
    // so full 3D sphere rotation reads unmistakably on every frame
    const meridians = 12;
    for (let m = 0; m < meridians; m++) {
      const x = Math.round((m / meridians) * size);
      const isMajor = m % 3 === 0;
      cCtx.fillStyle = isMajor ? 'rgba(255, 246, 204, 0.44)' : 'rgba(110, 72, 6, 0.34)';
      cCtx.fillRect(x, 0, isMajor ? 5 : 3, size);

      rCtx.fillStyle = isMajor ? 'rgb(14,14,14)' : 'rgb(76,76,76)';
      rCtx.fillRect(x, 0, isMajor ? 5 : 3, size);

      bCtx.fillStyle = isMajor ? 'rgb(205,205,205)' : 'rgb(56,56,56)';
      bCtx.fillRect(x, 0, isMajor ? 5 : 3, size);
    }

    // Precision latitude bands & equatorial groove
    const parallels = [0.25, 0.5, 0.75];
    for (const ratio of parallels) {
      const y = Math.round(ratio * size);
      cCtx.fillStyle = ratio === 0.5 ? 'rgba(120, 82, 8, 0.38)' : 'rgba(255, 240, 185, 0.36)';
      cCtx.fillRect(0, y - 2, size, 4);
      bCtx.fillStyle = 'rgb(200,200,200)';
      bCtx.fillRect(0, y - 2, size, 4);
    }
  }

  const colorMap = new THREE.CanvasTexture(colorCanvas);
  colorMap.colorSpace = THREE.SRGBColorSpace;
  colorMap.wrapS = THREE.RepeatWrapping;
  colorMap.wrapT = THREE.ClampToEdgeWrapping;

  const roughnessMap = new THREE.CanvasTexture(roughCanvas);
  roughnessMap.wrapS = THREE.RepeatWrapping;
  roughnessMap.wrapT = THREE.ClampToEdgeWrapping;

  const bumpMap = new THREE.CanvasTexture(bumpCanvas);
  bumpMap.wrapS = THREE.RepeatWrapping;
  bumpMap.wrapT = THREE.ClampToEdgeWrapping;

  return { colorMap, roughnessMap, bumpMap };
}

export function GoldSphereHero3D() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [webglFailed, setWebglFailed] = useState(false);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const isSoftwareGl = (() => {
      try {
        const probe = document.createElement('canvas');
        const gl = probe.getContext('webgl2');
        if (!gl) return true;
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
        const gpu = String(gl.getParameter(param));
        gl.getExtension('WEBGL_lose_context')?.loseContext();
        return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
      } catch {
        return true;
      }
    })();

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: !isSoftwareGl,
        alpha: true,
        powerPreference: 'high-performance',
      });
    } catch {
      setWebglFailed(true);
      return;
    }

    const width = Math.max(280, container.clientWidth);
    const height = Math.max(280, container.clientHeight);

    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.18;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height, false);
    renderer.shadowMap.enabled = false;
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';

    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100);
    camera.position.set(0, 0.15, 5.4);

    // Studio reflection environment for authentic metallic gold speculars
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const envTex = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTex;
    pmremGenerator.dispose();

    // Warm/cool 3-point studio lighting
    const hemiLight = new THREE.HemisphereLight(0xcbd5e1, 0x1a1408, 0.85);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xffe6a3, 2.5);
    keyLight.position.set(4, 5, 4);
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0xd4af37, 1.5);
    rimLight.position.set(-4, -2, -3);
    scene.add(rimLight);

    const heroGroup = new THREE.Group();
    scene.add(heroGroup);

    const { colorMap, roughnessMap, bumpMap } = createBrushedGoldMaps();
    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    colorMap.anisotropy = maxAniso;
    roughnessMap.anisotropy = maxAniso;
    bumpMap.anisotropy = maxAniso;

    // 1. Primary Core Metallic Gold Sphere with axial tilt so 3D rotation reads immediately
    const sphereGeo = new THREE.SphereGeometry(1.22, 64, 64);
    const sphereMat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(0xf0c95c),
      map: colorMap,
      metalness: 0.96,
      roughness: 0.2,
      roughnessMap,
      bumpMap,
      bumpScale: 0.014,
      clearcoat: 0.35,
      clearcoatRoughness: 0.12,
      anisotropy: 0.75,
      envMapIntensity: 1.4,
    });
    const goldSphere = new THREE.Mesh(sphereGeo, sphereMat);
    goldSphere.rotation.z = 0.24;
    heroGroup.add(goldSphere);

    // 1b. Precision Beveled Gold Meridian & Equatorial Collars hugging the sphere
    const collarGeo = new THREE.TorusGeometry(1.238, 0.025, 18, 84);
    const collarMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(0xffea9f),
      metalness: 0.98,
      roughness: 0.14,
      envMapIntensity: 1.35,
    });
    const collar = new THREE.Mesh(collarGeo, collarMat);
    collar.rotation.y = Math.PI * 0.25;
    goldSphere.add(collar);

    const collarOrtho = new THREE.Mesh(collarGeo, collarMat);
    collarOrtho.rotation.x = Math.PI * 0.5;
    goldSphere.add(collarOrtho);

    const collarCross = new THREE.Mesh(collarGeo, collarMat);
    collarCross.rotation.y = -Math.PI * 0.25;
    goldSphere.add(collarCross);

    // 2. Equatorial Satin Champagne Ring
    const ring1Geo = new THREE.TorusGeometry(1.56, 0.022, 20, 96);
    const ring1Mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(0xf5e3a1),
      metalness: 0.92,
      roughness: 0.32,
      envMapIntensity: 1.2,
    });
    const ring1 = new THREE.Mesh(ring1Geo, ring1Mat);
    ring1.rotation.x = Math.PI * 0.38;
    ring1.rotation.y = Math.PI * 0.12;
    heroGroup.add(ring1);

    // 3. Outer Brushed Bronze-Gold Astrolabe Ring
    const ring2Geo = new THREE.TorusGeometry(1.82, 0.015, 16, 96);
    const ring2Mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(0xb88c28),
      metalness: 0.88,
      roughness: 0.48,
      envMapIntensity: 1.0,
    });
    const ring2 = new THREE.Mesh(ring2Geo, ring2Mat);
    ring2.rotation.x = -Math.PI * 0.28;
    ring2.rotation.z = Math.PI * 0.22;
    heroGroup.add(ring2);

    // 4. Inner Precision Meridian Ring
    const ring3Geo = new THREE.TorusGeometry(1.38, 0.011, 16, 80);
    const ring3Mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(0xffdf7e),
      metalness: 0.98,
      roughness: 0.12,
    });
    const ring3 = new THREE.Mesh(ring3Geo, ring3Mat);
    ring3.rotation.y = Math.PI * 0.45;
    heroGroup.add(ring3);

    // 5. Floating Gold Micro-Particles (InstancedMesh)
    const particleCount = 48;
    const particleGeo = new THREE.OctahedronGeometry(0.028, 0);
    const particleMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(0xf6df92),
      metalness: 0.9,
      roughness: 0.2,
      emissive: new THREE.Color(0x6b4e0b),
      emissiveIntensity: 0.45,
    });
    const particles = new THREE.InstancedMesh(particleGeo, particleMat, particleCount);
    particles.frustumCulled = false;

    const particleSeeds = Array.from({ length: particleCount }, (_, i) => {
      const angle = (i / particleCount) * Math.PI * 2;
      const radius = 1.7 + (i % 5) * 0.28;
      const yOffset = ((i % 7) - 3) * 0.36;
      const speed = 0.24 + (i % 4) * 0.08;
      const scale = 0.55 + (i % 4) * 0.25;
      return { angle, radius, yOffset, speed, scale };
    });

    const dummy = new THREE.Object3D();
    for (let i = 0; i < particleCount; i++) {
      const p = particleSeeds[i];
      dummy.position.set(
        Math.cos(p.angle) * p.radius,
        p.yOffset,
        Math.sin(p.angle) * p.radius
      );
      dummy.scale.setScalar(p.scale);
      dummy.updateMatrix();
      particles.setMatrixAt(i, dummy.matrix);
    }
    particles.instanceMatrix.needsUpdate = true;
    particles.computeBoundingSphere();
    heroGroup.add(particles);

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    // Pointer interaction for smooth manual 3D orbit layered on top of auto-rotation
    let isDragging = false;
    let lastX = 0;
    let lastY = 0;
    let targetRotY = 0;
    let targetRotX = 0.14;
    let currentRotY = 0;
    let currentRotX = 0.14;

    const onPointerDown = (e: PointerEvent) => {
      isDragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!isDragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      targetRotY += dx * 0.008;
      targetRotX = THREE.MathUtils.clamp(targetRotX + dy * 0.006, -0.65, 0.65);
    };
    const onPointerUp = () => {
      isDragging = false;
    };

    const canvas = renderer.domElement;
    canvas.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);

    const onContextLost = (e: Event) => {
      e.preventDefault();
      setWebglFailed(true);
    };
    canvas.addEventListener('webglcontextlost', onContextLost);

    const onResize = () => {
      if (!container) return;
      const w = Math.max(240, container.clientWidth);
      const h = Math.max(240, container.clientHeight);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
      renderer.render(scene, camera);
    };
    window.addEventListener('resize', onResize);

    const startTimeMs = performance.now();
    let lastTimeMs = startTimeMs;
    let frameId = 0;
    let disposed = false;

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (disposed) return;
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 50);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    function tick() {
      if (disposed) return;
      const nowMs = performance.now();
      const delta = Math.min((nowMs - lastTimeMs) / 1000, 0.25);
      const elapsed = (nowMs - startTimeMs) / 1000;
      lastTimeMs = nowMs;

      if (!isDragging) {
        targetRotY += delta * 0.56;
      }
      const autoPitch = isDragging ? 0 : Math.sin(elapsed * 0.65) * 0.22;
      currentRotY = THREE.MathUtils.damp(currentRotY, targetRotY, 6, delta);
      currentRotX = THREE.MathUtils.damp(currentRotX, targetRotX + autoPitch, 6, delta);

      heroGroup.rotation.y = currentRotY;
      heroGroup.rotation.x = currentRotX;
      heroGroup.rotation.z = Math.sin(elapsed * 0.45) * 0.12;
      heroGroup.position.y = Math.sin(elapsed * 1.15) * 0.08;

      // Core sphere spins continuously across all 3 axes
      goldSphere.rotation.y += delta * 0.65;
      goldSphere.rotation.x += delta * 0.22;
      goldSphere.rotation.z = 0.24 + Math.sin(elapsed * 0.5) * 0.14;

      // Multi-axis 3D ring choreography
      ring1.rotation.z += delta * 0.34;
      ring1.rotation.x = Math.PI * 0.38 + Math.sin(elapsed * 0.55) * 0.18;
      ring2.rotation.y -= delta * 0.28;
      ring2.rotation.z += delta * 0.12;
      ring3.rotation.x += delta * 0.4;
      ring3.rotation.y += delta * 0.2;

      for (let i = 0; i < particleCount; i++) {
        const p = particleSeeds[i];
        const a = p.angle + elapsed * p.speed;
        dummy.position.set(
          Math.cos(a) * p.radius,
          p.yOffset + Math.sin(elapsed * 1.4 + i) * 0.09,
          Math.sin(a) * p.radius
        );
        dummy.rotation.set(elapsed * 0.7 + i, elapsed * 0.6, 0);
        dummy.scale.setScalar(p.scale);
        dummy.updateMatrix();
        particles.setMatrixAt(i, dummy.matrix);
      }
      particles.instanceMatrix.needsUpdate = true;

      renderer.render(scene, camera);

      if (isSoftwareGl) {
        afterDraw(tick);
      } else {
        frameId = requestAnimationFrame(tick);
      }
    }

    tick();

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      canvas.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      window.removeEventListener('resize', onResize);

      sphereGeo.dispose();
      sphereMat.dispose();
      collarGeo.dispose();
      collarMat.dispose();
      ring1Geo.dispose();
      ring1Mat.dispose();
      ring2Geo.dispose();
      ring2Mat.dispose();
      ring3Geo.dispose();
      ring3Mat.dispose();
      particleGeo.dispose();
      particleMat.dispose();
      colorMap.dispose();
      roughnessMap.dispose();
      bumpMap.dispose();
      envTex.dispose();
      renderer.dispose();
      if (canvas.parentNode === container) {
        container.removeChild(canvas);
      }
    };
  }, []);

  return (
    <div className="w-full flex flex-col items-center">
      <div className="relative w-full h-[260px] sm:h-[380px] lg:h-[460px] flex items-center justify-center">
        {webglFailed ? (
          <div className="w-64 h-64 rounded-full bg-gradient-to-br from-[#F3E5AB] via-[#D4AF37] to-[#5C430D] border border-[#D4AF37]/40 shadow-2xl" />
        ) : (
          <div
            ref={mountRef}
            data-testid="aurum-3d-sphere"
            className="w-full h-full"
            aria-label="3D Metallic Gold Sphere"
          />
        )}
      </div>
    </div>
  );
}
