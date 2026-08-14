// /easter3d.js
// 이스터에그 전용 Three.js 3D 씬. 5번 두드리기 전까지는 전혀 로드되지 않습니다.

let THREE;
let renderer, scene, camera;
let snowGeometry, snowPoints, snowVelocities;
let girlGroup, snowmanGroup;
let animId = null;
let initialized = false;

let girlProgress = 0;
let snowmanProgress = 0;
let girlTarget = 0;
let snowmanTarget = 0;

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

function buildSnowman() {
  const g = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xf8f9fb, roughness: 0.55 });
  const darkHat = new THREE.MeshStandardMaterial({ color: 0x2f2f36, roughness: 0.5 });
  const orange = new THREE.MeshStandardMaterial({ color: 0xe8862c, roughness: 0.4 });
  const red = new THREE.MeshStandardMaterial({ color: 0xc0463f, roughness: 0.5 });
  const black = new THREE.MeshStandardMaterial({ color: 0x2c2c2c, roughness: 0.4 });
  const brown = new THREE.MeshStandardMaterial({ color: 0x8a5a34, roughness: 0.6 });

  const bottom = new THREE.Mesh(new THREE.SphereGeometry(1.1, 24, 18), white);
  const mid = new THREE.Mesh(new THREE.SphereGeometry(0.8, 24, 18), white);
  mid.position.y = 1.5;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.56, 24, 18), white);
  head.position.y = 2.6;
  g.add(bottom, mid, head);

  const armGeo = new THREE.CylinderGeometry(0.045, 0.045, 1.3, 6);
  const armL = new THREE.Mesh(armGeo, brown);
  armL.position.set(-0.82, 1.65, 0);
  armL.rotation.z = Math.PI / 3.1;
  const armR = armL.clone();
  armR.position.x = 0.82;
  armR.rotation.z = -Math.PI / 3.1;
  g.add(armL, armR);

  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.42, 12), orange);
  nose.rotation.z = Math.PI / 2;
  nose.position.set(0, 2.6, 0.5);
  g.add(nose);

  const dot = (mat, r = 0.055) => new THREE.Mesh(new THREE.SphereGeometry(r, 10, 10), mat);
  const eyeL = dot(black); eyeL.position.set(-0.19, 2.72, 0.48);
  const eyeR = dot(black); eyeR.position.set(0.19, 2.72, 0.48);
  const btn1 = dot(black); btn1.position.set(0, 1.8, 0.76);
  const btn2 = dot(black); btn2.position.set(0, 1.35, 0.76);
  g.add(eyeL, eyeR, btn1, btn2);

  const scarf = new THREE.Mesh(new THREE.TorusGeometry(0.58, 0.12, 10, 20), red);
  scarf.position.y = 2.1;
  scarf.rotation.x = Math.PI / 2;
  const scarfTail = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.5, 8), red);
  scarfTail.position.set(0.15, 1.7, 0.5);
  scarfTail.rotation.x = Math.PI;
  g.add(scarf, scarfTail);

  const hatBrim = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.48, 0.08, 20), darkHat);
  hatBrim.position.y = 3.05;
  const hatTop = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.5, 20), darkHat);
  hatTop.position.y = 3.35;
  const hatBand = new THREE.Mesh(new THREE.CylinderGeometry(0.335, 0.335, 0.09, 20), red);
  hatBand.position.y = 3.13;
  g.add(hatBrim, hatTop, hatBand);

  g.position.set(2.7, -1.2, 0);
  g.scale.setScalar(0.0001);
  g.userData.baseY = -1.2;
  return g;
}

