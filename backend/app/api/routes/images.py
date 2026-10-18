import base64

from fastapi import APIRouter, File, HTTPException, Response, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.concurrency import run_in_threadpool

from app.core.config import settings
from app.schemas.vision import Base64ImageRequest, Base64ImageResponse, Dot, FlockCamera, ImageInfo, UserMessage, ImageInfo, Telemetry, UserMessage
from app.services import camera_store, vision

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
 
    if telemetry.location is None:
        return Base64ImageResponse(telemetry=telemetry, dots=[])
 
    def build_points():
        cameras = camera_store.cameras_within(
            telemetry.location.latitude,
            telemetry.location.longitude,
            payload.radius_m,
        )
        return vision.process_sent_data(cameras, payload.camera_width, payload.camera_height, telemetry)
 
    points = await run_in_threadpool(build_points)

    dots = []
    for p in points or []:
        if p and 0 <= p["x"] <= 1 and 0 <= p["y"] <= 1:
            dots.append(Dot(
                name=p["name"],
                x=float(p["x"]),
                y=float(p["y"]),
                distance_to_user=float(p["distance_to_user"]),
            ))
 
    return Base64ImageResponse(telemetry=telemetry, dots=dots)


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