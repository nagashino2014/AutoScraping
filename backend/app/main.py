"""
텍스트 추출 API 서버
FastAPI 기반 REST API
"""
import os
import asyncio
import time
from pathlib import Path
from typing import List, Optional
from datetime import datetime

from fastapi import FastAPI, HTTPException, BackgroundTasks, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
import json

from .services.extraction_service import get_extraction_service, ExtractionService
from .extractors.base import ExtractionStatus
from .config import ExtractionConfig, SCRAPING_DATA_DIR


# FastAPI 앱 초기화
app = FastAPI(
    title="텍스트 추출 API",
    description="PDF, HWP, DOCX 등 문서에서 텍스트를 추출하는 API",
    version="1.0.0"
)

# CORS 설정 (Next.js 프론트엔드 허용)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================================
# 요청/응답 모델
# ============================================================================

class ExtractRequest(BaseModel):
    """단일 파일 추출 요청"""
    file_path: str = Field(..., description="추출할 파일 경로")


class ExtractionConfigRequest(BaseModel):
    """추출 설정 요청"""
    ocr: Optional[dict] = None
    pdf: Optional[dict] = None
    hwp: Optional[dict] = None
    preprocessing: Optional[dict] = None
    encoding: Optional[dict] = None
    postprocessing: Optional[dict] = None
    table_normalization: Optional[dict] = None
    quality_validation: Optional[dict] = None
    processing: Optional[dict] = None
    retry_strategy: Optional[dict] = None


class BatchExtractRequest(BaseModel):
    """배치 추출 요청"""
    file_paths: List[str] = Field(..., description="추출할 파일 경로 목록")
    config: Optional[ExtractionConfigRequest] = None


class ExtractResponse(BaseModel):
    """추출 응답"""
    success: bool
    file_path: str
    status: str
    text: Optional[str] = None
    text_preview: Optional[str] = None
    page_count: int = 0
    char_count: int = 0
    token_count: int = 0
    quality_score: float = 0.0
    extraction_method: Optional[str] = None
    processing_time_ms: int = 0
    error_message: Optional[str] = None


class BatchExtractResponse(BaseModel):
    """배치 추출 응답"""
    total: int
    completed: int
    failed: int
    results: List[ExtractResponse]


class OCRSettingsUpdate(BaseModel):
    """OCR 설정 업데이트"""
    engine: Optional[str] = None  # paddleocr, easyocr, hybrid, tesseract
    use_gpu: Optional[bool] = None
    languages: Optional[List[str]] = None
    det_db_thresh: Optional[float] = None
    det_db_box_thresh: Optional[float] = None
    drop_score: Optional[float] = None


class PDFSettingsUpdate(BaseModel):
    """PDF 설정 업데이트"""
    prefer_text_layer: Optional[bool] = None
    enable_ocr: Optional[bool] = None
    extract_image_text: Optional[bool] = None
    render_dpi: Optional[int] = None
    ocr_languages: Optional[List[str]] = None


class PreprocessingSettingsUpdate(BaseModel):
    """전처리 설정 업데이트"""
    enabled: Optional[bool] = None
    adaptive_preprocessing: Optional[bool] = None
    deskew: Optional[bool] = None
    denoise: Optional[bool] = None
    contrast_enhancement: Optional[bool] = None
    target_dpi: Optional[int] = None


class PostprocessingSettingsUpdate(BaseModel):
    """후처리 설정 업데이트"""
    remove_headers: Optional[bool] = None
    remove_page_numbers: Optional[bool] = None
    normalize_whitespace: Optional[bool] = None
    normalize_special_chars: Optional[bool] = None
    ocr_error_correction: Optional[bool] = None
    domain_term_correction: Optional[bool] = None


class QualityValidationSettingsUpdate(BaseModel):
    """품질 검증 설정 업데이트"""
    enabled: Optional[bool] = None
    pass_threshold: Optional[float] = None
    llm_fallback_threshold: Optional[float] = None
    auto_llm_fallback: Optional[bool] = None


class ProcessingSettingsUpdate(BaseModel):
    """처리 설정 업데이트"""
    concurrent_files: Optional[int] = None
    timeout_seconds: Optional[int] = None
    auto_retry: Optional[bool] = None
    max_retries: Optional[int] = None


class SettingsUpdateRequest(BaseModel):
    """전체 설정 업데이트 요청"""
    ocr: Optional[OCRSettingsUpdate] = None
    pdf: Optional[PDFSettingsUpdate] = None
    preprocessing: Optional[PreprocessingSettingsUpdate] = None
    postprocessing: Optional[PostprocessingSettingsUpdate] = None
    quality_validation: Optional[QualityValidationSettingsUpdate] = None
    processing: Optional[ProcessingSettingsUpdate] = None


# ============================================================================
# API 엔드포인트
# ============================================================================

@app.get("/")
async def root():
    """API 상태 확인"""
    return {
        "status": "ok",
        "service": "Text Extraction API",
        "version": "1.0.0",
        "timestamp": datetime.now().isoformat()
    }


@app.get("/health")
async def health_check():
    """헬스 체크"""
    return {"status": "healthy"}


@app.get("/supported-formats")
async def get_supported_formats():
    """지원되는 파일 형식 목록"""
    service = get_extraction_service()
    return {
        "formats": service.get_supported_formats(),
        "details": {
            "pdf": {
                "name": "PDF",
                "description": "Portable Document Format",
                "methods": ["text_layer", "paddleocr", "hybrid"]
            },
            "hwp": {
                "name": "HWP",
                "description": "한글 워드프로세서 (97~2020)",
                "methods": ["olefile", "hwp5"]
            },
            "hwpx": {
                "name": "HWPX",
                "description": "한글 워드프로세서 XML (2014 이상)",
                "methods": ["xml_parser"]
            },
            "docx": {
                "name": "DOCX",
                "description": "Microsoft Word 문서",
                "methods": ["python-docx"]
            },
            "xlsx": {
                "name": "XLSX",
                "description": "Microsoft Excel 스프레드시트",
                "methods": ["openpyxl"]
            },
            "html": {
                "name": "HTML",
                "description": "웹 페이지 문서",
                "methods": ["beautifulsoup4", "lxml"]
            },
        }
    }


