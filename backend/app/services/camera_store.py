# app/services/camera_store.py
import logging
import math
import os
import time
import threading

from pydantic import ValidationError

from app.schemas.vision import FlockCamera

logger = logging.getLogger("uvicorn.error")

DEFAULT_RADIUS_M = 500
CACHE_SECONDS = 300

credential_path = os.getenv("DATABASE_CREDENTIALS", "C:\\Users\\fifth\\Downloads\\felixdatathon2026-firebase-adminsdk-fbsvc-c380b80266.json")

_db = None
_unavailable_reason: str | None = None  # set once if Firebase can't be set up; we don't retry
_cache: dict = {"cameras": [], "loaded_at": 0.0}

_lock = threading.Lock()


class CameraStoreUnavailable(Exception):
    pass


def _get_db():
    # Firebase is optional: connect on first use so the app starts without firebase-admin
    # or DATABASE_CREDENTIALS. Call with _lock held.
    global _db, _unavailable_reason
    if _db is not None:
        return _db
    if _unavailable_reason is None:
        try:
            import firebase_admin
            from firebase_admin import credentials, firestore

            if not firebase_admin._apps:
                firebase_admin.initialize_app(credentials.Certificate(credential_path))
            _db = firestore.client()
            return _db
        except Exception as exc:
            _unavailable_reason = f"{type(exc).__name__}: {exc}"
            logger.warning("Firebase camera store unavailable, AR dots disabled (%s)", _unavailable_reason)
    raise CameraStoreUnavailable(_unavailable_reason)


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = (
        math.sin((p2 - p1) / 2) ** 2
        + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    )
    return 2 * 6371000 * math.asin(math.sqrt(a))


def all_cameras() -> list[FlockCamera]:
    with _lock:
        if time.time() - _cache["loaded_at"] > CACHE_SECONDS:
            # Firebase is optional and connected lazily. If it isn't available, serve whatever
            # is cached (possibly empty) instead of crashing; _get_db() won't retry once it has
            # recorded a reason, so this stays cheap.
            try:
                db = _get_db()
            except CameraStoreUnavailable:
                return _cache["cameras"]
            cameras = []
            for doc in db.collection("cameras").stream():
                try:
                    cameras.append(FlockCamera.model_validate(doc.to_dict()))
                except ValidationError:
                    continue
            _cache.update(cameras=cameras, loaded_at=time.time())
            logger.info("Loaded %d cameras", len(cameras))
    return _cache["cameras"]


def cameras_within(lat: float, lon: float, radius_m: float = DEFAULT_RADIUS_M) -> list[FlockCamera]:
    hits = [
        (d, cam)
        for cam in all_cameras()
        if (d := haversine_m(lat, lon, cam.latitude, cam.longitude)) <= radius_m
    ]
    return [cam for _, cam in sorted(hits, key=lambda h: h[0])]