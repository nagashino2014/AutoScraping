"use client";

import React, { useState, useCallback, useRef } from "react";
import { GoogleMap, useJsApiLoader } from "@react-google-maps/api";
import { ChevronLeft, MapPin, Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

// 지역권 정의
const REGIONS: Record<string, { 
  name: string; 
  metros: string[]; 
  geoJsonFile: string;
}> = {
  'capital': { name: '수도권', metros: ['서울특별시', '인천광역시', '경기도'], geoJsonFile: 'region_수도권.json' },
  'chungcheong': { name: '충청권', metros: ['대전광역시', '세종특별자치시', '충청북도', '충청남도'], geoJsonFile: 'region_충청권.json' },
  'jeolla': { name: '전라권', metros: ['광주광역시', '전라북도', '전라남도'], geoJsonFile: 'region_전라권.json' },
  'gyeongbuk': { name: '경북권', metros: ['대구광역시', '경상북도'], geoJsonFile: 'region_경북권.json' },
  'gyeongnam': { name: '경남권', metros: ['부산광역시', '울산광역시', '경상남도'], geoJsonFile: 'region_경남권.json' },
  'gangwon': { name: '강원권', metros: ['강원특별자치도'], geoJsonFile: 'region_강원권.json' },
  'jeju': { name: '제주권', metros: ['제주특별자치도'], geoJsonFile: 'region_제주권.json' },
};

// 시도 코드 매핑 - SIGUNGU_CD 기준(구 행정구역 코드)
const SIDO_CODE_MAP: Record<string, string> = {
  '서울특별시': '11',
  '부산광역시': '21',
  '대구광역시': '22',
  '인천광역시': '23',
  '광주광역시': '24',
  '대전광역시': '25',
  '울산광역시': '26',
  '세종특별자치시': '29',
  '경기도': '31',
  '강원특별자치도': '32',
  '충청북도': '33',
  '충청남도': '34',
  '전북특별자치도': '35',
  '전라북도': '35',
  '전라남도': '36',
  '경상북도': '37',
  '경상남도': '38',
  '제주특별자치도': '39',
};

const SIDO_NAME_ALIASES: Record<string, string> = {
  '서울시': '서울특별시',
  '부산시': '부산광역시',
  '대구시': '대구광역시',
  '인천시': '인천광역시',
  '광주시': '광주광역시',
  '대전시': '대전광역시',
  '울산시': '울산광역시',
  '세종시': '세종특별자치시',
  '경기': '경기도',
  '강원도': '강원특별자치도',
  '충북': '충청북도',
  '충남': '충청남도',
  '전북': '전북특별자치도',
  '전남': '전라남도',
  '경북': '경상북도',
  '경남': '경상남도',
  '제주도': '제주특별자치도',
};

// 파스텔 색상 팔레트
const PASTEL_COLORS = [
  '#FFB3BA', '#BAFFC9', '#BAE1FF', '#FFFFBA', '#FFDFBA', '#E0BBE4', '#FFC9DE',
  '#C9FFDE', '#DEE0FF', '#FFDAB9', '#B9E0FF', '#D0F0C0', '#F0D0F0', '#F0E68C'
];

// 지역권별 고정 색상
const REGION_COLORS: Record<string, string> = {
  '수도권': '#BAE1FF',
  '충청권': '#BAFFC9',
  '전라권': '#FFFFBA',
  '경북권': '#FFB3BA',
  '경남권': '#FFDFBA',
  '강원권': '#E0BBE4',
  '제주권': '#FFC9DE',
};

// 지도 스타일 - 폴리곤만 보이도록 모든 피처 숨김
const mapStyles = [
  { featureType: 'all', elementType: 'all', stylers: [{ visibility: 'off' }] },
];

// GeoJSON 캐시
const geoJsonCache: Record<string, GeoJSON.FeatureCollection> = {};

// 시군구 데이터를 시도별로 분류한 캐시
const sigunguBySidoCache: Record<string, GeoJSON.Feature[]> = {};

// 모든 GeoJSON 파일 프리로드
const preloadAllGeoJSON = async () => {
  const files = [
    '/geojson/all_regions_simplified.json',
    '/geojson/region_수도권.json',
    '/geojson/region_충청권.json',
    '/geojson/region_전라권.json',
    '/geojson/region_경북권.json',
    '/geojson/region_경남권.json',
    '/geojson/region_강원권.json',
    '/geojson/region_제주권.json',
    '/geojson/sigungu_boundaries_simplified.json',
  ];
  
  await Promise.all(files.map(async (url) => {
    if (geoJsonCache[url]) return;
    try {
      const response = await fetch(url);
      if (response.ok) {
        geoJsonCache[url] = await response.json();
      }
    } catch (e) {
      // 무시
    }
  }));
  
  // 시군구 데이터를 시도별로 분류
  const sigunguData = geoJsonCache['/geojson/sigungu_boundaries_simplified.json'];
  if (sigunguData) {
    sigunguData.features.forEach((feature: GeoJSON.Feature) => {
      const sigunguCode = feature.properties?.SIGUNGU_CD;
      if (!sigunguCode) return;
      const sidoCode = sigunguCode.substring(0, 2);
      if (!sigunguBySidoCache[sidoCode]) {
        sigunguBySidoCache[sidoCode] = [];
      }
      sigunguBySidoCache[sidoCode].push(feature);
    });
  }
};

// 프리로드 실행
let preloadPromise: Promise<void> | null = null;
export const preloadMapData = () => {
  if (!preloadPromise) {
    preloadPromise = preloadAllGeoJSON();
  }
  return preloadPromise;
};

interface GoogleMapRegionSelectorProps {
  onSelect: (sido: string, sigungu: string, fullRegion: string) => void;
  initialSido?: string;
  initialSigungu?: string;
}

export default function GoogleMapRegionSelector({
  onSelect,
  initialSido = "",
  initialSigungu = "",
}: GoogleMapRegionSelectorProps) {
  const [level, setLevel] = useState<"region" | "sido" | "sigungu">("region");
  const [selectedRegion, setSelectedRegion] = useState<string | null>(null);
  const [selectedSido, setSelectedSido] = useState(initialSido);
  const [selectedSigungu, setSelectedSigungu] = useState(initialSigungu);
  const [hoveredArea, setHoveredArea] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  
  const mapRef = useRef<google.maps.Map | null>(null);
  const polygonsRef = useRef<google.maps.Polygon[]>([]);
  const labelsRef = useRef<google.maps.Marker[]>([]);

  const { isLoaded, loadError } = useJsApiLoader({
    googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "",
  });

  const clearMap = useCallback(() => {
    polygonsRef.current.forEach(p => p.setMap(null));
    polygonsRef.current = [];
    labelsRef.current.forEach(l => l.setMap(null));
    labelsRef.current = [];
  }, []);

  const applyMapOptionsForLevel = useCallback((nextLevel: "region" | "sido" | "sigungu") => {
    if (!mapRef.current) return;

    if (nextLevel === "region") {
      mapRef.current.setOptions({
        draggable: false,
        scrollwheel: false,
        gestureHandling: 'none',
        zoomControl: false,
      });
      return;
    }

    mapRef.current.setOptions({
      draggable: true,
      scrollwheel: true,
      gestureHandling: 'greedy',
      zoomControl: false,
    });
  }, []);

  const getGeometryCenter = useCallback((geometry: GeoJSON.Geometry): { lat: number; lng: number } | null => {
    if (!geometry || !('coordinates' in geometry)) return null;
    
    const lats: number[] = [];
    const lngs: number[] = [];
    
    const processCoords = (coords: number[] | number[][] | number[][][] | number[][][][]) => {
      if (Array.isArray(coords)) {
        if (typeof coords[0] === 'number' && typeof coords[1] === 'number') {
          lngs.push(coords[0] as number);
          lats.push(coords[1] as number);
        } else {
          (coords as (number[] | number[][] | number[][][])[]).forEach(c => processCoords(c as number[] | number[][] | number[][][] | number[][][][]));
        }
      }
    };
    
    processCoords(geometry.coordinates as number[] | number[][] | number[][][] | number[][][][]);
    
    if (lats.length === 0) return null;
    return {
      lat: lats.reduce((a, b) => a + b, 0) / lats.length,
      lng: lngs.reduce((a, b) => a + b, 0) / lngs.length,
    };
  }, []);

  const convertGeoJSONToGoogleMaps = useCallback((geometry: GeoJSON.Geometry): google.maps.LatLngLiteral[][] => {
    const paths: google.maps.LatLngLiteral[][] = [];
    
    if (geometry.type === 'Polygon') {
      geometry.coordinates.forEach((ring) => {
        const path = ring.map((coord) => ({ lat: coord[1], lng: coord[0] }));
        paths.push(path);
      });
    } else if (geometry.type === 'MultiPolygon') {
      geometry.coordinates.forEach((polygon) => {
        polygon.forEach((ring) => {
          const path = ring.map((coord) => ({ lat: coord[1], lng: coord[0] }));
          paths.push(path);
        });
      });
    }
    
    return paths;
  }, []);

  const addPolygon = useCallback((
    geometry: GeoJSON.Geometry,
    name: string,
    color: string,
    onClick: () => void,
    bounds: google.maps.LatLngBounds,
    mapLevel: "region" | "sido" | "sigungu" = "region",
  ) => {
    if (!mapRef.current) return;
    
    const paths = convertGeoJSONToGoogleMaps(geometry);
    if (paths.length === 0) return;

    // 레벨별 경계선 스타일
    const strokeStyle = mapLevel === "region" 
      ? { strokeColor: '#888888', strokeOpacity: 0, strokeWeight: 0 }  // 지역권: 경계선 없음
      : { strokeColor: '#888888', strokeOpacity: 0.6, strokeWeight: 1 }; // 시/도, 시/군/구: 얇은 경계선

    const polygon = new google.maps.Polygon({
      paths,
      ...strokeStyle,
      fillColor: color,
      fillOpacity: 0.7,
      map: mapRef.current,
      zIndex: 1,
    });

    // bounds 확장
    paths.forEach(path => {
      path.forEach(latLng => {
        bounds.extend(latLng);
      });
    });

    // 라벨 추가
    const center = getGeometryCenter(geometry);
    if (center) {
      const displayName = name;
      
      const label = new google.maps.Marker({
        position: center,
        map: mapRef.current,
        label: {
          text: displayName,
          color: '#333333',
          fontSize: '12px',
          fontWeight: 'bold',
        },
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 0,
        },
        zIndex: 2,
      });
      labelsRef.current.push(label);
    }

    // 이벤트 리스너
    polygon.addListener('click', onClick);
    polygon.addListener('mouseover', () => {
      if (mapLevel === "region") {
        polygon.setOptions({ fillOpacity: 0.9 });
      } else {
        polygon.setOptions({ fillOpacity: 0.9, strokeColor: '#333333', strokeWeight: 1.5 });
      }
      setHoveredArea(name);
    });
    polygon.addListener('mouseout', () => {
      if (mapLevel === "region") {
        polygon.setOptions({ fillOpacity: 0.7 });
      } else {
        polygon.setOptions({ fillOpacity: 0.7, strokeColor: '#888888', strokeWeight: 1 });
      }
      setHoveredArea(null);
    });

    polygonsRef.current.push(polygon);
  }, [convertGeoJSONToGoogleMaps, getGeometryCenter]);

  // GeoJSON 로드 (캐시 사용)
  const loadGeoJSON = useCallback(async (url: string): Promise<GeoJSON.FeatureCollection | null> => {
    if (geoJsonCache[url]) {
      return geoJsonCache[url];
    }
    
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      geoJsonCache[url] = data;
      return data;
    } catch (error) {
      console.error('GeoJSON 로드 실패:', url, error);
      return null;
    }
  }, []);

  // bounds에 맞게 지도 조정 (restriction 없이)
  const fitMapToBounds = useCallback((bounds: google.maps.LatLngBounds) => {
    if (!mapRef.current || bounds.isEmpty()) return;
    
    mapRef.current.setOptions({ restriction: null });
    mapRef.current.fitBounds(bounds, { top: 20, right: 20, bottom: 20, left: 20 });
  }, []);

  // 1단계: 지역권 지도 로드
  const loadRegionMap = useCallback(async () => {
    if (!mapRef.current) return;
    
    setLoading(true);
    clearMap();
    setLevel("region");
    applyMapOptionsForLevel("region");
    
    const data = await loadGeoJSON('/geojson/all_regions_simplified.json');
    if (!data) {
      setLoading(false);
      return;
    }
    
    const bounds = new google.maps.LatLngBounds();
    
    data.features.forEach((feature: GeoJSON.Feature) => {
      const regionName = feature.properties?.REGION;
      if (!regionName) return;
      
      const color = REGION_COLORS[regionName] || PASTEL_COLORS[0];
      
      addPolygon(
        feature.geometry,
        regionName,
        color,
        () => {
          setSelectedRegion(regionName);
          loadSidoMap(regionName);
        },
        bounds,
        "region",
      );
    });
    
    // 전국 고정 축척으로 표시
    mapRef.current.setOptions({ restriction: null });
    mapRef.current.setCenter({ lat: 36.35, lng: 127.9 });
    mapRef.current.setZoom(6.3);
    setLoading(false);
  }, [clearMap, addPolygon, loadGeoJSON, applyMapOptionsForLevel]);

  // 2단계: 시도 지도 로드
  const loadSidoMap = useCallback(async (regionName: string) => {
    if (!mapRef.current) return;
    
    const regionData = Object.values(REGIONS).find(r => r.name === regionName);
    if (!regionData) return;
    
    setLoading(true);
    clearMap();
    setLevel("sido");
    setSelectedRegion(regionName);
    applyMapOptionsForLevel("sido");
    
    const data = await loadGeoJSON(`/geojson/${regionData.geoJsonFile}`);
    if (!data) {
      setLoading(false);
      return;
    }
    
    const bounds = new google.maps.LatLngBounds();
    let colorIndex = 0;
    
    data.features.forEach((feature: GeoJSON.Feature) => {
      const sidoName = feature.properties?.SIDO_NM;
      if (!sidoName) return;
      
      const color = PASTEL_COLORS[colorIndex % PASTEL_COLORS.length];
      colorIndex++;
      
      addPolygon(
        feature.geometry,
        sidoName,
        color,
        () => {
          setSelectedSido(sidoName);
          loadSigunguMap(sidoName);
        },
        bounds,
        "sido",
      );
    });
    
    fitMapToBounds(bounds);
    setLoading(false);
  }, [clearMap, addPolygon, loadGeoJSON, fitMapToBounds, applyMapOptionsForLevel]);

  // 3단계: 시군구 지도 로드 (캐시 활용)
  const loadSigunguMap = useCallback(async (sidoName: string) => {
    if (!mapRef.current) return;
    
    setLoading(true);
    clearMap();
    setLevel("sigungu");
    setSelectedSido(sidoName);
    applyMapOptionsForLevel("sigungu");
    
    const normalizedSidoName = SIDO_NAME_ALIASES[sidoName] || sidoName;
    const targetSidoCode = SIDO_CODE_MAP[normalizedSidoName];
    if (!targetSidoCode) {
      console.error('시도 코드를 찾을 수 없습니다:', sidoName);
      setLoading(false);
      return;
    }
    
    // 캐시된 시군구 데이터 사용 (없으면 전체 로드)
    let features = sigunguBySidoCache[targetSidoCode];
    if (!features || features.length === 0) {
      const data = await loadGeoJSON('/geojson/sigungu_boundaries_simplified.json');
      if (!data) {
        setLoading(false);
        return;
      }
      features = data.features.filter((f: GeoJSON.Feature) => {
        const code = f.properties?.SIGUNGU_CD;
        return code && code.substring(0, 2) === targetSidoCode;
      });
    }
    
    const bounds = new google.maps.LatLngBounds();
    let colorIndex = 0;
    
    features.forEach((feature: GeoJSON.Feature) => {
      const sigunguName = feature.properties?.SIGUNGU_NM;
      if (!sigunguName) return;
      
      const color = PASTEL_COLORS[colorIndex % PASTEL_COLORS.length];
      colorIndex++;
      
      addPolygon(
        feature.geometry,
        sigunguName,
        color,
        () => {
          setSelectedSigungu(sigunguName);
        },
        bounds,
        "sigungu",
      );
    });
    
    if (features.length > 0) {
      fitMapToBounds(bounds);
    }
    
    setLoading(false);
  }, [clearMap, addPolygon, loadGeoJSON, fitMapToBounds, applyMapOptionsForLevel]);

  const handleBack = useCallback(() => {
    if (level === "sigungu") {
      setSelectedSigungu("");
      if (selectedRegion) {
        loadSidoMap(selectedRegion);
      }
    } else if (level === "sido") {
      setSelectedSido("");
      setSelectedRegion(null);
      loadRegionMap();
    }
  }, [level, selectedRegion, loadSidoMap, loadRegionMap]);

  const handleConfirm = useCallback(() => {
    if (selectedSido && selectedSigungu) {
      const fullRegion = `${selectedSido} ${selectedSigungu}`;
      onSelect(selectedSido, selectedSigungu, fullRegion);
    }
  }, [selectedSido, selectedSigungu, onSelect]);

  const onMapLoad = useCallback((map: google.maps.Map) => {
    mapRef.current = map;
    // 초기 설정
    map.setOptions({
      backgroundColor: '#FFFFFF',
    });
    // 프리로드 완료 대기 후 지역권 지도 로드
    preloadMapData().then(() => {
      loadRegionMap();
    });
  }, [loadRegionMap]);

  if (loadError) {
    return (
      <div className="flex items-center justify-center h-[400px] bg-stone-100 rounded-xl">
        <p className="text-stone-500">지도를 불러올 수 없습니다.</p>
      </div>
    );
  }

  if (!isLoaded) {
    return (
      <div className="flex items-center justify-center h-[400px] bg-stone-100 rounded-xl">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {level !== "region" && (
            <button
              onClick={handleBack}
              className="p-1.5 rounded-lg hover:bg-stone-100 transition-colors"
            >
              <ChevronLeft className="w-4 h-4 text-stone-600" />
            </button>
          )}
          <div>
            <p className="text-xs font-medium text-stone-700">
              {level === "region" && "지역권 선택 (클릭하여 시/도 선택으로 이동)"}
              {level === "sido" && `${selectedRegion} - 시/도 선택`}
              {level === "sigungu" && `${selectedSido} - 시/군/구 선택`}
            </p>
          </div>
        </div>
        {loading && <Loader2 className="w-4 h-4 animate-spin text-stone-400" />}
      </div>

      {/* 지도 */}
      <div className="relative rounded-xl overflow-hidden border border-stone-200 bg-white">
        <GoogleMap
          mapContainerStyle={{ width: '100%', height: '460px', backgroundColor: '#FFFFFF' }}
          defaultCenter={{ lat: 36.0, lng: 127.5 }}
          defaultZoom={7}
          onLoad={onMapLoad}
          options={{
            styles: mapStyles,
            disableDefaultUI: true,
            zoomControl: false,
            scrollwheel: true,
            gestureHandling: 'greedy',
            draggable: true,
            backgroundColor: '#FFFFFF',
            minZoom: 5,
            maxZoom: 14,
          }}
        />
        
        {/* 호버 정보 */}
        {hoveredArea && (
          <div className="absolute bottom-2 left-2 px-2.5 py-1.5 bg-white/95 backdrop-blur rounded-lg shadow border border-stone-200">
            <span className="text-sm font-medium text-stone-700">{hoveredArea}</span>
          </div>
        )}
      </div>

      {/* 선택 정보 및 확인 버튼 */}
      <div className="flex items-center justify-between p-2.5 bg-stone-50 rounded-lg">
        <div className="flex items-center gap-2 text-xs">
          <MapPin className="w-3.5 h-3.5 text-primary" />
          <span className="text-stone-500">선택:</span>
          {selectedSido ? (
            <span className="font-medium text-stone-800">
              {selectedSido}
              {selectedSigungu && ` ${selectedSigungu}`}
            </span>
          ) : (
            <span className="text-stone-400">지역을 선택하세요</span>
          )}
        </div>
        
        <button
          onClick={handleConfirm}
          disabled={!selectedSido || !selectedSigungu}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
            selectedSido && selectedSigungu
              ? "bg-primary text-white hover:bg-primary/90"
              : "bg-stone-200 text-stone-400 cursor-not-allowed"
          )}
        >
          <Check className="w-3.5 h-3.5" />
          선택 완료
        </button>
      </div>
    </div>
  );
}