@app.post("/extract", response_model=ExtractResponse)
async def extract_file(request: ExtractRequest):
    """
    단일 파일 텍스트 추출
    
    - **file_path**: 추출할 파일의 전체 경로
    """
    service = get_extraction_service()
    
    # 파일 존재 확인
    if not Path(request.file_path).exists():
        raise HTTPException(status_code=404, detail=f"File not found: {request.file_path}")
    
    # 추출 실행
    result = await service.extract_file_async(request.file_path)
    
    return ExtractResponse(
        success=result.status == ExtractionStatus.COMPLETED,
        file_path=result.file_path,
        status=result.status.value,
        text=result.text,
        text_preview=result.text[:1000] + "..." if len(result.text) > 1000 else result.text,
        page_count=result.page_count,
        char_count=result.char_count,
        token_count=result.token_count,
        quality_score=result.quality_score,
        extraction_method=result.extraction_method.value if result.extraction_method else None,
        processing_time_ms=result.processing_time_ms,
        error_message=result.error_message
    )


@app.post("/extract/batch", response_model=BatchExtractResponse)
async def extract_files_batch(request: BatchExtractRequest):
    """
    배치 파일 텍스트 추출
    
    - **file_paths**: 추출할 파일들의 경로 목록
    """
    service = get_extraction_service()
    
    # 파일 존재 확인
    valid_paths = []
    for fp in request.file_paths:
        if Path(fp).exists():
            valid_paths.append(fp)
    
    if not valid_paths:
        raise HTTPException(status_code=404, detail="No valid files found")
    
    # 배치 추출 실행
    results = await service.extract_files_batch(valid_paths)
    
    # 응답 생성
    responses = []
    completed = 0
    failed = 0
    
    for result in results:
        success = result.status == ExtractionStatus.COMPLETED
        if success:
            completed += 1
        else:
            failed += 1
        
        responses.append(ExtractResponse(
            success=success,
            file_path=result.file_path,
            status=result.status.value,
            text_preview=result.text[:500] + "..." if len(result.text) > 500 else result.text,
            page_count=result.page_count,
            char_count=result.char_count,
            token_count=result.token_count,
            quality_score=result.quality_score,
            extraction_method=result.extraction_method.value if result.extraction_method else None,
            processing_time_ms=result.processing_time_ms,
            error_message=result.error_message
        ))
    
    return BatchExtractResponse(
        total=len(results),
        completed=completed,
        failed=failed,
        results=responses
    )


