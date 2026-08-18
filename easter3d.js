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
    THREE = await import("https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js");
    return true;
  } catch (err) {
    console.warn("Three.js 로드 실패:", err);
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
  const { GLTFLoader } = await import(
    "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/GLTFLoader.js"
  );
  const { MeshoptDecoder } = await import(
    "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/meshopt_decoder.module.js"
  );
  gltfLoader = new GLTFLoader();
  gltfLoader.setMeshoptDecoder(MeshoptDecoder);
  return gltfLoader;
}

// 공통 GLB 로더: 원본 모델 크기가 제각각이므로 목표 높이에 맞춰 자동 스케일 + 바닥을 y=0에 맞춤
async function loadCharacter(url, { targetHeight, x, baseY }) {
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
  wrapper.userData.baseY = baseY;
  return wrapper;
}

function buildBoy() {
  return loadCharacter("./assets/models/boy.glb", { targetHeight: 3.3, x: -2.7, baseY: -1.35 });
}

function buildSnowman() {
  return loadCharacter("./assets/models/snowman.glb", { targetHeight: 3.6, x: 2.7, baseY: -1.2 });
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
  leftGroup = await buildBoy();
  rightGroup = await buildSnowman();
  scene.add(leftGroup, rightGroup);

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

export function revealLeft() {
  leftTarget = 1;
}
export function revealRight() {
  rightTarget = 1;
}
export function resetReveal() {
  leftTarget = 0;
  rightTarget = 0;
  leftProgress = 0;
  rightProgress = 0;
  if (leftGroup) leftGroup.scale.setScalar(0.0001);
  if (rightGroup) rightGroup.scale.setScalar(0.0001);
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
  leftGroup.scale.setScalar(gScale);
  rightGroup.scale.setScalar(sScale);

  if (leftTarget > 0) {
    leftGroup.rotation.y = Math.sin(t * 1.3) * 0.28;
    leftGroup.position.y = leftGroup.userData.baseY + Math.sin(t * 2.1) * 0.05;
  }
  if (rightTarget > 0) {
    rightGroup.rotation.y = Math.sin(t * 0.75) * 0.16;
    rightGroup.position.y = rightGroup.userData.baseY + Math.sin(t * 1.6 + 1) * 0.04;
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
