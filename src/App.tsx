import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  Globe,
  Compass,
  RotateCcw,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  X,
  Radio,
  Clock,
  Activity,
  Info,
  Filter,
  SlidersHorizontal,
  List,
  Map as MapIcon,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  Layers,
  MapPin,
  Cpu,
} from 'lucide-react';

export type PeriodKey = 'day' | 'week' | 'month';

export const PERIOD_CONFIG: Record<
  PeriodKey,
  { label: string; url: string; bannerTitle: string; description: string }
> = {
  day: {
    label: '최근 24시간',
    url: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson',
    bannerTitle: 'USGS 최근 24시간 · 규모 2.5 이상 지진 관측 자료',
    description: '최근 24시간 동안 전 세계 관측망에서 탐지된 M2.5+ 지진 피드',
  },
  week: {
    label: '최근 7일',
    url: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson',
    bannerTitle: 'USGS 최근 7일 · 규모 2.5 이상 지진 관측 자료',
    description: '최근 7일간 전 세계 관측망에서 탐지된 M2.5+ 지진 피드 (기본 데이터셋)',
  },
  month: {
    label: '최근 30일',
    url: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_month.geojson',
    bannerTitle: 'USGS 최근 30일 · 규모 2.5 이상 지진 관측 자료',
    description: '최근 30일간 전 세계 관측망에서 탐지된 M2.5+ 지진 피드',
  },
};

export type DepthFilterKey = 'all' | 'shallow' | 'intermediate' | 'deep' | 'unknown';
export type SortOrderKey = 'time_desc' | 'mag_desc';
export type MobileViewTab = 'map' | 'list' | 'both';

export const MAGNITUDE_OPTIONS = [2.5, 3.0, 3.5, 4.0, 4.5, 5.0, 5.5, 6.0, 6.5, 7.0];
const PAGE_SIZE = 10;

// ==========================================
// PLATE BOUNDARIES CONFIGURATION
// ==========================================
export type BoundaryType = 'convergent' | 'divergent' | 'transform' | 'other';

export interface BoundaryTypeConfig {
  key: BoundaryType;
  label: string;
  color: string;
  weight: number;
  dashArray?: string;
  lineStyleDesc: string;
  scientificDesc: string;
}

export const BOUNDARY_CONFIGS: Record<BoundaryType, BoundaryTypeConfig> = {
  convergent: {
    key: 'convergent',
    label: '수렴 경계',
    color: '#b91c1c', // 짙은 붉은 실선
    weight: 2.5,
    lineStyleDesc: '짙은 붉은 실선',
    scientificDesc: '판과 판이 서로 모여드는 경계 (해구·습곡 산맥)',
  },
  divergent: {
    key: 'divergent',
    label: '발산 경계',
    color: '#0f766e', // 짙은 청록색 긴 점선
    weight: 2.5,
    dashArray: '10, 8',
    lineStyleDesc: '짙은 청록색 긴 점선',
    scientificDesc: '판과 판이 서로 멀어지는 경계 (해령·열곡대)',
  },
  transform: {
    key: 'transform',
    label: '보존 경계',
    color: '#334155', // 짙은 회색 짧은 점선
    weight: 2.5,
    dashArray: '4, 4',
    lineStyleDesc: '짙은 회색 짧은 점선',
    scientificDesc: '판과 판이 어긋나며 미끄러지는 경계 (변환 단층)',
  },
  other: {
    key: 'other',
    label: '기타·미분류 경계',
    color: '#94a3b8', // 옅은 회색 점선
    weight: 1.5,
    dashArray: '3, 6',
    lineStyleDesc: '옅은 회색 점선',
    scientificDesc: '확인 중이거나 복합적인 경계대',
  },
};

export function classifyBoundary(label: string | null | undefined): BoundaryType {
  if (!label || typeof label !== 'string') return 'other';
  const trimmed = label.trim().toLowerCase();
  if (trimmed.includes('convergent')) return 'convergent';
  if (trimmed.includes('divergent')) return 'divergent';
  if (trimmed.includes('transform')) return 'transform';
  return 'other';
}

interface UsgsFeatureProperties {
  mag: number | null;
  place: string | null;
  time: number | null;
  updated: number | null;
  tz: number | null;
  url: string | null;
  detail: string | null;
  magType: string | null;
  type: string | null;
  title: string | null;
}

interface UsgsFeature {
  type: string;
  id: string;
  properties: UsgsFeatureProperties;
  geometry: {
    type: string;
    coordinates: [number, number, number?];
  };
}

interface UsgsGeoJsonResponse {
  type: string;
  metadata: {
    generated: number;
    url: string;
    title: string;
    status: number;
    api: string;
    count: number;
  };
  features: UsgsFeature[];
}

export interface EarthquakeRecord {
  id: string;
  place: string;
  mag: number | null;
  magType: string | null;
  depth: number | null;
  time: number | null;
  url: string | null;
  hasValidUrl: boolean;
  lat: number;
  lng: number;
}

interface CacheEntry {
  records: EarthquakeRecord[];
  dataGeneratedTime: number | null;
  appFetchedTime: number;
  excludedCount: number;
}

type FetchStatus = 'idle' | 'loading' | 'success' | 'error';
type PlateFetchStatus = 'idle' | 'loading' | 'success' | 'error';

function formatToKST(timestamp: number | null | undefined): string {
  if (timestamp === null || timestamp === undefined || isNaN(timestamp)) {
    return '정보 없음';
  }
  try {
    const d = new Date(timestamp);
    const formatted = new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(d);
    return `${formatted} (한국시간 KST)`;
  } catch {
    return '시각 표시 오류';
  }
}

function isValidUsgsUrl(url: string | null | undefined): boolean {
  if (!url || typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname === 'earthquake.usgs.gov';
  } catch {
    return false;
  }
}

function getMagnitudeRadius(mag: number | null): number {
  if (mag === null || mag === undefined || isNaN(mag)) {
    return 4;
  }
  return Math.max(4, Math.min(22, 4 + (mag - 2.5) * 3));
}

export interface DepthInfo {
  category: 'shallow' | 'intermediate' | 'deep' | 'unknown';
  label: string;
  textDescription: string;
  color: string;
  fillColor: string;
  badgeBg: string;
  badgeText: string;
}

function getDepthInfo(depth: number | null): DepthInfo {
  if (depth === null || depth === undefined || isNaN(depth)) {
    return {
      category: 'unknown',
      label: '깊이 정보 없음',
      textDescription: '깊이 정보 미제공',
      color: '#475569',
      fillColor: '#94a3b8',
      badgeBg: 'bg-[#f7f7f7]',
      badgeText: 'text-[#1a1a1a]',
    };
  }
  if (depth < 70) {
    return {
      category: 'shallow',
      label: '70km 미만',
      textDescription: '천발 지진 (70km 미만)',
      color: '#c2410c',
      fillColor: '#f97316',
      badgeBg: 'bg-[#fff7ed]',
      badgeText: 'text-[#9a3412]',
    };
  }
  if (depth < 300) {
    return {
      category: 'intermediate',
      label: '70km 이상 ~ 300km 미만',
      textDescription: '중발 지진 (70km 이상 ~ 300km 미만)',
      color: '#1d4ed8',
      fillColor: '#3b82f6',
      badgeBg: 'bg-[#eff6ff]',
      badgeText: 'text-[#1e40af]',
    };
  }
  return {
    category: 'deep',
    label: '300km 이상',
    textDescription: '심발 지진 (300km 이상)',
    color: '#6b21a8',
    fillColor: '#a855f7',
    badgeBg: 'bg-[#faf5ff]',
    badgeText: 'text-[#6b21a8]',
  };
}

interface EarthquakeStats {
  totalCount: number;
  shallow: number;
  intermediate: number;
  deep: number;
  unknownDepth: number;
  validMagCount: number;
  missingMagCount: number;
  maxMag: number | null;
}

