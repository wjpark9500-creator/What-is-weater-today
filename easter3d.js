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

// 장갑처럼 좌우 팔에 걸쳐 하나로 합쳐진 메쉬를 반으로 쪼개 각 팔 노드에 다시 붙임
function splitMeshOntoPivots(model, meshName, leftPivot, rightPivot) {
  const mesh = model.getObjectByName(meshName);
  if (!mesh || !mesh.isMesh) return;

  // "model" 기준 상대좌표로 계산 — 캐릭터 전체가 world 상에서
  // (x=2.7 등) 옆으로 이동해 있는 상태라, world 좌표 0을 기준으로 좌우를 나누면
  // 전부 한쪽으로 쏠려버린다. 반드시 캐릭터 자신의 중심(= model 기준) 좌표로 나눠야 함.
  model.updateWorldMatrix(true, false);
  mesh.updateWorldMatrix(true, false);
  const modelInverse = new THREE.Matrix4().copy(model.matrixWorld).invert();
  const relativeMatrix = new THREE.Matrix4().multiplyMatrices(modelInverse, mesh.matrixWorld);

  const geom = mesh.geometry;
  const posAttr = geom.attributes.position;
  const index = geom.index;
  const v = new THREE.Vector3();
  const leftIdx = [];
  const rightIdx = [];

  for (let i = 0; i < index.count; i += 3) {
    let sumX = 0;
    const tri = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
    tri.forEach((vi) => {
      v.fromBufferAttribute(posAttr, vi);
      v.applyMatrix4(relativeMatrix);
      sumX += v.x;
    });
    (sumX / 3 < 0 ? leftIdx : rightIdx).push(...tri);
  }

  const bakedGeom = geom.clone();
  bakedGeom.applyMatrix4(relativeMatrix); // model 기준 좌표로 구움

  function attach(indices, pivot) {
    if (indices.length === 0) return;
    const g = bakedGeom.clone();
    g.setIndex(indices);
    const half = new THREE.Mesh(g, mesh.material);
    // pivot은 model의 직속 자식이며 위치(position)만 갖고 있으므로 그만큼만 상쇄하면 됨
    half.position.set(-pivot.position.x, -pivot.position.y, -pivot.position.z);
    pivot.add(half);
  }

  attach(leftIdx, leftPivot);
  attach(rightIdx, rightPivot);
  mesh.parent.remove(mesh);
}

