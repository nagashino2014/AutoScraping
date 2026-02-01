# PDF 표 구조 복원 라이브러리 아키텍처

## 개요

PDF 텍스트 추출 시 표 구조 붕괴 현상(특히 행 구조의 붕괴)을 해결하기 위한 **셀 구분선 검출 기반 표 구조 복원 라이브러리** 설계 문서입니다.

### 핵심 전략

1. PDF OCR 과정에서 표의 **셀 구분선을 검출**하여 각각의 셀 영역을 구획
2. 셀 영역을 **좌표화**하여 텍스트 정보와 별개로 저장 (JSON 메타데이터)
3. 표 복원 시 저장된 좌표 정보를 불러와 **표 구조를 복원**

---

## 1. 필요 라이브러리

### 1.1 핵심 라이브러리

| 라이브러리 | 용도 | 버전 권장 |
|:---|:---|:---|
| **OpenCV (cv2)** | 이미지 전처리, 선 검출(Hough Transform), 윤곽선 검출 | 4.8+ |
| **PyMuPDF (fitz)** | PDF 페이지 → 이미지 변환, 벡터 그래픽 선 추출 | 1.23+ |
| **NumPy** | 좌표 연산, 배열 처리 | 1.24+ |
| **scikit-image** | 형태학적 연산, 스켈레톤화 | 0.21+ |
| **pdfplumber** | PDF 텍스트 좌표 추출, 테이블 감지 보조 | 0.10+ |

### 1.2 보조 라이브러리

| 라이브러리 | 용도 |
|:---|:---|
| **SciPy** | 클러스터링 알고리즘 (DBSCAN 등) |
| **Shapely** | 기하학적 연산 (셀 영역 병합/교차) |
| **networkx** | 셀 그래프 구성 (병합 셀 연결성 분석) |

### 1.3 설치 명령

```bash
pip install opencv-python>=4.8.0
pip install PyMuPDF>=1.23.0
pip install numpy>=1.24.0
pip install scikit-image>=0.21.0
pip install pdfplumber>=0.10.0
pip install scipy>=1.11.0
pip install shapely>=2.0.0
pip install networkx>=3.1
```

---

## 2. 라이브러리 아키텍처

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    PDF Table Structure Recovery Library                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌────────────────────┐    ┌─────────────────────┐    ┌──────────────────┐  │
│  │  1. Line Detector  │───▶│  2. Cell Segmentor  │───▶│ 3. Coord Manager │  │
│  │    (선 검출기)      │    │    (셀 분할기)       │    │   (좌표 관리자)   │  │
│  └────────────────────┘    └─────────────────────┘    └──────────────────┘  │
│           │                          │                         │            │
│           ▼                          ▼                         ▼            │
│  ┌────────────────────┐    ┌─────────────────────┐    ┌──────────────────┐  │
│  │ - 수평선 검출       │    │ - 셀 영역 구획       │    │ - JSON 메타데이터 │  │
│  │ - 수직선 검출       │    │ - 교차점 계산        │    │ - 좌표 캐싱       │  │
│  │ - 노이즈 필터링     │    │ - 병합 셀 감지       │    │ - 버전 관리       │  │
│  └────────────────────┘    └─────────────────────┘    └──────────────────┘  │
│                                                                              │
│  ┌────────────────────┐    ┌─────────────────────┐    ┌──────────────────┐  │
│  │  4. Text Mapper    │───▶│  5. Table Builder   │───▶│ 6. Output Format │  │
│  │   (텍스트 매퍼)     │    │    (표 구성기)       │    │  (출력 포맷터)    │  │
│  └────────────────────┘    └─────────────────────┘    └──────────────────┘  │
│           │                          │                         │            │
│           ▼                          ▼                         ▼            │
│  ┌────────────────────┐    ┌─────────────────────┐    ┌──────────────────┐  │
│  │ - OCR 텍스트 매핑   │    │ - 행/열 인덱싱       │    │ - Markdown       │  │
│  │ - 셀 내 텍스트 정렬 │    │ - 구조 검증          │    │ - HTML           │  │
│  │ - 다중 라인 처리    │    │ - 병합 셀 표현       │    │ - JSON           │  │
│  └────────────────────┘    └─────────────────────┘    └──────────────────┘  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. 핵심 모듈 상세 설계

### 3.1 Line Detector (선 검출기)

표의 구분선(테두리)을 검출하는 모듈입니다.

