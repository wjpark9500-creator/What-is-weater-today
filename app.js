// 주요 도시 좌표 (직접 선택용)
const CITIES = [
  { name: "수원", lat: 37.2636, lon: 127.0286, sido: "경기" },
  { name: "서울", lat: 37.5665, lon: 126.9780, sido: "서울" },
  { name: "인천", lat: 37.4563, lon: 126.7052, sido: "인천" },
  { name: "부산", lat: 35.1796, lon: 129.0756, sido: "부산" },
  { name: "대구", lat: 35.8714, lon: 128.6014, sido: "대구" },
  { name: "대전", lat: 36.3504, lon: 127.3845, sido: "대전" },
  { name: "광주", lat: 35.1595, lon: 126.8526, sido: "광주" },
  { name: "울산", lat: 35.5384, lon: 129.3114, sido: "울산" },
  { name: "세종", lat: 36.4801, lon: 127.2890, sido: "세종" },
  { name: "춘천", lat: 37.8813, lon: 127.7298, sido: "강원" },
  { name: "청주", lat: 36.6424, lon: 127.4890, sido: "충북" },
  { name: "전주", lat: 35.8242, lon: 127.1480, sido: "전북" },
  { name: "제주", lat: 33.4996, lon: 126.5312, sido: "제주" },
];

const el = {
  body: document.body,
  message: document.getElementById("verdictMessage"),
  sub: document.getElementById("verdictSub"),
  stats: document.getElementById("stats"),
  dayStats: document.getElementById("dayStats"),
  labelTemp: document.getElementById("labelTemp"),
  labelHumid: document.getElementById("labelHumid"),
  temp: document.getElementById("statTemp"),
  humid: document.getElementById("statHumid"),
  pm10: document.getElementById("statPm10"),
  pm25: document.getElementById("statPm25"),
  pop: document.getElementById("statPop"),
  wind: document.getElementById("statWind"),
  score: document.getElementById("statScore"),
  locationLabel: document.getElementById("locationLabel"),
  loadingOverlay: document.getElementById("loadingOverlay"),
  citySelect: document.getElementById("citySelect"),
  locateBtn: document.getElementById("locateBtn"),
  errorBox: document.getElementById("errorBox"),
  tabNow: document.getElementById("tabNow"),
  tabDay: document.getElementById("tabDay"),
  awaySettings: document.getElementById("awaySettings"),
  awayStart: document.getElementById("awayStart"),
  awayEnd: document.getElementById("awayEnd"),
  awaySaveBtn: document.getElementById("awaySaveBtn"),
};

let mode = "now"; // "now" | "day"
let lastCoords = null; // { lat, lon, sido, label } 마지막으로 조회한 위치 (탭 전환 시 재사용)

// 집 비우는 시간 - localStorage에 저장해서 다음에 켜도 유지
const AWAY_KEY = "ventApp.awayRange";
function loadAwayRange() {
  try {
    const saved = JSON.parse(localStorage.getItem(AWAY_KEY));
    if (saved?.start && saved?.end) return saved;
  } catch (_) {}
  return { start: "08:00", end: "19:00" };
}
function saveAwayRange(range) {
  try {
    localStorage.setItem(AWAY_KEY, JSON.stringify(range));
  } catch (_) {}
}

function populateCitySelect() {
  CITIES.forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c.name;
    opt.textContent = c.name;
    el.citySelect.appendChild(opt);
  });
}

function showError(msg) {
  el.errorBox.textContent = msg;
  el.errorBox.hidden = false;
}
function hideError() {
  el.errorBox.hidden = true;
}

function pmLabel(value) {
  if (value === null || value === undefined) return "정보 없음";
  return `${Math.round(value)}㎍/㎥`;
}

function applyVerdictUI(verdict) {
  el.body.dataset.level = verdict.level;
  el.message.textContent = verdict.message;
  el.sub.textContent = verdict.minutes ? `권장 환기 시간: ${verdict.minutes}분` : "";
}