// 공통 GLB 로더: 원본 모델 크기가 제각각이므로 목표 높이에 맞춰 자동 스케일 + 바닥을 y=0에 맞춤
async function loadCharacter(url, { targetHeight, x, baseY, armPivots, armMeshNames }) {
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

  // 팔(+장갑 등 딸린 부품)을 어깨 위치에 새 피벗을 만들어 좌/우로 재조립
  // (원본 모델은 "Vert"/"Cylinder" 각각이 양쪽 팔을 동시에 포함하고 있어서,
  //  이름 기준으로는 좌/우를 분리할 수 없어 좌표(x부호) 기준으로 직접 쪼갬)
  wrapper.userData.parts = {};
  wrapper.userData.bodyGroup = null;
  if (armPivots && armMeshNames && armMeshNames.length) {
    const leftPivot = new THREE.Group();
    leftPivot.position.set(...armPivots.left);
    model.add(leftPivot);
    const rightPivot = new THREE.Group();
    rightPivot.position.set(...armPivots.right);
    model.add(rightPivot);

    armMeshNames.forEach((name) => splitMeshOntoPivots(model, name, leftPivot, rightPivot));

    wrapper.userData.parts = { left: leftPivot, right: rightPivot };

    const isDescendantOfArm = (obj) => {
      let p = obj;
      while (p) {
        if (p === leftPivot || p === rightPivot) return true;
        p = p.parent;
      }
      return false;
    };
    const bodyMeshesFound = [];
    model.traverse((obj) => {
      if (obj.isMesh && !isDescendantOfArm(obj)) {
        bodyMeshesFound.push(obj);
      }
    });
    // 몸통 부품들을 별도 그룹으로 묶어서 팔과 독립적으로 스케일 애니메이션할 수 있게 함
    const bodyGroup = new THREE.Group();
    model.add(bodyGroup);
    bodyMeshesFound.forEach((m) => bodyGroup.attach(m));
    wrapper.userData.bodyGroup = bodyGroup;
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
    // 실제 정점 좌표를 분석해서 찾은 어깨(팔 부착) 지점
    armPivots: {
      left: [-0.313, 0.715, -0.02],
      right: [0.313, 0.715, -0.02],
    },
    // 팔 스틱 2겹(Vert/Cylinder) + 장갑까지, 팔에 관련된 부품 전부
    // (Three.js GLTFLoader가 이름의 점(.)을 제거하고 로드하므로 "Cube.007" -> "Cube007")
    armMeshNames: ["Vert_Brown_0", "Cylinder__0", "Cube007_Red_0"],
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
let greetingStarted = false;

export function hideBubble() {
  greetingStarted = false;
  const bubble = document.getElementById("snowmanBubble");
  if (bubble) bubble.hidden = true;
}

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
  hideBubble();
  if (leftGroup) {
    leftGroup.scale.setScalar(0.0001);
    leftGroup.position.set(leftGroup.userData.baseX, leftGroup.userData.baseY, 0);
    leftGroup.rotation.set(0, 0, 0);
  }
  if (rightGroup) {
    rightGroup.scale.setScalar(0.0001);
    rightGroup.position.set(rightGroup.userData.baseX, rightGroup.userData.baseY, 0);
    rightGroup.rotation.set(0, 0, 0);
    const bg = rightGroup.userData.bodyGroup;
    if (bg) {
      bg.visible = true;
      bg.scale.setScalar(1);
    }
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
    const endY = rightGroup.userData.baseY;
    const arms = rightGroup.userData.parts || {};
    const bodyGroup = rightGroup.userData.bodyGroup;

    const CLOSE_Z = 4.5; // 턱걸이 등장 시 카메라와 가까운 거리 (크게 보임)
    const FAR_Z = -4; // 인사할 때 최종 위치 (멀어져서 작게 보임)
    const LEAN = -0.16; // 인사할 때 몸을 오른쪽으로 기울이는 각도 (부호 반전됨)

    const GRIP_DUR = 900; // 팔부터 턱걸이하듯 등장 후 몸통이 서서히 나타나는 구간
    const WALK_DUR = 1500; // 뒤돌아서 멀어지며 중앙으로 가는 구간
    const TURN_DUR = 450; // 다시 돌아서 정면을 보는 구간

    if (elapsed < GRIP_DUR) {
      // ---- 1) 화면 아래 안 보이는 곳에서 팔이 먼저 턱- 하고 크게 등장 (턱걸이하듯) ----
      //         이후 몸통은 절반 지점부터 천천히(서서히 커지며) 등장
      const pp = elapsed / GRIP_DUR;
      const risen = easeOutCubic(Math.min(pp / 0.4, 1));
      rightGroup.scale.setScalar(1); // 그룹 자체는 항상 원래 크기 (팔이 갑자기 튀지 않도록)
      rightGroup.position.set(0, endY - 2.6 * (1 - risen), CLOSE_Z);
      rightGroup.rotation.set(0, 0, 0);

      const BODY_START = 0.4; // 40% 지점부터 몸통이 서서히 나타남
      const bodyP = Math.max(0, Math.min((pp - BODY_START) / (1 - BODY_START), 1));
      const bodyEase = easeOutCubic(bodyP);
      if (bodyGroup) {
        bodyGroup.visible = bodyP > 0;
        bodyGroup.scale.setScalar(Math.max(bodyEase, 0.0001));
      }

      // 팔: 아래에서 뻗어 올라와 턱걸이하듯 몸을 끌어올리는 느낌
      const grip = easeOutCubic(Math.min(pp / 0.6, 1));
      if (arms["left"]) arms["left"].rotation.z = 1.4 - grip * 1.1;
      if (arms["right"]) arms["right"].rotation.z = -1.4 + grip * 1.1;
    } else if (elapsed < GRIP_DUR + WALK_DUR) {
      // ---- 2) 뒤돌아서(등을 보이며) 점점 멀어지듯 화면 안쪽으로 뒤뚱뒤뚱 ----
      if (bodyGroup) {
        bodyGroup.visible = true;
        bodyGroup.scale.setScalar(1);
      }
      rightGroup.scale.setScalar(1);
      const pp = (elapsed - GRIP_DUR) / WALK_DUR;
      const e = easeOutCubic(pp);
      const turnP = Math.min(pp / 0.2, 1); // 처음 20%에서 홱 돌아섬
      rightGroup.rotation.y = turnP * Math.PI;
      const z = CLOSE_Z + (FAR_Z - CLOSE_Z) * e; // 카메라에서 멀어짐 = 화면상 점점 작게
      const steps = 6;
      const waddle = Math.sin(pp * Math.PI * steps);
      const sway = waddle * 0.25 * (1 - e * 0.3); // 걷는 좌우 뒤뚱거림(제자리에서)
      rightGroup.position.set(sway * 0.4, endY + Math.abs(waddle) * 0.12 * (1 - e * 0.3), z);
      rightGroup.rotation.z = sway;
      // 걸을 땐 팔을 자연스럽게 앞뒤로 흔듦
      if (arms["left"]) arms["left"].rotation.z = 0.3 + Math.sin(pp * Math.PI * steps) * 0.35;
      if (arms["right"]) arms["right"].rotation.z = -0.3 - Math.sin(pp * Math.PI * steps) * 0.35;
    } else if (elapsed < GRIP_DUR + WALK_DUR + TURN_DUR) {
      // ---- 3) 다시 뒤돌아서 정면을 봄 (멀어진 거리는 유지) ----
      const pp = (elapsed - GRIP_DUR - WALK_DUR) / TURN_DUR;
      const e = easeOutCubic(pp);
      rightGroup.position.set(0, endY, FAR_Z);
      rightGroup.rotation.y = Math.PI * (1 - e);
      rightGroup.rotation.z = LEAN * e; // 정면을 보면서 서서히 오른쪽으로 기욺
      if (arms["left"]) arms["left"].rotation.z = 0.3;
      if (arms["right"]) arms["right"].rotation.z = -0.3;
    } else {
      // ---- 4) 정면에서 몸을 오른쪽으로 기울인 채, 팔을 들어올린 뒤 왼쪽 팔만 흔들며 인사 ----
      const greetElapsed = elapsed - (GRIP_DUR + WALK_DUR + TURN_DUR);
      const RAISE_DUR = 400;
      const raiseP = easeOutCubic(Math.min(greetElapsed / RAISE_DUR, 1));
      const raisedAngle = 0.3 + (1.3 - 0.3) * raiseP; // 0.3(내린 위치) -> 1.3(든 위치)

      const wob = t * 2.1;
      rightGroup.position.set(0, endY + Math.abs(Math.sin(wob * 0.6)) * 0.06, FAR_Z);
      rightGroup.rotation.set(0, 0, LEAN + Math.sin(wob) * 0.03);
      const breathe = 1 + Math.sin(t * 2.4) * 0.03;
      rightGroup.scale.set(breathe, 2 - breathe, breathe);
      // 왼쪽(화면 기준) 팔만 들어올린 뒤 흔들흔들, 반대쪽 팔은 몸에 붙인 채 고정
      if (arms["left"]) arms["left"].rotation.z = raisedAngle + Math.sin(t * 3.2) * 0.4 * raiseP;
      if (arms["right"]) arms["right"].rotation.z = -0.3;

      if (!greetingStarted) {
        greetingStarted = true;
        const bubble = document.getElementById("snowmanBubble");
        if (bubble) bubble.hidden = false;
      }
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
