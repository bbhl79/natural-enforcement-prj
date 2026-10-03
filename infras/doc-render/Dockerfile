FROM debian:bookworm-slim

ENV HOME=/tmp

RUN apt-get update \
  && apt-get install -y --no-install-recommends libreoffice-writer \
  && rm -rf /var/lib/apt/lists/*

CMD ["sleep", "infinity"]