def apply_request_config(service: ExtractionService, config: Optional[ExtractionConfigRequest]) -> None:
    """요청에서 받은 설정을 서비스에 적용"""
    if not config:
        return
    
    # OCR 설정
    if config.ocr:
        if "engine" in config.ocr:
            service.config.ocr.engine = config.ocr["engine"]
        if "languages" in config.ocr:
            service.config.ocr.languages = config.ocr["languages"]
        if "confidence_threshold" in config.ocr:
            service.config.ocr.confidence_threshold = config.ocr["confidence_threshold"]
            service.config.ocr.drop_score = config.ocr["confidence_threshold"]
        if "det_db_thresh" in config.ocr:
            service.config.ocr.det_db_thresh = config.ocr["det_db_thresh"]
        if "det_db_box_thresh" in config.ocr:
            service.config.ocr.det_db_box_thresh = config.ocr["det_db_box_thresh"]
    
    # PDF 설정
    if config.pdf:
        if "prefer_text_layer" in config.pdf:
            service.config.pdf.prefer_text_layer = config.pdf["prefer_text_layer"]
        if "enable_ocr" in config.pdf:
            service.config.pdf.enable_ocr = config.pdf["enable_ocr"]
        if "extract_image_text" in config.pdf:
            service.config.pdf.extract_image_text = config.pdf["extract_image_text"]
        if "force_ocr_mode" in config.pdf:
            service.config.pdf.force_ocr_mode = config.pdf["force_ocr_mode"]
        if "hybrid_extraction" in config.pdf:
            service.config.pdf.hybrid_extraction = config.pdf["hybrid_extraction"]
        if "page_optimal_method" in config.pdf:
            service.config.pdf.page_optimal_method = config.pdf["page_optimal_method"]
    
    # HWP 설정
    if config.hwp:
        if "preserve_table_structure" in config.hwp:
            service.config.hwp.preserve_table_structure = config.hwp["preserve_table_structure"]
        if "convert_bullets" in config.hwp:
            service.config.hwp.convert_bullets = config.hwp["convert_bullets"]
        if "include_footnotes" in config.hwp:
            service.config.hwp.include_footnotes = config.hwp["include_footnotes"]
    
    # 전처리 설정
    if config.preprocessing:
        if "enabled" in config.preprocessing:
            service.config.preprocessing.enabled = config.preprocessing["enabled"]
        if "render_dpi" in config.preprocessing:
            service.config.preprocessing.target_dpi = config.preprocessing["render_dpi"]
            service.config.pdf.render_dpi = config.preprocessing["render_dpi"]
        if "deskew" in config.preprocessing:
            service.config.preprocessing.deskew = config.preprocessing["deskew"]
        if "denoise" in config.preprocessing:
            service.config.preprocessing.denoise = config.preprocessing["denoise"]
        if "binarize" in config.preprocessing:
            service.config.preprocessing.binarize = config.preprocessing["binarize"]
        if "contrast_enhancement" in config.preprocessing:
            service.config.preprocessing.contrast_enhancement = config.preprocessing["contrast_enhancement"]
        if "adaptive_preprocessing" in config.preprocessing:
            service.config.preprocessing.adaptive_preprocessing = config.preprocessing["adaptive_preprocessing"]
    
    # 인코딩 설정
    if config.encoding:
        if "auto_detect" in config.encoding:
            service.config.encoding.auto_detect = config.encoding["auto_detect"]
        if "force_encoding" in config.encoding:
            service.config.encoding.force_encoding = config.encoding["force_encoding"]
        if "fix_utf16_errors" in config.encoding:
            service.config.encoding.fix_utf16_errors = config.encoding["fix_utf16_errors"]
        if "remove_broken_chars" in config.encoding:
            service.config.encoding.remove_broken_chars = config.encoding["remove_broken_chars"]
    
    # 후처리 설정
    if config.postprocessing:
        if "remove_headers" in config.postprocessing:
            service.config.postprocessing.remove_headers = config.postprocessing["remove_headers"]
        if "remove_page_numbers" in config.postprocessing:
            service.config.postprocessing.remove_page_numbers = config.postprocessing["remove_page_numbers"]
        if "normalize_whitespace" in config.postprocessing:
            service.config.postprocessing.normalize_whitespace = config.postprocessing["normalize_whitespace"]
        if "ocr_error_correction" in config.postprocessing:
            service.config.postprocessing.ocr_error_correction = config.postprocessing["ocr_error_correction"]
        if "normalize_special_chars" in config.postprocessing:
            service.config.postprocessing.normalize_special_chars = config.postprocessing["normalize_special_chars"]
    
    # 표 정규화 설정
    if config.table_normalization:
        if "flatten_headers" in config.table_normalization:
            service.config.table_normalization.flatten_headers = config.table_normalization["flatten_headers"]
        if "fill_empty_cells" in config.table_normalization:
            service.config.table_normalization.fill_empty_cells = config.table_normalization["fill_empty_cells"]
    
    # 품질 검증 설정
    if config.quality_validation:
        if "enabled" in config.quality_validation:
            service.config.quality_validation.enabled = config.quality_validation["enabled"]
        if "pass_threshold" in config.quality_validation:
            service.config.quality_validation.pass_threshold = config.quality_validation["pass_threshold"]
        if "auto_llm_fallback" in config.quality_validation:
            service.config.quality_validation.auto_llm_fallback = config.quality_validation["auto_llm_fallback"]
    
    # 처리 설정
    if config.processing:
        if "concurrent_files" in config.processing:
            service.config.processing.concurrent_files = config.processing["concurrent_files"]
        if "timeout_seconds" in config.processing:
            service.config.processing.timeout_seconds = config.processing["timeout_seconds"]
    
    # 재시도 전략 설정
    if config.retry_strategy:
        if "enable_progressive_retry" in config.retry_strategy:
            service.config.retry_strategy.enable_progressive_retry = config.retry_strategy["enable_progressive_retry"]
        if "multi_engine_comparison" in config.retry_strategy:
            service.config.retry_strategy.multi_engine_comparison = config.retry_strategy["multi_engine_comparison"]
        if "quality_based_adjustment" in config.retry_strategy:
            service.config.retry_strategy.quality_based_adjustment = config.retry_strategy["quality_based_adjustment"]
    
    # 설정 변경 로그
    print(f"[CONFIG] Applied: OCR={service.config.ocr.engine}, "
          f"DPI={service.config.pdf.render_dpi}, "
          f"ForceOCR={service.config.pdf.force_ocr_mode}, "
          f"Hybrid={service.config.pdf.hybrid_extraction}, "
          f"ProgressiveRetry={service.config.retry_strategy.enable_progressive_retry}")


@app.post("/extract/stream")
async def extract_files_stream(request: BatchExtractRequest):
    """
    스트리밍 배치 추출 (SSE)
    실시간으로 추출 진행 상황을 전송
    """
    service = get_extraction_service()
    
    # 요청에서 받은 설정 적용
    apply_request_config(service, request.config)
    
    event_queue = asyncio.Queue()
    
    async def run_extraction():
        """백그라운드에서 추출 실행"""
        completed = 0
        failed = 0
        total = len(request.file_paths)
        
        async def progress_callback(current: int, total_count: int, result):
            nonlocal completed, failed
            
            success = result.status == ExtractionStatus.COMPLETED
            if success:
                completed += 1
            else:
                failed += 1
            
            event_data = {
                "type": "progress",
                "current": current,
                "total": total_count,
                "completed": completed,
                "failed": failed,
                "file_path": result.file_path,
                "file_name": Path(result.file_path).name,
                "status": result.status.value,
                "quality_score": result.quality_score,
                "quality_details": result.quality_details.to_dict() if result.quality_details else None,
                "processing_time_ms": result.processing_time_ms,
                "error_message": result.error_message,
            }
            
            # 상세 로그 출력
            status_emoji = "✓" if success else "✗"
            log_msg = f"[EXTRACTION] {status_emoji} {current}/{total_count}: {Path(result.file_path).name} -> {result.status.value}"
            if result.error_message:
                log_msg += f" | ERROR: {result.error_message[:100]}"
            if success:
                log_msg += f" | Quality: {result.quality_score:.2f}, Chars: {result.char_count}"
            print(log_msg)
            await event_queue.put(event_data)
        
        # 배치 처리 실행
        print(f"[EXTRACTION] Starting batch extraction for {total} files")
        results = await service.extract_files_batch(
            request.file_paths,
            progress_callback=progress_callback
        )
        
        # 완료 이벤트
        summary = {
            "type": "complete",
            "total": total,
            "completed": completed,
            "failed": failed,
        }
        print(f"[EXTRACTION] Completed: {completed}/{total}, Failed: {failed}")
        await event_queue.put(summary)
        await event_queue.put(None)  # 종료 신호
    
    async def generate():
        total = len(request.file_paths)
        
        # 시작 이벤트
        yield f"data: {json.dumps({'event': 'start', 'total': total})}\n\n"
        
        # 추출 작업 시작
        extraction_task = asyncio.create_task(run_extraction())
        
        # 이벤트 스트리밍 (keep-alive 포함)
        last_keepalive = time.time()
        while True:
            try:
                # 30초마다 keep-alive 이벤트 전송
                event = await asyncio.wait_for(event_queue.get(), timeout=30.0)
                if event is None:  # 종료 신호
                    break
                yield f"data: {json.dumps(event)}\n\n"
                last_keepalive = time.time()
            except asyncio.TimeoutError:
                # 30초 동안 이벤트가 없으면 keep-alive 전송
                yield f"data: {json.dumps({'type': 'keepalive', 'elapsed': int(time.time() - last_keepalive)})}\n\n"
        
        await extraction_task  # 작업 완료 대기
    
    return StreamingResponse(
        generate(),
        media_type="text/event-stream"
    )