```python
from dataclasses import dataclass
from typing import List, Tuple, Optional
import numpy as np
import cv2
import fitz

@dataclass
class Line:
    """검출된 선 정보"""
    start: Tuple[float, float]  # (x1, y1)
    end: Tuple[float, float]    # (x2, y2)
    orientation: str            # 'horizontal' | 'vertical'
    thickness: float
    confidence: float

@dataclass
class TableLines:
    """테이블의 모든 구분선"""
    horizontal: List[Line]
    vertical: List[Line]
    bbox: Tuple[float, float, float, float]  # (x0, y0, x1, y1)

@dataclass
class LineDetectorConfig:
    """선 검출기 설정"""
    min_line_length: int = 50       # 최소 선 길이 (px)
    thickness_range: Tuple[int, int] = (1, 5)  # 선 두께 범위
    angle_tolerance: float = 2.0    # 수평/수직 허용 각도 (도)
    hough_threshold: int = 100      # Hough 변환 임계값
    min_line_gap: int = 10          # 최소 선 간격


class TableLineDetector:
    """표 구분선 검출기"""
    
    def __init__(self, config: LineDetectorConfig = None):
        self.config = config or LineDetectorConfig()
    
    def detect_lines(self, image: np.ndarray) -> TableLines:
        """
        이미지에서 표 구분선 검출
        
        처리 과정:
        1. 그레이스케일 변환
        2. 이진화 (Adaptive Threshold)
        3. 모폴로지 연산으로 노이즈 제거
        4. Hough Line Transform으로 직선 검출
        5. 수평/수직 선 분류
        6. 중복 선 병합
        
        Args:
            image: BGR 이미지 배열
            
        Returns:
            TableLines: 검출된 수평/수직 선 목록
        """
        # 1. 전처리
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        binary = cv2.adaptiveThreshold(
            gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
            cv2.THRESH_BINARY_INV, 11, 2
        )
        
        # 2. 수평선 검출용 커널
        horizontal_kernel = cv2.getStructuringElement(
            cv2.MORPH_RECT, (40, 1)
        )
        horizontal_mask = cv2.morphologyEx(
            binary, cv2.MORPH_OPEN, horizontal_kernel, iterations=2
        )
        
        # 3. 수직선 검출용 커널
        vertical_kernel = cv2.getStructuringElement(
            cv2.MORPH_RECT, (1, 40)
        )
        vertical_mask = cv2.morphologyEx(
            binary, cv2.MORPH_OPEN, vertical_kernel, iterations=2
        )
        
        # 4. Hough Transform 적용
        h_lines = self._detect_lines_hough(horizontal_mask, 'horizontal')
        v_lines = self._detect_lines_hough(vertical_mask, 'vertical')
        
        # 5. 중복 선 병합
        h_lines = self._merge_similar_lines(h_lines, 'horizontal')
        v_lines = self._merge_similar_lines(v_lines, 'vertical')
        
        # 6. bbox 계산
        bbox = self._calculate_bbox(h_lines, v_lines)
        
        return TableLines(
            horizontal=h_lines,
            vertical=v_lines,
            bbox=bbox
        )
    
    def detect_from_vector(self, page: fitz.Page) -> TableLines:
        """
        PDF 벡터 그래픽에서 직접 선 추출
        
        장점: 이미지 변환 없이 정확한 좌표 획득
        
        Args:
            page: PyMuPDF 페이지 객체
            
        Returns:
            TableLines: 추출된 구분선
        """
        drawings = page.get_drawings()
        h_lines = []
        v_lines = []
        
        for drawing in drawings:
            for item in drawing.get("items", []):
                if item[0] == "l":  # line
                    p1, p2 = item[1], item[2]
                    
                    # 수평선 판별
                    if abs(p1.y - p2.y) < self.config.angle_tolerance:
                        h_lines.append(Line(
                            start=(p1.x, p1.y),
                            end=(p2.x, p2.y),
                            orientation='horizontal',
                            thickness=drawing.get("width", 1),
                            confidence=1.0
                        ))
                    # 수직선 판별
                    elif abs(p1.x - p2.x) < self.config.angle_tolerance:
                        v_lines.append(Line(
                            start=(p1.x, p1.y),
                            end=(p2.x, p2.y),
                            orientation='vertical',
                            thickness=drawing.get("width", 1),
                            confidence=1.0
                        ))
        
        bbox = self._calculate_bbox(h_lines, v_lines)
        
        return TableLines(
            horizontal=h_lines,
            vertical=v_lines,
            bbox=bbox
        )
    
    def _detect_lines_hough(
        self, 
        mask: np.ndarray, 
        orientation: str
    ) -> List[Line]:
        """Hough Transform으로 선 검출"""
        lines = cv2.HoughLinesP(
            mask,
            rho=1,
            theta=np.pi / 180,
            threshold=self.config.hough_threshold,
            minLineLength=self.config.min_line_length,
            maxLineGap=self.config.min_line_gap
        )
        
        result = []
        if lines is not None:
            for line in lines:
                x1, y1, x2, y2 = line[0]
                result.append(Line(
                    start=(x1, y1),
                    end=(x2, y2),
                    orientation=orientation,
                    thickness=1.0,
                    confidence=0.9
                ))
        
        return result
    
    def _merge_similar_lines(
        self, 
        lines: List[Line], 
        orientation: str
    ) -> List[Line]:
        """비슷한 위치의 선들을 병합"""
        if not lines:
            return []
        
        tolerance = 5  # 픽셀 허용 오차
        
        if orientation == 'horizontal':
            # y 좌표 기준 그룹화
            lines.sort(key=lambda l: l.start[1])
        else:
            # x 좌표 기준 그룹화
            lines.sort(key=lambda l: l.start[0])
        
        merged = []
        current_group = [lines[0]]
        
        for line in lines[1:]:
            if orientation == 'horizontal':
                diff = abs(line.start[1] - current_group[-1].start[1])
            else:
                diff = abs(line.start[0] - current_group[-1].start[0])
            
            if diff <= tolerance:
                current_group.append(line)
            else:
                # 그룹 병합
                merged.append(self._merge_line_group(current_group, orientation))
                current_group = [line]
        
        if current_group:
            merged.append(self._merge_line_group(current_group, orientation))
        
        return merged
    
    def _merge_line_group(
        self, 
        group: List[Line], 
        orientation: str
    ) -> Line:
        """선 그룹을 하나의 선으로 병합"""
        if orientation == 'horizontal':
            y = sum(l.start[1] for l in group) / len(group)
            x1 = min(min(l.start[0], l.end[0]) for l in group)
            x2 = max(max(l.start[0], l.end[0]) for l in group)
            return Line(
                start=(x1, y),
                end=(x2, y),
                orientation='horizontal',
                thickness=max(l.thickness for l in group),
                confidence=max(l.confidence for l in group)
            )
        else:
            x = sum(l.start[0] for l in group) / len(group)
            y1 = min(min(l.start[1], l.end[1]) for l in group)
            y2 = max(max(l.start[1], l.end[1]) for l in group)
            return Line(
                start=(x, y1),
                end=(x, y2),
                orientation='vertical',
                thickness=max(l.thickness for l in group),
                confidence=max(l.confidence for l in group)
            )
    
    def _calculate_bbox(
        self, 
        h_lines: List[Line], 
        v_lines: List[Line]
    ) -> Tuple[float, float, float, float]:
        """테이블 전체 경계 계산"""
        if not h_lines and not v_lines:
            return (0, 0, 0, 0)
        
        all_x = []
        all_y = []
        
        for line in h_lines + v_lines:
            all_x.extend([line.start[0], line.end[0]])
            all_y.extend([line.start[1], line.end[1]])
        
        return (min(all_x), min(all_y), max(all_x), max(all_y))
```

