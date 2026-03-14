FROM python:3.12-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PY_AGENT_HOST=0.0.0.0
ENV PY_AGENT_PORT=8091
ENV PY_AGENT_TIMEOUT_SEC=15.0

# Install data analysis libraries
RUN pip install --no-cache-dir \
    pandas \
    openpyxl \
    xlrd \
    numpy

# Create sandboxed user
RUN useradd --create-home --shell /bin/bash sandbox

COPY server.py /app/server.py

# Create data mount directory
RUN mkdir -p /data && chown sandbox:sandbox /data

EXPOSE 8091

CMD ["python", "/app/server.py"]
