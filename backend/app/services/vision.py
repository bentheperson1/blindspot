import base64
import binascii

import cv2
import numpy as np

from app.schemas.vision import Base64ImageRequest, Base64ImageResponse, ImageInfo, UserMessage, ImageInfo, Telemetry, UserMessage

from .ar_projection import project_to_screen

class InvalidImageError(Exception):
    pass


def decode_base64(data: str) -> bytes:
    # Accept both raw base64 and data URLs ("data:image/png;base64,....")
    if data.startswith("data:") and "," in data:
        data = data.split(",", 1)[1]

    try:
        return base64.b64decode(data, validate=True)
    except (binascii.Error, ValueError):
        raise InvalidImageError("Invalid base64 data")


def decode_image(data: bytes) -> np.ndarray:
    if not data:
        raise InvalidImageError("Empty image data")

    buffer = np.frombuffer(data, dtype=np.uint8)
    image = cv2.imdecode(buffer, cv2.IMREAD_COLOR)

    if image is None:
        raise InvalidImageError("Could not decode image data")

    return image


def encode_image(image: np.ndarray, ext: str = ".jpg", quality: int = 90) -> bytes:
    params = []

    if ext in (".jpg", ".jpeg"):
        params = [cv2.IMWRITE_JPEG_QUALITY, quality]

    success, encoded = cv2.imencode(ext, image, params)

    if not success:
        raise InvalidImageError("Could not encode image")

    return encoded.tobytes()


def process_sent_data(data: bytes, telemetry_payload: Telemetry, quality: int = 90) -> np.ndarray:
    # Replace this with your actual pipeline
    image = decode_image(data)

    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(gray, 100, 200)

    telemetry = Telemetry.model_validate(telemetry_payload.model_dump(include=set(Telemetry.model_fields)))

    coord_lat = telemetry.location.latitude
    coord_long = telemetry.location.longitude

    target_lat = 32.9829167
    target_long = -96.7566389

    roll = telemetry.motion.rotation.gamma if telemetry.motion and telemetry.motion.rotation else 0
    pitch = telemetry.motion.rotation.beta if telemetry.motion and telemetry.motion.rotation else 0
    yaw = telemetry.motion.rotation.alpha if telemetry.motion and telemetry.motion.rotation else 0

    print(f"Roll: {roll}, Pitch: {pitch}, Yaw: {yaw}")

    print(f"Coord: {coord_lat}, {coord_long}")
    print(f"Target: {target_lat}, {target_long}")


    result = project_to_screen(coord_lat, coord_long, roll, pitch, yaw, target_lat, target_long)

    print(result)

    return encode_image(edges, ".jpg", quality)

