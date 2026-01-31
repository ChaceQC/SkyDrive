from typing import Any, List

from fastapi import APIRouter, Body, Depends, HTTPException
from fastapi.encoders import jsonable_encoder
from sqlalchemy.orm import Session

from app import crud, models, schemas
from app.api import deps
from app.core.security import verify_password
from app.utils.auth_utils import VerificationStore # Import VerificationStore
from app.schemas.user import UserUpdateUsername, UserUpdateEmail, UserUpdatePassword # Explicitly import schemas

router = APIRouter()

@router.post("/", response_model=schemas.User)
def create_user(
    *,
    db: Session = Depends(deps.get_db),
    user_in: schemas.UserCreate,
) -> Any:
    """
    Create new user.
    """
    user = crud.user.get_by_username(db, username=user_in.username)
    if user:
        raise HTTPException(
            status_code=400,
            detail="The user with this username already exists in the system.",
        )
    
    # Check if this is the first user
    is_first_user = db.query(models.User).count() == 0
    
    user = crud.user.create(db, obj_in=user_in)
    
    if is_first_user:
        user.is_admin = True
        db.add(user)
        db.commit()
        db.refresh(user)

    return user

@router.get("/me", response_model=schemas.User)
def read_user_me(
    current_user: models.User = Depends(deps.get_current_user),
) -> Any:
    """
    Get current user.
    """
    return current_user

@router.put("/me/username", response_model=schemas.User)
def update_user_me_username(
    *,
    db: Session = Depends(deps.get_db),
    user_in: UserUpdateUsername, # Use explicitly imported schema
    current_user: models.User = Depends(deps.get_current_user),
) -> Any:
    """
    Update current user's username.
    """
    if user_in.username == current_user.username:
        raise HTTPException(status_code=400, detail="新用户名不能与当前用户名相同")

    if crud.user.get_by_username(db, username=user_in.username):
        raise HTTPException(status_code=400, detail="用户名已被其他用户使用")
    
    current_user.username = user_in.username
    db.add(current_user)
    db.commit()
    db.refresh(current_user)
    return current_user

@router.put("/me/email", response_model=schemas.User)
def update_user_me_email(
    *,
    db: Session = Depends(deps.get_db),
    user_in: UserUpdateEmail, # Use explicitly imported schema
    current_user: models.User = Depends(deps.get_current_user),
) -> Any:
    """
    Update current user's email.
    """
    if user_in.email == current_user.email:
        raise HTTPException(status_code=400, detail="新邮箱不能与当前邮箱相同")

    # 1. Verify Email Code
    email_data = VerificationStore.get(user_in.email_id)
    if not email_data or email_data['code'] != user_in.email_code: # Type 3 for update email
        raise HTTPException(status_code=400, detail="邮箱验证码错误或已过期")
    VerificationStore.delete(user_in.email_id)

    # 2. Check if new email is already registered
    if crud.user.get_by_email(db, email=user_in.email):
        raise HTTPException(status_code=400, detail="该邮箱已被其他用户绑定")
    
    current_user.email = user_in.email
    db.add(current_user)
    db.commit()
    db.refresh(current_user)
    return current_user

@router.put("/me/password", response_model=schemas.User)
def update_user_me_password(
    *,
    db: Session = Depends(deps.get_db),
    password_in: UserUpdatePassword, # Use explicitly imported schema
    current_user: models.User = Depends(deps.get_current_user),
) -> Any:
    """
    Update current user's password.
    """
    if not verify_password(password_in.current_password, current_user.password_hash):
        raise HTTPException(status_code=400, detail="当前密码不正确")
    
    crud.user.update_password(db, user=current_user, new_password=password_in.new_password)
    return current_user

@router.get("/", response_model=List[schemas.User])
def read_users(
    db: Session = Depends(deps.get_db),
    skip: int = 0,
    limit: int = 100,
    current_user: models.User = Depends(deps.get_current_user),
) -> Any:
    """
    Retrieve users. (Admin only)
    """
    if not crud.user.is_admin(current_user):
        raise HTTPException(status_code=403, detail="Not enough permissions")
    users = crud.user.get_multi(db, skip=skip, limit=limit)
    return users

@router.put("/{user_id}", response_model=schemas.User)
def update_user(
    *,
    db: Session = Depends(deps.get_db),
    user_id: int,
    user_in: schemas.UserUpdate,
    current_user: models.User = Depends(deps.get_current_user),
) -> Any:
    """
    Update a user. (Admin only)
    """
    if not crud.user.is_admin(current_user):
        raise HTTPException(status_code=403, detail="Not enough permissions")
    
    user = crud.user.get(db, id=user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
        
    user = crud.user.update(db, db_obj=user, obj_in=user_in)
    return user
