# [Project] EcoMonitor AI: UI/UX Design Strategy & Prompt Guide

## 1. 개요 (Overview)

본 문서는 **EcoMonitor AI** 플랫폼의 프론트엔드 디자인 전략과 AI 기반 코드 생성을 위한 프롬프트 가이드를 정의한다.
1인 개발 환경을 고려하여 **"v0.dev + Tailwind CSS"**를 활용한 고효율 개발 프로세스를 채택하며, **"Warm Glass (따뜻한 유리)"** 컨셉을 통해 세련되고 신뢰감 있는 환경 규제 모니터링 대시보드를 구축하는 것을 목표로 한다.

---

## 2. 기술 스택 및 도구 (Tools & Tech Stack)

| 구분             | 추천 도구           | 선정 이유                                                                                        |
| :--------------- | :------------------ | :----------------------------------------------------------------------------------------------- |
| **UI Generator** | **v0.dev (Vercel)** | 텍스트 프롬프트만으로 React + Tailwind 코드를 즉시 생성. 디자인 시안 없이 바로 코드로 구현 가능. |
| **Framework**    | **Next.js / React** | 컴포넌트 기반 재사용성 및 최신 웹 표준 준수.                                                     |
| **Styling**      | **Tailwind CSS**    | 유틸리티 클래스를 사용하여 Glassmorphism 및 커스텀 색상(미색)을 빠르게 적용.                     |
| **Component**    | **shadcn/ui**       | v0.dev의 기본 라이브러리. 접근성이 좋고 디자인 커스터마이징이 용이함.                            |
| **Icons**        | **Lucide React**    | 깔끔하고 얇은 선의 아이콘으로 전문적인 분석 툴의 느낌 강조.                                      |
| **Font**         | **Pretendard**      | 국문/영문 혼용 시 가독성이 가장 뛰어나며, 시스템 폰트(San Francisco/Inter)와 유사한 느낌.        |

---

## 3. 디자인 시스템 컨셉 (Design System: EcoMonitor Warm Glass)

차가운 느낌의 일반적인 Admin 대시보드를 지양하고, **부드럽고 고급스러운 미색(Off-white) 배경**과 **유리 질감(Glassmorphism)**을 결합하여 장시간 사용에도 눈이 편안한 디자인을 추구한다.

### 3.1. Color Palette

- **Background (Canvas):** `#F9F9F7` (Stone-50) 또는 `#FDFCF8` (아주 연한 크림색)
  - _Note:_ 절대 완전한 흰색(`#FFFFFF`)을 배경으로 쓰지 않는다.
- **Surface (Glass Card):** `bg-white/40` (흰색 40% 투명도) + `backdrop-blur-xl` (블러 처리)
- **Border (Glass Edge):** `border-white/60` (빛 반사 느낌)
- **Primary (Point):** `#4A5D4F` (Deep Forest Green: 신뢰, 환경) 또는 `#D4A373` (Sand Beige: 안정감)
- **Text:** `#292524` (Stone-800: 진한 회갈색) - 검정색 대신 사용하여 부드러움 강조.

### 3.2. Shape & Elevation

- **Radius:** `rounded-3xl` (컨테이너), `rounded-2xl` (버튼/카드). 전체적으로 둥근 형태.
- **Shadow:** `shadow-lg`, `shadow-stone-200/50`. 퍼지는 형태의 부드러운 그림자로 공중에 뜬 느낌 연출.

### 3.3. Interaction (Hover/Focus/Active Micro-Interaction)

“Warm Glass” 컨셉은 **과하지 않은 미세 인터랙션**으로 완성된다. 모든 입력/버튼/태그는 아래 규칙을 따른다.

- **Hover(마우스 오버)**: 배경 투명도 소폭 증가 + 부드러운 그림자(`shadow-stone-200/40`) + 아주 미세한 상승(필요 시 `-translate-y-0.5`)
- **Focus(포커스)**: `ring-2 ring-primary/20`로 은은한 하이라이트(접근성 위해 `focus-visible` 권장)
- **Active(클릭)**: 과하지 않은 축소(`active:scale-95` 또는 `active:scale-[0.99]`)

#### 공통 유틸 클래스(재사용)

프로젝트에서는 아래 클래스를 우선 사용한다. (정의: `frontend/app/globals.css`)

