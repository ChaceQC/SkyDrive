from datetime import timedelta, datetime
from typing import Any
import time
import uuid
import hashlib
import re
import random

from fastapi import APIRouter, Body, Depends, HTTPException, BackgroundTasks
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from fastapi_mail import FastMail, MessageSchema, ConnectionConfig, MessageType

from app import crud, models, schemas
from app.api import deps
from app.core import security
from app.core.config import settings
from app.utils.auth_utils import VerificationStore, generate_captcha_image, generate_server_sign, build_verify_string, get_salt, get_password_salt
from app.schemas.auth import LoginRequest, RegisterRequest, ResetPasswordRequest, EmailCodeRequest

router = APIRouter()

# Email Config
conf = ConnectionConfig(
    MAIL_USERNAME=settings.MAIL_USERNAME,
    MAIL_PASSWORD=settings.MAIL_PASSWORD,
    MAIL_FROM=settings.MAIL_FROM,
    MAIL_PORT=settings.MAIL_PORT,
    MAIL_SERVER=settings.MAIL_SERVER,
    MAIL_FROM_NAME=settings.MAIL_FROM_NAME,
    MAIL_STARTTLS=settings.MAIL_STARTTLS,
    MAIL_SSL_TLS=settings.MAIL_SSL_TLS, # Changed to MAIL_TLS
    USE_CREDENTIALS=settings.USE_CREDENTIALS,
    VALIDATE_CERTS=settings.VALIDATE_CERTS
)

@router.get("/captcha")
def get_captcha():
    code, img_base64 = generate_captcha_image()
    v_id = str(uuid.uuid4())
    VerificationStore.add(v_id, code, 0)
    
    timestamp = int(time.time())
    nonce = uuid.uuid4().hex[:8]
    server_sign = generate_server_sign(v_id, timestamp, nonce)
    
    return {
        "code": 200,
        "data": {
            "id": v_id,
            "captcha": "data:image/png;base64," + img_base64,
            "metadata": {
                "t": timestamp,
                "n": nonce,
                "s": server_sign
            }
        }
    }

@router.post("/send-email-code")
async def send_email_code(
    req: EmailCodeRequest,
    background_tasks: BackgroundTasks
):
    email = req.email
    if not re.match(r"^[a-zA-Z0-9_\u4e00-\u9fa5-.]+@[a-zA-Z0-9_-]+(\.[a-zA-Z0-9_-]+)+$", email):
        return {"code": 40004, "message": "邮箱格式错误！"}

    code = "".join([random.choice("0123456789") for _ in range(6)])
    v_id = str(uuid.uuid4())
    VerificationStore.add(v_id, code, 1) # Type 1 for registration
    
    message = MessageSchema(
        subject="注册验证码",
        recipients=[email],
        body=f"您的验证码为：{code}，有效期5分钟。",
        subtype=MessageType.plain
    )
    
    fm = FastMail(conf)
    background_tasks.add_task(fm.send_message, message)
    
    return {"code": 200, "data": {"id": v_id}}

@router.post("/send-reset-code")
async def send_reset_code(
    req: EmailCodeRequest,
    db: Session = Depends(deps.get_db),
    background_tasks: BackgroundTasks = None 
):
    if background_tasks is None:
        background_tasks = BackgroundTasks()

    email = req.email
    if not re.match(r"^[a-zA-Z0-9_\u4e00-\u9fa5-.]+@[a-zA-Z0-9_-]+(\.[a-zA-Z0-9_-]+)+$", email):
        return {"code": 40004, "message": "邮箱格式错误！"}

    user = crud.user.get_by_email(db, email=email) # Use get_by_email
    if not user:
         return {"code": 40000, "message": "该邮箱尚未注册！"}

    code = "".join([random.choice("0123456789") for _ in range(6)])
    v_id = str(uuid.uuid4())
    VerificationStore.add(v_id, code, 2) # Type 2 for password reset
    
    message = MessageSchema(
        subject="重置密码验证码",
        recipients=[email],
        body=f"您的重置密码验证码为：{code}，有效期5分钟。",
        subtype=MessageType.plain
    )
    
    fm = FastMail(conf)
    background_tasks.add_task(fm.send_message, message)
    
    return {"code": 200, "data": {"id": v_id}}

