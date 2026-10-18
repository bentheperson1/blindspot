# app/api/routes/cameras.py
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services import camera_store
from app.services.ar_projection import project_to_screen

from app.schemas.vision import FlockCamera, InputInfo, LocationInputInfo

router = APIRouter(prefix="/cameras", tags=["cameras"])



def _project(info: InputInfo, cameras):
    return project_to_screen(
        info.lat_p, info.lon_p,
        info.alpha, info.beta, info.gamma, info.compass_heading,
        cameras,
        info.screen_w, info.screen_h, info.hfov,
    )


@router.get("")
def health_check():
    return {"status": "ok"}


@router.post("/getall")
def get_all_cameras(info: InputInfo):
    try:
        return _project(info, camera_store.all_cameras())
    except Exception as exc:
        raise HTTPException(503, "Unable to retrieve cameras from Firestore.") from exc


@router.post("/nearby")
def nearby(info: LocationInputInfo):
    return _project(info, camera_store.cameras_within(info.lat_p, info.lon_p, info.radius))


class ListRequest(BaseModel):
    lat_p: float
    lon_p: float
    radius: float


@router.post("/list")
def list_nearby(req: ListRequest):
    """Raw cameras (name, lat, lon, heading) within `radius` meters. Read from the in-memory cache, not Firestore.
    The phone caches this list (30 s walking / 5 s driving) and places the markers itself."""
    return [
        {"name": c.name, "latitude": c.latitude, "longitude": c.longitude, "heading": c.heading}
        for c in camera_store.cameras_within(req.lat_p, req.lon_p, req.radius)
    ]