### 3.2 Cell Segmentor (셀 분할기)

교차점 기반으로 셀 영역을 분할하는 모듈입니다.

```python
from dataclasses import dataclass, field
from typing import List, Tuple, Optional
import numpy as np

@dataclass
class CellBbox:
    """셀 경계 상자"""
    row_idx: int
    col_idx: int
    x0: float
    y0: float
    x1: float
    y1: float
    
    @property
    def width(self) -> float:
        return self.x1 - self.x0
    
    @property
    def height(self) -> float:
        return self.y1 - self.y0
    
    @property
    def center(self) -> Tuple[float, float]:
        return ((self.x0 + self.x1) / 2, (self.y0 + self.y1) / 2)

@dataclass
class MergedCell:
    """병합된 셀 정보"""
    row_start: int
    row_end: int
    col_start: int
    col_end: int
    bbox: CellBbox


class TableCellSegmentor:
    """교차점 기반 셀 영역 분할기"""
    
    def __init__(self, tolerance: float = 5.0):
        """
        Args:
            tolerance: 교차점 클러스터링 허용 오차
        """
        self.tolerance = tolerance
    
    def segment_cells(
        self, 
        h_lines: List[Line], 
        v_lines: List[Line]
    ) -> List[CellBbox]:
        """
        수평/수직 선의 교차점으로 셀 영역 계산
        
        알고리즘:
        1. 모든 교차점 계산
        2. 교차점들을 그리드로 정렬
        3. 인접한 4개 교차점으로 셀 영역 정의
        
        Args:
            h_lines: 수평선 목록
            v_lines: 수직선 목록
            
        Returns:
            List[CellBbox]: 셀 경계 상자 목록
        """
        # 1. 교차점 계산
        intersections = self._find_intersections(h_lines, v_lines)
        
        if len(intersections) < 4:
            return []
        
        # 2. 교차점 클러스터링 및 정렬
        grid_x = self._cluster_coordinates([p[0] for p in intersections])
        grid_y = self._cluster_coordinates([p[1] for p in intersections])
        
        # 3. 셀 생성
        cells = []
        for row_idx in range(len(grid_y) - 1):
            for col_idx in range(len(grid_x) - 1):
                cell = CellBbox(
                    row_idx=row_idx,
                    col_idx=col_idx,
                    x0=grid_x[col_idx],
                    y0=grid_y[row_idx],
                    x1=grid_x[col_idx + 1],
                    y1=grid_y[row_idx + 1]
                )
                cells.append(cell)
        
        return cells
    
    def detect_merged_cells(
        self, 
        cells: List[CellBbox], 
        lines: TableLines
    ) -> List[MergedCell]:
        """
        병합 셀 감지
        
        조건: 내부에 구분선이 없는 연속된 셀 영역
        
        Args:
            cells: 기본 셀 목록
            lines: 테이블 구분선 정보
            
        Returns:
            List[MergedCell]: 병합 셀 목록
        """
        if not cells:
            return []
        
        merged_cells = []
        visited = set()
        
        for cell in cells:
            key = (cell.row_idx, cell.col_idx)
            if key in visited:
                continue
            
            # 오른쪽/아래로 확장 시도
            row_end = cell.row_idx
            col_end = cell.col_idx
            
            # 오른쪽 확장
            while self._can_merge_right(cell, col_end, cells, lines):
                col_end += 1
            
            # 아래쪽 확장
            while self._can_merge_down(cell, row_end, col_end, cells, lines):
                row_end += 1
            
            # 병합 셀인 경우
            if row_end > cell.row_idx or col_end > cell.col_idx:
                # 병합된 영역의 모든 셀 마킹
                for r in range(cell.row_idx, row_end + 1):
                    for c in range(cell.col_idx, col_end + 1):
                        visited.add((r, c))
                
                # 병합 셀 bbox 계산
                merged_bbox = self._calculate_merged_bbox(
                    cell.row_idx, row_end,
                    cell.col_idx, col_end,
                    cells
                )
                
                merged_cells.append(MergedCell(
                    row_start=cell.row_idx,
                    row_end=row_end,
                    col_start=cell.col_idx,
                    col_end=col_end,
                    bbox=merged_bbox
                ))
            else:
                visited.add(key)
        
        return merged_cells
    
    def _find_intersections(
        self, 
        h_lines: List[Line], 
        v_lines: List[Line]
    ) -> List[Tuple[float, float]]:
        """모든 교차점 찾기"""
        intersections = []
        
        for h_line in h_lines:
            for v_line in v_lines:
                # 교차 여부 확인
                h_y = h_line.start[1]
                v_x = v_line.start[0]
                
                h_x_min = min(h_line.start[0], h_line.end[0])
                h_x_max = max(h_line.start[0], h_line.end[0])
                v_y_min = min(v_line.start[1], v_line.end[1])
                v_y_max = max(v_line.start[1], v_line.end[1])
                
                if h_x_min <= v_x <= h_x_max and v_y_min <= h_y <= v_y_max:
                    intersections.append((v_x, h_y))
        
        return intersections
    
    def _cluster_coordinates(self, coords: List[float]) -> List[float]:
        """좌표 클러스터링 및 정렬"""
        if not coords:
            return []
        
        coords = sorted(set(coords))
        clusters = []
        current_cluster = [coords[0]]
        
        for coord in coords[1:]:
            if coord - current_cluster[-1] <= self.tolerance:
                current_cluster.append(coord)
            else:
                clusters.append(sum(current_cluster) / len(current_cluster))
                current_cluster = [coord]
        
        if current_cluster:
            clusters.append(sum(current_cluster) / len(current_cluster))
        
        return clusters
    
    def _can_merge_right(
        self, 
        start_cell: CellBbox, 
        current_col: int,
        cells: List[CellBbox], 
        lines: TableLines
    ) -> bool:
        """오른쪽 셀과 병합 가능 여부"""
        # 오른쪽 경계에 수직선이 없으면 병합 가능
        right_x = None
        for cell in cells:
            if cell.col_idx == current_col and cell.row_idx == start_cell.row_idx:
                right_x = cell.x1
                break
        
        if right_x is None:
            return False
        
        # 해당 x 좌표에 수직선이 있는지 확인
        for v_line in lines.vertical:
            if abs(v_line.start[0] - right_x) < self.tolerance:
                # 선이 셀 영역과 겹치는지 확인
                v_y_min = min(v_line.start[1], v_line.end[1])
                v_y_max = max(v_line.start[1], v_line.end[1])
                
                if v_y_min <= start_cell.y0 and v_y_max >= start_cell.y1:
                    return False  # 구분선 있음
        
        return True
    
    def _can_merge_down(
        self, 
        start_cell: CellBbox, 
        current_row: int,
        col_end: int,
        cells: List[CellBbox], 
        lines: TableLines
    ) -> bool:
        """아래쪽 셀과 병합 가능 여부"""
        # 아래쪽 경계에 수평선이 없으면 병합 가능
        bottom_y = None
        for cell in cells:
            if cell.row_idx == current_row and cell.col_idx == start_cell.col_idx:
                bottom_y = cell.y1
                break
        
        if bottom_y is None:
            return False
        
        # 해당 y 좌표에 수평선이 있는지 확인
        for h_line in lines.horizontal:
            if abs(h_line.start[1] - bottom_y) < self.tolerance:
                h_x_min = min(h_line.start[0], h_line.end[0])
                h_x_max = max(h_line.start[0], h_line.end[0])
                
                if h_x_min <= start_cell.x0 and h_x_max >= start_cell.x1:
                    return False  # 구분선 있음
        
        return True
    
    def _calculate_merged_bbox(
        self,
        row_start: int,
        row_end: int,
        col_start: int,
        col_end: int,
        cells: List[CellBbox]
    ) -> CellBbox:
        """병합된 셀의 bbox 계산"""
        x0 = float('inf')
        y0 = float('inf')
        x1 = float('-inf')
        y1 = float('-inf')
        
        for cell in cells:
            if (row_start <= cell.row_idx <= row_end and
                col_start <= cell.col_idx <= col_end):
                x0 = min(x0, cell.x0)
                y0 = min(y0, cell.y0)
                x1 = max(x1, cell.x1)
                y1 = max(y1, cell.y1)
        
        return CellBbox(
            row_idx=row_start,
            col_idx=col_start,
            x0=x0, y0=y0, x1=x1, y1=y1
        )
```

