"""
ChromaDB 벡터 데이터베이스 관리 모듈

임베딩 벡터를 효율적으로 저장하고 검색하는 기능을 제공합니다.
ChromaDB가 설치되지 않은 경우 graceful하게 처리합니다.
"""

import os
import json
from typing import List, Dict, Any, Optional
from pathlib import Path

# ChromaDB 가용성 체크
CHROMADB_AVAILABLE = False
chromadb = None
Settings = None

try:
    import chromadb as _chromadb
    from chromadb.config import Settings as _Settings
    chromadb = _chromadb
    Settings = _Settings
    CHROMADB_AVAILABLE = True
    print("[ChromaDB] 모듈 로드 성공")
except ImportError:
    print("[ChromaDB] 모듈이 설치되지 않았습니다. Vector DB 기능이 비활성화됩니다.")
    print("[ChromaDB] 설치하려면: pip install chromadb (Visual C++ Build Tools 필요)")
    CHROMADB_AVAILABLE = False

# ============================================================================
# 설정
# ============================================================================

# ChromaDB 저장 경로
DATA_DIR = Path(__file__).parent.parent.parent / "frontend" / "data"
CHROMA_DIR = DATA_DIR / "chromadb"

# 컬렉션 이름
COLLECTION_NAME = "document_embeddings"

# ============================================================================
# ChromaDB 클라이언트 초기화
# ============================================================================

_client = None
_collection = None


def is_available() -> bool:
    """ChromaDB 사용 가능 여부"""
    return CHROMADB_AVAILABLE


def get_client():
    """ChromaDB 클라이언트 싱글톤"""
    global _client
    
    if not CHROMADB_AVAILABLE:
        return None
        
    if _client is None:
        # 디렉토리 생성
        CHROMA_DIR.mkdir(parents=True, exist_ok=True)
        
        _client = chromadb.PersistentClient(
            path=str(CHROMA_DIR),
            settings=Settings(
                anonymized_telemetry=False,
                allow_reset=True,
            )
        )
        print(f"[ChromaDB] 초기화 완료: {CHROMA_DIR}")
    return _client


def get_collection():
    """임베딩 컬렉션 싱글톤"""
    global _collection
    
    if not CHROMADB_AVAILABLE:
        return None
        
    if _collection is None:
        client = get_client()
        if client is None:
            return None
        _collection = client.get_or_create_collection(
            name=COLLECTION_NAME,
            metadata={"description": "Document chunk embeddings for RAG"}
        )
        print(f"[ChromaDB] 컬렉션 '{COLLECTION_NAME}' 준비 완료 (현재 {_collection.count()}개 벡터)")
    return _collection


# ============================================================================
# 임베딩 저장/조회/검색
# ============================================================================

def add_embeddings(
    ids: List[str],
    embeddings: List[List[float]],
    documents: List[str],
    metadatas: Optional[List[Dict[str, Any]]] = None
) -> Dict[str, Any]:
    """
    임베딩 벡터 추가
    
    Args:
        ids: 청크 ID 목록
        embeddings: 임베딩 벡터 목록
        documents: 원본 텍스트 목록
        metadatas: 메타데이터 목록 (선택)
    
    Returns:
        성공/실패 정보
    """
    if not CHROMADB_AVAILABLE:
        return {
            "success": False,
            "error": "ChromaDB가 설치되지 않았습니다."
        }
    
    collection = get_collection()
    if collection is None:
        return {
            "success": False,
            "error": "ChromaDB 컬렉션을 초기화할 수 없습니다."
        }
    
    try:
        # 메타데이터 기본값 설정
        if metadatas is None:
            metadatas = [{} for _ in ids]
        
        # 메타데이터 값 정제 (ChromaDB는 str, int, float, bool만 지원)
        cleaned_metadatas = []
        for meta in metadatas:
            cleaned = {}
            for k, v in meta.items():
                if v is None:
                    cleaned[k] = ""
                elif isinstance(v, (str, int, float, bool)):
                    cleaned[k] = v
                else:
                    cleaned[k] = str(v)
            cleaned_metadatas.append(cleaned)
        
        # 기존 ID가 있으면 업데이트, 없으면 추가
        existing_ids = set()
        try:
            result = collection.get(ids=ids)
            existing_ids = set(result["ids"])
        except Exception:
            pass
        
        new_ids = [i for i in ids if i not in existing_ids]
        update_ids = [i for i in ids if i in existing_ids]
        
        # 새 항목 추가
        if new_ids:
            new_indices = [ids.index(i) for i in new_ids]
            collection.add(
                ids=new_ids,
                embeddings=[embeddings[i] for i in new_indices],
                documents=[documents[i] for i in new_indices],
                metadatas=[cleaned_metadatas[i] for i in new_indices]
            )
        
        # 기존 항목 업데이트
        if update_ids:
            update_indices = [ids.index(i) for i in update_ids]
            collection.update(
                ids=update_ids,
                embeddings=[embeddings[i] for i in update_indices],
                documents=[documents[i] for i in update_indices],
                metadatas=[cleaned_metadatas[i] for i in update_indices]
            )
        
        return {
            "success": True,
            "added": len(new_ids),
            "updated": len(update_ids),
            "total": collection.count()
        }
        
    except Exception as e:
        print(f"[ChromaDB] 임베딩 추가 오류: {e}")
        return {
            "success": False,
            "error": str(e)
        }


