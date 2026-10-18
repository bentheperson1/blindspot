import base64
import binascii

from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from PIL import UnidentifiedImageError
from pydantic import BaseModel

from app.core.config import settings
from app.services.classifier import describe

router = APIRouter(tags=["classify"])


class ClassifyBase64Request(BaseModel):
    image: str  # base64 JPEG/PNG, raw or as a data: URL


async def _classify_bytes(request: Request, data: bytes) -> dict:
    classifier = request.app.state.classifier
    if classifier is None:
        raise HTTPException(status_code=503, detail="Classifier not loaded")

    if len(data) > settings.max_upload_bytes:
        raise HTTPException(status_code=413, detail="Image too large")

    try:
        result = await run_in_threadpool(classifier.predict_bytes, data)
    except UnidentifiedImageError:
        raise HTTPException(status_code=400, detail="Could not decode image data")

    return {**describe(result), "latency_ms": result["latency_ms"]}


@router.post("/classify")
async def classify(request: Request, file: UploadFile = File(...)):
    """Multipart upload (field "file"). Handy for curl and the /docs page."""
    return await _classify_bytes(request, await file.read())


@router.post("/classify-base64")
async def classify_base64(request: Request, payload: ClassifyBase64Request):
    """JSON {"image": "<base64>"}. Used by the phone app: Expo's fetch can't send
    React Native's {uri, name, type} multipart file parts."""
    image = payload.image
    if image.startswith("data:") and "," in image:  # accept data URLs too
        image = image.split(",", 1)[1]
    try:
        data = base64.b64decode(image, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(status_code=400, detail="Invalid base64 data")
    return await _classify_bytes(request, data)