### 3.3 Coordinate Manager (좌표 관리자)

셀 좌표 정보를 JSON으로 저장/로드하는 모듈입니다.

```python
from dataclasses import dataclass, field, asdict
from typing import List, Optional, Dict, Any
from pathlib import Path
import json
import hashlib
from datetime import datetime

@dataclass
class CellCoordinate:
    """셀 좌표 정보"""
    row_start: int
    row_end: int      # 병합 셀의 경우 row_end > row_start
    col_start: int
    col_end: int      # 병합 셀의 경우 col_end > col_start
    bbox: tuple       # (x0, y0, x1, y1)
    confidence: float = 1.0  # 검출 신뢰도
    text: str = ""    # 매핑된 텍스트 (선택적)

@dataclass 
class TableStructureMetadata:
    """표 구조 메타데이터 (JSON 저장용)"""
    pdf_hash: str
    page_num: int
    table_index: int
    total_rows: int
    total_cols: int
    cells: List[Dict[str, Any]]
    row_heights: List[float]
    col_widths: List[float]
    detection_method: str  # "vector", "hough", "hybrid"
    created_at: str
    version: str = "1.0"


class CoordinateManager:
    """좌표 정보 저장/로드 관리자"""
    
    def __init__(self, cache_dir: Optional[Path] = None):
        """
        Args:
            cache_dir: 메타데이터 캐시 디렉토리
        """
        self.cache_dir = cache_dir or Path("./table_cache")
        self.cache_dir.mkdir(parents=True, exist_ok=True)
    
    def save_to_json(
        self, 
        metadata: TableStructureMetadata, 
        path: Optional[Path] = None
    ) -> Path:
        """
        메타데이터를 JSON 파일로 저장
        
        Args:
            metadata: 표 구조 메타데이터
            path: 저장 경로 (None이면 캐시 디렉토리에 자동 생성)
            
        Returns:
            Path: 저장된 파일 경로
        """
        if path is None:
            filename = f"{metadata.pdf_hash}_p{metadata.page_num}_t{metadata.table_index}.json"
            path = self.cache_dir / filename
        
        data = {
            "pdf_hash": metadata.pdf_hash,
            "page_num": metadata.page_num,
            "table_index": metadata.table_index,
            "structure": {
                "rows": metadata.total_rows,
                "cols": metadata.total_cols,
                "row_heights": metadata.row_heights,
                "col_widths": metadata.col_widths
            },
            "cells": metadata.cells,
            "detection_info": {
                "method": metadata.detection_method,
                "created_at": metadata.created_at,
                "version": metadata.version
            }
        }
        
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        
        return path
    
    def load_from_json(self, path: Path) -> Optional[TableStructureMetadata]:
        """
        JSON 파일에서 메타데이터 로드
        
        Args:
            path: JSON 파일 경로
            
        Returns:
            TableStructureMetadata: 로드된 메타데이터
        """
        if not path.exists():
            return None
        
        with open(path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        return TableStructureMetadata(
            pdf_hash=data["pdf_hash"],
            page_num=data["page_num"],
            table_index=data["table_index"],
            total_rows=data["structure"]["rows"],
            total_cols=data["structure"]["cols"],
            cells=data["cells"],
            row_heights=data["structure"]["row_heights"],
            col_widths=data["structure"]["col_widths"],
            detection_method=data["detection_info"]["method"],
            created_at=data["detection_info"]["created_at"],
            version=data["detection_info"].get("version", "1.0")
        )
    
    def find_cached(
        self, 
        pdf_hash: str, 
        page_num: int, 
        table_index: int = 0
    ) -> Optional[TableStructureMetadata]:
        """
        캐시에서 메타데이터 검색
        
        Args:
            pdf_hash: PDF 파일 해시
            page_num: 페이지 번호
            table_index: 테이블 인덱스
            
        Returns:
            캐시된 메타데이터 또는 None
        """
        filename = f"{pdf_hash}_p{page_num}_t{table_index}.json"
        path = self.cache_dir / filename
        return self.load_from_json(path)
    
    @staticmethod
    def create_pdf_hash(pdf_path: str) -> str:
        """
        PDF 파일의 해시 생성
        
        Args:
            pdf_path: PDF 파일 경로
            
        Returns:
            str: SHA-256 해시 (처음 16자)
        """
        with open(pdf_path, 'rb') as f:
            content = f.read()
        
        return hashlib.sha256(content).hexdigest()[:16]
    
    def create_metadata(
        self,
        pdf_hash: str,
        page_num: int,
        table_index: int,
        cells: List[CellBbox],
        merged_cells: List[MergedCell],
        detection_method: str
    ) -> TableStructureMetadata:
        """
        셀 정보로부터 메타데이터 생성
        
        Args:
            pdf_hash: PDF 해시
            page_num: 페이지 번호
            table_index: 테이블 인덱스
            cells: 셀 목록
            merged_cells: 병합 셀 목록
            detection_method: 검출 방법
            
        Returns:
            TableStructureMetadata: 생성된 메타데이터
        """
        if not cells:
            return None
        
        # 행/열 수 계산
        total_rows = max(c.row_idx for c in cells) + 1
        total_cols = max(c.col_idx for c in cells) + 1
        
        # 행 높이, 열 너비 계산
        row_heights = []
        col_widths = []
        
        for row in range(total_rows):
            row_cells = [c for c in cells if c.row_idx == row]
            if row_cells:
                row_heights.append(max(c.height for c in row_cells))
            else:
                row_heights.append(0)
        
        for col in range(total_cols):
            col_cells = [c for c in cells if c.col_idx == col]
            if col_cells:
                col_widths.append(max(c.width for c in col_cells))
            else:
                col_widths.append(0)
        
        # 셀 정보 변환
        cell_data = []
        
        # 병합 셀 처리
        merged_coords = set()
        for mc in merged_cells:
            for r in range(mc.row_start, mc.row_end + 1):
                for c in range(mc.col_start, mc.col_end + 1):
                    merged_coords.add((r, c))
            
            cell_data.append({
                "row_span": [mc.row_start, mc.row_end],
                "col_span": [mc.col_start, mc.col_end],
                "bbox": [mc.bbox.x0, mc.bbox.y0, mc.bbox.x1, mc.bbox.y1],
                "is_merged": True
            })
        
        # 일반 셀 처리
        for cell in cells:
            if (cell.row_idx, cell.col_idx) not in merged_coords:
                cell_data.append({
                    "row_span": [cell.row_idx, cell.row_idx],
                    "col_span": [cell.col_idx, cell.col_idx],
                    "bbox": [cell.x0, cell.y0, cell.x1, cell.y1],
                    "is_merged": False
                })
        
        return TableStructureMetadata(
            pdf_hash=pdf_hash,
            page_num=page_num,
            table_index=table_index,
            total_rows=total_rows,
            total_cols=total_cols,
            cells=cell_data,
            row_heights=row_heights,
            col_widths=col_widths,
            detection_method=detection_method,
            created_at=datetime.now().isoformat()
        )
```

