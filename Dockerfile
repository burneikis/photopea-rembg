FROM python:3.12-alpine

RUN apk add --no-cache openssl

WORKDIR /app
COPY serve.py .
COPY plugin/ plugin/

# Cert is generated on first start into /app/.certs (mount a volume to persist)
EXPOSE 7001
CMD ["python3", "serve.py", "--host", "0.0.0.0", "--port", "7001"]
