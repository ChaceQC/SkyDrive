import os
from typing import List, Optional
from sqlalchemy.orm import Session
from app.models.file import FileChunk

class CRUDChunk:
    def create_init_chunks(
        self, db: Session, *, upload_id: str, user_id: int, file_hash: str, total_chunks: int
    ) -> List[FileChunk]:
        # 检查是否已存在该upload_id的记录（断点续传）
        existing = db.query(FileChunk).filter(FileChunk.upload_id == upload_id).all()
        if existing:
            if len(existing) == total_chunks:
                return existing
            # If chunk count mismatches (e.g. changed chunk size), clear old chunks
            self.delete_chunks(db, upload_id=upload_id)

        chunks = []
        for i in range(total_chunks):
            chunk = FileChunk(
                upload_id=upload_id,
                user_id=user_id,
                file_hash=file_hash,
                chunk_index=i,
                chunk_size=0, # 初始未知，上传时更新
                is_uploaded=False
            )
            db.add(chunk)
            chunks.append(chunk)
        db.commit()
        return chunks

    def get_uploaded_chunks(self, db: Session, *, upload_id: str) -> List[int]:
        chunks = db.query(FileChunk).filter(
            FileChunk.upload_id == upload_id, 
            FileChunk.is_uploaded == True
        ).all()
        
        valid_chunks = []
        for c in chunks:
            # Check if physical file exists
            if c.temp_path and os.path.exists(c.temp_path):
                valid_chunks.append(c.chunk_index)
            else:
                # If file missing, mark as not uploaded
                c.is_uploaded = False
                db.add(c)
        
        if len(valid_chunks) != len(chunks):
            db.commit()
            
        return valid_chunks

    def mark_chunk_uploaded(
        self, db: Session, *, upload_id: str, chunk_index: int, chunk_size: int, temp_path: str
    ) -> Optional[FileChunk]:
        chunk = db.query(FileChunk).filter(
            FileChunk.upload_id == upload_id,
            FileChunk.chunk_index == chunk_index
        ).first()
        
        if chunk:
            chunk.is_uploaded = True
            chunk.chunk_size = chunk_size
            chunk.temp_path = temp_path
            db.add(chunk)
            db.commit()
            db.refresh(chunk)
        return chunk

    def get_all_chunks(self, db: Session, *, upload_id: str) -> List[FileChunk]:
        return db.query(FileChunk).filter(
            FileChunk.upload_id == upload_id
        ).order_by(FileChunk.chunk_index).all()

    def delete_chunks(self, db: Session, *, upload_id: str):
        db.query(FileChunk).filter(FileChunk.upload_id == upload_id).delete()
        db.commit()

chunk = CRUDChunk()