### 3.4 Text Mapper (텍스트 매퍼)

OCR/텍스트 추출 결과를 셀에 매핑하는 모듈입니다.

```python
from dataclasses import dataclass
from typing import List, Dict, Tuple, Optional
import re

@dataclass
class WordInfo:
    """단어 정보 (좌표 포함)"""
    text: str
    x0: float
    y0: float
    x1: float
    y1: float
    
    @property
    def center(self) -> Tuple[float, float]:
        return ((self.x0 + self.x1) / 2, (self.y0 + self.y1) / 2)


class CellTextMapper:
    """OCR/텍스트 추출 결과를 셀에 매핑"""
    
    def __init__(self, overlap_threshold: float = 0.5):
        """
        Args:
            overlap_threshold: 셀 귀속 판정을 위한 최소 겹침 비율
        """
        self.overlap_threshold = overlap_threshold
    
    def map_text_to_cells(
        self, 
        words: List[WordInfo],
        cells: List[Dict]  # 메타데이터의 cells
    ) -> Dict[Tuple[int, int], str]:
        """
        텍스트를 해당 셀에 매핑
        
        매핑 전략:
        1. 단어 중심점이 셀 영역 내에 있으면 해당 셀에 배치
        2. 경계에 걸친 단어는 더 많이 겹치는 셀에 배치
        3. 셀 내 단어들은 y→x 순서로 정렬하여 연결
        
        Args:
            words: OCR 결과 (좌표 포함)
            cells: 셀 메타데이터 목록
            
        Returns:
            Dict[(row, col), text]: 셀별 텍스트
        """
        cell_words: Dict[Tuple[int, int], List[WordInfo]] = {}
        
        for word in words:
            best_cell = None
            best_overlap = 0
            
            for cell in cells:
                row_span = cell["row_span"]
                col_span = cell["col_span"]
                bbox = cell["bbox"]
                
                overlap = self._calculate_overlap(word, bbox)
                
                if overlap > best_overlap:
                    best_overlap = overlap
                    best_cell = (row_span[0], col_span[0])
            
            if best_cell and best_overlap > self.overlap_threshold:
                if best_cell not in cell_words:
                    cell_words[best_cell] = []
                cell_words[best_cell].append(word)
        
        # 각 셀의 단어들을 읽기 순서로 정렬하여 텍스트 생성
        result = {}
        for cell_key, words_list in cell_words.items():
            text = self._words_to_text(words_list)
            result[cell_key] = text
        
        return result
    
    def handle_multiline_cells(
        self, 
        bbox: Tuple[float, float, float, float],
        words: List[WordInfo],
        line_threshold: float = 10.0
    ) -> str:
        """
        셀 내 여러 줄 텍스트 처리
        
        줄바꿈 감지: y 좌표 차이가 임계값 이상이면 새 줄
        
        Args:
            bbox: 셀 경계 (x0, y0, x1, y1)
            words: 셀 내 단어들
            line_threshold: 줄 구분 임계값
            
        Returns:
            str: 줄바꿈이 포함된 텍스트
        """
        if not words:
            return ""
        
        # y 좌표로 정렬
        sorted_words = sorted(words, key=lambda w: (w.y0, w.x0))
        
        lines = []
        current_line = [sorted_words[0]]
        current_y = sorted_words[0].y0
        
        for word in sorted_words[1:]:
            if word.y0 - current_y > line_threshold:
                # 새 줄
                lines.append(current_line)
                current_line = [word]
                current_y = word.y0
            else:
                current_line.append(word)
        
        if current_line:
            lines.append(current_line)
        
        # 각 줄을 x 좌표로 정렬하여 텍스트 생성
        text_lines = []
        for line in lines:
            line.sort(key=lambda w: w.x0)
            text_lines.append(' '.join(w.text for w in line))
        
        return '\n'.join(text_lines)
    
    def _calculate_overlap(
        self, 
        word: WordInfo, 
        bbox: List[float]
    ) -> float:
        """단어와 셀의 겹침 비율 계산"""
        x0, y0, x1, y1 = bbox
        
        # 겹치는 영역 계산
        overlap_x0 = max(word.x0, x0)
        overlap_y0 = max(word.y0, y0)
        overlap_x1 = min(word.x1, x1)
        overlap_y1 = min(word.y1, y1)
        
        if overlap_x0 >= overlap_x1 or overlap_y0 >= overlap_y1:
            return 0.0
        
        overlap_area = (overlap_x1 - overlap_x0) * (overlap_y1 - overlap_y0)
        word_area = (word.x1 - word.x0) * (word.y1 - word.y0)
        
        if word_area == 0:
            return 0.0
        
        return overlap_area / word_area
    
    def _words_to_text(self, words: List[WordInfo]) -> str:
        """단어 목록을 텍스트로 변환"""
        if not words:
            return ""
        
        # y → x 순서로 정렬
        sorted_words = sorted(words, key=lambda w: (w.y0, w.x0))
        return ' '.join(w.text for w in sorted_words)
```

