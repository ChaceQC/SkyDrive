import os
import socket
import sys

import uvicorn

# Add the parent directory to sys.path to allow imports from 'app'
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# --- 1. 环境初始化 (Fix Hostname Issue) ---
def fix_hostname_issue():
    os.environ['HOSTNAME'] = 'mailserver.local'
    socket.gethostname = lambda: 'mailserver.local'
    socket.getfqdn = lambda name='': 'mailserver.local'
    if os.name == 'nt':
        os.environ['COMPUTERNAME'] = 'MAILSERVER'

fix_hostname_issue()

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from app.api.api_v1.api import api_router
from app.core.config import settings
from app.db.base import Base
from app.db.session import engine
import traceback

# Create tables for development (in production use Alembic)
Base.metadata.create_all(bind=engine)

app = FastAPI(
    title=settings.PROJECT_NAME,
    openapi_url=f"{settings.API_V1_STR}/openapi.json"
)

# Set all CORS enabled origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # In production, replace with specific origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix=settings.API_V1_STR)

@app.get("/")
def read_root():
    return {"message": "Welcome to SkyDrive Enterprise API"}

# Global Exception Handler
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    print(f"Global Exception: {exc}")
    traceback.print_exc() # Print full traceback to console
    return JSONResponse(
        status_code=500,
        content={"message": "Internal Server Error", "detail": str(exc)},
    )

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    print(f"Validation Error: {exc}")
    return JSONResponse(
        status_code=422,
        content={"message": "Validation Error", "detail": exc.errors()},
    )

# Debug: Print all routes
@app.on_event("startup")
async def startup_event():
    print("Registered Routes:")
    for route in app.routes:
        if hasattr(route, "path"):
            print(f"  {route.path}")

if __name__ == "__main__":
    # 在这里指定监听的 IP 和 端口
    # 0.0.0.0 表示监听所有网卡，这样局域网内的 192.168.101.13 才能访问
    uvicorn.run(app, host="127.0.0.1", port=8899)
