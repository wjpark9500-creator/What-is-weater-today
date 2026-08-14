// /lib/shared.js
// api/verdict.js 와 api/day-verdict.js 가 함께 쓰는 공통 함수

// ---------- 기상청 격자좌표 변환 (위경도 -> nx, ny) ----------
export function latLonToGrid(lat, lon) {
  const RE = 6371.00877;
  const GRID = 5.0;
  const SLAT1 = 30.0 * (Math.PI / 180.0);
  const SLAT2 = 60.0 * (Math.PI / 180.0);
  const OLON = 126.0 * (Math.PI / 180.0);
  const OLAT = 38.0 * (Math.PI / 180.0);
  const XO = 43;
  const YO = 136;

  const re = RE / GRID;
  let sn = Math.tan(Math.PI * 0.25 + SLAT2 * 0.5) / Math.tan(Math.PI * 0.25 + SLAT1 * 0.5);
  sn = Math.log(Math.cos(SLAT1) / Math.cos(SLAT2)) / Math.log(sn);
  let sf = Math.tan(Math.PI * 0.25 + SLAT1 * 0.5);
  sf = (Math.pow(sf, sn) * Math.cos(SLAT1)) / sn;
  let ro = Math.tan(Math.PI * 0.25 + OLAT * 0.5);
  ro = (re * sf) / Math.pow(ro, sn);

  const raLat = lat * (Math.PI / 180.0);
  let ra = Math.tan(Math.PI * 0.25 + raLat * 0.5);
  ra = (re * sf) / Math.pow(ra, sn);
  let theta = lon * (Math.PI / 180.0) - OLON;
  if (theta > Math.PI) theta -= 2.0 * Math.PI;
  if (theta < -Math.PI) theta += 2.0 * Math.PI;
  theta *= sn;

  const nx = Math.floor(ra * Math.sin(theta) + XO + 0.5);
  const ny = Math.floor(ro - ra * Math.cos(theta) + YO + 0.5);
  return { nx, ny };
}

// ---------- 시/도 이름 정규화 ----------
export function normalizeSido(raw) {
  if (!raw) return "경기";
  const table = {
    서울특별시: "서울", 부산광역시: "부산", 대구광역시: "대구", 인천광역시: "인천",
    광주광역시: "광주", 대전광역시: "대전", 울산광역시: "울산", 세종특별자치시: "세종",
    경기도: "경기", 강원도: "강원", 강원특별자치도: "강원",
    충청북도: "충북", 충청남도: "충남",
    전라북도: "전북", 전북특별자치도: "전북", 전라남도: "전남",
    경상북도: "경북", 경상남도: "경남", 제주특별자치도: "제주",
  };
  for (const key in table) {
    if (raw.includes(key)) return table[key];
  }
  return "경기";
}

// ---------- 위경도 -> {sido, label} (Nominatim 역지오코딩, 무료/키 불필요) ----------
export async function resolveLocation(lat, lon) {
  const res = await fetch(
    `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&accept-language=ko&zoom=10`,
    { headers: { "User-Agent": "ventilation-app (personal project)" } }
  );
  if (!res.ok) return { sido: "경기", label: "내 위치" };
  const data = await res.json();
  const addr = data?.address || {};
  const sido = normalizeSido(addr.state || addr.city || "");
  const cityLevel = addr.city || addr.county || addr.town || "";
  const district = addr.borough || addr.suburb || addr.city_district || "";
  const label = [cityLevel, district].filter(Boolean).join(" ") || addr.state || "내 위치";
  return { sido, label };
}

// ---------- 에어코리아 시도별 실시간 측정정보 (해당 시/도에서 가장 나쁜 값, 보수적 판단) ----------
export async function fetchAir(sidoName) {
  const key = process.env.AIRKOREA_API_KEY;
  const url =
    `https://apis.data.go.kr/B552584/ArpltnInforInqireSvc/getCtprvnRltmMesureDnsty` +
    `?serviceKey=${encodeURIComponent(key)}&returnType=json&numOfRows=100&pageNo=1` +
    `&sidoName=${encodeURIComponent(sidoName)}&ver=1.3`;

  const res = await fetch(url);
  const json = await res.json();
  const items = json?.response?.body?.items;
  if (!Array.isArray(items) || items.length === 0) {
    return { pm10: null, pm25: null };
  }

  const nums = (arr) => arr.map((v) => parseFloat(v)).filter((v) => !isNaN(v) && v >= 0);
  const pm10List = nums(items.map((s) => s.pm10Value));
  const pm25List = nums(items.map((s) => s.pm25Value));

  return {
    pm10: pm10List.length ? Math.max(...pm10List) : null,
    pm25: pm25List.length ? Math.max(...pm25List) : null,
  };
}

// ---------- KST 기준 오늘 날짜(yyyyMMdd), 현재 시:분 ----------
export function nowKst() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(kst.getUTCDate()).padStart(2, "0");
  const hh = String(kst.getUTCHours()).padStart(2, "0");
  const mm = String(kst.getUTCMinutes()).padStart(2, "0");
  return { dateStr: `${y}${m}${d}`, hh, mm, kstDate: kst };
}
