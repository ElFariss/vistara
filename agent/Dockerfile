FROM python:3.12-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# Install dependencies from pyproject.toml
COPY pyproject.toml /app/
COPY agent /app/agent/

RUN pip install --no-cache-dir pip==24.0 && \
    pip install --no-cache-dir -e .

EXPOSE 8001

CMD ["uvicorn", "agent.main:app", "--host", "0.0.0.0", "--port", "8001"]
