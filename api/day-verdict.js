// /api/day-verdict.js
// "오늘 하루" 판정 - 집을 비우는 시간대의 시간별 예보를 모아 종합 판정
// 프론트에서 /api/day-verdict?lat=..&lon=..&sido=..&start=08:30&end=18:30 로 호출

import { latLonToGrid, resolveLocation, fetchAir, nowKst } from "../lib/shared.js";

// ---------- 단기예보(getVilageFcst) 기준 시각 계산 ----------
// 발표시각: 02,05,08,11,14,17,20,23시 (각 시각 + 10분부터 조회 가능)
function getForecastBaseDateTime() {
  const baseHours = [2, 5, 8, 11, 14, 17, 20, 23];
  const now = new Date();
  const kstMs = now.getTime() + 9 * 60 * 60 * 1000;
  const kst = new Date(kstMs);
  const hh = kst.getUTCHours();
  const mm = kst.getUTCMinutes();

  let candidate = null;
  for (let i = baseHours.length - 1; i >= 0; i--) {
    const bh = baseHours[i];
    if (hh > bh || (hh === bh && mm >= 10)) {
      candidate = bh;
      break;
    }
  }

  let dateForBase = kst;
  if (candidate === null) {
    candidate = 23;
    dateForBase = new Date(kstMs - 24 * 60 * 60 * 1000);
  }

  const y = dateForBase.getUTCFullYear();
  const m = String(dateForBase.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dateForBase.getUTCDate()).padStart(2, "0");
  return { baseDate: `${y}${m}${d}`, baseTime: `${String(candidate).padStart(2, "0")}00` };
}

// ---------- 기상청 단기예보 조회 ----------
async function fetchForecast(nx, ny) {
  const { baseDate, baseTime } = getForecastBaseDateTime();
  const key = process.env.KMA_API_KEY;
  const url =
    `https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst` +
    `?serviceKey=${encodeURIComponent(key)}&numOfRows=1000&pageNo=1&dataType=JSON` +
    `&base_date=${baseDate}&base_time=${baseTime}&nx=${nx}&ny=${ny}`;

  const res = await fetch(url);
  const json = await res.json();
  const items = json?.response?.body?.items?.item;
  if (!Array.isArray(items)) {
    throw new Error("기상청 예보 응답 형식 오류: " + JSON.stringify(json).slice(0, 300));
  }
  return items;
}

// ---------- "HH:mm" -> 분 단위 ----------
function toMinutes(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
}

// ---------- 예보 원본 항목들을 시간대별 레코드로 정리 ----------
function buildHourly(items, todayDateStr, startMin, endMin) {
  const byTime = {};
  for (const it of items) {
    if (it.fcstDate !== todayDateStr) continue;
    const t = it.fcstTime; // "HHmm"
    const minutes = parseInt(t.slice(0, 2), 10) * 60 + parseInt(t.slice(2), 10);
    if (minutes < startMin || minutes > endMin) continue;
    if (!byTime[t]) byTime[t] = { time: `${t.slice(0, 2)}:${t.slice(2)}` };
    byTime[t][it.category] = it.fcstValue;
  }
  return Object.values(byTime).sort((a, b) => a.time.localeCompare(b.time));
}

