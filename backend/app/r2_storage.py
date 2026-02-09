"""
Cloudflare R2 스토리지 클라이언트 (S3 호환 API)

Railway 배포 환경에서 대용량 파일(첨부파일, 추출 텍스트)을
Cloudflare R2에 저장/조회하기 위한 유틸리티 모듈.
"""
import os
from typing import Optional

import boto3
from botocore.exceptions import ClientError

# ── 환경 변수 ──────────────────────────────────────────────
R2_ENDPOINT = os.environ.get("R2_ENDPOINT")
R2_ACCESS_KEY_ID = os.environ.get("R2_ACCESS_KEY_ID")
R2_SECRET_ACCESS_KEY = os.environ.get("R2_SECRET_ACCESS_KEY")
R2_BUCKET_NAME = os.environ.get("R2_BUCKET_NAME", "webscraper-data")

# R2 사용 여부 판단
USE_R2 = bool(R2_ENDPOINT and R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY)

# ── 클라이언트 싱글턴 ──────────────────────────────────────
_client = None


def get_r2_client():
    """R2 S3 호환 클라이언트 (싱글턴)"""
    global _client
    if _client is None:
        if not USE_R2:
            raise RuntimeError(
                "[R2] R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY "
                "환경 변수가 모두 설정되어야 합니다."
            )
        _client = boto3.client(
            "s3",
            endpoint_url=R2_ENDPOINT,
            aws_access_key_id=R2_ACCESS_KEY_ID,
            aws_secret_access_key=R2_SECRET_ACCESS_KEY,
            region_name="auto",
        )
    return _client


# ── Public API ──────────────────────────────────────────────

def upload_to_r2(
    key: str,
    body: bytes,
    content_type: str = "application/octet-stream",
) -> None:
    """R2에 파일 업로드"""
    client = get_r2_client()
    client.put_object(
        Bucket=R2_BUCKET_NAME,
        Key=key,
        Body=body,
        ContentType=content_type,
    )


def download_from_r2(key: str) -> bytes:
    """R2에서 파일 다운로드"""
    client = get_r2_client()
    response = client.get_object(Bucket=R2_BUCKET_NAME, Key=key)
    return response["Body"].read()


def download_text_from_r2(key: str, encoding: str = "utf-8") -> str:
    """R2에서 텍스트 파일 다운로드"""
    return download_from_r2(key).decode(encoding)


def list_r2_objects(prefix: str) -> list[dict]:
    """
    R2 파일 목록 조회 (페이지네이션 자동 처리)

    Returns:
        [{"Key": "...", "Size": ..., "LastModified": ...}, ...]
    """
    client = get_r2_client()
    all_contents: list[dict] = []
    continuation_token = None

    while True:
        kwargs = {"Bucket": R2_BUCKET_NAME, "Prefix": prefix}
        if continuation_token:
            kwargs["ContinuationToken"] = continuation_token

        response = client.list_objects_v2(**kwargs)
        contents = response.get("Contents", [])
        all_contents.extend(contents)

        if response.get("IsTruncated"):
            continuation_token = response.get("NextContinuationToken")
        else:
            break

    return all_contents


def delete_from_r2(key: str) -> None:
    """R2 파일 삭제"""
    client = get_r2_client()
    client.delete_object(Bucket=R2_BUCKET_NAME, Key=key)


def exists_in_r2(key: str) -> bool:
    """R2 파일 존재 여부 확인"""
    try:
        client = get_r2_client()
        client.head_object(Bucket=R2_BUCKET_NAME, Key=key)
        return True
    except ClientError:
        return False


def upload_json_to_r2(key: str, data: dict) -> None:
    """JSON 데이터를 R2에 업로드"""
    import json
    body = json.dumps(data, ensure_ascii=False, indent=2).encode("utf-8")
    upload_to_r2(key, body, content_type="application/json")


def download_json_from_r2(key: str) -> dict:
    """R2에서 JSON 파일 다운로드 & 파싱"""
    import json
    text = download_text_from_r2(key)
    return json.loads(text)
