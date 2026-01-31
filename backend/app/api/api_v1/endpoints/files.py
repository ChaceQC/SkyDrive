import os
import shutil
import hashlib
import uuid
import zipfile
import tempfile
import mimetypes
import time
import random
import re
from typing import Any, List, Optional, Union
from urllib.parse import quote

# 引入 Query 以解决 JSON Body 和 Form 混合的问题
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, BackgroundTasks, Body, Request, Header, \
    Query
from fastapi.responses import FileResponse, StreamingResponse, Response, PlainTextResponse, HTMLResponse
from sqlalchemy.orm import Session, joinedload
from PIL import Image
import io
import pandas as pd

from app import crud, models, schemas
from app.api import deps
from app.core.config import settings

router = APIRouter()


def is_filename_valid(filename: str) -> bool:
    """
    Checks if a filename contains illegal characters for Windows, Linux, and macOS.
    """
    if re.search(r'[<>:"/\\|?*]', filename):
        return False
    return True


def get_best_storage_path() -> str:
    """
    Selects the storage path with the most available space.
    """
    if not settings.STORAGE_PATHS:
        raise HTTPException(status_code=500, detail="No storage paths configured.")

    best_path = None
    max_free_space = -1

    for path in settings.STORAGE_PATHS:
        try:
            os.makedirs(path, exist_ok=True)
            usage = shutil.disk_usage(path)
            if usage.free > max_free_space:
                max_free_space = usage.free
                best_path = path
        except OSError as e:
            print(f"Warning: Could not check disk usage for path {path}: {e}")
            continue

    if best_path is None:
        raise HTTPException(status_code=500, detail="No usable storage paths found.")

    return best_path


def get_unique_filename(db: Session, filename: str, parent_id: int, user_id: int) -> str:
    """
    Generates a unique filename by appending (n) if a conflict exists.
    Example: file.txt -> file (1).txt -> file (2).txt
    """
    if not crud.file.get_by_name_and_parent(db, name=filename, parent_id=parent_id, user_id=user_id):
        return filename

    name, ext = os.path.splitext(filename)
    counter = 1
    while True:
        new_name = f"{name} ({counter}){ext}"
        if not crud.file.get_by_name_and_parent(db, name=new_name, parent_id=parent_id, user_id=user_id):
            return new_name
        counter += 1


@router.get("", response_model=List[schemas.FileMeta])
def read_files(
        db: Session = Depends(deps.get_db),
        current_user: models.User = Depends(deps.get_current_user),
        parent_id: int = 0,
        search: Optional[str] = None,
        skip: int = 0,
        limit: int = 100,
) -> Any:
    files = crud.file.get_by_user_and_parent(
        db, user_id=current_user.id, parent_id=parent_id, search=search, skip=skip, limit=limit
    )
    return files


@router.put("/{file_id}", response_model=schemas.FileMeta)
def update_file(
        *,
        db: Session = Depends(deps.get_db),
        current_user: models.User = Depends(deps.get_current_user),
        file_id: int,
        file_in: schemas.FileMetaUpdate,
) -> Any:
    if file_in.file_name and not is_filename_valid(file_in.file_name):
        raise HTTPException(status_code=400, detail='文件名包含非法字符: < > : " / \\ | ? *')

    file = crud.file.get(db=db, id=file_id)
    if not file:
        raise HTTPException(status_code=404, detail="File not found")
    if file.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not enough permissions")

    if file_in.file_name and crud.file.get_by_name_and_parent(db, name=file_in.file_name, parent_id=file.parent_id,
                                                              user_id=current_user.id):
        raise HTTPException(status_code=409, detail="A file with this name already exists in this folder")

    file = crud.file.update(db=db, db_obj=file, obj_in=file_in)
    return file


@router.get("/trash", response_model=List[schemas.FileMeta])
def read_trash_files(
        db: Session = Depends(deps.get_db),
        current_user: models.User = Depends(deps.get_current_user),
        parent_id: Optional[int] = 0,
        skip: int = 0,
        limit: int = 100,
) -> Any:
    files = crud.file.get_trash_files(
        db, user_id=current_user.id, parent_id=parent_id, skip=skip, limit=limit
    )
    return files


