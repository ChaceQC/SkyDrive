from sqlalchemy import Column, Integer, String, Boolean, BigInteger, ForeignKey, DateTime, UniqueConstraint
from sqlalchemy.orm import relationship
from app.db.base_class import Base
from datetime import datetime

class FileMeta(Base):
    __tablename__ = "file_meta"

    id = Column(BigInteger, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("sys_user.id"), nullable=False)
    parent_id = Column(BigInteger, default=0, index=True)
    file_name = Column(String(255), nullable=False)
    is_folder = Column(Boolean, default=False)
    file_hash = Column(String(64), ForeignKey("file_store.file_hash"), nullable=True)

    # Recycle Bin fields
    is_deleted = Column(Boolean, default=False, index=True)
    deleted_at = Column(DateTime, nullable=True)
    
    # Time fields
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("User")
    file_store = relationship("FileStore")

    __table_args__ = (
    )

    @property
    def file_size(self):
        if self.is_folder:
            return 0
        if self.file_store:
            return self.file_store.file_size
        return 0

class FileStore(Base):
    __tablename__ = "file_store"

    file_hash = Column(String(64), primary_key=True, index=True)
    real_path = Column(String(512), nullable=False)
    file_size = Column(BigInteger, nullable=False)
    ref_count = Column(Integer, default=1)

class FileChunk(Base):
    __tablename__ = "file_chunk"

    upload_id = Column(String(64), primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("sys_user.id"), nullable=False)
    file_hash = Column(String(64), index=True)
    chunk_index = Column(Integer, primary_key=True)
    chunk_size = Column(Integer, nullable=False)
    is_uploaded = Column(Boolean, default=False)
    temp_path = Column(String(512), nullable=True)