function setLoading(isLoading) {
  el.locateBtn.disabled = isLoading;
  el.citySelect.disabled = isLoading;
  el.awayStart.disabled = isLoading;
  el.awayEnd.disabled = isLoading;
  el.awaySaveBtn.disabled = isLoading;
  el.loadingOverlay.classList.toggle("active", isLoading);
}

// 응답이 너무 빨라서 로딩창이 깜빡이지도 않고 사라지는 걸 방지 - 최소 노출 시간 보장
const MIN_LOADING_MS = 350;
async function ensureMinLoadingTime(startedAt) {
  const elapsed = Date.now() - startedAt;
  if (elapsed < MIN_LOADING_MS) {
    await new Promise((r) => setTimeout(r, MIN_LOADING_MS - elapsed));
  }
}

async function loadVerdict({ lat, lon, sido, label }) {
  lastCoords = { lat, lon, sido, label };
  if (mode === "day") {
    await loadDayVerdict();
  } else {
    await loadNowVerdict();
  }
}

async function loadNowVerdict() {
  if (!lastCoords) return;
  const { lat, lon, sido, label } = lastCoords;
  hideError();
  setLoading(true);
  const loadStartedAt = Date.now();
  el.body.dataset.level = "loading";
  el.message.textContent = "지금 날씨를 확인하고 있어요…";
  el.sub.textContent = "";
  el.stats.hidden = true;
  el.dayStats.hidden = true;
  el.labelTemp.textContent = "기온";
  el.labelHumid.textContent = "습도";
  el.locationLabel.textContent = label ? `${label} 확인 중…` : "위치 확인 중…";

  try {
    const params = new URLSearchParams({ lat, lon });
    if (sido) params.set("sido", sido);
    const res = await fetch(`/api/verdict?${params.toString()}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "판정 정보를 가져오지 못했습니다.");

    applyVerdictUI(data.verdict);

    el.temp.textContent = data.weather.temperature !== null ? `${data.weather.temperature}℃` : "–";
    el.humid.textContent = data.weather.humidity !== null ? `${data.weather.humidity}%` : "–";
    el.pm10.textContent = pmLabel(data.air.pm10);
    el.pm25.textContent = pmLabel(data.air.pm25);
    el.stats.hidden = false;

    el.locationLabel.textContent = `${data.location.label || label || data.location.sido} 기준`;
  } catch (err) {
    el.body.dataset.level = "YELLOW";
    el.message.textContent = "정보를 가져오지 못했어요";
    el.sub.textContent = "";
    showError(err.message);
    el.locationLabel.textContent = "위치 확인 실패";
  } finally {
    await ensureMinLoadingTime(loadStartedAt);
    setLoading(false);
  }
}

async function loadDayVerdict() {
  if (!lastCoords) return;
  const { lat, lon, sido, label } = lastCoords;
  const range = loadAwayRange();
  hideError();
  setLoading(true);
  const loadStartedAt = Date.now();
  el.body.dataset.level = "loading";
  el.message.textContent = "오늘 하루 예보를 종합하고 있어요…";
  el.sub.textContent = "";
  el.stats.hidden = true;
  el.dayStats.hidden = true;
  el.locationLabel.textContent = label ? `${label} 확인 중…` : "위치 확인 중…";

  try {
    const params = new URLSearchParams({ lat, lon, start: range.start, end: range.end });
    if (sido) params.set("sido", sido);
    const res = await fetch(`/api/day-verdict?${params.toString()}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "판정 정보를 가져오지 못했습니다.");

    applyVerdictUI(data.verdict);

    const s = data.verdict.summary;
    el.labelTemp.textContent = "최고기온";
    el.labelHumid.textContent = "고습 지속";
    el.temp.textContent = s?.maxTemp != null ? `${Math.round(s.maxTemp)}℃` : "–";
    el.humid.textContent = s?.humidHours != null ? `${s.humidHours}시간` : "–";
    el.pm10.textContent = pmLabel(data.air.pm10);
    el.pm25.textContent = pmLabel(data.air.pm25);
    el.stats.hidden = false;

    el.pop.textContent = s?.maxPop != null ? `${Math.round(s.maxPop)}%` : "–";
    el.wind.textContent = s?.avgWind != null ? `${s.avgWind.toFixed(1)}m/s` : "–";
    el.score.textContent = data.verdict.forced
      ? "탈락"
      : data.verdict.score != null
      ? `${data.verdict.score}점`
      : "–";
    el.dayStats.hidden = false;

    el.locationLabel.textContent = `${data.location.label || label || data.location.sido} · ${range.start}~${range.end} 기준`;
  } catch (err) {
    el.body.dataset.level = "YELLOW";
    el.message.textContent = "정보를 가져오지 못했어요";
    el.sub.textContent = "";
    showError(err.message);
    el.locationLabel.textContent = "위치 확인 실패";
  } finally {
    await ensureMinLoadingTime(loadStartedAt);
    setLoading(false);
  }
}

