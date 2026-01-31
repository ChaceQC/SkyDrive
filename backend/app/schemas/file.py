from typing import Optional, List, Any
from pydantic import BaseModel
from datetime import datetime

# Shared properties
class FileMetaBase(BaseModel):
    file_name: str
    is_folder: bool = False
    parent_id: int = 0

# Properties to receive on item creation
class FileMetaCreate(FileMetaBase):
    file_hash: Optional[str] = None
    file_size: Optional[int] = 0

# Properties to receive on item update
class FileMetaUpdate(FileMetaBase):
    pass

# Properties shared by models stored in DB
class FileMetaInDBBase(FileMetaBase):
    id: int
    user_id: int
    file_hash: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    deleted_at: Optional[datetime] = None
    
    class Config:
        orm_mode = True

# Properties to return to client
class FileMeta(FileMetaInDBBase):
    file_size: int = 0 # This will pick up the @property from the ORM model

# Response for file list
class FileList(BaseModel):
    items: List[FileMeta]
    total: int

# Check fast upload response
class CheckFastUpload(BaseModel):
    can_fast_upload: bool
    file_meta: Optional[FileMeta] = None
