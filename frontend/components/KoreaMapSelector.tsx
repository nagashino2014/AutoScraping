"use client";

import React, { useState, useCallback } from "react";
import { X, ChevronLeft, MapPin, Check } from "lucide-react";
import { cn } from "@/lib/utils";

// 시/도 SVG Path 데이터 (간소화된 버전)
const SIDO_PATHS: Record<string, { path: string; center: [number, number]; label: string }> = {
  "서울특별시": {
    path: "M186,89 L192,86 L198,88 L201,93 L199,99 L193,102 L186,100 L183,94 Z",
    center: [192, 94],
    label: "서울"
  },
  "인천광역시": {
    path: "M168,88 L175,85 L182,89 L183,96 L178,102 L170,100 L165,94 Z",
    center: [174, 93],
    label: "인천"
  },
  "경기도": {
    path: "M165,65 L190,60 L215,68 L225,85 L220,110 L200,120 L175,118 L160,105 L155,85 Z",
    center: [190, 90],
    label: "경기"
  },
  "강원특별자치도": {
    path: "M220,55 L260,50 L290,65 L295,95 L280,125 L245,130 L220,115 L215,85 Z",
    center: [255, 90],
    label: "강원"
  },
  "충청북도": {
    path: "M200,120 L230,115 L250,130 L245,160 L220,170 L195,160 L190,135 Z",
    center: [220, 142],
    label: "충북"
  },
  "충청남도": {
    path: "M140,120 L175,115 L195,130 L190,165 L160,180 L130,170 L125,140 Z",
    center: [160, 148],
    label: "충남"
  },
  "세종특별자치시": {
    path: "M178,138 L188,135 L193,142 L190,150 L180,152 L175,145 Z",
    center: [184, 144],
    label: "세종"
  },
  "대전광역시": {
    path: "M185,155 L198,152 L205,160 L202,170 L190,173 L183,165 Z",
    center: [194, 162],
    label: "대전"
  },
  "전라북도": {
    path: "M130,175 L170,170 L195,185 L190,220 L155,235 L120,220 L115,195 Z",
    center: [155, 202],
    label: "전북"
  },
  "전라남도": {
    path: "M95,225 L145,218 L175,235 L180,280 L155,310 L105,315 L75,290 L70,250 Z",
    center: [125, 268],
    label: "전남"
  },
  "광주광역시": {
    path: "M125,245 L140,242 L148,252 L145,262 L132,265 L122,258 Z",
    center: [135, 253],
    label: "광주"
  },
  "경상북도": {
    path: "M230,125 L280,118 L310,140 L315,190 L290,220 L245,225 L215,200 L210,155 Z",
    center: [262, 170],
    label: "경북"
  },
  "대구광역시": {
    path: "M255,195 L272,192 L280,202 L277,215 L262,218 L252,208 Z",
    center: [266, 205],
    label: "대구"
  },
  "경상남도": {
    path: "M200,220 L255,215 L290,235 L295,280 L265,305 L210,300 L180,270 L185,240 Z",
    center: [238, 260],
    label: "경남"
  },
  "울산광역시": {
    path: "M290,218 L305,215 L315,228 L312,242 L298,245 L288,235 Z",
    center: [302, 230],
    label: "울산"
  },
  "부산광역시": {
    path: "M278,278 L295,275 L305,288 L302,302 L288,305 L275,295 Z",
    center: [290, 290],
    label: "부산"
  },
  "제주특별자치도": {
    path: "M85,360 L135,355 L155,375 L150,395 L110,400 L80,385 Z",
    center: [118, 378],
    label: "제주"
  },
};