- **`.glass-button`**: 글래스 버튼(hover/focus/active 포함)
- **`.ui-field`**: input/select 공통 스타일 + hover/focus
- **`.ui-textarea`**: textarea 공통 스타일 + hover/focus
- **`.ui-chip` / `.ui-chip--on` / `.ui-chip--off`**: 태그(칩) 버튼 멀티셀렉트용

---

## 4. AI 생성 프롬프트 가이드 (Prompt Guide)

v0.dev 또는 Cursor(Composer)에 입력하여 화면을 생성할 때 사용하는 프롬프트 세트이다.

### 4.1. 공통 스타일 정의 (Global Style Context)

_모든 프롬프트의 서두에 붙여서 디자인 일관성을 유지한다._

> **[Global Style Prompt]**
> "Design a web interface using React, Tailwind CSS, and Lucide Icons.
> **Theme:** 'EcoMonitor Warm Glass'.
> **Background:** Use a warm off-white color (e.g., `bg-stone-50` or `#F9F9F7`), never pure white.
> **Card Style:** Implement a premium Glassmorphism effect. Use `bg-white/50`, `backdrop-blur-2xl`, `rounded-3xl`, and a subtle `border-white/60` to mimic frosted glass floating on the background.
> **Shadows:** Soft, diffused shadows (`shadow-xl`, `shadow-stone-200`) to create depth.
> **Accent:** Use Deep Forest Green (`#4A5D4F`) for primary actions and active states.
> **Font:** Use a clean sans-serif font."

---

### 4.2. 화면별 상세 프롬프트 (Screen Prompts)

#### **A. 메인 대시보드 (Main Dashboard)**

사용자가 로그인 후 처음 마주하는 개요 화면.

> **Prompt:**
> "[Global Style Prompt applied]
> Create the **Main Dashboard** for the Environmental Regulation Monitoring Platform.
>
> **Layout:** Sidebar navigation (left) + Main Content (right).
> **Sidebar:** Glass effect vertical menu. Links: Dashboard, Issue Discovery, Report Generator, Archive, Settings.
> **Header:** Glass strip with 'Search Regulations' input and User Profile.
>
> **Main Content Widgets (Grid Layout):**
>
> 1.  **Welcome Section:** Large glass card greeting the user with a summary: '3 New critical regulations found this week.'
> 2.  **Trend Chart:** A visual line chart (use placeholder visual) showing 'Regulation Frequency' over the last 6 months.
> 3.  **Quick Actions:** Large, rounded square buttons with icons: 'Start New Scan', 'Draft Report', 'Upload PDF'.
> 4.  **Recent Alerts:** A list of recent updates (e.g., 'Ministry of Environment Notice No. 2025-12'). Use small colored badges for tags (e.g., 'Air Quality', 'Waste')."

#### **B. 이슈 발굴 및 선택 (Issue Discovery & Selection)**

`DESIGN.md`의 **3.4.C** (자동 분석 및 카드 선택) 구현.

> **Prompt:**
> "[Global Style Prompt applied]
> Create the **Issue Discovery Agent** interface.
>
> **Top Control Bar:** A glass bar containing a 'Date Range Picker' and a large 'Run Auto-Scan' button (Green filled).
> **Result Grid:** Display scanned issues as **Interactive Glass Cards**.
>
> **Card Design Details:**
>
> - **Header:** Badge (Level: Critical/Normal), Date.
> - **Body:** Title (Bold), 2-line summary text.
> - **Footer:** Source (e.g., 'me.go.kr'), Link Icon.
> - **Selection Interaction:** A prominent **Checkbox** at the top-right. When checked, the card should glow with a green ring (`ring-2 ring-green-600/30`) and the background becomes slightly more opaque white.
>
> **Floating Action Button:** A sticky button at the bottom-right: 'Create Report with Selected Issues (3)'."

#### **C. 심층 분석 및 보고서 생성 (Deep Analysis & Report)**

`DESIGN.md`의 **3.5** (보고서 초안 생성) 구현.

