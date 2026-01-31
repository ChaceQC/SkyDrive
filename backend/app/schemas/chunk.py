from typing import List, Optional
from pydantic import BaseModel

class ChunkInit(BaseModel):
    file_hash: str
    file_size: int
    file_name: str
    parent_id: int = 0
    total_chunks: int
    relative_path: Optional[str] = None # Added relative_path

class ChunkInitResponse(BaseModel):
    upload_id: str
    uploaded_chunks: List[int] # 已上传的分片索引列表，用于断点续传

class ChunkUpload(BaseModel):
    upload_id: str
    chunk_index: int
