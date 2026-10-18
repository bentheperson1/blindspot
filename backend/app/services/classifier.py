import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[2]

MESSAGES = {
    "not_camera": "Not a Flock camera",
    "unsure_retake": "Unsure, move closer",
}


def resolve(path: str) -> Path:
    p = Path(path)
    return p if p.is_absolute() else (BACKEND_DIR / p).resolve()


def load_classifier(classifier_dir: str, model_path: str):
    # model/ isn't a package; put it on sys.path so predict.py (and its train_classifier import) resolve.
    code_dir = str(resolve(classifier_dir))
    if code_dir not in sys.path:
        sys.path.insert(0, code_dir)

    from predict import FlockClassifier

    return FlockClassifier(str(resolve(model_path)))


def describe(result: dict) -> dict:
    verdict = result["verdict"]
    probability = result["camera_probability"]

    if verdict == "camera":
        message = f"Flock camera · {round(probability * 100)}%"
    else:
        message = MESSAGES.get(verdict, verdict)

    return {
        "alert": verdict == "camera",
        "message": message,
        "detections": [],
        "probability": probability,
        "verdict": verdict,
    }