> **Prompt:**
> "[Global Style Prompt applied]
> Create the **Report Generation Workspace**.
>
> **Layout:** Split view. Left (40%) for Analysis Tools, Right (60%) for Report Preview.
>
> **Left Panel (Analysis & Chat):**
>
> - Glass container.
> - List of selected issues.
> - An 'AI Chat Interface' below the list to ask questions about the regulations (e.g., 'Explain the impact on water facilities').
> - Action buttons: 'Regenerate Draft', 'Apply Tone: Formal'.
>
> **Right Panel (Document Preview):**
>
> - **Background:** Darker gray (`bg-stone-200`) to contrast with the paper.
> - **Paper UI:** A realistic A4 sheet simulation (Pure white `bg-white`, `shadow-2xl`, `aspect-[1/1.414]`).
> - **Content:** Mockup of a formal report document with Headers, Bullet points, and a Table.
> - **Toolbar:** Floating glass toolbar on top of the paper: 'Download Word', 'Download PDF', 'Save'."

#### **D. 로그인 및 랜딩 (Login & Landing)**

서비스의 첫인상.

> **Prompt:**
> "[Global Style Prompt applied]
> Create a **Login / Landing Page**.
>
> **Background:** Full-screen soft abstract gradient using the theme colors (Cream to very light Green), with a heavy blur effect.
> **Center Card:** A single, centered Glassmorphism card (`backdrop-blur-3xl`).
> **Content:**
>
> - Logo & Title: 'EcoMonitor AI'.
> - Subtitle: 'Automated Environmental Regulation Intelligence'.
> - Input fields: Email, Password (minimalist style with bottom border only or soft filled inputs).
> - Button: Full-width, rounded-2xl, Deep Green color."

---

## 5. 구현 팁 (Implementation Tips)

1.  **v0.dev 활용법:** 위 프롬프트를 차례대로 입력하되, 첫 번째 결과물이 나오면 "Make the shadows softer" 또는 "Increase the border radius"와 같이 대화형으로 미세 조정을 요청한다.
2.  **Pretendard 폰트 적용:** v0는 기본적으로 영문 폰트를 사용하므로, 코드 Export 후 `layout.tsx` 또는 `globals.css`에 Pretendard CDN 또는 로컬 폰트 설정을 추가해야 한다.
3.  **아이콘 커스터마이징:** 생성된 코드에서 `<iconName className="..." />` 부분의 `w-4 h-4` 등을 조절하여 아이콘 크기와 색상을 테마에 맞게 통일한다.

---

## 6. 구현된 UI 컴포넌트 상세 (Implemented UI Components)

> **최종 업데이트**: 2026-01-09

### 6.1 글로벌 스타일 정의 (`globals.css`)

#### A) CSS 커스텀 변수

```css
:root {
  --background: #F9F9F7;     /* 따뜻한 오프화이트 */
  --foreground: #292524;     /* 진한 회갈색 텍스트 */
  --primary: #4A5D4F;        /* Deep Forest Green */
  --primary-light: #6B7D6F;  /* 밝은 그린 */
}
```

#### B) 재사용 가능한 유틸 클래스

| 클래스명 | 용도 | 주요 스타일 |
|:---|:---|:---|
| `.glass-panel` | 글래스 카드 컨테이너 | `bg-white/50 backdrop-blur-2xl rounded-3xl border-white/60 shadow-xl` |
| `.glass-button` | 글래스 버튼 | `bg-white/40 hover:bg-white/60 backdrop-blur border-white/60 rounded-xl` |
| `.ui-field` | Input/Select 공통 | `bg-white/60 border-stone-200/60 rounded-xl focus:ring-2 focus:ring-primary/20` |
| `.ui-textarea` | Textarea 공통 | `.ui-field` 확장 + `min-h-[80px]` |
| `.ui-chip` | 태그/칩 버튼 | `px-3 py-1 rounded-full text-xs font-semibold transition-all` |
| `.ui-chip--on` | 선택된 칩 | `bg-primary/15 text-primary border-primary/30` |
| `.ui-chip--off` | 미선택 칩 | `bg-stone-100 text-stone-500 hover:bg-stone-200` |

### 6.2 레이아웃 컴포넌트

#### A) Sidebar (`components/layout/Sidebar.tsx`)

**디자인 특징**:
- 고정 너비 (72px 축소 / 260px 확장)
- 글래스 효과 배경 (`bg-white/70 backdrop-blur-2xl`)
- 호버 시 서브메뉴 확장
- 아이콘 + 레이블 구조
- 활성 메뉴 표시: 좌측 파란 바 + 배경 하이라이트

