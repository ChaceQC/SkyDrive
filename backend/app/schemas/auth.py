from typing import Optional, Dict
from pydantic import BaseModel

class AuthMetadata(BaseModel):
    t: int
    n: str
    s: str
    cn: str

class LoginRequest(BaseModel):
    email: str
    password: str
    v_id: str
    v_code: str
    hash_code: str
    metadata: AuthMetadata

class RegisterRequest(BaseModel):
    email: str
    username: str
    password: str
    confirm_password: str
    v_id: str
    v_code: str
    email_id: str
    email_code: str
    hash_code: str
    metadata: AuthMetadata

class ResetPasswordRequest(BaseModel):
    email: str
    password: str
    confirm_password: str
    v_id: str
    v_code: str
    email_id: str
    email_code: str
    hash_code: str
    metadata: AuthMetadata

class EmailCodeRequest(BaseModel):
    email: str
