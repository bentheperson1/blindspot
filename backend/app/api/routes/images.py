import base64

from fastapi import APIRouter, File, HTTPException, Response, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.concurrency import run_in_threadpool

from app.core.config import settings
from app.schemas.vision import Base64ImageRequest, Base64ImageResponse, ImageInfo, UserMessage, ImageInfo, Telemetry, UserMessage
from app.services import vision

router = APIRouter(prefix="/images", tags=["images"])


def check_size(data: bytes):
    if len(data) > settings.max_upload_bytes:
        raise HTTPException(status_code=413, detail="Image too large")


@router.post("/process")
async def process_upload(file: UploadFile = File(...)):
    data = await file.read()
    check_size(data)

    try:
        encoded = await run_in_threadpool(vision.process_bytes, data, settings.jpeg_quality)
    except vision.InvalidImageError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return Response(content=encoded, media_type="image/jpeg")


@router.post("/process-base64", response_model=Base64ImageResponse)
async def process_base64(payload: UserMessage):
    telemetry = Telemetry.model_validate(payload.model_dump(include=set(Telemetry.model_fields)))

    encoded = await run_in_threadpool(
        vision.process_sent_data, payload.camera_width, payload.camera_height, telemetry
    )

    if encoded[0] == -1:
        return Base64ImageResponse(telemetry=telemetry, dot_x_normalized=None, dot_y_normalized=None)

    return Base64ImageResponse(telemetry=telemetry, dot_x_normalized=encoded[0], dot_y_normalized=encoded[1])


@router.post("/info", response_model=ImageInfo)
async def image_info(file: UploadFile = File(...)):
    data = await file.read()
    check_size(data)

    try:
        image = await run_in_threadpool(vision.decode_image, data)
    except vision.InvalidImageError as e:
        raise HTTPException(status_code=400, detail=str(e))

    height, width, channels = image.shape

    return ImageInfo(width=width, height=height, channels=channels)

@router.post("/augmented_test", response_model=UserMessage)
async def augmented_test(payload: UserMessage):
    print(payload)
    return payload

@router.websocket("/stream")
async def stream_images(websocket: WebSocket):
    await websocket.accept()

    try:
        while True:
            data = await websocket.receive_bytes()

            if len(data) > settings.max_upload_bytes:
                await websocket.send_json({"error": "image too large"})
                continue

            try:
                encoded = await run_in_threadpool(vision.process_bytes, data, settings.jpeg_quality)
            except vision.InvalidImageError:
                await websocket.send_json({"error": "invalid image"})
                continue

            await websocket.send_bytes(encoded)
    except WebSocketDisconnect:
        pass