// /api/verdict.js
// "지금 당장" 판정 - Vercel Serverless Function
// 프론트에서 /api/verdict?lat=..&lon=..&sido=.. 로 호출

import { latLonToGrid, resolveLocation, fetchAir } from "../lib/shared.js";

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
  const pty = get("PTY");
  const rn1 = parseFloat(get("RN1")) || 0;

  return {
    temperature: isNaN(temperature) ? null : temperature,
    humidity: isNaN(humidity) ? null : humidity,
    rain: (pty && pty !== "0") || rn1 > 0.1,
  };
}

// ---------- 판정 로직 (출근_환기_판정기준.json 규칙 그대로) ----------
function judge({ temperature, humidity, pm10, pm25, rain }) {
  const pm10Bad = pm10 !== null && pm10 >= 81;
  const pm25Bad = pm25 !== null && pm25 >= 36;
  const pm10Moderate = pm10 !== null && pm10 >= 31 && pm10 < 81;
  const pm25Moderate = pm25 !== null && pm25 >= 16 && pm25 < 36;

  const airBad = pm10Bad || pm25Bad;
  const airMissing = pm10 === null && pm25 === null;
  const airModerate = !airBad && (airMissing || pm10Moderate || pm25Moderate);

  if (airBad) {
    return { level: "RED", action: "CLOSE", message: "오늘은 창문을 닫고 출근하는 것을 권장합니다." };
  }
  if (rain) {
    return { level: "RED", action: "CLOSE", message: "빗물과 습기 유입을 막기 위해 창문을 닫아주세요." };
  }
  if (temperature === null || humidity === null) {
    return {
      level: "YELLOW", action: "SHORT_VENT", minutes: "10-20",
      message: "조건이 애매하므로 출근 전 10~20분 정도 환기하는 것을 권장합니다.",
    };
  }
  if (!airModerate && temperature >= 18 && temperature <= 27 && humidity >= 40 && humidity <= 60) {
    return { level: "GREEN", action: "OPEN", message: "창문을 조금 열어두고 출근해도 좋습니다." };
  }
  if (!airModerate && ((temperature > 27 && temperature <= 30) || (humidity > 60 && humidity <= 70))) {
    return {
      level: "YELLOW", action: "SHORT_VENT", minutes: "10-20",
      message: "출근 전 10~20분 정도 환기한 뒤 창문을 닫는 것을 권장합니다.",
    };
  }
  if (!airModerate && (temperature > 30 || humidity > 70)) {
    return {
      level: "ORANGE", action: "SHORT_VENT", minutes: "5-15",
      message: "더위나 습기 유입을 줄이기 위해 5~15분 정도만 환기하고 닫는 것을 권장합니다.",
    };
  }
  if (airModerate) {
    return {
      level: "YELLOW", action: "SHORT_VENT", minutes: "10-20",
      message: "공기질이 보통이므로 10~20분 정도 짧게 환기하는 것을 권장합니다.",
    };
  }
  return {
    level: "YELLOW", action: "SHORT_VENT", minutes: "10-20",
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
    const air = await fetchAir(location.sido);

    const verdict = judge({
      temperature: weather.temperature,
      humidity: weather.humidity,
      pm10: air.pm10,
      pm25: air.pm25,
      rain: weather.rain,
    });

    return res.status(200).json({
      location: { lat: latNum, lon: lonNum, sido: location.sido, label: location.label, nx, ny },
      weather,
      air,
      verdict,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "알 수 없는 오류" });
  }
}
