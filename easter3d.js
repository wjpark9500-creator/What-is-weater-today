// /easter3d.js
// 이스터에그 전용 Three.js 3D 씬. 5번 두드리기 전까지는 전혀 로드되지 않습니다.

let THREE;
let renderer, scene, camera;
let snowGeometry, snowPoints, snowVelocities;
let leftGroup, rightGroup;
let gltfLoader = null;
let animId = null;
let initialized = false;

let leftProgress = 0;
let rightProgress = 0;
let leftTarget = 0;
let rightTarget = 0;

const SNOW_COUNT = 1400;

export async function ensureLoaded() {
  if (THREE) return true;
  try {
    THREE = await import("three");
    return true;
  } catch (err) {
    console.warn("Three.js 로드 실패:", err.message, err.stack);
    return false;
  }
}

function shade(hex, factor) {
  const c = new THREE.Color(hex);
  return c.multiplyScalar(factor);
}

function buildSnow() {
  const positions = new Float32Array(SNOW_COUNT * 3);
  snowVelocities = new Float32Array(SNOW_COUNT);
  for (let i = 0; i < SNOW_COUNT; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 26;
    positions[i * 3 + 1] = Math.random() * 22 - 6;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 18;
    snowVelocities[i] = 0.045 + Math.random() * 0.1;
  }
  snowGeometry = new THREE.BufferGeometry();
  snowGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 0.13,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
  });
  snowPoints = new THREE.Points(snowGeometry, material);
  scene.add(snowPoints);
}

async function getLoader() {
  if (gltfLoader) return gltfLoader;
  const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
  const { MeshoptDecoder } = await import("three/addons/libs/meshopt_decoder.module.js");
  gltfLoader = new GLTFLoader();
  gltfLoader.setMeshoptDecoder(MeshoptDecoder);
  return gltfLoader;
}

// 공통 GLB 로더: 원본 모델 크기가 제각각이므로 목표 높이에 맞춰 자동 스케일 + 바닥을 y=0에 맞춤
async function loadCharacter(url, { targetHeight, x, baseY, partNames }) {
  const wrapper = new THREE.Group();
  const loader = await getLoader();
  const gltf = await loader.loadAsync(url);
  const model = gltf.scene;

  let box = new THREE.Box3().setFromObject(model);
  let size = new THREE.Vector3();
  box.getSize(size);
  const scale = targetHeight / (size.y || 1);
  model.scale.setScalar(scale);

  box = new THREE.Box3().setFromObject(model);
  const center = new THREE.Vector3();
  box.getCenter(center);
  model.position.x -= center.x;
  model.position.z -= center.z;
  model.position.y -= box.min.y;

  wrapper.add(model);
  wrapper.position.set(x, baseY, 0);
  wrapper.scale.setScalar(0.0001);
  wrapper.userData.baseX = x;
  wrapper.userData.baseY = baseY;

  // 이름이 있는 부위(팔 등)를 찾아서 따로 움직이거나, 나머지 몸통을 숨길 수 있도록 저장
  wrapper.userData.parts = {};
  wrapper.userData.bodyMeshes = [];
  if (partNames && partNames.length) {
    const armObjs = partNames.map((n) => model.getObjectByName(n)).filter(Boolean);
    partNames.forEach((n, i) => {
      if (armObjs[i]) wrapper.userData.parts[n] = armObjs[i];
    });
    const isDescendantOfArm = (obj) => {
      let p = obj;
      while (p) {
        if (armObjs.includes(p)) return true;
        p = p.parent;
      }
      return false;
    };
    model.traverse((obj) => {
      if (obj.isMesh && !isDescendantOfArm(obj)) {
        wrapper.userData.bodyMeshes.push(obj);
      }
    });
  }
  return wrapper;
}

const SHOW_BOY = false; // 소년 모델은 일단 비활성화 (눈사람만 표시)

function buildBoy() {
  return loadCharacter("./assets/models/boy.glb", { targetHeight: 3.3, x: -2.7, baseY: -1.35 });
}

function buildSnowman() {
  return loadCharacter("./assets/models/snowman.glb", {
    targetHeight: 3.6,
    x: 2.7,
    baseY: -1.2,
    partNames: ["Vert", "Cylinder"], // 브라운 계열 팔 두 개
  });
}