// 시/군/구 데이터 (각 시/도별)
const SIGUNGU_DATA: Record<string, Record<string, { path: string; center: [number, number] }>> = {
  "서울특별시": {
    "강남구": { path: "M55,55 L70,52 L78,60 L75,72 L60,75 L50,65 Z", center: [63, 63] },
    "강동구": { path: "M75,48 L92,45 L98,55 L95,65 L80,68 L72,58 Z", center: [85, 56] },
    "강북구": { path: "M45,25 L62,22 L70,32 L67,42 L52,45 L42,35 Z", center: [56, 33] },
    "강서구": { path: "M8,45 L25,42 L32,52 L28,62 L15,65 L5,55 Z", center: [18, 53] },
    "관악구": { path: "M30,70 L45,67 L52,77 L48,87 L35,90 L25,80 Z", center: [38, 78] },
    "광진구": { path: "M70,38 L85,35 L92,45 L88,55 L75,58 L67,48 Z", center: [79, 46] },
    "구로구": { path: "M15,58 L30,55 L38,65 L35,75 L20,78 L12,68 Z", center: [25, 66] },
    "금천구": { path: "M22,75 L37,72 L45,82 L42,92 L27,95 L19,85 Z", center: [32, 83] },
    "노원구": { path: "M60,15 L77,12 L85,22 L82,32 L67,35 L57,25 Z", center: [71, 23] },
    "도봉구": { path: "M52,8 L68,5 L76,15 L73,25 L58,28 L48,18 Z", center: [62, 16] },
    "동대문구": { path: "M58,35 L73,32 L80,42 L77,52 L62,55 L55,45 Z", center: [67, 43] },
    "동작구": { path: "M35,62 L50,59 L58,69 L55,79 L40,82 L32,72 Z", center: [45, 70] },
    "마포구": { path: "M22,38 L38,35 L46,45 L43,55 L28,58 L18,48 Z", center: [32, 46] },
    "서대문구": { path: "M30,30 L46,27 L54,37 L51,47 L36,50 L26,40 Z", center: [40, 38] },
    "서초구": { path: "M45,62 L62,59 L70,69 L67,82 L50,85 L42,72 Z", center: [56, 72] },
    "성동구": { path: "M52,42 L68,39 L76,49 L73,59 L58,62 L48,52 Z", center: [62, 50] },
    "성북구": { path: "M48,28 L64,25 L72,35 L69,45 L54,48 L44,38 Z", center: [58, 36] },
    "송파구": { path: "M68,52 L85,49 L93,59 L90,72 L73,75 L65,62 Z", center: [79, 62] },
    "양천구": { path: "M12,52 L28,49 L36,59 L33,69 L18,72 L8,62 Z", center: [22, 60] },
    "영등포구": { path: "M25,55 L42,52 L50,62 L47,72 L32,75 L22,65 Z", center: [36, 63] },
    "용산구": { path: "M40,48 L56,45 L64,55 L61,65 L46,68 L36,58 Z", center: [50, 56] },
    "은평구": { path: "M25,22 L42,19 L50,29 L47,39 L32,42 L22,32 Z", center: [36, 30] },
    "종로구": { path: "M38,32 L54,29 L62,39 L59,49 L44,52 L34,42 Z", center: [48, 40] },
    "중구": { path: "M45,40 L60,37 L68,47 L65,57 L50,60 L42,50 Z", center: [55, 48] },
    "중랑구": { path: "M65,30 L82,27 L90,37 L87,47 L72,50 L62,40 Z", center: [76, 38] },
  },
  "부산광역시": {
    "강서구": { path: "M5,35 L25,30 L35,45 L30,60 L12,65 L2,50 Z", center: [18, 47] },
    "금정구": { path: "M55,20 L75,15 L85,30 L80,48 L62,52 L50,38 Z", center: [67, 33] },
    "기장군": { path: "M78,8 L98,3 L108,18 L103,38 L85,42 L72,28 Z", center: [90, 22] },
    "남구": { path: "M50,60 L68,55 L78,70 L73,85 L55,88 L45,75 Z", center: [62, 72] },
    "동구": { path: "M58,48 L75,43 L85,58 L80,72 L63,75 L53,62 Z", center: [69, 58] },
    "동래구": { path: "M55,35 L73,30 L83,45 L78,60 L60,63 L50,50 Z", center: [67, 47] },
    "부산진구": { path: "M45,45 L63,40 L73,55 L68,70 L50,73 L40,60 Z", center: [57, 56] },
    "북구": { path: "M35,25 L53,20 L63,35 L58,50 L40,53 L30,40 Z", center: [47, 36] },
    "사상구": { path: "M28,40 L46,35 L56,50 L51,65 L33,68 L23,55 Z", center: [40, 51] },
    "사하구": { path: "M15,55 L33,50 L43,65 L38,82 L20,85 L10,70 Z", center: [27, 67] },
    "서구": { path: "M35,58 L53,53 L63,68 L58,83 L40,86 L30,73 Z", center: [47, 69] },
    "수영구": { path: "M62,65 L78,60 L88,75 L83,88 L67,92 L57,78 Z", center: [73, 76] },
    "연제구": { path: "M52,52 L70,47 L80,62 L75,77 L57,80 L47,67 Z", center: [64, 63] },
    "영도구": { path: "M48,78 L65,73 L75,88 L70,102 L52,105 L42,92 Z", center: [58, 89] },
    "중구": { path: "M42,65 L60,60 L70,75 L65,90 L47,93 L37,80 Z", center: [54, 76] },
    "해운대구": { path: "M70,38 L90,33 L100,48 L95,65 L77,68 L65,55 Z", center: [82, 50] },
  },
  "대구광역시": {
    "남구": { path: "M40,60 L58,55 L68,70 L63,85 L45,88 L35,75 Z", center: [52, 71] },
    "달서구": { path: "M20,45 L40,40 L52,55 L47,72 L28,76 L15,62 Z", center: [34, 57] },
    "달성군": { path: "M5,55 L30,48 L45,68 L40,92 L15,98 L0,78 Z", center: [24, 73] },
    "동구": { path: "M60,30 L82,25 L95,42 L90,60 L68,65 L55,48 Z", center: [75, 45] },
    "북구": { path: "M45,20 L68,15 L82,32 L77,50 L55,55 L40,38 Z", center: [61, 35] },
    "서구": { path: "M30,38 L50,33 L62,48 L57,65 L38,68 L25,55 Z", center: [44, 50] },
    "수성구": { path: "M55,48 L78,43 L92,60 L87,80 L65,85 L50,68 Z", center: [71, 63] },
    "중구": { path: "M42,45 L62,40 L74,55 L69,72 L50,75 L37,62 Z", center: [56, 57] },
  },
  "인천광역시": {
    "강화군": { path: "M5,5 L35,0 L48,18 L42,40 L18,45 L0,28 Z", center: [24, 22] },
    "계양구": { path: "M55,35 L75,30 L88,45 L83,62 L62,66 L50,52 Z", center: [69, 48] },
    "남동구": { path: "M60,60 L82,55 L95,72 L90,90 L68,95 L55,78 Z", center: [75, 75] },
    "동구": { path: "M48,55 L65,50 L78,65 L73,80 L55,84 L43,70 Z", center: [61, 67] },
    "미추홀구": { path: "M50,68 L70,63 L83,80 L78,95 L58,100 L45,85 Z", center: [64, 81] },
    "부평구": { path: "M45,42 L65,37 L78,52 L73,68 L52,72 L40,58 Z", center: [59, 54] },
    "서구": { path: "M30,48 L52,43 L65,60 L60,78 L38,82 L25,65 Z", center: [45, 62] },
    "연수구": { path: "M55,78 L77,73 L90,90 L85,108 L63,112 L50,95 Z", center: [70, 92] },
    "옹진군": { path: "M0,60 L25,55 L38,75 L32,95 L8,100 L-5,80 Z", center: [17, 77] },
    "중구": { path: "M35,55 L55,50 L68,67 L63,85 L42,88 L30,72 Z", center: [49, 69] },
  },
  "광주광역시": {
    "광산구": { path: "M5,25 L35,18 L50,38 L45,62 L20,68 L0,50 Z", center: [26, 43] },
    "남구": { path: "M35,55 L58,50 L72,68 L67,88 L45,92 L30,75 Z", center: [51, 70] },
    "동구": { path: "M52,35 L75,30 L88,48 L83,68 L60,72 L47,55 Z", center: [67, 51] },
    "북구": { path: "M40,15 L68,10 L82,30 L77,52 L52,56 L35,38 Z", center: [58, 33] },
    "서구": { path: "M25,40 L50,35 L65,55 L60,78 L35,82 L20,62 Z", center: [42, 58] },
  },
  "대전광역시": {
    "대덕구": { path: "M55,10 L85,5 L100,28 L95,55 L68,60 L50,38 Z", center: [75, 32] },
    "동구": { path: "M60,40 L88,35 L102,58 L97,82 L70,88 L55,65 Z", center: [78, 61] },
    "서구": { path: "M20,35 L50,30 L65,52 L60,78 L32,82 L15,60 Z", center: [40, 55] },
    "유성구": { path: "M5,20 L40,15 L55,40 L50,68 L22,72 L0,48 Z", center: [28, 43] },
    "중구": { path: "M40,48 L68,43 L82,65 L77,88 L50,92 L35,72 Z", center: [58, 67] },
  },
  "울산광역시": {
    "남구": { path: "M40,55 L68,50 L82,70 L77,92 L50,96 L35,78 Z", center: [58, 73] },
    "동구": { path: "M65,40 L92,35 L105,55 L100,78 L72,82 L58,62 Z", center: [81, 58] },
    "북구": { path: "M50,20 L80,15 L95,38 L90,60 L62,65 L45,45 Z", center: [70, 40] },
    "울주군": { path: "M10,30 L48,22 L68,48 L62,82 L28,90 L2,62 Z", center: [38, 55] },
    "중구": { path: "M48,42 L75,37 L88,58 L83,80 L55,85 L42,65 Z", center: [65, 60] },
  },
  "세종특별자치시": {
    "세종시": { path: "M10,10 L90,10 L90,90 L10,90 Z", center: [50, 50] },
  },
  "경기도": {
    "가평군": { path: "M75,5 L95,2 L102,15 L98,28 L80,32 L72,18 Z", center: [87, 17] },
    "고양시": { path: "M28,28 L48,25 L55,38 L50,52 L32,55 L25,42 Z", center: [40, 40] },
    "과천시": { path: "M40,58 L52,55 L58,65 L55,75 L43,78 L37,68 Z", center: [48, 66] },
    "광명시": { path: "M30,55 L42,52 L48,62 L45,72 L33,75 L27,65 Z", center: [38, 63] },
    "광주시": { path: "M62,55 L78,52 L85,65 L82,78 L65,82 L58,68 Z", center: [72, 67] },
    "구리시": { path: "M55,38 L68,35 L75,45 L72,55 L58,58 L52,48 Z", center: [64, 46] },
    "군포시": { path: "M35,62 L48,59 L55,70 L52,80 L38,83 L32,72 Z", center: [44, 71] },
    "김포시": { path: "M15,32 L32,28 L40,42 L36,55 L20,58 L12,45 Z", center: [26, 43] },
    "남양주시": { path: "M60,25 L82,20 L92,35 L88,52 L68,56 L55,42 Z", center: [74, 38] },
    "동두천시": { path: "M48,8 L62,5 L70,15 L67,25 L52,28 L45,18 Z", center: [58, 16] },
    "부천시": { path: "M22,48 L38,45 L45,58 L42,68 L28,72 L20,60 Z", center: [32, 58] },
    "성남시": { path: "M50,55 L68,52 L78,68 L73,82 L55,86 L45,72 Z", center: [62, 69] },
    "수원시": { path: "M38,68 L55,65 L65,80 L60,95 L42,98 L32,85 Z", center: [50, 81] },
    "시흥시": { path: "M25,58 L42,55 L52,70 L48,85 L30,88 L20,75 Z", center: [36, 71] },
    "안산시": { path: "M22,72 L40,68 L50,85 L45,100 L27,103 L18,88 Z", center: [35, 86] },
    "안성시": { path: "M55,88 L75,85 L88,102 L83,118 L62,122 L50,105 Z", center: [70, 103] },
    "안양시": { path: "M35,55 L50,52 L58,65 L55,78 L40,82 L32,68 Z", center: [46, 67] },
    "양주시": { path: "M42,15 L60,12 L70,28 L66,42 L48,45 L38,32 Z", center: [54, 28] },
    "양평군": { path: "M72,35 L92,32 L102,50 L98,68 L78,72 L68,55 Z", center: [85, 52] },
    "여주시": { path: "M78,58 L98,55 L108,72 L103,90 L83,93 L72,78 Z", center: [90, 74] },
    "연천군": { path: "M38,2 L58,0 L68,15 L63,30 L45,33 L35,18 Z", center: [52, 16] },
    "오산시": { path: "M45,82 L58,78 L65,90 L62,100 L48,103 L42,92 Z", center: [54, 90] },
    "용인시": { path: "M52,65 L72,62 L85,80 L80,98 L58,102 L48,85 Z", center: [66, 82] },
    "의왕시": { path: "M38,60 L52,57 L60,70 L57,82 L42,85 L35,72 Z", center: [48, 71] },
    "의정부시": { path: "M48,22 L62,18 L72,32 L68,45 L52,48 L45,35 Z", center: [58, 33] },
    "이천시": { path: "M68,68 L88,65 L100,82 L95,100 L75,103 L62,88 Z", center: [81, 84] },
    "파주시": { path: "M22,12 L45,8 L55,25 L50,45 L28,48 L18,30 Z", center: [36, 28] },
    "평택시": { path: "M32,92 L55,88 L70,108 L65,128 L40,132 L28,115 Z", center: [50, 110] },
    "포천시": { path: "M55,5 L78,2 L90,20 L85,42 L62,46 L50,28 Z", center: [70, 24] },
    "하남시": { path: "M58,48 L72,45 L80,58 L77,70 L62,73 L55,60 Z", center: [68, 59] },
    "화성시": { path: "M28,75 L52,70 L65,92 L60,115 L35,120 L22,98 Z", center: [44, 95] },
  },
  "강원특별자치도": {
    "강릉시": { path: "M70,35 L95,30 L108,52 L102,78 L78,82 L62,58 Z", center: [85, 55] },
    "고성군": { path: "M65,5 L88,2 L100,22 L95,42 L72,45 L60,25 Z", center: [80, 23] },
    "동해시": { path: "M75,60 L95,55 L105,72 L100,88 L80,92 L70,78 Z", center: [88, 73] },
    "삼척시": { path: "M72,75 L98,70 L112,95 L105,125 L78,130 L65,102 Z", center: [88, 100] },
    "속초시": { path: "M68,18 L88,15 L98,32 L93,48 L75,52 L65,35 Z", center: [82, 33] },
    "양구군": { path: "M35,18 L55,15 L65,32 L60,48 L42,52 L30,35 Z", center: [48, 33] },
    "양양군": { path: "M62,28 L82,25 L92,45 L87,65 L68,68 L58,50 Z", center: [75, 46] },
    "영월군": { path: "M32,68 L58,62 L72,85 L65,108 L40,112 L25,90 Z", center: [48, 87] },
    "원주시": { path: "M25,55 L52,50 L68,75 L62,100 L35,105 L18,80 Z", center: [43, 77] },
    "인제군": { path: "M42,25 L68,20 L82,45 L76,72 L50,76 L35,52 Z", center: [58, 48] },
    "정선군": { path: "M45,72 L72,68 L88,95 L82,122 L55,126 L38,100 Z", center: [63, 97] },
    "철원군": { path: "M15,8 L42,5 L55,28 L48,52 L22,55 L8,32 Z", center: [32, 30] },
    "춘천시": { path: "M28,32 L55,28 L70,52 L63,78 L38,82 L22,58 Z", center: [46, 55] },
    "태백시": { path: "M58,88 L78,85 L88,102 L83,118 L62,122 L52,105 Z", center: [70, 103] },
    "평창군": { path: "M48,48 L75,45 L90,70 L84,98 L58,102 L42,78 Z", center: [66, 73] },
    "홍천군": { path: "M35,42 L65,38 L82,65 L75,92 L48,96 L28,70 Z", center: [55, 67] },
    "화천군": { path: "M25,15 L48,12 L60,32 L55,52 L32,55 L20,35 Z", center: [40, 33] },
    "횡성군": { path: "M30,52 L55,48 L68,72 L62,95 L38,98 L25,75 Z", center: [46, 73] },
  },
  "충청북도": {
    "괴산군": { path: "M45,35 L68,30 L82,52 L76,78 L52,82 L38,58 Z", center: [60, 55] },
    "단양군": { path: "M72,25 L95,20 L108,45 L102,72 L78,76 L65,52 Z", center: [86, 48] },
    "보은군": { path: "M52,58 L75,53 L88,78 L82,102 L58,106 L45,82 Z", center: [66, 80] },
    "영동군": { path: "M48,88 L72,83 L85,108 L78,132 L55,136 L42,112 Z", center: [63, 110] },
    "옥천군": { path: "M42,75 L65,70 L78,95 L72,118 L48,122 L35,98 Z", center: [56, 96] },
    "음성군": { path: "M25,25 L50,20 L65,45 L58,70 L35,74 L20,50 Z", center: [42, 47] },
    "제천시": { path: "M62,15 L88,10 L102,35 L96,62 L70,66 L55,42 Z", center: [78, 38] },
    "증평군": { path: "M32,40 L52,36 L62,52 L58,68 L38,72 L28,56 Z", center: [45, 54] },
    "진천군": { path: "M18,32 L42,28 L55,52 L48,76 L25,80 L12,56 Z", center: [34, 54] },
    "청주시": { path: "M28,48 L55,43 L72,70 L65,98 L38,102 L22,76 Z", center: [48, 73] },
    "충주시": { path: "M38,8 L68,4 L85,32 L78,62 L48,66 L32,38 Z", center: [58, 35] },
  },
  "충청남도": {
    "계룡시": { path: "M55,55 L70,52 L78,65 L75,78 L60,82 L52,68 Z", center: [65, 67] },
    "공주시": { path: "M48,38 L72,33 L88,58 L82,85 L58,90 L42,65 Z", center: [65, 62] },
    "금산군": { path: "M68,72 L92,67 L105,95 L98,122 L75,126 L62,100 Z", center: [83, 97] },
    "논산시": { path: "M42,68 L68,63 L82,90 L75,118 L50,122 L38,95 Z", center: [60, 93] },
    "당진시": { path: "M12,8 L42,4 L55,28 L48,52 L22,56 L8,32 Z", center: [32, 30] },
    "보령시": { path: "M5,55 L32,50 L48,78 L42,108 L15,112 L0,85 Z", center: [25, 81] },
    "부여군": { path: "M32,62 L58,57 L72,85 L66,112 L40,116 L28,90 Z", center: [50, 87] },
    "서산시": { path: "M5,25 L35,20 L50,48 L44,78 L18,82 L0,55 Z", center: [27, 51] },
    "서천군": { path: "M20,85 L45,80 L58,108 L52,135 L28,140 L15,112 Z", center: [38, 110] },
    "아산시": { path: "M35,22 L62,18 L78,45 L72,72 L48,76 L32,50 Z", center: [55, 47] },
    "예산군": { path: "M28,35 L55,30 L70,58 L63,85 L38,90 L25,62 Z", center: [48, 60] },
    "천안시": { path: "M42,15 L72,10 L88,40 L82,70 L55,75 L38,45 Z", center: [63, 43] },
    "청양군": { path: "M22,52 L48,47 L62,75 L55,102 L30,106 L18,80 Z", center: [40, 77] },
    "태안군": { path: "M0,35 L25,30 L38,55 L32,82 L8,86 L-5,60 Z", center: [17, 58] },
    "홍성군": { path: "M15,45 L42,40 L55,68 L48,95 L25,100 L12,72 Z", center: [35, 70] },
  },
  "전라북도": {
    "고창군": { path: "M8,68 L35,62 L50,90 L43,118 L18,122 L2,95 Z", center: [27, 92] },
    "군산시": { path: "M2,35 L32,30 L48,58 L42,85 L15,90 L0,62 Z", center: [24, 60] },
    "김제시": { path: "M25,55 L52,50 L68,78 L62,105 L35,110 L20,82 Z", center: [44, 80] },
    "남원시": { path: "M55,88 L85,82 L100,115 L92,148 L65,152 L50,120 Z", center: [75, 117] },
    "무주군": { path: "M72,35 L98,30 L112,60 L105,92 L78,96 L65,65 Z", center: [88, 63] },
    "부안군": { path: "M5,52 L32,47 L45,75 L38,102 L12,106 L0,78 Z", center: [23, 77] },
    "순창군": { path: "M42,92 L68,87 L82,118 L75,148 L48,152 L35,122 Z", center: [58, 120] },
    "완주군": { path: "M45,42 L75,37 L92,68 L85,98 L55,102 L40,72 Z", center: [66, 70] },
    "익산시": { path: "M28,35 L58,30 L75,62 L68,92 L40,96 L25,65 Z", center: [50, 63] },
    "임실군": { path: "M48,72 L78,67 L92,100 L85,132 L55,136 L42,105 Z", center: [67, 102] },
    "장수군": { path: "M62,60 L88,55 L102,88 L95,120 L68,124 L55,92 Z", center: [78, 90] },
    "전주시": { path: "M38,48 L65,43 L80,72 L73,102 L48,106 L35,78 Z", center: [57, 75] },
    "정읍시": { path: "M18,60 L48,55 L65,88 L58,122 L28,126 L12,95 Z", center: [40, 90] },
    "진안군": { path: "M55,48 L85,43 L100,78 L93,112 L62,116 L48,82 Z", center: [74, 80] },
  },
  "전라남도": {
    "강진군": { path: "M35,88 L58,83 L72,112 L65,142 L42,146 L28,118 Z", center: [50, 115] },
    "고흥군": { path: "M55,108 L82,103 L98,138 L90,172 L62,176 L48,142 Z", center: [73, 140] },
    "곡성군": { path: "M55,35 L78,30 L92,58 L85,88 L62,92 L48,65 Z", center: [70, 61] },
    "광양시": { path: "M78,62 L102,57 L118,90 L110,122 L85,126 L72,95 Z", center: [95, 92] },
    "구례군": { path: "M68,42 L92,37 L105,68 L98,98 L75,102 L62,72 Z", center: [83, 70] },
    "나주시": { path: "M28,48 L55,43 L70,75 L63,108 L38,112 L22,80 Z", center: [46, 78] },
    "담양군": { path: "M42,22 L68,17 L82,48 L75,78 L50,82 L35,52 Z", center: [58, 50] },
    "목포시": { path: "M5,82 L25,78 L35,98 L30,118 L12,122 L2,102 Z", center: [18, 100] },
    "무안군": { path: "M8,60 L32,55 L45,85 L38,115 L15,120 L2,90 Z", center: [24, 88] },
    "보성군": { path: "M48,82 L75,77 L90,110 L82,142 L58,146 L42,115 Z", center: [66, 112] },
    "순천시": { path: "M62,72 L90,67 L108,102 L100,138 L72,142 L55,108 Z", center: [82, 105] },
    "신안군": { path: "M0,95 L22,90 L35,122 L28,155 L5,160 L-8,128 Z", center: [14, 125] },
    "여수시": { path: "M72,115 L100,110 L118,148 L108,185 L78,190 L65,155 Z", center: [92, 150] },
    "영광군": { path: "M12,35 L38,30 L52,60 L45,90 L22,95 L8,65 Z", center: [30, 63] },
    "영암군": { path: "M18,72 L45,67 L60,100 L52,132 L28,136 L12,105 Z", center: [36, 102] },
    "완도군": { path: "M38,135 L65,130 L82,165 L74,200 L48,205 L32,172 Z", center: [57, 168] },
    "장성군": { path: "M30,28 L55,23 L68,52 L62,82 L38,86 L25,58 Z", center: [46, 55] },
    "장흥군": { path: "M42,98 L68,93 L82,128 L75,162 L50,166 L35,132 Z", center: [58, 130] },
    "진도군": { path: "M2,115 L28,110 L42,145 L35,178 L10,182 L-5,150 Z", center: [20, 147] },
    "함평군": { path: "M18,50 L42,45 L55,75 L48,105 L25,110 L12,80 Z", center: [34, 78] },
    "해남군": { path: "M22,105 L50,100 L68,138 L60,175 L32,180 L15,145 Z", center: [42, 140] },
    "화순군": { path: "M38,55 L65,50 L80,82 L72,115 L48,120 L32,88 Z", center: [56, 85] },
  },
  "경상북도": {
    "경산시": { path: "M48,82 L72,77 L85,105 L78,132 L55,136 L42,110 Z", center: [63, 107] },
    "경주시": { path: "M68,72 L98,67 L115,102 L108,138 L78,142 L62,108 Z", center: [88, 105] },
    "고령군": { path: "M28,92 L52,87 L65,115 L58,142 L35,146 L22,120 Z", center: [43, 117] },
    "구미시": { path: "M25,55 L52,50 L68,80 L62,112 L38,116 L22,85 Z", center: [45, 83] },
    "군위군": { path: "M42,48 L68,43 L82,72 L75,102 L52,106 L38,78 Z", center: [60, 75] },
    "김천시": { path: "M8,55 L38,50 L55,82 L48,115 L22,120 L5,88 Z", center: [32, 85] },
    "문경시": { path: "M20,18 L52,13 L68,45 L62,78 L32,82 L15,50 Z", center: [42, 48] },
    "봉화군": { path: "M58,8 L88,3 L105,38 L98,72 L68,76 L52,42 Z", center: [78, 40] },
    "상주시": { path: "M15,35 L48,30 L65,62 L58,98 L28,102 L10,68 Z", center: [38, 66] },
    "성주군": { path: "M22,75 L48,70 L62,100 L55,130 L30,134 L18,105 Z", center: [40, 102] },
    "안동시": { path: "M42,25 L75,20 L92,55 L85,92 L52,96 L35,62 Z", center: [63, 58] },
    "영덕군": { path: "M78,38 L105,33 L120,68 L112,102 L85,106 L72,72 Z", center: [96, 70] },
    "영양군": { path: "M65,22 L92,17 L105,50 L98,82 L72,86 L58,55 Z", center: [81, 52] },
    "영주시": { path: "M35,12 L65,7 L80,40 L73,72 L45,76 L30,45 Z", center: [55, 42] },
    "영천시": { path: "M55,62 L85,57 L100,92 L93,125 L65,130 L50,98 Z", center: [75, 94] },
    "예천군": { path: "M28,25 L58,20 L72,52 L65,82 L38,86 L25,55 Z", center: [48, 53] },
    "울릉군": { path: "M108,5 L125,2 L132,18 L128,32 L112,35 L105,20 Z", center: [118, 18] },
    "울진군": { path: "M85,18 L112,13 L128,52 L120,92 L92,96 L78,58 Z", center: [103, 55] },
    "의성군": { path: "M45,38 L75,33 L90,65 L83,98 L55,102 L40,70 Z", center: [65, 68] },
    "청도군": { path: "M52,95 L78,90 L92,122 L85,155 L60,158 L48,128 Z", center: [70, 125] },
    "청송군": { path: "M58,32 L85,27 L98,58 L92,90 L65,94 L52,65 Z", center: [75, 61] },
    "칠곡군": { path: "M32,68 L58,63 L72,92 L65,122 L42,126 L28,98 Z", center: [50, 95] },
    "포항시": { path: "M78,52 L108,47 L125,85 L118,122 L88,126 L72,90 Z", center: [98, 87] },
  },
  "경상남도": {
    "거제시": { path: "M75,118 L100,113 L115,148 L108,182 L82,186 L68,152 Z", center: [91, 150] },
    "거창군": { path: "M25,22 L55,17 L70,50 L63,82 L35,86 L20,55 Z", center: [45, 52] },
    "고성군": { path: "M55,95 L82,90 L95,122 L88,155 L62,158 L50,128 Z", center: [72, 125] },
    "김해시": { path: "M58,68 L85,63 L100,95 L93,128 L68,132 L52,100 Z", center: [76, 98] },
    "남해군": { path: "M42,128 L68,123 L82,158 L75,192 L50,196 L35,162 Z", center: [58, 160] },
    "밀양시": { path: "M55,42 L85,37 L100,72 L93,108 L65,112 L50,78 Z", center: [75, 75] },
    "사천시": { path: "M38,102 L65,97 L80,132 L72,165 L48,168 L32,138 Z", center: [56, 133] },
    "산청군": { path: "M28,55 L55,50 L70,85 L62,118 L38,122 L22,90 Z", center: [46, 86] },
    "양산시": { path: "M72,55 L98,50 L112,85 L105,118 L78,122 L65,90 Z", center: [88, 86] },
    "의령군": { path: "M38,48 L65,43 L78,75 L72,108 L48,112 L35,80 Z", center: [56, 78] },
    "진주시": { path: "M32,72 L62,67 L78,102 L70,138 L42,142 L25,108 Z", center: [52, 105] },
    "창녕군": { path: "M48,35 L75,30 L90,65 L82,100 L58,104 L42,70 Z", center: [66, 67] },
    "창원시": { path: "M52,82 L82,77 L98,115 L90,152 L62,156 L45,120 Z", center: [72, 117] },
    "통영시": { path: "M58,115 L85,110 L100,148 L92,185 L65,188 L52,155 Z", center: [76, 150] },
    "하동군": { path: "M25,90 L52,85 L68,120 L60,155 L35,158 L18,125 Z", center: [43, 122] },
    "함안군": { path: "M45,62 L72,57 L85,90 L78,122 L52,126 L40,95 Z", center: [62, 92] },
    "함양군": { path: "M18,40 L48,35 L62,68 L55,102 L28,106 L12,75 Z", center: [38, 70] },
    "합천군": { path: "M35,28 L68,23 L85,60 L78,98 L48,102 L30,68 Z", center: [58, 63] },
  },
  "제주특별자치도": {
    "서귀포시": { path: "M10,55 L90,55 L95,95 L5,95 Z", center: [50, 75] },
    "제주시": { path: "M5,10 L95,10 L90,50 L10,50 Z", center: [50, 30] },
  },
};