@router.post("/send-update-email-code")
async def send_update_email_code(
    req: EmailCodeRequest,
    db: Session = Depends(deps.get_db),
    current_user: models.User = Depends(deps.get_current_user),
    background_tasks: BackgroundTasks = None 
):
    if background_tasks is None:
        background_tasks = BackgroundTasks()

    email = req.email
    if not re.match(r"^[a-zA-Z0-9_\u4e00-\u9fa5-.]+@[a-zA-Z0-9_-]+(\.[a-zA-Z0-9_-]+)+$", email):
        return {"code": 40004, "message": "邮箱格式错误！"}

    if crud.user.get_by_email(db, email=email):
        return {"code": 40008, "message": "该邮箱已被其他用户绑定！"}

    code = "".join([random.choice("0123456789") for _ in range(6)])
    v_id = str(uuid.uuid4())
    VerificationStore.add(v_id, code, 3) # Type 3 for update email
    
    message = MessageSchema(
        subject="修改邮箱验证码",
        recipients=[email],
        body=f"您的修改邮箱验证码为：{code}，有效期5分钟。",
        subtype=MessageType.plain
    )
    
    fm = FastMail(conf)
    background_tasks.add_task(fm.send_message, message)
    
    return {"code": 200, "data": {"id": v_id}}

@router.post("/register")
def register(
    req: RegisterRequest,
    db: Session = Depends(deps.get_db)
):
    # 1. Verify Server Sign
    current_time = int(time.time())
    if current_time - req.metadata.t > 300:
        return {"code": 40002, "message": "验证凭证已过期"}
        
    expected_sign = generate_server_sign(req.v_id, req.metadata.t, req.metadata.n)
    if expected_sign != req.metadata.s:
        return {"code": 40006, "message": "非法凭证"}

    # 2. Verify Hash Code
    raw_parts = [
        str(req.v_id),
        str(req.email_id),
        str(req.email),
        str(req.username),
        str(req.password),
        str(req.metadata.s),
        str(req.metadata.cn)
    ]
    raw = build_verify_string(raw_parts, get_salt(), req.metadata.n)
    if hashlib.sha256(raw.encode()).hexdigest() != req.hash_code:
        return {"code": 40006, "message": "非法请求！"}

    # 3. Verify Passwords
    if req.password != req.confirm_password:
        return {"code": 40001, "message": "密码不一致！"}

    # 4. Verify Captcha
    v_data = VerificationStore.get(req.v_id)
    if not v_data or v_data['code'].upper() != req.v_code.upper():
        return {"code": 40002, "message": "图形验证码错误！"}
    VerificationStore.delete(req.v_id)

    # 5. Verify Email Code
    email_data = VerificationStore.get(req.email_id)
    if not email_data or email_data['code'] != req.email_code:
        return {"code": 40003, "message": "邮箱验证码错误！"}
    VerificationStore.delete(req.email_id)

    # 6. Check User Existence
    if crud.user.get_by_username(db, username=req.username):
        return {"code": 40008, "message": "用户名已被注册！"}
    if crud.user.get_by_email(db, email=req.email):
        return {"code": 40008, "message": "邮箱已被注册！"}

    # 7. Create User
    user_in = schemas.UserCreate(username=req.username, email=req.email, password=req.password)
    crud.user.create(db, obj_in=user_in)
    
    return {"code": 200, "message": "注册成功！"}

