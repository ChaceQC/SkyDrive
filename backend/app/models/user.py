from sqlalchemy import Column, Integer, String, BigInteger, Boolean
from app.db.base_class import Base

class User(Base):
    __tablename__ = "sys_user"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(255), unique=True, index=True, nullable=False)
    email = Column(String(255), unique=True, index=True, nullable=False) # Added email
    password_hash = Column(String(255), nullable=False)
    quota_total = Column(BigInteger, default=1073741824)
    quota_used = Column(BigInteger, default=0)
    is_admin = Column(Boolean, default=False)