export async function initScene(canvasEl) {
  if (initialized) return;
  renderer = new THREE.WebGLRenderer({ canvas: canvasEl, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, 0.2, 9);

  scene.add(new THREE.AmbientLight(0xffffff, 0.75));
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.9);
  dirLight.position.set(3, 6, 6);
  scene.add(dirLight);
  const fillLight = new THREE.DirectionalLight(0x88a0c0, 0.35);
  fillLight.position.set(-4, 2, -3);
  scene.add(fillLight);

  buildSnow();
  if (SHOW_BOY) {
    leftGroup = await buildBoy();
    scene.add(leftGroup);
  }
  rightGroup = await buildSnowman();
  scene.add(rightGroup);

  window.addEventListener("resize", onResize);
  initialized = true;
}

function onResize() {
  if (!renderer || !camera) return;
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}

function easeOutBack(t) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const x = Math.min(Math.max(t, 0), 1);
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

function easeOutCubic(t) {
  const x = Math.min(Math.max(t, 0), 1);
  return 1 - Math.pow(1 - x, 3);
}

let leftRevealAt = null;
let rightRevealAt = null;

export function revealLeft() {
  if (leftTarget === 0) leftRevealAt = performance.now();
  leftTarget = 1;
}
export function revealRight() {
  if (rightTarget === 0) rightRevealAt = performance.now();
  rightTarget = 1;
}
export function resetReveal() {
  leftTarget = 0;
  rightTarget = 0;
  leftProgress = 0;
  rightProgress = 0;
  leftRevealAt = null;
  rightRevealAt = null;
  if (leftGroup) {
    leftGroup.scale.setScalar(0.0001);
    leftGroup.position.set(leftGroup.userData.baseX, leftGroup.userData.baseY, 0);
    leftGroup.rotation.set(0, 0, 0);
  }
  if (rightGroup) {
    rightGroup.scale.setScalar(0.0001);
    rightGroup.position.set(rightGroup.userData.baseX, rightGroup.userData.baseY, 0);
    rightGroup.rotation.set(0, 0, 0);
    (rightGroup.userData.bodyMeshes || []).forEach((m) => (m.visible = true));
  }
}

