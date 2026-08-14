// /api/verdict.js
// Vercel Serverless Function
// 프론트에서 /api/verdict?lat=..&lon=..&sido=.. 로 호출
// - lat, lon: 필수 (기상청 격자 좌표 변환용)
// - sido: 선택 (직접 지역 선택 시 넘겨주면 좌표->시도 역지오코딩 생략)

// ---------- 기상청 격자좌표 변환 (위경도 -> nx, ny) ----------
// 기상청 공식 변환식 (Lambert Conformal Conic)
function latLonToGrid(lat, lon) {
  const RE = 6371.00877; // 지구 반경(km)
  const GRID = 5.0; // 격자 간격(km)
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

// ---------- 초단기실황조회 기준 시각 계산 (매 시 40분 이후 생성, KST) ----------
function getBaseDateTime() {
  const now = new Date();
  const kstMs = now.getTime() + 9 * 60 * 60 * 1000;
  let ref = new Date(kstMs);
  if (ref.getUTCMinutes() < 40) {
    ref = new Date(kstMs - 60 * 60 * 1000);
  }
  const y = ref.getUTCFullYear();
  const m = String(ref.getUTCMonth() + 1).padStart(2, "0");
  const d = String(ref.getUTCDate()).padStart(2, "0");
  const h = String(ref.getUTCHours()).padStart(2, "0");
  return { baseDate: `${y}${m}${d}`, baseTime: `${h}00` };
}

// ---------- 시/도 이름 정규화 (Nominatim 결과 -> 에어코리아 sidoName) ----------
function normalizeSido(raw) {
  if (!raw) return "경기";
  const table = {
    서울특별시: "서울",
    부산광역시: "부산",
    대구광역시: "대구",
    인천광역시: "인천",
    광주광역시: "광주",
    대전광역시: "대전",
    울산광역시: "울산",
    세종특별자치시: "세종",
    경기도: "경기",
    강원도: "강원",
    강원특별자치도: "강원",
    충청북도: "충북",
    충청남도: "충남",
    전라북도: "전북",
    전북특별자치도: "전북",
    전라남도: "전남",
    경상북도: "경북",
    경상남도: "경남",
    제주특별자치도: "제주",
  };
  for (const key in table) {
    if (raw.includes(key)) return table[key];
  }
  return "경기";
}

// 위경도 -> {sido, label} 한 번에 조회 (시/군/구 단위까지 나오도록 zoom=10)
async function resolveLocation(lat, lon) {
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

// ---------- 기상청 초단기실황 ----------
async function fetchWeather(nx, ny) {
  const { baseDate, baseTime } = getBaseDateTime();
  const key = process.env.KMA_API_KEY;
  const url =
    `https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtNcst` +
    `?serviceKey=${encodeURIComponent(key)}&numOfRows=20&pageNo=1&dataType=JSON` +
    `&base_date=${baseDate}&base_time=${baseTime}&nx=${nx}&ny=${ny}`;

  const res = await fetch(url);
  const json = await res.json();
  const items = json?.response?.body?.items?.item;
  if (!items) throw new Error("기상청 응답 형식 오류: " + JSON.stringify(json).slice(0, 300));

  const get = (cat) => items.find((i) => i.category === cat)?.obsrValue;
  const temperature = parseFloat(get("T1H"));
  const humidity = parseFloat(get("REH"));
  const pty = get("PTY"); // 강수형태: 0=없음
  const rn1 = parseFloat(get("RN1")) || 0; // 1시간 강수량(mm)

  return {
    temperature: isNaN(temperature) ? null : temperature,
    humidity: isNaN(humidity) ? null : humidity,
    rain: (pty && pty !== "0") || rn1 > 0.1,
  };
}

// ---------- 에어코리아 시도별 실시간 측정정보 ----------
async function fetchAir(sidoName) {
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

  const nums = (arr) =>
    arr.map((v) => parseFloat(v)).filter((v) => !isNaN(v) && v >= 0);

  // 보수적 판단: 해당 시/도 관측소 중 가장 나쁜(높은) 값을 사용
  const pm10List = nums(items.map((s) => s.pm10Value));
  const pm25List = nums(items.map((s) => s.pm25Value));

  return {
    pm10: pm10List.length ? Math.max(...pm10List) : null,
    pm25: pm25List.length ? Math.max(...pm25List) : null,
  };
}

// ---------- 판정 로직 (출근_환기_판정기준.json 규칙 그대로 구현) ----------
function judge({ temperature, humidity, pm10, pm25, rain }) {
  const pm10Bad = pm10 !== null && pm10 >= 81; // 나쁨 이상
  const pm25Bad = pm25 !== null && pm25 >= 36;
  const pm10Moderate = pm10 !== null && pm10 >= 31 && pm10 < 81;
  const pm25Moderate = pm25 !== null && pm25 >= 16 && pm25 < 36;

  const airBad = pm10Bad || pm25Bad;
  const airMissing = pm10 === null && pm25 === null;
  const airModerate = !airBad && (airMissing || pm10Moderate || pm25Moderate);

  // 우선순위: 공기질 나쁨 -> 강한 비 -> 쾌적 -> 더움/습함 -> 매우 더움/습함 -> 공기질 보통 -> fallback
  if (airBad) {
    return { level: "RED", action: "CLOSE", message: "오늘은 창문을 닫고 출근하는 것을 권장합니다." };
  }
  if (rain) {
    return { level: "RED", action: "CLOSE", message: "빗물과 습기 유입을 막기 위해 창문을 닫아주세요." };
  }
  if (temperature === null || humidity === null) {
    return {
      level: "YELLOW",
      action: "SHORT_VENT",
      minutes: "10-20",
      message: "조건이 애매하므로 출근 전 10~20분 정도 환기하는 것을 권장합니다.",
    };
  }
  if (!airModerate && temperature >= 18 && temperature <= 27 && humidity >= 40 && humidity <= 60) {
    return { level: "GREEN", action: "OPEN", message: "창문을 조금 열어두고 출근해도 좋습니다." };
  }
  if (!airModerate && ((temperature > 27 && temperature <= 30) || (humidity > 60 && humidity <= 70))) {
    return {
      level: "YELLOW",
      action: "SHORT_VENT",
      minutes: "10-20",
      message: "출근 전 10~20분 정도 환기한 뒤 창문을 닫는 것을 권장합니다.",
    };
  }
  if (!airModerate && (temperature > 30 || humidity > 70)) {
    return {
      level: "ORANGE",
      action: "SHORT_VENT",
      minutes: "5-15",
      message: "더위나 습기 유입을 줄이기 위해 5~15분 정도만 환기하고 닫는 것을 권장합니다.",
    };
  }
  if (airModerate) {
    return {
      level: "YELLOW",
      action: "SHORT_VENT",
      minutes: "10-20",
      message: "공기질이 보통이므로 10~20분 정도 짧게 환기하는 것을 권장합니다.",
    };
  }
  return {
    level: "YELLOW",
    action: "SHORT_VENT",
    minutes: "10-20",
    message: "조건이 애매하므로 출근 전 10~20분 정도 환기하는 것을 권장합니다.",
  };
}

export default async function handler(req, res) {
  try {
    const { lat, lon, sido } = req.query;
    if (!lat || !lon) {
      return res.status(400).json({ error: "lat, lon 파라미터가 필요합니다." });
    }
    if (!process.env.KMA_API_KEY || !process.env.AIRKOREA_API_KEY) {
      return res.status(500).json({
        error: "서버에 KMA_API_KEY / AIRKOREA_API_KEY 환경변수가 설정되어 있지 않습니다.",
      });
    }

    const latNum = parseFloat(lat);
    const lonNum = parseFloat(lon);
    const { nx, ny } = latLonToGrid(latNum, lonNum);

    const [weather, location] = await Promise.all([
      fetchWeather(nx, ny),
      sido ? Promise.resolve({ sido, label: null }) : resolveLocation(latNum, lonNum),
    ]);
    const sidoName = location.sido;
    const air = await fetchAir(sidoName);

    const verdict = judge({
      temperature: weather.temperature,
      humidity: weather.humidity,
      pm10: air.pm10,
      pm25: air.pm25,
      rain: weather.rain,
    });

    return res.status(200).json({
      location: { lat: latNum, lon: lonNum, sido: sidoName, label: location.label, nx, ny },
      weather,
      air,
      verdict,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "알 수 없는 오류" });
  }
}
