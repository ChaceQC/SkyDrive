from typing import Optional
from pydantic import BaseModel
from datetime import datetime
from .file import FileMeta

class ShareBase(BaseModel):
    file_id: int
    is_private: bool = False
    access_code: Optional[str] = None
    expire_at: Optional[datetime] = None
    max_downloads: Optional[int] = None

class ShareCreate(ShareBase):
    pass

class ShareInDBBase(ShareBase):
    id: int
    share_key: str
    user_id: int
    download_count: int
    created_at: datetime

    class Config:
        orm_mode = True

class Share(ShareInDBBase):
    pass

# Public info for share page (hide sensitive info)
class ShareInfo(BaseModel):
    share_key: str
    is_private: bool
    file_name: str
    file_size: int
    is_folder: bool
    expire_at: Optional[datetime] = None
    max_downloads: Optional[int] = None
    download_count: Optional[int] = None
    file_id: int # Include file_id for frontend to fetch contents

class ShareAccess(BaseModel):
    access_code: Optional[str] = None