@app.get("/files")
async def list_files(
    org_id: Optional[str] = None,
    board_id: Optional[str] = None,
    format: Optional[str] = None,
    limit: int = Query(default=50, le=200)
):
    """
    추출 대상 파일 목록 조회
    ScrapingData 디렉토리에서 파일 목록을 반환
    """
    files = []
    
    # ScrapingData 디렉토리 탐색
    if not SCRAPING_DATA_DIR.exists():
        return {"files": [], "total": 0}
    
    search_path = SCRAPING_DATA_DIR
    if org_id:
        search_path = search_path / org_id
        if board_id:
            search_path = search_path / board_id
    
    if not search_path.exists():
        return {"files": [], "total": 0}
    
    # 파일 검색
    patterns = ["*.pdf", "*.hwp", "*.hwpx", "*.docx", "*.xlsx"]
    if format:
        patterns = [f"*.{format.lower()}"]
    
    for pattern in patterns:
        for file_path in search_path.rglob(pattern):
            if len(files) >= limit:
                break
            
            stat = file_path.stat()
            files.append({
                "file_path": str(file_path),
                "file_name": file_path.name,
                "file_format": file_path.suffix.lower().lstrip('.'),
                "file_size": stat.st_size,
                "modified_at": datetime.fromtimestamp(stat.st_mtime).isoformat(),
            })
    
    return {
        "files": files[:limit],
        "total": len(files)
    }


@app.get("/settings")
async def get_settings():
    """
    현재 추출 설정 조회
    
    모든 설정 카테고리 반환:
    - OCR 설정
    - PDF 설정
    - 전처리 설정
    - 후처리 설정
    - 품질 검증 설정
    - 처리 설정
    """
    service = get_extraction_service()
    return service.get_current_config()


@app.put("/settings")
async def update_settings(request: SettingsUpdateRequest):
    """
    추출 설정 업데이트
    
    변경하려는 설정만 포함하여 요청
    예시:
    {
        "ocr": {"engine": "easyocr", "use_gpu": true},
        "pdf": {"render_dpi": 200},
        "processing": {"concurrent_files": 5}
    }
    """
    service = get_extraction_service()
    config = service.config
    
    # OCR 설정 업데이트
    if request.ocr:
        if request.ocr.engine is not None:
            config.ocr.engine = request.ocr.engine
        if request.ocr.use_gpu is not None:
            config.ocr.use_gpu = request.ocr.use_gpu
        if request.ocr.languages is not None:
            config.ocr.languages = request.ocr.languages
        if request.ocr.det_db_thresh is not None:
            config.ocr.det_db_thresh = request.ocr.det_db_thresh
        if request.ocr.det_db_box_thresh is not None:
            config.ocr.det_db_box_thresh = request.ocr.det_db_box_thresh
        if request.ocr.drop_score is not None:
            config.ocr.drop_score = request.ocr.drop_score
    
    # PDF 설정 업데이트
    if request.pdf:
        if request.pdf.prefer_text_layer is not None:
            config.pdf.prefer_text_layer = request.pdf.prefer_text_layer
        if request.pdf.enable_ocr is not None:
            config.pdf.enable_ocr = request.pdf.enable_ocr
        if request.pdf.extract_image_text is not None:
            config.pdf.extract_image_text = request.pdf.extract_image_text
        if request.pdf.render_dpi is not None:
            config.pdf.render_dpi = request.pdf.render_dpi
        if request.pdf.ocr_languages is not None:
            config.pdf.ocr_languages = request.pdf.ocr_languages
    
    # 전처리 설정 업데이트
    if request.preprocessing:
        if request.preprocessing.enabled is not None:
            config.preprocessing.enabled = request.preprocessing.enabled
        if request.preprocessing.adaptive_preprocessing is not None:
            config.preprocessing.adaptive_preprocessing = request.preprocessing.adaptive_preprocessing
        if request.preprocessing.deskew is not None:
            config.preprocessing.deskew = request.preprocessing.deskew
        if request.preprocessing.denoise is not None:
            config.preprocessing.denoise = request.preprocessing.denoise
        if request.preprocessing.contrast_enhancement is not None:
            config.preprocessing.contrast_enhancement = request.preprocessing.contrast_enhancement
        if request.preprocessing.target_dpi is not None:
            config.preprocessing.target_dpi = request.preprocessing.target_dpi
    
    # 후처리 설정 업데이트
    if request.postprocessing:
        if request.postprocessing.remove_headers is not None:
            config.postprocessing.remove_headers = request.postprocessing.remove_headers
        if request.postprocessing.remove_page_numbers is not None:
            config.postprocessing.remove_page_numbers = request.postprocessing.remove_page_numbers
        if request.postprocessing.normalize_whitespace is not None:
            config.postprocessing.normalize_whitespace = request.postprocessing.normalize_whitespace
        if request.postprocessing.normalize_special_chars is not None:
            config.postprocessing.normalize_special_chars = request.postprocessing.normalize_special_chars
        if request.postprocessing.ocr_error_correction is not None:
            config.postprocessing.ocr_error_correction = request.postprocessing.ocr_error_correction
        if request.postprocessing.domain_term_correction is not None:
            config.postprocessing.domain_term_correction = request.postprocessing.domain_term_correction
    
    # 품질 검증 설정 업데이트
    if request.quality_validation:
        if request.quality_validation.enabled is not None:
            config.quality_validation.enabled = request.quality_validation.enabled
        if request.quality_validation.pass_threshold is not None:
            config.quality_validation.pass_threshold = request.quality_validation.pass_threshold
        if request.quality_validation.llm_fallback_threshold is not None:
            config.quality_validation.llm_fallback_threshold = request.quality_validation.llm_fallback_threshold
        if request.quality_validation.auto_llm_fallback is not None:
            config.quality_validation.auto_llm_fallback = request.quality_validation.auto_llm_fallback
    
    # 처리 설정 업데이트
    if request.processing:
        if request.processing.concurrent_files is not None:
            config.processing.concurrent_files = request.processing.concurrent_files
        if request.processing.timeout_seconds is not None:
            config.processing.timeout_seconds = request.processing.timeout_seconds
        if request.processing.auto_retry is not None:
            config.processing.auto_retry = request.processing.auto_retry
        if request.processing.max_retries is not None:
            config.processing.max_retries = request.processing.max_retries
    
    # 서비스에 설정 적용
    service.update_config(config)
    
    return {
        "success": True, 
        "message": "Settings updated successfully",
        "current_settings": service.get_current_config()
    }


