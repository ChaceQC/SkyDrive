from fastapi import APIRouter

from app.api.api_v1.endpoints import login, users, files, shares

api_router = APIRouter()
api_router.include_router(login.router, prefix="/login", tags=["login"]) # Added prefix
api_router.include_router(users.router, prefix="/users", tags=["users"])
api_router.include_router(files.router, prefix="/files", tags=["files"])
api_router.include_router(shares.router, prefix="/shares", tags=["shares"])
