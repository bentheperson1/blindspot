FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive \
	PYTHONDONTWRITEBYTECODE=1 \
	PYTHONUNBUFFERED=1 \
	HF_HOME=/hf \
	PATH="/opt/venv/bin:$PATH"

RUN apt-get update && apt-get install -y --no-install-recommends \
	python3 python3-venv python3-dev python3-pip \
	python3-numpy python3-scipy python3-sklearn python3-joblib \
	python3-opencv python3-pil python3-grpcio python3-cryptography python3-protobuf \
	build-essential cmake git pkg-config cargo rustc libffi-dev libssl-dev \
	libblas3 liblapack3 \
	&& rm -rf /var/lib/apt/lists/*

RUN python3 -m venv --system-site-packages /opt/venv

# Freeze the apt-provided versions so pip never tries to rebuild them
RUN pip freeze 2>/dev/null | grep -i -E '^(numpy|scipy|scikit-learn|grpcio|cryptography|protobuf|pillow|joblib)==' > /tmp/constraints.txt; cat /tmp/constraints.txt

WORKDIR /code

# torch: s390x builds come from PyTorch's nightly CPU index
RUN pip install --no-cache-dir --pre -c /tmp/constraints.txt \
	--extra-index-url https://download.pytorch.org/whl/nightly/cpu torch

COPY backend/requirements-docker.txt .
RUN pip install --no-cache-dir -c /tmp/constraints.txt -r requirements-docker.txt

# xgboost has no s390x wheel, so this compiles (about 10 to 20 minutes)
RUN pip install --no-cache-dir -c /tmp/constraints.txt xgboost

COPY backend/app ./app
COPY model/predict.py model/train_classifier.py /model/
COPY model/model_out /model/model_out

RUN useradd -m appuser && mkdir -p /hf && chown appuser /hf
USER appuser

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--proxy-headers"]