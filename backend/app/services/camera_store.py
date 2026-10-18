# app/services/camera_store.py
import math
import os
import time

import firebase_admin
from firebase_admin import credentials, firestore
from pydantic import ValidationError

from app.schemas.vision import FlockCamera

DEFAULT_RADIUS_M = 500
CACHE_SECONDS = 300

credential_path = os.getenv("DATABASE_CREDENTIALS", "/Users/prestoncrowe/Desktop/Development/FelixDatathon26/backend/felixdatathon2026-firebase-adminsdk-fbsvc-c380b80266.json")

if not firebase_admin._apps:
    firebase_admin.initialize_app(credentials.Certificate(credential_path))

_db = firestore.client()
_cache: dict = {"cameras": [], "loaded_at": 0.0}


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = (
        math.sin((p2 - p1) / 2) ** 2
        + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    )
    return 2 * 6371000 * math.asin(math.sqrt(a))


def all_cameras() -> list[FlockCamera]:
    if time.time() - _cache["loaded_at"] > CACHE_SECONDS:
        cameras = []
        for doc in _db.collection("flock_cameras").stream():
            try:
                cameras.append(FlockCamera.model_validate(doc.to_dict()))
            except ValidationError:
                continue
        _cache.update(cameras=cameras, loaded_at=time.time())

        print(cameras)
    return _cache["cameras"]


def cameras_within(lat: float, lon: float, radius_m: float = DEFAULT_RADIUS_M) -> list[FlockCamera]:
    hits = [
        (d, cam)
        for cam in all_cameras()
        if (d := haversine_m(lat, lon, cam.latitude, cam.longitude)) <= radius_m
    ]
    return [cam for _, cam in sorted(hits, key=lambda h: h[0])]