# ============================================================================
# HuggingFace 임베딩 API
# ============================================================================

# 지원되는 HuggingFace 모델
HUGGINGFACE_MODELS = {
    "ko-sroberta": {
        "name": "jhgan/ko-sroberta-multitask",
        "dimensions": 768,
        "max_tokens": 512,
        "description": "한국어 특화 임베딩 모델"
    },
    "bge-m3": {
        "name": "BAAI/bge-m3",
        "dimensions": 1024,
        "max_tokens": 8192,
        "description": "다국어 지원 임베딩 모델"
    }
}

# 모델 캐시 (싱글톤)
_embedding_models = {}

def get_embedding_model(model_id: str):
    """임베딩 모델 가져오기 (캐싱)"""
    if model_id not in HUGGINGFACE_MODELS:
        raise ValueError(f"Unknown model: {model_id}")
    
    if model_id not in _embedding_models:
        from sentence_transformers import SentenceTransformer
        model_name = HUGGINGFACE_MODELS[model_id]["name"]
        print(f"[EMBEDDING] Loading model: {model_name}")
        _embedding_models[model_id] = SentenceTransformer(model_name)
        print(f"[EMBEDDING] Model loaded: {model_name}")
    
    return _embedding_models[model_id]


class EmbeddingRequest(BaseModel):
    """임베딩 요청"""
    texts: List[str] = Field(..., description="임베딩할 텍스트 목록")
    model: str = Field(default="ko-sroberta", description="모델 ID (ko-sroberta, bge-m3)")


class EmbeddingResponse(BaseModel):
    """임베딩 응답"""
    success: bool
    embeddings: List[List[float]]
    model: str
    dimensions: int
    count: int
    processing_time_ms: int


@app.get("/embedding/models")
async def get_embedding_models():
    """사용 가능한 HuggingFace 임베딩 모델 목록"""
    return {
        "models": [
            {
                "id": model_id,
                "name": info["name"],
                "dimensions": info["dimensions"],
                "max_tokens": info["max_tokens"],
                "description": info["description"],
                "loaded": model_id in _embedding_models
            }
            for model_id, info in HUGGINGFACE_MODELS.items()
        ]
    }


@app.post("/embedding/generate", response_model=EmbeddingResponse)
async def generate_embeddings(request: EmbeddingRequest):
    """
    HuggingFace 모델을 사용한 임베딩 생성
    
    - **texts**: 임베딩할 텍스트 목록
    - **model**: 사용할 모델 ID (ko-sroberta, bge-m3)
    """
    start_time = time.time()
    
    try:
        model = get_embedding_model(request.model)
        model_info = HUGGINGFACE_MODELS[request.model]
        
        # 임베딩 생성
        embeddings = model.encode(
            request.texts,
            convert_to_numpy=True,
            show_progress_bar=False
        )
        
        # numpy array를 list로 변환
        embeddings_list = embeddings.tolist()
        
        processing_time = int((time.time() - start_time) * 1000)
        
        return EmbeddingResponse(
            success=True,
            embeddings=embeddings_list,
            model=model_info["name"],
            dimensions=model_info["dimensions"],
            count=len(embeddings_list),
            processing_time_ms=processing_time
        )
        
    except Exception as e:
        print(f"[EMBEDDING] Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/embedding/batch")
async def generate_embeddings_batch(request: EmbeddingRequest):
    """
    배치 임베딩 생성 (대용량 처리)
    
    - **texts**: 임베딩할 텍스트 목록
    - **model**: 사용할 모델 ID
    
    텍스트가 많은 경우 배치 단위로 처리합니다.
    """
    start_time = time.time()
    batch_size = 32
    
    try:
        model = get_embedding_model(request.model)
        model_info = HUGGINGFACE_MODELS[request.model]
        
        all_embeddings = []
        total = len(request.texts)
        
        # 배치 단위로 처리
        for i in range(0, total, batch_size):
            batch = request.texts[i:i + batch_size]
            embeddings = model.encode(
                batch,
                convert_to_numpy=True,
                show_progress_bar=False
            )
            all_embeddings.extend(embeddings.tolist())
            
            # 진행 상황 로그
            processed = min(i + batch_size, total)
            print(f"[EMBEDDING] Processed {processed}/{total} texts")
        
        processing_time = int((time.time() - start_time) * 1000)
        
        return {
            "success": True,
            "embeddings": all_embeddings,
            "model": model_info["name"],
            "dimensions": model_info["dimensions"],
            "count": len(all_embeddings),
            "processing_time_ms": processing_time
        }
        
    except Exception as e:
        print(f"[EMBEDDING] Batch error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/embedding/preload/{model_id}")