function buildGirl() {
  const g = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: 0xf1c6a0, roughness: 0.55 });
  const dress = new THREE.MeshStandardMaterial({ color: 0x3f8f8a, roughness: 0.5 });
  const hair = new THREE.MeshStandardMaterial({ color: 0x8a5a30, roughness: 0.6 });
  const shoe = new THREE.MeshStandardMaterial({ color: 0x3a2b20, roughness: 0.5 });
  const ribbon = new THREE.MeshStandardMaterial({ color: 0xc0463f, roughness: 0.5 });

  const body = new THREE.Mesh(new THREE.ConeGeometry(0.72, 1.3, 16, 1, true), dress);
  body.position.y = 1.45;
  g.add(body);

  const legGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.85, 10);
  const legL = new THREE.Mesh(legGeo, skin); legL.position.set(-0.2, 0.42, 0);
  const legR = new THREE.Mesh(legGeo, skin); legR.position.set(0.2, 0.42, 0);
  g.add(legL, legR);

  const shoeL = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), shoe); shoeL.position.set(-0.2, 0, 0.04);
  const shoeR = shoeL.clone(); shoeR.position.x = 0.2;
  g.add(shoeL, shoeR);

  const braidGeo = new THREE.CylinderGeometry(0.085, 0.055, 1.05, 10);
  const braidL = new THREE.Mesh(braidGeo, hair);
  braidL.position.set(-0.6, 1.95, -0.1);
  braidL.rotation.z = Math.PI / 11;
  const braidR = braidL.clone();
  braidR.position.x = 0.6;
  braidR.rotation.z = -Math.PI / 11;
  g.add(braidL, braidR);

  const ribbonL = new THREE.Mesh(new THREE.SphereGeometry(0.085, 10, 10), ribbon);
  ribbonL.position.set(-0.64, 1.46, -0.1);
  const ribbonR = ribbonL.clone(); ribbonR.position.x = 0.64;
  g.add(ribbonL, ribbonR);

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.16, 12), skin);
  neck.position.y = 2.15;
  g.add(neck);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.54, 24, 18), skin);
  head.position.y = 2.5;
  g.add(head);

  const cap = new THREE.Mesh(
    new THREE.SphereGeometry(0.565, 20, 14, 0, Math.PI * 2, 0, Math.PI / 1.9),
    hair
  );
  cap.position.y = 2.58;
  g.add(cap);

  const armGeo = new THREE.CylinderGeometry(0.065, 0.065, 0.7, 10);
  const armL = new THREE.Mesh(armGeo, skin);
  armL.position.set(-0.5, 2.05, 0);
  armL.rotation.z = Math.PI / 2.3;
  const armR = armL.clone();
  armR.position.x = 0.5;
  armR.rotation.z = -Math.PI / 2.3;
  g.add(armL, armR);

  const handL = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 10), skin);
  handL.position.set(-0.85, 2.28, 0);
  const handR = handL.clone();
  handR.position.x = 0.85;
  g.add(handL, handR);

  g.position.set(-2.7, -1.2, 0);
  g.scale.setScalar(0.0001);
  g.userData.baseY = -1.2;
  return g;
}

export function initScene(canvasEl) {
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
  girlGroup = buildGirl();
  snowmanGroup = buildSnowman();
  scene.add(girlGroup, snowmanGroup);

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

export function revealGirl() {
  girlTarget = 1;
}
export function revealSnowman() {
  snowmanTarget = 1;
}
export function resetReveal() {
  girlTarget = 0;
  snowmanTarget = 0;
  girlProgress = 0;
  snowmanProgress = 0;
  if (girlGroup) girlGroup.scale.setScalar(0.0001);
  if (snowmanGroup) snowmanGroup.scale.setScalar(0.0001);
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

  girlProgress += (girlTarget - girlProgress) * 0.07;
  snowmanProgress += (snowmanTarget - snowmanProgress) * 0.07;
  const gScale = Math.max(easeOutBack(girlProgress), 0.0001);
  const sScale = Math.max(easeOutBack(snowmanProgress), 0.0001);
  girlGroup.scale.setScalar(gScale);
  snowmanGroup.scale.setScalar(sScale);

  if (girlTarget > 0) {
    girlGroup.rotation.y = Math.sin(t * 1.3) * 0.28;
    girlGroup.position.y = girlGroup.userData.baseY + Math.sin(t * 2.1) * 0.05;
  }
  if (snowmanTarget > 0) {
    snowmanGroup.rotation.y = Math.sin(t * 0.75) * 0.16;
    snowmanGroup.position.y = snowmanGroup.userData.baseY + Math.sin(t * 1.6 + 1) * 0.04;
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