@router.get("/path/{folder_id}", response_model=List[schemas.FileMeta])
def get_folder_path(
        folder_id: int,
        db: Session = Depends(deps.get_db),
        current_user: models.User = Depends(deps.get_current_user),
) -> Any:
    if folder_id == 0:
        return []
    ancestors = crud.file.get_ancestors(db, folder_id=folder_id, user_id=current_user.id)
    return ancestors


@router.post("/folder", response_model=schemas.FileMeta)
def create_folder(
        *,
        db: Session = Depends(deps.get_db),
        current_user: models.User = Depends(deps.get_current_user),
        folder_in: schemas.FileMetaCreate,
) -> Any:
    if not is_filename_valid(folder_in.file_name):
        raise HTTPException(status_code=400, detail='文件夹名称包含非法字符: < > : " / \\ | ? *')

    if crud.file.get_by_name_and_parent(db, name=folder_in.file_name, parent_id=folder_in.parent_id,
                                        user_id=current_user.id):
        raise HTTPException(status_code=409, detail="A folder with this name already exists in this directory")

    folder_in.is_folder = True
    folder_in.file_hash = None
    folder = crud.file.create_with_user(db=db, obj_in=folder_in, user_id=current_user.id)
    return folder


@router.post("/upload", response_model=schemas.FileMeta)
async def upload_file(
        *,
        db: Session = Depends(deps.get_db),
        current_user: models.User = Depends(deps.get_current_user),
        file: UploadFile = File(...),
        parent_id: int = Form(0),
        relative_path: Optional[str] = Form(None),
        auto_rename: bool = Form(False),
) -> Any:
    """
    Simple Upload file (Non-chunked).
    """
    if not is_filename_valid(file.filename):
        raise HTTPException(status_code=400, detail=f'文件名 "{file.filename}" 包含非法字符: < > : " / \\ | ? *')

    target_parent_id = parent_id
    if relative_path:
        target_parent_id = crud.file.get_or_create_path(
            db, user_id=current_user.id, parent_id=parent_id, relative_path=relative_path
        )

    final_filename = file.filename
    if auto_rename:
        final_filename = get_unique_filename(db, file.filename, target_parent_id, current_user.id)
    else:
        existing = crud.file.get_by_name_and_parent(db, name=file.filename, parent_id=target_parent_id,
                                                    user_id=current_user.id)
        if existing:
            raise HTTPException(
                status_code=409,
                detail={
                    "message": f"A file with name '{file.filename}' already exists",
                    "file_id": existing.id
                }
            )

    # Temporary file
    temp_file_path = os.path.join(settings.UPLOAD_DIR, f"temp_{final_filename}_{uuid.uuid4()}")

    hasher = hashlib.md5()
    with open(temp_file_path, "wb") as buffer:
        while content := await file.read(1024 * 1024):
            hasher.update(content)
            buffer.write(content)

    file_hash = hasher.hexdigest()
    file_size = os.path.getsize(temp_file_path)

    if current_user.quota_used + file_size > current_user.quota_total:
        os.remove(temp_file_path)
        raise HTTPException(status_code=413, detail="Storage quota exceeded")

    existing_store = crud.file.get_by_hash(db, file_hash=file_hash)

    if existing_store:
        crud.file.increment_ref_count(db, file_hash=file_hash)
        os.remove(temp_file_path)
    else:
        storage_base_path = get_best_storage_path()
        final_path = os.path.join(storage_base_path, file_hash)
        os.makedirs(storage_base_path, exist_ok=True)

        if not os.path.exists(final_path):
            shutil.move(temp_file_path, final_path)
        else:
            os.remove(temp_file_path)

        crud.file.create_file_store(
            db, file_hash=file_hash, real_path=final_path, file_size=file_size
        )

    file_meta_in = schemas.FileMetaCreate(
        file_name=final_filename,
        is_folder=False,
        parent_id=target_parent_id,
        file_hash=file_hash,
        file_size=file_size
    )

    file_meta = crud.file.create_with_user(
        db=db, obj_in=file_meta_in, user_id=current_user.id
    )

    crud.user.update_quota_used(db, user=current_user, size_delta=file_size)

    return file_meta


