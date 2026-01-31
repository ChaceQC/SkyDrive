import os
from typing import List
from pydantic_settings import BaseSettings
from dotenv import load_dotenv

# Explicitly load .env file before defining Settings
env_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env")
load_dotenv(env_path)

class Settings(BaseSettings):
    PROJECT_NAME: str = "SkyDrive Enterprise"
    API_V1_STR: str = "/api/v1"
    
    # Database
    SQLALCHEMY_DATABASE_URI: str

    # Security
    SECRET_KEY: str = "YOUR_SECRET_KEY_HERE"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 10080
    SALT: str = "YOUR_SALT_HERE"
    PASSWORD_SALT: str = "PASSWORD_SALT"

    # Storage
    UPLOAD_DIR: str = os.path.join(os.getcwd(), "upload_storage")
    # List of paths for virtual disk storage. Comma separated string in env, parsed to list.
    STORAGE_PATHS_STR: str = "" 

    @property
    def STORAGE_PATHS(self) -> List[str]:
        paths = [self.UPLOAD_DIR]
        if self.STORAGE_PATHS_STR:
            # Handle potential quote wrapping from env file parsing
            raw_str = self.STORAGE_PATHS_STR.strip('"\'')
            extra_paths = [p.strip() for p in raw_str.split(",") if p.strip()]
            paths.extend(extra_paths)
        return paths

    # Email
    MAIL_USERNAME: str
    MAIL_PASSWORD: str
    MAIL_FROM: str
    MAIL_PORT: int
    MAIL_SERVER: str
    MAIL_FROM_NAME: str
    MAIL_STARTTLS: bool
    MAIL_SSL_TLS: bool
    USE_CREDENTIALS: bool
    VALIDATE_CERTS: bool

    class Config:
        case_sensitive = True

settings = Settings()

# Ensure all storage paths exist
for path in settings.STORAGE_PATHS:
    if not os.path.exists(path):
        try:
            os.makedirs(path)
        except OSError as e:
            print(f"Warning: Could not create storage path {path}: {e}")