async def preload_embedding_model(model_id: str):
    """
    임베딩 모델 사전 로드
    
    모델을 미리 로드하여 첫 번째 요청의 지연 시간을 줄입니다.
    """
    if model_id not in HUGGINGFACE_MODELS:
        raise HTTPException(status_code=404, detail=f"Unknown model: {model_id}")
    
    try:
        model = get_embedding_model(model_id)
        model_info = HUGGINGFACE_MODELS[model_id]
        
        return {
            "success": True,
            "model_id": model_id,
            "model_name": model_info["name"],
            "dimensions": model_info["dimensions"],
            "status": "loaded"
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# 벡터 DB (ChromaDB) API
# ============================================================================

from app.vectordb import (
    is_available as chromadb_is_available,
    add_embeddings,
    get_embeddings,
    search_similar,
    delete_embeddings,
    get_stats,
    check_exists,
    migrate_from_json,
    delete_by_filter,
    clear_collection,
    get_collection_info,
    get_table_chunks,
    reconstruct_table
)


class VectorizeRequest(BaseModel):
    """벡터화 요청"""
    chunks: List[dict] = Field(..., description="청크 데이터 목록 (id, content, embedding, metadata)")


class SearchRequest(BaseModel):
    """벡터 검색 요청"""
    query_embedding: List[float] = Field(..., description="쿼리 임베딩 벡터")
    n_results: int = Field(default=10, description="결과 수")
    filter: Optional[dict] = Field(default=None, description="메타데이터 필터")


class MigrateRequest(BaseModel):
    """마이그레이션 요청"""
    json_path: Optional[str] = Field(default=None, description="JSON 파일 경로 (기본: embedding-data.json)")


@app.get("/vectordb/status")
async def get_vectordb_status():
    """벡터 DB 상태 조회"""
    try:
        if not chromadb_is_available():
            return {
                "success": False,
                "status": "not_installed",
                "db_type": "ChromaDB",
                "total_embeddings": 0,
                "error": "ChromaDB가 설치되지 않았습니다. Visual C++ Build Tools를 설치한 후 'pip install chromadb'를 실행해주세요.",
                "chromadb_available": False
            }
        
        stats = get_stats()
        return {
            "success": stats.get("success", False),
            "status": "connected" if stats.get("success") else "error",
            "db_type": "ChromaDB",
            **stats
        }
    except Exception as e:
        return {
            "success": False,
            "status": "error",
            "error": str(e),
            "chromadb_available": chromadb_is_available()
        }


@app.post("/vectordb/upsert")
async def upsert_vectors(request: VectorizeRequest):
    """벡터 DB에 벡터 추가/업데이트"""
    try:
        ids = []
        embeddings = []
        documents = []
        metadatas = []
        
        for chunk in request.chunks:
            if not chunk.get("embedding"):
                continue
            
            ids.append(chunk["id"])
            embeddings.append(chunk["embedding"])
            documents.append(chunk.get("content", ""))
            
            # 메타데이터 준비
            metadata = chunk.get("metadata", {})
            metadatas.append(metadata)
        
        if not ids:
            return {"success": False, "error": "임베딩된 청크가 없습니다.", "count": 0}
        
        # ChromaDB에 저장
        result = add_embeddings(ids, embeddings, documents, metadatas)
        
        return {
            "success": result["success"],
            "added": result.get("added", 0),
            "updated": result.get("updated", 0),
            "total_vectors": result.get("total", 0),
            "error": result.get("error")
        }
        
    except Exception as e:
        print(f"[VECTORDB] Upsert error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/vectordb/search")
async def search_vectors(request: SearchRequest):
    """벡터 유사도 검색"""
    try:
        result = search_similar(
            query_embedding=request.query_embedding,
            n_results=request.n_results,
            where=request.filter
        )
        
        return {
            "success": result["success"],
            "results": result.get("results", []),
            "count": result.get("count", 0),
            "error": result.get("error")
        }
        
    except Exception as e:
        print(f"[VECTORDB] Search error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/vectordb/get")
async def get_vectors(ids: List[str]):
    """ID로 벡터 조회"""
    try:
        result = get_embeddings(ids)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/vectordb/delete")
async def delete_vectors(ids: List[str]):
    """벡터 삭제"""
    try:
        result = delete_embeddings(ids)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/vectordb/check-exists")
async def check_vectors_exist(ids: List[str]):
    """벡터 존재 여부 확인"""
    try:
        result = check_exists(ids)
        return {"success": True, "exists": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/vectordb/migrate")
async def migrate_json_to_vectordb(request: MigrateRequest):
    """JSON 파일에서 ChromaDB로 마이그레이션"""
    try:
        # 기본 경로
        json_path = request.json_path
        if not json_path:
            json_path = str(Path(__file__).parent.parent.parent / "frontend" / "data" / "embedding-data.json")
        
        result = migrate_from_json(json_path)
        return result
        
    except Exception as e:
        print(f"[VECTORDB] Migration error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# 인덱스 관리 API
# ============================================================================

class DeleteByFilterRequest(BaseModel):
    """조건부 삭제 요청"""
    filter: dict = Field(..., description="삭제 조건 (메타데이터 필터)")


@app.get("/vectordb/collections")
async def get_collections():
    """컬렉션 목록 및 정보 조회"""
    try:
        result = get_collection_info()
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/vectordb/delete-by-filter")
async def delete_vectors_by_filter(request: DeleteByFilterRequest):
    """메타데이터 조건으로 벡터 삭제"""
    try:
        result = delete_by_filter(request.filter)
        return result
    except Exception as e:
        print(f"[VECTORDB] Delete by filter error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/vectordb/clear")
async def clear_vectordb():
    """컬렉션 전체 초기화"""
    try:
        result = clear_collection()
        return result
    except Exception as e:
        print(f"[VECTORDB] Clear error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# 표 재조합 API
# ============================================================================

class TableReconstructRequest(BaseModel):
    """표 재조합 요청"""
    table_id: str = Field(..., description="테이블 ID")


@app.post("/vectordb/table-chunks")
async def get_table_chunks_api(request: TableReconstructRequest):
    """table_id로 관련 테이블 청크 조회"""
    try:
        result = get_table_chunks(request.table_id)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/vectordb/reconstruct-table")
async def reconstruct_table_api(request: TableReconstructRequest):
    """분할된 테이블 청크를 병합하여 재조합"""
    try:
        result = reconstruct_table(request.table_id)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# 데이터 내보내기 API
# ============================================================================

@app.get("/vectordb/peek")
async def peek_vectors(limit: int = 1000):
    """벡터 데이터 미리보기 (내보내기용)"""
    try:
        from app.vectordb import get_collection, CHROMADB_AVAILABLE
        
        if not CHROMADB_AVAILABLE:
            return {"success": False, "error": "ChromaDB가 설치되지 않았습니다."}
        
        collection = get_collection()
        if collection is None:
            return {"success": False, "error": "컬렉션 초기화 실패"}
        
        # peek으로 데이터 조회
        result = collection.peek(limit=min(limit, 10000))
        
        return {
            "success": True,
            "ids": result.get("ids", []),
            "documents": result.get("documents", []),
            "metadatas": result.get("metadatas", []),
            "count": len(result.get("ids", []))
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# 데이터 가져오기 API
# ============================================================================

class VectorImportItem(BaseModel):
    """가져올 벡터 데이터"""
    id: str
    document: str
    metadata: dict = {}


class VectorImportRequest(BaseModel):
    """벡터 가져오기 요청"""
    vectors: list[VectorImportItem]


@app.post("/vectordb/import")
async def import_vectors(request: VectorImportRequest):
    """벡터 데이터 가져오기 (재임베딩 후 저장)"""
    try:
        from app.vectordb import upsert_embeddings, CHROMADB_AVAILABLE
        
        if not CHROMADB_AVAILABLE:
            return {"success": False, "error": "ChromaDB가 설치되지 않았습니다."}
        
        if not request.vectors:
            return {"success": False, "error": "가져올 데이터가 없습니다."}
        
        # 임베딩 모델 설정 확인
        embedding_model = None
        try:
            import json
            from pathlib import Path
            settings_path = Path(__file__).parent.parent.parent / "frontend" / "data" / "embedding-settings.json"
            if settings_path.exists():
                with open(settings_path, "r", encoding="utf-8") as f:
                    settings = json.load(f)
                    embedding_model = settings.get("model", "openai-small")
        except Exception:
            embedding_model = "openai-small"
        
        # 임베딩 생성 (OpenAI 사용)
        import os
        api_key = os.environ.get("OPENAI_API_KEY")
        
        if not api_key and embedding_model and embedding_model.startswith("openai"):
            return {"success": False, "error": "OpenAI API 키가 설정되지 않았습니다. .env.local에 OPENAI_API_KEY를 설정하세요."}
        
        # 문서 추출
        documents = [v.document for v in request.vectors]
        ids = [v.id for v in request.vectors]
        metadatas = [v.metadata for v in request.vectors]
        
        # 임베딩 생성
        embeddings = []
        
        if embedding_model and embedding_model.startswith("openai"):
            import openai
            client = openai.OpenAI(api_key=api_key)
            
            model_name = "text-embedding-3-small" if embedding_model == "openai-small" else "text-embedding-3-large"
            
            # 배치로 임베딩 생성
            batch_size = 100
            for i in range(0, len(documents), batch_size):
                batch_docs = documents[i:i + batch_size]
                response = client.embeddings.create(
                    model=model_name,
                    input=batch_docs
                )
                for item in response.data:
                    embeddings.append(item.embedding)
        else:
            # 로컬 모델 사용
            from sentence_transformers import SentenceTransformer
            model_name = "jhgan/ko-sroberta-multitask" if embedding_model == "ko-sroberta" else "BAAI/bge-m3"
            model = SentenceTransformer(model_name)
            embeddings = model.encode(documents).tolist()
        
        # ChromaDB에 저장
        result = upsert_embeddings(
            ids=ids,
            embeddings=embeddings,
            documents=documents,
            metadatas=metadatas
        )
        
        return {
            "success": True,
            "imported": len(ids),
            "message": f"{len(ids)}개 벡터가 복원되었습니다."
        }
        
    except Exception as e:
        print(f"[VECTORDB] Import error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# RAG 이슈 발굴 API
# ============================================================================

from app.rag_discovery import (
    cluster_embeddings,
    generate_issue_candidates,
    ChunkData,
    discover_issues_pipeline
)


class DiscoveryConfig(BaseModel):
    """이슈 발굴 설정"""
    numIssues: int = Field(default=10, description="발굴할 이슈 수")
    numClusters: int = Field(default=15, description="클러스터 수")
    minClusterSize: int = Field(default=3, description="최소 클러스터 크기")
    scoreWeights: dict = Field(default={
        "legalMandatory": 0.40,
        "novelty": 0.25,
        "impact": 0.20,
        "international": 0.15,
    })


class DiscoveryRequest(BaseModel):
    """이슈 발굴 요청"""
    filter: Optional[dict] = Field(default=None, description="메타데이터 필터")
    config: DiscoveryConfig = Field(default_factory=DiscoveryConfig)
    limit: int = Field(default=1000, description="최대 청크 수")


class ClusteringRequest(BaseModel):
    """클러스터링 요청"""
    chunk_ids: Optional[List[str]] = Field(default=None, description="청크 ID 목록 (없으면 전체)")
    n_clusters: int = Field(default=15, description="클러스터 수")
    min_cluster_size: int = Field(default=3, description="최소 클러스터 크기")
    filter: Optional[dict] = Field(default=None, description="메타데이터 필터")
    limit: int = Field(default=1000, description="최대 청크 수")


@app.post("/rag/cluster")
async def cluster_chunks(request: ClusteringRequest):
    """
    벡터 데이터 클러스터링
    
    필터 조건에 맞는 청크들을 K-Means로 클러스터링합니다.
    """
    try:
        from app.vectordb import get_collection, CHROMADB_AVAILABLE
        
        if not CHROMADB_AVAILABLE:
            return {"success": False, "error": "ChromaDB가 설치되지 않았습니다."}
        
        collection = get_collection()
        if collection is None:
            return {"success": False, "error": "컬렉션 초기화 실패"}
        
        # 청크 데이터 조회
        if request.chunk_ids:
            result = collection.get(
                ids=request.chunk_ids,
                include=["embeddings", "documents", "metadatas"]
            )
        elif request.filter:
            result = collection.get(
                where=request.filter,
                limit=request.limit,
                include=["embeddings", "documents", "metadatas"]
            )
        else:
            # 전체 데이터 (제한)
            result = collection.peek(limit=request.limit)
            # peek은 embeddings를 포함하지 않으므로 다시 조회
            if result.get("ids"):
                result = collection.get(
                    ids=result["ids"][:request.limit],
                    include=["embeddings", "documents", "metadatas"]
                )
        
        if not result.get("ids"):
            return {"success": False, "error": "청크 데이터가 없습니다.", "clusters": []}
        
        # ChunkData 변환
        chunks = []
        for i, chunk_id in enumerate(result["ids"]):
            embedding = result["embeddings"][i] if result.get("embeddings") else None
            if embedding:
                chunks.append(ChunkData(
                    id=chunk_id,
                    content=result["documents"][i] if result.get("documents") else "",
                    embedding=embedding,
                    metadata=result["metadatas"][i] if result.get("metadatas") else {}
                ))
        
        if not chunks:
            return {"success": False, "error": "임베딩된 청크가 없습니다.", "clusters": []}
        
        # 클러스터링 수행
        clusters, stats = cluster_embeddings(
            chunks,
            n_clusters=request.n_clusters,
            min_cluster_size=request.min_cluster_size
        )
        
        # 결과 직렬화
        cluster_results = []
        for cluster in clusters:
            cluster_results.append({
                "clusterId": cluster.cluster_id,
                "chunkIds": cluster.chunk_ids,
                "size": cluster.size,
                "keywords": cluster.keywords,
                "representativeChunks": [
                    {
                        "id": c.id,
                        "content": c.content[:300],
                        "metadata": c.metadata
                    }
                    for c in cluster.representative_chunks
                ]
            })
        
        return {
            "success": True,
            "clusters": cluster_results,
            "stats": stats
        }
        
    except Exception as e:
        print(f"[RAG] Clustering error: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/rag/discover")
async def discover_issues_sync(request: DiscoveryRequest):
    """
    이슈 발굴 (동기식)
    
    LLM 없이 클러스터링 기반 이슈 후보만 생성합니다.
    """
    try:
        from app.vectordb import get_collection, CHROMADB_AVAILABLE
        
        if not CHROMADB_AVAILABLE:
            return {"success": False, "error": "ChromaDB가 설치되지 않았습니다."}
        
        collection = get_collection()
        if collection is None:
            return {"success": False, "error": "컬렉션 초기화 실패"}
        
        # 청크 데이터 조회
        if request.filter:
            result = collection.get(
                where=request.filter,
                limit=request.limit,
                include=["embeddings", "documents", "metadatas"]
            )
        else:
            result = collection.peek(limit=request.limit)
            if result.get("ids"):
                result = collection.get(
                    ids=result["ids"][:request.limit],
                    include=["embeddings", "documents", "metadatas"]
                )
        
        if not result.get("ids"):
            return {"success": False, "error": "청크 데이터가 없습니다."}
        
        # ChunkData 변환
        chunks = []
        for i, chunk_id in enumerate(result["ids"]):
            embedding = result["embeddings"][i] if result.get("embeddings") else None
            if embedding:
                chunks.append(ChunkData(
                    id=chunk_id,
                    content=result["documents"][i] if result.get("documents") else "",
                    embedding=embedding,
                    metadata=result["metadatas"][i] if result.get("metadatas") else {}
                ))
        
        if not chunks:
            return {"success": False, "error": "임베딩된 청크가 없습니다."}
        
        # 클러스터링
        clusters, stats = cluster_embeddings(
            chunks,
            n_clusters=request.config.numClusters,
            min_cluster_size=request.config.minClusterSize
        )
        
        # 이슈 후보 생성
        candidates = generate_issue_candidates(clusters, request.config.numIssues)
        
        # 결과 변환
        issues = []
        for candidate in candidates:
            issues.append({
                "clusterId": candidate.cluster_id,
                "title": candidate.title,
                "summary": candidate.summary,
                "keywords": candidate.keywords,
                "representativeChunkIds": candidate.representative_chunk_ids,
                "clusterSize": candidate.cluster_size,
                "sources": candidate.sources,
                "score": candidate.score,
                "status": "discovered",
            })
        
        return {
            "success": True,
            "issues": issues,
            "stats": {
                **stats,
                "num_issues": len(issues),
            },
            "filteredChunkCount": len(chunks)
        }
        
    except Exception as e:
        print(f"[RAG] Discovery error: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# 서버 실행
# ============================================================================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=True
    )
