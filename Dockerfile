# Node + Python: el servidor es Node y la planilla la lee extractor/planillas.py
FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

COPY extractor/requirements.txt extractor/
RUN python3 -m venv /opt/venv && /opt/venv/bin/pip install --no-cache-dir -r extractor/requirements.txt
ENV PYTHON=/opt/venv/bin/python

COPY . .
CMD ["node", "server.js"]
