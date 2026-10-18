#!/usr/bin/env python3
"""
Train a Flock-camera photo classifier.

  photo -> CLIP (pretrained, frozen) -> 512 numbers -> classifier -> P(camera)

Folders:
  data/camera/      photos WITH a Flock/ALPR camera
  data/no_camera/   photos WITHOUT one
  (optional) subfolders, e.g. data/camera/cam01/, keep photos of the same camera
  together when testing so the accuracy isn't inflated.

Run:
  python train_classifier.py                   # logistic regression (default)
  python train_classifier.py --head xgboost    # XGBoost instead

Saves model_out/model.joblib, used by predict.py.
Install: pip install torch open_clip_torch scikit-learn pillow joblib  (+ xgboost)
"""

import argparse
import platform
import time
from pathlib import Path

import joblib
import numpy as np
import torch
from PIL import Image, ImageOps

EXTS = {".jpg", ".jpeg", ".png", ".webp"}


def load_clip():
    import open_clip
    model, _, preprocess = open_clip.create_model_and_transforms(
        "ViT-B-32", pretrained="laion2b_s34b_b79k")
    model.eval()
    return model, preprocess


def embed(model, preprocess, images, batch_size=16):
    """List of PIL images -> (n, 512) array of normalized CLIP features."""
    feats = []
    with torch.no_grad():
        for i in range(0, len(images), batch_size):
            batch = torch.stack([preprocess(im) for im in images[i:i + batch_size]])
            f = model.encode_image(batch).float()
            feats.append(torch.nn.functional.normalize(f, dim=-1).numpy())
    return np.concatenate(feats)


def open_image(path):
    return ImageOps.exif_transpose(Image.open(path)).convert("RGB")


def make_classifier(kind):
    if kind == "xgboost":
        from xgboost import XGBClassifier
        return XGBClassifier(n_estimators=300, max_depth=3, learning_rate=0.05,
                             subsample=0.8, colsample_bytree=0.3, eval_metric="logloss")
    from sklearn.linear_model import LogisticRegression
    return LogisticRegression(class_weight="balanced", max_iter=2000)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="data")
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

    # 2. photos -> CLIP features
    model, preprocess = load_clip()
    t0 = time.perf_counter()
    X = embed(model, preprocess, [open_image(p) for p in paths])
    print(f"CLIP features: {X.shape} in {time.perf_counter() - t0:.1f}s")

    # 3. test accuracy on photos the classifier didn't train on (5-fold cross-validation)
    from sklearn.metrics import accuracy_score, classification_report
    from sklearn.model_selection import StratifiedGroupKFold
    preds = np.zeros_like(y)
    for train, test in StratifiedGroupKFold(n_splits=5, shuffle=True, random_state=0).split(X, y, groups):
        clf = make_classifier(args.head).fit(X[train], y[train])
        preds[test] = clf.predict(X[test])
    print(f"\nCross-validated accuracy ({args.head}): {accuracy_score(y, preds):.3f}")
    print(classification_report(y, preds, target_names=["no_camera", "camera"], digits=3))

    # 4. train the final model on all photos and save it
    clf = make_classifier(args.head).fit(X, y)
    Path(args.out).mkdir(exist_ok=True)
    joblib.dump({"head": args.head, "classifier": clf}, Path(args.out) / "model.joblib")
    print(f"Saved {args.out}/model.joblib")


if __name__ == "__main__":
    main()