### 3.5 Table Builder (표 구성기)

최종 표 구조를 구성하는 모듈입니다.

```python
from dataclasses import dataclass
from typing import List, Dict, Tuple, Optional

@dataclass
class TableCell:
    """최종 표 셀"""
    row: int
    col: int
    rowspan: int
    colspan: int
    text: str
    bbox: Tuple[float, float, float, float]

@dataclass
class Table:
    """복원된 표"""
    rows: int
    cols: int
    cells: List[TableCell]
    
    def to_markdown(self) -> str:
        """마크다운 표로 변환"""
        # 2D 그리드 생성
        grid = [['' for _ in range(self.cols)] for _ in range(self.rows)]
        
        for cell in self.cells:
            grid[cell.row][cell.col] = cell.text
        
        # 마크다운 생성
        lines = []
        
        # 헤더 행
        header = '| ' + ' | '.join(grid[0]) + ' |'
        lines.append(header)
        
        # 구분선
        separator = '|' + '|'.join(['---'] * self.cols) + '|'
        lines.append(separator)
        
        # 데이터 행
        for row in grid[1:]:
            line = '| ' + ' | '.join(row) + ' |'
            lines.append(line)
        
        return '\n'.join(lines)
    
    def to_html(self) -> str:
        """HTML 표로 변환"""
        lines = ['<table border="1">']
        
        # 셀 위치 매핑
        cell_map = {}
        for cell in self.cells:
            cell_map[(cell.row, cell.col)] = cell
        
        # 이미 병합된 셀 추적
        merged = set()
        
        for row in range(self.rows):
            lines.append('  <tr>')
            
            for col in range(self.cols):
                if (row, col) in merged:
                    continue
                
                cell = cell_map.get((row, col))
                
                if cell:
                    # 병합 처리
                    for r in range(cell.row, cell.row + cell.rowspan):
                        for c in range(cell.col, cell.col + cell.colspan):
                            if (r, c) != (row, col):
                                merged.add((r, c))
                    
                    # 셀 태그 생성
                    attrs = []
                    if cell.rowspan > 1:
                        attrs.append(f'rowspan="{cell.rowspan}"')
                    if cell.colspan > 1:
                        attrs.append(f'colspan="{cell.colspan}"')
                    
                    attr_str = ' ' + ' '.join(attrs) if attrs else ''
                    tag = 'th' if row == 0 else 'td'
                    
                    lines.append(f'    <{tag}{attr_str}>{cell.text}</{tag}>')
                else:
                    tag = 'th' if row == 0 else 'td'
                    lines.append(f'    <{tag}></{tag}>')
            
            lines.append('  </tr>')
        
        lines.append('</table>')
        return '\n'.join(lines)
    
    def to_json(self) -> Dict:
        """JSON 형식으로 변환"""
        return {
            "rows": self.rows,
            "cols": self.cols,
            "cells": [
                {
                    "row": c.row,
                    "col": c.col,
                    "rowspan": c.rowspan,
                    "colspan": c.colspan,
                    "text": c.text,
                    "bbox": list(c.bbox)
                }
                for c in self.cells
            ]
        }


class TableBuilder:
    """표 구조 구성기"""
    
    def build_table(
        self,
        metadata: TableStructureMetadata,
        cell_texts: Dict[Tuple[int, int], str]
    ) -> Table:
        """
        메타데이터와 텍스트로 최종 표 구성
        
        Args:
            metadata: 표 구조 메타데이터
            cell_texts: 셀별 텍스트 {(row, col): text}
            
        Returns:
            Table: 복원된 표
        """
        cells = []
        
        for cell_data in metadata.cells:
            row_span = cell_data["row_span"]
            col_span = cell_data["col_span"]
            bbox = tuple(cell_data["bbox"])
            
            row = row_span[0]
            col = col_span[0]
            rowspan = row_span[1] - row_span[0] + 1
            colspan = col_span[1] - col_span[0] + 1
            
            text = cell_texts.get((row, col), "")
            
            cells.append(TableCell(
                row=row,
                col=col,
                rowspan=rowspan,
                colspan=colspan,
                text=text,
                bbox=bbox
            ))
        
        return Table(
            rows=metadata.total_rows,
            cols=metadata.total_cols,
            cells=cells
        )
    
    def validate_structure(self, table: Table) -> Tuple[bool, List[str]]:
        """
        표 구조 유효성 검증
        
        Returns:
            Tuple[bool, List[str]]: (유효 여부, 오류 메시지 목록)
        """
        errors = []
        
        # 1. 모든 셀이 범위 내에 있는지 확인
        for cell in table.cells:
            if cell.row < 0 or cell.row >= table.rows:
                errors.append(f"Invalid row index: {cell.row}")
            if cell.col < 0 or cell.col >= table.cols:
                errors.append(f"Invalid col index: {cell.col}")
            if cell.row + cell.rowspan > table.rows:
                errors.append(f"Rowspan exceeds table: row={cell.row}, span={cell.rowspan}")
            if cell.col + cell.colspan > table.cols:
                errors.append(f"Colspan exceeds table: col={cell.col}, span={cell.colspan}")
        
        # 2. 셀 중복 확인
        occupied = set()
        for cell in table.cells:
            for r in range(cell.row, cell.row + cell.rowspan):
                for c in range(cell.col, cell.col + cell.colspan):
                    if (r, c) in occupied:
                        errors.append(f"Overlapping cells at ({r}, {c})")
                    occupied.add((r, c))
        
        # 3. 빈 셀 확인
        for r in range(table.rows):
            for c in range(table.cols):
                if (r, c) not in occupied:
                    errors.append(f"Missing cell at ({r}, {c})")
        
        return len(errors) == 0, errors
```