@router.post("/check_fast_upload", response_model=schemas.CheckFastUpload)
def check_fast_upload(
        *,
        db: Session = Depends(deps.get_db),
        current_user: models.User = Depends(deps.get_current_user),
        file_hash: str = Form(...),
        file_name: str = Form(...),
        parent_id: int = Form(0),
        relative_path: Optional[str] = Form(None),
        auto_rename: bool = Form(False),
) -> Any:
    """
    Check if file can be fast uploaded (deduplication).
    """
    if not is_filename_valid(file_name):
        raise HTTPException(status_code=400, detail=f'文件名 "{file_name}" 包含非法字符: < > : " / \\ | ? *')

    target_parent_id = parent_id
    if relative_path:
        target_parent_id = crud.file.get_or_create_path(
            db, user_id=current_user.id, parent_id=parent_id, relative_path=relative_path
        )

    final_filename = file_name
    if auto_rename:
        final_filename = get_unique_filename(db, file_name, target_parent_id, current_user.id)
    else:
        existing = crud.file.get_by_name_and_parent(db, name=file_name, parent_id=target_parent_id,
                                                    user_id=current_user.id)
        if existing:
            raise HTTPException(
                status_code=409,
                detail={
                    "message": f"A file with name '{file_name}' already exists",
                    "file_id": existing.id
                }
            )

    existing_store = crud.file.get_by_hash(db, file_hash=file_hash)

    if existing_store:
        if current_user.quota_used + existing_store.file_size > current_user.quota_total:
            raise HTTPException(status_code=413, detail="Storage quota exceeded")

        crud.file.increment_ref_count(db, file_hash=file_hash)

        file_meta_in = schemas.FileMetaCreate(
            file_name=final_filename,
            is_folder=False,
            parent_id=target_parent_id,
            file_hash=file_hash,
            file_size=existing_store.file_size
        )
        file_meta = crud.file.create_with_user(
            db=db, obj_in=file_meta_in, user_id=current_user.id
        )

        crud.user.update_quota_used(db, user=current_user, size_delta=existing_store.file_size)

        return {"can_fast_upload": True, "file_meta": file_meta}

    return {"can_fast_upload": False, "file_meta": None}


@router.post("/upload/init", response_model=schemas.ChunkInitResponse)
def init_chunk_upload(
        *,
        db: Session = Depends(deps.get_db),
        current_user: models.User = Depends(deps.get_current_user),
        init_data: schemas.ChunkInit,
        # Fix: Use Query instead of Form to allow mixed JSON body + Query params
        auto_rename: bool = Query(False),
) -> Any:
    """
    Initialize chunked upload session.
    """
    if not is_filename_valid(init_data.file_name):
        raise HTTPException(status_code=400, detail=f'文件名 "{init_data.file_name}" 包含非法字符: < > : " / \\ | ? *')

    if not auto_rename:
        existing = crud.file.get_by_name_and_parent(db, name=init_data.file_name, parent_id=init_data.parent_id,
                                                    user_id=current_user.id)
        if existing:
            raise HTTPException(
                status_code=409,
                detail={
                    "message": f"A file with name '{init_data.file_name}' already exists",
                    "file_id": existing.id
                }
            )

    if current_user.quota_used + init_data.file_size > current_user.quota_total:
        raise HTTPException(status_code=413, detail="Storage quota exceeded")

    upload_id = hashlib.md5(f"{current_user.id}-{init_data.file_hash}-{init_data.parent_id}".encode()).hexdigest()

    crud.chunk.create_init_chunks(
        db,
        upload_id=upload_id,
        user_id=current_user.id,
        file_hash=init_data.file_hash,
        total_chunks=init_data.total_chunks
    )

    uploaded_chunks = crud.chunk.get_uploaded_chunks(db, upload_id=upload_id)

    return {"upload_id": upload_id, "uploaded_chunks": uploaded_chunks}


