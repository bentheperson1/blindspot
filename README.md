# Felix Files

### Backend

FastAPI backend that receives images and processes them with OpenCV.

## Run

```
uvicorn app.main:app --reload
```

Docs: http://127.0.0.1:8000/docs

## Test

```
pytest
```

## Endpoints

- `GET /health`
- `POST /images/process` (multipart upload, returns JPEG)
- `POST /images/process-base64` (JSON with base64 image)
- `POST /images/info` (multipart upload, returns dimensions)
- `WS /images/stream` (send image bytes, receive processed JPEG bytes)