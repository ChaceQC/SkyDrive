import os
import threading
from typing import List, Optional
from sqlalchemy.orm import Session, joinedload, aliased
from sqlalchemy import update, or_
from sqlalchemy.exc import IntegrityError
from app.crud.base import CRUDBase
from app.models.file import FileMeta, FileStore
from app.schemas.file import FileMetaCreate, FileMetaUpdate
from datetime import datetime, timedelta
import re

# Global lock for folder creation to prevent race conditions in multi-threaded environment
folder_creation_lock = threading.Lock()

class CRUDFileMeta(CRUDBase[FileMeta, FileMetaCreate, FileMetaUpdate]):
    def get_by_user_and_parent(
        self, db: Session, *, user_id: int, parent_id: int = 0, search: Optional[str] = None, skip: int = 0, limit: int = 100
    ) -> List[FileMeta]:
        query = db.query(FileMeta).options(joinedload(FileMeta.file_store))
        
        if search:
            # Search mode: ignore parent_id, search all active files
            query = query.filter(
                FileMeta.user_id == user_id,
                FileMeta.is_deleted == False,
                FileMeta.file_name.like(f"%{search}%")
            )
        else:
            # Normal mode: filter by parent_id
            query = query.filter(
                FileMeta.user_id == user_id, 
                FileMeta.parent_id == parent_id,
                FileMeta.is_deleted == False
            )
            
        return query.offset(skip).limit(limit).all()

    def get_by_name_and_parent(
        self, db: Session, *, name: str, parent_id: int, user_id: int
    ) -> Optional[FileMeta]:
        return db.query(FileMeta).filter(
            FileMeta.user_id == user_id,
            FileMeta.parent_id == parent_id,
            FileMeta.file_name == name,
            FileMeta.is_deleted == False
        ).first()

    def get_trash_files(
        self, db: Session, *, user_id: int, parent_id: Optional[int] = None, skip: int = 0, limit: int = 100
    ) -> List[FileMeta]:
        """
        Get trash files.
        If parent_id is provided, get deleted children of that folder.
        If parent_id is None, get 'Trash Root' items (deleted items whose parents are NOT deleted).
        """
        # Auto clean expired trash files (e.g., older than 30 days)
        self.clean_expired_trash(db, user_id=user_id)

        if parent_id is not None and parent_id != 0:
            # Inside a deleted folder, just show its deleted children
            return (
                db.query(FileMeta)
                .options(joinedload(FileMeta.file_store))
                .filter(
                    FileMeta.user_id == user_id, 
                    FileMeta.parent_id == parent_id,
                    FileMeta.is_deleted == True
                )
                .offset(skip)
                .limit(limit)
                .all()
            )
        
        # Trash Root Logic:
        # Show item if:
        # 1. Item is deleted
        # 2. AND (Parent is Root OR Parent is NOT deleted)
        
        ParentMeta = aliased(FileMeta)
        
        return (
            db.query(FileMeta)
            .options(joinedload(FileMeta.file_store))
            .outerjoin(ParentMeta, FileMeta.parent_id == ParentMeta.id)
            .filter(
                FileMeta.user_id == user_id,
                FileMeta.is_deleted == True,
                or_(
                    FileMeta.parent_id == 0,           # Parent is root
                    ParentMeta.id == None,             # Parent not found (orphan)
                    ParentMeta.is_deleted == False     # Parent exists but is active (not deleted)
                )
            )
            .offset(skip)
            .limit(limit)
            .all()
        )

    def clean_expired_trash(self, db: Session, *, user_id: int, days: int = 30):
        """
        Permanently delete files that have been in trash for more than `days`.
        """
        expire_date = datetime.utcnow() - timedelta(days=days)
        expired_files = db.query(FileMeta).filter(
            FileMeta.user_id == user_id,
            FileMeta.is_deleted == True,
            FileMeta.deleted_at < expire_date
        ).all()
        
        for file in expired_files:
            self.permanent_remove(db=db, id=file.id, user_id=user_id)

    def _get_unique_filename(self, db: Session, user_id: int, parent_id: int, file_name: str) -> str:
        base_name = file_name
        name_without_ext = base_name
        ext = ""
        if "." in base_name and not base_name.startswith("."):
            name_without_ext, ext = base_name.rsplit(".", 1)
            ext = "." + ext

        existing_files = db.query(FileMeta.file_name).filter(
            FileMeta.user_id == user_id,
            FileMeta.parent_id == parent_id,
            FileMeta.file_name.like(f"{name_without_ext}%{ext}"),
            FileMeta.is_deleted == False # Check against active files
        ).all()
        
        existing_names = {f[0] for f in existing_files}
        
        if file_name not in existing_names:
            return file_name
            
        counter = 1
        while True:
            new_name = f"{name_without_ext} ({counter}){ext}"
            if new_name not in existing_names:
                return new_name
            counter += 1

    def create_with_user(
        self, db: Session, *, obj_in: FileMetaCreate, user_id: int
    ) -> FileMeta:
        unique_name = self._get_unique_filename(
            db, user_id=user_id, parent_id=obj_in.parent_id, file_name=obj_in.file_name
        )
        
        db_obj = FileMeta(
            file_name=unique_name,
            is_folder=obj_in.is_folder,
            parent_id=obj_in.parent_id,
            file_hash=obj_in.file_hash,
            user_id=user_id,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow()
        )
        db.add(db_obj)
        db.commit()
        db.refresh(db_obj)
        return db_obj
    
    def get_by_hash(self, db: Session, *, file_hash: str) -> Optional[FileStore]:
        return db.query(FileStore).filter(FileStore.file_hash == file_hash).first()

    def create_file_store(
        self, db: Session, *, file_hash: str, real_path: str, file_size: int
    ) -> FileStore:
        # Double check to prevent race condition
        existing = self.get_by_hash(db, file_hash=file_hash)
        if existing:
            return self.increment_ref_count(db, file_hash=file_hash)

        try:
            db_obj = FileStore(
                file_hash=file_hash,
                real_path=real_path,
                file_size=file_size,
                ref_count=1
            )
            db.add(db_obj)
            db.commit()
            db.refresh(db_obj)
            return db_obj
        except IntegrityError:
            # Race condition: file was created by another request just now
            db.rollback()
            return self.increment_ref_count(db, file_hash=file_hash)

    def increment_ref_count(self, db: Session, *, file_hash: str) -> Optional[FileStore]:
        stmt = (
            update(FileStore)
            .where(FileStore.file_hash == file_hash)
            .values(ref_count=FileStore.ref_count + 1)
        )
        db.execute(stmt)
        db.commit()
        return self.get_by_hash(db, file_hash=file_hash)

    def decrement_ref_count(self, db: Session, *, file_hash: str) -> Optional[FileStore]:
        stmt = (
            update(FileStore)
            .where(FileStore.file_hash == file_hash)
            .values(ref_count=FileStore.ref_count - 1)
        )
        db.execute(stmt)
        db.commit()
        return self.get_by_hash(db, file_hash=file_hash)

    def remove(self, db: Session, *, id: int, user_id: int) -> FileMeta:
        """
        Soft delete: Mark as deleted
        """
        obj = db.query(self.model).filter(self.model.id == id, self.model.user_id == user_id).first()
        if not obj:
            return None

        # Recursively soft delete children if folder
        if obj.is_folder:
            children = db.query(self.model).filter(self.model.parent_id == id, self.model.user_id == user_id).all()
            for child in children:
                self.remove(db=db, id=child.id, user_id=user_id)

        obj.is_deleted = True
        obj.deleted_at = datetime.utcnow()
        obj.updated_at = datetime.utcnow() # Update timestamp
        db.add(obj)
        db.commit()
        db.refresh(obj)
        return obj

    def restore(self, db: Session, *, id: int, user_id: int) -> FileMeta:
        """
        Restore from trash (Recursively Downwards AND Upwards)
        """
        obj = db.query(self.model).filter(self.model.id == id, self.model.user_id == user_id).first()
        if not obj:
            return None
            
        # 1. Restore self
        obj.is_deleted = False
        obj.deleted_at = None
        obj.updated_at = datetime.utcnow() # Update timestamp
        db.add(obj)
        
        # 2. Restore children (Downwards)
        self._restore_downwards(db, obj, user_id)

        # 3. Restore parents (Upwards)
        self._restore_upwards(db, obj, user_id)

        db.commit()
        db.refresh(obj)
        return obj

    def _restore_upwards(self, db: Session, obj: FileMeta, user_id: int):
        """
        Iteratively restore parents
        """
        current = obj
        while current.parent_id != 0:
            parent = db.query(FileMeta).filter(
                FileMeta.id == current.parent_id,
                FileMeta.user_id == user_id
            ).first()
            
            if not parent:
                break
                
            if parent.is_deleted:
                parent.is_deleted = False
                parent.deleted_at = None
                parent.updated_at = datetime.utcnow()
                db.add(parent)
            
            current = parent

    def _restore_downwards(self, db: Session, obj: FileMeta, user_id: int):
        """
        Recursively restore children
        """
        if not obj.is_folder:
            return

        children = db.query(FileMeta).filter(
            FileMeta.parent_id == obj.id, 
            FileMeta.user_id == user_id,
            FileMeta.is_deleted == True
        ).all()
        
        for child in children:
            child.is_deleted = False
            child.deleted_at = None
            child.updated_at = datetime.utcnow()
            db.add(child)
            self._restore_downwards(db, child, user_id)

    def permanent_remove(self, db: Session, *, id: int, user_id: int) -> FileMeta:
        """
        Hard delete: Physically remove
        """
        obj = db.query(self.model).options(joinedload(self.model.file_store)).filter(self.model.id == id, self.model.user_id == user_id).first()
        if not obj:
            return None

        if obj.is_folder:
            children = db.query(self.model).filter(self.model.parent_id == id, self.model.user_id == user_id).all()
            for child in children:
                self.permanent_remove(db=db, id=child.id, user_id=user_id)
        else:
            if obj.file_store:
                updated_store = self.decrement_ref_count(db, file_hash=obj.file_hash)
                if updated_store and updated_store.ref_count <= 0:
                    if os.path.exists(updated_store.real_path):
                        os.remove(updated_store.real_path)
                    db.delete(updated_store)

        db.delete(obj)
        db.commit()
        return obj

    def get_ancestors(self, db: Session, *, folder_id: int, user_id: int) -> List[FileMeta]:
        ancestors = []
        current_id = folder_id
        
        while current_id != 0:
            folder = db.query(FileMeta).filter(FileMeta.id == current_id, FileMeta.user_id == user_id).first()
            if not folder:
                break
            ancestors.insert(0, folder)
            current_id = folder.parent_id
            
        return ancestors

    def get_or_create_path(self, db: Session, *, user_id: int, parent_id: int, relative_path: str) -> int:
        """
        Parse relative_path (e.g., "FolderA/FolderB/file.txt") and create folders if not exist.
        Returns the parent_id for the file.
        """
        parts = relative_path.split("/")
        # The last part is the filename, we only care about folders
        folder_parts = parts[:-1]
        
        current_parent_id = parent_id
        
        # Use a lock to prevent race conditions when creating folders
        with folder_creation_lock:
            for folder_name in folder_parts:
                if not folder_name:
                    continue

                # Check if folder exists
                folder = db.query(FileMeta).filter(
                    FileMeta.user_id == user_id,
                    FileMeta.parent_id == current_parent_id,
                    FileMeta.file_name == folder_name,
                    FileMeta.is_folder == True,
                    FileMeta.is_deleted == False
                ).first()
                
                if folder:
                    current_parent_id = folder.id
                else:
                    # Create folder
                    new_folder = FileMeta(
                        file_name=folder_name,
                        is_folder=True,
                        parent_id=current_parent_id,
                        user_id=user_id,
                        created_at=datetime.utcnow(),
                        updated_at=datetime.utcnow()
                    )
                    db.add(new_folder)
                    db.commit()
                    db.refresh(new_folder)
                    
                    # Check for duplicates (Race condition handling)
                    existing_folders = db.query(FileMeta).filter(
                        FileMeta.user_id == user_id,
                        FileMeta.parent_id == current_parent_id,
                        FileMeta.file_name == folder_name,
                        FileMeta.is_folder == True,
                        FileMeta.is_deleted == False
                    ).order_by(FileMeta.id.asc()).all()

                    if len(existing_folders) > 1:
                        # Use the oldest folder
                        primary_folder = existing_folders[0]
                        current_parent_id = primary_folder.id
                        
                        # Remove duplicates if they are empty
                        for dup in existing_folders[1:]:
                            # Check if empty
                            has_children = db.query(FileMeta).filter(FileMeta.parent_id == dup.id).first()
                            if not has_children:
                                db.delete(dup)
                        try:
                            db.commit()
                        except Exception:
                            db.rollback()
                    else:
                        current_parent_id = new_folder.id
                
        return current_parent_id

    def copy(self, db: Session, *, id: int, target_parent_id: int, user_id: int) -> Optional[FileMeta]:
        """
        Copy file or folder to target directory.
        """
        obj = db.query(self.model).filter(self.model.id == id, self.model.user_id == user_id).first()
        if not obj:
            return None

        # Check for unique name in target
        unique_name = self._get_unique_filename(db, user_id=user_id, parent_id=target_parent_id, file_name=obj.file_name)

        new_obj = FileMeta(
            file_name=unique_name,
            is_folder=obj.is_folder,
            parent_id=target_parent_id,
            file_hash=obj.file_hash,
            user_id=user_id,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow()
        )
        db.add(new_obj)
        db.commit()
        db.refresh(new_obj)

        if not obj.is_folder:
            # Increment ref count for file
            if obj.file_hash:
                self.increment_ref_count(db, file_hash=obj.file_hash)
        else:
            # Recursively copy children
            children = db.query(self.model).filter(self.model.parent_id == id, self.model.user_id == user_id, self.model.is_deleted == False).all()
            for child in children:
                self.copy(db=db, id=child.id, target_parent_id=new_obj.id, user_id=user_id)
        
        return new_obj

    def move(self, db: Session, *, id: int, target_parent_id: int, user_id: int) -> Optional[FileMeta]:
        """
        Move file or folder to target directory.
        """
        obj = db.query(self.model).filter(self.model.id == id, self.model.user_id == user_id).first()
        if not obj:
            return None

        # Prevent moving folder into itself
        if obj.is_folder:
            # Check if target_parent_id is a child of obj.id
            ancestors = self.get_ancestors(db, folder_id=target_parent_id, user_id=user_id)
            for ancestor in ancestors:
                if ancestor.id == id:
                    return None # Cannot move into self

        # Check for unique name in target
        unique_name = self._get_unique_filename(db, user_id=user_id, parent_id=target_parent_id, file_name=obj.file_name)
        
        obj.parent_id = target_parent_id
        obj.file_name = unique_name
        obj.updated_at = datetime.utcnow()
        
        db.add(obj)
        db.commit()
        db.refresh(obj)
        return obj

file = CRUDFileMeta(FileMeta)