// ---------- 하루 종합 판정 ----------
function judgeDay({ hourly, pm10, pm25 }) {
  const pm10Bad = pm10 !== null && pm10 >= 81;
  const pm25Bad = pm25 !== null && pm25 >= 36;
  const pm10Moderate = pm10 !== null && pm10 >= 31 && pm10 < 81;
  const pm25Moderate = pm25 !== null && pm25 >= 16 && pm25 < 36;
  const airBad = pm10Bad || pm25Bad;
  const airModerate = !airBad && (pm10Moderate || pm25Moderate);

  const temps = hourly.map((h) => parseFloat(h.TMP)).filter((v) => !isNaN(v));
  const humids = hourly.map((h) => parseFloat(h.REH)).filter((v) => !isNaN(v));
  const pops = hourly.map((h) => parseFloat(h.POP)).filter((v) => !isNaN(v));
  const winds = hourly.map((h) => parseFloat(h.WSD)).filter((v) => !isNaN(v));
  const rainCodes = hourly.map((h) => h.PTY).filter((v) => v !== undefined);

  const maxTemp = temps.length ? Math.max(...temps) : null;
  const maxHumidity = humids.length ? Math.max(...humids) : null;
  const humidHours = humids.filter((v) => v >= 70).length;
  const maxPop = pops.length ? Math.max(...pops) : 0;
  const avgWind = winds.length ? winds.reduce((a, b) => a + b, 0) / winds.length : null;
  const rainExpected = rainCodes.some((c) => c !== "0") || maxPop >= 70;

  const summary = { maxTemp, maxHumidity, humidHours, maxPop, avgWind, rainExpected };

  // ---- 강제 탈락 조건 ----
  if (airBad) {
    return {
      level: "RED", action: "CLOSE", forced: true,
      message: "집을 비우는 동안 미세먼지/초미세먼지가 나쁨 수준입니다. 오늘은 닫고 출근하세요.",
      summary,
    };
  }
  if (rainExpected) {
    return {
      level: "RED", action: "CLOSE", forced: true,
      message: "집을 비우는 동안 비가 올 가능성이 높습니다. 빗물 유입을 막기 위해 닫고 출근하세요.",
      summary,
    };
  }
  if (maxTemp !== null && maxTemp > 33) {
    return {
      level: "RED", action: "CLOSE", forced: true,
      message: `집을 비우는 동안 최고 ${Math.round(maxTemp)}℃까지 올라갈 것으로 예상됩니다. 장시간 개방은 피해주세요.`,
      summary,
    };
  }

  // ---- 점수제 ----
  let score = 0;
  score += airModerate ? 15 : 30; // 공기질
  if (maxPop < 20) score += 20;
  else if (maxPop < 40) score += 15;
  else if (maxPop < 60) score += 10;
  else score += 5; // 강수

  if (maxTemp === null) score += 10;
  else if (maxTemp <= 27) score += 20;
  else if (maxTemp <= 30) score += 15;
  else score += 8; // 30~33도 구간 (30점 만점중 기온)

  if (humidHours === 0) score += 20;
  else if (humidHours <= 2) score += 12;
  else if (humidHours <= 5) score += 6;
  else score += 0; // 습도 지속시간

  if (avgWind === null) score += 5;
  else if (avgWind >= 3) score += 10;
  else if (avgWind >= 1.5) score += 5;
  else score += 0; // 바람

  let level, action, message, minutes;
  if (score >= 80) {
    level = "GREEN"; action = "OPEN";
    message = "오늘 하루 종일 창문을 열어두고 출근해도 좋습니다.";
  } else if (score >= 60) {
    level = "YELLOW"; action = "SHORT_VENT"; minutes = "10-20";
    message = "대체로 괜찮지만 낮 동안 다소 덥거나 습해질 수 있어요. 짧게 환기 후 닫는 걸 권장합니다.";
  } else if (score >= 40) {
    level = "ORANGE"; action = "SHORT_VENT"; minutes = "5-15";
    message = "오늘은 낮 동안 덥거나 습한 시간대가 있을 것으로 보입니다. 출근 전 환기 후 닫아주세요.";
  } else {
    level = "RED"; action = "CLOSE";
    message = "오늘 하루 조건이 좋지 않습니다. 닫고 출근하는 것을 권장합니다.";
  }

  return { level, action, minutes, forced: false, message, score, summary };
}

export default async function handler(req, res) {
  try {
    const { lat, lon, sido, start, end } = req.query;
    if (!lat || !lon) {
      return res.status(400).json({ error: "lat, lon 파라미터가 필요합니다." });
    }
    if (!process.env.KMA_API_KEY || !process.env.AIRKOREA_API_KEY) {
      return res.status(500).json({
        error: "서버에 KMA_API_KEY / AIRKOREA_API_KEY 환경변수가 설정되어 있지 않습니다.",
      });
    }

    const startStr = /^\d{1,2}:\d{2}$/.test(start) ? start : "08:30";
    const endStr = /^\d{1,2}:\d{2}$/.test(end) ? end : "18:30";
    const startMin = toMinutes(startStr);
    const endMin = toMinutes(endStr);

    const latNum = parseFloat(lat);
    const lonNum = parseFloat(lon);
    const { nx, ny } = latLonToGrid(latNum, lonNum);
    const { dateStr } = nowKst();

    const [items, location] = await Promise.all([
      fetchForecast(nx, ny),
      sido ? Promise.resolve({ sido, label: null }) : resolveLocation(latNum, lonNum),
    ]);
    const air = await fetchAir(location.sido);

    const hourly = buildHourly(items, dateStr, startMin, endMin);
    if (hourly.length === 0) {
      return res.status(200).json({
        location: { lat: latNum, lon: lonNum, sido: location.sido, label: location.label, nx, ny },
        window: { start: startStr, end: endStr },
        hourly: [],
        air,
        verdict: {
          level: "YELLOW", action: "SHORT_VENT", minutes: "10-20", forced: false,
          message: "설정하신 시간대의 예보를 찾지 못했어요. 시간대를 다시 확인해주세요 (예보는 오늘 날짜, 앞으로 약 2~3일치만 제공됩니다).",
        },
        updatedAt: new Date().toISOString(),
      });
    }

    const verdict = judgeDay({ hourly, pm10: air.pm10, pm25: air.pm25 });

    return res.status(200).json({
      location: { lat: latNum, lon: lonNum, sido: location.sido, label: location.label, nx, ny },
      window: { start: startStr, end: endStr },
      hourly,
      air,
      verdict,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "알 수 없는 오류" });
  }
}