interface KoreaMapSelectorProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (sido: string, sigungu: string, fullRegion: string) => void;
  initialSido?: string;
  initialSigungu?: string;
}

export default function KoreaMapSelector({
  isOpen,
  onClose,
  onSelect,
  initialSido = "",
  initialSigungu = "",
}: KoreaMapSelectorProps) {
  const [level, setLevel] = useState<"sido" | "sigungu">(initialSido ? "sigungu" : "sido");
  const [selectedSido, setSelectedSido] = useState(initialSido);
  const [selectedSigungu, setSelectedSigungu] = useState(initialSigungu);
  const [hoveredRegion, setHoveredRegion] = useState<string | null>(null);

  const handleSidoClick = useCallback((sido: string) => {
    setSelectedSido(sido);
    setSelectedSigungu("");
    setLevel("sigungu");
  }, []);

  const handleSigunguClick = useCallback((sigungu: string) => {
    setSelectedSigungu(sigungu);
  }, []);

  const handleConfirm = useCallback(() => {
    if (selectedSido && selectedSigungu) {
      const fullRegion = `${selectedSido} ${selectedSigungu}`;
      onSelect(selectedSido, selectedSigungu, fullRegion);
      onClose();
    }
  }, [selectedSido, selectedSigungu, onSelect, onClose]);

  const handleBack = useCallback(() => {
    setLevel("sido");
    setSelectedSigungu("");
  }, []);

  if (!isOpen) return null;

  const sidoData = SIDO_PATHS;
  const sigunguData = selectedSido ? SIGUNGU_DATA[selectedSido] : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-[700px] max-h-[85vh] overflow-hidden">
        {/* 헤더 */}
        <div className="p-4 border-b border-stone-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {level === "sigungu" && (
              <button
                onClick={handleBack}
                className="p-1.5 rounded-lg hover:bg-stone-100 transition-colors"
              >
                <ChevronLeft className="w-5 h-5 text-stone-600" />
              </button>
            )}
            <div>
              <h3 className="font-semibold text-stone-800">
                {level === "sido" ? "시/도 선택" : `${selectedSido} - 시/군/구 선택`}
              </h3>
              <p className="text-xs text-stone-500">
                {level === "sido" 
                  ? "지도에서 시/도를 클릭하세요" 
                  : "지도에서 시/군/구를 클릭하세요"}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-stone-100 transition-colors"
          >
            <X className="w-5 h-5 text-stone-500" />
          </button>
        </div>

        {/* 지도 영역 */}
        <div className="p-4">
          <div className="relative bg-gradient-to-br from-blue-50 to-sky-50 rounded-xl overflow-hidden">
            {level === "sido" ? (
              // 시/도 지도
              <svg
                viewBox="0 0 350 420"
                className="w-full h-[400px]"
              >
                {/* 배경 */}
                <rect x="0" y="0" width="350" height="420" fill="transparent" />
                
                {/* 시/도 폴리곤 */}
                {Object.entries(sidoData).map(([sido, data]) => {
                  const isHovered = hoveredRegion === sido;
                  const isSelected = selectedSido === sido;
                  
                  return (
                    <g key={sido}>
                      <path
                        d={data.path}
                        fill={isSelected ? "#22c55e" : isHovered ? "#86efac" : "#e2e8f0"}
                        stroke={isSelected ? "#15803d" : isHovered ? "#22c55e" : "#94a3b8"}
                        strokeWidth={isSelected || isHovered ? 2 : 1}
                        className="cursor-pointer transition-all duration-200"
                        onMouseEnter={() => setHoveredRegion(sido)}
                        onMouseLeave={() => setHoveredRegion(null)}
                        onClick={() => handleSidoClick(sido)}
                      />
                      <text
                        x={data.center[0]}
                        y={data.center[1]}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        className="pointer-events-none select-none"
                        fontSize="9"
                        fontWeight="600"
                        fill={isSelected ? "#15803d" : "#475569"}
                      >
                        {data.label}
                      </text>
                    </g>
                  );
                })}
              </svg>
            ) : (
              // 시/군/구 지도
              <svg
                viewBox="0 0 120 200"
                className="w-full h-[400px]"
              >
                {sigunguData && Object.entries(sigunguData).map(([sigungu, data]) => {
                  const isHovered = hoveredRegion === sigungu;
                  const isSelected = selectedSigungu === sigungu;
                  
                  return (
                    <g key={sigungu}>
                      <path
                        d={data.path}
                        fill={isSelected ? "#22c55e" : isHovered ? "#86efac" : "#e2e8f0"}
                        stroke={isSelected ? "#15803d" : isHovered ? "#22c55e" : "#94a3b8"}
                        strokeWidth={isSelected || isHovered ? 2 : 1}
                        className="cursor-pointer transition-all duration-200"
                        onMouseEnter={() => setHoveredRegion(sigungu)}
                        onMouseLeave={() => setHoveredRegion(null)}
                        onClick={() => handleSigunguClick(sigungu)}
                      />
                      <text
                        x={data.center[0]}
                        y={data.center[1]}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        className="pointer-events-none select-none"
                        fontSize="6"
                        fontWeight="500"
                        fill={isSelected ? "#15803d" : "#475569"}
                      >
                        {sigungu.replace(/시|군|구/, "")}
                      </text>
                    </g>
                  );
                })}
              </svg>
            )}

            {/* 호버 정보 표시 */}
            {hoveredRegion && (
              <div className="absolute bottom-3 left-3 px-3 py-1.5 bg-white/90 backdrop-blur rounded-lg shadow-sm">
                <span className="text-sm font-medium text-stone-700">{hoveredRegion}</span>
              </div>
            )}
          </div>

          {/* 선택 정보 */}
          <div className="mt-4 p-3 bg-stone-50 rounded-xl">
            <div className="flex items-center gap-2 text-sm">
              <MapPin className="w-4 h-4 text-primary" />
              <span className="text-stone-600">선택된 지역:</span>
              {selectedSido ? (
                <span className="font-medium text-stone-800">
                  {selectedSido}
                  {selectedSigungu && ` ${selectedSigungu}`}
                </span>
              ) : (
                <span className="text-stone-400">지역을 선택하세요</span>
              )}
            </div>
          </div>
        </div>

        {/* 푸터 */}
        <div className="p-4 border-t border-stone-100 flex justify-between">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-medium text-stone-600 hover:bg-stone-100 transition-colors"
          >
            취소
          </button>
          <button
            onClick={handleConfirm}
            disabled={!selectedSido || !selectedSigungu}
            className={cn(
              "flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium transition-colors",
              selectedSido && selectedSigungu
                ? "bg-primary text-white hover:bg-primary/90"
                : "bg-stone-200 text-stone-400 cursor-not-allowed"
            )}
          >
            <Check className="w-4 h-4" />
            선택 완료
          </button>
        </div>
      </div>
    </div>
  );
}
