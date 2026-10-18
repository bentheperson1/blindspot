import os
import json
import math
import time

import firebase_admin
from firebase_admin import firestore
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ValidationError, Field
from ...schemas.vision import FlockCamera
from ...services.ar_projection import project_to_screen

router = APIRouter(prefix="/cameras", tags=["cameras"])
_cache = {"cameras": [], "loaded_at": 0}

credential_path = os.environ.get("DATABASE_CREDENTIALS")
firebase_admin.initialize_app(credential_path)
firestore_db = firestore.client()

DEFAULT_RADIUS_M = 500
CACHE_SECONDS = 300

class Location(BaseModel):
    lat: float
    lon: float
    radius_m: float = Field(default=DEFAULT_RADIUS_M, gt=50, le=5000)

class InputInfo(BaseModel):
    lat_p: float
    lon_p: float
    alpha: float
    beta: float
    gamma: float
    compass_heading: float
    
    screen_w: int
    screen_h: int
    hfov: int
    
class LocationInputInfo(BaseModel):
    lat_p: float
    lon_p: float
    alpha: float
    beta: float
    gamma: float
    compass_heading: float
    
    screen_w: int
    screen_h: int
    hfov: int
    
    radius: int

@router.get("")
def health_check():
    return {"status": "ok"}

@router.get("/getall")
def get_all_cameras(input_info: InputInfo):
    try:
        documents = (
            firestore_db
            .collection("flock_cameras")
            .stream()
        )

        cameras: list[FlockCamera] = []

        for document in documents:
            data = document.to_dict()

            try:
                camera = FlockCamera.model_validate(data)
                cameras.append(camera)

            except ValidationError as exc:
                raise HTTPException(
                    status_code=500,
                    detail=f"Invalid camera document: {document.id}"
                ) from exc

        return project_to_screen(input_info.lat_p, input_info.lon_p, input_info.alpha, input_info.beta, input_info.gamma, input_info.compass_heading, cameras, input_info.screen_w, input_info.screen_h, input_info.hfov)

    except HTTPException:
        raise

    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail="Unable to retrieve cameras from Firestore."
        ) from exc

def haversine_meters(lat1, lon1, lat2, lon2):
    R = 6371000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lon = math.radians(lon2 - lon1)
    a = math.sin(delta_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lon / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c

from typing import Any


def get_cameras() -> list[dict[str, Any]]:
    if time.time() - _cache["loaded_at"] > CACHE_SECONDS:
        cameras: list[dict[str, Any]] = []

        documents = firestore_db.collection("flock_cameras").stream()

        for document in documents:
            data = document.to_dict()

            if data is None:
                continue

            cameras.append({
                "id": document.id,
                **data,
            })

        _cache["cameras"] = cameras
        _cache["loaded_at"] = time.time()

    return _cache["cameras"]

@router.post("/nearby")
def nearby(input_info: LocationInputInfo):
    results = []
    for cam in get_cameras():
        d = haversine_meters(input_info.lat_p, input_info.lon_p, cam["latitude"], cam["longitude"])
        if d <= input_info.radius:
            results.append((d, {
                "name": cam.get("name"),
                "latitude": cam["latitude"],
                "longitude": cam["longitude"],
                "heading": cam.get("heading"),
            }))

    results.sort(key=lambda pair: pair[0])
    cameras = [cam for _, cam in results]

    with open("nearby.json", "w") as f:
        if cameras:
            f.write("[\n" + ",\n".join("  " + json.dumps(c) for c in cameras) + "\n]\n")
        else:
            f.write("[]\n")

    
    return project_to_screen(input_info.lat_p, input_info.lon_p, input_info.alpha, input_info.beta, input_info.gamma, input_info.compass_heading, cameras, input_info.screen_w, input_info.screen_h, input_info.hfov)