**메뉴 구조** (`config/menu.ts`):
```typescript
const MENU_ITEMS = [
  { label: "대시보드", path: "/", icon: Home },
  { 
    label: "웹 스크래퍼", 
    icon: Monitor,
    submenu: [
      { label: "대상기관 관리", path: "/scraper/targets" },
      { label: "스케쥴링 설정", path: "/scraper/schedule" },
      { label: "수집현황", path: "/scraper/status" },
      { label: "에러 로그/수정", path: "/scraper/logs" },
    ]
  },
  // ... 추출 및 벡터화, RAG 분석, 보고서 생성
];
```

#### B) TopBar (`components/layout/TopBar.tsx`)

**디자인 특징**:
- 앱 로고 + 타이틀 (`WebScraping&RAG`)
- GNB 스타일 가로 메뉴 (호버 시 드롭다운)
- 우측: 사용자 아이콘 + 드롭다운 (로그아웃, 설정)

### 6.3 모달 컴포넌트

#### A) API 초기 세팅 모달

**구성 요소**:
1. **헤더**: 모달 제목 + 닫기 버튼
2. **입력 영역**:
   - 가이드 URL 텍스트 박스
   - 파일 업로드 버튼
   - LLM 모델 선택 드롭다운
3. **분석 버튼 그룹**:
   - "JSON 불러오기" 버튼 (왼쪽)
   - "API 정보 분석" 버튼 (가운데)
   - "LLM 분석" 버튼 (오른쪽, 검은 배경)
4. **결과 영역**:
   - API 프로파일 제안 텍스트 에어리어
   - 수정 요청 텍스트 박스
   - 선택된 엔드포인트 요약 박스 (녹색 배경)
5. **액션 버튼**:
   - "테스트 호출" (회색)
   - "승인 후 저장" (검은 배경)

**버튼 스타일**:
```css
/* 기본 버튼 (취소 등) */
.glass-button { @apply bg-white/40 text-stone-700 border-white/60; }

/* 강조 버튼 (저장, 분석 등) */
.primary-button { @apply bg-stone-900 text-white hover:bg-black; }
```

#### B) API 정보 추출 모달

**구성 요소**:
1. **로딩 상태**: 도넛 모양 스피너 애니메이션
2. **엔드포인트 태그 그리드**:
   - 선택 시 배경색 진하게 (`bg-primary/15`)
   - 테두리 강조 (`border-2 border-primary/30`)
   - 링 효과 (`ring-2 ring-primary/20`)
3. **정보 표시**: 파라미터 수, 응답 필드 수
4. **액션 버튼**: "JSON으로 저장", "EP 적용", "닫기"

#### C) 스케줄 설정 모달 (신규)

**레이아웃**:
```
┌─────────────────────────────────────────────────────────────┐
│ 📅 스케쥴 설정                                         [X]  │
├─────────────────────────────────────────────────────────────┤
│ ┌─────────────────────┐ ┌───────────────────────────────────┐│
│ │ [✓] 기간 설정        │ │ [ ] 주기 설정                    ││
│ │   시작일 / 종료일   │ │   ○ 매 월 특정일 [  ] 일        ││
│ │   ┌───────────────┐ │ │   ○ 매 주 [▼] 요일              ││
│ │   │   캘린더 UI    │ │ │   ○ [▼] 일 마다                 ││
│ │   │  글래스 효과   │ │ ├───────────────────────────────────┤│
│ │   │  그라데이션    │ │ │ ⏰ 시간 설정                     ││
│ │   └───────────────┘ │ │   표준시: [도쿄 JST▼]            ││
│ └─────────────────────┘ │   [09▼] : [00▼]                  ││
│                         └───────────────────────────────────┘│
│ ┌─────────────────────────────────────────────────────────┐│
│ │ 📋 현재 설정: 매월 15일 09:00 (JST) | cron: 0 9 15 * * ││
│ └─────────────────────────────────────────────────────────┘│
├─────────────────────────────────────────────────────────────┤
│                                    [취소] [설정 저장]       │
└─────────────────────────────────────────────────────────────┘
```

