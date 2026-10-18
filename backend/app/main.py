import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.concurrency import run_in_threadpool

from app.api.routes import health, images, cameras, classify
from app.core.config import settings
from app.services import camera_store
from app.services.classifier import load_classifier

logger = logging.getLogger("uvicorn.error")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: load the Flock camera classifier once. If it can't load, the app still serves
    # the other routes and the classify endpoints report that the model is unavailable.
    try:
        app.state.classifier = load_classifier(settings.classifier_dir, settings.classifier_model_path)
        logger.info("Loaded Flock classifier from %s", settings.classifier_model_path)
    except Exception:
        logger.exception("Could not load Flock classifier from %s", settings.classifier_model_path)
        app.state.classifier = None

    # Warm the Firestore camera cache. Firebase is optional; without it the AR dots are just empty.
    try:
        await run_in_threadpool(camera_store.all_cameras)
    except camera_store.CameraStoreUnavailable:
        pass  # camera_store already logged why
    except Exception:
        logger.warning("Could not preload cameras from Firestore", exc_info=True)
    yield
    # Shutdown: release resources here
    app.state.classifier = None


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
app.include_router(classify.router)