from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from PIL import UnidentifiedImageError

from app.core.config import settings
from app.services.classifier import describe

router = APIRouter(tags=["classify"])


@router.post("/classify")
async def classify(request: Request, file: UploadFile = File(...)):
    classifier = request.app.state.classifier
    if classifier is None:
        raise HTTPException(status_code=503, detail="Classifier not loaded")

    data = await file.read()
    if len(data) > settings.max_upload_bytes:
        raise HTTPException(status_code=413, detail="Image too large")

    try:
        result = await run_in_threadpool(classifier.predict_bytes, data)
    except UnidentifiedImageError:
        raise HTTPException(status_code=400, detail="Could not decode image data")

    return {**describe(result), "latency_ms": result["latency_ms"]}
