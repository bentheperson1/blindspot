from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.concurrency import run_in_threadpool
from app.services import camera_store

from app.api.routes import health, images, cameras
from app.core.config import settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: load heavy resources once here (YOLO, DNN, etc.)
    # app.state.model = load_model()
    await run_in_threadpool(camera_store.all_cameras)
    yield
    # Shutdown: release resources here


app = FastAPI(title=settings.app_name, debug=settings.debug, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(images.router)
app.include_router(cameras.router)