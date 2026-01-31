import logging

from app.db.session import SessionLocal
from app import crud, schemas

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def init() -> None:
    db = SessionLocal()
    
    # Check if admin exists
    user = crud.user.get_by_username(db, username="admin")
    if not user:
        user_in = schemas.UserCreate(
            username="admin",
            password="adminpassword", # Change this in production!
        )
        user = crud.user.create(db, obj_in=user_in)
        # Manually set is_admin
        user.is_admin = True
        db.add(user)
        db.commit()
        logger.info("Admin user created")
    else:
        logger.info("Admin user already exists")

if __name__ == "__main__":
    logger.info("Creating initial data")
    init()
    logger.info("Initial data created")
