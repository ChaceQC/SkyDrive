from typing import Optional
from pydantic import BaseModel, EmailStr

class UserBase(BaseModel):
    username: str
    email: EmailStr # Added email

class UserCreate(UserBase):
    password: str

class UserUpdate(BaseModel):
    # Admin update schema
    password: Optional[str] = None
    quota_total: Optional[int] = None
    is_admin: Optional[bool] = None

class UserUpdateUsername(BaseModel):
    username: str

class UserUpdateEmail(BaseModel):
    email: EmailStr
    email_code: str
    email_id: str

class UserUpdatePassword(BaseModel):
    current_password: str
    new_password: str

class UserInDBBase(UserBase):
    id: int
    quota_total: int
    quota_used: int
    is_admin: bool

    class Config:
        orm_mode = True

class User(UserInDBBase):
    pass

class UserInDB(UserInDBBase):
    password_hash: str