export default function App() {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const earthquakeLayerRef = useRef<L.LayerGroup | null>(null);
  const plateBoundaryLayerRef = useRef<L.GeoJSON | null>(null);
  const markerMapRef = useRef<Map<string, L.CircleMarker>>(new Map());

  // Period response cache: period -> CacheEntry
  const periodCacheRef = useRef<Partial<Record<PeriodKey, CacheEntry>>>({});
  const activeRequestIdRef = useRef<number>(0);

  // Cached plate boundaries data ref
  const plateBoundariesDataRef = useRef<GeoJSON.FeatureCollection | null>(null);

  // Filter States
  const [selectedPeriod, setSelectedPeriod] = useState<PeriodKey>('week');
  const [minMag, setMinMag] = useState<number>(2.5);
  const [depthFilter, setDepthFilter] = useState<DepthFilterKey>('all');

  // List view state
  const [sortOrder, setSortOrder] = useState<SortOrderKey>('time_desc');
  const [currentPage, setCurrentPage] = useState<number>(1);

  // Mobile layout tab
  const [mobileView, setMobileView] = useState<MobileViewTab>('both');

  // Plate boundary states
  const [showPlateBoundaries, setShowPlateBoundaries] = useState<boolean>(false);
  const [plateFetchStatus, setPlateFetchStatus] = useState<PlateFetchStatus>('idle');
  const [plateErrorMessage, setPlateErrorMessage] = useState<string>('');
  const [plateCount, setPlateCount] = useState<number>(0);

  const [enabledBoundaries, setEnabledBoundaries] = useState<Record<BoundaryType, boolean>>({
    convergent: true,
    divergent: true,
    transform: true,
    other: true,
  });

  const [selectedBoundary, setSelectedBoundary] = useState<{
    name: string | null;
    boundaryType: BoundaryType;
    label: string;
  } | null>(null);

  // Data state for active period
  const [status, setStatus] = useState<FetchStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [rawEarthquakes, setRawEarthquakes] = useState<EarthquakeRecord[]>([]);
  const [selectedEarthquake, setSelectedEarthquake] = useState<EarthquakeRecord | null>(null);
  const [dataGeneratedTime, setDataGeneratedTime] = useState<number | null>(null);
  const [appFetchedTime, setAppFetchedTime] = useState<number | null>(null);
  const [excludedCount, setExcludedCount] = useState<number>(0);

  // Map viewport state
  const [mapState, setMapState] = useState<{ zoom: number; lat: number; lng: number }>({
    zoom: 2,
    lat: 20,
    lng: 0,
  });

  // Fetch earthquake data
  const fetchPeriodData = useCallback(async (period: PeriodKey, forceRefresh = false) => {
    const requestId = ++activeRequestIdRef.current;

    if (!forceRefresh && periodCacheRef.current[period]) {
      const cached = periodCacheRef.current[period]!;
      setRawEarthquakes(cached.records);
      setDataGeneratedTime(cached.dataGeneratedTime);
      setAppFetchedTime(cached.appFetchedTime);
      setExcludedCount(cached.excludedCount);
      setStatus('success');
      setErrorMessage('');
      return;
    }

    setStatus('loading');
    setErrorMessage('');

    try {
      const response = await fetch(PERIOD_CONFIG[period].url, {
        headers: { Accept: 'application/json' },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} (${response.statusText || '응답 오류'})`);
      }

      const json: UsgsGeoJsonResponse = await response.json();

      if (activeRequestIdRef.current !== requestId) {
        return;
      }

      const fetchTime = Date.now();
      const generatedTime = json.metadata?.generated ?? null;

      if (!json.features || !Array.isArray(json.features)) {
        throw new Error('유효한 GeoJSON features 목록이 아닙니다.');
      }

      let invalidCount = 0;
      const validRecords: EarthquakeRecord[] = [];

      for (const feature of json.features) {
        if (feature.properties?.type !== 'earthquake') {
          continue;
        }

        const coords = feature.geometry?.coordinates;
        const hasCoords = Array.isArray(coords) && coords.length >= 2;
        const lng = hasCoords ? coords[0] : NaN;
        const lat = hasCoords ? coords[1] : NaN;

        const isLatValid =
          typeof lat === 'number' && !isNaN(lat) && lat >= -90 && lat <= 90;
        const isLngValid =
          typeof lng === 'number' && !isNaN(lng) && lng >= -180 && lng <= 180;

        if (!isLatValid || !isLngValid) {
          invalidCount++;
          continue;
        }

        const rawDepth = hasCoords && coords.length >= 3 ? coords[2] : null;
        const depth =
          typeof rawDepth === 'number' && !isNaN(rawDepth) ? rawDepth : null;

        const rawMag = feature.properties.mag;
        const mag = typeof rawMag === 'number' && !isNaN(rawMag) ? rawMag : null;

        const place =
          typeof feature.properties.place === 'string' && feature.properties.place.trim()
            ? feature.properties.place.trim()
            : '위치 정보 없음';

        const magType =
          typeof feature.properties.magType === 'string' && feature.properties.magType.trim()
            ? feature.properties.magType.trim()
            : null;

        const rawUrl = feature.properties.url;
        const hasValidUrl = isValidUsgsUrl(rawUrl);

        validRecords.push({
          id: feature.id || `eq-${validRecords.length}`,
          place,
          mag,
          magType,
          depth,
          time: typeof feature.properties.time === 'number' ? feature.properties.time : null,
          url: hasValidUrl ? rawUrl : null,
          hasValidUrl,
          lat,
          lng,
        });
      }

      periodCacheRef.current[period] = {
        records: validRecords,
        dataGeneratedTime: generatedTime,
        appFetchedTime: fetchTime,
        excludedCount: invalidCount,
      };

      setRawEarthquakes(validRecords);
      setDataGeneratedTime(generatedTime);
      setAppFetchedTime(fetchTime);
      setExcludedCount(invalidCount);
      setStatus('success');
    } catch (err) {
      if (activeRequestIdRef.current !== requestId) {
        return;
      }
      const msg = err instanceof Error ? err.message : '네트워크 요청에 실패했습니다.';
      setErrorMessage(msg);
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    fetchPeriodData(selectedPeriod, false);
  }, [selectedPeriod, fetchPeriodData]);

  // Load Plate Boundaries
  const loadPlateBoundaries = useCallback(async () => {
    if (plateBoundariesDataRef.current) {
      return;
    }

    setPlateFetchStatus('loading');
    setPlateErrorMessage('');

    try {
      const baseUrl =
        'https://earthquake.usgs.gov/arcgis/rest/services/eq/map_plateboundaries/MapServer/1/query';
      let offset = 0;
      const allFeatures: GeoJSON.Feature[] = [];
      let hasMore = true;

      while (hasMore) {
        const queryUrl = `${baseUrl}?where=1%3D1&outFields=NAME%2CLABEL&outSR=4326&f=geojson&resultOffset=${offset}`;
        const res = await fetch(queryUrl);

        if (!res.ok) {
          throw new Error(`HTTP ${res.status} (${res.statusText || '서버 오류'})`);
        }

        const data = await res.json();

        if (data.error) {
          throw new Error(data.error.message || 'ArcGIS 서비스 오류 발생');
        }

        if (!data.features || !Array.isArray(data.features)) {
          break;
        }

        allFeatures.push(...data.features);

        if (data.exceededTransferLimit && data.features.length > 0) {
          offset += data.features.length;
        } else {
          hasMore = false;
        }
      }

      const collection: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features: allFeatures,
      };

      plateBoundariesDataRef.current = collection;
      setPlateCount(allFeatures.length);
      setPlateFetchStatus('success');
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : '판 경계 레이어를 불러오는데 실패했습니다.';
      setPlateErrorMessage(msg);
      setPlateFetchStatus('error');
    }
  }, []);

  useEffect(() => {
    if (showPlateBoundaries && !plateBoundariesDataRef.current && plateFetchStatus === 'idle') {
      loadPlateBoundaries();
    }
  }, [showPlateBoundaries, plateFetchStatus, loadPlateBoundaries]);

  // Client filtering
  const filteredEarthquakes = useMemo(() => {
    return rawEarthquakes.filter((eq) => {
      if (eq.mag === null || isNaN(eq.mag)) {
        return false;
      }
      if (eq.mag < minMag) {
        return false;
      }

      if (depthFilter === 'all') return true;
      if (depthFilter === 'shallow') {
        return eq.depth !== null && !isNaN(eq.depth) && eq.depth < 70;
      }
      if (depthFilter === 'intermediate') {
        return eq.depth !== null && !isNaN(eq.depth) && eq.depth >= 70 && eq.depth < 300;
      }
      if (depthFilter === 'deep') {
        return eq.depth !== null && !isNaN(eq.depth) && eq.depth >= 300;
      }
      if (depthFilter === 'unknown') {
        return eq.depth === null || isNaN(eq.depth);
      }
      return true;
    });
  }, [rawEarthquakes, minMag, depthFilter]);

  useEffect(() => {
    setCurrentPage(1);
  }, [selectedPeriod, minMag, depthFilter, sortOrder]);

  const sortedEarthquakes = useMemo(() => {
    const list = [...filteredEarthquakes];
    if (sortOrder === 'time_desc') {
      list.sort((a, b) => (b.time ?? 0) - (a.time ?? 0));
    } else if (sortOrder === 'mag_desc') {
      list.sort((a, b) => {
        const magA = a.mag ?? -999;
        const magB = b.mag ?? -999;
        if (magB !== magA) return magB - magA;
        return (b.time ?? 0) - (a.time ?? 0);
      });
    }
    return list;
  }, [filteredEarthquakes, sortOrder]);

  const totalPages = Math.ceil(sortedEarthquakes.length / PAGE_SIZE) || 1;
  const paginatedEarthquakes = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return sortedEarthquakes.slice(start, start + PAGE_SIZE);
  }, [sortedEarthquakes, currentPage]);

  const stats = useMemo<EarthquakeStats>(() => {
    let shallow = 0;
    let intermediate = 0;
    let deep = 0;
    let unknownDepth = 0;
    let validMagCount = 0;
    let maxMag: number | null = null;

    for (const eq of filteredEarthquakes) {
      if (eq.depth === null || isNaN(eq.depth)) {
        unknownDepth++;
      } else if (eq.depth < 70) {
        shallow++;
      } else if (eq.depth < 300) {
        intermediate++;
      } else {
        deep++;
      }

      if (typeof eq.mag === 'number' && !isNaN(eq.mag)) {
        validMagCount++;
        if (maxMag === null || eq.mag > maxMag) {
          maxMag = eq.mag;
        }
      }
    }

    return {
      totalCount: filteredEarthquakes.length,
      shallow,
      intermediate,
      deep,
      unknownDepth,
      validMagCount,
      missingMagCount: filteredEarthquakes.length - validMagCount,
      maxMag,
    };
  }, [filteredEarthquakes]);

  // Leaflet initialization
  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container) return;
    if (mapInstanceRef.current) return;

    const map = L.map(container, {
      center: [20, 0],
      zoom: 2,
      minZoom: 2,
      zoomSnap: 1,
      zoomControl: true,
      worldCopyJump: false,
    });

    mapInstanceRef.current = map;

    const plateBoundariesPane = map.createPane('plateBoundariesPane');
    plateBoundariesPane.style.zIndex = '350';

    const tileLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
    }).addTo(map);

    const earthquakeLayer = L.layerGroup().addTo(map);
    earthquakeLayerRef.current = earthquakeLayer;

    const updateMapState = () => {
      const center = map.getCenter();
      setMapState({
        zoom: Math.round(map.getZoom()),
        lat: parseFloat(center.lat.toFixed(2)),
        lng: parseFloat(center.lng.toFixed(2)),
      });
    };

    map.on('moveend', updateMapState);
    map.on('zoomend', updateMapState);

    const zoomSnap = map.options.zoomSnap ?? 1;

    const handleWheelCapture = (e: WheelEvent) => {
      if (!mapInstanceRef.current) return;
      const currentZoom = mapInstanceRef.current.getZoom();
      const minZoom = mapInstanceRef.current.getMinZoom();

      if (e.deltaY > 0 && currentZoom - zoomSnap < minZoom) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    container.addEventListener('wheel', handleWheelCapture, { capture: true, passive: false });

    const resizeTimer = setTimeout(() => {
      map.invalidateSize();
    }, 100);

    return () => {
      clearTimeout(resizeTimer);
      container.removeEventListener('wheel', handleWheelCapture, {
        capture: true,
      } as AddEventListenerOptions);
      map.off('moveend', updateMapState);
      map.off('zoomend', updateMapState);
      tileLayer.remove();
      earthquakeLayer.remove();
      if (plateBoundaryLayerRef.current) {
        plateBoundaryLayerRef.current.remove();
      }
      map.remove();
      mapInstanceRef.current = null;
      earthquakeLayerRef.current = null;
      plateBoundaryLayerRef.current = null;
    };
  }, []);

  // Update plate boundary layer on map
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (plateBoundaryLayerRef.current) {
      plateBoundaryLayerRef.current.remove();
      plateBoundaryLayerRef.current = null;
    }

    if (!showPlateBoundaries || !plateBoundariesDataRef.current) {
      return;
    }

    const geoData = plateBoundariesDataRef.current;

    const layer = L.geoJSON(geoData, {
      pane: 'plateBoundariesPane',
      filter: (feature) => {
        const type = classifyBoundary(feature?.properties?.LABEL);
        return enabledBoundaries[type];
      },
      style: (feature) => {
        const type = classifyBoundary(feature?.properties?.LABEL);
        const config = BOUNDARY_CONFIGS[type];
        return {
          color: config.color,
          weight: config.weight,
          dashArray: config.dashArray,
          opacity: 0.9,
        };
      },
      onEachFeature: (feature, lineLayer) => {
        const type = classifyBoundary(feature?.properties?.LABEL);
        const config = BOUNDARY_CONFIGS[type];
        const rawName = feature?.properties?.NAME;

        const popupDiv = document.createElement('div');
        popupDiv.className = 'font-sans p-1 text-xs text-[#1a1a1a] space-y-1 min-w-[190px]';

        const titleRow = document.createElement('div');
        titleRow.className = 'font-bold text-sm text-[#000000] border-b border-[#cccccc] pb-1 flex items-center justify-between gap-1';

        const labelText = document.createElement('span');
        labelText.textContent = config.label;
        titleRow.appendChild(labelText);

        const styleBadge = document.createElement('span');
        styleBadge.className = 'text-[10px] px-1.5 py-0.5 rounded-[2px] font-mono font-normal text-white';
        styleBadge.style.backgroundColor = config.color;
        styleBadge.textContent = config.lineStyleDesc;
        titleRow.appendChild(styleBadge);

        popupDiv.appendChild(titleRow);

        const nameRow = document.createElement('div');
        nameRow.className = 'text-xs text-[#1a1a1a] leading-snug pt-0.5';
        if (rawName && typeof rawName === 'string' && rawName.trim()) {
          nameRow.textContent = `원문 이름(NAME): ${rawName.trim()}`;
        } else {
          nameRow.textContent = '원문 이름: 정보 없음';
        }
        popupDiv.appendChild(nameRow);

        const descRow = document.createElement('div');
        descRow.className = 'text-[11px] text-[#757575]';
        descRow.textContent = config.scientificDesc;
        popupDiv.appendChild(descRow);

        lineLayer.bindPopup(popupDiv);

        lineLayer.on('click', () => {
          setSelectedBoundary({
            name: rawName && typeof rawName === 'string' && rawName.trim() ? rawName.trim() : null,
            boundaryType: type,
            label: config.label,
          });
        });
      },
    });

    layer.addTo(map);
    plateBoundaryLayerRef.current = layer;
  }, [showPlateBoundaries, enabledBoundaries, plateFetchStatus]);

  // Update map markers
  useEffect(() => {
    const layer = earthquakeLayerRef.current;
    if (!layer) return;

    layer.clearLayers();
    markerMapRef.current.clear();

    filteredEarthquakes.forEach((eq) => {
      const radius = getMagnitudeRadius(eq.mag);
      const depthInfo = getDepthInfo(eq.depth);

      const marker = L.circleMarker([eq.lat, eq.lng], {
        radius,
        color: depthInfo.color,
        fillColor: depthInfo.fillColor,
        fillOpacity: 0.8,
        weight: 1.5,
      });

      const popupDiv = document.createElement('div');
      popupDiv.className = 'font-sans p-1 text-xs text-[#1a1a1a] space-y-1.5 min-w-[200px]';

      const headerRow = document.createElement('div');
      headerRow.className = 'flex items-center justify-between gap-2 border-b border-[#cccccc] pb-1';

      const magEl = document.createElement('span');
      magEl.className = 'font-bold text-sm text-[#000000]';
      magEl.textContent = eq.mag !== null ? `M ${eq.mag.toFixed(1)}` : '규모: 값 없음';
      headerRow.appendChild(magEl);

      const depthTag = document.createElement('span');
      depthTag.className = 'text-[10px] px-1.5 py-0.5 rounded-[2px] font-semibold text-white';
      depthTag.style.backgroundColor = depthInfo.color;
      depthTag.textContent = depthInfo.label;
      headerRow.appendChild(depthTag);

      popupDiv.appendChild(headerRow);

      const placeEl = document.createElement('div');
      placeEl.className = 'font-bold text-[#1a1a1a] leading-snug';
      placeEl.textContent = eq.place;
      popupDiv.appendChild(placeEl);

      const depthLine = document.createElement('div');
      depthLine.className = 'text-[#757575] text-[11px]';
      if (eq.depth !== null) {
        depthLine.textContent = `깊이: ${eq.depth.toFixed(1)} km · ${depthInfo.textDescription}`;
      } else {
        depthLine.textContent = '깊이: 정보 없음';
      }
      popupDiv.appendChild(depthLine);

      const timeEl = document.createElement('div');
      timeEl.className = 'text-[#757575] text-[11px] font-mono';
      timeEl.textContent = formatToKST(eq.time);
      popupDiv.appendChild(timeEl);

      marker.bindPopup(popupDiv);

      marker.on('click', () => {
        setSelectedEarthquake(eq);
      });

      marker.addTo(layer);
      markerMapRef.current.set(eq.id, marker);
    });
  }, [filteredEarthquakes]);

  const handleResetView = () => {
    if (mapInstanceRef.current) {
      mapInstanceRef.current.setView([20, 0], 2, { animate: true });
    }
  };

  const handleSelectAndFocus = useCallback(
    (eq: EarthquakeRecord) => {
      setSelectedEarthquake(eq);
      if (mapInstanceRef.current) {
        mapInstanceRef.current.setView([eq.lat, eq.lng], Math.max(mapState.zoom, 5), {
          animate: true,
        });
        const marker = markerMapRef.current.get(eq.id);
        if (marker) {
          marker.openPopup();
        }
      }
      if (mobileView === 'list') {
        setMobileView('map');
      }
    },
    [mapState.zoom, mobileView]
  );

  const handleResetFilters = () => {
    setSelectedPeriod('week');
    setMinMag(2.5);
    setDepthFilter('all');
  };

  const isFilterModified =
    selectedPeriod !== 'week' || minMag !== 2.5 || depthFilter !== 'all';

  const handleRefreshCurrentPeriod = () => {
    fetchPeriodData(selectedPeriod, true);
  };

  const startIndex = (currentPage - 1) * PAGE_SIZE;
  const endIndex = Math.min(startIndex + PAGE_SIZE, sortedEarthquakes.length);

  return (
    <div className="min-h-screen bg-[#ffffff] text-[#1a1a1a] flex flex-col font-sans antialiased selection:bg-[#76b900] selection:text-black">
      {/* ========================================================================= */}
      {/* 1. NVIDIA UTILITY BAR (Surface Dark #000000, 32px) */}
      {/* ========================================================================= */}
      <div className="bg-[#000000] text-white border-b border-[#5e5e5e] text-[11px] font-bold tracking-wider uppercase">
        <div className="max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 h-8 flex items-center justify-between">
          <div className="flex items-center gap-2 text-[#76b900]">
            <Cpu className="w-3.5 h-3.5" />
            <span>EARTH SCIENCE OBSERVATION PLATFORM</span>
          </div>
          <div className="flex items-center gap-4 text-[#a7a7a7] text-[10px]">
            <span>중학교 과학 실시간 관측 시스템</span>
            <span className="text-[#5e5e5e]">|</span>
            <span className="text-white">USGS REAL-TIME GEOJSON FEED</span>
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 2. HERO CHAPTER (Surface Dark #000000, Angular Geometry, Green Accents) */}
      {/* ========================================================================= */}
      <header className="bg-[#000000] text-white border-b border-[#5e5e5e] relative">
        <div className="max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10">
          <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6">
            <div className="max-w-3xl space-y-3">
              {/* Eyebrow badge tag */}
              <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-[2px] bg-[#1a1a1a] border border-[#5e5e5e] text-xs font-bold uppercase text-[#76b900]">
                <span className="w-2 h-2 bg-[#76b900] rounded-none"></span>
                <span>판 구조론 · 지권의 변화 탐구 시스템</span>
              </div>

              <h1 className="text-3xl sm:text-4xl lg:text-5xl font-black tracking-tight text-white uppercase leading-none">
                지구의 지진 탐험
              </h1>

              <p className="text-base sm:text-lg text-[#a7a7a7] font-normal leading-relaxed">
                전 세계 실시간 지진 관측 데이터와 Tectonic Plate Boundaries 모델을 중첩하여 판의 경계와 지진 발생 메커니즘을 정밀하게 분석합니다.
              </p>
            </div>

            {/* Hero CTAs */}
            <div className="flex items-center gap-3 flex-wrap shrink-0">
              <button
                type="button"
                onClick={handleResetView}
                className="h-11 px-4 text-sm font-bold text-white bg-transparent border border-white hover:bg-white/10 active:bg-white/20 rounded-[2px] transition-colors cursor-pointer flex items-center gap-2"
                title="지도를 기본 위치(위도 20°, 경도 0°, 확대 2)로 재설정합니다"
              >
                <RotateCcw className="w-4 h-4" />
                <span>기본 위치</span>
              </button>

              <button
                type="button"
                onClick={handleRefreshCurrentPeriod}
                disabled={status === 'loading'}
                className="h-11 px-6 text-sm font-bold text-black bg-[#76b900] hover:bg-[#5a8d00] active:bg-[#487000] disabled:bg-[#5e5e5e] disabled:text-[#a7a7a7] disabled:cursor-not-allowed rounded-[2px] transition-colors cursor-pointer flex items-center gap-2 shadow-none"
                title="현재 선택한 기간의 USGS 지진 데이터를 새로 수신합니다"
              >
                <RefreshCw className={`w-4 h-4 ${status === 'loading' ? 'animate-spin' : ''}`} />
                <span>{status === 'loading' ? '데이터 수신 중...' : '데이터 새로고침'}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Hero subtle green baseline accent rule */}
        <div className="w-full h-1 bg-[#76b900]"></div>
      </header>

      {/* ========================================================================= */}
      {/* 3. BODY CANVAS (#ffffff, 2px radius, hairline borders, corner squares) */}
      {/* ========================================================================= */}
      <main className="flex-1 max-w-[1280px] w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 flex flex-col gap-6">
        {/* Editorial Sub-nav / Breadcrumb strip */}
        <div className="bg-[#f7f7f7] border border-[#cccccc] rounded-[2px] px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 text-[#1a1a1a] font-bold">
            <Radio className="w-4 h-4 text-[#76b900] shrink-0 animate-pulse" />
            <span className="text-sm font-bold uppercase tracking-tight">
              {PERIOD_CONFIG[selectedPeriod].bannerTitle}
            </span>
          </div>
          <p className="text-[11px] text-[#757575] sm:max-w-xl">
            ※ 미국 지질조사국(USGS) 관측망에서 탐지된 M2.5+ 지진 자료이며, 전 세계의 모든 미소 지진을 빠짐없이 수록한 것은 아닙니다.
          </p>
        </div>

        {/* Timestamps & Overall Feed Status Bar */}
        <div className="bg-[#ffffff] border border-[#cccccc] rounded-[2px] px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <Clock className="w-3.5 h-3.5 text-[#757575]" />
              <span className="font-bold text-[#757575] uppercase text-[10px]">USGS 데이터 생성:</span>
              <span className="font-mono font-bold text-[#1a1a1a]">
                {dataGeneratedTime ? formatToKST(dataGeneratedTime) : '수신 대기 중'}
              </span>
            </div>
            <span className="text-[#cccccc] hidden sm:inline">|</span>
            <div className="flex items-center gap-2">
              <Activity className="w-3.5 h-3.5 text-[#757575]" />
              <span className="font-bold text-[#757575] uppercase text-[10px]">앱 수신 시각:</span>
              <span className="font-mono font-bold text-[#1a1a1a]">
                {appFetchedTime ? formatToKST(appFetchedTime) : '수신 대기 중'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {status === 'loading' && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[2px] text-xs font-bold bg-[#f7f7f7] text-[#1a1a1a] border border-[#cccccc]">
                <RefreshCw className="w-3 h-3 animate-spin text-[#76b900]" />
                지진 피드 로딩 중...
              </span>
            )}
            {status === 'success' && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[2px] text-xs font-bold bg-[#000000] text-white">
                <CheckCircle2 className="w-3.5 h-3.5 text-[#76b900]" />
                지진 수신 {rawEarthquakes.length.toLocaleString()}건
                {excludedCount > 0 && ` (좌표 제외 ${excludedCount}건)`}
              </span>
            )}
            {status === 'error' && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[2px] text-xs font-bold bg-[#650b0b] text-white">
                <AlertTriangle className="w-3.5 h-3.5 text-[#e52020]" />
                지진 네트워크 실패
              </span>
            )}
          </div>
        </div>

        {/* Network Error Banner for Earthquakes */}
        {status === 'error' && (
          <div className="bg-[#ffffff] border-2 border-[#e52020] rounded-[2px] p-5 text-sm text-[#1a1a1a] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 relative">
            <div className="absolute top-0 left-0 w-3 h-3 bg-[#e52020]"></div>
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-[#e52020] shrink-0 mt-0.5" />
              <div>
                <p className="font-bold text-base text-[#000000]">지진 데이터를 불러오지 못했습니다.</p>
                <p className="text-xs text-[#757575] mt-0.5">
                  원인: {errorMessage || '네트워크 연결이 불안정하거나 USGS 서비스에 일시적인 장애가 있습니다.'}
                </p>
                <p className="text-xs text-[#1a1a1a] mt-1 font-semibold">
                  API 실패를 0건으로 처리하지 않으며, 가상 데이터를 임의로 넣지 않습니다.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleRefreshCurrentPeriod}
              className="h-10 px-5 text-xs font-bold text-white bg-[#000000] hover:bg-[#1a1a1a] border border-[#000000] rounded-[2px] transition-colors shrink-0 cursor-pointer"
            >
              다시 시도
            </button>
          </div>
        )}

        {/* ========================================================================= */}
        {/* 4. SUMMARY STATS GRID (Callout-Stats with Signature Corner Squares) */}
        {/* ========================================================================= */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {/* Card 1: Filtered Total Count */}
          <div className="bg-[#ffffff] rounded-[2px] border border-[#cccccc] p-5 relative flex flex-col justify-between">
            <div className="absolute top-0 left-0 w-3 h-3 bg-[#76b900]"></div>
            <span className="text-[11px] font-bold text-[#757575] uppercase tracking-wider block mb-2">
              조건 부합 지진 수
            </span>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl sm:text-4xl font-black text-[#000000] font-mono leading-none">
                {stats.totalCount.toLocaleString()}
              </span>
              <span className="text-xs font-bold text-[#757575]">건</span>
            </div>
            <span className="text-[11px] text-[#898989] block mt-2 border-t border-[#f7f7f7] pt-2">
              수신 전체 {rawEarthquakes.length.toLocaleString()}건 중
            </span>
          </div>

          {/* Card 2: Max Magnitude */}
          <div className="bg-[#ffffff] rounded-[2px] border border-[#cccccc] p-5 relative flex flex-col justify-between">
            <div className="absolute top-0 left-0 w-3 h-3 bg-[#76b900]"></div>
            <span className="text-[11px] font-bold text-[#757575] uppercase tracking-wider block mb-2 flex items-center justify-between">
              <span>최대 규모 (Max Mag)</span>
              <TrendingUp className="w-3.5 h-3.5 text-[#76b900]" />
            </span>
            <div className="flex items-baseline gap-2">
              <span
                className={`text-3xl sm:text-4xl font-black font-mono leading-none ${
                  stats.maxMag !== null ? 'text-[#000000]' : 'text-[#898989] text-xl'
                }`}
              >
                {stats.maxMag !== null ? `M ${stats.maxMag.toFixed(1)}` : '해당 없음'}
              </span>
            </div>
            <span className="text-[11px] text-[#898989] block mt-2 border-t border-[#f7f7f7] pt-2">
              {stats.validMagCount > 0
                ? `유효 규모 ${stats.validMagCount}건 중 최댓값`
                : '조건 내 유효 지진 없음'}
            </span>
          </div>

          {/* Card 3: Depth Breakdown */}
          <div className="bg-[#ffffff] rounded-[2px] border border-[#cccccc] p-5 relative col-span-2 md:col-span-1 flex flex-col justify-between">
            <div className="absolute top-0 left-0 w-3 h-3 bg-[#76b900]"></div>
            <span className="text-[11px] font-bold text-[#757575] uppercase tracking-wider block mb-2">
              진원 깊이 구간별 분포
            </span>
            <div className="grid grid-cols-3 gap-1.5 text-[11px] font-mono mt-1">
              <div className="bg-[#f7f7f7] border border-[#cccccc] p-1.5 rounded-[2px] text-center">
                <span className="text-[#c2410c] block font-bold text-xs">{stats.shallow}</span>
                <span className="text-[9px] text-[#757575] uppercase">천발(&lt;70)</span>
              </div>
              <div className="bg-[#f7f7f7] border border-[#cccccc] p-1.5 rounded-[2px] text-center">
                <span className="text-[#1d4ed8] block font-bold text-xs">{stats.intermediate}</span>
                <span className="text-[9px] text-[#757575] uppercase">중발(&lt;300)</span>
              </div>
              <div className="bg-[#f7f7f7] border border-[#cccccc] p-1.5 rounded-[2px] text-center">
                <span className="text-[#6b21a8] block font-bold text-xs">{stats.deep}</span>
                <span className="text-[9px] text-[#757575] uppercase">심발(300+)</span>
              </div>
            </div>
            <span className="text-[10px] text-[#898989] block mt-2 border-t border-[#f7f7f7] pt-2">
              {stats.unknownDepth > 0 ? `깊이 정보 없음: ${stats.unknownDepth}건` : '전체 깊이 유효 식별'}
            </span>
          </div>

          {/* Card 4: Plate Boundary Toggle */}
          <div className="bg-[#ffffff] rounded-[2px] border border-[#cccccc] p-5 relative col-span-2 md:col-span-1 flex flex-col justify-between">
            <div className="absolute top-0 left-0 w-3 h-3 bg-[#76b900]"></div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-bold text-[#757575] uppercase tracking-wider">
                판 경계 모델
              </span>
              <button
                type="button"
                onClick={() => setShowPlateBoundaries((prev) => !prev)}
                className={`px-3 py-1 rounded-[2px] text-xs font-bold uppercase transition-colors cursor-pointer ${
                  showPlateBoundaries
                    ? 'bg-[#76b900] text-black hover:bg-[#5a8d00]'
                    : 'bg-[#000000] text-white hover:bg-[#1a1a1a]'
                }`}
              >
                {showPlateBoundaries ? '표시 ON' : '표시 OFF'}
              </button>
            </div>
            <div>
              <p className="text-xs font-bold text-[#1a1a1a]">
                {showPlateBoundaries
                  ? plateFetchStatus === 'loading'
                    ? 'USGS 레이어 수신 중...'
                    : plateFetchStatus === 'error'
                    ? '판 경계 로딩 실패'
                    : `경계 세그먼트 ${plateCount.toLocaleString()}개 활성`
                  : '기본값: OFF (선택 시 로드)'}
              </p>
              <p className="text-[10px] text-[#898989] mt-1">
                ※ 판 경계 표시 여부는 지진 목록 개수에 영향을 주지 않습니다.
              </p>
            </div>
          </div>
        </section>

        {/* ========================================================================= */}
        {/* 5. FILTER CONTROL CARD (NVIDIA Form & Tab Architecture) */}
        {/* ========================================================================= */}
        <section className="bg-[#ffffff] rounded-[2px] border border-[#cccccc] p-5 relative">
          <div className="absolute top-0 left-0 w-3 h-3 bg-[#76b900]"></div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#cccccc] pb-4 mb-5">
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-[#76b900]" />
              <h2 className="text-base font-bold text-[#000000] uppercase tracking-tight">
                지진 데이터 필터 컨트롤
              </h2>
              <span className="text-xs text-[#757575]">
                (지도·목록·요약 카드가 동일한 필터 결과를 공유합니다)
              </span>
            </div>

            <button
              type="button"
              onClick={handleResetFilters}
              disabled={!isFilterModified}
              className="h-9 px-4 text-xs font-bold rounded-[2px] border transition-colors self-start sm:self-auto cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed text-[#1a1a1a] bg-[#f7f7f7] hover:bg-[#e5e5e5] border-[#cccccc] flex items-center gap-1.5"
              title="최근 7일, 최소 규모 2.5, 깊이 전체로 되돌립니다"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>조건 초기화 (최근 7일 · M2.5+ · 깊이 전체)</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* 1. Period Selector (NVIDIA Pill-Tab Segmented Style) */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-[#1a1a1a] uppercase tracking-wider flex items-center justify-between">
                <span>1. 관측 기간 선택</span>
                <span className="text-[10px] text-[#757575] font-normal">선택 시 캐시 활용</span>
              </label>

              <div className="grid grid-cols-3 gap-1 bg-[#f7f7f7] p-1 rounded-[2px] border border-[#cccccc]">
                {(['day', 'week', 'month'] as PeriodKey[]).map((periodKey) => {
                  const isSelected = selectedPeriod === periodKey;
                  return (
                    <button
                      key={periodKey}
                      type="button"
                      onClick={() => setSelectedPeriod(periodKey)}
                      className={`py-2 px-2 text-xs font-bold rounded-[2px] transition-all cursor-pointer text-center ${
                        isSelected
                          ? 'bg-[#000000] text-white shadow-none'
                          : 'text-[#1a1a1a] hover:bg-[#e5e5e5]'
                      }`}
                    >
                      {PERIOD_CONFIG[periodKey].label}
                      {periodKey === 'week' && <span className="text-[9px] block text-[#76b900]">(기본)</span>}
                    </button>
                  );
                })}
              </div>
              <p className="text-[11px] text-[#757575]">
                {PERIOD_CONFIG[selectedPeriod].description}
              </p>
            </div>

            {/* 2. Minimum Magnitude Filter */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-[#1a1a1a] uppercase tracking-wider flex items-center gap-1.5">
                  <SlidersHorizontal className="w-3.5 h-3.5 text-[#76b900]" />
                  <span>2. 최소 규모 (Magnitude)</span>
                </label>
                <span className="font-mono text-xs font-bold text-[#000000] bg-[#76b900] px-2 py-0.5 rounded-[2px]">
                  M {minMag.toFixed(1)} 이상
                </span>
              </div>

              <div className="relative">
                <select
                  value={minMag}
                  onChange={(e) => setMinMag(parseFloat(e.target.value))}
                  className="w-full h-10 px-3 bg-[#ffffff] border border-[#cccccc] rounded-[2px] text-xs font-bold text-[#1a1a1a] focus:outline-hidden focus:border-2 focus:border-[#76b900] cursor-pointer"
                >
                  {MAGNITUDE_OPTIONS.map((val) => (
                    <option key={val} value={val}>
                      규모 {val.toFixed(1)} 이상 {val === 2.5 ? '(피드 전체 · 기본값)' : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                {[2.5, 4.0, 5.0, 6.0].map((val) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setMinMag(val)}
                    className={`px-2.5 py-1 rounded-[2px] text-xs font-mono transition-colors cursor-pointer border ${
                      minMag === val
                        ? 'bg-[#000000] text-white border-[#000000] font-bold'
                        : 'bg-[#f7f7f7] text-[#1a1a1a] border-[#cccccc] hover:bg-[#e5e5e5]'
                    }`}
                  >
                    M{val.toFixed(1)}+
                  </button>
                ))}
              </div>
            </div>

            {/* 3. Depth Filter */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-[#1a1a1a] uppercase tracking-wider block">
                3. 진원 발생 깊이 (Depth)
              </label>
              <div className="relative">
                <select
                  value={depthFilter}
                  onChange={(e) => setDepthFilter(e.target.value as DepthFilterKey)}
                  className="w-full h-10 px-3 bg-[#ffffff] border border-[#cccccc] rounded-[2px] text-xs font-bold text-[#1a1a1a] focus:outline-hidden focus:border-2 focus:border-[#76b900] cursor-pointer"
                >
                  <option value="all">전체 깊이 (천발·중발·심발 모두 포함)</option>
                  <option value="shallow">70km 미만 (천발 지진 · 주황색)</option>
                  <option value="intermediate">70km 이상 ~ 300km 미만 (중발 지진 · 파란색)</option>
                  <option value="deep">300km 이상 (심발 지진 · 보라색)</option>
                  <option value="unknown">깊이 정보 없음 (회색)</option>
                </select>
              </div>
              <p className="text-[11px] text-[#757575]">
                판 구조론 수업에서 깊이에 따른 섭입대 분포 비교 시 활용
              </p>
            </div>
          </div>

          <div className="mt-5 pt-3 border-t border-[#cccccc] bg-[#f7f7f7] rounded-[2px] p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-[#000000]">
                현재 조건 부합 지진:{' '}
                <span className="text-sm font-black text-[#000000] font-mono bg-[#76b900] px-2 py-0.5 rounded-[2px]">
                  {filteredEarthquakes.length.toLocaleString()}건
                </span>
              </span>
              <span className="text-[#cccccc]">/</span>
              <span className="text-[#757575]">
                선택 기간 전체 수신: {rawEarthquakes.length.toLocaleString()}건
              </span>
            </div>
            <p className="text-[11px] text-[#757575] italic">
              ※ 이 수치는 현재 지도 화면 안쪽의 개수가 아니라 선택한 기간·규모·깊이 조건 전체의 개수입니다.
            </p>
          </div>
        </section>

        {/* Zero Results Notice Banner */}
        {status === 'success' && filteredEarthquakes.length === 0 && (
          <div className="bg-[#ffffff] border-2 border-[#df6500] rounded-[2px] p-5 text-center text-sm text-[#1a1a1a] relative">
            <div className="absolute top-0 left-0 w-3 h-3 bg-[#df6500]"></div>
            <div className="flex items-center justify-center gap-2 font-bold text-base text-[#df6500] mb-1">
              <AlertTriangle className="w-5 h-5 text-[#df6500]" />
              <span>현재 조건에 맞는 지진이 없습니다. 기간을 늘리거나 최소 규모를 낮춰 보세요.</span>
            </div>
            <p className="text-xs text-[#757575] mt-1">
              선택한 {PERIOD_CONFIG[selectedPeriod].label} 동안 규모 M{minMag.toFixed(1)} 이상, 지정한 깊이 조건에 부합하는 관측 결과가 존재하지 않습니다.
            </p>
            <div className="mt-4">
              <button
                type="button"
                onClick={handleResetFilters}
                className="h-10 px-6 text-xs font-bold text-black bg-[#76b900] hover:bg-[#5a8d00] rounded-[2px] transition-colors cursor-pointer"
              >
                기본 조건으로 재설정 (최근 7일 · M2.5+ · 깊이 전체)
              </button>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* 6. PLATE BOUNDARIES CONTROLS & SCIENTIFIC DISCLAIMER */}
        {/* ========================================================================= */}
        <section className="bg-[#ffffff] rounded-[2px] border border-[#cccccc] p-5 relative">
          <div className="absolute top-0 left-0 w-3 h-3 bg-[#76b900]"></div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#cccccc] pb-4 mb-4">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-[#76b900]" />
              <h2 className="text-base font-bold text-[#000000] uppercase tracking-tight">
                판 경계 레이어 제어 (Tectonic Plate Boundaries)
              </h2>
            </div>

            {/* Master Toggle */}
            <div className="flex items-center gap-3">
              <label className="inline-flex items-center gap-2 cursor-pointer text-xs sm:text-sm font-bold text-[#1a1a1a]">
                <input
                  type="checkbox"
                  checked={showPlateBoundaries}
                  onChange={(e) => setShowPlateBoundaries(e.target.checked)}
                  className="w-4 h-4 text-[#76b900] rounded-[2px] border-[#cccccc] focus:ring-[#76b900] cursor-pointer"
                />
                <span>판 경계선 전체 지도 표시</span>
              </label>

              {showPlateBoundaries && (
                <div className="text-xs">
                  {plateFetchStatus === 'loading' && (
                    <span className="inline-flex items-center gap-1.5 text-black bg-[#f7f7f7] px-2.5 py-1 rounded-[2px] border border-[#cccccc] font-bold">
                      <RefreshCw className="w-3 h-3 animate-spin text-[#76b900]" />
                      전체 데이터 수신 중...
                    </span>
                  )}
                  {plateFetchStatus === 'success' && (
                    <span className="inline-flex items-center gap-1.5 text-black bg-[#76b900] px-2.5 py-1 rounded-[2px] font-bold">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      {plateCount.toLocaleString()}개 선 로드 완료
                    </span>
                  )}
                  {plateFetchStatus === 'error' && (
                    <button
                      type="button"
                      onClick={loadPlateBoundaries}
                      className="inline-flex items-center gap-1 text-white bg-[#e52020] hover:bg-[#650b0b] px-2.5 py-1 rounded-[2px] font-bold cursor-pointer"
                    >
                      <AlertTriangle className="w-3 h-3" />
                      재시도
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Sub-type Selection Toggles */}
          <div
            className={`transition-opacity duration-200 ${
              showPlateBoundaries ? 'opacity-100' : 'opacity-40 pointer-events-none'
            }`}
          >
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              {(['convergent', 'divergent', 'transform', 'other'] as BoundaryType[]).map(
                (boundaryKey) => {
                  const cfg = BOUNDARY_CONFIGS[boundaryKey];
                  const isChecked = enabledBoundaries[boundaryKey];

                  return (
                    <label
                      key={boundaryKey}
                      className={`flex items-start gap-2.5 p-3 rounded-[2px] border transition-all cursor-pointer ${
                        isChecked && showPlateBoundaries
                          ? 'bg-[#ffffff] border-[#000000]'
                          : 'bg-[#f7f7f7] border-[#cccccc]'
                      }`}
                    >
                      <input
                        type="checkbox"
                        disabled={!showPlateBoundaries}
                        checked={isChecked}
                        onChange={(e) =>
                          setEnabledBoundaries((prev) => ({
                            ...prev,
                            [boundaryKey]: e.target.checked,
                          }))
                        }
                        className="mt-0.5 w-4 h-4 rounded-[2px] text-[#76b900] border-[#cccccc] focus:ring-[#76b900] cursor-pointer"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span
                            className="inline-block w-4 h-0.5"
                            style={{
                              backgroundColor: cfg.color,
                              borderTop: cfg.dashArray
                                ? `2px dashed ${cfg.color}`
                                : `2px solid ${cfg.color}`,
                            }}
                          ></span>
                          <span className="font-bold text-xs text-[#000000]">{cfg.label}</span>
                        </div>
                        <span className="text-[10px] text-[#757575] block mt-0.5 font-mono">
                          {cfg.lineStyleDesc}
                        </span>
                      </div>
                    </label>
                  );
                }
              )}
            </div>
          </div>

          {/* Required Scientific Guidance and Source Notices */}
          <div className="p-3 bg-[#f7f7f7] rounded-[2px] border border-[#cccccc] text-xs text-[#1a1a1a] space-y-1.5">
            <p className="font-bold text-[#000000]">
              📌 판 경계 학습 안내: 판 경계는 참고 모델입니다. 지진은 판 내부에서도 발생할 수 있으며, 이 지도는 미래 지진을 예측하지 않습니다.
            </p>
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#757575] pt-1.5 border-t border-[#cccccc]">
              <span>
                자료 출처: <strong>USGS Tectonic Plate Boundaries</strong> (원자료: <strong>Peter Bird, 2003</strong>, <em>An updated digital model of plate boundaries</em>)
              </span>
              <a
                href="https://earthquake.usgs.gov/arcgis/rest/services/eq/map_plateboundaries/MapServer"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[#0046a4] hover:underline font-bold"
              >
                <span>USGS 공식 서비스 페이지</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>
        </section>

        {/* Selected Plate Boundary Card */}
        {selectedBoundary && (
          <div className="bg-[#ffffff] border border-[#000000] rounded-[2px] p-4 text-xs text-[#1a1a1a] flex items-start justify-between gap-3 relative">
            <div className="absolute top-0 left-0 w-3 h-3 bg-[#76b900]"></div>
            <div className="space-y-1 pl-2">
              <div className="flex items-center gap-2">
                <span className="font-bold text-sm text-[#000000] uppercase">
                  선택한 판 경계선 제원
                </span>
                <span className="px-2 py-0.5 rounded-[2px] text-[11px] font-bold bg-[#000000] text-white">
                  {selectedBoundary.label}
                </span>
              </div>
              <p className="text-xs text-[#1a1a1a] font-mono">
                원문 이름(NAME):{' '}
                <strong className="text-[#000000] font-sans">
                  {selectedBoundary.name || '원문 이름 없음'}
                </strong>
              </p>
              <p className="text-[11px] text-[#757575]">
                {BOUNDARY_CONFIGS[selectedBoundary.boundaryType].scientificDesc} (원자료에 없는 판 이동 속도나 수렴 화살표 등은 임의로 그리지 않습니다)
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSelectedBoundary(null)}
              className="p-1 text-[#757575] hover:text-[#000000] hover:bg-[#f7f7f7] rounded-[2px] transition-colors cursor-pointer"
              title="닫기"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Mobile View Toggle Switch */}
        <div className="lg:hidden flex items-center justify-center bg-[#f7f7f7] border border-[#cccccc] p-1 rounded-[2px] gap-1">
          <button
            type="button"
            onClick={() => setMobileView('both')}
            className={`flex-1 py-2 text-xs font-bold rounded-[2px] transition-all text-center cursor-pointer ${
              mobileView === 'both' ? 'bg-[#000000] text-white' : 'text-[#1a1a1a]'
            }`}
          >
            함께 보기
          </button>
          <button
            type="button"
            onClick={() => setMobileView('map')}
            className={`flex-1 py-2 text-xs font-bold rounded-[2px] transition-all text-center cursor-pointer flex items-center justify-center gap-1.5 ${
              mobileView === 'map' ? 'bg-[#000000] text-white' : 'text-[#1a1a1a]'
            }`}
          >
            <MapIcon className="w-3.5 h-3.5" />
            <span>지도만 보기</span>
          </button>
          <button
            type="button"
            onClick={() => setMobileView('list')}
            className={`flex-1 py-2 text-xs font-bold rounded-[2px] transition-all text-center cursor-pointer flex items-center justify-center gap-1.5 ${
              mobileView === 'list' ? 'bg-[#000000] text-white' : 'text-[#1a1a1a]'
            }`}
          >
            <List className="w-3.5 h-3.5" />
            <span>목록만 보기 ({filteredEarthquakes.length})</span>
          </button>
        </div>

        {/* ========================================================================= */}
        {/* 7. MAIN DISPLAY: Map (Left) + List & Legends (Right) */}
        {/* ========================================================================= */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Map Column (7 of 12 columns) */}
          <div
            className={`lg:col-span-7 flex flex-col gap-6 ${
              mobileView === 'list' ? 'hidden lg:flex' : 'flex'
            }`}
          >
            <div className="bg-[#ffffff] rounded-[2px] border border-[#cccccc] overflow-hidden flex flex-col relative">
              {/* Map Top Bar */}
              <div className="px-4 py-3 bg-[#000000] text-white border-b border-[#5e5e5e] flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2">
                  <Compass className="w-4 h-4 text-[#76b900]" />
                  <span className="font-bold uppercase tracking-wider text-white">세계 지진 및 판 경계 지도</span>
                  <span className="text-[#5e5e5e]">|</span>
                  <span className="text-[11px] text-[#a7a7a7]">
                    지진 원 및 판 경계선을 클릭하여 상세 정보 확인
                  </span>
                </div>

                <div className="flex items-center gap-3 font-mono text-xs text-[#a7a7a7] bg-[#1a1a1a] px-3 py-1 rounded-[2px] border border-[#5e5e5e]">
                  <span>
                    중심: {mapState.lat >= 0 ? `${mapState.lat}°N` : `${Math.abs(mapState.lat)}°S`},{' '}
                    {mapState.lng >= 0 ? `${mapState.lng}°E` : `${Math.abs(mapState.lng)}°W`}
                  </span>
                  <span className="text-[#5e5e5e]">|</span>
                  <span className="text-[#76b900] font-bold">확대 Lv.{mapState.zoom}</span>
                </div>
              </div>

              {/* Leaflet Map Div */}
              <div className="relative w-full h-[470px] sm:h-[570px] lg:h-[640px] bg-[#f7f7f7]">
                <div
                  ref={mapContainerRef}
                  className="w-full h-full"
                  style={{ minHeight: '440px' }}
                />
              </div>
            </div>

            {/* SEPARATE LEGENDS */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {/* 1. Depth Color Legend */}
              <div className="bg-[#ffffff] rounded-[2px] border border-[#cccccc] p-4 relative">
                <div className="absolute top-0 left-0 w-3 h-3 bg-[#76b900]"></div>
                <div className="flex items-center justify-between border-b border-[#cccccc] pb-2 mb-3">
                  <h3 className="text-xs font-bold text-[#000000] uppercase tracking-wider">
                    지진 깊이 색상
                  </h3>
                  <span className="text-[10px] text-[#757575]">지하 발생 깊이</span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div className="flex items-center gap-2 p-1.5 rounded-[2px] bg-[#f7f7f7] border border-[#cccccc]">
                    <span className="w-3.5 h-3.5 rounded-full bg-[#f97316] shrink-0"></span>
                    <div>
                      <span className="font-bold text-[#000000] block text-[10px]">&lt;70km</span>
                      <span className="text-[9px] text-[#757575]">천발({stats.shallow})</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 p-1.5 rounded-[2px] bg-[#f7f7f7] border border-[#cccccc]">
                    <span className="w-3.5 h-3.5 rounded-full bg-[#3b82f6] shrink-0"></span>
                    <div>
                      <span className="font-bold text-[#000000] block text-[10px]">70~300km</span>
                      <span className="text-[9px] text-[#757575]">중발({stats.intermediate})</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 p-1.5 rounded-[2px] bg-[#f7f7f7] border border-[#cccccc]">
                    <span className="w-3.5 h-3.5 rounded-full bg-[#a855f7] shrink-0"></span>
                    <div>
                      <span className="font-bold text-[#000000] block text-[10px]">300km+</span>
                      <span className="text-[9px] text-[#757575]">심발({stats.deep})</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 p-1.5 rounded-[2px] bg-[#f7f7f7] border border-[#cccccc]">
                    <span className="w-3.5 h-3.5 rounded-full bg-[#94a3b8] shrink-0"></span>
                    <div>
                      <span className="font-bold text-[#000000] block text-[10px]">미제공</span>
                      <span className="text-[9px] text-[#757575]">({stats.unknownDepth})</span>
                    </div>
                  </div>
                </div>
                <p className="mt-2 text-[10px] text-[#757575] leading-tight">
                  ※ 깊이 색상은 위험 등급이 아닙니다.
                </p>
              </div>

              {/* 2. Magnitude Size Legend */}
              <div className="bg-[#ffffff] rounded-[2px] border border-[#cccccc] p-4 relative">
                <div className="absolute top-0 left-0 w-3 h-3 bg-[#76b900]"></div>
                <div className="flex items-center justify-between border-b border-[#cccccc] pb-2 mb-3">
                  <h3 className="text-xs font-bold text-[#000000] uppercase tracking-wider">
                    지진 규모 크기
                  </h3>
                  <span className="text-[10px] text-[#757575]">화면 반지름</span>
                </div>

                <div className="flex items-end justify-around py-3 px-1 bg-[#f7f7f7] rounded-[2px] border border-[#cccccc] mb-2">
                  <div className="flex flex-col items-center gap-1">
                    <div className="w-2 h-2 rounded-full bg-[#1a1a1a]"></div>
                    <span className="text-[9px] font-mono font-bold text-[#1a1a1a]">M2.5</span>
                  </div>
                  <div className="flex flex-col items-center gap-1">
                    <div className="w-3.5 h-3.5 rounded-full bg-[#1a1a1a]"></div>
                    <span className="text-[9px] font-mono font-bold text-[#1a1a1a]">M4.0</span>
                  </div>
                  <div className="flex flex-col items-center gap-1">
                    <div className="w-5 h-5 rounded-full bg-[#1a1a1a]"></div>
                    <span className="text-[9px] font-mono font-bold text-[#1a1a1a]">M6.0</span>
                  </div>
                  <div className="flex flex-col items-center gap-1">
                    <div className="w-6.5 h-6.5 rounded-full bg-[#76b900]"></div>
                    <span className="text-[9px] font-mono font-bold text-[#000000]">M8.0+</span>
                  </div>
                </div>
                <p className="text-[10px] text-[#757575] leading-tight">
                  ※ 시각적 비교 식이며 실제 피해 반경이 아닙니다.
                </p>
              </div>

              {/* 3. SEPARATED Plate Boundary Lines Legend */}
              <div className="bg-[#ffffff] rounded-[2px] border border-[#cccccc] p-4 relative">
                <div className="absolute top-0 left-0 w-3 h-3 bg-[#76b900]"></div>
                <div className="flex items-center justify-between border-b border-[#cccccc] pb-2 mb-3">
                  <h3 className="text-xs font-bold text-[#000000] uppercase tracking-wider">
                    판 경계선 범례
                  </h3>
                  <span className="text-[10px] text-[#757575]">선 모양 &amp; 색</span>
                </div>

                <div className="space-y-2 text-[11px]">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="inline-block w-4 h-0.5 bg-[#b91c1c]"></span>
                      <span className="font-bold text-[#000000]">수렴 경계</span>
                    </div>
                    <span className="text-[10px] text-[#757575]">붉은 실선</span>
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span
                        className="inline-block w-4 h-0.5"
                        style={{ borderTop: '2px dashed #0f766e' }}
                      ></span>
                      <span className="font-bold text-[#000000]">발산 경계</span>
                    </div>
                    <span className="text-[10px] text-[#757575]">청록 긴 점선</span>
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span
                        className="inline-block w-4 h-0.5"
                        style={{ borderTop: '2px dotted #334155' }}
                      ></span>
                      <span className="font-bold text-[#000000]">보존 경계</span>
                    </div>
                    <span className="text-[10px] text-[#757575]">회색 짧은 점선</span>
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span
                        className="inline-block w-4 h-0.5"
                        style={{ borderTop: '1px dotted #94a3b8' }}
                      ></span>
                      <span className="font-medium text-[#757575]">기타·미분류</span>
                    </div>
                    <span className="text-[10px] text-[#898989]">옅은 점선</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ========================================================================= */}
          {/* EARTHQUAKE LIST COLUMN (5 of 12 columns) */}
          {/* ========================================================================= */}
          <div
            className={`lg:col-span-5 flex flex-col gap-4 ${
              mobileView === 'map' ? 'hidden lg:flex' : 'flex'
            }`}
          >
            <section className="bg-[#ffffff] rounded-[2px] border border-[#cccccc] flex flex-col overflow-hidden relative">
              <div className="absolute top-0 left-0 w-3 h-3 bg-[#76b900]"></div>

              {/* List Header */}
              <div className="p-4 bg-[#f7f7f7] border-b border-[#cccccc] flex flex-col gap-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <List className="w-4 h-4 text-[#76b900]" />
                    <h2 className="text-sm font-bold text-[#000000] uppercase tracking-wider">
                      지진 관측 데이터 목록
                    </h2>
                  </div>

                  {/* Sorting Buttons */}
                  <div className="flex items-center gap-1 bg-[#ffffff] p-0.5 rounded-[2px] border border-[#cccccc] text-xs">
                    <button
                      type="button"
                      onClick={() => setSortOrder('time_desc')}
                      className={`px-2.5 py-1 rounded-[2px] font-bold transition-colors cursor-pointer flex items-center gap-1 ${
                        sortOrder === 'time_desc'
                          ? 'bg-[#000000] text-white'
                          : 'text-[#1a1a1a] hover:bg-[#f7f7f7]'
                      }`}
                      title="최근 발생한 순서대로 정렬"
                    >
                      <Clock className="w-3 h-3 text-[#76b900]" />
                      <span>최신순</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setSortOrder('mag_desc')}
                      className={`px-2.5 py-1 rounded-[2px] font-bold transition-colors cursor-pointer flex items-center gap-1 ${
                        sortOrder === 'mag_desc'
                          ? 'bg-[#000000] text-white'
                          : 'text-[#1a1a1a] hover:bg-[#f7f7f7]'
                      }`}
                      title="규모가 큰 순서대로 정렬"
                    >
                      <ArrowUpDown className="w-3 h-3 text-[#76b900]" />
                      <span>규모 큰 순</span>
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs text-[#757575]">
                  <span>
                    총 <strong className="text-[#000000] font-mono font-bold">{filteredEarthquakes.length.toLocaleString()}</strong>건 중{' '}
                    {filteredEarthquakes.length > 0
                      ? `${startIndex + 1}~${endIndex}건 표시`
                      : '0건'}
                  </span>
                  <span className="font-mono font-bold text-[#1a1a1a]">
                    ({currentPage} / {totalPages} 페이지)
                  </span>
                </div>
              </div>

              {/* List Content */}
              <div className="divide-y divide-[#cccccc] max-h-[570px] overflow-y-auto">
                {paginatedEarthquakes.length === 0 ? (
                  <div className="p-8 text-center text-[#757575] text-xs">
                    <AlertTriangle className="w-6 h-6 text-[#df6500] mx-auto mb-2" />
                    <p className="font-bold text-[#1a1a1a]">현재 조건에 맞는 지진이 없습니다.</p>
                    <p className="mt-1 text-[#898989]">필터에서 기간을 늘리거나 최소 규모를 낮춰 보세요.</p>
                  </div>
                ) : (
                  paginatedEarthquakes.map((eq) => {
                    const depthInfo = getDepthInfo(eq.depth);
                    const isSelected = selectedEarthquake?.id === eq.id;

                    return (
                      <div
                        key={eq.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => handleSelectAndFocus(eq)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            handleSelectAndFocus(eq);
                          }
                        }}
                        className={`p-4 transition-all text-left flex items-start gap-3 cursor-pointer outline-hidden focus-visible:ring-2 focus-visible:ring-[#76b900] ${
                          isSelected
                            ? 'bg-[#f7f7f7] border-l-4 border-l-[#76b900]'
                            : 'hover:bg-[#f7f7f7]/80 border-l-4 border-l-transparent'
                        }`}
                        title="클릭하거나 Enter를 누르면 지도 위치로 이동하고 상세 정보를 확인합니다"
                      >
                        {/* Magnitude badge */}
                        <div
                          className="w-12 h-12 rounded-[2px] flex flex-col items-center justify-center shrink-0 font-mono font-bold text-white text-center leading-tight shadow-none"
                          style={{ backgroundColor: depthInfo.color }}
                        >
                          <span className="text-[10px] opacity-90">M</span>
                          <span className="text-sm">
                            {eq.mag !== null ? eq.mag.toFixed(1) : '-'}
                          </span>
                        </div>

                        {/* Details */}
                        <div className="flex-1 min-w-0 space-y-1">
                          <div className="flex items-start justify-between gap-1">
                            <h4 className="text-xs sm:text-sm font-bold text-[#000000] truncate">
                              {eq.place}
                            </h4>
                            <span
                              className={`text-[10px] px-1.5 py-0.5 rounded-[2px] font-bold shrink-0 ${depthInfo.badgeBg} ${depthInfo.badgeText} border border-[#cccccc]`}
                            >
                              {depthInfo.label}
                            </span>
                          </div>

                          <div className="flex items-center gap-2 text-xs text-[#757575] flex-wrap">
                            <span className="font-semibold text-[#1a1a1a]">
                              깊이: {eq.depth !== null ? `${eq.depth.toFixed(1)} km` : '정보 없음'}
                            </span>
                            <span className="text-[#cccccc]">·</span>
                            <span className="font-mono text-[11px]">
                              {formatToKST(eq.time)}
                            </span>
                          </div>

                          <div className="flex items-center gap-1.5 pt-0.5 text-[11px] text-[#0046a4] font-bold">
                            <MapPin className="w-3 h-3 text-[#76b900]" />
                            <span>지도 위치로 이동 →</span>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Pagination Controls */}
              {totalPages > 1 && (
                <div className="p-3 bg-[#f7f7f7] border-t border-[#cccccc] flex items-center justify-between text-xs">
                  <button
                    type="button"
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-[2px] border border-[#cccccc] bg-[#ffffff] font-bold text-[#1a1a1a] hover:bg-[#e5e5e5] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                    <span>이전</span>
                  </button>

                  <span className="font-bold text-[#1a1a1a]">
                    <strong className="text-[#000000] font-mono">{currentPage}</strong> / {totalPages} 페이지
                  </span>

                  <button
                    type="button"
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-[2px] border border-[#cccccc] bg-[#ffffff] font-bold text-[#1a1a1a] hover:bg-[#e5e5e5] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                  >
                    <span>다음</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </section>
          </div>
        </div>

        {/* Selected Earthquake Detailed Inspection Panel */}
        {selectedEarthquake && (
          <section className="bg-[#ffffff] border border-[#000000] rounded-[2px] p-6 relative">
            <div className="absolute top-0 left-0 w-3 h-3 bg-[#76b900]"></div>

            <div className="flex items-start justify-between gap-3 border-b border-[#cccccc] pb-4">
              <div>
                <div className="flex items-center gap-2 flex-wrap mb-2">
                  <span className="inline-flex items-center px-2 py-0.5 rounded-[2px] text-xs font-bold bg-[#000000] text-white uppercase">
                    선택한 지진 제원
                  </span>
                  {(() => {
                    const depthInfo = getDepthInfo(selectedEarthquake.depth);
                    return (
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-[2px] text-xs font-bold ${depthInfo.badgeBg} ${depthInfo.badgeText} border border-[#cccccc]`}
                      >
                        {depthInfo.textDescription}
                      </span>
                    );
                  })()}
                </div>
                <h3 className="text-xl sm:text-2xl font-black text-[#000000] leading-snug">
                  {selectedEarthquake.place}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedEarthquake(null)}
                className="p-1.5 text-[#757575] hover:text-[#000000] hover:bg-[#f7f7f7] rounded-[2px] transition-colors cursor-pointer"
                title="상세 정보 닫기"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Spec Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 my-5">
              <div className="bg-[#f7f7f7] p-4 rounded-[2px] border border-[#cccccc]">
                <span className="text-[11px] font-bold text-[#757575] uppercase block mb-1">
                  규모 (Magnitude)
                </span>
                <span className="text-2xl font-black text-[#000000] font-mono">
                  {selectedEarthquake.mag !== null
                    ? `M ${selectedEarthquake.mag.toFixed(1)}`
                    : '값 없음'}
                </span>
                <span className="text-[10px] text-[#898989] block mt-1">
                  화면 반지름: {getMagnitudeRadius(selectedEarthquake.mag).toFixed(1)}px
                </span>
              </div>

              <div className="bg-[#f7f7f7] p-4 rounded-[2px] border border-[#cccccc]">
                <span className="text-[11px] font-bold text-[#757575] uppercase block mb-1">
                  규모 종류 (Mag Type)
                </span>
                <span className="text-xl font-black text-[#000000] font-mono">
                  {selectedEarthquake.magType ?? '정보 없음'}
                </span>
                <span className="text-[10px] text-[#898989] block mt-1">지진파 측정 방식</span>
              </div>

              <div className="bg-[#f7f7f7] p-4 rounded-[2px] border border-[#cccccc]">
                <span className="text-[11px] font-bold text-[#757575] uppercase block mb-1">
                  진원 깊이 (Depth)
                </span>
                <span className="text-2xl font-black text-[#000000] font-mono">
                  {selectedEarthquake.depth !== null
                    ? `${selectedEarthquake.depth.toFixed(1)} km`
                    : '정보 없음'}
                </span>
                <span className="text-[10px] text-[#757575] block mt-1 font-semibold">
                  {getDepthInfo(selectedEarthquake.depth).label}
                </span>
              </div>

              <div className="bg-[#f7f7f7] p-4 rounded-[2px] border border-[#cccccc]">
                <span className="text-[11px] font-bold text-[#757575] uppercase block mb-1">
                  진앙 좌표 (위도, 경도)
                </span>
                <span className="text-xs sm:text-sm font-bold text-[#000000] font-mono mt-1 block">
                  {selectedEarthquake.lat.toFixed(3)}°, {selectedEarthquake.lng.toFixed(3)}°
                </span>
                <span className="text-[10px] text-[#898989] block mt-1">WGS84 좌표계</span>
              </div>
            </div>

            {selectedEarthquake.depth !== null && selectedEarthquake.depth < 0 && (
              <div className="mb-4 p-3 bg-[#fff7ed] rounded-[2px] border border-[#fdba74] text-xs text-[#9a3412] flex items-start gap-2">
                <Info className="w-4 h-4 text-[#ea580c] shrink-0 mt-0.5" />
                <p className="leading-relaxed">
                  <span className="font-bold">음수 깊이({selectedEarthquake.depth.toFixed(1)} km) 안내: </span>
                  원자료의 음수 깊이는 임의로 0으로 변환하지 않고 원본 그대로 유지합니다. 이는 해수면보다 높은 산악 지형의 관측 기준면 또는 지진 진원 추정 모델의 기준면 설정과 관련될 수 있습니다.
                </p>
              </div>
            )}

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-3 border-t border-[#cccccc] text-xs sm:text-sm">
              <div className="text-[#1a1a1a]">
                <span className="font-bold text-[#000000] mr-2">발생 시각:</span>
                <span className="font-mono font-bold">{formatToKST(selectedEarthquake.time)}</span>
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => handleSelectAndFocus(selectedEarthquake)}
                  className="h-9 px-4 text-xs font-bold text-black bg-transparent border-2 border-[#76b900] hover:bg-[#76b900]/10 rounded-[2px] transition-colors cursor-pointer"
                >
                  지도로 이동
                </button>

                {selectedEarthquake.hasValidUrl && selectedEarthquake.url ? (
                  <a
                    href={selectedEarthquake.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-bold text-white bg-[#000000] hover:bg-[#1a1a1a] rounded-[2px] transition-colors"
                  >
                    <span>USGS 상세 분석 보고서</span>
                    <ExternalLink className="w-3.5 h-3.5 text-[#76b900]" />
                  </a>
                ) : (
                  <span className="text-xs text-[#757575] bg-[#f7f7f7] px-3 py-1.5 rounded-[2px] border border-[#cccccc]">
                    상세 링크 미제공
                  </span>
                )}
              </div>
            </div>
          </section>
        )}
      </main>

      {/* ========================================================================= */}
      {/* 8. FOOTER CHAPTER (Surface Dark #000000, Multi-column Technical Layout) */}
      {/* ========================================================================= */}
      <footer className="mt-auto bg-[#000000] text-white border-t border-[#5e5e5e] py-12">
        <div className="max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8 pb-8 border-b border-[#5e5e5e]">
            {/* Col 1 */}
            <div className="space-y-2">
              <h4 className="text-xs font-bold uppercase tracking-wider text-white">
                수업용 플랫폼 개요
              </h4>
              <p className="text-xs text-[#a7a7a7] leading-relaxed">
                ‘지구의 지진 탐험’은 중학교 과학 지권의 변화 및 판 구조론 단원을 위한 데이터 시각화 웹 애플리케이션입니다.
              </p>
            </div>

            {/* Col 2 */}
            <div className="space-y-2">
              <h4 className="text-xs font-bold uppercase tracking-wider text-white">
                데이터 소스
              </h4>
              <ul className="text-xs text-[#a7a7a7] space-y-1">
                <li>• USGS 실시간 지진 GeoJSON 피드</li>
                <li>• Peter Bird (2003) 판 경계 모델</li>
                <li>• OpenStreetMap 글로벌 지도 타일</li>
              </ul>
            </div>

            {/* Col 3 */}
            <div className="space-y-2">
              <h4 className="text-xs font-bold uppercase tracking-wider text-white">
                과학적 지침
              </h4>
              <p className="text-xs text-[#a7a7a7] leading-relaxed">
                규모는 지진의 절대적 크기를 뜻하며, 깊이 색상은 지하 물리적 발생 깊이를 나타내며 위험 등급이 아닙니다.
              </p>
            </div>

            {/* Col 4 */}
            <div className="space-y-2">
              <h4 className="text-xs font-bold uppercase tracking-wider text-white">
                엔지니어링 시스템
              </h4>
              <p className="text-xs text-[#a7a7a7] leading-relaxed">
                NVIDIA-grade monochrome black &amp; white layout with #76b900 accent, 2px angular geometry and Netlify static build deployment.
              </p>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-[10px] text-[#757575] font-bold uppercase tracking-wider">
            <p>© MIDDLE SCHOOL SCIENCE EDUCATION PLATFORM. ALL RIGHTS RESERVED.</p>
            <div className="flex items-center gap-4">
              <span>WGS84 COORDINATES</span>
              <span>·</span>
              <span className="text-[#76b900]">NVIDIA DESIGN SPECIFICATION COMPLIANT</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
