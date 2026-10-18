#!/usr/bin/env python3
"""
Classify new photos with the trained model.

CLI:
  python predict.py photo1.jpg photo2.jpg

FastAPI:
  from predict import FlockClassifier
  clf = FlockClassifier()                          # load once at startup

  @app.post("/classify")
  async def classify(file: UploadFile):
      return clf.predict_bytes(await file.read())
"""

import io
import sys
import time

import joblib
from PIL import Image, ImageOps

from train_classifier import embed, load_clip

ACCEPT, REJECT = 0.80, 0.40   # >= ACCEPT: camera | < REJECT: not a camera | between: retake


class FlockClassifier:
    def __init__(self, model_path="model_out/model.joblib"):
        self.classifier = joblib.load(model_path)["classifier"]
        self.clip, self.preprocess = load_clip()

    def predict_image(self, img):
        t0 = time.perf_counter()
        img = ImageOps.exif_transpose(img).convert("RGB")
        p = float(self.classifier.predict_proba(embed(self.clip, self.preprocess, [img]))[0, 1])
        verdict = "camera" if p >= ACCEPT else "not_camera" if p < REJECT else "unsure_retake"
        return {"camera_probability": round(p, 3), "verdict": verdict,
                "latency_ms": round(1000 * (time.perf_counter() - t0), 1)}

    def predict_bytes(self, data):
        return self.predict_image(Image.open(io.BytesIO(data)))


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit("usage: python predict.py photo.jpg [more.jpg ...]")
    clf = FlockClassifier()
    for path in sys.argv[1:]:
        print(path, clf.predict_image(Image.open(path)))
