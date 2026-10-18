FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive \
	PYTHONDONTWRITEBYTECODE=1 \
	PYTHONUNBUFFERED=1 \
	PATH="/opt/venv/bin:$PATH"

RUN apt-get update && apt-get install -y --no-install-recommends \
	python3 python3-venv python3-numpy python3-opencv \
	&& rm -rf /var/lib/apt/lists/*

RUN python3 -m venv --system-site-packages /opt/venv

WORKDIR /code

COPY backend/requirements-docker.txt .
RUN pip install --no-cache-dir -r requirements-docker.txt

COPY backend/app ./app

RUN useradd -m appuser
USER appuser

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2", "--proxy-headers"]