@router.post("/upload/chunk")
async def upload_chunk(
        *,
        db: Session = Depends(deps.get_db),
        current_user: models.User = Depends(deps.get_current_user),
        upload_id: str = Form(...),
        chunk_index: int = Form(...),
        file: UploadFile = File(...),
) -> Any:
    chunk_filename = f"{upload_id}_{chunk_index}"
    temp_chunk_path = os.path.join(settings.UPLOAD_DIR, chunk_filename)

    with open(temp_chunk_path, "wb") as buffer:
        content = await file.read()
        buffer.write(content)
        chunk_size = len(content)

    crud.chunk.mark_chunk_uploaded(
        db,
        upload_id=upload_id,
        chunk_index=chunk_index,
        chunk_size=chunk_size,
        temp_path=temp_chunk_path
    )

    return {"status": "success", "chunk_index": chunk_index}


@router.post("/upload/merge", response_model=schemas.FileMeta)
def merge_chunks(
        *,
        db: Session = Depends(deps.get_db),
        current_user: models.User = Depends(deps.get_current_user),
        upload_id: str = Form(...),
        file_name: str = Form(...),
        file_hash: str = Form(...),
        parent_id: int = Form(0),
        relative_path: Optional[str] = Form(None),
        auto_rename: bool = Form(False),
) -> Any:
    """
    Merge all chunks into final file.
    """
    if not is_filename_valid(file_name):
        raise HTTPException(status_code=400, detail=f'文件名 "{file_name}" 包含非法字符: < > : " / \\ | ? *')

    target_parent_id = parent_id
    if relative_path:
        target_parent_id = crud.file.get_or_create_path(
            db, user_id=current_user.id, parent_id=parent_id, relative_path=relative_path
        )

    final_filename = file_name
    if auto_rename:
        final_filename = get_unique_filename(db, file_name, target_parent_id, current_user.id)
    else:
        existing = crud.file.get_by_name_and_parent(db, name=file_name, parent_id=target_parent_id,
                                                    user_id=current_user.id)
        if existing:
            raise HTTPException(
                status_code=409,
                detail={
                    "message": f"A file with name '{file_name}' already exists",
                    "file_id": existing.id
                }
            )

    chunks = crud.chunk.get_all_chunks(db, upload_id=upload_id)
    if not chunks:
        empty_md5 = hashlib.md5(b"").hexdigest()
        if file_hash == empty_md5:
            pass
        else:
            raise HTTPException(status_code=404, detail="Upload session not found")

    for chunk in chunks:
        if not chunk.is_uploaded:
            raise HTTPException(status_code=400, detail=f"Chunk {chunk.chunk_index} missing")

    storage_base_path = get_best_storage_path()
    final_path = os.path.join(storage_base_path, file_hash)

    os.makedirs(storage_base_path, exist_ok=True)

    if not os.path.exists(final_path):
        hasher = hashlib.md5()
        with open(final_path, "wb") as final_file:
            for chunk in chunks:
                if chunk.temp_path and os.path.exists(chunk.temp_path):
                    with open(chunk.temp_path, "rb") as chunk_file:
                        while chunk_content := chunk_file.read(1024 * 1024):
                            final_file.write(chunk_content)
                            hasher.update(chunk_content)
                    os.remove(chunk.temp_path)
                else:
                    raise HTTPException(status_code=400, detail=f"Temp file for chunk {chunk.chunk_index} missing")

        calculated_hash = hasher.hexdigest()
        if calculated_hash != file_hash:
            os.remove(final_path)
            raise HTTPException(status_code=400,
                                detail=f"File hash mismatch. Client: {file_hash}, Server: {calculated_hash}")

    else:
        for chunk in chunks:
            if chunk.temp_path and os.path.exists(chunk.temp_path):
                os.remove(chunk.temp_path)

    file_size = os.path.getsize(final_path)

    if current_user.quota_used + file_size > current_user.quota_total:
        existing_store_check = crud.file.get_by_hash(db, file_hash=file_hash)
        if not existing_store_check:
            os.remove(final_path)
        raise HTTPException(status_code=413, detail="Storage quota exceeded")

    existing_store = crud.file.get_by_hash(db, file_hash=file_hash)
    if existing_store:
        crud.file.increment_ref_count(db, file_hash=file_hash)
    else:
        crud.file.create_file_store(
            db, file_hash=file_hash, real_path=final_path, file_size=file_size
        )

    file_meta_in = schemas.FileMetaCreate(
        file_name=final_filename,
        is_folder=False,
        parent_id=target_parent_id,
        file_hash=file_hash,
        file_size=file_size
    )
    file_meta = crud.file.create_with_user(
        db=db, obj_in=file_meta_in, user_id=current_user.id
    )

    crud.user.update_quota_used(db, user=current_user, size_delta=file_size)

    crud.chunk.delete_chunks(db, upload_id=upload_id)

    return file_meta


