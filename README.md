# Blindspot

A phone app that spots Flock Safety ALPR cameras. Point your camera at a pole and a classifier on the server tells you whether it's a Flock camera, while known cameras nearby are drawn as AR markers on the camera view and listed on a map.

Built in 24 hours for the 2026 IBM Z Datathon by a team of students from The University of Texas at Dallas.

## Repo layout

| Folder      | What it is                                                                 |
| ----------- | -------------------------------------------------------------------------- |
| `model/`    | Training and prediction scripts for the Flock camera photo classifier       |
| `backend/`  | FastAPI server that runs the classifier and serves nearby cameras from Firestore |
| `frontend/` | Expo (React Native) app for iOS and Android                                 |

## Prerequisites

- Python 3.12
- Node.js 20.16 or newer
- Git
- A phone with [Expo Go](https://expo.dev/go) installed, on the same Wi-Fi network as your computer
- (Optional) A Firebase service account key for the camera database

```bash
git clone https://github.com/bentheperson1/FelixDatathon26.git
cd FelixDatathon26
```

## 1. Train the model (optional)

The backend loads its classifier from `model/model_out/model.joblib`. That folder is gitignored, so you either need a copy of a trained `model.joblib` from a teammate or you need to train one yourself. If you already have the file, put it in `model/model_out/` and skip to step 2.

### Install the training dependencies

```bash
cd model
python -m venv .venv
```

Activate it with `.venv\Scripts\activate` on Windows or `source .venv/bin/activate` on macOS and Linux, then:

```bash
pip install numpy pillow scikit-learn joblib
pip install xgboost        # only if you want --head xgboost
```

### Add training photos

```
model/data/camera/       photos WITH a Flock/ALPR camera
model/data/no_camera/    photos WITHOUT one
```

Photos can be `.jpg`, `.jpeg`, `.png`, or `.webp`. Put photos of the same camera or spot in their own subfolder (for example `data/camera/cam01/`) so cross-validation doesn't test on near-duplicates of training photos, which would inflate the accuracy.

To pull negative photos from Mapillary street imagery around UTD and Richardson, register an application at mapillary.com (Dashboard → Developers) and copy its client token:

```bash
python mapillary_negatives.py --token "MLY|xxxx" --n 80
```

Spot-check the downloaded photos and delete any that happen to contain a camera.

### Train

```bash
python train_classifier.py                       # HOG features + logistic regression (default)
python train_classifier.py --head xgboost        # HOG features + XGBoost
python train_classifier.py --features clip       # CLIP features, needs PyTorch + transformers
```

The script prints cross-validated accuracy and saves `model_out/model.joblib`. The default HOG features are pure numpy, so they run anywhere, including LinuxONE (s390x). CLIP is usually more accurate but needs PyTorch, which has no s390x build on pip.

Test it on a photo:

```bash
python predict.py path/to/photo.jpg
```

A probability of 0.80 or higher is a camera, below 0.40 is not a camera, and anything in between asks the user to retake the photo.

## 2. Set up the backend

```bash
cd backend
python -m venv .venv
```

Activate the venv the same way as above, then install:

```bash
pip install -r requirements.txt
pip install scikit-learn        # needed to load model.joblib
pip install xgboost             # only if the model was trained with --head xgboost
```

### Configure

Firebase is optional. Without it the server still runs and the classifier still works, but no camera markers appear in the app.

The model path defaults to `../model/model_out/model.joblib`. To load it from somewhere else, add `CLASSIFIER_MODEL_PATH` (and `CLASSIFIER_DIR` for the folder holding `predict.py`) to `.env`. Relative paths resolve from `backend/`.

Never commit `.env` or the Firebase key. Both are already in `.gitignore`.

### Run

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000 --env-file .env --reload
```

`--host 0.0.0.0` lets your phone reach the server over Wi-Fi, and `--env-file` loads `DATABASE_CREDENTIALS` into the environment where the camera store reads it.

Check the startup log for `Loaded Flock classifier`. Then open:

- http://127.0.0.1:8000/health
- http://127.0.0.1:8000/docs (interactive API docs)

Run the tests with:

```bash
pytest
```

### Endpoints

| Method | Path                     | Purpose                                              |
| ------ | ------------------------ | ---------------------------------------------------- |
| GET    | `/health`                | Liveness check, drives the app's "API live" light     |
| POST   | `/classify-base64`       | Classify one JPEG (base64 JSON) as camera or not      |
| POST   | `/cameras/nearby`        | Known cameras near the phone, projected to screen x/y |
| POST   | `/cameras/list`          | Raw cameras within a radius, for the map              |
| POST   | `/cameras/getall`        | Every camera, projected to screen x/y                 |
| POST   | `/images/process`        | Multipart image upload, returns a processed JPEG      |
| POST   | `/images/process-base64` | Frame plus phone telemetry as JSON                    |
| POST   | `/images/info`           | Multipart image upload, returns its dimensions        |
| WS     | `/images/stream`         | Send image bytes, receive processed JPEG bytes        |

## 3. Set up the frontend

```bash
cd frontend
npm install
npm install --global eas-cli
npm install --save-dev @expo/ngrok
```

### Run in Expo Go

```bash
npx expo start
```

Scan the QR code with the Camera app (iOS) or Expo Go (Android). If your phone can't reach your computer, for example on campus or other locked-down Wi-Fi, use a tunnel instead, which is what `@expo/ngrok` is for:

```bash
npx expo start --tunnel
```

### Point the app at the backend

In the app, go to **Settings → Detector server** and enter your backend's address:

```
http://YOUR_COMPUTER_LAN_IP:8000
```

Find your LAN IP with `ipconfig` on Windows or `ipconfig getifaddr en0` on macOS. Don't use `localhost`, since on the phone that means the phone itself. The "API live / down" indicator turns green once `/health` responds.

`--tunnel` only tunnels the Expo dev server, not the backend. If you're using it because the phone can't see your computer, the backend also needs an address the phone can reach, such as a cloud server's public IP.

### Build an installable app with EAS

```bash
eas login
eas build:configure
eas build --platform android
```

The finished build is downloadable from your Expo dashboard. Installed Android builds can use plain `http://` backend addresses because `app.json` sets `usesCleartextTraffic`.

## Credits

- **Preston Crow** - AR Co-Developer, Database Manager, Full-Stack Developer
- **Amna Ashraf** - Machine Learning Specialist
- **Adya Dhanasekar**,- Frontend Developer & Graphic Designer
- **Ben Holland** - AR Co-Developer, Server Manager, Full-Stack Developer
- **Jacobo Martinez** - Data Collection & Backend Developer

## Legal

This app is not affiliated with or endorsed by Flock Safety, Inc. The Flock Safety brand is a registered trademark of Flock Safety, Inc.

For entertainment purposes only. Do not use this app to harass or intimidate anyone, or to violate any laws. The authors are not responsible for any misuse of this app.