---

## 4. 처리 파이프라인

```
PDF 파일 입력
      │
      ▼
┌─────────────────────────────────────────────────────────────────┐
│ 1단계: 선 검출                                                    │
│   ├─ 벡터 PDF → get_drawings()로 직접 선 추출 (정확도 높음)       │
│   └─ 스캔 PDF → 이미지 변환 후 Hough Transform (OCR 필요)        │
└─────────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2단계: 셀 영역 구획                                               │
│   ├─ 수평선 + 수직선 교차점 계산                                  │
│   ├─ 교차점 그리드 정렬 (tolerance 기반 클러스터링)                │
│   └─ 병합 셀 감지 (내부 구분선 없는 영역)                         │
└─────────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3단계: 좌표 정보 저장                                             │
│   ├─ 셀별 bbox, row_span, col_span 계산                          │
│   └─ JSON 메타데이터 파일로 저장                                  │
└─────────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────────┐
│ 4단계: 텍스트 추출 (별도 프로세스)                                 │
│   ├─ 텍스트 레이어 PDF → pdfplumber로 단어+좌표 추출              │
│   └─ 스캔 PDF → PaddleOCR로 단어+좌표 추출                       │
└─────────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────────┐
│ 5단계: 텍스트 ↔ 셀 매핑                                           │
│   ├─ 저장된 셀 좌표 정보 로드                                     │
│   ├─ 각 단어의 중심점이 속하는 셀 결정                            │
│   └─ 셀 내 단어들을 읽기 순서로 정렬하여 결합                     │
└─────────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────────┐
│ 6단계: 표 구조 복원                                               │
│   ├─ row_span/col_span 기반으로 표 구조 재구성                   │
│   └─ Markdown/HTML/JSON 출력                                     │
└─────────────────────────────────────────────────────────────────┘
      │
      ▼
  복원된 표 출력
```

---

## 5. JSON 메타데이터 스키마