@router.post("/login")
def login(
    req: LoginRequest,
    db: Session = Depends(deps.get_db)
):
    # 1. Verify Server Sign
    current_time = int(time.time())
    if current_time - req.metadata.t > 300:
        return {"code": 40002, "message": "凭证已过期"}

    expected_sign = generate_server_sign(req.v_id, req.metadata.t, req.metadata.n)
    if expected_sign != req.metadata.s:
        return {"code": 40006, "message": "非法凭证"}

    # 2. Verify Hash Code
    raw_parts = [
        str(req.v_id),
        str(req.email),
        str(req.password),
        str(req.metadata.s),
        str(req.metadata.cn)
    ]
    raw = build_verify_string(raw_parts, get_salt(), req.metadata.n)
    if hashlib.sha256(raw.encode()).hexdigest() != req.hash_code:
        return {"code": 40006, "message": "请求签名错误"}

    # 3. Verify Captcha
    v_data = VerificationStore.get(req.v_id)
    if not v_data or v_data['code'].upper() != req.v_code.upper():
        return {"code": 40002, "message": "图形验证码错误！"}
    VerificationStore.delete(req.v_id)

    # 4. Authenticate
    user = crud.user.authenticate(db, email=req.email, password=req.password) # Use email
    if not user:
        return {"code": 40000, "message": "邮箱或密码错误！"}
        
    access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    token = security.create_access_token(
        user.id, expires_delta=access_token_expires
    )
    
    return {
        "code": 200, 
        "data": {
            "access_token": token, 
            "token_type": "bearer"
        }
    }

@router.post("/reset-password")
def reset_password(
    req: ResetPasswordRequest,
    db: Session = Depends(deps.get_db)
):
    # 1. Verify Server Sign
    current_time = int(time.time())
    if current_time - req.metadata.t > 300:
        return {"code": 40002, "message": "验证凭证已过期"}
        
    expected_sign = generate_server_sign(req.v_id, req.metadata.t, req.metadata.n)
    if expected_sign != req.metadata.s:
        return {"code": 40006, "message": "非法凭证"}

    # 2. Verify Hash Code
    raw_parts = [
        str(req.v_id),
        str(req.email_id),
        str(req.email),
        str(req.new_password),
        str(req.metadata.s),
        str(req.metadata.cn)
    ]
    raw = build_verify_string(raw_parts, get_salt(), req.metadata.n)
    if hashlib.sha256(raw.encode()).hexdigest() != req.hash_code:
        return {"code": 40006, "message": "非法请求！"}

    # 3. Verify Passwords
    if req.new_password != req.confirm_password:
        return {"code": 40001, "message": "密码不一致！"}

    # 4. Verify Captcha
    v_data = VerificationStore.get(req.v_id)
    if not v_data or v_data['code'].upper() != req.v_code.upper():
        return {"code": 40002, "message": "图形验证码错误！"}
    VerificationStore.delete(req.v_id)

    # 5. Verify Email Code
    email_data = VerificationStore.get(req.email_id)
    if not email_data or email_data['code'] != req.email_code:
        return {"code": 40003, "message": "邮箱验证码错误！"}
    VerificationStore.delete(req.email_id)

    # 6. Check User Existence
    user = crud.user.get_by_email(db, email=req.email)
    if not user:
        return {"code": 40000, "message": "该邮箱尚未注册！"}

    # 7. Update Password
    crud.user.update(db, db_obj=user, obj_in={"password": req.new_password})
    
    return {"code": 200, "message": "密码重置成功！"}

# Keep the original OAuth2 endpoint for Swagger UI compatibility if needed
@router.post("/access-token", response_model=schemas.Token)
def login_access_token(
    db: Session = Depends(deps.get_db), form_data: OAuth2PasswordRequestForm = Depends()
) -> Any:
    # This endpoint is for Swagger UI, which sends username.
    # We can try to authenticate by username OR email here.
    user = crud.user.authenticate(db, email=form_data.username, password=form_data.password)
    if not user:
        # Try username fallback for old users? No, we enforce email.
        raise HTTPException(status_code=400, detail="Incorrect email or password")

    access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    return {
        "access_token": security.create_access_token(
            user.id, expires_delta=access_token_expires
        ),
        "token_type": "bearer",
    }