# --- 以下为标准 CRUD 操作，保持不变 ---

@router.get("/download/{file_id}")
def download_file(
        file_id: int,
        db: Session = Depends(deps.get_db),
        current_user: models.User = Depends(deps.get_current_user),
) -> Any:
    """
    Download file.
    """
    file_meta = crud.file.get(db, id=file_id)
    if not file_meta:
        raise HTTPException(status_code=404, detail="File not found")
    if file_meta.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not enough permissions")
    if file_meta.is_folder:
        raise HTTPException(status_code=400, detail="Cannot download folder")

    file_store = crud.file.get_by_hash(db, file_hash=file_meta.file_hash)
    if not file_store or not os.path.exists(file_store.real_path):
        raise HTTPException(status_code=404, detail="Physical file not found")

    file_size = os.path.getsize(file_store.real_path)

    def iterfile():
        with open(file_store.real_path, mode="rb") as file_like:
            while chunk := file_like.read(1024 * 1024):
                yield chunk

    encoded_filename = quote(file_meta.file_name)

    return StreamingResponse(
        iterfile(),
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{encoded_filename}",
            "Content-Length": str(file_size)
        }
    )


def _add_to_zip(zip_file: zipfile.ZipFile, db: Session, file_meta: models.FileMeta, current_path: str):
    if file_meta.is_folder:
        children = crud.file.get_by_user_and_parent(db, user_id=file_meta.user_id, parent_id=file_meta.id)
        for child in children:
            _add_to_zip(zip_file, db, child, os.path.join(current_path, file_meta.file_name))
    else:
        file_store = crud.file.get_by_hash(db, file_hash=file_meta.file_hash)
        if file_store and os.path.exists(file_store.real_path):
            zip_file.write(file_store.real_path, os.path.join(current_path, file_meta.file_name))


def remove_file(path: str):
    try:
        os.remove(path)
    except Exception:
        pass


@router.post("/download/batch")
def batch_download(
        *,
        db: Session = Depends(deps.get_db),
        current_user: models.User = Depends(deps.get_current_user),
        file_ids: List[int] = Body(...),
        background_tasks: BackgroundTasks
) -> Any:
    if not file_ids:
        raise HTTPException(status_code=400, detail="No files selected")

    temp_zip = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
    temp_zip.close()

    try:
        with zipfile.ZipFile(temp_zip.name, 'w', zipfile.ZIP_DEFLATED) as zipf:
            for file_id in file_ids:
                file_meta = crud.file.get(db, id=file_id)
                if file_meta and file_meta.user_id == current_user.id:
                    _add_to_zip(zipf, db, file_meta, "")

        background_tasks.add_task(remove_file, temp_zip.name)

        file_size = os.path.getsize(temp_zip.name)

        def iterfile():
            with open(temp_zip.name, mode="rb") as file_like:
                while chunk := file_like.read(1024 * 1024):
                    yield chunk

        return StreamingResponse(
            iterfile(),
            media_type="application/zip",
            headers={
                "Content-Disposition": f"attachment; filename=download_{uuid.uuid4().hex[:8]}.zip",
                "Content-Length": str(file_size)
            }
        )
    except Exception as e:
        remove_file(temp_zip.name)
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{file_id}", response_model=schemas.FileMeta)
def delete_file(
        file_id: int,
        db: Session = Depends(deps.get_db),
        current_user: models.User = Depends(deps.get_current_user),
) -> Any:
    file_meta = crud.file.remove(db=db, id=file_id, user_id=current_user.id)
    if not file_meta:
        raise HTTPException(status_code=404, detail="File not found")
    return file_meta