function animate(time) {
  animId = requestAnimationFrame(animate);
  const t = time * 0.001;

  const pos = snowGeometry.attributes.position.array;
  for (let i = 0; i < SNOW_COUNT; i++) {
    pos[i * 3 + 1] -= snowVelocities[i];
    pos[i * 3] += Math.sin(t * 0.6 + i) * 0.004;
    if (pos[i * 3 + 1] < -11) pos[i * 3 + 1] = 11;
  }
  snowGeometry.attributes.position.needsUpdate = true;

  leftProgress += (leftTarget - leftProgress) * 0.07;
  rightProgress += (rightTarget - rightProgress) * 0.07;
  const gScale = Math.max(easeOutBack(leftProgress), 0.0001);
  const sScale = Math.max(easeOutBack(rightProgress), 0.0001);

  if (leftGroup) {
    if (leftTarget > 0) {
      // 소년: 신나게 콩콩 뛰는 바운스 + 스쿼시/스트레치
      const bt = t * 3.4;
      const hop = (1 - Math.cos(bt)) / 2; // 0(착지)~1(정점)
      leftGroup.position.y = leftGroup.userData.baseY + hop * 0.5;
      const squashDrive = Math.cos(bt); // 1=착지(눌림), -1=정점(늘어남)
      const sy = gScale * (1 - 0.16 * squashDrive);
      const sxz = gScale * (1 + 0.1 * squashDrive);
      leftGroup.scale.set(sxz, sy, sxz);
      leftGroup.rotation.y = Math.sin(t * 1.1) * 0.35;
      leftGroup.rotation.z = Math.sin(bt * 0.5) * 0.06;
    } else {
      leftGroup.scale.setScalar(gScale);
    }
  }

  if (rightTarget > 0) {
    const elapsed = rightRevealAt !== null ? time - rightRevealAt : 99999;
    const startX = rightGroup.userData.baseX; // 2.7 (오른쪽)
    const endY = rightGroup.userData.baseY;
    const arms = rightGroup.userData.parts || {};
    const bodyMeshes = rightGroup.userData.bodyMeshes || [];

    const GRIP_DUR = 550; // 팔부터 턱걸이하듯 올라오는 구간
    const WALK_DUR = 1500; // 뒤돌아서 중앙까지 걸어오는 구간
    const TURN_DUR = 450; // 다시 돌아서 정면을 보는 구간

    if (elapsed < GRIP_DUR) {
      // ---- 1) 팔만 먼저 턱- 올라오며 턱걸이하듯 등장 ----
      const pp = elapsed / GRIP_DUR;
      bodyMeshes.forEach((m) => (m.visible = pp > 0.55)); // 몸통은 절반 넘어서야 짠 등장
      rightGroup.scale.setScalar(pp > 0.55 ? easeOutBack(Math.min((pp - 0.55) / 0.45, 1)) : 1);
      rightGroup.position.set(startX, endY - 0.5 * (1 - easeOutCubic(Math.min(pp / 0.55, 1))), 0);
      rightGroup.rotation.set(0, 0, 0);
      // 팔: 아래에서 뻗어 올라와 턱걸이하듯 몸을 끌어올리는 느낌
      const grip = easeOutCubic(Math.min(pp / 0.7, 1));
      if (arms["Vert"]) arms["Vert"].rotation.z = 1.4 - grip * 1.1;
      if (arms["Cylinder"]) arms["Cylinder"].rotation.z = -1.4 + grip * 1.1;
    } else if (elapsed < GRIP_DUR + WALK_DUR) {
      // ---- 2) 뒤돌아서 화면 중앙으로 뒤뚱뒤뚱 ----
      bodyMeshes.forEach((m) => (m.visible = true));
      rightGroup.scale.setScalar(1);
      const pp = (elapsed - GRIP_DUR) / WALK_DUR;
      const e = easeOutCubic(pp);
      const turnP = Math.min(pp / 0.2, 1); // 처음 20%에서 홱 돌아섬
      rightGroup.rotation.y = turnP * Math.PI;
      const walkX = startX + (0 - startX) * e;
      const steps = 6;
      const waddle = Math.sin(pp * Math.PI * steps);
      rightGroup.position.set(walkX, endY + Math.abs(waddle) * 0.12 * (1 - e * 0.3), 0);
      rightGroup.rotation.z = waddle * 0.24 * (1 - e * 0.2);
      // 걸을 땐 팔을 자연스럽게 앞뒤로 흔듦
      if (arms["Vert"]) arms["Vert"].rotation.z = 0.3 + Math.sin(pp * Math.PI * steps) * 0.35;
      if (arms["Cylinder"]) arms["Cylinder"].rotation.z = -0.3 - Math.sin(pp * Math.PI * steps) * 0.35;
    } else if (elapsed < GRIP_DUR + WALK_DUR + TURN_DUR) {
      // ---- 3) 다시 뒤돌아서 정면을 봄 ----
      const pp = (elapsed - GRIP_DUR - WALK_DUR) / TURN_DUR;
      const e = easeOutCubic(pp);
      rightGroup.position.set(0, endY, 0);
      rightGroup.rotation.y = Math.PI * (1 - e);
      rightGroup.rotation.z = 0;
      if (arms["Vert"]) arms["Vert"].rotation.z = 0.3;
      if (arms["Cylinder"]) arms["Cylinder"].rotation.z = -0.3;
    } else {
      // ---- 4) 정면을 보고 인사하듯 팔 흔들기 + 대기 흔들림 ----
      const wob = t * 2.1;
      rightGroup.position.set(0, endY + Math.abs(Math.sin(wob * 0.6)) * 0.08, 0);
      rightGroup.rotation.set(0, 0, Math.sin(wob) * 0.15);
      const breathe = 1 + Math.sin(t * 2.4) * 0.035;
      rightGroup.scale.set(breathe, 2 - breathe, breathe);
      if (arms["Vert"]) arms["Vert"].rotation.z = 0.3 + Math.sin(t * 3.2) * 0.5;
      if (arms["Cylinder"]) arms["Cylinder"].rotation.z = -0.3 + Math.sin(t * 3.2 + Math.PI) * 0.5;
    }
  } else {
    rightGroup.scale.setScalar(sScale);
  }

  camera.position.x = Math.sin(t * 0.15) * 0.45;
  camera.position.y = 0.2 + Math.sin(t * 0.11) * 0.15;
  camera.lookAt(0, 0.2, 0);

  renderer.render(scene, camera);
}

export function start() {
  if (!animId) animate(performance.now());
}

export function stop() {
  if (animId) {
    cancelAnimationFrame(animId);
    animId = null;
  }
}
