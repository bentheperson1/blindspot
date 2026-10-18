#!/usr/bin/env python3
"""
Train a Flock-camera photo classifier.

  photo -> feature extractor -> numbers -> classifier -> P(camera)

Feature extractors (--features):
  hog   (default) classic computer vision written in numpy: HOG edge/shape patterns
        + color histograms. No PyTorch needed, so it runs natively on LinuxONE (s390x).
  clip  pretrained CLIP ViT-B/32 (likely more accurate) - needs PyTorch + transformers.
        PyTorch has no s390x build on pip; run this inside IBM's LinuxONE Jupyter Lab ML
        container, which ships both.

Folders:
  data/camera/      photos WITH a Flock/ALPR camera
  data/no_camera/   photos WITHOUT one
  (optional) subfolders, e.g. data/camera/cam01/, keep photos of the same camera
  together when testing so the accuracy isn't inflated.

Run:
  python train_classifier.py                         # HOG + logistic regression
  python train_classifier.py --head xgboost          # HOG + XGBoost
  python train_classifier.py --features clip         # CLIP (only where torch installs)

Saves model_out/model.joblib, used by predict.py.
Install (LinuxONE): pip install numpy pillow scikit-learn joblib   (+ xgboost)
"""

import argparse
import platform
import time
from pathlib import Path

import joblib
import numpy as np
from PIL import Image, ImageOps

EXTS = {".jpg", ".jpeg", ".png", ".webp"}


# ----------------------------------------------------------------- HOG features
def hog_features(img, size=128, cell=8, bins=9):
    """Histogram of Oriented Gradients + HSV color histogram, pure numpy."""
    gray = np.asarray(img.convert("L").resize((size, size)), dtype=np.float32) / 255.0
    gy, gx = np.gradient(gray)
    mag = np.hypot(gx, gy)
    ang = (np.degrees(np.arctan2(gy, gx)) + 180.0) % 180.0          # unsigned 0-180
    b = np.minimum((ang / (180.0 / bins)).astype(int), bins - 1)

    n = size // cell                                                  # 16 x 16 cells
    cell_id = (np.arange(size) // cell)[:, None] * n + (np.arange(size) // cell)[None, :]
    hist = np.zeros((n * n, bins), np.float32)
    np.add.at(hist, (cell_id.ravel(), b.ravel()), mag.ravel())
    hist = hist.reshape(n, n, bins)

    blocks = []                                                       # 2x2-cell blocks, L2-Hys
    for i in range(n - 1):
        for j in range(n - 1):
            v = hist[i:i + 2, j:j + 2].ravel()
            v = v / (np.linalg.norm(v) + 1e-6)
            v = np.minimum(v, 0.2)
            blocks.append(v / (np.linalg.norm(v) + 1e-6))
    hog = np.concatenate(blocks)

    hsv = np.asarray(img.convert("HSV").resize((64, 64)), dtype=np.int32)
    color, _ = np.histogramdd(hsv.reshape(-1, 3), bins=(8, 4, 4), range=((0, 256),) * 3)
    color = color.ravel() / color.sum()
    return np.concatenate([hog, color]).astype(np.float32)


# ---------------------------------------------------------------- CLIP features
# Uses Hugging Face transformers (no torchvision needed), which is preinstalled with
# PyTorch in IBM's LinuxONE Jupyter Lab ML image (registry.linuxone.cloud.marist.edu/
# l1cc/jupyterlab-image-s390x). Weights (~600 MB) download on first use.
CLIP_MODEL = "openai/clip-vit-base-patch32"


def load_clip():
    from transformers import CLIPImageProcessor, CLIPModel
    processor = CLIPImageProcessor.from_pretrained(CLIP_MODEL)
    model = CLIPModel.from_pretrained(CLIP_MODEL).eval()
    return model, processor


def clip_features(model, processor, images, batch_size=16):
    import torch
    feats = []
    with torch.no_grad():
        for i in range(0, len(images), batch_size):
            px = processor(images=images[i:i + batch_size], return_tensors="pt")["pixel_values"]
            pooled = model.vision_model(pixel_values=px).pooler_output   # image transformer
            f = model.visual_projection(pooled).float()                  # -> 512 numbers
            feats.append(torch.nn.functional.normalize(f, dim=-1).numpy())
    return np.concatenate(feats)


class FeatureExtractor:
    def __init__(self, kind):
        self.kind = kind
        if kind == "clip":
            self.model, self.preprocess = load_clip()

    def __call__(self, images):
        if self.kind == "clip":
            return clip_features(self.model, self.preprocess, images)
        return np.stack([hog_features(im) for im in images])


# ------------------------------------------------------------------- the rest
def open_image(path):
    return ImageOps.exif_transpose(Image.open(path)).convert("RGB")


def make_classifier(kind):
    if kind == "xgboost":
        from xgboost import XGBClassifier
        return XGBClassifier(n_estimators=300, max_depth=3, learning_rate=0.05,
                             subsample=0.8, colsample_bytree=0.3, eval_metric="logloss")
    from sklearn.linear_model import LogisticRegression
    from sklearn.pipeline import make_pipeline
    from sklearn.preprocessing import StandardScaler
    return make_pipeline(StandardScaler(),
                         LogisticRegression(class_weight="balanced", C=0.05, max_iter=5000))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="data")
    ap.add_argument("--features", choices=["hog", "clip"], default="hog")
    ap.add_argument("--head", choices=["logreg", "xgboost"], default="logreg")
    ap.add_argument("--out", default="model_out")
    args = ap.parse_args()

    # 1. load photos + labels
    paths, labels, groups = [], [], []
    for label_name, label in (("camera", 1), ("no_camera", 0)):
        root = Path(args.data) / label_name
        for p in sorted(root.rglob("*")):
            if p.suffix.lower() in EXTS:
                paths.append(p)
                labels.append(label)
                # same subfolder = same camera/spot; loose files are their own group
                groups.append(str(p.parent) if p.parent != root else str(p))
    y, groups = np.array(labels), np.array(groups)
    print(f"{len(y)} photos: {y.sum()} camera, {(1 - y).sum()} no_camera | machine={platform.machine()}")

    # 2. photos -> features
    extract = FeatureExtractor(args.features)
    t0 = time.perf_counter()
    X = extract([open_image(p) for p in paths])
    secs = time.perf_counter() - t0
    print(f"{args.features} features: {X.shape} in {secs:.1f}s ({1000 * secs / len(y):.1f} ms/photo)")

    # 3. test accuracy on photos the classifier didn't train on (5-fold cross-validation)
    from sklearn.metrics import accuracy_score, classification_report
    from sklearn.model_selection import StratifiedGroupKFold
    preds = np.zeros_like(y)
    for train, test in StratifiedGroupKFold(n_splits=5, shuffle=True, random_state=0).split(X, y, groups):
        clf = make_classifier(args.head).fit(X[train], y[train])
        preds[test] = clf.predict(X[test])
    print(f"\nCross-validated accuracy ({args.features} + {args.head}): {accuracy_score(y, preds):.3f}")
    print(classification_report(y, preds, target_names=["no_camera", "camera"], digits=3))

    # 4. train the final model on all photos and save it
    clf = make_classifier(args.head).fit(X, y)
    Path(args.out).mkdir(exist_ok=True)
    joblib.dump({"features": args.features, "head": args.head, "classifier": clf},
                Path(args.out) / "model.joblib")
    print(f"Saved {args.out}/model.joblib")


if __name__ == "__main__":
    main()