**캘린더 UI 디자인**:
- 글래스 효과: `bg-gradient-to-br from-white/80 to-stone-50/80 backdrop-blur-md`
- 라운딩: `rounded-2xl`
- 그림자: `shadow-xl shadow-stone-200/50`
- 날짜 버튼: `rounded-xl` + 호버 시 `scale-105`
- 선택된 시작일: `bg-gradient-to-br from-primary to-primary/80 text-white`
- 선택된 종료일: `bg-gradient-to-br from-emerald-500 to-emerald-600 text-white`
- 범위 내 날짜: `bg-primary/10 text-primary`

**주기 설정 카드**:
- 선택 시 배경: `bg-primary/5 border-2 border-primary/30`
- 드롭박스 너비: `70px` (통일)
- 체크박스 토글 가능 (재클릭 시 해제)

### 6.4 보드 설정 마법사 UI

#### A) 3단계 탭 네비게이션

```
┌─────────┬─────────┬─────────┐
│ 1.기본  │ 2.설정  │ 3.검증  │
│ ✓ 완료  │ 진행중  │ ○ 대기  │
└─────────┴─────────┴─────────┘
```

**스타일**:
- 완료 탭: `bg-primary/20 text-primary`
- 진행중 탭: `bg-primary text-white`
- 대기 탭: `bg-stone-100 text-stone-400`

#### B) API 보드 설정 (Step 2)

**구성 요소**:
1. **엔드포인트 선택**: 드롭다운 + 탭 (주/보조)
2. **요청 파라미터**: 체크박스 + 값 입력
3. **응답 필드 매핑**: 체크박스 그리드
4. **검색 필터 설정**:
   - 필드 선택 드롭다운
   - 키워드 입력 (세로 스택, + 버튼으로 추가)
   - OR/AND 조건 드롭다운 (`w-[100px]`)
   - 삭제 버튼 (휴지통 아이콘, 맨 오른쪽)
5. **날짜 필터 설정**: 필드 + 시작일/종료일

**검색 필터 UI 레이아웃**:
```
┌───────────────────────────────────────────────────────────────┐
│ 필드명: 법령명_한글          [OR▼]  [🗑]                      │
├───────────────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────────────┐ [+] │
│ │ 환경오염시설의 통합관리에 관한 법률                   │     │
│ └─────────────────────────────────────────────────────┘     │
│ ┌─────────────────────────────────────────────────────┐ [+] │
│ │ 대기환경보전법                                       │     │
│ └─────────────────────────────────────────────────────┘     │
└───────────────────────────────────────────────────────────────┘
```

### 6.5 색상 팔레트 확장

| 용도 | 색상 | Tailwind 클래스 | 예시 |
|:---|:---|:---|:---|
| **배경** | Off-white | `bg-stone-50` | 페이지 배경 |
| **카드** | Glass White | `bg-white/50` | 메인 카드 |
| **Primary** | Forest Green | `text-primary` | 강조 텍스트 |
| **Success** | Emerald | `bg-emerald-500` | 완료/성공 |
| **Warning** | Amber | `bg-amber-100` | 경고/주의 |
| **Error** | Red | `bg-red-100` | 오류 |
| **Info** | Blue | `bg-blue-50` | 정보 박스 |
| **Disabled** | Stone | `opacity-50` | 비활성화 |

### 6.6 애니메이션 및 트랜지션

| 요소 | 애니메이션 | 속성 |
|:---|:---|:---|
| **버튼 호버** | 배경색 변화 | `transition-colors duration-200` |
| **카드 호버** | 그림자 확대 | `hover:shadow-lg transition-shadow` |
| **모달 열림** | 페이드 인 | `animate-in fade-in` |
| **로딩 스피너** | 회전 | `animate-spin` |
| **캘린더 날짜** | 스케일 업 | `hover:scale-105 transition-transform` |
| **태그 선택** | 배경/테두리 | `transition-all duration-300` |
| **드롭다운** | 슬라이드 다운 | `animate-in slide-in-from-top-2` |

### 6.7 반응형 디자인 (추후 적용 예정)

| Breakpoint | 적용 사항 |
|:---|:---|
| `sm` (640px) | 사이드바 축소, 카드 1열 |
| `md` (768px) | 사이드바 아이콘만, 카드 2열 |
| `lg` (1024px) | 사이드바 확장 가능, 카드 3열 |
| `xl` (1280px) | 전체 레이아웃 |