@router.post("/trash/{file_id}/restore", response_model=schemas.FileMeta)
def restore_file(
        file_id: int,
        db: Session = Depends(deps.get_db),
        current_user: models.User = Depends(deps.get_current_user),
) -> Any:
    file_meta = crud.file.restore(db=db, id=file_id, user_id=current_user.id)
    if not file_meta:
        raise HTTPException(status_code=404, detail="File not found")
    return file_meta


@router.delete("/trash/{file_id}", response_model=schemas.FileMeta)
def permanent_delete_file(
        file_id: int,
        db: Session = Depends(deps.get_db),
        current_user: models.User = Depends(deps.get_current_user),
) -> Any:
    file_meta = crud.file.get(db, id=file_id)
    if not file_meta:
        raise HTTPException(status_code=404, detail="File not found")

    def calculate_size(meta):
        size = 0
        if meta.is_folder:
            children = crud.file.get_trash_files(db, user_id=current_user.id, parent_id=meta.id, limit=10000)
            for child in children:
                size += calculate_size(child)
        else:
            size += meta.file_size
        return size

    size_to_free = calculate_size(file_meta)

    file_meta = crud.file.permanent_remove(db=db, id=file_id, user_id=current_user.id)

    crud.user.update_quota_used(db, user=current_user, size_delta=-size_to_free)

    return file_meta


@router.post("/batch/copy", response_model=List[schemas.FileMeta])
def batch_copy(
        *,
        db: Session = Depends(deps.get_db),
        current_user: models.User = Depends(deps.get_current_user),
        file_ids: List[int] = Body(...),
        target_parent_id: int = Body(...),
) -> Any:
    results = []
    for file_id in file_ids:
        new_file = crud.file.copy(db, id=file_id, target_parent_id=target_parent_id, user_id=current_user.id)
        if new_file:
            results.append(new_file)
    return results


@router.post("/batch/move", response_model=List[schemas.FileMeta])
def batch_move(
        *,
        db: Session = Depends(deps.get_db),
        current_user: models.User = Depends(deps.get_current_user),
        file_ids: List[int] = Body(...),
        target_parent_id: int = Body(...),
) -> Any:
    results = []
    for file_id in file_ids:
        moved_file = crud.file.move(db, id=file_id, target_parent_id=target_parent_id, user_id=current_user.id)
        if moved_file:
            results.append(moved_file)
    return results


@router.post("/batch/delete", response_model=List[schemas.FileMeta])
def batch_delete(
        *,
        db: Session = Depends(deps.get_db),
        current_user: models.User = Depends(deps.get_current_user),
        file_ids: List[int] = Body(...),
) -> Any:
    results = []
    for file_id in file_ids:
        deleted_file = crud.file.remove(db, id=file_id, user_id=current_user.id)
        if deleted_file:
            results.append(deleted_file)
    return results


@router.post("/batch/restore", response_model=List[schemas.FileMeta])
def batch_restore(
        *,
        db: Session = Depends(deps.get_db),
        current_user: models.User = Depends(deps.get_current_user),
        file_ids: List[int] = Body(...),
) -> Any:
    results = []
    for file_id in file_ids:
        restored_file = crud.file.restore(db=db, id=file_id, user_id=current_user.id)
        if restored_file:
            results.append(restored_file)
    return results


@router.post("/batch/trash/delete", response_model=List[schemas.FileMeta])
def batch_permanent_delete(
        *,
        db: Session = Depends(deps.get_db),
        current_user: models.User = Depends(deps.get_current_user),
        file_ids: List[int] = Body(...),
) -> Any:
    results = []
    total_size_freed = 0

    for file_id in file_ids:
        file_meta = crud.file.get(db, id=file_id)
        if not file_meta or file_meta.user_id != current_user.id:
            continue

        def calculate_size(meta):
            size = 0
            if meta.is_folder:
                children = crud.file.get_trash_files(db, user_id=current_user.id, parent_id=meta.id, limit=10000)
                for child in children:
                    size += calculate_size(child)
            else:
                size += meta.file_size
            return size

        total_size_freed += calculate_size(file_meta)

        deleted_file = crud.file.permanent_remove(db=db, id=file_id, user_id=current_user.id)
        if deleted_file:
            results.append(deleted_file)

    if total_size_freed > 0:
        crud.user.update_quota_used(db, user=current_user, size_delta=-total_size_freed)

    return results


@router.get("/preview/excel/{file_id}")
def preview_excel(
        file_id: int,
        db: Session = Depends(deps.get_db),
        current_user: models.User = Depends(deps.get_current_user),
) -> Any:
    file_meta = crud.file.get(db, id=file_id)
    if not file_meta:
        raise HTTPException(status_code=404, detail="File not found")
    if file_meta.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not enough permissions")

    file_store = crud.file.get_by_hash(db, file_hash=file_meta.file_hash)
    if not file_store or not os.path.exists(file_store.real_path):
        raise HTTPException(status_code=404, detail="Physical file not found")

    try:
        df = pd.read_excel(file_store.real_path, nrows=100)
        html = df.to_html(classes="excel-preview-table", index=False, na_rep="")
        return HTMLResponse(content=html)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to parse Excel: {str(e)}")


@router.get("/preview/{file_id}")
def preview_file(
        file_id: int,
        request: Request,
        db: Session = Depends(deps.get_db),
        current_user: models.User = Depends(deps.get_current_user),
        thumbnail: bool = False
) -> Any:
    file_meta = crud.file.get(db, id=file_id)
    if not file_meta:
        raise HTTPException(status_code=404, detail="File not found")
    if file_meta.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not enough permissions")
    if file_meta.is_folder:
        raise HTTPException(status_code=400, detail="Cannot preview folder")

    file_store = crud.file.get_by_hash(db, file_hash=file_meta.file_hash)
    if not file_store or not os.path.exists(file_store.real_path):
        raise HTTPException(status_code=404, detail="Physical file not found")

    file_path = file_store.real_path
    mime_type, _ = mimetypes.guess_type(file_meta.file_name)
    if not mime_type:
        mime_type = "application/octet-stream"

    if mime_type.startswith("image/"):
        if thumbnail:
            try:
                img = Image.open(file_path)
                img.thumbnail((200, 200))
                img_io = io.BytesIO()
                img.save(img_io, format=img.format or "JPEG")
                img_io.seek(0)
                return StreamingResponse(img_io, media_type=mime_type)
            except Exception:
                pass
        return FileResponse(file_path, media_type=mime_type)

    if mime_type.startswith("video/"):
        file_size = os.path.getsize(file_path)
        range_header = request.headers.get("range")

        if range_header:
            from_bytes, until_bytes = range_header.replace("bytes=", "").split("-")
            from_bytes = int(from_bytes)
            until_bytes = int(until_bytes) if until_bytes else file_size - 1

            chunk_size = until_bytes - from_bytes + 1

            def iterfile():
                with open(file_path, "rb") as f:
                    f.seek(from_bytes)
                    yield f.read(chunk_size)

            headers = {
                "Content-Range": f"bytes {from_bytes}-{until_bytes}/{file_size}",
                "Accept-Ranges": "bytes",
                "Content-Length": str(chunk_size),
                "Content-Type": mime_type,
            }

            return StreamingResponse(iterfile(), status_code=206, headers=headers)

        return FileResponse(file_path, media_type=mime_type)

    if mime_type == "application/pdf":
        return FileResponse(file_path, media_type=mime_type, content_disposition_type="inline")

    text_extensions = ['.txt', '.md', '.py', '.js', '.json', '.html', '.css', '.xml', '.log', '.ini', '.yml', '.yaml']
    ext = os.path.splitext(file_meta.file_name)[1].lower()

    if mime_type.startswith("text/") or ext in text_extensions:
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                content = f.read()
            return PlainTextResponse(content)
        except UnicodeDecodeError:
            return FileResponse(file_path, media_type=mime_type)

    return FileResponse(file_path, filename=file_meta.file_name, media_type=mime_type)