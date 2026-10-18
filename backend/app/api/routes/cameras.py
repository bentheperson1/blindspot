import os

import firebase_admin
from firebase_admin import credentials, firestore
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ValidationError
from ...schemas.vision import FlockCamera
from ...services.ar_projection import project_to_screen

router = APIRouter(prefix="/cameras", tags=["cameras"])

credential_path = os.environ.get("DATABASE_CREDENTIALS", "C:/Users/fifth/Downloads/felixdatathon2026-firebase-adminsdk-fbsvc-c380b80266.json")

print(credential_path)

if not firebase_admin._apps:
    credential = credentials.Certificate(credential_path)
    firebase_admin.initialize_app(credential)

firestore_db = firestore.client()

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