### 5.1 스키마 정의

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "pdf_hash": { 
      "type": "string", 
      "description": "원본 PDF 파일 해시 (SHA-256 앞 16자)" 
    },
    "page_num": { 
      "type": "integer",
      "description": "페이지 번호 (1-based)"
    },
    "table_index": { 
      "type": "integer",
      "description": "페이지 내 테이블 인덱스 (0-based)"
    },
    "detection_info": {
      "type": "object",
      "properties": {
        "method": { 
          "enum": ["vector", "hough", "hybrid", "ml"],
          "description": "검출 방법"
        },
        "created_at": { 
          "type": "string", 
          "format": "date-time" 
        },
        "version": { 
          "type": "string",
          "description": "메타데이터 스키마 버전"
        }
      }
    },
    "structure": {
      "type": "object",
      "properties": {
        "rows": { "type": "integer" },
        "cols": { "type": "integer" },
        "row_heights": { 
          "type": "array", 
          "items": { "type": "number" } 
        },
        "col_widths": { 
          "type": "array", 
          "items": { "type": "number" } 
        }
      }
    },
    "cells": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "row_span": { 
            "type": "array", 
            "items": { "type": "integer" }, 
            "minItems": 2, 
            "maxItems": 2,
            "description": "[시작행, 종료행]"
          },
          "col_span": { 
            "type": "array", 
            "items": { "type": "integer" }, 
            "minItems": 2, 
            "maxItems": 2,
            "description": "[시작열, 종료열]"
          },
          "bbox": { 
            "type": "array", 
            "items": { "type": "number" }, 
            "minItems": 4, 
            "maxItems": 4,
            "description": "[x0, y0, x1, y1]"
          },
          "is_merged": {
            "type": "boolean",
            "description": "병합 셀 여부"
          },
          "text": { 
            "type": "string",
            "description": "셀 텍스트 (선택적)"
          }
        }
      }
    }
  }
}
```

### 5.2 예시 메타데이터

```json
{
  "pdf_hash": "a1b2c3d4e5f6g7h8",
  "page_num": 1,
  "table_index": 0,
  "detection_info": {
    "method": "hybrid",
    "created_at": "2026-01-27T10:30:00Z",
    "version": "1.0"
  },
  "structure": {
    "rows": 5,
    "cols": 4,
    "row_heights": [25.0, 30.0, 30.0, 35.0, 28.0],
    "col_widths": [50.0, 120.0, 150.0, 80.0]
  },
  "cells": [
    {
      "row_span": [0, 0],
      "col_span": [0, 0],
      "bbox": [10.0, 100.0, 60.0, 125.0],
      "is_merged": false,
      "text": "번호"
    },
    {
      "row_span": [0, 0],
      "col_span": [1, 1],
      "bbox": [60.0, 100.0, 180.0, 125.0],
      "is_merged": false,
      "text": "항목명"
    },
    {
      "row_span": [1, 2],
      "col_span": [0, 0],
      "bbox": [10.0, 125.0, 60.0, 185.0],
      "is_merged": true,
      "text": "1"
    }
  ]
}
```

---

## 6. 기대 효과 (복원율 상승 수준)

### 6.1 현재 방식의 한계

| 문제 유형 | 현재 복원율 | 발생 원인 |
|:---|:---:|:---|
| **행 붕괴** | 40~60% | pdfplumber가 y좌표 기준 행 분리 실패 |
| **열 정렬 오류** | 50~70% | 셀 내용 길이 불균일로 열 경계 오인식 |
| **병합 셀 손실** | 30~50% | rowspan/colspan 정보 누락 |
| **빈 셀 누락** | 60~70% | 내용 없는 셀은 감지 자체가 안됨 |

### 6.2 선 검출 기반 방식의 개선 효과

| 문제 유형 | 예상 복원율 | 개선 폭 | 개선 원리 |
|:---|:---:|:---:|:---|
| **행 붕괴** | **85~95%** | +35~40%p | 수평 구분선으로 행 경계 명확화 |
| **열 정렬 오류** | **90~95%** | +25~35%p | 수직 구분선으로 열 경계 확정 |
| **병합 셀 손실** | **80~90%** | +40~50%p | 내부 선 유무로 병합 영역 감지 |
| **빈 셀 누락** | **95~100%** | +30~35%p | 선으로 정의된 영역은 빈 셀도 인식 |

### 6.3 PDF 유형별 기대 효과

| PDF 유형 | 현재 | 개선 후 | 비고 |
|:---|:---:|:---:|:---|
| **벡터 PDF (디지털 생성)** | 70% | **95%+** | 선 정보가 명확하여 최고 효과 |
| **스캔 PDF (고품질 300dpi+)** | 50% | **85~90%** | Hough Transform 효과적 |
| **스캔 PDF (저품질 150dpi)** | 35% | **70~80%** | 이미지 전처리 필요 |
| **복잡한 표 (병합 셀 다수)** | 30% | **80~85%** | 병합 셀 감지 로직 핵심 |
| **테두리 없는 표** | 20% | **50~60%** | 공백 기반 분석 필요 (한계) |

---

## 7. Edge Cases 처리

### 7.1 테두리 없는 표

공백 패턴 분석으로 열 경계 추정:

```python
def detect_borderless_table(words: List[WordInfo]) -> List[float]:
    """공백 기반 열 경계 추정"""
    # 1. 모든 단어의 x 좌표 수집
    # 2. 단어 사이 큰 공백 찾기
    # 3. 공백 위치를 열 경계로 사용
    pass
```

### 7.2 점선/파선 테두리

짧은 선분 그룹화 알고리즘:

```python
def merge_dashed_lines(short_lines: List[Line]) -> List[Line]:
    """점선/파선을 연속 선으로 병합"""
    # 1. 같은 방향의 짧은 선분들 그룹화
    # 2. 일정 간격 내 선분들 연결
    # 3. 연결된 선을 하나의 구분선으로 처리
    pass
```

### 7.3 색상 배경 표

색상 변화 경계를 선으로 변환:

```python
def detect_color_boundaries(image: np.ndarray) -> TableLines:
    """색상 변화 경계 검출"""
    # 1. 색상 공간 변환 (HSV/LAB)
    # 2. 엣지 검출 (Canny)
    # 3. 엣지를 선으로 변환
    pass
```

### 7.4 중첩 표

깊이 우선 탐색으로 내부 표 분리:

```python
def separate_nested_tables(cells: List[CellBbox]) -> List[List[CellBbox]]:
    """중첩된 표 분리"""
    # 1. 셀 크기 분석
    # 2. 큰 셀 내부에 작은 셀 그룹 찾기
    # 3. 각 그룹을 별도 표로 처리
    pass
```

---

## 8. 향후 확장 계획

### 8.1 딥러닝 통합 (선택적)

정확도 추가 향상을 위한 ML 모델 통합:

| 모델 | 용도 | 정확도 향상 |
|:---|:---|:---:|
| **TableNet** | End-to-end 표 감지 | +5~10%p |
| **TabStruct-Net** | 표 구조 인식 | +7~12%p |
| **YOLO-Table** | 실시간 표 위치 감지 | +3~5%p |

### 8.2 성능 최적화

- **병렬 처리**: 멀티페이지 동시 처리
- **캐싱 전략**: 메타데이터 캐시로 재처리 방지
- **점진적 처리**: 대용량 PDF 스트리밍 처리

---

## 문서 정보

- **버전**: 1.0
- **작성일**: 2026-01-27
- **작성자**: PDF OCR 프로젝트 팀