function locateByGPS() {
  if (!navigator.geolocation) {
    showError("이 브라우저는 위치 확인을 지원하지 않습니다. 직접 선택을 이용해주세요.");
    return;
  }
  setLoading(true);
  el.locationLabel.textContent = "현재 위치 확인 중…";
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      loadVerdict({
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        label: "현재 위치",
      });
    },
    () => {
      setLoading(false);
      showError("위치 권한이 없어 현재 위치를 가져올 수 없어요. 아래에서 지역을 직접 선택해주세요.");
      el.locationLabel.textContent = "위치 권한 필요";
    },
    { enableHighAccuracy: false, timeout: 8000, maximumAge: 10 * 60 * 1000 }
  );
}

el.citySelect.addEventListener("change", () => {
  const city = CITIES.find((c) => c.name === el.citySelect.value);
  if (!city) return;
  loadVerdict({ lat: city.lat, lon: city.lon, sido: city.sido, label: city.name });
});

el.locateBtn.addEventListener("click", locateByGPS);

function switchMode(newMode) {
  if (mode === newMode) return;
  mode = newMode;
  el.tabNow.classList.toggle("active", mode === "now");
  el.tabDay.classList.toggle("active", mode === "day");
  el.awaySettings.hidden = mode !== "day";
  if (mode === "day") {
    loadDayVerdict();
  } else {
    loadNowVerdict();
  }
}

el.tabNow.addEventListener("click", () => switchMode("now"));
el.tabDay.addEventListener("click", () => switchMode("day"));

const initialAway = loadAwayRange();
el.awayStart.value = initialAway.start;
el.awayEnd.value = initialAway.end;

function onAwayRangeSave() {
  const range = { start: el.awayStart.value || "08:00", end: el.awayEnd.value || "19:00" };
  saveAwayRange(range);
  if (mode === "day") loadDayVerdict();
}
el.awaySaveBtn.addEventListener("click", onAwayRangeSave);

// 미세먼지/초미세먼지 기준값 툴팁: 아이콘 탭하면 열림/닫힘 토글, 바깥 탭하면 닫힘
document.addEventListener("click", (e) => {
  const icons = document.querySelectorAll(".info-icon");
  const tappedIcon = e.target.closest(".info-icon");

  if (tappedIcon) {
    const willOpen = !tappedIcon.classList.contains("open");
    icons.forEach((i) => {
      i.classList.remove("open");
      i.blur();
    });
    if (willOpen) tappedIcon.classList.add("open");
  } else {
    icons.forEach((i) => {
      i.classList.remove("open");
      i.blur();
    });
  }
});

populateCitySelect();
locateByGPS();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.warn("서비스워커 등록 실패:", err);
    });
  });
}
