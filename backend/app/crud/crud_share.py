from typing import Optional
from sqlalchemy.orm import Session
from app.crud.base import CRUDBase
from app.models.share import Share
from app.schemas.share import ShareCreate, ShareBase
import uuid
import random
import string

class CRUDShare(CRUDBase[Share, ShareCreate, ShareBase]):
    def create_with_user(
        self, db: Session, *, obj_in: ShareCreate, user_id: int
    ) -> Share:
        # Check if share exists for this file and user
        existing_share = db.query(Share).filter(Share.file_id == obj_in.file_id, Share.user_id == user_id).first()
        if existing_share:
            db.delete(existing_share)
            db.commit()

        share_key = uuid.uuid4().hex[:16] # Generate unique key
        
        # If private but no code provided, generate one
        access_code = obj_in.access_code
        if obj_in.is_private and not access_code:
            access_code = ''.join(random.choices(string.ascii_lowercase + string.digits, k=4))

        db_obj = Share(
            share_key=share_key,
            file_id=obj_in.file_id,
            user_id=user_id,
            is_private=obj_in.is_private,
            access_code=access_code,
            expire_at=obj_in.expire_at,
            max_downloads=obj_in.max_downloads
        )
        db.add(db_obj)
        db.commit()
        db.refresh(db_obj)
        return db_obj

    def get_by_key(self, db: Session, *, share_key: str) -> Optional[Share]:
        return db.query(Share).filter(Share.share_key == share_key).first()

    def increment_download(self, db: Session, *, share: Share):
        share.download_count += 1
        db.add(share)
        db.commit()
        db.refresh(share)

share = CRUDShare(Share)
