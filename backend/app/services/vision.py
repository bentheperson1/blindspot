import base64
import binascii

import cv2
import numpy as np


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


def process_image(image: np.ndarray) -> np.ndarray:
    # Replace this with your actual pipeline
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(gray, 100, 200)

    return edges


def process_bytes(data: bytes, quality: int = 90) -> bytes:
    # Full decode -> process -> encode pipeline, run in a worker thread by the routes
    image = decode_image(data)
    result = process_image(image)

    return encode_image(result, ".jpg", quality)