def get_embeddings(ids: List[str]) -> Dict[str, Any]:
    """
    ID로 임베딩 조회
    
    Args:
        ids: 조회할 청크 ID 목록
    
    Returns:
        임베딩 정보
    """
    if not CHROMADB_AVAILABLE:
        return {"success": False, "error": "ChromaDB가 설치되지 않았습니다."}
    
    collection = get_collection()
    if collection is None:
        return {"success": False, "error": "ChromaDB 컬렉션 초기화 실패"}
    
    try:
        result = collection.get(
            ids=ids,
            include=["embeddings", "documents", "metadatas"]
        )
        
        return {
            "success": True,
            "ids": result["ids"],
            "embeddings": result["embeddings"],
            "documents": result["documents"],
            "metadatas": result["metadatas"]
        }
        
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }


def search_similar(
    query_embedding: List[float],
    n_results: int = 10,
    where: Optional[Dict[str, Any]] = None,
    where_document: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    유사도 검색
    
    Args:
        query_embedding: 쿼리 임베딩 벡터
        n_results: 반환할 결과 수
        where: 메타데이터 필터 (예: {"org_name": "산업통상자원부"})
        where_document: 문서 내용 필터
    
    Returns:
        유사한 청크 목록
    """
    if not CHROMADB_AVAILABLE:
        return {"success": False, "error": "ChromaDB가 설치되지 않았습니다.", "results": [], "count": 0}
    
    collection = get_collection()
    if collection is None:
        return {"success": False, "error": "ChromaDB 컬렉션 초기화 실패", "results": [], "count": 0}
    
    try:
        result = collection.query(
            query_embeddings=[query_embedding],
            n_results=n_results,
            where=where,
            where_document=where_document,
            include=["embeddings", "documents", "metadatas", "distances"]
        )
        
        # 결과 정리
        items = []
        if result["ids"] and result["ids"][0]:
            for i, chunk_id in enumerate(result["ids"][0]):
                items.append({
                    "chunk_id": chunk_id,
                    "document": result["documents"][0][i] if result["documents"] else None,
                    "metadata": result["metadatas"][0][i] if result["metadatas"] else None,
                    "distance": result["distances"][0][i] if result["distances"] else None,
                    "similarity": 1 - result["distances"][0][i] if result["distances"] else None
                })
        
        return {
            "success": True,
            "results": items,
            "count": len(items)
        }
        
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }


def delete_embeddings(ids: List[str]) -> Dict[str, Any]:
    """
    임베딩 삭제
    
    Args:
        ids: 삭제할 청크 ID 목록
    
    Returns:
        삭제 결과
    """
    if not CHROMADB_AVAILABLE:
        return {"success": False, "error": "ChromaDB가 설치되지 않았습니다."}
    
    collection = get_collection()
    if collection is None:
        return {"success": False, "error": "ChromaDB 컬렉션 초기화 실패"}
    
    try:
        collection.delete(ids=ids)
        return {
            "success": True,
            "deleted": len(ids),
            "total": collection.count()
        }
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }


def get_stats() -> Dict[str, Any]:
    """
    ChromaDB 통계 조회
    
    Returns:
        통계 정보
    """
    if not CHROMADB_AVAILABLE:
        return {
            "success": False,
            "error": "ChromaDB가 설치되지 않았습니다.",
            "total_embeddings": 0,
            "collection_name": COLLECTION_NAME,
            "storage_path": str(CHROMA_DIR),
            "chromadb_available": False
        }
    
    collection = get_collection()
    if collection is None:
        return {
            "success": False,
            "error": "ChromaDB 컬렉션 초기화 실패",
            "total_embeddings": 0,
            "chromadb_available": False
        }
    
    try:
        count = collection.count()
        
        # 샘플 메타데이터로 기관별 통계 추정
        sample = collection.peek(limit=min(count, 1000))
        
        org_counts = {}
        model_counts = {}
        
        if sample["metadatas"]:
            for meta in sample["metadatas"]:
                if meta:
                    org = meta.get("org_name", "unknown")
                    model = meta.get("model", "unknown")
                    org_counts[org] = org_counts.get(org, 0) + 1
                    model_counts[model] = model_counts.get(model, 0) + 1
        
        return {
            "success": True,
            "total_embeddings": count,
            "collection_name": COLLECTION_NAME,
            "storage_path": str(CHROMA_DIR),
            "org_distribution": org_counts,
            "model_distribution": model_counts,
            "chromadb_available": True
        }
        
    except Exception as e:
        return {
            "success": False,
            "error": str(e),
            "chromadb_available": True
        }


def check_exists(ids: List[str]) -> Dict[str, bool]:
    """
    ID 존재 여부 확인
    
    Args:
        ids: 확인할 ID 목록
    
    Returns:
        ID별 존재 여부
    """
    if not CHROMADB_AVAILABLE:
        return {id: False for id in ids}
    
    collection = get_collection()
    if collection is None:
        return {id: False for id in ids}
    
    try:
        result = collection.get(ids=ids)
        existing = set(result["ids"])
        return {id: id in existing for id in ids}
    except Exception:
        return {id: False for id in ids}


# ============================================================================
# 인덱스 관리 기능
# ============================================================================

def delete_by_filter(where: Dict[str, Any]) -> Dict[str, Any]:
    """
    메타데이터 조건으로 임베딩 삭제
    
    Args:
        where: 메타데이터 필터 (예: {"org_name": "산업통상자원부"})
    
    Returns:
        삭제 결과
    """
    if not CHROMADB_AVAILABLE:
        return {"success": False, "error": "ChromaDB가 설치되지 않았습니다."}
    
    collection = get_collection()
    if collection is None:
        return {"success": False, "error": "ChromaDB 컬렉션 초기화 실패"}
    
    try:
        # 삭제 전 개수 확인
        before_count = collection.count()
        
        # 조건에 맞는 항목 삭제
        collection.delete(where=where)
        
        # 삭제 후 개수 확인
        after_count = collection.count()
        deleted = before_count - after_count
        
        return {
            "success": True,
            "deleted": deleted,
            "remaining": after_count
        }
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }


def clear_collection() -> Dict[str, Any]:
    """
    컬렉션의 모든 데이터 삭제 (초기화)
    
    Returns:
        초기화 결과
    """
    if not CHROMADB_AVAILABLE:
        return {"success": False, "error": "ChromaDB가 설치되지 않았습니다."}
    
    global _collection
    client = get_client()
    if client is None:
        return {"success": False, "error": "ChromaDB 클라이언트 초기화 실패"}
    
    try:
        # 삭제 전 개수 확인
        collection = get_collection()
        before_count = collection.count() if collection else 0
        
        # 컬렉션 삭제 후 재생성
        client.delete_collection(name=COLLECTION_NAME)
        _collection = None
        
        # 새 컬렉션 생성
        new_collection = get_collection()
        
        return {
            "success": True,
            "deleted": before_count,
            "message": f"컬렉션 '{COLLECTION_NAME}'이 초기화되었습니다."
        }
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }


def get_collection_info() -> Dict[str, Any]:
    """
    컬렉션 상세 정보 조회
    
    Returns:
        컬렉션 정보 (이름, 벡터 수, 차원 등)
    """
    if not CHROMADB_AVAILABLE:
        return {
            "success": False,
            "error": "ChromaDB가 설치되지 않았습니다.",
            "collections": []
        }
    
    client = get_client()
    if client is None:
        return {"success": False, "error": "ChromaDB 클라이언트 초기화 실패", "collections": []}
    
    try:
        collections = []
        
        # 현재 컬렉션 정보
        collection = get_collection()
        if collection:
            count = collection.count()
            
            # 샘플 데이터로 차원 확인
            dimension = 0
            if count > 0:
                sample = collection.peek(limit=1)
                if sample["embeddings"] and len(sample["embeddings"]) > 0:
                    dimension = len(sample["embeddings"][0])
            
            collections.append({
                "name": COLLECTION_NAME,
                "count": count,
                "dimension": dimension,
                "storage_path": str(CHROMA_DIR)
            })
        
        return {
            "success": True,
            "collections": collections
        }
    except Exception as e:
        return {
            "success": False,
            "error": str(e),
            "collections": []
        }


# ============================================================================
# 표 재조합 기능
# ============================================================================

def get_table_chunks(table_id: str) -> Dict[str, Any]:
    """
    table_id로 관련 테이블 청크 모두 조회 (표 재조합용)
    
    Args:
        table_id: 테이블 ID
    
    Returns:
        테이블 청크 목록 (chunk_index 순서대로 정렬)
    """
    if not CHROMADB_AVAILABLE:
        return {"success": False, "error": "ChromaDB가 설치되지 않았습니다.", "chunks": []}
    
    collection = get_collection()
    if collection is None:
        return {"success": False, "error": "ChromaDB 컬렉션 초기화 실패", "chunks": []}
    
    try:
        # table_id로 검색
        result = collection.get(
            where={"table_id": table_id},
            include=["documents", "metadatas"]
        )
        
        if not result["ids"]:
            return {"success": True, "chunks": [], "count": 0}
        
        # 청크 정리 및 정렬
        chunks = []
        for i, chunk_id in enumerate(result["ids"]):
            chunks.append({
                "chunk_id": chunk_id,
                "document": result["documents"][i] if result["documents"] else "",
                "metadata": result["metadatas"][i] if result["metadatas"] else {},
                "chunk_index": result["metadatas"][i].get("chunk_index", 0) if result["metadatas"] else 0
            })
        
        # chunk_index로 정렬
        chunks.sort(key=lambda x: x["chunk_index"])
        
        return {
            "success": True,
            "chunks": chunks,
            "count": len(chunks),
            "table_id": table_id
        }
    except Exception as e:
        return {
            "success": False,
            "error": str(e),
            "chunks": []
        }


def reconstruct_table(table_id: str) -> Dict[str, Any]:
    """
    분할된 테이블 청크를 병합하여 전체 테이블 재조합
    
    Args:
        table_id: 테이블 ID
    
    Returns:
        재조합된 테이블 마크다운
    """
    result = get_table_chunks(table_id)
    
    if not result["success"]:
        return result
    
    chunks = result["chunks"]
    
    if not chunks:
        return {
            "success": True,
            "table_id": table_id,
            "content": "",
            "total_chunks": 0
        }
    
    # 마크다운 테이블 병합
    merged_content = []
    table_title = None
    headers = None
    
    for chunk in chunks:
        metadata = chunk.get("metadata", {})
        document = chunk.get("document", "")
        
        # 첫 번째 청크에서 제목과 헤더 정보 추출
        if chunk.get("chunk_index", 0) == 0 or metadata.get("is_first_chunk"):
            table_title = metadata.get("table_title", "")
            headers = metadata.get("headers", [])
        
        merged_content.append(document)
    
    return {
        "success": True,
        "table_id": table_id,
        "table_title": table_title,
        "headers": headers,
        "content": "\n".join(merged_content),
        "total_chunks": len(chunks)
    }


# ============================================================================
# 마이그레이션 유틸리티
# ============================================================================

def migrate_from_json(json_path: str) -> Dict[str, Any]:
    """
    기존 JSON 파일에서 ChromaDB로 마이그레이션
    
    Args:
        json_path: embedding-data.json 파일 경로
    
    Returns:
        마이그레이션 결과
    """
    if not CHROMADB_AVAILABLE:
        return {
            "success": False,
            "error": "ChromaDB가 설치되지 않았습니다. Visual C++ Build Tools를 설치한 후 'pip install chromadb'를 실행해주세요."
        }
    
    try:
        with open(json_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        
        embeddings_data = data.get("embeddings", {})
        
        if not embeddings_data:
            return {
                "success": True,
                "migrated": 0,
                "message": "마이그레이션할 데이터가 없습니다."
            }
        
        # 배치 단위로 처리
        batch_size = 100
        items = list(embeddings_data.items())
        total_migrated = 0
        
        for i in range(0, len(items), batch_size):
            batch = items[i:i + batch_size]
            
            ids = []
            embeddings = []
            documents = []
            metadatas = []
            
            for chunk_id, embed_data in batch:
                ids.append(chunk_id)
                embeddings.append(embed_data.get("embedding", []))
                documents.append("")  # 원본 텍스트는 청킹 데이터에서 가져와야 함
                metadatas.append({
                    "model": embed_data.get("model", ""),
                    "tokens_used": embed_data.get("tokens_used", 0),
                    "created_at": embed_data.get("created_at", "")
                })
            
            result = add_embeddings(ids, embeddings, documents, metadatas)
            if result["success"]:
                total_migrated += result.get("added", 0) + result.get("updated", 0)
            
            print(f"[마이그레이션] {min(i + batch_size, len(items))}/{len(items)} 처리 완료")
        
        return {
            "success": True,
            "migrated": total_migrated,
            "total_in_db": get_collection().count()
        }
        
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }
