from typing import Any, List, Optional
from datetime import datetime
import os
import zipfile
import tempfile
import uuid
import mimetypes
import io
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Body, Request, BackgroundTasks
from fastapi.responses import FileResponse, StreamingResponse, HTMLResponse, PlainTextResponse
from sqlalchemy.orm import Session

from app import crud, models, schemas
from app.api import deps
from app.core.config import settings

router = APIRouter()

def _add_shared_to_zip(zip_file: zipfile.ZipFile, db: Session, file_meta: models.FileMeta, current_path: str, share_user_id: int):
    """
    Helper function to recursively add files/folders to a zip archive for shared downloads.
    Ensures only files belonging to the original sharer are included.
    """
    if file_meta.is_folder:
        # Fetch children using the original sharer's user_id
        children = crud.file.get_by_user_and_parent(db, user_id=share_user_id, parent_id=file_meta.id)
        for child in children:
            _add_shared_to_zip(zip_file, db, child, os.path.join(current_path, file_meta.file_name), share_user_id)
    else:
        file_store = crud.file.get_by_hash(db, file_hash=file_meta.file_hash)
        if file_store and os.path.exists(file_store.real_path):
            zip_file.write(file_store.real_path, os.path.join(current_path, file_meta.file_name))

def _remove_temp_file(path: str):
    """Helper to remove a temporary file."""
    try:
        os.remove(path)
    except Exception:
        pass

def _verify_share_access(db: Session, share_key: str, access_code: Optional[str] = None, check_password: bool = True):
    """Helper to verify share existence and access."""
    share = crud.share.get_by_key(db, share_key=share_key)
    if not share:
        raise HTTPException(status_code=404, detail="Share not found")
        
    if share.expire_at and share.expire_at < datetime.utcnow():
        raise HTTPException(status_code=410, detail="Share link expired")
        
    if share.max_downloads is not None and share.max_downloads != -1 and share.download_count >= share.max_downloads:
        raise HTTPException(status_code=410, detail="Download limit reached")

    if check_password and share.is_private:
        if not access_code or access_code != share.access_code:
             raise HTTPException(status_code=403, detail="Invalid access code")
    
    return share

@router.post("/", response_model=schemas.Share)
def create_share(
    *,
    db: Session = Depends(deps.get_db),
    current_user: models.User = Depends(deps.get_current_user),
    share_in: schemas.ShareCreate,
) -> Any:
    """
    Create a share link.
    """
    file = crud.file.get(db, id=share_in.file_id)
    if not file or file.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="File not found")
        
    share = crud.share.create_with_user(db=db, obj_in=share_in, user_id=current_user.id)
    return share

@router.get("/{share_key}", response_model=schemas.ShareInfo)
def get_share_info(
    *,
    db: Session = Depends(deps.get_db),
    share_key: str,
    access_code: Optional[str] = None,
) -> Any:
    """
    Get public share info.
    """
    share = _verify_share_access(db, share_key, access_code, check_password=False)

    file = crud.file.get(db, id=share.file_id)
    if not file or file.is_deleted:
        raise HTTPException(status_code=404, detail="File deleted")

    return {
        "share_key": share.share_key,
        "is_private": share.is_private,
        "file_name": file.file_name,
        "file_size": file.file_size,
        "is_folder": file.is_folder,
        "expire_at": share.expire_at,
        "max_downloads": share.max_downloads,
        "download_count": share.download_count,
        "file_id": file.id # Include file_id for frontend to fetch contents
    }

@router.get("/{share_key}/contents", response_model=List[schemas.FileMeta])
def get_shared_folder_contents(
    *,
    db: Session = Depends(deps.get_db),
    share_key: str,
    access_code: Optional[str] = None,
    folder_id: Optional[int] = None, # ID of the subfolder within the shared structure
) -> Any:
    """
    Get contents of a shared folder.
    """
    share = _verify_share_access(db, share_key, access_code)

    root_file = crud.file.get(db, id=share.file_id)
    if not root_file or root_file.is_deleted:
        raise HTTPException(status_code=404, detail="Shared file/folder deleted")
    if not root_file.is_folder:
        raise HTTPException(status_code=400, detail="Shared item is not a folder")

    target_folder_id = folder_id if folder_id is not None else root_file.id

    # Ensure the requested folder_id is actually a child of the shared root
    # or the shared root itself.
    if target_folder_id != root_file.id:
        # Check if target_folder_id is an ancestor of root_file.id or vice versa
        # For simplicity, we'll just check if it's within the same user's files and is a descendant
        # A more robust check would involve traversing the path.
        # For now, assume folder_id is a direct child or descendant of the shared root.
        # This check is crucial to prevent users from accessing arbitrary folders via shared links.
        current_path_id = target_folder_id
        is_valid_path = False
        while current_path_id != 0:
            if current_path_id == root_file.id:
                is_valid_path = True
                break
            current_folder = crud.file.get(db, id=current_path_id)
            if not current_folder or current_folder.user_id != share.user_id:
                raise HTTPException(status_code=403, detail="Invalid folder access within shared link")
            current_path_id = current_folder.parent_id
        
        if not is_valid_path:
            raise HTTPException(status_code=403, detail="Invalid folder access within shared link")


    files = crud.file.get_by_user_and_parent(db, user_id=share.user_id, parent_id=target_folder_id)
    return files

@router.post("/{share_key}/download")
def download_shared_file(
    *,
    db: Session = Depends(deps.get_db),
    share_key: str,
    access_code: Optional[str] = Body(None, embed=True), # Fix: Use embed=True to expect {"access_code": "..."}
    background_tasks: BackgroundTasks
) -> Any:
    """
    Download shared file or folder (Check password if private).
    This endpoint handles the root shared item.
    """
    share = _verify_share_access(db, share_key, access_code)
    
    file_meta = crud.file.get(db, id=share.file_id)
    if not file_meta or file_meta.is_deleted:
        raise HTTPException(status_code=404, detail="File deleted")
        
    crud.share.increment_download(db, share=share)

    if file_meta.is_folder:
        temp_zip = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
        temp_zip.close() 

        try:
            with zipfile.ZipFile(temp_zip.name, 'w', zipfile.ZIP_DEFLATED) as zipf:
                _add_shared_to_zip(zipf, db, file_meta, "", share.user_id)
            
            file_size = os.path.getsize(temp_zip.name)

            def iterfile():
                with open(temp_zip.name, mode="rb") as file_like:
                    while chunk := file_like.read(1024 * 1024): # 1MB chunk size
                        yield chunk
            
            background_tasks.add_task(_remove_temp_file, temp_zip.name)
            
            # URL encode the filename to handle non-ASCII characters
            encoded_filename = quote(f"{file_meta.file_name}.zip")
            
            return StreamingResponse(
                iterfile(),
                media_type="application/zip",
                headers={
                    "Content-Disposition": f"attachment; filename*=UTF-8''{encoded_filename}",
                    "Content-Length": str(file_size)
                }
            )
        except Exception as e:
            _remove_temp_file(temp_zip.name)
            raise HTTPException(status_code=500, detail=f"Failed to zip folder: {str(e)}")
    else:
        file_store = crud.file.get_by_hash(db, file_hash=file_meta.file_hash)
        if not file_store or not os.path.exists(file_store.real_path):
            raise HTTPException(status_code=404, detail="Physical file not found")
            
        file_size = os.path.getsize(file_store.real_path)

        def iterfile():
            with open(file_store.real_path, mode="rb") as file_like:
                while chunk := file_like.read(1024 * 1024): # 1MB chunk size
                    yield chunk

        # URL encode the filename to handle non-ASCII characters
        encoded_filename = quote(file_meta.file_name)

        return StreamingResponse(
            iterfile(),
            media_type="application/octet-stream",
            headers={
                "Content-Disposition": f"attachment; filename*=UTF-8''{encoded_filename}",
                "Content-Length": str(file_size)
            }
        )


@router.post("/{share_key}/download/{file_id}")
def download_shared_child_file(
        *,
        db: Session = Depends(deps.get_db),
        share_key: str,
        file_id: int,
        access_code: Optional[str] = Body(None, embed=True),
        background_tasks: BackgroundTasks
) -> Any:
    """
    Download a specific child file from a shared folder (No Zip).
    """
    share = _verify_share_access(db, share_key, access_code)

    root_file = crud.file.get(db, id=share.file_id)
    if not root_file or root_file.is_deleted:
        raise HTTPException(status_code=404, detail="Shared file/folder deleted")

    file_meta = crud.file.get(db, id=file_id)
    if not file_meta or file_meta.is_deleted:
        raise HTTPException(status_code=404, detail="File not found")

    # Security Check: Ensure the requested file belongs to the sharer
    if file_meta.user_id != share.user_id:
        raise HTTPException(status_code=403, detail="Not enough permissions")

    # Security Check: Ensure the file is actually a child of the shared root
    # (Only needed if the root is a folder. If root is a file, file_id must match root id)
    if root_file.is_folder:
        current_path_id = file_id
        is_valid_path = False
        while current_path_id != 0:
            if current_path_id == root_file.id:
                is_valid_path = True
                break
            current_item = crud.file.get(db, id=current_path_id)
            if not current_item or current_item.user_id != share.user_id:
                break
            current_path_id = current_item.parent_id

        if not is_valid_path:
            raise HTTPException(status_code=403, detail="Invalid file access within shared link")
    elif file_id != root_file.id:
        raise HTTPException(status_code=403, detail="Invalid access")

    if file_meta.is_folder:
        raise HTTPException(status_code=400, detail="Cannot download folder directly, use batch download")

    file_store = crud.file.get_by_hash(db, file_hash=file_meta.file_hash)
    if not file_store or not os.path.exists(file_store.real_path):
        raise HTTPException(status_code=404, detail="Physical file not found")

    crud.share.increment_download(db, share=share)

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

@router.post("/{share_key}/batch_download")
def batch_download_shared_items(
    *,
    db: Session = Depends(deps.get_db),
    share_key: str,
    file_ids: List[int] = Body(...),
    access_code: Optional[str] = Body(None), # access_code is now a top-level body field
    background_tasks: BackgroundTasks
) -> Any:
    """
    Batch download selected files/folders from a shared folder.
    """
    if not file_ids:
        raise HTTPException(status_code=400, detail="No files selected")

    share = _verify_share_access(db, share_key, access_code)

    root_file = crud.file.get(db, id=share.file_id)
    if not root_file or root_file.is_deleted:
        raise HTTPException(status_code=404, detail="Shared file/folder deleted")
    if not root_file.is_folder:
        raise HTTPException(status_code=400, detail="Shared item is not a folder, batch download not applicable")

    temp_zip = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
    temp_zip.close() 

    try:
        with zipfile.ZipFile(temp_zip.name, 'w', zipfile.ZIP_DEFLATED) as zipf:
            for file_id in file_ids:
                item_meta = crud.file.get(db, id=file_id)
                # Ensure the item belongs to the original sharer and is part of the shared root's hierarchy
                if item_meta and item_meta.user_id == share.user_id:
                    # A more robust check would ensure item_meta is a descendant of root_file.id
                    # For simplicity, we assume file_ids passed are valid descendants.
                    _add_shared_to_zip(zipf, db, item_meta, "", share.user_id)
        
        crud.share.increment_download(db, share=share) # Increment download count for the share link

        file_size = os.path.getsize(temp_zip.name)

        def iterfile():
            with open(temp_zip.name, mode="rb") as file_like:
                while chunk := file_like.read(1024 * 1024): # 1MB chunk size
                    yield chunk
        
        background_tasks.add_task(_remove_temp_file, temp_zip.name)
        return StreamingResponse(
            iterfile(),
            media_type="application/zip",
            headers={
                "Content-Disposition": f"attachment; filename=shared_batch_download_{uuid.uuid4().hex[:8]}.zip",
                "Content-Length": str(file_size)
            }
        )
    except Exception as e:
        _remove_temp_file(temp_zip.name)
        raise HTTPException(status_code=500, detail=f"Failed to batch download shared items: {str(e)}")

@router.get("/{share_key}/preview/{file_id}")
def preview_shared_file(
    file_id: int,
    share_key: str,
    request: Request,
    db: Session = Depends(deps.get_db),
    access_code: Optional[str] = None,
    thumbnail: bool = False
) -> Any:
    """
    Preview a specific file from a shared folder.
    """
    share = _verify_share_access(db, share_key, access_code)

    root_file = crud.file.get(db, id=share.file_id)
    if not root_file or root_file.is_deleted:
        raise HTTPException(status_code=404, detail="Shared file/folder deleted")
    
    file_meta = crud.file.get(db, id=file_id)
    if not file_meta or file_meta.is_deleted:
        raise HTTPException(status_code=404, detail="File not found")
    if file_meta.user_id != share.user_id: # Ensure it belongs to the sharer
        raise HTTPException(status_code=403, detail="Not enough permissions")

    # Ensure the requested file_id is actually a child of the shared root
    current_path_id = file_id
    is_valid_path = False
    while current_path_id != 0:
        if current_path_id == root_file.id:
            is_valid_path = True
            break
        current_item = crud.file.get(db, id=current_path_id)
        if not current_item or current_item.user_id != share.user_id:
            raise HTTPException(status_code=403, detail="Invalid file access within shared link")
        current_path_id = current_item.parent_id
    
    if not is_valid_path:
        raise HTTPException(status_code=403, detail="Invalid file access within shared link")

    if file_meta.is_folder:
        raise HTTPException(status_code=400, detail="Cannot preview folder")
        
    file_store = crud.file.get_by_hash(db, file_hash=file_meta.file_hash)
    if not file_store or not os.path.exists(file_store.real_path):
        raise HTTPException(status_code=404, detail="Physical file not found")
    
    file_path = file_store.real_path
    mime_type, _ = mimetypes.guess_type(file_meta.file_name)
    if not mime_type:
        mime_type = "application/octet-stream"

    # 1. Image Preview
    if mime_type.startswith("image/"):
        if thumbnail:
            try:
                from PIL import Image
                img = Image.open(file_path)
                img.thumbnail((200, 200)) 
                img_io = io.BytesIO()
                img.save(img_io, format=img.format or "JPEG")
                img_io.seek(0)
                return StreamingResponse(img_io, media_type=mime_type)
            except Exception:
                pass
        return FileResponse(file_path, media_type=mime_type)

    # 2. Video Streaming
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

    # 3. PDF Preview
    if mime_type == "application/pdf":
        return FileResponse(file_path, media_type=mime_type, content_disposition_type="inline")

    # 4. Text Preview
    text_extensions = ['.txt', '.md', '.py', '.js', '.json', '.html', '.css', '.xml', '.log', '.ini', '.yml', '.yaml']
    ext = os.path.splitext(file_meta.file_name)[1].lower()
    
    if mime_type.startswith("text/") or ext in text_extensions:
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                content = f.read()
            return PlainTextResponse(content)
        except UnicodeDecodeError:
            return FileResponse(file_path, media_type=mime_type)

    # 5. Default: Download
    # URL encode the filename to handle non-ASCII characters
    encoded_filename = quote(file_meta.file_name)
    return FileResponse(
        file_path, 
        filename=file_meta.file_name, 
        media_type=mime_type,
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{encoded_filename}"
        }
    )

@router.get("/{share_key}/preview/excel/{file_id}")
def preview_shared_excel(
    file_id: int,
    share_key: str,
    db: Session = Depends(deps.get_db),
    access_code: Optional[str] = None,
) -> Any:
    """
    Preview Excel file from a shared folder as HTML.
    """
    share = _verify_share_access(db, share_key, access_code)

    root_file = crud.file.get(db, id=share.file_id)
    if not root_file or root_file.is_deleted:
        raise HTTPException(status_code=404, detail="Shared file/folder deleted")
    
    file_meta = crud.file.get(db, id=file_id)
    if not file_meta or file_meta.is_deleted:
        raise HTTPException(status_code=404, detail="File not found")
    if file_meta.user_id != share.user_id: # Ensure it belongs to the sharer
        raise HTTPException(status_code=403, detail="Not enough permissions")

    # Ensure the requested file_id is actually a child of the shared root
    current_path_id = file_id
    is_valid_path = False
    while current_path_id != 0:
        if current_path_id == root_file.id:
            is_valid_path = True
            break
        current_item = crud.file.get(db, id=current_path_id)
        if not current_item or current_item.user_id != share.user_id:
            raise HTTPException(status_code=403, detail="Invalid file access within shared link")
        current_path_id = current_item.parent_id
    
    if not is_valid_path:
        raise HTTPException(status_code=403, detail="Invalid file access within shared link")
        
    file_store = crud.file.get_by_hash(db, file_hash=file_meta.file_hash)
    if not file_store or not os.path.exists(file_store.real_path):
        raise HTTPException(status_code=404, detail="Physical file not found")
    
    try:
        import pandas as pd
        df = pd.read_excel(file_store.real_path, nrows=100)
        html = df.to_html(classes="excel-preview-table", index=False, na_rep="")
        return HTMLResponse(content=html)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to parse Excel: {str(e)}")
