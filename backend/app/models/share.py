from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from app.db.base_class import Base
from datetime import datetime

class Share(Base):
    __tablename__ = "share"

    id = Column(Integer, primary_key=True, index=True)
    share_key = Column(String(64), unique=True, index=True, nullable=False) # UUID or Random String
    file_id = Column(Integer, ForeignKey("file_meta.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("sys_user.id"), nullable=False) # Creator
    
    is_private = Column(Boolean, default=False)
    access_code = Column(String(10), nullable=True) # 提取码
    
    expire_at = Column(DateTime, nullable=True)
    max_downloads = Column(Integer, nullable=True) # -1 or None for unlimited
    download_count = Column(Integer, default=0)
    
    created_at = Column(DateTime, default=datetime.utcnow)

    file = relationship("FileMeta")
    user = relationship("User")
